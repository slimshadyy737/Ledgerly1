/**
 * ---------------------------------------------------------------------------
 * LEDGERLY — derived view models (pure functions, no React, no fetch)
 * ---------------------------------------------------------------------------
 * All detection presentation, savings attribution and table shaping happens
 * here so the UI components stay purely presentational and the numbers stay
 * consistent across every page.
 *
 * SAVINGS ACCOUNTING RULES ENFORCED HERE
 *  1. Every dollar of identified waste is attributed to exactly ONE opportunity.
 *     A zombie subscription claims its entire invoice, so its dead seats are not
 *     also offered as "reclaim" rows (the SQL engine applies the same rule).
 *  2. `identifiedMonthlyCents` therefore equals the analytics engine's waste
 *     figure — asserted by `assertSavingsIntegrity()` and surfaced in the UI.
 *  3. Realized (simulated) savings come from the audit ledger and are never
 *     mixed with identified savings.
 *  4. Missing login telemetry is labelled "no login recorded" and marked
 *     unverified rather than treated as confirmed inactivity.
 */
import type {
  AnalyticsResponse,
  DuplicateCategoryDTO,
  OptimizationEventDTO,
  StaleLicenseDTO,
  SubscriptionDTO,
  WasteOffenderDTO,
} from "@/lib/spend/types";
import type { Snapshot } from "@/lib/types";

/* --------------------------------- types --------------------------------- */

export type Severity = "critical" | "high" | "medium" | "low";

export type OpportunityKind =
  | "offboarded_holder"
  | "ghost_seats"
  | "zombie_software"
  | "overlap_duplication"
  | "idle_seats"
  | "cost_review";

export type OpportunityAction = "reclaim_seats" | "cancel" | "consolidate" | "review";

export interface EvidenceSeat {
  employee: string;
  email: string;
  department: string;
  employmentStatus: "active" | "terminated";
  seatStatus: "active" | "revoked";
  lastLoginAt: string | null;
  daysSinceLogin: number | null;
  loginsLast30d: number;
  seatCostCents: number;
  reason: "offboarded_holder" | "never_logged_in" | "inactive_beyond_window";
  verified: boolean;
}

export interface Opportunity {
  id: string;
  kind: OpportunityKind;
  severity: Severity;
  vendorId: number | null;
  vendor: string;
  category: string;
  title: string;
  explanation: string;
  calculation: string;
  rule: string;
  seatsAffected: number;
  monthlyCents: number;
  annualCents: number;
  confidence: number;
  recommendedAction: string;
  action: OpportunityAction;
  evidence: EvidenceSeat[];
  unverifiedCount: number;
}

export interface InventoryRow {
  id: number;
  vendor: string;
  category: string;
  categoryGroup: string;
  billingModel: SubscriptionDTO["billingModel"];
  status: SubscriptionDTO["status"];
  seatsPaid: number;
  activeSeats: number;
  staleSeats: number;
  idleSeats: number;
  utilizationPct: number;
  monthlyCostCents: number;
  annualizedCostCents: number;
  unitCostCents: number;
  wasteCents: number;
  healthScore: number;
  healthGrade: "A" | "B" | "C" | "D" | "F";
  renewalInDays: number | null;
  renewalDate: string | null;
  contractOwner: string;
  isZombie: boolean;
  isDuplicate: boolean;
  duplicateGroup: string | null;
  openFindings: number;
  lastActivityDays: number | null;
}

export interface TeamRow {
  id: number;
  name: string;
  email: string;
  department: string;
  title: string;
  employmentStatus: "active" | "offboarded";
  offboardedAt: string | null;
  appsAssigned: number;
  staleApps: number;
  seatSpendCents: number;
  lastActivityAt: string | null;
  lastActivityDays: number | null;
  tools: { app: string; lastLoginAt: string | null; daysSinceLogin: number | null; loginsLast30d: number }[];
}

export interface VendorProfile {
  id: number;
  vendor: string;
  product: string | null;
  category: string;
  categoryGroup: string;
  billingModel: SubscriptionDTO["billingModel"];
  status: SubscriptionDTO["status"];
  monthlyCostCents: number;
  annualizedCostCents: number;
  unitCostCents: number;
  seatsPaid: number;
  activeSeats: number;
  staleSeats: number;
  idleSeats: number;
  utilizationPct: number;
  healthScore: number;
  renewalDate: string | null;
  renewalInDays: number | null;
  startedAt: string | null;
  contractOwner: string;
  wasteCents: number;
  opportunityIds: string[];
  monthlyTrend: number[];
}

export interface Metrics {
  monthlySpendCents: number;
  annualizedSpendCents: number;
  identifiedSavingsCents: number;
  identifiedSavingsAnnualCents: number;
  realizedSavingsCents: number;
  realizedSavingsAnnualCents: number;
  activeSubscriptions: number;
  retiredSubscriptions: number;
  seatUtilizationPct: number;
  seatsPaid: number;
  activeSeats: number;
  unattachedSeats: number;
  averageHealthScore: number;
  ghostSeats: number;
  zombieTools: number;
  overlappingVendors: number;
  idleSeats: number;
  openOpportunityCount: number;
  wasteRatePct: number;
}

export interface TrendPoint {
  period: string;
  label: string;
  totalCents: number;
  seatCents: number;
  usageCents: number;
}

export interface LedgerInput {
  analytics: AnalyticsResponse;
  subscriptions: SubscriptionDTO[];
  audit: OptimizationEventDTO[];
  sandbox: Snapshot | null;
  dismissedIds: string[];
}

/* ------------------------------- utilities -------------------------------- */

export function healthGrade(score: number): InventoryRow["healthGrade"] {
  if (score >= 85) return "A";
  if (score >= 70) return "B";
  if (score >= 55) return "C";
  if (score >= 40) return "D";
  return "F";
}

export function healthLabel(score: number): string {
  if (score >= 85) return "Healthy";
  if (score >= 70) return "Monitor";
  if (score >= 55) return "Review";
  if (score >= 40) return "At risk";
  return "Critical";
}

function severityFor(cents: number, base: Severity): Severity {
  if (base === "critical") return "critical";
  if (cents >= 40_000) return "critical";
  if (cents >= 15_000) return "high";
  return base;
}

export function daysBetween(iso: string | null, reference: Date): number | null {
  if (!iso) return null;
  const value = new Date(iso).getTime();
  if (Number.isNaN(value)) return null;
  return Math.max(0, Math.floor((reference.getTime() - value) / 86_400_000));
}

/* ------------------------------ opportunities ----------------------------- */

function toEvidence(row: StaleLicenseDTO, reference: Date): EvidenceSeat {
  return {
    employee: row.userName,
    email: row.userEmail,
    department: row.department,
    employmentStatus: row.userStatus,
    seatStatus: "active",
    lastLoginAt: row.lastLoginAt,
    daysSinceLogin: row.daysSinceLogin,
    loginsLast30d: row.loginsLast30d,
    seatCostCents: row.seatCostCents,
    reason: row.reason,
    // "never_logged_in" means telemetry is missing, which is not the same as a
    // measured period of inactivity — flagged so the UI can say so.
    verified: row.reason !== "never_logged_in",
  };
}

function groupStale(rows: StaleLicenseDTO[]): Map<number, StaleLicenseDTO[]> {
  const grouped = new Map<number, StaleLicenseDTO[]>();
  rows.forEach((row) => {
    const list = grouped.get(row.subscriptionId) ?? [];
    list.push(row);
    grouped.set(row.subscriptionId, list);
  });
  return grouped;
}

/**
 * Builds the ranked opportunity feed. Sorted by financial impact, then severity.
 */
export function buildOpportunities(input: LedgerInput, reference = new Date()): Opportunity[] {
  const { analytics } = input;
  const opportunities: Opportunity[] = [];
  const window = analytics.windows.staleLicenseDays;

  const zombieVendorIds = new Set(
    analytics.topWasteOffenders.filter((offender) => offender.isZombie).map((offender) => offender.subscriptionId),
  );

  /* ---- kind: former employee still holds a licence --------------------- */
  groupStale(analytics.staleLicences).forEach((rows, subscriptionId) => {
    // A zombie contract already claims its whole invoice, so its leaver seats
    // must not be offered again as a separate reclaim (one dollar, one finding).
    if (zombieVendorIds.has(subscriptionId)) return;
    const offboarded = rows.filter((row) => row.reason === "offboarded_holder");
    if (offboarded.length === 0) return;
    const cost = offboarded.reduce((sum, row) => sum + row.seatCostCents, 0);
    if (cost <= 0) return;
    const vendor = offboarded[0];

    opportunities.push({
      id: `offboarded-${subscriptionId}`,
      kind: "offboarded_holder",
      severity: severityFor(cost, "high"),
      vendorId: subscriptionId,
      vendor: vendor.vendorName,
      category: vendor.categoryGroup,
      title: `${offboarded.length} licence${offboarded.length === 1 ? "" : "s"} still assigned to former employees`,
      explanation:
        `HR marked ${offboarded.length} ${offboarded.length === 1 ? "person" : "people"} as offboarded on this ` +
        `platform, but the paid seat was never released. The last recorded login predates their departure, so the ` +
        `licence is billable and unused.`,
      calculation: `${offboarded.length} seat${offboarded.length === 1 ? "" : "s"} × ${fmtCents(vendor.seatCostCents)} per seat per month = ${fmtCents(cost)}/month`,
      rule: "users.status = 'terminated' AND seat_mappings.status = 'active'",
      seatsAffected: offboarded.length,
      monthlyCents: cost,
      annualCents: cost * 12,
      confidence: 0.97,
      recommendedAction: `Reclaim ${offboarded.length} seat${offboarded.length === 1 ? "" : "s"} and revoke portal access`,
      action: "reclaim_seats",
      evidence: offboarded.map((row) => toEvidence(row, reference)),
      unverifiedCount: 0,
    });
  });

  /* ---- kind: ghost seats (inactive beyond the tenant window) ----------- */
  groupStale(analytics.staleLicences).forEach((rows, subscriptionId) => {
    if (zombieVendorIds.has(subscriptionId)) return; // handled by the zombie finding
    const inactive = rows.filter((row) => row.reason !== "offboarded_holder");
    if (inactive.length === 0) return;
    const cost = inactive.reduce((sum, row) => sum + row.seatCostCents, 0);
    if (cost <= 0) return;

    const first = inactive[0];
    const measured = inactive.filter((row) => row.reason === "inactive_beyond_window");
    const unverified = inactive.length - measured.length;
    const worst = Math.max(...measured.map((row) => row.daysSinceLogin ?? 0), 0);

    opportunities.push({
      id: `ghost-${subscriptionId}`,
      kind: "ghost_seats",
      severity: severityFor(cost, "high"),
      vendorId: subscriptionId,
      vendor: first.vendorName,
      category: first.categoryGroup,
      title: `${inactive.length} inactive ${first.vendorName} seat${inactive.length === 1 ? "" : "s"} detected`,
      explanation:
        `These seats belong to active employees whose last recorded authentication is older than ${window} days` +
        `${worst > 0 ? ` (longest inactivity: ${worst} days)` : ""}. ` +
        (unverified > 0
          ? `${unverified} seat${unverified === 1 ? "" : "s"} have no login telemetry at all, which counts as a ` +
            `suspected ghost seat rather than a measured one.`
          : `Every seat here has measured inactivity beyond the threshold.`),
      calculation: `${inactive.length} seat${inactive.length === 1 ? "" : "s"} × ${fmtCents(first.seatCostCents)} = ${fmtCents(cost)}/month`,
      rule: `seat_mappings.last_login_at < now() - ${window}d OR last_login_at IS NULL`,
      seatsAffected: inactive.length,
      monthlyCents: cost,
      annualCents: cost * 12,
      confidence: unverified === inactive.length ? 0.74 : 0.93,
      recommendedAction: `Reclaim ${inactive.length} seat${inactive.length === 1 ? "" : "s"} after notifying the owners`,
      action: "reclaim_seats",
      evidence: inactive
        .map((row) => toEvidence(row, reference))
        .sort((a, b) => (b.daysSinceLogin ?? -1) - (a.daysSinceLogin ?? -1)),
      unverifiedCount: unverified,
    });
  });

  /* ---- kind: zombie software ------------------------------------------- */
  analytics.topWasteOffenders
    .filter((offender) => offender.isZombie)
    .forEach((offender) => {
      opportunities.push({
        id: `zombie-${offender.subscriptionId}`,
        kind: "zombie_software",
        severity: "critical",
        vendorId: offender.subscriptionId,
        vendor: offender.vendorName,
        category: offender.categoryGroup,
        title: `${offender.vendorName} billed with no employee logins`,
        explanation:
          `Every one of the ${offender.seatsPaid} seats is silent: no authentication recorded in the last ` +
          `${analytics.windows.activeSeatDays} days. The subscription keeps clearing the corporate card, so the whole ` +
          `invoice is treated as waste rather than just the idle seats.`,
        calculation: `Entire contract: ${fmtCents(offender.monthlyCents)}/month (${offender.seatsPaid} seats × ${fmtCents(
          Math.round(offender.monthlyCents / Math.max(offender.seatsPaid, 1)),
        )})`,
        rule: `max(logins_last_30d) = 0 AND min(days_since_login) >= ${analytics.windows.activeSeatDays}d`,
        seatsAffected: offender.seatsPaid,
        monthlyCents: offender.wasteCents,
        annualCents: offender.wasteCents * 12,
        confidence: 0.96,
        recommendedAction: `Cancel the contract and revoke all ${offender.seatsPaid} seats`,
        action: "cancel",
        evidence: analytics.staleLicences
          .filter((row) => row.subscriptionId === offender.subscriptionId)
          .map((row) => toEvidence(row, reference)),
        unverifiedCount: 0,
      });
    });

  /* ---- kind: idle seats (paid, never provisioned) --------------------- */
  analytics.topWasteOffenders
    .filter((offender) => !offender.isZombie && offender.wasteSources.idleSeatsCents > 0)
    .forEach((offender) => {
      opportunities.push({
        id: `idle-${offender.subscriptionId}`,
        kind: "idle_seats",
        severity: "medium",
        vendorId: offender.subscriptionId,
        vendor: offender.vendorName,
        category: offender.categoryGroup,
        title: `${offender.idleSeats} paid seat${offender.idleSeats === 1 ? "" : "s"} never provisioned`,
        explanation:
          `The invoice covers ${offender.seatsPaid} seats but the licence register only contains ` +
          `${offender.seatsPaid - offender.idleSeats}. Capacity is being purchased with nobody attached to it.`,
        calculation: `${offender.idleSeats} seat${offender.idleSeats === 1 ? "" : "s"} × ${fmtCents(
          Math.round(offender.wasteSources.idleSeatsCents / Math.max(offender.idleSeats, 1)),
        )} = ${fmtCents(offender.wasteSources.idleSeatsCents)}/month`,
        rule: "subscriptions.seats_paid - count(active seat_mappings) > 0",
        seatsAffected: offender.idleSeats,
        monthlyCents: offender.wasteSources.idleSeatsCents,
        annualCents: offender.wasteSources.idleSeatsCents * 12,
        confidence: 0.9,
        recommendedAction: `Downgrade the licence by ${offender.idleSeats} seats at renewal`,
        action: "reclaim_seats",
        evidence: [],
        unverifiedCount: 0,
      });
    });

  /* ---- kind: overlap duplication -------------------------------------- */
  analytics.duplicateCategories.forEach((group: DuplicateCategoryDTO) => {
    if (group.duplicateWasteCents <= 0) return;
    const incumbent = group.vendors.find((vendor) => vendor.isIncumbent);
    const offender = group.vendors.find((vendor) => vendor.isDuplicateCandidate);
    if (!offender || zombieVendorIds.has(offender.subscriptionId)) return;

    opportunities.push({
      id: `overlap-${offender.subscriptionId}`,
      kind: "overlap_duplication",
      severity: severityFor(group.duplicateWasteCents, "medium"),
      vendorId: offender.subscriptionId,
      vendor: offender.vendorName,
      category: group.categoryGroup,
      title: `${offender.vendorName} overlaps ${incumbent?.vendorName ?? "another tool"}`,
      explanation:
        `You pay for ${group.vendorCount} platforms in "${group.categoryGroup}" (${fmtCents(
          group.categoryMonthlyCents,
        )}/month combined). ${offender.vendorName} holds ${offender.healthySeats} active of ${offender.seatsPaid} seats` +
        `${offender.adoptionPct === null ? "" : ` (${offender.adoptionPct}% adoption)`}, while ${incumbent?.vendorName ?? "the incumbent"} already covers the same job.`,
      calculation: `Remaining duplicate spend = ${fmtCents(offender.monthlyCents)} − ${fmtCents(
        offender.monthlyCents - group.duplicateWasteCents,
      )} already counted elsewhere = ${fmtCents(group.duplicateWasteCents)}/month`,
      rule: "ROW_NUMBER() OVER (PARTITION BY category_group ORDER BY adoption DESC, cost DESC) > 1",
      seatsAffected: offender.seatsPaid,
      monthlyCents: group.duplicateWasteCents,
      annualCents: group.duplicateWasteCents * 12,
      confidence: 0.87,
      recommendedAction: `Migrate users to ${incumbent?.vendorName ?? "the incumbent"} and retire the contract`,
      action: "consolidate",
      evidence: [],
      unverifiedCount: 0,
    });
  });

  /* ---- kind: high-cost contracts needing review (no savings attributed) - */
  const alreadyFlagged = new Set(opportunities.map((item) => item.vendorId).filter((id): id is number => id !== null));
  analytics.topWasteOffenders
    .filter((offender) => !alreadyFlagged.has(offender.subscriptionId) && offender.monthlyCents >= 100_000)
    .forEach((offender) => {
      opportunities.push({
        id: `review-${offender.subscriptionId}`,
        kind: "cost_review",
        severity: "low",
        vendorId: offender.subscriptionId,
        vendor: offender.vendorName,
        category: offender.categoryGroup,
        title: `${offender.vendorName} is a top spend line worth a renewal review`,
        explanation:
          `${fmtCents(offender.monthlyCents)}/month with ${offender.activeSeats} of ${offender.seatsPaid} seats active. ` +
          `No waste is confirmed on this contract, but it is large enough that renegotiating tier or term is worth a ` +
          `finance conversation before renewal.`,
        calculation: `No savings attributed — review item only (${fmtCents(offender.monthlyCents)}/month at stake)`,
        rule: "monthly_cost >= $1,000 AND no confirmed detector hit",
        seatsAffected: offender.seatsPaid,
        monthlyCents: 0,
        annualCents: 0,
        confidence: 0.6,
        recommendedAction: "Schedule a renewal review with the contract owner",
        action: "review",
        evidence: [],
        unverifiedCount: 0,
      });
    });

  const severityRank: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  return opportunities.sort(
    (a, b) =>
      b.monthlyCents - a.monthlyCents ||
      severityRank[a.severity] - severityRank[b.severity] ||
      a.vendor.localeCompare(b.vendor),
  );
}

function fmtCents(cents: number): string {
  return `$${(Math.round(cents) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/* -------------------------------- inventory ------------------------------- */

export function buildInventory(input: LedgerInput, reference = new Date()): InventoryRow[] {
  const { analytics, subscriptions } = input;
  const offenders = new Map<number, WasteOffenderDTO>(
    analytics.topWasteOffenders.map((row) => [row.subscriptionId, row]),
  );
  const duplicateGroups = new Map<number, string>();
  analytics.duplicateCategories.forEach((group) =>
    group.vendors
      .filter((vendor) => vendor.isDuplicateCandidate)
      .forEach((vendor) => duplicateGroups.set(vendor.subscriptionId, group.categoryGroup)),
  );
  const findingsByVendor = new Map<number, number>();
  buildOpportunities(input, reference)
    .filter((item) => item.action !== "review")
    .forEach((item) => {
      if (item.vendorId === null) return;
      findingsByVendor.set(item.vendorId, (findingsByVendor.get(item.vendorId) ?? 0) + 1);
    });

  return subscriptions
    .map<InventoryRow>((vendor) => {
      const offender = offenders.get(vendor.id);
      const utilizationPct = vendor.seatsPaid > 0 ? Math.round((vendor.seats.active / vendor.seatsPaid) * 100) : 100;
      return {
        id: vendor.id,
        vendor: vendor.vendor,
        category: vendor.category,
        categoryGroup: vendor.categoryGroup,
        billingModel: vendor.billingModel,
        status: vendor.status,
        seatsPaid: vendor.seatsPaid,
        activeSeats: vendor.seats.active,
        staleSeats: vendor.seats.stale,
        idleSeats: vendor.seats.idle,
        utilizationPct,
        monthlyCostCents: vendor.monthlyCostCents,
        annualizedCostCents: vendor.annualizedCostCents,
        unitCostCents: vendor.unitCostCents,
        wasteCents: offender?.wasteCents ?? 0,
        healthScore: vendor.healthScore,
        healthGrade: healthGrade(vendor.healthScore),
        renewalInDays: vendor.daysUntilRenewal,
        renewalDate: vendor.nextRenewalAt,
        contractOwner: vendor.contractOwner ?? "unassigned",
        isZombie: vendor.isZombie,
        isDuplicate: duplicateGroups.has(vendor.id),
        duplicateGroup: duplicateGroups.get(vendor.id) ?? null,
        openFindings: findingsByVendor.get(vendor.id) ?? 0,
        lastActivityDays: vendor.seats.averageDaysSinceLogin,
      };
    })
    .sort((a, b) => b.wasteCents - a.wasteCents || b.monthlyCostCents - a.monthlyCostCents);
}

/* --------------------------------- metrics -------------------------------- */

export function buildMetrics(input: LedgerInput, opportunities: Opportunity[]): Metrics {
  const { analytics, audit } = input;
  const identified = opportunities.reduce((sum, item) => sum + item.monthlyCents, 0);
  const realized = audit.reduce((sum, event) => sum + event.savingsCents, 0);
  const detectorHits = (id: string) => analytics.detectors.find((detector) => detector.id === id)?.hits ?? 0;

  return {
    monthlySpendCents: analytics.totalSpend.monthlyCents,
    annualizedSpendCents: analytics.totalSpend.annualizedCents,
    identifiedSavingsCents: identified,
    identifiedSavingsAnnualCents: identified * 12,
    realizedSavingsCents: realized,
    realizedSavingsAnnualCents: realized * 12,
    activeSubscriptions: analytics.estate.subscriptionsActive,
    retiredSubscriptions: analytics.estate.subscriptionsCancelled + analytics.estate.subscriptionsConsolidated,
    seatUtilizationPct: analytics.totalSpend.seatUtilisationPct,
    seatsPaid: analytics.totalSpend.seatsPaid,
    activeSeats: analytics.totalSpend.activeSeats,
    unattachedSeats: Math.max(analytics.totalSpend.seatsPaid - analytics.totalSpend.activeSeats, 0),
    averageHealthScore: analytics.totalSpend.averageHealthScore,
    ghostSeats: detectorHits("STALE_LICENSE"),
    zombieTools: detectorHits("ZOMBIE_SOFTWARE"),
    overlappingVendors: analytics.totalWaste.duplicateVendorCount,
    idleSeats: detectorHits("IDLE_SEAT"),
    openOpportunityCount: opportunities.filter((item) => item.action !== "review").length,
    wasteRatePct: analytics.totalWaste.wasteRatePct,
  };
}

/** Guard used by the UI banner: identified savings must equal engine waste. */
export function assertSavingsIntegrity(metrics: Metrics, analytics: AnalyticsResponse) {
  const delta = metrics.identifiedSavingsCents - analytics.totalWaste.monthlyCents;
  return { balanced: delta === 0, deltaCents: delta };
}

/* ---------------------------------- team ---------------------------------- */

export function buildTeam(sandbox: Snapshot | null, reference = new Date()): TeamRow[] {
  if (!sandbox) return [];
  const toolsByEmail = new Map<string, TeamRow["tools"]>();
  sandbox.ssoLog.forEach((row) => {
    const list = toolsByEmail.get(row.employeeEmail) ?? [];
    list.push({
      app: row.appName,
      lastLoginAt: row.lastLoginAt,
      daysSinceLogin: row.daysSinceLogin,
      loginsLast30d: row.loginsLast30d,
    });
    toolsByEmail.set(row.employeeEmail, list);
  });

  return sandbox.employees
    .map<TeamRow>((employee) => ({
      id: employee.id,
      name: employee.fullName,
      email: employee.email,
      department: employee.department,
      title: employee.jobTitle,
      employmentStatus: employee.status === "offboarded" ? "offboarded" : "active",
      offboardedAt: employee.offboardedAt,
      appsAssigned: employee.appsAssigned,
      staleApps: employee.staleApps,
      seatSpendCents: employee.seatSpendCents,
      lastActivityAt: employee.lastActivityAt,
      lastActivityDays: daysBetween(employee.lastActivityAt, reference),
      tools: (toolsByEmail.get(employee.email) ?? []).sort(
        (a, b) => (b.daysSinceLogin ?? 9999) - (a.daysSinceLogin ?? 9999),
      ),
    }))
    .sort((a, b) => b.seatSpendCents - a.seatSpendCents || a.name.localeCompare(b.name));
}

/* --------------------------------- vendors -------------------------------- */

export function buildVendors(
  input: LedgerInput,
  opportunities: Opportunity[],
  reference = new Date(),
): VendorProfile[] {
  const { subscriptions, sandbox } = input;
  const trendByVendor = new Map<string, number[]>();
  if (sandbox) {
    const periods = [...new Set(sandbox.transactions.map((row) => row.statementPeriod))].sort();
    periods.forEach((period) => {
      const rows = sandbox.transactions.filter((row) => row.statementPeriod === period && row.vendorName);
      rows.forEach((row) => {
        const key = (row.vendorName ?? "").toLowerCase();
        const list = trendByVendor.get(key) ?? [];
        list.push(row.amountCents);
        trendByVendor.set(key, list);
      });
    });
  }
  void reference;

  return subscriptions
    .map<VendorProfile>((vendor) => {
      const related = opportunities.filter((item) => item.vendorId === vendor.id);
      const waste = related.reduce((sum, item) => sum + item.monthlyCents, 0);
      const key = vendor.vendor.toLowerCase();
      const trend =
        [...trendByVendor.entries()].find(([name]) => key.includes(name.slice(0, 6)) || name.includes(key.slice(0, 6)))?.[1] ??
        [];
      return {
        id: vendor.id,
        vendor: vendor.vendor,
        product: vendor.product,
        category: vendor.category,
        categoryGroup: vendor.categoryGroup,
        billingModel: vendor.billingModel,
        status: vendor.status,
        monthlyCostCents: vendor.monthlyCostCents,
        annualizedCostCents: vendor.annualizedCostCents,
        unitCostCents: vendor.unitCostCents,
        seatsPaid: vendor.seatsPaid,
        activeSeats: vendor.seats.active,
        staleSeats: vendor.seats.stale,
        idleSeats: vendor.seats.idle,
        utilizationPct: vendor.seatsPaid > 0 ? Math.round((vendor.seats.active / vendor.seatsPaid) * 100) : 100,
        healthScore: vendor.healthScore,
        renewalDate: vendor.nextRenewalAt,
        renewalInDays: vendor.daysUntilRenewal,
        startedAt: vendor.startedAt,
        contractOwner: vendor.contractOwner ?? "unassigned",
        wasteCents: waste,
        opportunityIds: related.map((item) => item.id),
        monthlyTrend: trend,
      };
    })
    .sort((a, b) => b.monthlyCostCents - a.monthlyCostCents);
}

/* --------------------------------- reports -------------------------------- */

export interface ReportPayload {
  generatedAt: string;
  company: AnalyticsResponse["company"];
  windows: AnalyticsResponse["windows"];
  metrics: Metrics;
  integrity: { balanced: boolean; deltaCents: number };
  opportunities: Opportunity[];
  realized: OptimizationEventDTO[];
  categories: AnalyticsResponse["categorySpend"];
  detectors: AnalyticsResponse["detectors"];
}

export function buildReport(input: LedgerInput, opportunities: Opportunity[], metrics: Metrics): ReportPayload {
  return {
    generatedAt: new Date().toISOString(),
    company: input.analytics.company,
    windows: input.analytics.windows,
    metrics,
    integrity: assertSavingsIntegrity(metrics, input.analytics),
    opportunities,
    realized: input.audit,
    categories: input.analytics.categorySpend,
    detectors: input.analytics.detectors,
  };
}

/* ------------------------------- trend series ----------------------------- */

export function buildTrend(sandbox: Snapshot | null, months: number): TrendPoint[] {
  if (!sandbox) return [];
  return sandbox.spendTrend.slice(-months).map((point) => ({
    period: point.period,
    label: point.label,
    totalCents: point.totalCents,
    seatCents: point.seatCents,
    usageCents: point.usageCents,
  }));
}

/* ------------------------------ concentration ----------------------------- */

export function concentration(analytics: AnalyticsResponse) {
  const sorted = [...analytics.categorySpend].sort((a, b) => b.monthlyCents - a.monthlyCents);
  const total = sorted.reduce((sum, slice) => sum + slice.monthlyCents, 0) || 1;
  const top3 = sorted.slice(0, 3).reduce((sum, slice) => sum + slice.monthlyCents, 0);
  const topVendor = analytics.topWasteOffenders[0];
  return {
    categories: sorted,
    totalCents: total,
    top3SharePct: (top3 / total) * 100,
    largestCategory: sorted[0] ?? null,
    largestVendorSpend: topVendor?.monthlyDisplay ?? "—",
  };
}

/* ---------------------------- detector narratives -------------------------- */

export const DETECTOR_COPY: Record<string, { name: string; plain: string }> = {
  STALE_LICENSE: {
    name: "Ghost seats",
    plain: "A paid seat whose holder left the company, or has not authenticated for longer than the window.",
  },
  ZOMBIE_SOFTWARE: {
    name: "Zombie software",
    plain: "A subscription where nobody has logged in for 30 days, while the invoice keeps being charged.",
  },
  DUPLICATE_CATEGORY: {
    name: "Overlap duplication",
    plain: "Two or more paid platforms in one software category where a single tool would cover the job.",
  },
  IDLE_SEAT: {
    name: "Idle capacity",
    plain: "Seats that are invoiced but never appear in the licence register — bought capacity with no owner.",
  },
};

export function severityTheme(severity: Severity) {
  switch (severity) {
    case "critical":
      return { text: "text-crit", bg: "bg-crit/12", ring: "ring-crit/30", label: "Critical" };
    case "high":
      return { text: "text-warn", bg: "bg-warn/12", ring: "ring-warn/30", label: "High" };
    case "medium":
      return { text: "text-info", bg: "bg-info/12", ring: "ring-info/30", label: "Medium" };
    default:
      return { text: "text-ink-2", bg: "bg-ink-3/12", ring: "ring-line", label: "Low" };
  }
}

export function kindLabel(kind: OpportunityKind): string {
  switch (kind) {
    case "offboarded_holder":
      return "Former employee";
    case "ghost_seats":
      return "Ghost seats";
    case "zombie_software":
      return "Zombie software";
    case "overlap_duplication":
      return "Duplicate platform";
    case "idle_seats":
      return "Idle capacity";
    default:
      return "Renewal review";
  }
}
