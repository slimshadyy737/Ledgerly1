/**
 * analyticsService.js — assembles GET /api/analytics.
 *
 * All arithmetic happens in SQL (see analyticsRepository). This layer only:
 *   • resolves the tenant + detector windows,
 *   • runs the analytics queries concurrently on one pool,
 *   • formats cents into human-readable strings,
 *   • and documents which rule produced each number (`detectors`).
 */
"use strict";

const analyticsRepository = require("../repositories/analyticsRepository");
const { resolveCompany } = require("./companyService");
const { env } = require("../config/env");
const { toPercent, toUsd, toUsdWhole, cents } = require("../utils/money");

/**
 * @param {object} [options]
 * @param {number|null} [options.companyId]
 * @param {Date} [options.asOf]             point in time used for the activity windows
 * @param {number} [options.staleDays]      override companies.stale_license_days (default 60)
 * @param {number} [options.activeDays]     override companies.active_seat_days (default 30)
 * @param {number} [options.limitPerSection]
 */
async function getAnalytics({
  companyId = null,
  asOf = new Date(),
  staleDays = null,
  activeDays = null,
  limitPerSection = 25,
} = {}) {
  const company = await resolveCompany(companyId);
  const staleWindow = staleDays ?? company.stale_license_days ?? env.staleLicenseDays;
  const activeWindow = activeDays ?? company.active_seat_days ?? env.activeSeatDays;

  const scope = { companyId: company.id, asOf, staleDays: staleWindow, activeDays: activeWindow };

  const [summary, estate, duplicateCategories, staleLicences, offenders, categorySpend, renewals] =
    await Promise.all([
      analyticsRepository.getSpendSummary(scope),
      analyticsRepository.getEstateSummary(company.id),
      analyticsRepository.listDuplicateCategories(scope),
      analyticsRepository.listStaleLicenses({ ...scope, limit: limitPerSection }),
      analyticsRepository.listWasteOffenders({ ...scope, limit: limitPerSection }),
      analyticsRepository.listCategorySpend(scope),
      analyticsRepository.listUpcomingRenewals({ companyId: company.id, withinDays: 45 }),
    ]);

  const monthlySpendCents = cents(summary.monthly_spend_cents);
  const totalWasteCents = cents(summary.total_waste_cents);

  const breakdown = [
    {
      key: "stale_licenses",
      label: `Licences unused for ${staleWindow}+ days (or held by leavers)`,
      monthlyCents: cents(summary.stale_license_waste_cents),
      seats: summary.stale_seats,
      detector: "STALE_LICENSE",
    },
    {
      key: "duplicate_categories",
      label: "Redundant tools in the same category group",
      monthlyCents: cents(summary.duplicate_category_waste_cents),
      seats: summary.duplicate_subscriptions,
      detector: "DUPLICATE_CATEGORY",
    },
    {
      key: "idle_seats",
      label: "Paid seats never provisioned to a user",
      monthlyCents: cents(summary.idle_seat_waste_cents),
      seats: summary.idle_seats,
      detector: "IDLE_SEAT",
    },
    {
      key: "zombie_subscriptions",
      label: `Zero active users for ${activeWindow}+ days — whole invoice is waste`,
      monthlyCents: cents(summary.zombie_waste_cents),
      seats: summary.zombie_subscriptions,
      detector: "ZOMBIE_SOFTWARE",
    },
  ].map((bucket) => ({
    ...bucket,
    monthlyDisplay: toUsd(bucket.monthlyCents),
    annualizedCents: bucket.monthlyCents * 12,
    shareOfWastePct: toPercent(totalWasteCents > 0 ? (bucket.monthlyCents / totalWasteCents) * 100 : 0),
  }));

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    asOf: asOf.toISOString(),
    company: {
      id: company.id,
      name: company.name,
      domain: company.domain,
      currency: company.currency,
      headcount: company.headcount,
    },
    windows: { staleLicenseDays: staleWindow, activeSeatDays: activeWindow },

    /* (a) TOTAL SPEND ---------------------------------------------------- */
    totalSpend: {
      monthlyCents: monthlySpendCents,
      monthlyDisplay: toUsd(monthlySpendCents),
      annualizedCents: monthlySpendCents * 12,
      annualizedDisplay: toUsdWhole(monthlySpendCents * 12),
      activeSubscriptions: summary.active_subscriptions,
      seatsPaid: summary.seats_paid,
      assignedSeats: summary.assigned_seats,
      activeSeats: summary.healthy_seats,
      seatUtilisationPct: cents(summary.seat_utilisation_pct),
      averageHealthScore: estate.avg_health_score,
      sql: "SELECT SUM(recurring_cost_cents) FROM subscriptions WHERE status = 'active'",
    },

    /* (b) TOTAL WASTE ---------------------------------------------------- */
    totalWaste: {
      monthlyCents: totalWasteCents,
      monthlyDisplay: toUsd(totalWasteCents),
      annualizedCents: totalWasteCents * 12,
      annualizedDisplay: toUsdWhole(totalWasteCents * 12),
      wasteRatePct: toPercent(monthlySpendCents > 0 ? (totalWasteCents / monthlySpendCents) * 100 : 0),
      countingPolicy:
        "Each dollar is counted once per month: a zombie subscription claims its entire invoice, " +
        "otherwise stale-seat + idle-seat cost + a duplicate premium capped at (cost - already counted) is used.",
      breakdown,
      staleSeatCount: summary.stale_seats,
      idleSeatCount: summary.idle_seats,
      zombieCount: summary.zombie_subscriptions,
      duplicateVendorCount: summary.duplicate_subscriptions,
      duplicateCategoryGroupCount: summary.duplicate_category_groups,
    },

    estate: {
      subscriptionsTotal: estate.subscriptions_total,
      subscriptionsActive: estate.subscriptions_active,
      subscriptionsCancelled: estate.subscriptions_cancelled,
      subscriptionsConsolidated: estate.subscriptions_consolidated,
      subscriptionsPaused: estate.subscriptions_paused,
    },

    /* Rule documentation — keeps the numbers auditable. */
    detectors: [
      {
        id: "STALE_LICENSE",
        rule: `seat_mappings.status = 'active' AND (users.status = 'terminated' OR seat_mappings.last_login_at < as_of - ${staleWindow} days OR last_login_at IS NULL)`,
        waste: "SUM(seat_mappings.seat_cost_cents) of those rows",
        monthlyCents: cents(summary.stale_license_waste_cents),
        hits: summary.stale_seats,
      },
      {
        id: "DUPLICATE_CATEGORY",
        rule: `ROW_NUMBER() OVER (PARTITION BY category_group ORDER BY adoption DESC, cost DESC) > 1 AND COUNT(*) OVER (PARTITION BY category_group) > 1`,
        waste: "recurring_cost_cents of non-incumbent vendors, minus leakage already counted on the same invoice",
        monthlyCents: cents(summary.duplicate_category_waste_cents),
        hits: summary.duplicate_subscriptions,
      },
      {
        id: "IDLE_SEAT",
        rule: "subscriptions.seats_paid - COUNT(active seat_mappings) > 0",
        waste: "idle_seats * unit_cost_cents",
        monthlyCents: cents(summary.idle_seat_waste_cents),
        hits: summary.idle_seats,
      },
      {
        id: "ZOMBIE_SOFTWARE",
        rule: `per-seat contract, >= 1 assigned seat, 0 seats with a login in the last ${activeWindow} days`,
        waste: "the entire recurring_cost_cents of the contract",
        monthlyCents: cents(summary.zombie_waste_cents),
        hits: summary.zombie_subscriptions,
      },
    ],

    /* Detail sections ---------------------------------------------------- */
    duplicateCategories: duplicateCategories.map((group) => ({
      categoryGroup: group.category_group,
      vendorCount: group.vendor_count,
      categoryMonthlyCents: cents(group.category_monthly_cents),
      categoryMonthlyDisplay: toUsd(group.category_monthly_cents),
      duplicateWasteCents: cents(group.duplicate_waste_cents),
      duplicateWasteDisplay: toUsd(group.duplicate_waste_cents),
      // A category can contain duplicates with $0 duplicate-savings because the
      // secondary vendor is already billed as a zombie — the money is counted in
      // the zombie bucket instead of being counted twice.
      savingsCountedElsewhere:
        cents(group.duplicate_waste_cents) === 0 &&
        (group.vendors ?? []).some((vendor) => vendor.isZombie),
      note:
        cents(group.duplicate_waste_cents) === 0 &&
        (group.vendors ?? []).some((vendor) => vendor.isZombie)
          ? "Duplicate tooling detected, but the redundant contract is already counted as zombie software — no double counting."
          : null,
      vendors: (group.vendors ?? []).map((vendor) => ({
        ...vendor,
        monthlyDisplay: toUsd(vendor.monthlyCents),
        duplicateWasteDisplay: toUsd(vendor.duplicateWasteCents),
      })),
    })),

    staleLicences: staleLicences.map((row) => ({
      subscriptionId: row.subscription_id,
      vendorName: row.vendor_name,
      productName: row.product_name,
      category: row.category,
      categoryGroup: row.category_group,
      seatMappingId: row.seat_mapping_id,
      userId: row.user_id,
      userName: row.user_name,
      userEmail: row.user_email,
      department: row.department,
      userStatus: row.user_status,
      reason: row.reason,
      daysSinceLogin: row.days_since_login,
      lastLoginAt: row.last_login_at,
      loginsLast30d: row.logins_last_30d,
      seatCostCents: cents(row.seat_cost_cents),
      seatCostDisplay: toUsd(row.seat_cost_cents),
    })),

    topWasteOffenders: offenders.map((row) => ({
      subscriptionId: row.subscription_id,
      vendorName: row.vendor_name,
      productName: row.product_name,
      category: row.category,
      categoryGroup: row.category_group,
      billingModel: row.billing_model,
      seatsPaid: row.seats_paid,
      activeSeats: row.healthy_seats,
      staleSeats: row.stale_seats,
      idleSeats: row.idle_seats,
      isZombie: row.is_zombie,
      isDuplicateOfCategory: row.category_vendors > 1 && row.category_rank > 1,
      monthlyCents: cents(row.recurring_cost_cents),
      monthlyDisplay: toUsd(row.recurring_cost_cents),
      wasteCents: cents(row.line_waste_cents),
      wasteDisplay: toUsd(row.line_waste_cents),
      wasteAnnualizedCents: cents(row.line_waste_cents) * 12,
      wasteSources: {
        staleLicencesCents: cents(row.stale_waste_cents),
        duplicateCategoryCents: cents(row.duplicate_waste_cents),
        idleSeatsCents: cents(row.idle_waste_cents),
      },
    })),

    categorySpend: categorySpend.map((row) => ({
      categoryGroup: row.category_group,
      vendorCount: row.vendor_count,
      monthlyCents: cents(row.monthly_cents),
      monthlyDisplay: toUsd(row.monthly_cents),
      wasteCents: cents(row.waste_cents),
      seatsPaid: row.seats_paid,
      overlappingVendorCount: row.overlapping_vendor_count,
      sharePct: toPercent(monthlySpendCents > 0 ? (row.monthly_cents / monthlySpendCents) * 100 : 0),
    })),

    upcomingRenewals: renewals.map((row) => ({
      subscriptionId: row.subscription_id,
      vendorName: row.vendor_name,
      categoryGroup: row.category_group,
      monthlyCents: cents(row.recurring_cost_cents),
      monthlyDisplay: toUsd(row.recurring_cost_cents),
      nextRenewalAt: row.next_renewal_at,
      daysUntilRenewal: row.days_until_renewal,
    })),
  };
}

module.exports = { getAnalytics };
