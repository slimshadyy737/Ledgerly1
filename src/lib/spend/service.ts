/**
 * ---------------------------------------------------------------------------
 * Spend API service (Next.js runtime)
 * ---------------------------------------------------------------------------
 * Server-only module (imports the PostgreSQL pool). Implements the canonical
 * REST contract documented in `src/lib/spend/types.ts`:
 *
 *   getAnalytics()          -> GET  /api/analytics            (spend + waste)
 *   listSubscriptions()     -> GET  /api/subscriptions        (contract register)
 *   getSubscription()       -> GET  /api/subscriptions/:id    (seats + history)
 *   optimizeSubscription()  -> POST /api/subscriptions/:id/optimize (write-back)
 *
 * Mirrors `server/src/services/*.js` (Express) statement for statement, so the
 * React dashboard can switch between the two backends without code changes.
 */
import fs from "node:fs/promises";
import path from "node:path";
import type { PoolClient } from "pg";
import { pool } from "@/db";
import { usd, usdExact } from "@/lib/format";
import type {
  AnalyticsResponse,
  CategorySpendDTO,
  CompaniesResponse,
  DetectorDTO,
  DuplicateCategoryDTO,
  DuplicateVendorDTO,
  OptimizationEventDTO,
  OptimizeAction,
  OptimizeResponse,
  OptimizationsResponse,
  RenewalDTO,
  SeatMappingDTO,
  StaleLicenseDTO,
  SubscriptionDTO,
  SubscriptionDetailDTO,
  SubscriptionsListResponse,
  WasteBucket,
  WasteOffenderDTO as OffenderDTO,
} from "./types";
import {
  CATEGORY_SPEND_SQL,
  COMPANIES_SQL,
  COMPANY_BY_ID_SQL,
  COMPANY_ID_FOR_SUBSCRIPTION_SQL,
  CONSOLIDATION_TARGETS_SQL,
  DUPLICATE_CATEGORIES_SQL,
  ESTATE_SUMMARY_SQL,
  INSERT_EVENT_SQL,
  LOCK_SUBSCRIPTION_SQL,
  OPTIMIZATION_EVENTS_SQL,
  RECLAIMABLE_SEATS_SQL,
  REVOKE_ALL_SEATS_SQL,
  SEAT_MAPPINGS_SQL,
  SPEND_SUMMARY_SQL,
  STALE_LICENSES_SQL,
  SUBSCRIPTION_COLUMNS,
  SUBSCRIPTION_FILTERS,
  SUBSCRIPTION_SORTS,
  UPCOMING_RENEWALS_SQL,
  UPDATE_SUBSCRIPTION_SQL,
  WASTE_OFFENDERS_SQL,
} from "./sql";

/* --------------------------------- helpers -------------------------------- */

export class SpendApiError extends Error {
  status: number;
  code: string;
  details?: Record<string, unknown>;

  constructor(status: number, message: string, code = "error", details?: Record<string, unknown>) {
    super(message);
    this.name = "SpendApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }

  static badRequest(message: string, details?: Record<string, unknown>) {
    return new SpendApiError(400, message, "validation_error", details);
  }
  static notFound(message = "Resource not found") {
    return new SpendApiError(404, message, "not_found");
  }
  static conflict(message: string) {
    return new SpendApiError(409, message, "conflict");
  }
  static unprocessable(message: string, details?: Record<string, unknown>) {
    return new SpendApiError(422, message, "unprocessable_entity", details);
  }
  static unavailable(message: string, details?: Record<string, unknown>) {
    return new SpendApiError(503, message, "backend_unavailable", details);
  }
}

const num = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};
const cents = (value: unknown): number => Math.trunc(num(value));
const pct = (value: unknown, digits = 1): number => Number(num(value).toFixed(digits));
const iso = (value: unknown): string | null => (value ? new Date(value as string).toISOString() : null);

const DEFAULT_STALE_DAYS = 60;
const DEFAULT_ACTIVE_DAYS = 30;

/* ------------------------- schema bootstrap (safety net) ------------------- */

let bootstrapPromise: Promise<void> | null = null;

async function runSqlFile(relativePath: string): Promise<void> {
  const absolute = path.join(process.cwd(), relativePath);
  const sql = await fs.readFile(absolute, "utf8");
  await pool.query(sql);
}

/**
 * A fresh environment may not have the spend tables yet. Rather than failing with
 * a confusing 500, the API bootstraps the canonical schema (and the small
 * ghost-seat demo tenant) on first use. Idempotent: both files use
 * IF NOT EXISTS / ON CONFLICT / DELETE-then-INSERT.
 */
export async function ensureSpendSchemaReady(): Promise<void> {
  if (bootstrapPromise) return bootstrapPromise;

  bootstrapPromise = (async () => {
    const table = await pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'subscriptions'`,
    );

    if (table.rowCount === 0) {
      await runSqlFile("server/src/db/schema.sql");
    }
    const view = await pool.query(
      `SELECT 1 FROM information_schema.views
        WHERE table_schema = 'public' AND table_name = 'v_subscription_activity'`,
    );
    if (view.rowCount === 0) {
      await runSqlFile("server/src/db/schema.sql");
    }

    const companies = await pool.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM companies`,
    );
    if (num(companies.rows[0]?.count) === 0) {
      await runSqlFile("server/src/db/seed_ghost_seat_demo.sql");
    }
  })().catch((error: unknown) => {
    bootstrapPromise = null;
    throw SpendApiError.unavailable(
      `Spend API backend is not initialised: ${error instanceof Error ? error.message : String(error)}. ` +
        "Run `node server/src/db/migrate.js && node server/src/db/seed.js` (or `psql -f server/src/db/schema.sql`).",
    );
  });

  return bootstrapPromise;
}

/* ------------------------------ tenant helpers ----------------------------- */

interface CompanyRow {
  id: number;
  name: string;
  domain: string;
  currency: string;
  headcount: number;
  stale_license_days: number;
  active_seat_days: number;
}

/** Resolves the tenant: explicit id, or the first company in the database. */
async function resolveCompany(companyId: number | null): Promise<CompanyRow> {
  await ensureSpendSchemaReady();

  if (companyId !== null) {
    const result = await pool.query<CompanyRow>(COMPANY_BY_ID_SQL, [companyId]);
    if (!result.rows[0]) throw SpendApiError.notFound(`Company ${companyId} not found`);
    return result.rows[0];
  }

  const companies = await pool.query<CompanyRow>(COMPANIES_SQL);
  const first = companies.rows[0];
  if (!first) {
    throw SpendApiError.unavailable(
      "No company data found. Load a tenant first: `node server/src/db/seed.js` or `psql -f server/src/db/seed_ghost_seat_demo.sql`.",
    );
  }
  return first;
}

/** A subscription id implies its tenant; an explicit companyId is enforced. */
async function resolveSubscriptionTenant(companyId: number | null, subscriptionId: number): Promise<number> {
  await ensureSpendSchemaReady();
  const result = await pool.query<{ company_id: number }>(COMPANY_ID_FOR_SUBSCRIPTION_SQL, [subscriptionId]);
  const owner = result.rows[0]?.company_id;
  if (owner === undefined || owner === null) throw SpendApiError.notFound(`Subscription ${subscriptionId} not found`);
  if (companyId !== null && companyId !== owner) throw SpendApiError.notFound(`Subscription ${subscriptionId} not found`);
  return owner;
}

/* ------------------------------- GET analytics ----------------------------- */

export interface AnalyticsOptions {
  companyId?: number | null;
  asOf?: Date;
  staleDays?: number | null;
  activeDays?: number | null;
  limitPerSection?: number;
}

export async function getAnalytics(options: AnalyticsOptions = {}): Promise<AnalyticsResponse> {
  const company = await resolveCompany(options.companyId ?? null);
  const asOf = options.asOf ?? new Date();
  const staleDays = options.staleDays ?? company.stale_license_days ?? DEFAULT_STALE_DAYS;
  const activeDays = options.activeDays ?? company.active_seat_days ?? DEFAULT_ACTIVE_DAYS;
  const limit = options.limitPerSection ?? 25;
  const scope = [company.id, asOf, staleDays, activeDays];

  const [summary, estate, duplicates, staleLicences, offenders, categorySpend, renewals] = await Promise.all([
    pool.query(SPEND_SUMMARY_SQL, scope),
    pool.query(ESTATE_SUMMARY_SQL, [company.id]),
    pool.query(DUPLICATE_CATEGORIES_SQL, scope),
    pool.query(STALE_LICENSES_SQL, [...scope, limit]),
    pool.query(WASTE_OFFENDERS_SQL, [...scope, limit]),
    pool.query(CATEGORY_SPEND_SQL, scope),
    pool.query(UPCOMING_RENEWALS_SQL, [company.id, 45]),
  ]);

  const s = (summary.rows[0] ?? {}) as Record<string, unknown>;
  const e = (estate.rows[0] ?? {}) as Record<string, unknown>;

  const monthlySpendCents = cents(s.monthly_spend_cents);
  const totalWasteCents = cents(s.total_waste_cents);

  const buckets: Omit<WasteBucket, "monthlyDisplay" | "annualizedCents" | "shareOfWastePct">[] = [
    {
      key: "stale_licenses",
      label: `Licences unused for ${staleDays}+ days (or held by leavers)`,
      monthlyCents: cents(s.stale_license_waste_cents),
      seats: num(s.stale_seats),
      detector: "STALE_LICENSE",
    },
    {
      key: "duplicate_categories",
      label: "Redundant tools in the same category group",
      monthlyCents: cents(s.duplicate_category_waste_cents),
      seats: num(s.duplicate_subscriptions),
      detector: "DUPLICATE_CATEGORY",
    },
    {
      key: "idle_seats",
      label: "Paid seats never provisioned to a user",
      monthlyCents: cents(s.idle_seat_waste_cents),
      seats: num(s.idle_seats),
      detector: "IDLE_SEAT",
    },
    {
      key: "zombie_subscriptions",
      label: `Zero active users for ${activeDays}+ days — the whole invoice is waste`,
      monthlyCents: cents(s.zombie_waste_cents),
      seats: num(s.zombie_subscriptions),
      detector: "ZOMBIE_SOFTWARE",
    },
  ];
  const breakdown: WasteBucket[] = buckets.map((bucket) => ({
    ...bucket,
    monthlyDisplay: usd(bucket.monthlyCents),
    annualizedCents: bucket.monthlyCents * 12,
    shareOfWastePct: pct(totalWasteCents > 0 ? (bucket.monthlyCents / totalWasteCents) * 100 : 0),
  }));

  const detectors: DetectorDTO[] = [
    {
      id: "STALE_LICENSE",
      rule: `seat_mappings.status = 'active' AND (users.status = 'terminated' OR seat_mappings.last_login_at < as_of - ${staleDays} days OR last_login_at IS NULL)`,
      waste: "SUM(seat_mappings.seat_cost_cents) of those rows",
      monthlyCents: cents(s.stale_license_waste_cents),
      hits: num(s.stale_seats),
    },
    {
      id: "DUPLICATE_CATEGORY",
      rule: "ROW_NUMBER() OVER (PARTITION BY category_group ORDER BY adoption DESC, cost DESC) > 1 AND COUNT(*) OVER (PARTITION BY category_group) > 1",
      waste: "recurring_cost_cents of non-incumbent vendors, minus leakage already counted on the same invoice",
      monthlyCents: cents(s.duplicate_category_waste_cents),
      hits: num(s.duplicate_subscriptions),
    },
    {
      id: "IDLE_SEAT",
      rule: "subscriptions.seats_paid - COUNT(active seat_mappings) > 0",
      waste: "idle_seats * unit_cost_cents",
      monthlyCents: cents(s.idle_seat_waste_cents),
      hits: num(s.idle_seats),
    },
    {
      id: "ZOMBIE_SOFTWARE",
      rule: `per-seat contract, >= 1 assigned seat, 0 seats with a login in the last ${activeDays} days`,
      waste: "the entire recurring_cost_cents of the contract",
      monthlyCents: cents(s.zombie_waste_cents),
      hits: num(s.zombie_subscriptions),
    },
  ];

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    asOf: asOf.toISOString(),
    company: {
      id: company.id,
      name: company.name,
      domain: company.domain,
      currency: company.currency,
      headcount: num(company.headcount),
    },
    windows: { staleLicenseDays: staleDays, activeSeatDays: activeDays },
    totalSpend: {
      monthlyCents: monthlySpendCents,
      monthlyDisplay: usd(monthlySpendCents),
      annualizedCents: monthlySpendCents * 12,
      annualizedDisplay: usd(monthlySpendCents * 12),
      activeSubscriptions: num(s.active_subscriptions),
      seatsPaid: num(s.seats_paid),
      assignedSeats: num(s.assigned_seats),
      activeSeats: num(s.healthy_seats),
      seatUtilisationPct: num(s.seat_utilisation_pct),
      averageHealthScore: num(e.avg_health_score),
    },
    totalWaste: {
      monthlyCents: totalWasteCents,
      monthlyDisplay: usd(totalWasteCents),
      annualizedCents: totalWasteCents * 12,
      annualizedDisplay: usd(totalWasteCents * 12),
      wasteRatePct: pct(monthlySpendCents > 0 ? (totalWasteCents / monthlySpendCents) * 100 : 0),
      countingPolicy:
        "Each dollar is counted once per month: a zombie subscription claims its entire invoice, otherwise " +
        "stale-seat + idle-seat cost + a duplicate premium capped at (cost - already counted) is used.",
      breakdown,
      staleSeatCount: num(s.stale_seats),
      idleSeatCount: num(s.idle_seats),
      zombieCount: num(s.zombie_subscriptions),
      duplicateVendorCount: num(s.duplicate_subscriptions),
      duplicateCategoryGroupCount: num(s.duplicate_category_groups),
    },
    estate: {
      subscriptionsTotal: num(e.subscriptions_total),
      subscriptionsActive: num(e.subscriptions_active),
      subscriptionsCancelled: num(e.subscriptions_cancelled),
      subscriptionsConsolidated: num(e.subscriptions_consolidated),
      subscriptionsPaused: num(e.subscriptions_paused),
    },
    detectors,
    duplicateCategories: duplicates.rows.map((row) => {
      const vendors = ((row.vendors ?? []) as Record<string, unknown>[]).map<DuplicateVendorDTO>((vendor) => ({
        subscriptionId: num(vendor.subscriptionId),
        vendorName: String(vendor.vendorName ?? ""),
        productName: (vendor.productName as string | null) ?? null,
        category: String(vendor.category ?? ""),
        billingModel: (vendor.billingModel as DuplicateVendorDTO["billingModel"]) ?? "flat",
        monthlyCents: cents(vendor.monthlyCents),
        monthlyDisplay: usd(cents(vendor.monthlyCents)),
        seatsPaid: num(vendor.seatsPaid),
        healthySeats: num(vendor.healthySeats),
        staleSeats: num(vendor.staleSeats),
        adoptionPct: vendor.adoptionPct === null ? null : num(vendor.adoptionPct),
        categoryRank: num(vendor.categoryRank),
        isIncumbent: Boolean(vendor.isIncumbent),
        isDuplicateCandidate: Boolean(vendor.isDuplicateCandidate),
        duplicateWasteCents: cents(vendor.duplicateWasteCents),
        duplicateWasteDisplay: usd(cents(vendor.duplicateWasteCents)),
        isZombie: Boolean(vendor.isZombie),
      }));

      const duplicateWasteCents = cents(row.duplicate_waste_cents);
      const countedElsewhere = duplicateWasteCents === 0 && vendors.some((vendor) => vendor.isZombie);

      return {
        categoryGroup: String(row.category_group),
        vendorCount: num(row.vendor_count),
        categoryMonthlyCents: cents(row.category_monthly_cents),
        categoryMonthlyDisplay: usd(cents(row.category_monthly_cents)),
        duplicateWasteCents,
        duplicateWasteDisplay: usd(duplicateWasteCents),
        savingsCountedElsewhere: countedElsewhere,
        note: countedElsewhere
          ? "Duplicate tooling detected, but the redundant contract is already counted as zombie software — no double counting."
          : null,
        vendors,
      } satisfies DuplicateCategoryDTO;
    }),
    staleLicences: staleLicences.rows.map<StaleLicenseDTO>((row) => ({
      subscriptionId: num(row.subscription_id),
      vendorName: String(row.vendor_name),
      productName: (row.product_name as string | null) ?? null,
      category: String(row.category),
      categoryGroup: String(row.category_group),
      seatMappingId: num(row.seat_mapping_id),
      userId: num(row.user_id),
      userName: String(row.user_name),
      userEmail: String(row.user_email),
      department: String(row.department),
      userStatus: (row.user_status as StaleLicenseDTO["userStatus"]) ?? "active",
      reason: (row.reason as StaleLicenseDTO["reason"]) ?? "inactive_beyond_window",
      daysSinceLogin: row.days_since_login === null ? null : num(row.days_since_login),
      lastLoginAt: iso(row.last_login_at),
      loginsLast30d: num(row.logins_last_30d),
      seatCostCents: cents(row.seat_cost_cents),
      seatCostDisplay: usdExact(cents(row.seat_cost_cents)),
    })),
    topWasteOffenders: offenders.rows.map<OffenderDTO>((row) => ({
      subscriptionId: num(row.subscription_id),
      vendorName: String(row.vendor_name),
      productName: (row.product_name as string | null) ?? null,
      category: String(row.category),
      categoryGroup: String(row.category_group),
      billingModel: (row.billing_model as OffenderDTO["billingModel"]) ?? "flat",
      seatsPaid: num(row.seats_paid),
      activeSeats: num(row.healthy_seats),
      staleSeats: num(row.stale_seats),
      idleSeats: num(row.idle_seats),
      isZombie: Boolean(row.is_zombie),
      isDuplicateOfCategory: num(row.category_vendors) > 1 && num(row.category_rank) > 1,
      monthlyCents: cents(row.recurring_cost_cents),
      monthlyDisplay: usd(cents(row.recurring_cost_cents)),
      wasteCents: cents(row.line_waste_cents),
      wasteDisplay: usd(cents(row.line_waste_cents)),
      wasteAnnualizedCents: cents(row.line_waste_cents) * 12,
      wasteSources: {
        staleLicencesCents: cents(row.stale_waste_cents),
        duplicateCategoryCents: cents(row.duplicate_waste_cents),
        idleSeatsCents: cents(row.idle_waste_cents),
      },
    })),
    categorySpend: categorySpend.rows.map<CategorySpendDTO>((row) => ({
      categoryGroup: String(row.category_group),
      vendorCount: num(row.vendor_count),
      monthlyCents: cents(row.monthly_cents),
      monthlyDisplay: usd(cents(row.monthly_cents)),
      wasteCents: cents(row.waste_cents),
      seatsPaid: num(row.seats_paid),
      overlappingVendorCount: num(row.overlapping_vendor_count),
      sharePct: pct(monthlySpendCents > 0 ? (cents(row.monthly_cents) / monthlySpendCents) * 100 : 0),
    })),
    upcomingRenewals: renewals.rows.map<RenewalDTO>((row) => ({
      subscriptionId: num(row.subscription_id),
      vendorName: String(row.vendor_name),
      categoryGroup: String(row.category_group),
      monthlyCents: cents(row.recurring_cost_cents),
      monthlyDisplay: usd(cents(row.recurring_cost_cents)),
      nextRenewalAt: iso(row.next_renewal_at) ?? new Date().toISOString(),
      daysUntilRenewal: num(row.days_until_renewal),
    })),
  };
}

/* ---------------------------- formatting: contracts ------------------------ */

interface SubscriptionRow extends Record<string, unknown> {
  id: number;
  seats_paid: number;
}

export function formatSubscription(row: SubscriptionRow): SubscriptionDTO {
  const nextRenewalAt = iso(row.next_renewal_at);
  return {
    id: num(row.id),
    companyId: num(row.company_id),
    vendor: String(row.vendor_name),
    product: (row.product_name as string | null) ?? null,
    category: String(row.category),
    categoryGroup: String(row.category_group),
    billingModel: (row.billing_model as SubscriptionDTO["billingModel"]) ?? "flat",
    status: (row.status as SubscriptionDTO["status"]) ?? "active",
    currency: String(row.currency ?? "USD"),
    seatsPaid: num(row.seats_paid),
    unitCostCents: cents(row.unit_cost_cents),
    unitCostDisplay: usdExact(cents(row.unit_cost_cents)),
    monthlyCostCents: cents(row.recurring_cost_cents),
    monthlyCostDisplay: usd(cents(row.recurring_cost_cents)),
    annualizedCostCents: cents(row.recurring_cost_cents) * 12,
    seats: {
      paid: num(row.seats_paid),
      assigned: num(row.assigned_seats),
      active: num(row.healthy_seats),
      stale: num(row.stale_seats),
      idle: num(row.idle_seats),
      adoptionPct: row.adoption_pct === null || row.adoption_pct === undefined ? null : num(row.adoption_pct),
      averageDaysSinceLogin:
        row.avg_days_since_login === null || row.avg_days_since_login === undefined
          ? null
          : num(row.avg_days_since_login),
      staleCostCents: cents(row.stale_seat_cost_cents),
    },
    wasteCents: cents(row.stale_seat_cost_cents) + cents(row.recurring_cost_cents) * 0,
    healthScore: num(row.health_score),
    isZombie: Boolean(row.is_zombie),
    hasOverlappingVendors: num(row.category_vendors) > 1,
    overlappingVendorCount: num(row.category_vendors),
    contractOwner: (row.contract_owner_email as string | null) ?? null,
    nextRenewalAt,
    daysUntilRenewal: nextRenewalAt
      ? Math.max(0, Math.ceil((new Date(nextRenewalAt).getTime() - Date.now()) / 86_400_000))
      : null,
    startedAt: iso(row.started_at),
    cancelledAt: iso(row.cancelled_at),
    notes: (row.notes as string | null) ?? null,
    createdAt: iso(row.created_at) ?? new Date().toISOString(),
    updatedAt: iso(row.updated_at) ?? new Date().toISOString(),
  };
}

export function formatSeatMapping(row: Record<string, unknown>): SeatMappingDTO {
  const daysSinceLogin = row.days_since_login === null ? null : num(row.days_since_login);
  const status = (row.status as SeatMappingDTO["seatStatus"]) ?? "active";
  const userStatus = (row.user_status as SeatMappingDTO["userStatus"]) ?? "active";
  return {
    seatMappingId: num(row.id),
    userId: num(row.user_id),
    userName: String(row.user_name),
    userEmail: String(row.user_email),
    department: String(row.department),
    userStatus,
    seatStatus: status,
    seatCostCents: cents(row.seat_cost_cents),
    assignedAt: iso(row.assigned_at) ?? new Date().toISOString(),
    revokedAt: iso(row.revoked_at),
    revokedReason: (row.revoked_reason as string | null) ?? null,
    lastLoginAt: iso(row.last_login_at),
    loginsLast30d: num(row.logins_last_30d),
    daysSinceLogin,
    isStale:
      status === "active" &&
      (userStatus === "terminated" || row.last_login_at === null || (daysSinceLogin ?? 0) > DEFAULT_STALE_DAYS),
  };
}

export function formatEvent(row: Record<string, unknown>): OptimizationEventDTO {
  const payload = (row.payload ?? {}) as Record<string, unknown>;
  return {
    id: num(row.id),
    subscriptionId: num(row.subscription_id),
    vendorName: String(row.vendor_name),
    action: (row.action as OptimizationEventDTO["action"]) ?? "reclaim_seats",
    seatsReclaimed: num(row.seats_reclaimed),
    previousCostCents: cents(row.previous_cost_cents),
    newCostCents: cents(row.new_cost_cents),
    savingsCents: cents(row.savings_cents),
    savingsDisplay: usd(cents(row.savings_cents)),
    performedBy: String(row.performed_by ?? "system"),
    createdAt: iso(row.created_at) ?? new Date().toISOString(),
    detail: (payload.detail as string | undefined) ?? null,
  };
}

/* --------------------------- GET /api/subscriptions ----------------------- */

export interface ListSubscriptionsQuery {
  companyId?: string | number | null;
  status?: string | null;
  categoryGroup?: string | null;
  search?: string | null;
  minMonthlyCents?: string | number | null;
  wastefulOnly?: string | boolean | null;
  sort?: string | null;
  order?: string | null;
  page?: string | number | null;
  pageSize?: string | number | null;
}

const SUBSCRIPTION_STATUSES = ["active", "paused", "cancelled", "consolidated"];

function toInt(value: unknown, field: string, { min = 0, max = 100_000 } = {}): number | null {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) throw SpendApiError.badRequest(`"${field}" must be an integer`);
  if (parsed < min || parsed > max) throw SpendApiError.badRequest(`"${field}" must be between ${min} and ${max}`);
  return parsed;
}

export async function listSubscriptions(query: ListSubscriptionsQuery = {}): Promise<SubscriptionsListResponse> {
  const company = await resolveCompany(toInt(query.companyId, "companyId", { min: 1, max: 2_147_483_647 }));

  const page = toInt(query.page, "page", { min: 1, max: 100_000 }) ?? 1;
  const pageSize = toInt(query.pageSize, "pageSize", { min: 1, max: 200 }) ?? 25;

  const sortKey = (query.sort ?? "monthlyCost").toString();
  const order = (query.order ?? "desc").toString().toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(SUBSCRIPTION_SORTS, sortKey)) {
    throw SpendApiError.badRequest(`"sort" must be one of: ${Object.keys(SUBSCRIPTION_SORTS).join(", ")}`);
  }
  if (!["asc", "desc"].includes(order)) throw SpendApiError.badRequest('"order" must be "asc" or "desc"');

  const status = query.status ? String(query.status) : null;
  if (status && !SUBSCRIPTION_STATUSES.includes(status)) {
    throw SpendApiError.badRequest(`"status" must be one of: ${SUBSCRIPTION_STATUSES.join(", ")}`);
  }

  const filters = {
    companyId: company.id,
    status,
    categoryGroup: query.categoryGroup ? String(query.categoryGroup) : null,
    search: query.search ? String(query.search).slice(0, 120) : null,
    minMonthlyCents: toInt(query.minMonthlyCents, "minMonthlyCents", { min: 0 }),
    wastefulOnly: ["1", "true", "yes"].includes(String(query.wastefulOnly ?? "").toLowerCase()),
  };
  const params = [
    filters.companyId,
    filters.status,
    filters.categoryGroup,
    filters.search,
    filters.minMonthlyCents,
    filters.wastefulOnly,
  ];
  const orderBy = `${SUBSCRIPTION_SORTS[sortKey]} ${order.toUpperCase()}, va.subscription_id ASC`;

  const [rows, total] = await Promise.all([
    pool.query(
      `SELECT ${SUBSCRIPTION_COLUMNS}, COUNT(*) OVER ()::int AS total_count
         FROM v_subscription_activity va
        WHERE ${SUBSCRIPTION_FILTERS}
        ORDER BY ${orderBy}
        LIMIT $7 OFFSET $8`,
      [...params, pageSize, (page - 1) * pageSize],
    ),
    pool.query(
      `SELECT COUNT(*)::int AS total FROM v_subscription_activity va WHERE ${SUBSCRIPTION_FILTERS}`,
      params,
    ),
  ]);

  const totalCount = num(total.rows[0]?.total);

  return {
    ok: true,
    company: { id: company.id, name: company.name, currency: company.currency },
    pagination: {
      page,
      pageSize,
      total: totalCount,
      totalPages: Math.max(1, Math.ceil(totalCount / pageSize)),
      hasNextPage: page * pageSize < totalCount,
    },
    sort: { key: sortKey, order: order as "asc" | "desc" },
    filters: {
      status: filters.status,
      categoryGroup: filters.categoryGroup,
      search: filters.search,
      wastefulOnly: filters.wastefulOnly,
    },
    count: rows.rowCount ?? 0,
    data: rows.rows.map((row) => formatSubscription(row as SubscriptionRow)),
  };
}

/* ------------------------- GET /api/subscriptions/:id --------------------- */

export async function getSubscription(
  companyId: number | null,
  subscriptionId: number,
): Promise<{ ok: true; data: SubscriptionDetailDTO }> {
  const tenantId = await resolveSubscriptionTenant(companyId, subscriptionId);

  const [row, seats, events] = await Promise.all([
    pool.query(
      `SELECT ${SUBSCRIPTION_COLUMNS}
         FROM v_subscription_activity va
        WHERE va.company_id = $1 AND va.subscription_id = $2`,
      [tenantId, subscriptionId],
    ),
    pool.query(SEAT_MAPPINGS_SQL, [subscriptionId, 500]),
    pool.query(OPTIMIZATION_EVENTS_SQL, [tenantId, subscriptionId, 20]),
  ]);

  const subscriptionRow = row.rows[0];
  if (!subscriptionRow) throw SpendApiError.notFound(`Subscription ${subscriptionId} not found`);

  // Consolidation targets depend on the contract's normalised category group.
  const targetRows = await pool.query(CONSOLIDATION_TARGETS_SQL, [
    tenantId,
    subscriptionRow.category_group,
    subscriptionId,
  ]);

  return {
    ok: true,
    data: {
      ...formatSubscription(subscriptionRow as SubscriptionRow),
      seatMappings: seats.rows.map(formatSeatMapping),
      consolidationTargets: targetRows.rows.map((target) => ({
        id: num(target.id),
        vendor_name: String(target.vendor_name),
        product_name: (target.product_name as string | null) ?? null,
        category_group: String(target.category_group),
        seats_paid: num(target.seats_paid),
        healthy_seats: num(target.healthy_seats),
        recurring_cost_cents: cents(target.recurring_cost_cents),
      })),
      optimizationHistory: events.rows.map(formatEvent),
    },
  };
}

/* ------------------ POST /api/subscriptions/:id/optimize ------------------ */

export interface OptimizeBody {
  action?: string;
  seatsToReclaim?: number | string;
  seats?: number | string;
  allowActiveSeats?: boolean;
  reason?: string;
  performedBy?: string;
  consolidateIntoSubscriptionId?: number | string;
  status?: string;
  seatsPaid?: number | string;
  unitCostCents?: number | string;
  nextRenewalAt?: string;
  contractOwnerEmail?: string;
  notes?: string;
  productName?: string;
  companyId?: number | string;
  expectedUpdatedAt?: string;
}

const OPTIMIZE_ACTIONS: OptimizeAction[] = ["reclaim_seats", "cancel", "consolidate", "update_contract"];

/** Applies an optimization transactionally, then recomputes analytics. */
export async function optimizeSubscription(params: {
  companyId: number | null;
  subscriptionId: number;
  body: OptimizeBody;
}): Promise<OptimizeResponse> {
  const { subscriptionId, body } = params;
  const action = body.action as OptimizeAction | undefined;
  if (!action || !OPTIMIZE_ACTIONS.includes(action)) {
    throw SpendApiError.badRequest(`"action" must be one of: ${OPTIMIZE_ACTIONS.join(", ")}`);
  }

  const tenantId = await resolveSubscriptionTenant(params.companyId ?? null, subscriptionId);
  const company = await resolveCompany(tenantId);
  const staleDays = num(company.stale_license_days) || DEFAULT_STALE_DAYS;

  const requestedSeats = toInt(body.seatsToReclaim ?? body.seats, "seatsToReclaim", { min: 1 }) ?? null;
  const performedBy = body.performedBy ? String(body.performedBy).slice(0, 320) : "cfo@northwind.io";
  const reason = body.reason ? String(body.reason).slice(0, 300) : null;

  const client: PoolClient = await pool.connect();
  let outcome: {
    previousCostCents: number;
    newCostCents: number;
    seatsReclaimed: number;
    detail: string;
    eventId: number;
    vendorName: string;
  };

  try {
    await client.query("BEGIN");

    const locked = await client.query<{
      id: number;
      company_id: number;
      vendor_name: string;
      billing_model: string;
      status: string;
      seats_paid: number;
      unit_cost_cents: number;
      recurring_cost_cents: number;
      category_group: string;
      notes: string | null;
      updated_at: string;
    }>(LOCK_SUBSCRIPTION_SQL, [subscriptionId, tenantId]);

    const current = locked.rows[0];
    if (!current) throw SpendApiError.notFound(`Subscription ${subscriptionId} not found`);

    if (body.expectedUpdatedAt && new Date(body.expectedUpdatedAt).getTime() !== new Date(current.updated_at).getTime()) {
      throw SpendApiError.conflict(
        "The subscription changed since it was loaded. Re-fetch it and retry with the current updatedAt value.",
      );
    }

    const previousCostCents = cents(current.recurring_cost_cents);
    let seatsReclaimed = 0;
    let detail = "";
    const patch: Record<string, unknown> = {};
    let clamped = false;

    if (action === "reclaim_seats") {
      if (current.billing_model !== "per_seat" || num(current.seats_paid) === 0) {
        throw SpendApiError.unprocessable(
          `${current.vendor_name} is billed as "${current.billing_model}" — there are no seats to reclaim. Use "cancel" or "update_contract" instead.`,
        );
      }
      if (current.status !== "active") {
        throw SpendApiError.conflict(`${current.vendor_name} is ${current.status}; no active seats to reclaim.`);
      }

      const reclaimable = await client.query<{ id: number; user_id: number; seat_cost_cents: number }>(
        RECLAIMABLE_SEATS_SQL,
        [subscriptionId, staleDays, num(current.seats_paid)],
      );
      const deadSeats = reclaimable.rowCount ?? 0;
      const ceiling = body.allowActiveSeats === true ? num(current.seats_paid) : deadSeats;
      const target = requestedSeats === null ? ceiling : Math.min(requestedSeats, ceiling);
      clamped = requestedSeats !== null && requestedSeats > ceiling && body.allowActiveSeats !== true;

      if (target === 0) {
        throw SpendApiError.unprocessable(
          `${current.vendor_name} has no dead seats (0 offboarded / 0 inactive beyond the ${staleDays}-day window).`,
        );
      }

      const revoked = reclaimable.rows.slice(0, target);
      const ids = revoked.map((seat) => seat.id);
      if (ids.length > 0) {
        await client.query(
          `UPDATE seat_mappings
              SET status = 'revoked', revoked_at = now(), revoked_reason = $2
            WHERE id = ANY($1::int[])`,
          [ids, reason ?? "Reclaimed via /api/subscriptions/:id/optimize"],
        );
      }
      seatsReclaimed = ids.length;

      const nextSeats = Math.max(0, num(current.seats_paid) - seatsReclaimed);
      patch.seatsPaid = nextSeats;
      patch.recurringCostCents = nextSeats * num(current.unit_cost_cents);
      patch.notes = buildNote(current.notes, `${seatsReclaimed} seat(s) reclaimed`);
      detail =
        `Revoked ${seatsReclaimed} seat grant(s); licence count ${num(current.seats_paid)} -> ${nextSeats}.` +
        (clamped ? ` Request clamped to ${deadSeats} reclaimable seat(s) — no active user was touched.` : "");
    }

    if (action === "cancel" || action === "consolidate") {
      if (current.status !== "active") {
        throw SpendApiError.conflict(`${current.vendor_name} is already ${current.status}.`);
      }

      let targetName: string | null = null;
      if (action === "consolidate") {
        const targetRows = await client.query<{ id: number; vendor_name: string }>(CONSOLIDATION_TARGETS_SQL, [
          tenantId,
          current.category_group,
          subscriptionId,
        ]);
        if (targetRows.rowCount === 0) {
          throw SpendApiError.unprocessable(
            `No consolidation target exists in category group "${current.category_group}" — this subscription is the only tool there.`,
          );
        }
        const requestedTarget = toInt(body.consolidateIntoSubscriptionId, "consolidateIntoSubscriptionId", {
          min: 1,
          max: 2_147_483_647,
        });
        const target = requestedTarget
          ? targetRows.rows.find((row) => num(row.id) === requestedTarget)
          : targetRows.rows[0];
        if (!target) {
          throw SpendApiError.badRequest(
            `Subscription ${requestedTarget} is not an active vendor in category group "${current.category_group}".`,
          );
        }
        targetName = target.vendor_name;
      }

      const revoked = await client.query<{ id: number }>(REVOKE_ALL_SEATS_SQL, [
        subscriptionId,
        action === "consolidate"
          ? `Migrated to ${targetName} (consolidation)`
          : reason ?? "Contract cancelled via spend API",
      ]);
      seatsReclaimed = revoked.rowCount ?? 0;

      patch.status = action === "consolidate" ? "consolidated" : "cancelled";
      patch.recurringCostCents = 0;
      patch.cancelledAt = new Date();
      patch.cancellationReason =
        action === "consolidate"
          ? `Consolidated into ${targetName}`
          : reason ?? "Cancelled as unused / redundant spend";
      patch.notes = buildNote(
        current.notes,
        action === "consolidate" ? `${seatsReclaimed} users migrated to ${targetName}` : "Contract cancelled",
      );
      detail =
        action === "consolidate"
          ? `${seatsReclaimed} seat(s) migrated to ${targetName}; duplicate contract retired.`
          : `Cancelled contract; ${seatsReclaimed} active seat grant(s) revoked and recurring cost zeroed.`;
    }

    if (action === "update_contract") {
      const nextStatus = body.status ? String(body.status) : null;
      if (nextStatus && !SUBSCRIPTION_STATUSES.includes(nextStatus)) {
        throw SpendApiError.badRequest(`"status" must be one of: ${SUBSCRIPTION_STATUSES.join(", ")}`);
      }
      if (nextStatus === "cancelled" || nextStatus === "consolidated") {
        throw SpendApiError.unprocessable(
          `Use action "${nextStatus === "cancelled" ? "cancel" : "consolidate"}" to retire ${current.vendor_name} — it revokes seats and zeroes the recurring cost.`,
        );
      }

      const seatsPaid = toInt(body.seatsPaid, "seatsPaid", { min: 0 });
      const unitCostCents = toInt(body.unitCostCents, "unitCostCents", { min: 0 });
      const nextSeats = seatsPaid ?? num(current.seats_paid);
      const nextUnit = unitCostCents ?? num(current.unit_cost_cents);
      const recalculate = seatsPaid !== null || unitCostCents !== null;

      patch.status = nextStatus;
      patch.seatsPaid = seatsPaid;
      patch.unitCostCents = unitCostCents;
      patch.recurringCostCents =
        recalculate && current.billing_model === "per_seat" ? nextSeats * nextUnit : null;
      patch.nextRenewalAt = body.nextRenewalAt ? new Date(body.nextRenewalAt) : null;
      patch.contractOwnerEmail = body.contractOwnerEmail ?? null;
      patch.notes = body.notes ? String(body.notes).slice(0, 1_000) : null;
      patch.productName = body.productName ? String(body.productName).slice(0, 160) : null;
      patch.clearCancellation = nextStatus === "active" && current.status !== "active";
      detail = recalculate
        ? `Terms updated; recurring cost recalculated to ${usd(
            current.billing_model === "per_seat" ? nextSeats * nextUnit : num(current.recurring_cost_cents),
          )}/month.`
        : "Contract metadata updated.";
    }

    const updated = await client.query<{ recurring_cost_cents: number; status: string; vendor_name: string }>(
      UPDATE_SUBSCRIPTION_SQL,
      [
        subscriptionId,
        patch.vendorName ?? null,
        patch.productName ?? null,
        patch.seatsPaid ?? null,
        patch.unitCostCents ?? null,
        patch.recurringCostCents ?? null,
        patch.status ?? null,
        patch.contractOwnerEmail ?? null,
        patch.nextRenewalAt ?? null,
        patch.cancelledAt ?? null,
        patch.cancellationReason ?? null,
        patch.notes ?? null,
        patch.clearCancellation === true,
      ],
    );

    const updatedRow = updated.rows[0];
    if (!updatedRow) throw new Error("Subscription update returned no row");

    const newCostCents = cents(updatedRow.recurring_cost_cents);
    const savingsCents = Math.max(0, previousCostCents - newCostCents);

    const event = await client.query<{ id: number }>(INSERT_EVENT_SQL, [
      tenantId,
      subscriptionId,
      action,
      seatsReclaimed,
      previousCostCents,
      newCostCents,
      savingsCents,
      JSON.stringify({
        request: body,
        detail,
        statusBefore: current.status,
        statusAfter: updatedRow.status,
        seatsBefore: num(current.seats_paid),
        seatsAfter: num(patch.seatsPaid ?? current.seats_paid),
        clampedToReclaimableSeats: clamped,
      }),
      performedBy,
    ]);

    await client.query("COMMIT");

    outcome = {
      previousCostCents,
      newCostCents,
      seatsReclaimed,
      detail,
      eventId: num(event.rows[0]?.id),
      vendorName: updatedRow.vendor_name,
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }

  const [detailResponse, analytics] = await Promise.all([
    getSubscription(tenantId, subscriptionId),
    getAnalytics({ companyId: tenantId }),
  ]);

  const savingsCents = Math.max(0, outcome.previousCostCents - outcome.newCostCents);

  return {
    ok: true,
    message:
      `${action} on ${outcome.vendorName}: ${outcome.detail} ` +
      `Monthly recurring cost ${usd(outcome.previousCostCents)} -> ${usd(outcome.newCostCents)} ` +
      `(${usd(savingsCents)}/month, ${usd(savingsCents * 12)}/year recovered).`,
    data: {
      subscription: detailResponse.data,
      action,
      seatsReclaimed: outcome.seatsReclaimed,
      revokedSeats: [],
      savings: {
        monthlyCents: savingsCents,
        monthlyDisplay: usd(savingsCents),
        annualizedCents: savingsCents * 12,
        annualizedDisplay: usd(savingsCents * 12),
        previousMonthlyCents: outcome.previousCostCents,
        newMonthlyCents: outcome.newCostCents,
      },
      auditEventId: outcome.eventId,
      analytics,
    },
  };
}

function buildNote(existing: string | null, addition: string): string {
  const entry = `[${new Date().toISOString().slice(0, 10)}] ${addition}`;
  return existing ? `${existing}\n${entry}` : entry;
}

/* --------------------------- supporting endpoints ------------------------- */

export async function listOptimizations(
  companyId: number | null,
  subscriptionId: number | null,
  limit = 50,
): Promise<OptimizationsResponse> {
  const company = await resolveCompany(companyId);
  const rows = await pool.query(OPTIMIZATION_EVENTS_SQL, [company.id, subscriptionId, limit]);
  const data = rows.rows.map(formatEvent);

  const totals = data.reduce(
    (acc, event) => ({
      seatsReclaimed: acc.seatsReclaimed + event.seatsReclaimed,
      monthlySavingsCents: acc.monthlySavingsCents + event.savingsCents,
    }),
    { seatsReclaimed: 0, monthlySavingsCents: 0 },
  );

  return {
    ok: true,
    company: { id: company.id, name: company.name },
    count: data.length,
    totals: { ...totals, annualizedSavingsCents: totals.monthlySavingsCents * 12 },
    data,
  };
}

export async function listCompanies(): Promise<CompaniesResponse> {
  await ensureSpendSchemaReady();
  const rows = await pool.query(COMPANIES_SQL);
  return {
    ok: true,
    count: rows.rowCount ?? 0,
    data: rows.rows.map((row) => ({
      id: num(row.id),
      name: String(row.name),
      domain: String(row.domain),
      headcount: num(row.headcount),
      currency: String(row.currency),
      stale_license_days: num(row.stale_license_days),
      active_seat_days: num(row.active_seat_days),
      users_count: num(row.users_count),
      active_subscriptions: num(row.active_subscriptions),
    })),
  };
}
