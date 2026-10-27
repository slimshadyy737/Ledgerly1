/**
 * subscriptionService.js — contract reads + the optimization write-back.
 *
 * Public surface:
 *   listSubscriptions(query)            GET  /api/subscriptions
 *   getSubscription(companyId, id)      GET  /api/subscriptions/:id
 *   optimizeSubscription(id, body)      POST /api/subscriptions/:id/optimize
 *
 * The write path is the interesting part. Every action runs inside a single
 * transaction that:
 *   1. locks the contract row (SELECT … FOR UPDATE) so concurrent requests cannot
 *      double-reclaim the same seat,
 *   2. mutates seats / status,
 *   3. recalculates the recurring cost from the licence maths,
 *   4. writes an immutable row into optimization_events (the audit trail),
 *   5. and returns the fresh contract plus the realised monthly savings.
 */
"use strict";

const subscriptionRepository = require("../repositories/subscriptionRepository");
const { resolveCompany } = require("./companyService");
const { getAnalytics } = require("./analyticsService");
const { withTransaction } = require("../db/database");
const { env } = require("../config/env");
const { HttpError } = require("../utils/httpError");
const { toUsd, toUsdWhole, cents } = require("../utils/money");
const {
  optionalString,
  optionalInt,
  optionalDate,
  optionalEmail,
  parsePagination,
  parseSort,
} = require("../utils/validate");

/** Whitelisted sort keys -> SQL expressions (never interpolate raw input). */
const SORTABLE_COLUMNS = Object.freeze({
  vendor: "va.vendor_name",
  category: "va.category_group",
  monthlyCost: "va.recurring_cost_cents",
  seatsPaid: "va.seats_paid",
  activeSeats: "va.healthy_seats",
  staleSeats: "va.stale_seats",
  idleSeats: "va.idle_seats",
  adoption: "va.adoption_pct",
  health: "va.health_score",
  waste: "va.stale_seat_cost_cents",
  renewal: "va.next_renewal_at",
  updatedAt: "va.updated_at",
});

const SUBSCRIPTION_STATUSES = ["active", "paused", "cancelled", "consolidated"];
const ACTIONS = ["reclaim_seats", "cancel", "consolidate", "update_contract"];

/* ------------------------------ read paths -------------------------------- */

/** Builds a list response with pagination metadata. */
async function listSubscriptions(query = {}) {
  const company = await resolveCompany(optionalInt(query.companyId, "companyId", { min: 1 }));
  const pagination = parsePagination(query, {
    defaultPageSize: env.defaultPageSize,
    maxPageSize: env.maxPageSize,
  });
  const sort = parseSort(query, SORTABLE_COLUMNS, "monthlyCost");

  const minMonthlyUsd = optionalInt(query.minMonthlyUsd, "minMonthlyUsd", { min: 0 });
  const filters = {
    companyId: company.id,
    status: optionalString(query.status, "status", { maxLength: 20 }),
    categoryGroup: optionalString(query.categoryGroup, "categoryGroup", { maxLength: 120 }),
    search: optionalString(query.search ?? query.q, "search", { maxLength: 120 }),
    // Callers may filter in cents (canonical) or whole dollars (convenience).
    minMonthlyCents:
      optionalInt(query.minMonthlyCents, "minMonthlyCents", { min: 0 }) ??
      (minMonthlyUsd === null ? null : minMonthlyUsd * 100),
    wastefulOnly: ["1", "true", "yes"].includes(String(query.wastefulOnly ?? "").toLowerCase()),
    orderBySql: `${sort.sql}, va.subscription_id ASC`,
    limit: pagination.limit,
    offset: pagination.offset,
  };

  if (filters.status && !SUBSCRIPTION_STATUSES.includes(filters.status)) {
    throw HttpError.badRequest(`"status" must be one of: ${SUBSCRIPTION_STATUSES.join(", ")}`);
  }

  const { rows, total } = await subscriptionRepository.listSubscriptions(filters);

  return {
    ok: true,
    company: { id: company.id, name: company.name, currency: company.currency },
    pagination: {
      page: pagination.page,
      pageSize: pagination.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pagination.pageSize)),
      hasNextPage: pagination.page * pagination.pageSize < total,
    },
    sort: { key: sort.key, order: sort.order },
    filters: {
      status: filters.status,
      categoryGroup: filters.categoryGroup,
      search: filters.search,
      wastefulOnly: filters.wastefulOnly,
    },
    count: rows.length,
    data: rows.map(formatSubscription),
  };
}

/**
 * Resolves the tenant for a subscription-scoped request.
 *
 * A subscription id is globally unique, so callers may target one without
 * repeating `?companyId=`. When a companyId IS supplied it is enforced, which
 * keeps tenant isolation intact for multi-tenant clients.
 *
 * @param {number|null} requestedCompanyId
 * @param {number} subscriptionId
 * @returns {Promise<number>}
 */
async function resolveSubscriptionTenant(requestedCompanyId, subscriptionId) {
  const ownerCompanyId = await subscriptionRepository.findCompanyIdForSubscription(subscriptionId);
  if (ownerCompanyId === null) throw HttpError.notFound(`Subscription ${subscriptionId} not found`);
  if (requestedCompanyId !== null && requestedCompanyId !== ownerCompanyId) {
    // Do not leak the existence of another tenant's record.
    throw HttpError.notFound(`Subscription ${subscriptionId} not found`);
  }
  return ownerCompanyId;
}

/** Single contract with its seat register and optimization history. */
async function getSubscription(companyId, subscriptionId) {
  const tenantId = await resolveSubscriptionTenant(companyId, subscriptionId);
  const subscription = await subscriptionRepository.findSubscriptionById(tenantId, subscriptionId);
  if (!subscription) throw HttpError.notFound(`Subscription ${subscriptionId} not found`);

  const [seats, events, targets] = await Promise.all([
    subscriptionRepository.listSeatMappings(subscriptionId),
    subscriptionRepository.listOptimizationEvents({ companyId: tenantId, subscriptionId, limit: 20 }),
    subscriptionRepository.listConsolidationTargets(tenantId, {
      categoryGroup: subscription.category_group,
      excludeSubscriptionId: subscriptionId,
    }),
  ]);

  return {
    ok: true,
    data: {
      ...formatSubscription(subscription),
      seatMappings: seats.map(formatSeat),
      consolidationTargets: targets,
      optimizationHistory: events.map(formatEvent),
    },
  };
}

/* ------------------------------- write path ------------------------------- */

/**
 * Applies an optimization to a contract.
 * @param {object} params
 * @param {number} params.companyId
 * @param {number} params.subscriptionId
 * @param {object} params.body  validated request body
 */
async function optimizeSubscription({ companyId, subscriptionId, body }) {
  const action = body.action;
  if (!ACTIONS.includes(action)) {
    throw HttpError.badRequest(`"action" must be one of: ${ACTIONS.join(", ")}`);
  }

  // The subscription id implies its tenant, so `companyId` is optional here;
  // when supplied it is enforced for multi-tenant isolation.
  const tenantId = await resolveSubscriptionTenant(companyId ?? null, subscriptionId);
  // Tenant policy (default 60 days) drives which seats count as reclaimable.
  const company = await resolveCompany(tenantId);
  const staleLicenseDays = company.stale_license_days ?? env.staleLicenseDays;

  const performedBy = optionalEmail(body.performedBy, "performedBy") ?? "cfo@northwind.io";
  const reason = optionalString(body.reason, "reason", { maxLength: 300 });
  const expectedUpdatedAt = optionalDate(body.expectedUpdatedAt, "expectedUpdatedAt");

  const result = await withTransaction(async (client) => {
    const current = await subscriptionRepository.lockSubscription(client, tenantId, subscriptionId);
    if (!current) throw HttpError.notFound(`Subscription ${subscriptionId} not found`);

    // Optimistic concurrency: the client must not overwrite someone else's change.
    if (expectedUpdatedAt && new Date(current.updated_at).getTime() !== expectedUpdatedAt.getTime()) {
      throw HttpError.conflict(
        "The subscription changed since it was loaded. Re-fetch it and retry with the current updatedAt value.",
        { subscriptionId, currentUpdatedAt: current.updated_at },
      );
    }

    const previousCostCents = cents(current.recurring_cost_cents);
    let patch = {};
    let seatsReclaimed = 0;
    let revokedSeats = [];
    let detail = "";
    let reclaimClamped = false;

    /* ------------------------------ reclaim ----------------------------- */
    if (action === "reclaim_seats") {
      if (current.billing_model !== "per_seat" || current.seats_paid === 0) {
        throw HttpError.unprocessable(
          `${current.vendor_name} is billed as "${current.billing_model}" — there are no seats to reclaim. Use "cancel" or "update_contract" instead.`,
        );
      }
      if (current.status !== "active") {
        throw HttpError.conflict(`${current.vendor_name} is ${current.status}; no active seats to reclaim.`);
      }

      // Default: reclaim every seat the detectors consider dead right now.
      const { rows: seatRows } = await client.query(
        `SELECT COUNT(*)::int AS stale_seats
           FROM seat_mappings sm
           JOIN users u ON u.id = sm.user_id
          WHERE sm.subscription_id = $1
            AND sm.status = 'active'
            AND (u.status = 'terminated'
                 OR sm.last_login_at IS NULL
                 OR sm.last_login_at < now() - make_interval(days => $2::int))`,
        [subscriptionId, staleLicenseDays],
      );
      const staleSeats = seatRows[0]?.stale_seats ?? 0;
      const requested = optionalInt(body.seatsToReclaim ?? body.seats, "seatsToReclaim", { min: 1 });
      /**
       * Safety rule: reclaiming is only ever allowed to touch seats that are
       * already dead (holder offboarded, never logged in, or silent beyond the
       * staleness window). An explicit request is clamped to that population
       * unless the caller opts in with allowActiveSeats: true, so a typo can
       * never revoke a working user's licence.
       */
      const allowActiveSeats = body.allowActiveSeats === true;
      const ceiling = allowActiveSeats ? current.seats_paid : Math.min(staleSeats, current.seats_paid);
      const target = requested === null ? ceiling : Math.min(requested, ceiling);
      const clamped = requested !== null && requested > ceiling && !allowActiveSeats;

      if (target === 0) {
        throw HttpError.unprocessable(
          `${current.vendor_name} has no dead seats (0 offboarded / 0 inactive beyond the staleness window).`,
        );
      }

      revokedSeats = await subscriptionRepository.revokeWorstSeats(client, {
        subscriptionId,
        seats: target,
        reason: reason ?? "Reclaimed via spend-api optimization endpoint",
      });
      seatsReclaimed = revokedSeats.length;

      const nextSeats = Math.max(0, current.seats_paid - seatsReclaimed);
      patch = {
        seatsPaid: nextSeats,
        recurringCostCents: nextSeats * current.unit_cost_cents,
        notes: buildNote(current.notes, `${seatsReclaimed} seat(s) reclaimed`),
      };
      detail =
        `Revoked ${seatsReclaimed} seat grant(s); licence count ${current.seats_paid} -> ${nextSeats}.` +
        (clamped ? ` Request clamped to ${staleSeats} reclaimable seat(s) — no active user was touched.` : "");
      reclaimClamped = clamped;
    }

    /* ------------------------------- cancel ----------------------------- */
    if (action === "cancel") {
      if (current.status !== "active") {
        throw HttpError.conflict(`${current.vendor_name} is already ${current.status}.`);
      }
      revokedSeats = await subscriptionRepository.revokeAllSeats(client, {
        subscriptionId,
        reason: reason ?? "Contract cancelled via spend-api optimization endpoint",
      });
      seatsReclaimed = revokedSeats.length;
      patch = {
        status: "cancelled",
        recurringCostCents: 0,
        cancelledAt: new Date(),
        cancellationReason: reason ?? "Cancelled as unused / redundant spend",
        notes: buildNote(current.notes, "Contract cancelled"),
      };
      detail = `Cancelled contract; ${seatsReclaimed} active seat grant(s) revoked and recurring cost zeroed.`;
    }

    /* ----------------------------- consolidate -------------------------- */
    if (action === "consolidate") {
      if (current.status !== "active") {
        throw HttpError.conflict(`${current.vendor_name} is already ${current.status}.`);
      }
      const targets = await subscriptionRepository.listConsolidationTargets(tenantId, {
        categoryGroup: current.category_group,
        excludeSubscriptionId: subscriptionId,
      });
      if (targets.length === 0) {
        throw HttpError.unprocessable(
          `No consolidation target exists in category group "${current.category_group}" — this subscription is the only tool there.`,
        );
      }
      const targetId = optionalInt(body.consolidateIntoSubscriptionId, "consolidateIntoSubscriptionId", {
        min: 1,
      });
      const target = targetId ? targets.find((candidate) => candidate.id === targetId) : targets[0];
      if (!target) {
        throw HttpError.badRequest(
          `Subscription ${targetId} is not an active vendor in category group "${current.category_group}".`,
          { validTargets: targets.map((candidate) => candidate.id) },
        );
      }

      revokedSeats = await subscriptionRepository.revokeAllSeats(client, {
        subscriptionId,
        reason: `Migrated to ${target.vendor_name} (consolidation)`,
      });
      seatsReclaimed = revokedSeats.length;
      patch = {
        status: "consolidated",
        recurringCostCents: 0,
        cancelledAt: new Date(),
        cancellationReason: `Consolidated into ${target.vendor_name} (subscription ${target.id})`,
        notes: buildNote(current.notes, `${seatsReclaimed} users migrated to ${target.vendor_name}`),
      };
      detail = `${seatsReclaimed} seat(s) migrated to ${target.vendor_name}; duplicate contract retired.`;
    }

    /* --------------------------- update contract ------------------------ */
    if (action === "update_contract") {
      const status = optionalString(body.status, "status", { maxLength: 20 });
      if (status && !SUBSCRIPTION_STATUSES.includes(status)) {
        throw HttpError.badRequest(`"status" must be one of: ${SUBSCRIPTION_STATUSES.join(", ")}`);
      }
      // Retiring spend has audit implications, so it gets its own actions.
      // Pausing (temporary suspension) and reactivating are fine here.
      if (status === "cancelled" || status === "consolidated") {
        throw HttpError.unprocessable(
          `Use action "${status === "cancelled" ? "cancel" : "consolidate"}" to retire ${current.vendor_name} — it revokes seats and zeroes the recurring cost.`,
        );
      }

      const seatsPaid = optionalInt(body.seatsPaid, "seatsPaid", { min: 0 });
      const unitCostCents = optionalInt(body.unitCostCents, "unitCostCents", { min: 0 });
      const nextRenewalAt = optionalDate(body.nextRenewalAt, "nextRenewalAt");
      const contractOwnerEmail = optionalEmail(body.contractOwnerEmail, "contractOwnerEmail");
      const notes = optionalString(body.notes, "notes", { maxLength: 1_000 });

      const nextSeats = seatsPaid ?? current.seats_paid;
      const nextUnit = unitCostCents ?? current.unit_cost_cents;
      // Re-derive the monthly charge whenever the licence maths changed.
      const recurringCostCents = changedTerms(seatsPaid, unitCostCents)
        ? current.billing_model === "per_seat"
          ? nextSeats * nextUnit
          : current.recurring_cost_cents
        : null;

      patch = {
        status,
        seatsPaid,
        unitCostCents,
        recurringCostCents,
        nextRenewalAt,
        contractOwnerEmail,
        notes,
        productName: optionalString(body.productName, "productName", { maxLength: 160 }),
        // Reactivating a retired contract clears its cancellation metadata.
        clearCancellation: status === "active" && current.status !== "active",
      };
      detail = recurringCostCents === null
        ? "Contract metadata updated."
        : `Terms updated; recurring cost recalculated to ${toUsd(recurringCostCents)}/month.`;
    }

    const updated = await subscriptionRepository.updateSubscription(client, subscriptionId, patch);
    if (!updated) throw new HttpError(500, "Subscription update did not return a row");

    const newCostCents = cents(updated.recurring_cost_cents);
    const savingsCents = Math.max(0, previousCostCents - newCostCents);
    const event = await subscriptionRepository.insertOptimizationEvent(client, {
      companyId: tenantId,
      subscriptionId,
      action,
      seatsReclaimed,
      previousCostCents,
      newCostCents,
      savingsCents,
      performedBy,
      payload: {
        request: body,
        detail,
        revokedSeatMappingIds: revokedSeats.map((seat) => seat.id),
        statusBefore: current.status,
        statusAfter: updated.status,
        seatsBefore: current.seats_paid,
        seatsAfter: updated.seats_paid,
        clampedToReclaimableSeats: reclaimClamped,
      },
    });

    return { updated, previous: current, event, savingsCents, seatsReclaimed, detail, revokedSeats };
  });

  // Return the contract + realised savings so a client can update its UI in one
  // round trip, plus a recomputed analytics summary for the header KPIs.
  const [subscription, analytics] = await Promise.all([
    subscriptionRepository.findSubscriptionById(tenantId, subscriptionId),
    getAnalytics({ companyId: tenantId }),
  ]);

  return {
    ok: true,
    message:
      `${result.event.action} on ${result.updated.vendor_name}: ${result.detail} ` +
      `Monthly recurring cost ${toUsd(result.previous.recurring_cost_cents)} -> ${toUsd(result.updated.recurring_cost_cents)} ` +
      `(${toUsdWhole(result.savingsCents)}/month, ${toUsdWhole(result.savingsCents * 12)}/year recovered).`,
    data: {
      subscription: subscription ? formatSubscription(subscription) : null,
      action: result.event.action,
      seatsReclaimed: result.seatsReclaimed,
      revokedSeats: result.revokedSeats.map((seat) => ({
        seatMappingId: seat.id,
        userId: seat.user_id,
        seatCostCents: seat.seat_cost_cents,
      })),
      savings: {
        monthlyCents: result.savingsCents,
        monthlyDisplay: toUsd(result.savingsCents),
        annualizedCents: result.savingsCents * 12,
        annualizedDisplay: toUsdWhole(result.savingsCents * 12),
        previousMonthlyCents: cents(result.previous.recurring_cost_cents),
        newMonthlyCents: cents(result.updated.recurring_cost_cents),
      },
      auditEventId: result.event.id,
      analytics,
    },
  };
}

/* ------------------------------- formatters -------------------------------- */

function formatSubscription(row) {
  return {
    id: row.id,
    companyId: row.company_id,
    vendor: row.vendor_name,
    product: row.product_name,
    category: row.category,
    categoryGroup: row.category_group,
    billingModel: row.billing_model,
    status: row.status,
    currency: row.currency,
    seatsPaid: row.seats_paid,
    unitCostCents: row.unit_cost_cents,
    unitCostDisplay: toUsd(row.unit_cost_cents),
    monthlyCostCents: cents(row.recurring_cost_cents),
    monthlyCostDisplay: toUsd(row.recurring_cost_cents),
    annualizedCostCents: cents(row.recurring_cost_cents) * 12,
    // Seat utilisation from the licence register vs SSO telemetry
    seats: {
      paid: row.seats_paid,
      assigned: row.assigned_seats,
      active: row.healthy_seats,
      stale: row.stale_seats,
      idle: row.idle_seats,
      adoptionPct: row.adoption_pct === null ? null : Number(row.adoption_pct),
      averageDaysSinceLogin: row.avg_days_since_login,
      staleCostCents: cents(row.stale_seat_cost_cents),
    },
    wasteCents: cents(row.stale_seat_cost_cents),
    healthScore: row.health_score,
    isZombie: row.is_zombie,
    hasOverlappingVendors: row.category_vendors > 1,
    overlappingVendorCount: row.category_vendors,
    contractOwner: row.contract_owner_email,
    nextRenewalAt: row.next_renewal_at,
    daysUntilRenewal: row.next_renewal_at
      ? Math.max(0, Math.ceil((new Date(row.next_renewal_at).getTime() - Date.now()) / 86_400_000))
      : null,
    startedAt: row.started_at,
    cancelledAt: row.cancelled_at,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function formatSeat(row) {
  return {
    seatMappingId: row.id,
    userId: row.user_id,
    userName: row.user_name,
    userEmail: row.user_email,
    department: row.department,
    userStatus: row.user_status,
    seatStatus: row.status,
    seatCostCents: row.seat_cost_cents,
    assignedAt: row.assigned_at,
    revokedAt: row.revoked_at,
    revokedReason: row.revoked_reason,
    lastLoginAt: row.last_login_at,
    loginsLast30d: row.logins_last_30d,
    daysSinceLogin: row.days_since_login,
    isStale:
      row.status === "active" &&
      (row.user_status === "terminated" ||
        row.last_login_at === null ||
        (row.days_since_login ?? 0) > 60),
  };
}

function formatEvent(row) {
  return {
    id: row.id,
    subscriptionId: row.subscription_id,
    vendorName: row.vendor_name,
    action: row.action,
    seatsReclaimed: row.seats_reclaimed,
    previousCostCents: cents(row.previous_cost_cents),
    newCostCents: cents(row.new_cost_cents),
    savingsCents: cents(row.savings_cents),
    savingsDisplay: toUsd(row.savings_cents),
    performedBy: row.performed_by,
    createdAt: row.created_at,
    detail: row.payload?.detail ?? null,
  };
}

/** Appends a dated change note without clobbering existing context. */
function buildNote(existing, addition) {
  const stamp = new Date().toISOString().slice(0, 10);
  const entry = `[${stamp}] ${addition}`;
  return existing ? `${existing}\n${entry}` : entry;
}

function changedTerms(seatsPaid, unitCostCents) {
  return seatsPaid !== null || unitCostCents !== null;
}

module.exports = {
  listSubscriptions,
  getSubscription,
  optimizeSubscription,
  SORTABLE_COLUMNS,
  SUBSCRIPTION_STATUSES,
  ACTIONS,
};
