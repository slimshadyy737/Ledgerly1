"use client";

/**
 * ===========================================================================
 *  SaaSify Clean — high-end SaaS Spend Management dashboard
 * ===========================================================================
 *  A SINGLE, SELF-CONTAINED React file. Drop it anywhere in a React app:
 *
 *     import SaaSifyClean from "./SaaSifyClean";
 *     export default function Page() { return <SaaSifyClean />; }
 *
 *  Optional props let you point it at another deployment or tenant:
 *     <SaaSifyClean apiBase="/v1" companyId={2} />
 *
 *  It has NO imports besides React, so it carries its own:
 *    §1  Types              — the REST contract it consumes
 *    §2  Formatters         — currency / percent / date helpers
 *    §3  API client         — fetch with AbortController timeout + typed errors
 *    §4  Analytics adapter  — turns API payloads into findings/inventory/metrics
 *    §5  UI atoms           — GlassCard, PulseBadge, GlowStat, Meter, Stepper…
 *    §6  Feature sections   — HeroBanner, MetricsBar, ActionFeed, InventoryTable…
 *    §7  SaaSifyClean       — state + effects + handleResolve (the live logic)
 *
 *  Backend endpoints consumed (all JSON, all read-only except the POST):
 *    GET  {base}/api/analytics                        spend + waste calculations
 *    GET  {base}/api/subscriptions?pageSize=200       contract register + seats
 *    GET  {base}/api/subscriptions/:id                live seat register (drill-down)
 *    GET  {base}/api/analytics/optimizations          audit trail of decisions
 *    GET  {base}/api/companies                        tenants available
 *    POST {base}/api/subscriptions/:id/optimize       write-back, then re-fetch
 *
 *  Design system: slate-950 canvas (#020617), glassmorphism cards
 *  (bg-slate-900/60 + backdrop-blur-md + border-slate-800), emerald #10b981 for
 *  savings/healthy, rose #f43f5e for active financial leaks.
 * ===========================================================================
 */

import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

/* ===========================================================================
 * §1  TYPES — the shape of the responses this component consumes
 * ========================================================================= */

type BillingModel = "per_seat" | "flat" | "usage";
type ContractStatus = "active" | "paused" | "cancelled" | "consolidated";

interface SeatStats {
  paid: number;
  assigned: number;
  active: number;
  stale: number;
  idle: number;
  adoptionPct: number | null;
  averageDaysSinceLogin: number | null;
  staleCostCents: number;
}

interface Subscription {
  id: number;
  vendor: string;
  product: string | null;
  category: string;
  categoryGroup: string;
  billingModel: BillingModel;
  status: ContractStatus;
  seatsPaid: number;
  unitCostCents: number;
  monthlyCostCents: number;
  annualizedCostCents: number;
  seats: SeatStats;
  healthScore: number;
  isZombie: boolean;
  hasOverlappingVendors: boolean;
  contractOwner: string | null;
  nextRenewalAt: string | null;
  daysUntilRenewal: number | null;
}

interface WasteBucket {
  key: "stale_licenses" | "duplicate_categories" | "idle_seats" | "zombie_subscriptions";
  label: string;
  monthlyCents: number;
  monthlyDisplay: string;
  annualizedCents: number;
  shareOfWastePct: number;
  seats: number;
  detector: string;
}

interface StaleLicense {
  subscriptionId: number;
  vendorName: string;
  userName: string;
  userEmail: string;
  department: string;
  userStatus: "active" | "terminated";
  reason: "offboarded_holder" | "never_logged_in" | "inactive_beyond_window";
  daysSinceLogin: number | null;
  lastLoginAt: string | null;
  loginsLast30d: number;
  seatCostCents: number;
  seatCostDisplay: string;
}

interface WasteOffender {
  subscriptionId: number;
  vendorName: string;
  category: string;
  categoryGroup: string;
  billingModel: BillingModel;
  seatsPaid: number;
  activeSeats: number;
  staleSeats: number;
  idleSeats: number;
  isZombie: boolean;
  isDuplicateOfCategory: boolean;
  monthlyCents: number;
  monthlyDisplay: string;
  wasteCents: number;
  wasteDisplay: string;
  wasteSources: { staleLicencesCents: number; duplicateCategoryCents: number; idleSeatsCents: number };
}

interface DuplicateVendor {
  subscriptionId: number;
  vendorName: string;
  category: string;
  monthlyCents: number;
  monthlyDisplay: string;
  seatsPaid: number;
  healthySeats: number;
  adoptionPct: number | null;
  isIncumbent: boolean;
  isDuplicateCandidate: boolean;
  duplicateWasteCents: number;
}

interface DuplicateCategory {
  categoryGroup: string;
  vendorCount: number;
  categoryMonthlyDisplay: string;
  duplicateWasteCents: number;
  duplicateWasteDisplay: string;
  note: string | null;
  vendors: DuplicateVendor[];
}

interface Renewal {
  subscriptionId: number;
  vendorName: string;
  categoryGroup: string;
  monthlyDisplay: string;
  nextRenewalAt: string;
  daysUntilRenewal: number;
}

interface Detector {
  id: "STALE_LICENSE" | "DUPLICATE_CATEGORY" | "IDLE_SEAT" | "ZOMBIE_SOFTWARE";
  rule: string;
  waste: string;
  monthlyCents: number;
  hits: number;
}

interface Analytics {
  ok: true;
  generatedAt: string;
  company: { id: number; name: string; domain: string; headcount: number; currency: string };
  windows: { staleLicenseDays: number; activeSeatDays: number };
  totalSpend: {
    monthlyCents: number;
    annualizedCents: number;
    activeSubscriptions: number;
    seatsPaid: number;
    activeSeats: number;
    seatUtilisationPct: number;
    averageHealthScore: number;
  };
  totalWaste: {
    monthlyCents: number;
    annualizedCents: number;
    wasteRatePct: number;
    staleSeatCount: number;
    idleSeatCount: number;
    zombieCount: number;
    duplicateVendorCount: number;
    breakdown: WasteBucket[];
  };
  estate: { subscriptionsTotal: number; subscriptionsActive: number; subscriptionsCancelled: number; subscriptionsConsolidated: number; subscriptionsPaused: number };
  detectors: Detector[];
  duplicateCategories: DuplicateCategory[];
  staleLicences: StaleLicense[];
  topWasteOffenders: WasteOffender[];
  categorySpend: { categoryGroup: string; vendorCount: number; monthlyCents: number; sharePct: number; overlappingVendorCount: number }[];
  upcomingRenewals: Renewal[];
}

interface SubscriptionsResponse {
  ok: true;
  company: { id: number; name: string; currency: string };
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
  data: Subscription[];
}

interface SeatRow {
  seatMappingId: number;
  userName: string;
  userEmail: string;
  department: string;
  userStatus: "active" | "terminated";
  seatStatus: "active" | "revoked";
  seatCostCents: number;
  lastLoginAt: string | null;
  loginsLast30d: number;
  daysSinceLogin: number | null;
  isStale: boolean;
}

interface AuditEvent {
  id: number;
  subscriptionId: number;
  vendorName: string;
  action: "reclaim_seats" | "cancel" | "consolidate" | "update_contract";
  seatsReclaimed: number;
  previousCostCents: number;
  newCostCents: number;
  savingsCents: number;
  savingsDisplay: string;
  performedBy: string;
  createdAt: string;
  detail: string | null;
}

interface CompanyOption {
  id: number;
  name: string;
  users_count: number;
  active_subscriptions: number;
}

type Severity = "critical" | "high" | "medium" | "low";
type FindingKind = "ghost_seats" | "zombie_software" | "overlap_duplication" | "idle_seats" | "renewal_risk";
type FindingAction = "reclaim_seats" | "cancel" | "consolidate" | "review";

interface Finding {
  id: string;
  kind: FindingKind;
  severity: Severity;
  vendorId: number | null;
  vendorName: string;
  category: string;
  title: string;
  detail: string;
  detectionRule: string;
  impactCents: number;
  seatsAffected: number;
  confidence: number;
  recommendedAction: string;
  action: FindingAction;
  evidence: StaleLicense[];
}

interface InventoryRow {
  id: number;
  vendor: string;
  logo: string;
  category: string;
  categoryGroup: string;
  billingModel: BillingModel;
  status: ContractStatus;
  seatsPaid: number;
  activeSeats: number;
  staleSeats: number;
  idleSeats: number;
  monthlyCostCents: number;
  monthlyCostDisplay: string;
  wasteCents: number;
  healthScore: number;
  healthGrade: string;
  utilizationPct: number;
  renewalInDays: number | null;
  renewalDate: string | null;
  isZombie: boolean;
  isDuplicate: boolean;
  contractOwner: string;
  monthsTrend: number[];
}

/* ===========================================================================
 * §2  FORMATTERS
 * ========================================================================= */

const usdFmt = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const usdExactFmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const usd = (cents: number) => usdFmt.format((Number(cents) || 0) / 100);
const usdExact = (cents: number) => usdExactFmt.format((Number(cents) || 0) / 100);
const usdCompact = (cents: number) => {
  const value = (Number(cents) || 0) / 100;
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `$${(value / 1_000).toFixed(1)}k`;
  return `$${value.toFixed(0)}`;
};
const pct = (value: number, digits = 1) => `${(Number(value) || 0).toFixed(digits)}%`;

const relativeDays = (days: number | null) => {
  if (days === null || days === undefined) return "never";
  if (days <= 0) return "today";
  if (days === 1) return "1 day ago";
  if (days < 45) return `${days} days ago`;
  if (days < 365) return `${Math.round(days / 30)} mo ago`;
  return `${(days / 365).toFixed(1)} yr ago`;
};

const shortDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";

const dateTime = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** Row-level colour helpers so the palette stays consistent everywhere. */
const healthColor = (score: number) =>
  score >= 85 ? "#10b981" : score >= 70 ? "#a3e635" : score >= 55 ? "#fbbf24" : score >= 40 ? "#fb923c" : "#f43f5e";

const severityTheme: Record<Severity, { chip: string; dot: string; bar: string; label: string }> = {
  critical: { chip: "bg-rose-500/10 text-rose-300 ring-rose-500/30", dot: "bg-rose-400", bar: "bg-rose-500", label: "CRITICAL LEAK" },
  high: { chip: "bg-amber-500/10 text-amber-300 ring-amber-500/30", dot: "bg-amber-400", bar: "bg-amber-400", label: "LEAKING" },
  medium: { chip: "bg-sky-500/10 text-sky-300 ring-sky-500/30", dot: "bg-sky-400", bar: "bg-sky-400", label: "WASTE" },
  low: { chip: "bg-slate-500/10 text-slate-300 ring-slate-400/30", dot: "bg-slate-400", bar: "bg-slate-400", label: "REVIEW" },
};

const VENDOR_LOGO: Record<string, string> = {
  Zoom: "🎥", Slack: "💬", Figma: "🎨", Sketch: "💎", Asana: "📋", "Monday.com": "🗂️",
  Atlassian: "🧭", Salesforce: "☁️", HubSpot: "🧲", AWS: "⚡", Datadog: "📈", Sentry: "🛡️",
  Mixpanel: "🔍", Amplitude: "📉", "1Password": "🔐", LastPass: "🧱", Zendesk: "🎧",
  Intercom: "📞", Mailchimp: "📨", Airtable: "🧱", Miro: "🖼️", Hotjar: "🔥", Loom: "🎬",
  Notion: "📓", GitHub: "🐙", BambooHR: "🌴", "Google Workspace": "🟢", Dropbox: "📦",
};
const logoFor = (vendor: string) =>
  VENDOR_LOGO[vendor] ??
  VENDOR_LOGO[Object.keys(VENDOR_LOGO).find((key) => vendor.toLowerCase().includes(key.toLowerCase())) ?? ""] ??
  "🧩";

const canUseDom = typeof window !== "undefined";

/* ===========================================================================
 * §3  API CLIENT — fetch + AbortController timeout, typed errors
 * ========================================================================= */

const REQUEST_TIMEOUT_MS = 8_000;

class ApiError extends Error {
  status: number;
  code: string;
  isOffline: boolean;

  constructor(message: string, options: { status?: number; code?: string; isOffline?: boolean } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = options.status ?? 0;
    this.code = options.code ?? "unknown_error";
    this.isOffline = options.isOffline ?? false;
  }
}

async function apiRequest<T>(
  url: string,
  options: { method?: "GET" | "POST"; body?: unknown; signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<T> {
  const { method = "GET", body, signal, timeoutMs = REQUEST_TIMEOUT_MS } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("timeout")), timeoutMs);
  const forward = () => controller.abort(signal?.reason);
  signal?.addEventListener("abort", forward, { once: true });

  try {
    const response = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
      cache: "no-store",
    });

    const text = await response.text();
    const payload: unknown = text ? JSON.parse(text) : null;

    if (!response.ok) {
      const shaped = payload as { error?: { code?: string; message?: string } } | null;
      throw new ApiError(shaped?.error?.message ?? `Request failed with HTTP ${response.status}`, {
        status: response.status,
        code: shaped?.error?.code ?? `http_${response.status}`,
      });
    }
    return payload as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    const aborted = error instanceof Error && /timeout|abort/i.test(error.message);
    throw new ApiError(
      aborted
        ? `The spend API did not answer within ${timeoutMs / 1000}s.`
        : "Cannot reach the spend API. The backend may be offline.",
      { isOffline: true, code: aborted ? "backend_timeout" : "backend_offline" },
    );
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", forward);
  }
}

/* ===========================================================================
 * §4  ANALYTICS ADAPTER — API payloads -> findings, inventory, metrics
 * ========================================================================= */

function severityFor(cents: number, base: Severity): Severity {
  if (base === "critical") return "critical";
  if (cents >= 40_000) return "critical";
  if (cents >= 15_000) return "high";
  return base;
}

function healthGrade(score: number): string {
  if (score >= 85) return "A";
  if (score >= 70) return "B";
  if (score >= 55) return "C";
  if (score >= 40) return "D";
  return "F";
}

/** Turns the analytics payload into the ranked action feed. */
function buildFindings(analytics: Analytics): Finding[] {
  const findings: Finding[] = [];

  /**
   * One-dollar-once policy (mirrors the SQL engine): a zombie contract already
   * claims its ENTIRE invoice, so we must not also propose reclaiming the dead
   * seats inside it — that would double-count the same money in the feed and
   * give the CFO two overlapping instructions for one contract.
   */
  const zombieVendorIds = new Set(
    analytics.topWasteOffenders.filter((offender) => offender.isZombie).map((offender) => offender.subscriptionId),
  );

  /* Ghost seats — grouped per vendor from the seat-level evidence. */
  const ghostGroups = new Map<number, StaleLicense[]>();
  analytics.staleLicences.forEach((row) => {
    const list = ghostGroups.get(row.subscriptionId) ?? [];
    list.push(row);
    ghostGroups.set(row.subscriptionId, list);
  });
  ghostGroups.forEach((rows, subscriptionId) => {
    if (zombieVendorIds.has(subscriptionId)) return; // covered by the zombie finding
    const cost = rows.reduce((sum, row) => sum + row.seatCostCents, 0);
    if (cost <= 0) return;
    const first = rows[0];
    const offboarded = rows.filter((row) => row.reason === "offboarded_holder").length;
    const inactive = rows.length - offboarded;
    const worst = Math.max(...rows.map((row) => row.daysSinceLogin ?? 0));

    findings.push({
      id: `ghost-${subscriptionId}`,
      kind: "ghost_seats",
      severity: severityFor(cost, "high"),
      vendorId: subscriptionId,
      vendorName: first.vendorName,
      category: first.vendorName,
      title: `${rows.length} unused ${first.vendorName} seat${rows.length === 1 ? "" : "s"} still on the card`,
      detail:
        `${offboarded} seat${offboarded === 1 ? "" : "s"} belong to offboarded employees and ${inactive} have not ` +
        `authenticated for more than ${analytics.windows.staleLicenseDays} days (worst case: ${worst} days). ` +
        `These licences can be released without touching an active user.`,
      detectionRule: `users.status = 'terminated' OR seat_mappings.last_login_at < now() - ${analytics.windows.staleLicenseDays}d`,
      impactCents: cost,
      seatsAffected: rows.length,
      confidence: 0.93,
      recommendedAction: `Reclaim ${rows.length} seat${rows.length === 1 ? "" : "s"} at ${rows[0].seatCostDisplay}/seat`,
      action: "reclaim_seats",
      evidence: [...rows].sort((a, b) => (b.daysSinceLogin ?? 0) - (a.daysSinceLogin ?? 0)),
    });
  });

  /* Zombie software — the whole invoice is waste. */
  analytics.topWasteOffenders
    .filter((offender) => offender.isZombie)
    .forEach((offender) => {
      findings.push({
        id: `zombie-${offender.subscriptionId}`,
        kind: "zombie_software",
        severity: "critical",
        vendorId: offender.subscriptionId,
        vendorName: offender.vendorName,
        category: offender.categoryGroup,
        title: `Zombie subscription: ${offender.vendorName} bills with zero logins`,
        detail:
          `All ${offender.seatsPaid} seat holders have been silent for ${analytics.windows.activeSeatDays}+ days while ` +
          `${offender.monthlyDisplay}/month keeps clearing the corporate card.`,
        detectionRule: `max(seat_mappings.logins_last_30d) = 0 AND min(days_since_login) >= ${analytics.windows.activeSeatDays}`,
        impactCents: offender.wasteCents,
        seatsAffected: offender.seatsPaid,
        confidence: 0.96,
        recommendedAction: `Cancel ${offender.vendorName} and revoke ${offender.seatsPaid} seats`,
        action: "cancel",
        evidence: [],
      });
    });

  /* Idle seats — paid but never provisioned. */
  analytics.topWasteOffenders
    .filter((offender) => !offender.isZombie && offender.wasteSources.idleSeatsCents > 0) // zombies are cancelled, not trimmed
    .forEach((offender) => {
      findings.push({
        id: `idle-${offender.subscriptionId}`,
        kind: "idle_seats",
        severity: "medium",
        vendorId: offender.subscriptionId,
        vendorName: offender.vendorName,
        category: offender.categoryGroup,
        title: `${offender.idleSeats} paid ${offender.vendorName} seat${offender.idleSeats === 1 ? "" : "s"} never provisioned`,
        detail:
          `The invoice covers ${offender.seatsPaid} seats but the licence register only holds ` +
          `${offender.seatsPaid - offender.idleSeats}. Capacity is being purchased with no owner attached.`,
        detectionRule: "subscriptions.seats_paid - COUNT(active seat_mappings) > 0",
        impactCents: offender.wasteSources.idleSeatsCents,
        seatsAffected: offender.idleSeats,
        confidence: 0.9,
        recommendedAction: `Downgrade ${offender.vendorName} by ${offender.idleSeats} seat(s) at renewal`,
        action: "reclaim_seats",
        evidence: [],
      });
    });

  /* Overlap duplication — two tools, one job. */
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
      category: group.categoryGroup,
      title: `Overlap: ${offender.vendorName} duplicates ${incumbent?.vendorName ?? "another tool"}`,
      detail:
        `You pay for ${group.vendorCount} tools in "${group.categoryGroup}" (${group.categoryMonthlyDisplay}/month). ` +
        `${offender.vendorName} holds only ${offender.healthySeats} active of ${offender.seatsPaid} seats` +
        `${offender.adoptionPct === null ? "" : ` (${offender.adoptionPct}% adoption)`}. Consolidating into ` +
        `${incumbent?.vendorName ?? "the incumbent"} releases ${group.duplicateWasteDisplay}/month.`,
      detectionRule: "ROW_NUMBER() OVER (PARTITION BY category_group ORDER BY adoption DESC, cost DESC) > 1",
      impactCents: group.duplicateWasteCents,
      seatsAffected: offender.seatsPaid,
      confidence: 0.87,
      recommendedAction: `Migrate users to ${incumbent?.vendorName ?? "the incumbent"} and retire the contract`,
      action: "consolidate",
      evidence: [],
    });
  });

  /* Renewal risk — no waste attributed, pure timing intelligence. */
  analytics.upcomingRenewals
    .filter((renewal) => renewal.daysUntilRenewal <= 21)
    .forEach((renewal) => {
      const offender = analytics.topWasteOffenders.find((row) => row.subscriptionId === renewal.subscriptionId);
      if (!offender || offender.wasteCents === 0) return;
      findings.push({
        id: `renewal-${renewal.subscriptionId}`,
        kind: "renewal_risk",
        severity: "low",
        vendorId: renewal.subscriptionId,
        vendorName: renewal.vendorName,
        category: renewal.categoryGroup,
        title: `${renewal.vendorName} auto-renews in ${renewal.daysUntilRenewal} day(s)`,
        detail:
          `The contract renews on ${shortDate(renewal.nextRenewalAt)} at ${renewal.monthlyDisplay}/month — and it is ` +
          `already carrying ${offender.wasteDisplay}/month of waste. Act before the date or the leak locks in for a term.`,
        detectionRule: "next_renewal_at <= now() + INTERVAL '21 days' AND line_waste_cents > 0",
        impactCents: 0,
        seatsAffected: 0,
        confidence: 0.8,
        recommendedAction: `Notify ${renewal.vendorName} before the renewal deadline`,
        action: "review",
        evidence: [],
      });
    });

  return findings.sort((a, b) => b.impactCents - a.impactCents || a.vendorName.localeCompare(b.vendorName));
}

function buildInventory(subscriptions: Subscription[], analytics: Analytics): InventoryRow[] {
  const offenders = new Map(analytics.topWasteOffenders.map((row) => [row.subscriptionId, row]));
  const duplicates = new Map<number, string>();
  analytics.duplicateCategories.forEach((group) =>
    group.vendors
      .filter((vendor) => vendor.isDuplicateCandidate)
      .forEach((vendor) => duplicates.set(vendor.subscriptionId, group.categoryGroup)),
  );

  return subscriptions
    .map<InventoryRow>((vendor) => {
      const offender = offenders.get(vendor.id);
      return {
        id: vendor.id,
        vendor: vendor.vendor,
        logo: logoFor(vendor.vendor),
        category: vendor.category,
        categoryGroup: vendor.categoryGroup,
        billingModel: vendor.billingModel,
        status: vendor.status,
        seatsPaid: vendor.seatsPaid,
        activeSeats: vendor.seats.active,
        staleSeats: vendor.seats.stale,
        idleSeats: vendor.seats.idle,
        monthlyCostCents: vendor.monthlyCostCents,
        monthlyCostDisplay: usd(vendor.monthlyCostCents),
        wasteCents: offender?.wasteCents ?? 0,
        healthScore: vendor.healthScore,
        healthGrade: healthGrade(vendor.healthScore),
        utilizationPct: vendor.seatsPaid > 0 ? Math.round((vendor.seats.active / vendor.seatsPaid) * 100) : 100,
        renewalInDays: vendor.daysUntilRenewal,
        renewalDate: vendor.nextRenewalAt,
        isZombie: vendor.isZombie,
        isDuplicate: duplicates.has(vendor.id),
        contractOwner: vendor.contractOwner ?? "unassigned",
        monthsTrend: [],
      };
    })
    .sort((a, b) => b.wasteCents - a.wasteCents || b.monthlyCostCents - a.monthlyCostCents);
}

/* ---------------------------------------------------------------------------
 * Named exports (optional): the pure adapter functions and money formatter are
 * exported so they can be tested or reused independently of the dashboard.
 * ------------------------------------------------------------------------- */
export { buildFindings, buildInventory, usd as formatUsd, usdCompact as formatUsdCompact };

/* ===========================================================================
 * §5  UI ATOMS — the SaaSify Clean design system
 * ========================================================================= */

/** Glassmorphism card: the single container primitive used across the page. */
function GlassCard({
  children,
  className = "",
  glow = "none",
}: {
  children: ReactNode;
  className?: string;
  glow?: "none" | "emerald" | "rose" | "sky" | "violet";
}) {
  const halos: Record<string, string> = {
    none: "",
    emerald: "shadow-[0_0_15px_rgba(16,185,129,0.10)]",
    rose: "shadow-[0_0_15px_rgba(244,63,94,0.10)]",
    sky: "shadow-[0_0_15px_rgba(56,189,248,0.10)]",
    violet: "shadow-[0_0_15px_rgba(167,139,250,0.10)]",
  };
  return (
    <section
      className={`rounded-2xl border border-slate-800 bg-slate-900/60 backdrop-blur-md ${halos[glow]} ${className}`}
    >
      {children}
    </section>
  );
}

function CardHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-800 px-5 py-4">
      <div>
        <h2 className="text-sm font-semibold tracking-tight text-white">{title}</h2>
        {subtitle && <p className="mt-0.5 text-xs text-slate-400">{subtitle}</p>}
      </div>
      {action}
    </header>
  );
}

/** Animated status badge — pulsing dot + ring, used for leak/health states. */
function PulseBadge({
  children,
  tone = "emerald",
  pulse = true,
}: {
  children: ReactNode;
  tone?: "emerald" | "rose" | "amber" | "sky" | "violet" | "slate";
  pulse?: boolean;
}) {
  const tones: Record<string, { chip: string; dot: string; ring: string }> = {
    emerald: { chip: "bg-emerald-500/10 text-emerald-300", dot: "bg-emerald-400", ring: "ring-emerald-500/30" },
    rose: { chip: "bg-rose-500/10 text-rose-300", dot: "bg-rose-400", ring: "ring-rose-500/30" },
    amber: { chip: "bg-amber-500/10 text-amber-300", dot: "bg-amber-400", ring: "ring-amber-500/30" },
    sky: { chip: "bg-sky-500/10 text-sky-300", dot: "bg-sky-400", ring: "ring-sky-500/30" },
    violet: { chip: "bg-violet-500/10 text-violet-300", dot: "bg-violet-400", ring: "ring-violet-500/30" },
    slate: { chip: "bg-slate-500/10 text-slate-300", dot: "bg-slate-400", ring: "ring-slate-500/30" },
  };
  const theme = tones[tone];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider ring-1 ring-inset ${theme.chip} ${theme.ring}`}
    >
      <span className="relative flex h-1.5 w-1.5">
        {pulse && (
          <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-75 ${theme.dot}`} />
        )}
        <span className={`relative inline-flex h-1.5 w-1.5 rounded-full ${theme.dot}`} />
      </span>
      {children}
    </span>
  );
}

function Meter({ value, color = "#10b981", height = 5 }: { value: number; color?: string; height?: number }) {
  return (
    <div className="w-full overflow-hidden rounded-full bg-slate-800/80" style={{ height }}>
      <div
        className="h-full rounded-full transition-[width] duration-700 ease-out"
        style={{ width: `${Math.max(0, Math.min(100, value))}%`, background: color }}
      />
    </div>
  );
}

/** KPI widget: muted label, large white number, glow, delta chip, meter/footer. */
function GlowStat({
  label,
  value,
  caption,
  tone,
  delta,
  deltaLabel,
  progress,
  ringValue,
  footer,
}: {
  label: string;
  value: string;
  caption: string;
  tone: "emerald" | "rose" | "sky" | "violet" | "amber";
  delta?: number;
  deltaLabel?: string;
  progress?: number;
  ringValue?: number;
  footer?: ReactNode;
}) {
  const accents: Record<string, { text: string; glow: string; halo: string }> = {
    emerald: { text: "text-emerald-400", glow: "shadow-[0_0_15px_rgba(16,185,129,0.10)]", halo: "from-emerald-500/20" },
    rose: { text: "text-rose-400", glow: "shadow-[0_0_15px_rgba(244,63,94,0.10)]", halo: "from-rose-500/20" },
    sky: { text: "text-sky-400", glow: "shadow-[0_0_15px_rgba(56,189,248,0.10)]", halo: "from-sky-500/20" },
    violet: { text: "text-violet-400", glow: "shadow-[0_0_15px_rgba(167,139,250,0.10)]", halo: "from-violet-500/20" },
    amber: { text: "text-amber-400", glow: "shadow-[0_0_15px_rgba(251,191,36,0.10)]", halo: "from-amber-500/20" },
  };
  const accent = accents[tone];

  return (
    <div
      className={`group relative overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/60 p-4 backdrop-blur-md transition-all duration-300 hover:-translate-y-0.5 hover:border-slate-700 ${accent.glow}`}
    >
      <div className={`pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b ${accent.halo} to-transparent opacity-70`} />
      <div className="relative flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-slate-500">{label}</p>
          <p className={`mt-2 text-2xl font-semibold tabular-nums tracking-tight ${accent.text}`}>{value}</p>
        </div>
        {ringValue !== undefined && <RadialRing value={ringValue} color={healthColor(ringValue)} />}
      </div>

      {delta !== undefined && (
        <p className={`mt-1.5 text-[11px] font-medium ${delta >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
          {delta >= 0 ? "▲" : "▼"} {Math.abs(delta).toFixed(1)} pts {deltaLabel ?? "vs session start"}
        </p>
      )}

      <p className="relative mt-1.5 text-[11px] leading-relaxed text-slate-400">{caption}</p>
      {progress !== undefined && (
        <div className="mt-3">
          <Meter value={progress} color={accent.text === "text-rose-400" ? "#f43f5e" : "#10b981"} height={4} />
        </div>
      )}
      {footer && <div className="mt-3">{footer}</div>}
    </div>
  );
}

/** Compact SVG progress ring used by the efficiency widget. */
function RadialRing({ value, color, size = 52 }: { value: number; color: string; size?: number }) {
  const radius = (size - 8) / 2;
  const circumference = 2 * Math.PI * radius;
  const dash = (Math.max(0, Math.min(100, value)) / 100) * circumference;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} className="h-full w-full -rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="rgba(148,163,184,0.18)" strokeWidth="5" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference - dash}`}
          className="transition-[stroke-dasharray] duration-700 ease-out"
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-[10px] font-semibold tabular-nums text-slate-200">
        {Math.round(value)}
      </span>
    </div>
  );
}

/** Primary action button with scale + ring micro-interactions. */
function ActionButton({
  children,
  onClick,
  tone = "emerald",
  variant = "solid",
  disabled,
  busy,
  title,
}: {
  children: ReactNode;
  onClick: () => void;
  tone?: "emerald" | "rose" | "sky" | "slate";
  variant?: "solid" | "ghost";
  disabled?: boolean;
  busy?: boolean;
  title?: string;
}) {
  const solid: Record<string, string> = {
    emerald:
      "bg-emerald-500 text-slate-950 hover:bg-emerald-400 hover:ring-2 hover:ring-emerald-400/50 hover:shadow-[0_0_20px_rgba(16,185,129,0.35)]",
    rose: "bg-rose-500 text-white hover:bg-rose-400 hover:ring-2 hover:ring-rose-400/50 hover:shadow-[0_0_20px_rgba(244,63,94,0.35)]",
    sky: "bg-sky-500 text-slate-950 hover:bg-sky-400 hover:ring-2 hover:ring-sky-400/50 hover:shadow-[0_0_20px_rgba(56,189,248,0.35)]",
    slate: "bg-slate-200 text-slate-950 hover:bg-white hover:ring-2 hover:ring-slate-300/50",
  };
  const ghost: Record<string, string> = {
    emerald: "border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10 hover:ring-2 hover:ring-emerald-500/30",
    rose: "border border-rose-500/40 text-rose-300 hover:bg-rose-500/10 hover:ring-2 hover:ring-rose-500/30",
    sky: "border border-sky-500/40 text-sky-300 hover:bg-sky-500/10 hover:ring-2 hover:ring-sky-500/30",
    slate: "border border-slate-700 text-slate-300 hover:bg-slate-800/60 hover:ring-2 hover:ring-slate-600/40",
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
      title={title}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all duration-200 outline-none hover:scale-[1.03] active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-emerald-400/60 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100 ${
        variant === "solid" ? solid[tone] : ghost[tone]
      }`}
    >
      {busy && (
        <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />
      )}
      {children}
    </button>
  );
}

/** The "How it Works" stepper graphic (right column of the intro banner). */
function HowItWorksStepper({ stats }: { stats: { source: string; matched: number; saved: string } }) {
  const steps = [
    {
      n: 1,
      icon: "🔌",
      title: "Connect APIs",
      body: "Accounting (cards / G/L) and your SSO identity provider — read-only grants.",
      status: stats.source,
      tone: "emerald" as const,
    },
    {
      n: 2,
      icon: "🧠",
      title: "Deep Match Analysis",
      body: "Every invoice line is joined to the employees who actually authenticate.",
      status: `${stats.matched.toLocaleString()} licence records matched`,
      tone: "sky" as const,
    },
    {
      n: 3,
      icon: "⚡",
      title: "1-Click Savings",
      body: "Reclaim seats, kill zombie tools and merge duplicates — then re-audit live.",
      status: `${stats.saved} released this cycle`,
      tone: "violet" as const,
    },
  ];

  return (
    <GlassCard className="relative overflow-hidden p-5" glow="emerald">
      <div className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full bg-emerald-500/10 blur-3xl" />
      <div className="relative flex items-center justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-400">How it works</p>
          <h3 className="mt-1 text-sm font-semibold text-white">Three moves to a clean stack</h3>
        </div>
        <PulseBadge tone="emerald">live pipeline</PulseBadge>
      </div>

      <ol className="relative mt-5 space-y-4">
        <span
          aria-hidden
          className="absolute left-[19px] top-4 bottom-4 w-px bg-gradient-to-b from-emerald-500/60 via-sky-500/30 to-violet-500/40"
        />
        {steps.map((step) => (
          <li key={step.n} className="relative flex gap-4">
            <span
              className={`relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border text-base ${
                step.tone === "emerald"
                  ? "border-emerald-500/40 bg-emerald-500/10 shadow-[0_0_15px_rgba(16,185,129,0.15)]"
                  : step.tone === "sky"
                    ? "border-sky-500/40 bg-sky-500/10 shadow-[0_0_15px_rgba(56,189,248,0.15)]"
                    : "border-violet-500/40 bg-violet-500/10 shadow-[0_0_15px_rgba(167,139,250,0.15)]"
              }`}
            >
              <span className="absolute -left-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-slate-950 text-[9px] font-bold text-slate-300 ring-1 ring-slate-700">
                {step.n}
              </span>
              {step.icon}
            </span>
            <div className="min-w-0 pt-0.5">
              <p className="flex items-center gap-2 text-xs font-semibold text-white">
                {step.title}
                <span className="text-slate-600">➔</span>
                <span className="text-[10px] font-medium uppercase tracking-wider text-slate-500">{step.status}</span>
              </p>
              <p className="mt-1 text-[11px] leading-relaxed text-slate-400">{step.body}</p>
            </div>
          </li>
        ))}
      </ol>

      <div className="relative mt-5 grid grid-cols-3 gap-2 border-t border-slate-800 pt-4 text-center">
        {[
          { label: "Read-only", value: "SOC 2 style scopes" },
          { label: "Time to value", value: "< 5 min setup" },
          { label: "Detectors", value: "4 live rules" },
        ].map((item) => (
          <div key={item.label}>
            <p className="text-[10px] uppercase tracking-wider text-slate-500">{item.label}</p>
            <p className="mt-0.5 text-[11px] font-medium text-slate-300">{item.value}</p>
          </div>
        ))}
      </div>
    </GlassCard>
  );
}

/** Two-column introduction + value proposition banner. */
function HeroBanner({
  companyName,
  headcount,
  metrics,
  onRefresh,
  refreshing,
  stats,
}: {
  companyName: string;
  headcount: number;
  metrics: { recoverableCents: number; monthlySpendCents: number; wasteRatePct: number; leaks: number };
  onRefresh: () => void;
  refreshing: boolean;
  stats: { source: string; matched: number; saved: string };
}) {
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1.15fr_0.85fr]">
      {/* ------------------------------ left column ------------------------ */}
      <GlassCard className="relative overflow-hidden p-6 lg:p-8" glow="emerald">
        <div className="pointer-events-none absolute -left-24 -top-24 h-64 w-64 rounded-full bg-emerald-500/10 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-32 right-0 h-56 w-56 rounded-full bg-sky-500/10 blur-3xl" />

        <div className="relative">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-2 rounded-full border border-slate-800 bg-slate-950/60 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-300">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              SaaSify Clean
            </span>
            <PulseBadge tone={metrics.leaks > 0 ? "rose" : "emerald"}>
              {metrics.leaks > 0 ? `${metrics.leaks} active financial leaks` : "estate is clean"}
            </PulseBadge>
          </div>

          <h1 className="mt-5 text-3xl font-semibold leading-[1.1] tracking-tight text-white sm:text-4xl lg:text-[2.6rem]">
            Automate SaaS Discovery.{" "}
            <span className="bg-gradient-to-r from-emerald-400 via-emerald-300 to-teal-200 bg-clip-text text-transparent">
              Stop the Money Leak.
            </span>
          </h1>

          <p className="mt-4 max-w-2xl text-sm leading-relaxed text-slate-400">
            SaaSify Clean securely bridges your accounting data with company SSO portals to identify unused licenses,
            duplicate platforms, and forgotten employee accounts on autopilot. It reconciles every invoice line against
            real authentication telemetry, so you only ever pay for software your team actually opens.
          </p>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <ActionButton onClick={onRefresh} busy={refreshing} tone="emerald">
              {refreshing ? "Running analysis…" : "Run live analysis"}
            </ActionButton>
            <ActionButton
              onClick={() => {
                if (!canUseDom) return;
                document.getElementById("optimisation-feed")?.scrollIntoView({ behavior: "smooth", block: "start" });
              }}
              variant="ghost"
              tone="slate"
            >
              Review {metrics.leaks} findings
            </ActionButton>
          </div>

          <dl className="mt-7 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: "Recoverable / mo", value: usd(metrics.recoverableCents), tone: "text-emerald-400" },
              { label: "Monthly spend", value: usd(metrics.monthlySpendCents), tone: "text-white" },
              { label: "Waste rate", value: pct(metrics.wasteRatePct), tone: "text-rose-400" },
              { label: "Workspace", value: `${headcount} staff`, tone: "text-slate-200" },
            ].map((item) => (
              <div key={item.label} className="rounded-xl border border-slate-800 bg-slate-950/50 px-3 py-2.5">
                <dt className="text-[10px] uppercase tracking-wider text-slate-500">{item.label}</dt>
                <dd className={`mt-0.5 text-sm font-semibold tabular-nums ${item.tone}`}>{item.value}</dd>
              </div>
            ))}
          </dl>

          <p className="mt-4 text-[11px] text-slate-500">
            Auditing <span className="text-slate-300">{companyName}</span> · read-only connections to the accounting
            ledger and the identity provider · nothing is cancelled without an explicit click.
          </p>
        </div>
      </GlassCard>

      {/* ------------------------------ right column ----------------------- */}
      <HowItWorksStepper stats={stats} />
    </div>
  );
}

/* ===========================================================================
 * §6  FEATURE SECTIONS
 * ========================================================================= */

function MetricsBar({
  spend,
  waste,
  subscriptions,
  recovered,
  efficiency,
  efficiencyDelta,
  ghosts,
  zombies,
  overlaps,
  seatsPaid,
  activeSeats,
  utilization,
  avgHealth,
}: {
  spend: number;
  waste: number;
  subscriptions: number;
  recovered: number;
  efficiency: number;
  efficiencyDelta: number;
  ghosts: number;
  zombies: number;
  overlaps: number;
  seatsPaid: number;
  activeSeats: number;
  utilization: number;
  avgHealth: number;
}) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
      <GlowStat
        label="Monthly SaaS spend"
        value={usd(spend)}
        caption={`${usdCompact(spend * 12)} annualised across ${subscriptions} active contracts`}
        tone="emerald"
        progress={100 - Math.min(100, (waste / Math.max(spend, 1)) * 100)}
        footer={
          <p className="text-[10px] uppercase tracking-wider text-slate-500">
            {seatsPaid} seats provisioned · {activeSeats} in use
          </p>
        }
      />
      <GlowStat
        label="Active financial leaks"
        value={usd(waste)}
        caption={`${pct((waste / Math.max(spend, 1)) * 100)} of spend is recoverable · ${usdCompact(waste * 12)} per year`}
        tone="rose"
        progress={Math.min(100, (waste / Math.max(spend, 1)) * 100)}
        footer={
          <div className="flex flex-wrap gap-1.5">
            <span className="rounded-full bg-rose-500/10 px-2 py-0.5 text-[10px] font-medium text-rose-300 ring-1 ring-inset ring-rose-500/20">
              {ghosts} ghost seats
            </span>
            <span className="rounded-full bg-rose-500/10 px-2 py-0.5 text-[10px] font-medium text-rose-300 ring-1 ring-inset ring-rose-500/20">
              {zombies} zombie tools
            </span>
            <span className="rounded-full bg-sky-500/10 px-2 py-0.5 text-[10px] font-medium text-sky-300 ring-1 ring-inset ring-sky-500/20">
              {overlaps} overlaps
            </span>
          </div>
        }
      />
      <GlowStat
        label="Efficiency rating"
        value={`${efficiency.toFixed(1)}%`}
        caption="Share of the stack attached to a user who logged in this month"
        tone={efficiency >= 75 ? "emerald" : efficiency >= 55 ? "amber" : "rose"}
        delta={efficiencyDelta}
        deltaLabel="pts since this page opened"
        ringValue={efficiency}
        footer={
          <p className="text-[10px] uppercase tracking-wider text-slate-500">
            Seat utilisation {pct(utilization, 0)} · estate health {avgHealth}/100
          </p>
        }
      />
      <GlowStat
        label="Savings recovered"
        value={usd(recovered)}
        caption={`${usdCompact(recovered * 12)} annualised while you watched`}
        tone="violet"
        progress={waste + recovered > 0 ? (recovered / (waste + recovered)) * 100 : 0}
        footer={<p className="text-[10px] uppercase tracking-wider text-slate-500">Written to the audit ledger</p>}
      />
      <GlowStat
        label="Active subscriptions"
        value={String(subscriptions)}
        caption={`${seatsPaid} paid seats · ${Math.max(seatsPaid - activeSeats, 0)} unattached`}
        tone="sky"
        ringValue={utilization}
        footer={
          <p className="text-[10px] uppercase tracking-wider text-slate-500">
            {ghosts + zombies + overlaps} of {subscriptions} contracts need attention
          </p>
        }
      />
    </div>
  );
}

/** Premium systemic alert card for one optimisation recommendation. */
function FindingCard({
  finding,
  onResolve,
  busy,
  pendingKey,
}: {
  finding: Finding;
  onResolve: (finding: Finding) => void;
  busy: boolean;
  pendingKey: string | null;
}) {
  const [open, setOpen] = useState(false);
  const theme = severityTheme[finding.severity];
  const isReview = finding.action === "review";

  return (
    <article
      className={`group relative overflow-hidden rounded-2xl border border-slate-800 bg-slate-950/60 p-4 transition-all duration-300 hover:-translate-y-0.5 hover:border-slate-700 hover:bg-slate-900/60 hover:shadow-[0_10px_40px_-12px_rgba(2,6,23,0.9)] ${
        finding.severity === "critical" ? "shadow-[0_0_15px_rgba(244,63,94,0.08)]" : ""
      }`}
    >
      <span aria-hidden className={`absolute inset-y-0 left-0 w-[3px] ${theme.bar} opacity-80`} />

      <div className="flex flex-wrap items-start justify-between gap-3 pl-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <PulseBadge tone={finding.severity === "critical" ? "rose" : finding.severity === "high" ? "amber" : finding.severity === "medium" ? "sky" : "slate"}>
              {theme.label}
            </PulseBadge>
            <span className="text-[10px] font-medium uppercase tracking-wider text-slate-500">
              {finding.category} · confidence {(finding.confidence * 100).toFixed(0)}%
            </span>
          </div>
          <h3 className="mt-2.5 text-sm font-semibold tracking-tight text-white">{finding.title}</h3>
        </div>

        <div className="shrink-0 text-right">
          {finding.impactCents > 0 ? (
            <>
              <p className="text-base font-semibold tabular-nums text-emerald-400">
                +{usd(finding.impactCents)}
                <span className="text-[11px] font-normal text-slate-500">/mo</span>
              </p>
              <p className="text-[10px] tabular-nums text-slate-500">{usdCompact(finding.impactCents * 12)} per year</p>
            </>
          ) : (
            <PulseBadge tone="slate" pulse={false}>
              timing risk
            </PulseBadge>
          )}
        </div>
      </div>

      <p className="mt-3 pl-2 text-xs leading-relaxed text-slate-400">{finding.detail}</p>

      <div className="mt-3 pl-2">
        <p className="overflow-x-auto whitespace-nowrap rounded-lg border border-slate-800 bg-slate-950/80 px-3 py-1.5 font-mono text-[10px] text-slate-500">
          <span className="text-slate-600">rule:</span> {finding.detectionRule}
        </p>
      </div>

      {finding.evidence.length > 0 && (
        <div className="mt-3 pl-2">
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            className="text-[11px] font-medium text-slate-400 transition hover:text-emerald-300"
          >
            <span className={`inline-block transition-transform ${open ? "rotate-90" : ""}`}>▸</span>{" "}
            {open ? "Hide" : "Show"} {finding.evidence.length} licence record
            {finding.evidence.length === 1 ? "" : "s"}
          </button>

          {open && (
            <div className="mt-2 overflow-hidden rounded-xl border border-slate-800">
              <table className="w-full text-left text-[11px]">
                <thead className="bg-slate-900/70 text-slate-400">
                  <tr>
                    <th className="px-3 py-2 font-medium">Employee</th>
                    <th className="px-3 py-2 font-medium">Department</th>
                    <th className="px-3 py-2 font-medium">HR status</th>
                    <th className="px-3 py-2 font-medium">Last SSO login</th>
                    <th className="px-3 py-2 text-right font-medium">Seat cost</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70">
                  {finding.evidence.slice(0, 8).map((row) => (
                    <tr key={`${row.subscriptionId}-${row.userEmail}`} className="text-slate-300">
                      <td className="px-3 py-2">
                        <span className="block text-slate-200">{row.userName}</span>
                        <span className="text-slate-500">{row.userEmail}</span>
                      </td>
                      <td className="px-3 py-2 text-slate-400">{row.department}</td>
                      <td className="px-3 py-2">
                        <PulseBadge tone={row.userStatus === "terminated" ? "rose" : "slate"} pulse={false}>
                          {row.userStatus}
                        </PulseBadge>
                      </td>
                      <td className="px-3 py-2">
                        <span className="text-slate-300">{relativeDays(row.daysSinceLogin)}</span>
                        {row.loginsLast30d === 0 && <span className="ml-1.5 text-rose-400">· 0 logins/30d</span>}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-300">{row.seatCostDisplay}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 pt-3 pl-2">
        <p className="text-[11px] text-slate-400">
          <span className="text-slate-500">Recommendation →</span> {finding.recommendedAction}
        </p>
        <div className="flex items-center gap-2">
          {isReview ? (
            <ActionButton variant="ghost" tone="slate" onClick={() => setOpen(true)}>
              View evidence
            </ActionButton>
          ) : (
            <>
              <ActionButton
                variant="ghost"
                tone="slate"
                onClick={() => setOpen((value) => !value)}
                disabled={finding.evidence.length === 0}
                title={finding.evidence.length === 0 ? "No seat-level evidence for this finding" : "Inspect licence records"}
              >
                Inspect
              </ActionButton>
              <ActionButton
                tone={finding.action === "cancel" ? "rose" : finding.action === "consolidate" ? "sky" : "emerald"}
                busy={busy}
                onClick={() => onResolve(finding)}
                disabled={finding.vendorId === null || pendingKey !== null}
              >
                {finding.action === "reclaim_seats"
                  ? `Reclaim ${finding.seatsAffected} seat${finding.seatsAffected === 1 ? "" : "s"}`
                  : finding.action === "consolidate"
                    ? "Merge & retire"
                    : "Cancel subscription"}
              </ActionButton>
            </>
          )}
        </div>
      </div>
    </article>
  );
}

/** Inventory table: clean padding, high-contrast type, pulse badges, hover lift. */
function InventoryTable({
  rows,
  onResolve,
  pendingKey,
  seatCache,
  loadingSeatsFor,
  onToggleRow,
}: {
  rows: InventoryRow[];
  onResolve: (row: InventoryRow, action: FindingAction) => void;
  pendingKey: string | null;
  seatCache: Record<number, SeatRow[]>;
  loadingSeatsFor: number | null;
  onToggleRow: (row: InventoryRow) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1020px] border-separate border-spacing-0 text-left text-xs">
        <thead>
          <tr className="text-[10px] uppercase tracking-[0.12em] text-slate-500">
            <th className="sticky top-0 bg-slate-900/80 px-4 py-3 font-medium backdrop-blur-md">Platform</th>
            <th className="sticky top-0 bg-slate-900/80 px-4 py-3 font-medium backdrop-blur-md">Category</th>
            <th className="sticky top-0 bg-slate-900/80 px-4 py-3 text-right font-medium backdrop-blur-md">Seats</th>
            <th className="sticky top-0 bg-slate-900/80 px-4 py-3 text-right font-medium backdrop-blur-md">Active</th>
            <th className="sticky top-0 bg-slate-900/80 px-4 py-3 text-right font-medium backdrop-blur-md">Monthly</th>
            <th className="sticky top-0 bg-slate-900/80 px-4 py-3 text-right font-medium backdrop-blur-md">Leak</th>
            <th className="sticky top-0 bg-slate-900/80 px-4 py-3 font-medium backdrop-blur-md">Health</th>
            <th className="sticky top-0 bg-slate-900/80 px-4 py-3 font-medium backdrop-blur-md">Status</th>
            <th className="sticky top-0 bg-slate-900/80 px-4 py-3 text-right font-medium backdrop-blur-md">Action</th>
          </tr>
        </thead>

        <tbody>
          {rows.map((row) => {
            const seats = seatCache[row.id] ?? [];
            const expanded = loadingSeatsFor === row.id || seats.length > 0;
            const reclaimKey = `${row.id}:reclaim_seats`;

            return (
              <Fragment key={row.id}>
                <tr
                  className="group cursor-pointer border-b border-slate-800/60 transition-all duration-200 hover:-translate-y-0.5 hover:bg-slate-900/60 hover:shadow-[0_10px_30px_-16px_rgba(2,6,23,0.95)]"
                  onClick={() => onToggleRow(row)}
                >
                  <td className="px-4 py-3.5">
                    <div className="flex items-center gap-3">
                      <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-800 bg-slate-950/70 text-sm">
                        {row.logo}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-[13px] font-semibold text-white">{row.vendor}</p>
                        <p className="truncate text-[11px] text-slate-500">
                          {row.billingModel === "per_seat"
                            ? `${usdExact(row.monthlyCostCents / Math.max(row.seatsPaid, 1))}/seat`
                            : row.billingModel === "usage"
                              ? "usage-based"
                              : "flat rate"}{" "}
                          · {row.contractOwner}
                        </p>
                      </div>
                    </div>
                  </td>

                  <td className="px-4 py-3.5">
                    <p className="text-slate-300">{row.category}</p>
                    {row.isDuplicate && (
                      <span className="mt-1 inline-block rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-300 ring-1 ring-inset ring-amber-500/20">
                        overlaps {row.categoryGroup}
                      </span>
                    )}
                  </td>

                  <td className="px-4 py-3.5 text-right tabular-nums text-slate-200">
                    {row.billingModel === "per_seat" ? row.seatsPaid : "—"}
                  </td>

                  <td className="px-4 py-3.5">
                    <div className="flex items-center justify-end gap-2">
                      <span className="tabular-nums text-slate-200">
                        {row.billingModel === "per_seat" ? row.activeSeats : "—"}
                      </span>
                      <span className="w-14">
                        <Meter value={row.utilizationPct} color={healthColor(row.healthScore)} height={4} />
                      </span>
                    </div>
                  </td>

                  <td className="px-4 py-3.5 text-right">
                    <p className="text-[13px] font-semibold tabular-nums text-white">{row.monthlyCostDisplay}</p>
                    <p className="text-[10px] tabular-nums text-slate-500">{usdCompact(row.monthlyCostCents * 12)}/yr</p>
                  </td>

                  <td className="px-4 py-3.5 text-right">
                    {row.wasteCents > 0 ? (
                      <span className="text-[13px] font-semibold tabular-nums text-rose-400">−{usd(row.wasteCents)}</span>
                    ) : (
                      <span className="text-slate-600">clean</span>
                    )}
                  </td>

                  <td className="px-4 py-3.5">
                    <div className="flex items-center gap-2">
                      <span className="w-7 text-sm font-semibold tabular-nums" style={{ color: healthColor(row.healthScore) }}>
                        {row.healthScore}
                      </span>
                      <span className="w-16">
                        <Meter value={row.healthScore} color={healthColor(row.healthScore)} height={5} />
                      </span>
                      <span className="text-[10px] font-medium uppercase text-slate-500">{row.healthGrade}</span>
                    </div>
                  </td>

                  <td className="px-4 py-3.5">
                    {row.isZombie ? (
                      <PulseBadge tone="rose">zombie</PulseBadge>
                    ) : row.staleSeats > 0 || row.idleSeats > 0 ? (
                      <PulseBadge tone="amber">
                        {row.staleSeats + row.idleSeats} unused
                      </PulseBadge>
                    ) : row.status === "active" ? (
                      <PulseBadge tone="emerald" pulse={false}>
                        healthy
                      </PulseBadge>
                    ) : (
                      <PulseBadge tone="slate" pulse={false}>
                        {row.status}
                      </PulseBadge>
                    )}
                    {row.renewalInDays !== null && row.renewalInDays <= 30 && (
                      <p className="mt-1 text-[10px] text-amber-400">renews in {row.renewalInDays}d</p>
                    )}
                  </td>

                  <td className="px-4 py-3.5 text-right" onClick={(event) => event.stopPropagation()}>
                    {row.isZombie ? (
                      <ActionButton
                        tone="rose"
                        busy={pendingKey === `${row.id}:cancel`}
                        disabled={pendingKey !== null}
                        onClick={() => onResolve(row, "cancel")}
                      >
                        Cancel
                      </ActionButton>
                    ) : row.isDuplicate ? (
                      <ActionButton
                        tone="sky"
                        busy={pendingKey === `${row.id}:consolidate`}
                        disabled={pendingKey !== null}
                        onClick={() => onResolve(row, "consolidate")}
                      >
                        Merge
                      </ActionButton>
                    ) : row.staleSeats > 0 ? (
                      <ActionButton
                        tone="emerald"
                        busy={pendingKey === reclaimKey}
                        disabled={pendingKey !== null}
                        onClick={() => onResolve(row, "reclaim_seats")}
                      >
                        Reclaim {row.staleSeats}
                      </ActionButton>
                    ) : (
                      <span className="text-[11px] text-slate-600">optimal</span>
                    )}
                  </td>
                </tr>

                {expanded && (
                  <tr className="bg-slate-950/70">
                    <td colSpan={9} className="px-4 py-4">
                      <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                        <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                          Live seat register
                          <span className="font-mono text-[10px] normal-case text-slate-500">
                            GET /api/subscriptions/{row.id}
                          </span>
                          {loadingSeatsFor === row.id && <PulseBadge tone="sky">loading</PulseBadge>}
                        </p>

                        {loadingSeatsFor === row.id && seats.length === 0 && (
                          <div className="mt-3 space-y-2">
                            {[0, 1, 2].map((index) => (
                              <div key={index} className="h-6 animate-pulse rounded bg-slate-800/60" />
                            ))}
                          </div>
                        )}

                        {seats.length > 0 && (
                          <div className="mt-3 max-h-72 overflow-y-auto rounded-lg border border-slate-800">
                            <table className="w-full text-left text-[11px]">
                              <thead className="sticky top-0 bg-slate-900/90 text-slate-400">
                                <tr>
                                  <th className="px-3 py-2 font-medium">Employee</th>
                                  <th className="px-3 py-2 font-medium">Department</th>
                                  <th className="px-3 py-2 font-medium">Last login</th>
                                  <th className="px-3 py-2 text-right font-medium">Logins / 30d</th>
                                  <th className="px-3 py-2 font-medium">Seat state</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-800/70">
                                {seats.slice(0, 60).map((seat) => (
                                  <tr key={seat.seatMappingId} className="transition hover:bg-slate-900/50">
                                    <td className="px-3 py-2">
                                      <span className="text-slate-200">{seat.userEmail}</span>
                                    </td>
                                    <td className="px-3 py-2 text-slate-500">{seat.department}</td>
                                    <td className="px-3 py-2 text-slate-400">{relativeDays(seat.daysSinceLogin)}</td>
                                    <td className="px-3 py-2 text-right tabular-nums text-slate-400">
                                      {seat.loginsLast30d}
                                    </td>
                                    <td className="px-3 py-2">
                                      {seat.seatStatus === "revoked" ? (
                                        <PulseBadge tone="slate" pulse={false}>
                                          reclaimed
                                        </PulseBadge>
                                      ) : seat.userStatus === "terminated" ? (
                                        <PulseBadge tone="rose">offboarded holder</PulseBadge>
                                      ) : seat.isStale ? (
                                        <PulseBadge tone="amber">ghost seat &gt;60d</PulseBadge>
                                      ) : (
                                        <PulseBadge tone="emerald" pulse={false}>
                                          healthy
                                        </PulseBadge>
                                      )}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Toast({ message, tone, onClose }: { message: string; tone: "success" | "error"; onClose: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onClose, 6000);
    return () => clearTimeout(timer);
  }, [onClose]);

  return (
    <div className="pointer-events-auto fixed bottom-6 right-6 z-50 max-w-md">
      <div
        className={`flex items-start gap-3 rounded-xl border px-4 py-3 shadow-2xl backdrop-blur-md ${
          tone === "success" ? "border-emerald-500/40 bg-emerald-500/10" : "border-rose-500/40 bg-rose-500/10"
        }`}
      >
        <span className="text-base">{tone === "success" ? "✅" : "⚠️"}</span>
        <p className="text-xs leading-relaxed text-white">{message}</p>
        <button onClick={onClose} className="ml-2 text-slate-400 transition hover:text-white" aria-label="Dismiss">
          ✕
        </button>
      </div>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="min-h-screen bg-[#020617] px-5 py-10">
      <div className="mx-auto max-w-[1500px]">
        <div className="flex items-center gap-3">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
          </span>
          <p className="text-sm text-slate-300">Running the SaaSify Clean audit…</p>
        </div>
        <div className="mt-8 grid grid-cols-1 gap-5 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="h-80 animate-pulse rounded-2xl border border-slate-800 bg-slate-900/60" />
          <div className="h-80 animate-pulse rounded-2xl border border-slate-800 bg-slate-900/60" />
        </div>
        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
          {Array.from({ length: 5 }).map((_, index) => (
            <div key={index} className="h-32 animate-pulse rounded-2xl border border-slate-800 bg-slate-900/60" />
          ))}
        </div>
        <div className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-3">
          <div className="space-y-3 xl:col-span-2">
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={index} className="h-32 animate-pulse rounded-2xl border border-slate-800 bg-slate-900/60" />
            ))}
          </div>
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={index} className="h-40 animate-pulse rounded-2xl border border-slate-800 bg-slate-900/60" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function OfflineState({
  message,
  code,
  onRetry,
  retrying,
}: {
  message: string;
  code?: string;
  onRetry: () => void;
  retrying: boolean;
}) {
  return (
    <div className="min-h-screen bg-[#020617] px-5 py-20">
      <div className="mx-auto max-w-2xl">
        <GlassCard className="overflow-hidden" glow="rose">
          <div className="border-b border-slate-800 bg-rose-500/5 px-6 py-5">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-rose-500/10 text-lg ring-1 ring-inset ring-rose-500/30">
                📡
              </span>
              <div>
                <h1 className="text-base font-semibold text-white">Spend API backend offline</h1>
                <p className="text-xs text-slate-400">
                  SaaSify Clean reads <span className="font-mono">/api/analytics</span> and{" "}
                  <span className="font-mono">/api/subscriptions</span> on load.
                </p>
              </div>
            </div>
          </div>
          <div className="space-y-4 px-6 py-5">
            <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3">
              <p className="text-xs font-medium text-rose-200">{message}</p>
              {code && <p className="mt-1 font-mono text-[10px] text-rose-300/80">code: {code}</p>}
            </div>
            <pre className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950/80 p-4 font-mono text-[11px] leading-relaxed text-slate-300">
{`# start the backend, then retry
pg_isready -h 127.0.0.1 -p 5432     # database up?
npm run dev                         # Next.js API routes on :3000

# first run only
node server/src/db/migrate.js
node server/src/db/seed.js          # or: psql -f server/src/db/seed_ghost_seat_demo.sql`}
            </pre>
            <div className="flex flex-wrap items-center gap-2">
              <ActionButton onClick={onRetry} busy={retrying} tone="emerald">
                {retrying ? "Retrying…" : "Retry now"}
              </ActionButton>
              <ActionButton variant="ghost" tone="slate" onClick={() => canUseDom && window.open("/api/health", "_blank")}>
                Check /api/health
              </ActionButton>
            </div>
            <p className="text-[11px] text-slate-500">
              Requests time out after 8 seconds, so a sleeping backend lands here instead of hanging the page.
            </p>
          </div>
        </GlassCard>
      </div>
    </div>
  );
}

/* ===========================================================================
 * §7  SaaSifyClean — state, effects and the live handlers
 * ========================================================================= */

export interface SaaSifyCleanProps {
  /** Base path of the spend API (default: same origin). */
  apiBase?: string;
  /** Pin the dashboard to one tenant; `null` uses the API default. */
  companyId?: number | null;
  /** Shown when the API is unreachable. */
  fallbackCompanyName?: string;
}

export default function SaaSifyClean({ apiBase = "", companyId = null, fallbackCompanyName = "your workspace" }: SaaSifyCleanProps) {
  /* ------------------------------ server data ---------------------------- */
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [tenantId, setTenantId] = useState<number | null>(companyId);

  /* -------------------------------- UX state ----------------------------- */
  const [status, setStatus] = useState<"loading" | "ready" | "refreshing" | "error">("loading");
  const [error, setError] = useState<{ message: string; code?: string } | null>(null);
  const [degraded, setDegraded] = useState<string | null>(null);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; tone: "success" | "error" } | null>(null);

  /* ------------------------- inventory table controls -------------------- */
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "leaks" | "zombie" | "duplicate" | "healthy">("all");
  const [sortKey, setSortKey] = useState<"waste" | "cost" | "health" | "seats">("waste");

  /* --------------------------- seat drill-down cache -------------------- */
  const [seatCache, setSeatCache] = useState<Record<number, SeatRow[]>>({});
  const [loadingSeatsFor, setLoadingSeatsFor] = useState<number | null>(null);

  const alive = useRef(true);
  const baselineEfficiency = useRef<number | null>(null);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  /* ---------------------------------------------------------------------- */
  /* EFFECT 1 — fetch analytics + subscriptions (and the audit trail)        */
  /* ---------------------------------------------------------------------- */
  const loadData = useCallback(
    async (options: { background?: boolean; signal?: AbortSignal } = {}) => {
      const { background = false, signal } = options;
      setStatus((previous) => (background && previous === "ready" ? "refreshing" : "loading"));

      const scope = tenantId !== null ? `companyId=${tenantId}` : "";
      const join = (path: string) => `${apiBase}${path}${scope ? `${path.includes("?") ? "&" : "?"}${scope}` : ""}`;

      try {
        const [analyticsResult, subscriptionsResult] = await Promise.allSettled([
          apiRequest<Analytics>(join("/api/analytics?limit=200"), { signal }),
          apiRequest<SubscriptionsResponse>(join("/api/subscriptions?pageSize=200&sort=monthlyCost&order=desc"), { signal }),
        ]);

        if (signal?.aborted) return;
        if (analyticsResult.status === "rejected") throw analyticsResult.reason;

        setAnalytics(analyticsResult.value);

        if (subscriptionsResult.status === "fulfilled") {
          setSubscriptions(subscriptionsResult.value.data);
          setDegraded(null);
        } else {
          setDegraded(
            subscriptionsResult.reason instanceof Error
              ? subscriptionsResult.reason.message
              : "The subscription register could not be loaded.",
          );
        }

        setError(null);
        setStatus("ready");

        // Remember the efficiency the visitor saw first, for the improvement delta.
        if (baselineEfficiency.current === null) {
          baselineEfficiency.current = Math.max(
            0,
            Math.min(100, 100 - analyticsResult.value.totalWaste.wasteRatePct),
          );
        }

        // Non-blocking secondary data.
        apiRequest<{ data: AuditEvent[] }>(join("/api/analytics/optimizations?limit=25"), { signal })
          .then((response) => {
            if (alive.current) setAudit(response.data);
          })
          .catch(() => undefined);
        apiRequest<{ data: CompanyOption[] }>(`${apiBase}/api/companies`, { signal })
          .then((response) => {
            if (alive.current) setCompanies(response.data);
          })
          .catch(() => undefined);
      } catch (caught) {
        if (signal?.aborted) return;
        setError({
          message: caught instanceof Error ? caught.message : "Unknown error while loading spend data.",
          code: caught instanceof ApiError ? caught.code : undefined,
        });
        setStatus("error");
      }
    },
    [apiBase, tenantId],
  );

  useEffect(() => {
    const controller = new AbortController();
    void loadData({ signal: controller.signal });
    return () => controller.abort();
  }, [loadData]);

  /* ---------------------------------------------------------------------- */
  /* EFFECT 2 — lazily load the seat register for an expanded inventory row  */
  /* ---------------------------------------------------------------------- */
  const toggleRow = useCallback(
    (row: InventoryRow) => {
      if (seatCache[row.id]) {
        // Collapse: drop the cached rows for this vendor.
        setSeatCache((previous) => {
          const next = { ...previous };
          delete next[row.id];
          return next;
        });
        return;
      }
      setLoadingSeatsFor(row.id);
      apiRequest<{ data: { seatMappings: SeatRow[] } }>(`${apiBase}/api/subscriptions/${row.id}`)
        .then((response) => {
          if (!alive.current) return;
          setSeatCache((previous) => ({ ...previous, [row.id]: response.data.seatMappings }));
        })
        .catch((caught) => {
          if (alive.current) {
            setToast({
              message: caught instanceof Error ? caught.message : "Could not load the seat register.",
              tone: "error",
            });
          }
        })
        .finally(() => {
          if (alive.current) setLoadingSeatsFor(null);
        });
    },
    [apiBase, seatCache],
  );

  /* ---------------------------------------------------------------------- */
  /* HANDLER — handleResolve: POST optimize, then re-fetch everything        */
  /* ---------------------------------------------------------------------- */
  const handleResolve = useCallback(
    async (input: { vendorId: number; action: FindingAction; seats?: number; findingKind: string; label?: string }) => {
      if (input.action === "review") {
        setToast({ message: "Review-only finding: open a renewal negotiation before the deadline.", tone: "success" });
        return;
      }

      const key = `${input.vendorId}:${input.action}`;
      setPendingKey(key);
      setToast(null);

      try {
        const response = await apiRequest<{
          ok: true;
          message: string;
          data: { seatsReclaimed: number; savings: { monthlyDisplay: string; annualizedDisplay: string } };
        }>(`${apiBase}/api/subscriptions/${input.vendorId}/optimize`, {
          method: "POST",
          body: {
            action: input.action,
            ...(input.action === "reclaim_seats" && input.seats ? { seatsToReclaim: input.seats } : {}),
            reason: `Applied from SaaSify Clean (${input.findingKind})`,
            performedBy: "cfo@saasify.clean",
          },
        });

        setToast({ message: response.message, tone: "success" });

        // Re-fetch so every metric panel reflects the persisted write-back.
        await loadData({ background: true });
      } catch (caught) {
        setToast({
          message: caught instanceof Error ? `Optimization failed — ${caught.message}` : "Optimization failed.",
          tone: "error",
        });
      } finally {
        if (alive.current) setPendingKey(null);
      }
    },
    [apiBase, loadData],
  );

  /* ------------------------------- derived ------------------------------- */
  const findings = useMemo(() => (analytics ? buildFindings(analytics) : []), [analytics]);
  const inventory = useMemo(
    () => (analytics ? buildInventory(subscriptions, analytics) : []),
    [analytics, subscriptions],
  );
  const recoveredCents = useMemo(() => audit.reduce((sum, event) => sum + event.savingsCents, 0), [audit]);

  const visibleInventory = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = inventory.filter((row) => {
      const matchesQuery =
        needle.length === 0 ||
        row.vendor.toLowerCase().includes(needle) ||
        row.category.toLowerCase().includes(needle) ||
        row.contractOwner.toLowerCase().includes(needle);
      const matchesFilter =
        filter === "all"
          ? true
          : filter === "leaks"
            ? row.wasteCents > 0
            : filter === "zombie"
              ? row.isZombie
              : filter === "duplicate"
                ? row.isDuplicate
                : row.wasteCents === 0 && !row.isZombie;
      return matchesQuery && matchesFilter;
    });

    return filtered.sort((a, b) => {
      if (sortKey === "cost") return b.monthlyCostCents - a.monthlyCostCents;
      if (sortKey === "health") return a.healthScore - b.healthScore;
      if (sortKey === "seats") return b.seatsPaid - a.seatsPaid;
      return b.wasteCents - a.wasteCents || b.monthlyCostCents - a.monthlyCostCents;
    });
  }, [inventory, query, filter, sortKey]);

  const efficiency = analytics ? Math.max(0, Math.min(100, 100 - analytics.totalWaste.wasteRatePct)) : 0;
  const efficiencyDelta = baselineEfficiency.current === null ? 0 : efficiency - baselineEfficiency.current;

  const leaks = useMemo(
    () => (analytics ? findings.filter((finding) => finding.impactCents > 0).length : 0),
    [analytics, findings],
  );

  const refresh = useCallback(() => void loadData({ background: status === "ready" }), [loadData, status]);

  /* --------------------------------- states ------------------------------ */
  if (status === "loading" && !analytics) return <Skeleton />;

  if (status === "error" || !analytics) {
    return (
      <OfflineState
        message={error?.message ?? "The spend API returned no data."}
        code={error?.code}
        onRetry={refresh}
        retrying={status === "loading"}
      />
    );
  }

  const { totalSpend, totalWaste, estate } = analytics;
  const detectorHits = (id: Detector["id"]) => analytics.detectors.find((detector) => detector.id === id)?.hits ?? 0;

  /* --------------------------------- render ------------------------------ */
  return (
    <div className="min-h-screen bg-[#020617] text-slate-300 antialiased">
      {/* ambient executive glow */}
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(1100px_520px_at_15%_-10%,rgba(16,185,129,0.10),transparent),radial-gradient(900px_500px_at_85%_-5%,rgba(56,189,248,0.08),transparent),radial-gradient(700px_400px_at_50%_120%,rgba(244,63,94,0.05),transparent)]" />

      <div className="relative mx-auto max-w-[1500px] space-y-5 px-5 pb-16 pt-6">
        {/* product bar */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-400 to-teal-600 text-sm font-black text-slate-950 shadow-[0_0_15px_rgba(16,185,129,0.35)]">
              ⇅
            </span>
            <span className="text-sm font-semibold tracking-tight text-white">
              SaaSify <span className="text-emerald-400">Clean</span>
            </span>
            <span className="hidden text-[11px] text-slate-500 sm:inline">
              SaaS spend intelligence · {analytics.company.domain}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {status === "refreshing" && <PulseBadge tone="sky">recalculating</PulseBadge>}
            {companies.length > 1 && (
              <select
                value={tenantId ?? analytics.company.id}
                onChange={(event) => setTenantId(Number(event.target.value))}
                className="rounded-lg border border-slate-800 bg-slate-900/60 px-2.5 py-1.5 text-xs text-slate-200 backdrop-blur-md transition hover:border-slate-700 focus:border-emerald-500/60 focus:outline-none"
              >
                {companies.map((company) => (
                  <option key={company.id} value={company.id}>
                    {company.name} · {company.active_subscriptions} contracts
                  </option>
                ))}
              </select>
            )}
            <a
              href={`${apiBase}/api/analytics`}
              target="_blank"
              rel="noreferrer"
              className="rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-1.5 text-xs font-medium text-slate-300 backdrop-blur-md transition hover:border-slate-700 hover:text-white"
            >
              Raw API
            </a>
            <button
              type="button"
              onClick={() => {
                if (!canUseDom) return;
                const blob = new Blob([JSON.stringify({ analytics, subscriptions, audit }, null, 2)], {
                  type: "application/json",
                });
                const url = URL.createObjectURL(blob);
                const link = document.createElement("a");
                link.href = url;
                link.download = `saasify-clean-${analytics.company.domain}.json`;
                link.click();
                URL.revokeObjectURL(url);
              }}
              className="rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-1.5 text-xs font-medium text-slate-300 backdrop-blur-md transition hover:border-slate-700 hover:text-white"
            >
              Export
            </button>
          </div>
        </div>

        {degraded && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 backdrop-blur-md">
            <p className="text-xs text-amber-200">
              <span className="mr-2 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider">
                degraded
              </span>
              {degraded} Metrics and the action feed still reflect the live analytics endpoint.
            </p>
            <ActionButton variant="ghost" tone="slate" onClick={refresh}>
              Retry register
            </ActionButton>
          </div>
        )}

        {/* 1. INTRO + VALUE PROP — two columns */}
        <HeroBanner
          companyName={analytics.company.name || fallbackCompanyName}
          headcount={analytics.company.headcount}
          metrics={{
            recoverableCents: totalWaste.monthlyCents,
            monthlySpendCents: totalSpend.monthlyCents,
            wasteRatePct: totalWaste.wasteRatePct,
            leaks,
          }}
          onRefresh={refresh}
          refreshing={status === "refreshing"}
          stats={{
            source: `${estate.subscriptionsActive} contracts synced`,
            matched: totalSpend.seatsPaid,
            saved: usd(recoveredCents),
          }}
        />

        {/* 2. METRICS BAR */}
        <MetricsBar
          spend={totalSpend.monthlyCents}
          waste={totalWaste.monthlyCents}
          subscriptions={totalSpend.activeSubscriptions}
          recovered={recoveredCents}
          efficiency={efficiency}
          efficiencyDelta={efficiencyDelta}
          ghosts={detectorHits("STALE_LICENSE")}
          zombies={detectorHits("ZOMBIE_SOFTWARE")}
          overlaps={totalWaste.duplicateVendorCount}
          seatsPaid={totalSpend.seatsPaid}
          activeSeats={totalSpend.activeSeats}
          utilization={totalSpend.seatUtilisationPct}
          avgHealth={totalSpend.averageHealthScore}
        />

        {/* 3. FEED + SIDE RAIL */}
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
          <div className="space-y-5 xl:col-span-2">
            <GlassCard className="overflow-hidden">
              <CardHeader
                title="Optimisation feed"
                subtitle={`${findings.length} systematic recommendations · ${usd(totalWaste.monthlyCents)}/month recoverable · ranked by impact`}
                action={
                  <div className="flex flex-wrap gap-1.5">
                    {(
                      [
                        ["all", findings.length],
                        ["ghost_seats", findings.filter((finding) => finding.kind === "ghost_seats").length],
                        ["zombie_software", findings.filter((finding) => finding.kind === "zombie_software").length],
                        ["overlap_duplication", findings.filter((finding) => finding.kind === "overlap_duplication").length],
                      ] as const
                    ).map(([key, count]) => (
                      <span
                        key={key}
                        className="rounded-full border border-slate-800 bg-slate-950/60 px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider text-slate-400"
                      >
                        {key === "all" ? "all detectors" : key.replace(/_/g, " ")} · {count}
                      </span>
                    ))}
                  </div>
                }
              />
              <div id="optimisation-feed" className="max-h-[860px] space-y-3 overflow-y-auto p-4">
                {findings.length === 0 && (
                  <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-6 text-center">
                    <p className="text-sm font-semibold text-emerald-300">🎉 No leaks detected in this estate</p>
                    <p className="mt-1 text-xs text-slate-400">
                      Every billed licence is attached to a user who logged in this month. Re-run the analysis after your
                      next invoice cycle.
                    </p>
                  </div>
                )}
                {findings.map((finding) => (
                  <FindingCard
                    key={finding.id}
                    finding={finding}
                    pendingKey={pendingKey}
                    busy={pendingKey === `${finding.vendorId}:${finding.action}`}
                    onResolve={(item) =>
                      void handleResolve({
                        vendorId: item.vendorId ?? 0,
                        action: item.action,
                        seats: item.seatsAffected,
                        findingKind: item.kind,
                      })
                    }
                  />
                ))}
              </div>
            </GlassCard>

            {/* INVENTORY */}
            <GlassCard className="overflow-hidden">
              <CardHeader
                title="Licence inventory"
                subtitle={`${visibleInventory.length} of ${inventory.length} contracts · click a row for the live seat register`}
                action={
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="Search platform, category, owner…"
                      className="w-56 rounded-lg border border-slate-800 bg-slate-950/70 px-3 py-1.5 text-xs text-slate-200 placeholder:text-slate-500 transition focus:border-emerald-500/60 focus:outline-none"
                    />
                    <select
                      value={sortKey}
                      onChange={(event) => setSortKey(event.target.value as typeof sortKey)}
                      className="rounded-lg border border-slate-800 bg-slate-950/70 px-2.5 py-1.5 text-xs text-slate-200 transition hover:border-slate-700 focus:border-emerald-500/60 focus:outline-none"
                    >
                      <option value="waste">Sort: biggest leak</option>
                      <option value="cost">Sort: monthly cost</option>
                      <option value="health">Sort: worst health</option>
                      <option value="seats">Sort: most seats</option>
                    </select>
                  </div>
                }
              />
              <div className="flex flex-wrap gap-1.5 px-5 pt-4">
                {(
                  [
                    ["all", "All contracts", "slate"],
                    ["leaks", "Leaking", "rose"],
                    ["zombie", "Zombie", "rose"],
                    ["duplicate", "Overlapping", "amber"],
                    ["healthy", "Clean", "emerald"],
                  ] as const
                ).map(([key, label, tone]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setFilter(key)}
                    className={`rounded-full px-3 py-1 text-[11px] font-medium transition-all duration-200 hover:scale-[1.03] ${
                      filter === key
                        ? tone === "rose"
                          ? "bg-rose-500/15 text-rose-300 ring-1 ring-inset ring-rose-500/30"
                          : tone === "amber"
                            ? "bg-amber-500/15 text-amber-300 ring-1 ring-inset ring-amber-500/30"
                            : tone === "emerald"
                              ? "bg-emerald-500/15 text-emerald-300 ring-1 ring-inset ring-emerald-500/30"
                              : "bg-slate-500/15 text-slate-200 ring-1 ring-inset ring-slate-500/30"
                        : "border border-slate-800 text-slate-400 hover:border-slate-700 hover:text-slate-200"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="mt-3">
                <InventoryTable
                  rows={visibleInventory}
                  pendingKey={pendingKey}
                  seatCache={seatCache}
                  loadingSeatsFor={loadingSeatsFor}
                  onToggleRow={toggleRow}
                  onResolve={(row, action) =>
                    void handleResolve({
                      vendorId: row.id,
                      action,
                      seats: Math.max(row.staleSeats, 1),
                      findingKind: action === "cancel" ? "zombie_software" : action === "consolidate" ? "overlap_duplication" : "ghost_seats",
                    })
                  }
                />
              </div>
              {visibleInventory.length === 0 && (
                <p className="px-5 py-6 text-center text-xs text-slate-500">
                  No contracts match this filter.
                </p>
              )}
            </GlassCard>
          </div>

          {/* SIDE RAIL */}
          <div className="space-y-5">
            <GlassCard className="overflow-hidden">
              <CardHeader title="Leak breakdown" subtitle="Each dollar counted exactly once per month" />
              <div className="space-y-3 p-4">
                {totalWaste.breakdown.map((bucket) => (
                  <div key={bucket.key}>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-300">{bucket.label}</span>
                      <span className="tabular-nums text-slate-400">{usd(bucket.monthlyCents)}</span>
                    </div>
                    <div className="mt-1.5">
                      <Meter
                        value={bucket.monthlyCents > 0 ? (bucket.monthlyCents / Math.max(totalWaste.monthlyCents, 1)) * 100 : 0}
                        color={
                          bucket.key === "zombie_subscriptions"
                            ? "#f43f5e"
                            : bucket.key === "duplicate_categories"
                              ? "#38bdf8"
                              : "#fbbf24"
                        }
                      />
                    </div>
                    <p className="mt-1 text-[10px] uppercase tracking-wider text-slate-500">
                      {bucket.seats} · {pct(bucket.shareOfWastePct, 0)} of the leak
                    </p>
                  </div>
                ))}
                <div className="space-y-1.5 rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-[11px]">
                  <div className="flex items-center justify-between text-slate-400">
                    <span>Identified this cycle</span>
                    <span className="tabular-nums text-slate-200">{usd(totalWaste.monthlyCents)}/mo</span>
                  </div>
                  <div className="flex items-center justify-between text-slate-400">
                    <span>Already recovered</span>
                    <span className="tabular-nums text-emerald-400">{usd(recoveredCents)}/mo</span>
                  </div>
                  <div className="flex items-center justify-between border-t border-slate-800 pt-1.5 font-semibold text-white">
                    <span>Annual impact</span>
                    <span className="tabular-nums">{usdCompact((totalWaste.monthlyCents + recoveredCents) * 12)}</span>
                  </div>
                </div>
              </div>
            </GlassCard>

            <GlassCard className="overflow-hidden">
              <CardHeader title="Top leak offenders" subtitle="Ranked by monthly dollars at risk" />
              <ul className="divide-y divide-slate-800/70">
                {analytics.topWasteOffenders.slice(0, 6).map((offender) => (
                  <li
                    key={offender.subscriptionId}
                    className="flex items-center gap-3 px-4 py-3 transition hover:-translate-y-0.5 hover:bg-slate-900/50"
                  >
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-800 bg-slate-950/70 text-sm">
                      {logoFor(offender.vendorName)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-semibold text-white">{offender.vendorName}</p>
                      <p className="text-[11px] text-slate-500">
                        {offender.activeSeats}/{offender.seatsPaid} active · {offender.categoryGroup}
                      </p>
                    </div>
                    <span className="shrink-0 text-xs font-semibold tabular-nums text-rose-400">
                      −{usd(offender.wasteCents)}
                    </span>
                  </li>
                ))}
              </ul>
            </GlassCard>

            <GlassCard className="overflow-hidden">
              <CardHeader title="Duplicate platforms" subtitle="Two tools, one job — consolidation targets" />
              {analytics.duplicateCategories.length === 0 ? (
                <p className="px-4 py-4 text-xs text-slate-400">No overlapping categories detected.</p>
              ) : (
                <ul className="divide-y divide-slate-800/70">
                  {analytics.duplicateCategories.slice(0, 5).map((group) => (
                    <li key={group.categoryGroup} className="px-4 py-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-semibold text-white">{group.categoryGroup}</p>
                        <span className="text-[11px] tabular-nums text-amber-400">
                          {group.duplicateWasteCents > 0 ? `${group.duplicateWasteDisplay}/mo` : "counted elsewhere"}
                        </span>
                      </div>
                      <p className="mt-1 text-[11px] text-slate-400">
                        {group.vendorCount} vendors · {group.categoryMonthlyDisplay}/mo total
                      </p>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {group.vendors.map((vendor) => (
                          <span
                            key={vendor.subscriptionId}
                            className={`rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset ${
                              vendor.isIncumbent
                                ? "bg-emerald-500/10 text-emerald-300 ring-emerald-500/20"
                                : "bg-slate-500/10 text-slate-400 ring-slate-500/20"
                            }`}
                          >
                            {vendor.vendorName}
                            {vendor.isIncumbent ? " · incumbent" : ""}
                          </span>
                        ))}
                      </div>
                      {group.note && <p className="mt-1.5 text-[10px] text-slate-500">{group.note}</p>}
                    </li>
                  ))}
                </ul>
              )}
            </GlassCard>

            <GlassCard className="overflow-hidden">
              <CardHeader title="Renewal radar" subtitle="Contracts renewing inside 45 days" />
              <ul className="divide-y divide-slate-800/70">
                {analytics.upcomingRenewals.slice(0, 6).map((renewal) => (
                  <li key={renewal.subscriptionId} className="flex items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium text-slate-200">{renewal.vendorName}</p>
                      <p className="text-[11px] text-slate-500">
                        {shortDate(renewal.nextRenewalAt)} · {renewal.monthlyDisplay}/mo
                      </p>
                    </div>
                    <PulseBadge tone={renewal.daysUntilRenewal <= 14 ? "rose" : "amber"} pulse={renewal.daysUntilRenewal <= 14}>
                      {renewal.daysUntilRenewal}d
                    </PulseBadge>
                  </li>
                ))}
                {analytics.upcomingRenewals.length === 0 && (
                  <li className="px-4 py-4 text-xs text-slate-400">Nothing renews in the next 45 days.</li>
                )}
              </ul>
            </GlassCard>

            <GlassCard className="overflow-hidden">
              <CardHeader
                title="Decision log"
                subtitle="Every click is persisted to the audit ledger"
                action={<PulseBadge tone="emerald" pulse={false}>{audit.length} events</PulseBadge>}
              />
              {audit.length === 0 ? (
                <p className="px-4 py-4 text-xs text-slate-400">
                  No optimisations applied yet. Approve a recommendation above — the write-back is transactional and the
                  metrics recalculate immediately.
                </p>
              ) : (
                <ol className="max-h-96 space-y-3 overflow-y-auto p-4">
                  {audit.map((event) => (
                    <li key={event.id} className="relative border-l border-emerald-500/40 pl-4">
                      <span className="absolute -left-[5px] top-1.5 h-2.5 w-2.5 rounded-full bg-emerald-400 shadow-[0_0_10px_rgba(16,185,129,0.8)]" />
                      <p className="text-xs font-medium text-slate-200">
                        {event.action.replace(/_/g, " ")} · {event.vendorName}
                      </p>
                      <p className="mt-0.5 text-[11px] text-slate-400">
                        {event.detail ?? `Recurring cost set to ${usd(event.newCostCents)}/month.`}
                      </p>
                      <p className="mt-1 text-[10px] uppercase tracking-wider text-slate-500">
                        {dateTime(event.createdAt)} · {event.performedBy} · +{event.savingsDisplay}/mo
                      </p>
                    </li>
                  ))}
                </ol>
              )}
            </GlassCard>

            <GlassCard className="overflow-hidden">
              <CardHeader title="Detection engine" subtitle="Live rules with this cycle's hit count" />
              <ul className="divide-y divide-slate-800/70">
                {analytics.detectors.map((detector) => (
                  <li key={detector.id} className="px-4 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-semibold text-white">{detector.id.replace(/_/g, " ")}</p>
                      <span className="text-[11px] font-semibold tabular-nums text-rose-400">
                        {detector.hits} hit{detector.hits === 1 ? "" : "s"}
                      </span>
                    </div>
                    <p className="mt-1 font-mono text-[10px] leading-relaxed text-slate-500">{detector.rule}</p>
                    <p className="mt-1 text-[11px] text-slate-400">
                      {usd(detector.monthlyCents)}/mo attributed · window {analytics.windows.staleLicenseDays}d /{" "}
                      {analytics.windows.activeSeatDays}d
                    </p>
                  </li>
                ))}
              </ul>
            </GlassCard>
          </div>
        </div>

        <footer className="border-t border-slate-800 pt-5 text-[11px] leading-relaxed text-slate-500">
          <p>
            SaaSify Clean · live audit of <span className="text-slate-400">{analytics.company.name}</span> · metrics from{" "}
            <span className="font-mono text-slate-400">GET /api/analytics</span>, register from{" "}
            <span className="font-mono text-slate-400">GET /api/subscriptions</span>, decisions via{" "}
            <span className="font-mono text-slate-400">POST /api/subscriptions/:id/optimize</span> · last calculation{" "}
            {dateTime(analytics.generatedAt)}.
          </p>
          <p className="mt-1">
            Read-only discovery: nothing is cancelled until you approve it, and every approval is written to the audit
            ledger before the metrics recalculate.
          </p>
        </footer>
      </div>

      {toast && <Toast message={toast.message} tone={toast.tone} onClose={() => setToast(null)} />}
    </div>
  );
}
