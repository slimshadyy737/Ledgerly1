/**
 * ---------------------------------------------------------------------------
 * THE LOGIC ENGINE ("The Detective")
 * ---------------------------------------------------------------------------
 * Pure functions only: rows in -> findings + metrics out. No I/O happens here,
 * which is why the detectors are trivially unit-testable and easy to explain.
 *
 * The pipeline is a three-way join, exactly like a real spend-intelligence tool:
 *
 *   transactions (the $)      -- vendor + amount + billing period
 *   seat_assignments          -- WHO holds a licence  (licence register)
 *   sso_events                -- WHO actually logs in (IdP export)
 *   employees                 -- employment status (HRIS: did they leave?)
 *
 * Detection thresholds (all configurable below):
 *   GHOST_INACTIVE_DAYS  60 : seat held by someone who has not logged in 60+ days
 *   ZOMBIE_INACTIVE_DAYS 30 : nobody logged in at all within 30 days, still billed
 *   OVERLAP_MIN_COST     $100 : ignore tiny duplicate tools when flagging overlap
 */
import type { InferSelectModel } from "drizzle-orm";
import {
  employees as employeesTable,
  optimizationActions as actionsTable,
  seatAssignments as seatsTable,
  ssoEvents as ssoTable,
  transactions as transactionsTable,
  vendors as vendorsTable,
} from "@/db/schema";
import type {
  AppliedActionDTO,
  CategorySlice,
  EmployeeDTO,
  Finding,
  InventoryRow,
  Metrics,
  SeatEvidence,
  ShadowItApp,
  Snapshot,
  SsoRecordDTO,
  TransactionDTO,
  WasteLedgerRow,
} from "./types";

export const GHOST_INACTIVE_DAYS = 60;
export const ZOMBIE_INACTIVE_DAYS = 30;
export const OVERLAP_MIN_COST_CENTS = 10_000;
/** Immaterial ghost-seat leakage stays in the ledger but does not raise an alert. */
export const GHOST_FINDING_MIN_CENTS = 1_000;
/** Seats cold for between 30 and 60 days are "at risk" but not yet ghosts. */
export const COLD_SEAT_DAYS = 30;

export const DAY_MS = 86_400_000;

type EmployeeRow = InferSelectModel<typeof employeesTable>;
type VendorRow = InferSelectModel<typeof vendorsTable>;
type SeatRow = InferSelectModel<typeof seatsTable>;
type SsoRow = InferSelectModel<typeof ssoTable>;
type TxRow = InferSelectModel<typeof transactionsTable>;
type ActionRow = InferSelectModel<typeof actionsTable>;

export interface EngineInput {
  now: Date;
  employees: EmployeeRow[];
  vendors: VendorRow[];
  seats: SeatRow[];
  ssoEvents: SsoRow[];
  transactions: TxRow[];
  actions: ActionRow[];
  lastIngestAt: Date | null;
  ingestDurationMs: number;
}

export interface EngineOutput {
  snapshot: Snapshot;
}

/* --------------------------------- helpers -------------------------------- */

export function daysSince(date: Date | null, now: Date): number | null {
  if (!date) return null;
  return Math.floor((now.getTime() - date.getTime()) / DAY_MS);
}

export function inDays(date: Date, now: Date): number {
  return Math.ceil((date.getTime() - now.getTime()) / DAY_MS);
}

function healthGrade(score: number): { grade: string; label: string } {
  if (score >= 85) return { grade: "A", label: "Healthy" };
  if (score >= 70) return { grade: "B", label: "Monitor" };
  if (score >= 55) return { grade: "C", label: "At Risk" };
  if (score >= 40) return { grade: "D", label: "Critical" };
  return { grade: "F", label: "Churn" };
}

function severityForSavings(cents: number, base: "critical" | "high" | "medium" | "low") {
  if (base === "critical") return "critical" as const;
  if (cents >= 40_000) return "critical" as const;
  if (cents >= 15_000) return "high" as const;
  return base;
}

/**
 * Cross-category aliases: tools that do NOT share the same category string but
 * still compete for the same budget. Declared explicitly (no fuzzy guessing) so
 * the Overlap Detector's reasoning is easy to defend in a review.
 */
const OVERLAP_ALIASES: Record<string, string[]> = {
  "Error Monitoring": ["Observability"],
  "Cloud Storage": ["Productivity Suite"],
};

/** Union-find over category groups so aliased groups are analysed as one cluster. */
function buildOverlapClusters(groupMembers: Map<string, VendorRow[]>): Map<string, VendorRow[]> {
  const parent = new Map<string, string>();
  const find = (key: string): string => {
    const current = parent.get(key) ?? key;
    if (current === key) return key;
    const root = find(current);
    parent.set(key, root);
    return root;
  };
  const union = (a: string, b: string) => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent.set(rootA, rootB);
  };

  const groupNames = [...groupMembers.keys()];
  groupNames.forEach((group) => parent.set(group, group));
  groupNames.forEach((group) => {
    (OVERLAP_ALIASES[group] ?? [])
      .filter((alias) => groupMembers.has(alias))
      .forEach((alias) => union(group, alias));
  });

  const clusters = new Map<string, VendorRow[]>();
  groupNames.forEach((group) => {
    const root = find(group);
    const members = clusters.get(root) ?? [];
    members.push(...(groupMembers.get(group) ?? []));
    clusters.set(root, members);
  });
  return clusters;
}

/* -------------------------------- the engine ------------------------------- */

export function runDetective(input: EngineInput): EngineOutput {
  const { now } = input;

  const employeeById = new Map<number, EmployeeRow>();
  input.employees.forEach((e) => employeeById.set(e.id, e));

  const vendorById = new Map<number, VendorRow>();
  input.vendors.forEach((v) => vendorById.set(v.id, v));

  const activeJobs = input.vendors.filter((v) => v.status === "active");

  /* --- index the two "activity" sources ---------------------------------- */
  const seatsByVendor = new Map<number, SeatRow[]>();
  input.seats.forEach((s) => {
    if (s.status !== "active") return;
    const list = seatsByVendor.get(s.vendorId) ?? [];
    list.push(s);
    seatsByVendor.set(s.vendorId, list);
  });

  // vendorId -> employeeId -> login telemetry (the SSO join)
  const ssoByVendorEmployee = new Map<string, SsoRow>();
  const ssoByApp = new Map<string, SsoRow[]>();
  input.ssoEvents.forEach((row) => {
    if (row.employeeId != null) ssoByVendorEmployee.set(`${row.appName}|${row.employeeId}`, row);
    const list = ssoByApp.get(row.appName) ?? [];
    list.push(row);
    ssoByApp.set(row.appName, list);
  });

  const loginFor = (vendor: VendorRow, employeeId: number): SsoRow | undefined =>
    ssoByVendorEmployee.get(`${vendor.name}|${employeeId}`);

  /* --- category groups (for the Overlap Detector) ------------------------- */
  const groupMembers = new Map<string, VendorRow[]>();
  activeJobs.forEach((v) => {
    const list = groupMembers.get(v.categoryGroup) ?? [];
    list.push(v);
    groupMembers.set(v.categoryGroup, list);
  });

  /**
   * Some categories overlap without sharing a name (Sentry vs Datadog,
   * Dropbox vs Google Workspace Drive). Peers are declared explicitly so the
   * detector stays explainable instead of relying on fuzzy string matching.
   */
  const clusters = buildOverlapClusters(groupMembers);
  const clusterSizeByVendorId = new Map<number, number>();
  clusters.forEach((members) => members.forEach((v) => clusterSizeByVendorId.set(v.id, members.length)));

  /* --- per-vendor analysis ----------------------------------------------- */
  interface VendorAnalysis {
    vendor: VendorRow;
    seats: SeatRow[];
    evidence: SeatEvidence[];
    ghostSeats: SeatEvidence[];
    coldSeats: SeatEvidence[];
    activeUsers: number;
    ghostWasteCents: number;
    idleWasteCents: number;
    zombie: boolean;
    zombieWasteCents: number;
    overlapWith: string[];
    overlapWasteCents: number;
    totalWasteCents: number;
    wasteReason: string | null;
    avgDaysSinceLogin: number | null;
    healthScore: number;
    utilizationPct: number;
  }

  const analyses: VendorAnalysis[] = activeJobs.map((vendor) => {
    const vendorSeats = seatsByVendor.get(vendor.id) ?? [];
    const perSeat = vendor.billingModel === "per_seat";

    const evidence: SeatEvidence[] = vendorSeats.map((seat) => {
      const employee = employeeById.get(seat.employeeId);
      const sso = loginFor(vendor, seat.employeeId);
      const lastLoginAt = sso?.lastLoginAt ?? seat.lastLoginAt ?? null;
      const dsl = daysSince(lastLoginAt, now);
      const offboarded = employee?.status === "offboarded";
      let flag: SeatEvidence["flag"] = "healthy";
      if (offboarded) flag = "offboarded";
      else if (dsl === null || dsl > GHOST_INACTIVE_DAYS) flag = "inactive_60d";
      else if (dsl > COLD_SEAT_DAYS) flag = "inactive_30d";

      return {
        employeeName: employee?.fullName ?? "Unknown employee",
        employeeEmail: employee?.email ?? "unknown@northwind.io",
        department: employee?.department ?? "—",
        employeeStatus: (employee?.status as "active" | "offboarded") ?? "active",
        lastLoginAt: lastLoginAt ? lastLoginAt.toISOString() : null,
        daysSinceLogin: dsl,
        loginsLast30d: sso?.loginsLast30d ?? seat.loginsLast30d ?? 0,
        seatCostCents: seat.seatCostCents || vendor.seatUnitCostCents,
        flag,
      };
    });

    const ghostSeats = evidence.filter((s) => s.flag === "offboarded" || s.flag === "inactive_60d");
    const coldSeats = evidence.filter((s) => s.flag === "inactive_30d");
    const activeUsers = evidence.filter((s) => s.flag === "healthy").length;

    // RULE 1 — Ghost seats: billed licence, holder left OR silent for 60+ days.
    const ghostWasteCents = perSeat
      ? ghostSeats.reduce((sum, s) => sum + s.seatCostCents, 0)
      : 0;

    // Paid seats that were never even provisioned (licence register gap).
    const idleWasteCents = perSeat ? vendor.idleSeats * vendor.seatUnitCostCents : 0;

    // RULE 2 — Zombie software: the card is charged, but NOBODY has logged in
    // within the last 30 days (every seat is stale), so the whole line item is waste.
    const zombie =
      perSeat &&
      evidence.length > 0 &&
      evidence.every((s) => s.loginsLast30d === 0) &&
      evidence.every((s) => (s.daysSinceLogin ?? 999) >= ZOMBIE_INACTIVE_DAYS) &&
      vendor.seatsPaid > 0;
    const zombieWasteCents = zombie ? vendor.monthlyCostCents : 0;

    const loginDays = evidence
      .map((s) => s.daysSinceLogin)
      .filter((d): d is number => d !== null);
    const avgDaysSinceLogin =
      loginDays.length > 0 ? Math.round(loginDays.reduce((a, b) => a + b, 0) / loginDays.length) : null;

    const utilizationPct = vendor.seatsPaid > 0 ? (activeUsers / vendor.seatsPaid) * 100 : 100;

    return {
      vendor,
      seats: vendorSeats,
      evidence,
      ghostSeats,
      coldSeats,
      activeUsers,
      ghostWasteCents,
      idleWasteCents,
      zombie,
      zombieWasteCents,
      overlapWith: [],
      overlapWasteCents: 0,
      totalWasteCents: 0,
      wasteReason: null,
      avgDaysSinceLogin,
      healthScore: 0,
      utilizationPct,
    };
  });

  const byVendorId = new Map<number, VendorAnalysis>();
  analyses.forEach((a) => byVendorId.set(a.vendor.id, a));

  /* --- RULE 3 — Overlap Duplication -------------------------------------- */
  // Any category (or aliased cluster of categories) with 2+ active subscriptions
  // where a lower-adoption "secondary" tool is still paid for is a consolidation
  // candidate. The incumbent is the tool carrying the biggest invoice.
  clusters.forEach((members, group) => {
    // A zombie tool can never be the "incumbent" — recommending that we migrate
    // users INTO a dead tool would contradict the zombie finding.
    const viable = members.filter((v) => !byVendorId.get(v.id)!.zombie);
    if (viable.length < 2) return;
    const ranked = [...viable].sort((a, b) => {
      if (b.monthlyCostCents !== a.monthlyCostCents) return b.monthlyCostCents - a.monthlyCostCents;
      return byVendorId.get(b.id)!.activeUsers - byVendorId.get(a.id)!.activeUsers;
    });
    const primary = ranked[0];
    const adoption = (vendor: VendorRow) => {
      const a = byVendorId.get(vendor.id)!;
      return vendor.seatsPaid > 0 ? a.activeUsers / vendor.seatsPaid : 1;
    };
    const candidates = ranked.slice(1).filter((v) => {
      const a = byVendorId.get(v.id)!;
      return !a.zombie && v.monthlyCostCents >= OVERLAP_MIN_COST_CENTS && a.evidence.length > 0;
    });
    // Flag only the worst offender per category to avoid noisy duplicate alerts.
    const flagged = [...candidates].sort((a, b) => adoption(a) - adoption(b))[0];
    if (!flagged) return;

    const target = byVendorId.get(flagged.id)!;
    target.overlapWith = ranked.map((v) => v.name);
    /**
     * Savings-counting rule (important for a CFO-grade report): a dollar of
     * spend can only be counted ONCE. Ghost/idle waste is already counted, so
     * only the *unclaimed* remainder of the duplicate tool's bill is added here.
     */
    target.overlapWasteCents = Math.max(
      0,
      flagged.monthlyCostCents - target.ghostWasteCents - target.idleWasteCents,
    );
    target.wasteReason = `Duplicate of ${primary.name} in "${group}"`;
  });

  /* --- waste roll-up + health scoring ------------------------------------ */
  analyses.forEach((a) => {
    // A zombie tool makes the ENTIRE line item waste; otherwise we add up the
    // individual proven leaks (ghost seats, idle seats, duplication premium).
    a.totalWasteCents = a.zombie
      ? a.zombieWasteCents
      : a.ghostWasteCents + a.idleWasteCents + a.overlapWasteCents;

    if (a.vendor.billingModel === "per_seat" && a.vendor.seatsPaid > 0) {
      const activeShare = a.activeUsers / a.vendor.seatsPaid;
      const freshShare = (a.activeUsers + a.coldSeats.length * 0.5) / a.vendor.seatsPaid;
      const ghostShare = a.ghostSeats.length / a.vendor.seatsPaid;
      const groupSize = clusterSizeByVendorId.get(a.vendor.id) ?? 1;
      const redundancyPenalty = groupSize >= 3 ? 20 : groupSize === 2 ? 11 : 0;
      const zombiePenalty = a.zombie ? 38 : 0;
      const raw = 55 * activeShare + 30 * freshShare + 15 * (1 - ghostShare) - redundancyPenalty - zombiePenalty;
      a.healthScore = Math.max(0, Math.min(100, Math.round(raw)));
    } else {
      // Usage/flat rate tools have no seat telemetry: score them on contract
      // hygiene (renewal proximity) and spend stability instead.
      const renewal = inDays(a.vendor.renewalDate, now);
      const renewalPenalty = renewal < 15 ? 10 : 0;
      a.healthScore = Math.max(0, 92 - renewalPenalty - (a.totalWasteCents > 0 ? 15 : 0));
    }
  });

  /* --- findings (the CFO action feed) ------------------------------------ */
  const findings: Finding[] = [];

  analyses.forEach((a) => {
    const vendor = a.vendor;

    if (a.zombie) {
      findings.push({
        id: `zombie-${vendor.id}`,
        kind: "zombie_software",
        severity: "critical",
        vendorId: vendor.id,
        vendorName: vendor.name,
        category: vendor.category,
        title: `Zombie subscription: ${vendor.name} is billing with zero logins`,
        detail:
          `All ${a.evidence.length} seat holders have been silent for 30+ days ` +
          `(most recent login: ${Math.min(...a.evidence.map((s) => s.daysSinceLogin ?? 999))} days ago) ` +
          `yet the card was charged $${(vendor.monthlyCostCents / 100).toFixed(2)} last month. ` +
          `${vendor.notes ?? ""}`,
        detectionRule: "max(sso.logins_last_30d) = 0 AND min(days_since_login) >= 30 AND transaction.is_recurring = true",
        impactCents: a.zombieWasteCents,
        seatsAffected: a.evidence.length || vendor.seatsPaid,
        confidence: 0.96,
        recommendedAction: `Cancel ${vendor.name} before the ${inDays(vendor.renewalDate, now)}-day renewal window closes`,
        actionType: "cancel_subscription",
        evidence: a.evidence.slice(0, 12),
      });
    } else if (a.ghostSeats.length > 0 && a.ghostWasteCents >= GHOST_FINDING_MIN_CENTS) {
      const offboarded = a.ghostSeats.filter((s) => s.flag === "offboarded").length;
      const inactive = a.ghostSeats.length - offboarded;
      findings.push({
        id: `ghost-${vendor.id}`,
        kind: "ghost_seats",
        severity: severityForSavings(a.ghostWasteCents, "high"),
        vendorId: vendor.id,
        vendorName: vendor.name,
        category: vendor.category,
        title: `${a.ghostSeats.length} unused ${vendor.name} seat${a.ghostSeats.length === 1 ? "" : "s"} detected`,
        detail:
          `${offboarded} seat${offboarded === 1 ? "" : "s"} belong to offboarded employees and ` +
          `${inactive} seat${inactive === 1 ? "" : "s"} have not logged in for ${GHOST_INACTIVE_DAYS}+ days. ` +
          `Reclaiming them trims the licence from ${vendor.seatsPaid} to ${vendor.seatsPaid - a.ghostSeats.length} seats.`,
        detectionRule: `employee.status = 'offboarded' OR days_since(sso.last_login_at) > ${GHOST_INACTIVE_DAYS}`,
        impactCents: a.ghostWasteCents,
        seatsAffected: a.ghostSeats.length,
        confidence: 0.93,
        recommendedAction: `Reclaim ${a.ghostSeats.length} seat${a.ghostSeats.length === 1 ? "" : "s"} at $${(vendor.seatUnitCostCents / 100).toFixed(2)}/seat`,
        actionType: "reclaim_seats",
        evidence: [...a.ghostSeats].sort((x, y) => (y.daysSinceLogin ?? 0) - (x.daysSinceLogin ?? 0)),
      });
    }

    if (!a.zombie && vendor.idleSeats > 0 && a.idleWasteCents > 0) {
      findings.push({
        id: `idle-${vendor.id}`,
        kind: "idle_seats",
        severity: "medium",
        vendorId: vendor.id,
        vendorName: vendor.name,
        category: vendor.category,
        title: `${vendor.idleSeats} paid ${vendor.name} seat${vendor.idleSeats === 1 ? "" : "s"} never provisioned`,
        detail:
          `${vendor.seatsPaid} seats are on the invoice but only ${a.evidence.length} exist in the licence register. ` +
          `Downgrading removes $${(a.idleWasteCents / 100).toFixed(2)}/month of abandoned capacity.`,
        detectionRule: "vendor.seats_paid - count(active seat_assignments) > 0",
        impactCents: a.idleWasteCents,
        seatsAffected: vendor.idleSeats,
        confidence: 0.9,
        recommendedAction: `Downgrade ${vendor.name} by ${vendor.idleSeats} seats at next renewal`,
        actionType: "reclaim_seats",
        evidence: [],
      });
    }

    if (!a.zombie && a.overlapWasteCents > 0) {
      const others = a.overlapWith.filter((n) => n !== vendor.name);
      findings.push({
        id: `overlap-${vendor.id}`,
        kind: "overlap_duplication",
        severity: severityForSavings(a.overlapWasteCents, "medium"),
        vendorId: vendor.id,
        vendorName: vendor.name,
        category: vendor.category,
        title: `Overlap alert: ${vendor.name} duplicates ${others.join(" + ")}`,
        detail:
          `Northwind pays for ${a.overlapWith.length} tools in the "${vendor.categoryGroup}" category. ` +
          `${vendor.name} has only ${a.activeUsers} active of ${vendor.seatsPaid} seats` +
          `${a.avgDaysSinceLogin !== null ? ` (avg last login ${a.avgDaysSinceLogin} days ago)` : ""}. ` +
          `Consolidating into ${others[0]} removes $${(a.overlapWasteCents / 100).toFixed(2)}/month from the stack ` +
          `(savings already counted once — ghost-seat leakage on this invoice is not double-counted).`,
        detectionRule: `count(active vendors per category_group) >= 2 AND secondary.monthly_cost >= $100`,
        impactCents: a.overlapWasteCents,
        seatsAffected: a.evidence.length,
        confidence: 0.87,
        recommendedAction: `Migrate ${vendor.name} users to ${others[0]} and cancel the contract`,
        actionType: "consolidate",
        evidence: a.evidence.slice(0, 8),
      });
    }
  });

  /* --- RULE 5 (bonus) — Shadow IT ---------------------------------------- */
  const billedVendorNames = new Set(input.vendors.map((v) => v.name));
  const shadowItMap = new Map<string, ShadowItApp>();
  input.ssoEvents.forEach((row) => {
    if (billedVendorNames.has(row.appName)) return; // matched to a paid vendor
    const existing = shadowItMap.get(row.appName) ?? {
      appName: row.appName,
      users: 0,
      lastLoginAt: null,
      daysSinceLogin: null,
    };
    existing.users += 1;
    if (row.lastLoginAt && (!existing.lastLoginAt || row.lastLoginAt > new Date(existing.lastLoginAt))) {
      existing.lastLoginAt = row.lastLoginAt.toISOString();
      existing.daysSinceLogin = daysSince(row.lastLoginAt, now);
    }
    shadowItMap.set(row.appName, existing);
  });
  const shadowIt = [...shadowItMap.values()].sort((a, b) => b.users - a.users);

  shadowIt.forEach((app) => {
    findings.push({
      id: `shadow-${app.appName}`,
      kind: "shadow_it",
      severity: "low",
      vendorId: null,
      vendorName: app.appName,
      category: "Unmanaged spend",
      title: `Shadow IT: ${app.appName} active in SSO with no invoice on file`,
      detail:
        `${app.users} employees authenticate into ${app.appName} through Google Workspace, but no matching ` +
        `transaction exists in the accounting statement. Either it is expensed on personal cards or it is free-tier ` +
        `about to convert — worth an owner and a policy review.`,
      detectionRule: "sso app exists AND no vendor matched via merchant descriptor fuzzy-match",
      impactCents: 0,
      seatsAffected: app.users,
      confidence: 0.72,
      recommendedAction: "Assign an owner and request the invoice",
      actionType: "review_contract",
      evidence: [],
    });
  });

  findings.sort((a, b) => b.impactCents - a.impactCents || a.vendorName.localeCompare(b.vendorName));

  /* --- metrics ----------------------------------------------------------- */
  const monthlySpendCents = activeJobs.reduce((sum, v) => sum + v.monthlyCostCents, 0);
  const recoverableCents = analyses.reduce((sum, a) => sum + a.totalWasteCents, 0);
  const seatsPaid = activeJobs.reduce((sum, v) => sum + v.seatsPaid, 0);
  const activeUsers = analyses.reduce((sum, a) => sum + a.activeUsers, 0);
  const recoveredCents = input.actions
    .filter((a) => a.status === "applied")
    .reduce((sum, a) => sum + a.monthlySavingsCents, 0);

  const metrics: Metrics = {
    monthlySpendCents,
    annualizedSpendCents: monthlySpendCents * 12,
    activeSubscriptions: activeJobs.length,
    cancelledSubscriptions: input.vendors.filter((v) => v.status !== "active").length,
    wastedCents: recoverableCents,
    wasteRatePct: monthlySpendCents > 0 ? (recoverableCents / monthlySpendCents) * 100 : 0,
    recoverableCents,
    recoveredCents,
    recoveredAnnualizedCents: recoveredCents * 12,
    ghostSeatCount: analyses.reduce((sum, a) => sum + a.ghostSeats.length, 0),
    zombieCount: analyses.filter((a) => a.zombie).length,
    overlapCount: analyses.filter((a) => a.overlapWasteCents > 0).length,
    idleSeatCount: activeJobs.reduce((sum, v) => sum + v.idleSeats, 0),
    shadowItCount: shadowIt.length,
    seatsPaid,
    activeUsers,
    seatUtilizationPct: seatsPaid > 0 ? (activeUsers / seatsPaid) * 100 : 0,
    avgHealthScore:
      analyses.length > 0
        ? Math.round(analyses.reduce((sum, a) => sum + a.healthScore, 0) / analyses.length)
        : 100,
    openFindings: findings.length,
    vendorCount: input.vendors.length,
  };

  /* --- inventory --------------------------------------------------------- */
  const months = [...new Set(input.transactions.map((t) => t.statementPeriod))].sort();
  const trendByVendor = new Map<number, number[]>();
  months.forEach((period) => {
    input.transactions
      .filter((t) => t.statementPeriod === period && t.vendorId !== null)
      .forEach((t) => {
        const list = trendByVendor.get(t.vendorId as number) ?? [];
        list.push(t.amountCents);
        trendByVendor.set(t.vendorId as number, list);
      });
  });

  const inventory: InventoryRow[] = analyses
    .map((a) => {
      const { grade, label } = healthGrade(a.healthScore);
      return {
        vendorId: a.vendor.id,
        vendorName: a.vendor.name,
        logoEmoji: a.vendor.logoEmoji,
        category: a.vendor.category,
        categoryGroup: a.vendor.categoryGroup,
        billingModel: a.vendor.billingModel as InventoryRow["billingModel"],
        seatsPaid: a.vendor.seatsPaid,
        activeUsers: a.activeUsers,
        ghostSeats: a.ghostSeats.length,
        idleSeats: a.vendor.idleSeats,
        monthlyCostCents: a.vendor.monthlyCostCents,
        unitCostCents: a.vendor.seatUnitCostCents,
        healthScore: a.healthScore,
        healthGrade: grade,
        healthLabel: label,
        utilizationPct: Math.round(a.utilizationPct),
        avgDaysSinceLogin: a.avgDaysSinceLogin,
        annualizedCostCents: a.vendor.monthlyCostCents * 12,
        wastedCents: a.totalWasteCents,
        wasteReason: a.wasteReason,
        renewalDate: a.vendor.renewalDate.toISOString(),
        renewalInDays: inDays(a.vendor.renewalDate, now),
        contractOwner: a.vendor.contractOwner,
        status: a.vendor.status as InventoryRow["status"],
        overlapGroup: (clusterSizeByVendorId.get(a.vendor.id) ?? 1) > 1 ? a.vendor.categoryGroup : null,
        monthsTrend: trendByVendor.get(a.vendor.id) ?? [],
      };
    })
    .sort((a, b) => b.monthlyCostCents - a.monthlyCostCents);

  /* --- waste ledger (each dollar source, labelled once) ------------------ */
  const wasteLedger: WasteLedgerRow[] = [];
  analyses.forEach((a) => {
    if (a.zombie) {
      wasteLedger.push({
        vendorId: a.vendor.id,
        vendorName: a.vendor.name,
        category: a.vendor.category,
        reason: "zombie_software",
        label: "Zero logins in 30+ days — entire subscription is idle",
        seats: a.evidence.length || a.vendor.seatsPaid,
        monthlyCents: a.zombieWasteCents,
        countedOnce: true,
      });
      return;
    }
    if (a.ghostWasteCents > 0) {
      wasteLedger.push({
        vendorId: a.vendor.id,
        vendorName: a.vendor.name,
        category: a.vendor.category,
        reason: "ghost_seats",
        label: `${a.ghostSeats.length} seat(s) held by departed or 60-day inactive users`,
        seats: a.ghostSeats.length,
        monthlyCents: a.ghostWasteCents,
        countedOnce: true,
      });
    }
    if (a.idleWasteCents > 0) {
      wasteLedger.push({
        vendorId: a.vendor.id,
        vendorName: a.vendor.name,
        category: a.vendor.category,
        reason: "idle_seats",
        label: `${a.vendor.idleSeats} paid seat(s) never provisioned`,
        seats: a.vendor.idleSeats,
        monthlyCents: a.idleWasteCents,
        countedOnce: true,
      });
    }
    if (a.overlapWasteCents > 0) {
      wasteLedger.push({
        vendorId: a.vendor.id,
        vendorName: a.vendor.name,
        category: a.vendor.category,
        reason: "duplicate_tooling",
        label: a.wasteReason ?? "Duplicate category spend",
        seats: a.evidence.length,
        monthlyCents: a.overlapWasteCents,
        countedOnce: true,
      });
    }
  });
  wasteLedger.sort((a, b) => b.monthlyCents - a.monthlyCents);

  /* --- category slices + spend trend ------------------------------------ */
  const categorySpend: CategorySlice[] = [...groupMembers.entries()]
    .map(([group, vendors]) => {
      const monthlyCents = vendors.reduce((sum, v) => sum + v.monthlyCostCents, 0);
      return {
        categoryGroup: group,
        monthlyCents,
        sharePct: monthlySpendCents > 0 ? (monthlyCents / monthlySpendCents) * 100 : 0,
        vendorCount: vendors.length,
        overlap: vendors.some((v) => (clusterSizeByVendorId.get(v.id) ?? 1) > 1),
      };
    })
    .sort((a, b) => b.monthlyCents - a.monthlyCents);

  const spendTrend = months.map((period) => {
    const rows = input.transactions.filter((t) => t.statementPeriod === period);
    const seatCents = rows
      .filter((t) => (t.vendorId ? byVendorId.get(t.vendorId)?.vendor.billingModel === "per_seat" : false))
      .reduce((sum, t) => sum + t.amountCents, 0);
    const totalCents = rows.reduce((sum, t) => sum + t.amountCents, 0);
    const [year, month] = period.split("-").map(Number);
    return {
      period,
      label: new Date(Date.UTC(year, month - 1, 1)).toLocaleString("en-US", {
        month: "short",
        timeZone: "UTC",
      }),
      totalCents,
      seatCents,
      usageCents: totalCents - seatCents,
    };
  });

  /* --- employee / transaction / SSO DTOs --------------------------------- */
  const seatStatusByEmployeeVendor = new Map<string, "active" | "revoked">();
  input.seats.forEach((s) => {
    seatStatusByEmployeeVendor.set(`${s.employeeId}|${s.vendorId}`, s.status as "active" | "revoked");
  });
  const vendorIdByAppName = new Map<string, number>();
  input.vendors.forEach((v) => vendorIdByAppName.set(v.name, v.id));

  const employeeSummaries = new Map<
    number,
    { apps: number; staleApps: number; spend: number; lastActivity: number | null }
  >();
  input.ssoEvents.forEach((row) => {
    if (row.employeeId == null) return;
    const current = employeeSummaries.get(row.employeeId) ?? { apps: 0, staleApps: 0, spend: 0, lastActivity: null };
    current.apps += 1;
    const dsl = daysSince(row.lastLoginAt, now);
    if (dsl === null || dsl > GHOST_INACTIVE_DAYS) current.staleApps += 1;
    const vendorId = vendorIdByAppName.get(row.appName);
    if (vendorId) {
      const vendor = vendorById.get(vendorId);
      const seatStatus = seatStatusByEmployeeVendor.get(`${row.employeeId}|${vendorId}`);
      if (vendor && vendor.status === "active" && seatStatus === "active") current.spend += vendor.seatUnitCostCents;
    }
    if (row.lastLoginAt && (!current.lastActivity || row.lastLoginAt.getTime() > current.lastActivity)) {
      current.lastActivity = row.lastLoginAt.getTime();
    }
    employeeSummaries.set(row.employeeId, current);
  });

  const employeeDTOs: EmployeeDTO[] = input.employees
    .map((e) => {
      const summary = employeeSummaries.get(e.id) ?? { apps: 0, staleApps: 0, spend: 0, lastActivity: null };
      return {
        id: e.id,
        fullName: e.fullName,
        email: e.email,
        department: e.department,
        jobTitle: e.jobTitle,
        status: e.status as "active" | "offboarded",
        hiredAt: e.hiredAt.toISOString(),
        offboardedAt: e.offboardedAt ? e.offboardedAt.toISOString() : null,
        appsAssigned: summary.apps,
        staleApps: summary.staleApps,
        seatSpendCents: summary.spend,
        lastActivityAt: summary.lastActivity ? new Date(summary.lastActivity).toISOString() : null,
      };
    })
    .sort((a, b) => b.seatSpendCents - a.seatSpendCents || a.fullName.localeCompare(b.fullName));

  const transactionDTOs: TransactionDTO[] = input.transactions
    .slice()
    .sort((a, b) => b.postedAt.getTime() - a.postedAt.getTime())
    .map((t) => ({
      id: t.id,
      statementPeriod: t.statementPeriod,
      postedAt: t.postedAt.toISOString(),
      merchantDescriptor: t.merchantDescriptor,
      vendorName: t.vendorId ? (vendorById.get(t.vendorId)?.name ?? null) : null,
      category: t.category,
      amountCents: t.amountCents,
      cardLast4: t.cardLast4,
      cardholderEmail: t.cardholderEmail,
      isRecurring: t.isRecurring,
      matchConfidence: t.matchConfidence,
      anomaly: t.anomaly,
    }));

  const ssoLog: SsoRecordDTO[] = input.ssoEvents
    .map((row) => {
      const employee = row.employeeId != null ? employeeById.get(row.employeeId) : undefined;
      const vendorId = vendorIdByAppName.get(row.appName);
      const vendor = vendorId ? vendorById.get(vendorId) : undefined;
      const seatStatus = vendorId && row.employeeId != null
        ? (seatStatusByEmployeeVendor.get(`${row.employeeId}|${vendorId}`) ?? "no_seat")
        : "no_seat";
      return {
        id: row.id,
        appName: row.appName,
        employeeEmail: row.employeeEmail,
        employeeName: employee?.fullName ?? "—",
        department: employee?.department ?? "—",
        employeeStatus: (employee?.status as "active" | "offboarded") ?? "active",
        lastLoginAt: row.lastLoginAt ? row.lastLoginAt.toISOString() : null,
        daysSinceLogin: daysSince(row.lastLoginAt, now),
        loginsLast30d: row.loginsLast30d,
        billed: Boolean(vendor),
        vendorName: vendor?.name ?? null,
        seatStatus: seatStatus as SsoRecordDTO["seatStatus"],
      };
    })
    .sort((a, b) => (b.daysSinceLogin ?? -1) - (a.daysSinceLogin ?? -1));

  /* --- action history --------------------------------------------------- */
  const history: AppliedActionDTO[] = input.actions
    .slice()
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .map((a) => ({
      id: a.id,
      vendorId: a.vendorId,
      vendorName: a.vendorName,
      actionType: a.actionType as AppliedActionDTO["actionType"],
      title: a.title,
      detail: a.detail,
      seatsAffected: a.seatsAffected,
      monthlySavingsCents: a.monthlySavingsCents,
      annualizedSavingsCents: a.monthlySavingsCents * 12,
      triggeredBy: a.triggeredBy,
      createdAt: a.createdAt.toISOString(),
    }));

  const snapshot: Snapshot = {
    generatedAt: now.toISOString(),
    lastIngestAt: input.lastIngestAt ? input.lastIngestAt.toISOString() : null,
    ingestDurationMs: input.ingestDurationMs,
    ingestSources: [
      {
        name: "HRIS roster export",
        format: "employees.csv (Workday style)",
        rows: input.employees.length,
        purpose: "Employment status + department, used to find seats held by leavers",
        status: "matched",
      },
      {
        name: "Corporate card / G/L statement",
        format: "transactions.json (Plaid style)",
        rows: input.transactions.length,
        purpose: "The money: recurring SaaS charges over 6 statement periods",
        status: "normalised",
      },
      {
        name: "Licence register",
        format: "seat_assignments.json (vendor admin consoles)",
        rows: input.seats.length,
        purpose: "Which employee holds which paid seat",
        status: "joined",
      },
      {
        name: "Google Workspace SSO export",
        format: "sso_events.json (admin SDK style)",
        rows: input.ssoEvents.length,
        purpose: "last_login_at + logins_last_30d per employee per app",
        status: "enriched",
      },
    ],
    detectionRules: [
      {
        name: "Ghost Seat Detector",
        rule: "Billed seat where the holder is offboarded OR sso.last_login_at is older than 60 days",
        threshold: `inactivity > ${GHOST_INACTIVE_DAYS} days or employment_status = offboarded`,
        severity: "high",
      },
      {
        name: "Zombie Software Detector",
        rule: "Charged subscription where every seat has logins_last_30d = 0",
        threshold: `max(logins_last_30d) = 0 AND min(days_since_login) >= ${ZOMBIE_INACTIVE_DAYS}`,
        severity: "critical",
      },
      {
        name: "Overlap Duplication Detector",
        rule: "2+ active vendors in one normalised category cluster (aliased peers included, e.g. Error Monitoring vs Observability); lowest-adoption tool flagged",
        threshold: `>= 2 vendors per category cluster AND flagged vendor monthly cost >= $${(OVERLAP_MIN_COST_CENTS / 100).toFixed(0)}`,
        severity: "medium",
      },
      {
        name: "Idle Seat Detector",
        rule: "Paid seats that never appear in the licence register",
        threshold: "seats_paid - count(active seat_assignments) > 0",
        severity: "medium",
      },
      {
        name: "Shadow IT Detector",
        rule: "SSO app with logins but no matching card transaction",
        threshold: "sso app not matched to any vendor descriptor",
        severity: "low",
      },
    ],
    metrics,
    findings,
    history,
    inventory,
    wasteLedger,
    categorySpend,
    spendTrend,
    employees: employeeDTOs,
    transactions: transactionDTOs,
    ssoLog,
    shadowIt,
  };

  return { snapshot };
}

export { healthGrade };
