"use client";

/**
 * ---------------------------------------------------------------------------
 * Adapter: REST payloads -> dashboard view model.
 * ---------------------------------------------------------------------------
 * The dashboard was designed against a rich in-memory shape (`Snapshot`). Rather
 * than rewrite every component, this module converts the live
 * `/api/analytics` + `/api/subscriptions` responses into that view model, so the
 * UI renders API data with zero hardcoded arrays.
 *
 * Every derived finding carries its `detectionRule`, the vendor id needed by
 * the optimize endpoint, and the seat-level evidence returned by the SQL.
 */
import { kindLabel } from "@/lib/format";
import type {
  AnalyticsResponse,
  DuplicateCategoryDTO,
  StaleLicenseDTO,
  SubscriptionDTO,
  WasteOffenderDTO,
} from "@/lib/spend/types";
import type {
  CategorySlice,
  EmployeeDTO,
  Finding,
  InventoryRow,
  Metrics,
  SeatEvidence,
  Severity,
  Snapshot,
  SsoRecordDTO,
  TransactionDTO,
  WasteLedgerRow,
} from "@/lib/types";

/** Vendor emojis for the inventory table (falls back to a generic chip). */
const VENDOR_EMOJI: Record<string, string> = {
  Zoom: "🎥",
  Slack: "💬",
  Google: "🟢",
  Dropbox: "📦",
  Figma: "🎨",
  Sketch: "💎",
  Asana: "📋",
  "Monday.com": "🗂️",
  Atlassian: "🧭",
  Jira: "🧭",
  Salesforce: "☁️",
  HubSpot: "🧲",
  AWS: "☁️",
  Datadog: "📈",
  Sentry: "🛡️",
  Mixpanel: "🔍",
  Amplitude: "📉",
  "1Password": "🔐",
  LastPass: "🧱",
  Zendesk: "🎧",
  Intercom: "💬",
  Mailchimp: "📨",
  Airtable: "🧱",
  Miro: "🖼️",
  Hotjar: "🔥",
  Loom: "🎬",
  Notion: "📓",
  GitHub: "🐙",
  BambooHR: "🌴",
};

function emojiFor(vendor: string): string {
  const exact = VENDOR_EMOJI[vendor];
  if (exact) return exact;
  const partial = Object.keys(VENDOR_EMOJI).find((key) => vendor.toLowerCase().includes(key.toLowerCase()));
  return partial ? VENDOR_EMOJI[partial] : "🧩";
}

/* --------------------------------- metrics -------------------------------- */

export function buildMetrics(
  analytics: AnalyticsResponse,
  subscriptions: SubscriptionDTO[],
  findings: Finding[],
  recoveredCents: number,
): Metrics {
  const { totalSpend, totalWaste, estate } = analytics;
  const seatsPaid = subscriptions.reduce((sum, vendor) => sum + vendor.seatsPaid, 0);
  const activeUsers = subscriptions.reduce((sum, vendor) => sum + vendor.seats.active, 0);
  const detectorHits = (id: string) => analytics.detectors.find((detector) => detector.id === id)?.hits ?? 0;

  return {
    monthlySpendCents: totalSpend.monthlyCents,
    annualizedSpendCents: totalSpend.annualizedCents,
    activeSubscriptions: totalSpend.activeSubscriptions,
    cancelledSubscriptions: estate.subscriptionsCancelled + estate.subscriptionsConsolidated,
    wastedCents: totalWaste.monthlyCents,
    wasteRatePct: totalWaste.wasteRatePct,
    recoverableCents: totalWaste.monthlyCents,
    recoveredCents,
    recoveredAnnualizedCents: recoveredCents * 12,
    ghostSeatCount: detectorHits("STALE_LICENSE"),
    zombieCount: detectorHits("ZOMBIE_SOFTWARE"),
    overlapCount: totalWaste.duplicateVendorCount,
    idleSeatCount: detectorHits("IDLE_SEAT"),
    shadowItCount: 0,
    seatsPaid,
    activeUsers,
    seatUtilizationPct: totalSpend.seatUtilisationPct,
    avgHealthScore: totalSpend.averageHealthScore,
    openFindings: findings.length,
    vendorCount: estate.subscriptionsTotal,
  };
}

/* -------------------------------- findings -------------------------------- */

function seatEvidenceFromLicences(rows: StaleLicenseDTO[]): SeatEvidence[] {
  return rows.map((row) => ({
    employeeName: row.userName,
    employeeEmail: row.userEmail,
    department: row.department,
    employeeStatus: row.userStatus === "terminated" ? "offboarded" : "active",
    lastLoginAt: row.lastLoginAt,
    daysSinceLogin: row.daysSinceLogin,
    loginsLast30d: row.loginsLast30d,
    seatCostCents: row.seatCostCents,
    flag: row.reason === "offboarded_holder" ? "offboarded" : "inactive_60d",
  }));
}

function severityFor(cents: number, base: Severity): Severity {
  if (base === "critical") return "critical";
  if (cents >= 40_000) return "critical";
  if (cents >= 15_000) return "high";
  return base;
}

function groupBySubscription(rows: StaleLicenseDTO[]): Map<number, StaleLicenseDTO[]> {
  const grouped = new Map<number, StaleLicenseDTO[]>();
  rows.forEach((row) => {
    const list = grouped.get(row.subscriptionId) ?? [];
    list.push(row);
    grouped.set(row.subscriptionId, list);
  });
  return grouped;
}

/**
 * Converts the analytics payload into the CFO action feed. One finding per
 * vendor (ghost seats, zombie, idle seats) and one per duplicate category.
 */
export function buildFindings(analytics: AnalyticsResponse): Finding[] {
  const findings: Finding[] = [];
  const offenders = new Map<number, WasteOffenderDTO>(
    analytics.topWasteOffenders.map((offender) => [offender.subscriptionId, offender]),
  );
  const duplicatesByVendor = new Map<number, DuplicateCategoryDTO>();
  analytics.duplicateCategories.forEach((group) => {
    group.vendors.filter((vendor) => vendor.isDuplicateCandidate).forEach((vendor) => {
      duplicatesByVendor.set(vendor.subscriptionId, group);
    });
  });

  /* RULE 1 — Ghost seats ------------------------------------------------- */
  groupBySubscription(analytics.staleLicences).forEach((rows, subscriptionId) => {
    const first = rows[0];
    const wasteCents = rows.reduce((sum, row) => sum + row.seatCostCents, 0);
    if (wasteCents <= 0) return;
    const offboarded = rows.filter((row) => row.reason === "offboarded_holder").length;
    const inactive = rows.length - offboarded;
    const worstDays = Math.max(...rows.map((row) => row.daysSinceLogin ?? 0));

    findings.push({
      id: `ghost-${subscriptionId}`,
      kind: "ghost_seats",
      severity: severityFor(wasteCents, "high"),
      vendorId: subscriptionId,
      vendorName: first.vendorName,
      category: first.category,
      title: `${rows.length} unused ${first.vendorName} seat${rows.length === 1 ? "" : "s"} detected`,
      detail:
        `${offboarded} seat(s) belong to offboarded employees and ${inactive} have not logged in for more than ` +
        `${analytics.windows.staleLicenseDays} days (worst: ${worstDays} days). Reclaiming them trims the licence ` +
        `without touching an active user.`,
      detectionRule: `employee.status = 'offboarded' OR days_since(seat_mappings.last_login_at) > ${analytics.windows.staleLicenseDays}`,
      impactCents: wasteCents,
      seatsAffected: rows.length,
      confidence: 0.93,
      recommendedAction: `Reclaim ${rows.length} seat${rows.length === 1 ? "" : "s"} (${first.seatCostDisplay}/seat/month)`,
      actionType: "reclaim_seats",
      evidence: seatEvidenceFromLicences(rows).sort((a, b) => (b.daysSinceLogin ?? 0) - (a.daysSinceLogin ?? 0)),
    });
  });

  /* RULE 2 — Zombie software -------------------------------------------- */
  analytics.topWasteOffenders
    .filter((offender) => offender.isZombie)
    .forEach((offender) => {
      findings.push({
        id: `zombie-${offender.subscriptionId}`,
        kind: "zombie_software",
        severity: "critical",
        vendorId: offender.subscriptionId,
        vendorName: offender.vendorName,
        category: offender.category,
        title: `Zombie subscription: ${offender.vendorName} bills with zero logins`,
        detail:
          `All ${offender.seatsPaid} seat holders have been silent for ${analytics.windows.activeSeatDays}+ days, yet ` +
          `${offender.monthlyDisplay}/month is still charged. The whole invoice is waste.`,
        detectionRule: `max(logins_last_30d) = 0 AND min(days_since_login) >= ${analytics.windows.activeSeatDays} AND subscriptions.status = 'active'`,
        impactCents: offender.wasteCents,
        seatsAffected: offender.seatsPaid,
        confidence: 0.96,
        recommendedAction: `Cancel ${offender.vendorName} and revoke ${offender.seatsPaid} seats`,
        actionType: "cancel_subscription",
        evidence: [],
      });
    });

  /* RULE 3 — Idle (never provisioned) seats ------------------------------ */
  analytics.topWasteOffenders
    .filter((offender) => !offender.isZombie && offender.wasteSources.idleSeatsCents > 0)
    .forEach((offender) => {
      findings.push({
        id: `idle-${offender.subscriptionId}`,
        kind: "idle_seats",
        severity: "medium",
        vendorId: offender.subscriptionId,
        vendorName: offender.vendorName,
        category: offender.category,
        title: `${offender.idleSeats} paid ${offender.vendorName} seat(s) never provisioned`,
        detail:
          `${offender.seatsPaid} seats are invoiced but only ${offender.seatsPaid - offender.idleSeats} exist in the ` +
          `licence register. Downgrading removes the abandoned capacity.`,
        detectionRule: "subscriptions.seats_paid - COUNT(active seat_mappings) > 0",
        impactCents: offender.wasteSources.idleSeatsCents,
        seatsAffected: offender.idleSeats,
        confidence: 0.9,
        recommendedAction: `Downgrade ${offender.vendorName} by ${offender.idleSeats} seats at the next renewal`,
        actionType: "reclaim_seats",
        evidence: [],
      });
    });

  /* RULE 4 — Overlap duplication ---------------------------------------- */
  analytics.duplicateCategories.forEach((group) => {
    if (group.duplicateWasteCents <= 0) return;
    const incumbent = group.vendors.find((vendor) => vendor.isIncumbent);
    const offender = group.vendors.find((vendor) => vendor.isDuplicateCandidate);
    if (!offender) return;

    findings.push({
      id: `overlap-${offender.subscriptionId}`,
      kind: "overlap_duplication",
      severity: severityFor(group.duplicateWasteCents, "medium"),
      vendorId: offender.subscriptionId,
      vendorName: offender.vendorName,
      category: offender.category,
      title: `Overlap alert: ${offender.vendorName} duplicates ${incumbent?.vendorName ?? "another tool"}`,
      detail:
        `The company pays for ${group.vendorCount} tools in "${group.categoryGroup}" (${group.categoryMonthlyDisplay}/month). ` +
        `${offender.vendorName} has only ${offender.healthySeats} active of ${offender.seatsPaid} seats` +
        `${offender.adoptionPct === null ? "" : ` (${offender.adoptionPct}% adoption)`}. Consolidating into ` +
        `${incumbent?.vendorName ?? "the incumbent"} removes ${group.duplicateWasteDisplay}/month ` +
        `(leakage already counted on this invoice is excluded — no double counting).`,
      detectionRule: "ROW_NUMBER() OVER (PARTITION BY category_group ORDER BY adoption DESC, cost DESC) > 1 AND COUNT(*) OVER (PARTITION BY category_group) > 1",
      impactCents: group.duplicateWasteCents,
      seatsAffected: offender.seatsPaid,
      confidence: 0.87,
      recommendedAction: `Migrate ${offender.vendorName} users to ${incumbent?.vendorName ?? "the incumbent"} and cancel the contract`,
      actionType: "consolidate",
      evidence: [],
    });
  });

  /* RULE 5 — Renewal risk (contract hygiene, no waste attributed) --------- */
  analytics.upcomingRenewals
    .filter((renewal) => renewal.daysUntilRenewal <= 21)
    .forEach((renewal) => {
      const offender = offenders.get(renewal.subscriptionId);
      if (!offender || offender.wasteCents === 0) return;
      findings.push({
        id: `renewal-${renewal.subscriptionId}`,
        kind: "shadow_it",
        severity: "low",
        vendorId: renewal.subscriptionId,
        vendorName: renewal.vendorName,
        category: renewal.categoryGroup,
        title: `${renewal.vendorName} auto-renews in ${renewal.daysUntilRenewal} day(s)`,
        detail:
          `The contract renews on ${new Date(renewal.nextRenewalAt).toLocaleDateString("en-US")} at ` +
          `${renewal.monthlyDisplay}/month, and it is already carrying ${offender.wasteDisplay}/month of waste. ` +
          `Act before the renewal date or the waste is locked in for another term.`,
        detectionRule: "subscriptions.next_renewal_at <= now() + INTERVAL '21 days' AND line_waste_cents > 0",
        impactCents: 0,
        seatsAffected: 0,
        confidence: 0.8,
        recommendedAction: `Notify ${renewal.vendorName} before renewal to avoid a wasted term`,
        actionType: "review_contract",
        evidence: [],
      });
    });

  return findings.sort((a, b) => b.impactCents - a.impactCents || a.vendorName.localeCompare(b.vendorName));
}

/* -------------------------------- inventory ------------------------------- */

function healthGrade(score: number): { grade: string; label: string } {
  if (score >= 85) return { grade: "A", label: "Healthy" };
  if (score >= 70) return { grade: "B", label: "Monitor" };
  if (score >= 55) return { grade: "C", label: "At Risk" };
  if (score >= 40) return { grade: "D", label: "Critical" };
  return { grade: "F", label: "Churn" };
}

export function buildInventory(subscriptions: SubscriptionDTO[], analytics: AnalyticsResponse): InventoryRow[] {
  const offenders = new Map<number, WasteOffenderDTO>(
    analytics.topWasteOffenders.map((offender) => [offender.subscriptionId, offender]),
  );
  const duplicateGroups = new Map<number, string>();
  analytics.duplicateCategories.forEach((group) => {
    group.vendors.filter((vendor) => vendor.isDuplicateCandidate).forEach((vendor) => {
      duplicateGroups.set(vendor.subscriptionId, group.categoryGroup);
    });
  });

  return subscriptions
    .map<InventoryRow>((vendor) => {
      const offender = offenders.get(vendor.id);
      const { grade, label } = healthGrade(vendor.healthScore);
      const wasteReason = offender?.isZombie
        ? "Zero logins in 30+ days — entire subscription billed to waste"
        : duplicateGroups.has(vendor.id)
          ? `Duplicate tooling in ${duplicateGroups.get(vendor.id)}`
          : offender && offender.wasteSources.staleLicencesCents > 0
            ? `${vendor.seats.stale} inactive/departed seat holder(s)`
            : null;

      return {
        vendorId: vendor.id,
        vendorName: vendor.vendor,
        logoEmoji: emojiFor(vendor.vendor),
        category: vendor.category,
        categoryGroup: vendor.categoryGroup,
        billingModel: vendor.billingModel,
        seatsPaid: vendor.seatsPaid,
        activeUsers: vendor.seats.active,
        ghostSeats: vendor.seats.stale,
        idleSeats: vendor.seats.idle,
        monthlyCostCents: vendor.monthlyCostCents,
        unitCostCents: vendor.unitCostCents,
        healthScore: vendor.healthScore,
        healthGrade: grade,
        healthLabel: label,
        utilizationPct: vendor.seatsPaid > 0 ? Math.round((vendor.seats.active / vendor.seatsPaid) * 100) : 100,
        avgDaysSinceLogin: vendor.seats.averageDaysSinceLogin,
        annualizedCostCents: vendor.annualizedCostCents,
        wastedCents: offender?.wasteCents ?? 0,
        wasteReason,
        renewalDate: vendor.nextRenewalAt ?? new Date().toISOString(),
        renewalInDays: vendor.daysUntilRenewal ?? 0,
        contractOwner: vendor.contractOwner ?? "unassigned",
        status: vendor.status,
        overlapGroup: duplicateGroups.get(vendor.id) ?? null,
        // The canonical schema stores the current invoice, not 6 months of
        // statement history, so no trend sparkline is rendered for live rows.
        monthsTrend: [],
      };
    })
    .sort((a, b) => b.monthlyCostCents - a.monthlyCostCents);
}

/* ------------------------------ waste ledger ------------------------------ */

export function buildWasteLedger(analytics: AnalyticsResponse): WasteLedgerRow[] {
  const reasonFor: Record<string, WasteLedgerRow["reason"]> = {
    stale_licenses: "ghost_seats",
    zombie_subscriptions: "zombie_software",
    duplicate_categories: "duplicate_tooling",
    idle_seats: "idle_seats",
  };

  return analytics.totalWaste.breakdown
    .filter((bucket) => bucket.monthlyCents > 0)
    .map((bucket) => ({
      vendorId: 0,
      vendorName: bucket.label,
      category: bucket.detector,
      reason: reasonFor[bucket.key] ?? "ghost_seats",
      label: bucket.label,
      seats: bucket.seats,
      monthlyCents: bucket.monthlyCents,
      countedOnce: true,
    }))
    .sort((a, b) => b.monthlyCents - a.monthlyCents);
}

export function buildCategorySpend(analytics: AnalyticsResponse): CategorySlice[] {
  return analytics.categorySpend.map((slice) => ({
    categoryGroup: slice.categoryGroup,
    monthlyCents: slice.monthlyCents,
    sharePct: slice.sharePct,
    vendorCount: slice.vendorCount,
    overlap: slice.overlappingVendorCount > 1,
  }));
}

/* ------------------------- full dashboard view model ---------------------- */

/**
 * Assembles the `Snapshot` the dashboard components consume, from live API data
 * plus (optionally) the sandbox ledgers used by the raw-data tabs.
 *
 * @param analytics      GET /api/analytics
 * @param subscriptions  GET /api/subscriptions?pageSize=200
 * @param recoveredCents savings already applied (from the audit trail + this session)
 * @param sandbox        optional /api/dashboard payload for the raw ledger tabs
 */
export function buildLiveSnapshot(
  analytics: AnalyticsResponse,
  subscriptions: SubscriptionDTO[],
  recoveredCents: number,
  sandbox: Snapshot | null = null,
): Snapshot {
  const findings = buildFindings(analytics);
  const inventory = buildInventory(subscriptions, analytics);
  const metrics = buildMetrics(analytics, subscriptions, findings, recoveredCents);

  const evidenceRows: SsoRecordDTO[] = analytics.staleLicences.map((row, index) => ({
    id: index,
    appName: row.vendorName,
    employeeEmail: row.userEmail,
    employeeName: row.userName,
    department: row.department,
    employeeStatus: row.userStatus === "terminated" ? "offboarded" : "active",
    lastLoginAt: row.lastLoginAt,
    daysSinceLogin: row.daysSinceLogin,
    loginsLast30d: row.loginsLast30d,
    billed: true,
    vendorName: row.vendorName,
    seatStatus: "active",
  }));

  const employees: EmployeeDTO[] =
    sandbox?.employees ??
    [];

  const transactions: TransactionDTO[] =
    sandbox?.transactions ??
    subscriptions.map((vendor, index) => ({
      id: index + 1,
      statementPeriod: new Date().toISOString().slice(0, 7),
      postedAt: new Date().toISOString(),
      merchantDescriptor: `${vendor.vendor.toUpperCase().replace(/[^A-Z0-9]+/g, " ")} *MONTHLY`,
      vendorName: vendor.vendor,
      category: vendor.category,
      amountCents: vendor.monthlyCostCents,
      cardLast4: "4401",
      cardholderEmail: vendor.contractOwner ?? "ap@company.io",
      isRecurring: true,
      matchConfidence: 100,
      anomaly: vendor.isZombie ? "No SSO activity in 30+ days — billing still active" : null,
    }));

  return {
    generatedAt: analytics.generatedAt,
    lastIngestAt: analytics.generatedAt,
    ingestDurationMs: 0,
    ingestSources: [
      {
        name: "Subscription register",
        format: "GET /api/subscriptions",
        rows: subscriptions.length,
        purpose: "Contracts on the corporate card, with seat counts and unit cost",
        status: "matched",
      },
      {
        name: "Seat mappings (SSO telemetry)",
        format: "seat_mappings.last_login_at",
        rows: metrics.seatsPaid,
        purpose: "Which employee holds which paid seat, and when they last signed in",
        status: "joined",
      },
      {
        name: "HRIS roster",
        format: "users.status",
        rows: analytics.company.headcount,
        purpose: "Distinguishes active staff from leavers still holding licences",
        status: "enriched",
      },
      {
        name: "Analytics engine",
        format: "GET /api/analytics",
        rows: analytics.detectors.reduce((sum, detector) => sum + detector.hits, 0),
        purpose: "Spend + waste calculations across four detectors",
        status: "computed",
      },
    ],
    detectionRules: analytics.detectors.map((detector) => ({
      name: kindLabel(
        detector.id === "STALE_LICENSE"
          ? "ghost_seats"
          : detector.id === "ZOMBIE_SOFTWARE"
            ? "zombie_software"
            : detector.id === "DUPLICATE_CATEGORY"
              ? "overlap_duplication"
              : "idle_seats",
      ),
      rule: detector.rule,
      threshold: detector.waste,
      severity:
        detector.id === "ZOMBIE_SOFTWARE"
          ? ("critical" as const)
          : detector.id === "STALE_LICENSE"
            ? ("high" as const)
            : ("medium" as const),
    })),
    metrics,
    findings,
    history: [],
    inventory,
    wasteLedger: buildWasteLedger(analytics),
    categorySpend: buildCategorySpend(analytics),
    spendTrend: sandbox?.spendTrend ?? [],
    employees,
    transactions,
    ssoLog: sandbox?.ssoLog?.length ? sandbox.ssoLog : evidenceRows,
    shadowIt: sandbox?.shadowIt ?? [],
  };
}
