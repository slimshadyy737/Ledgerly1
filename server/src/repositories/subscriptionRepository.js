/**
 * subscriptionRepository.js — contract/seat persistence.
 *
 * Reads go through the `v_subscription_activity` view (one row per subscription
 * with seat counts + health score). Writes are explicit statements that accept a
 * transaction client so the optimize service can compose several of them
 * atomically.
 *
 * Every value is passed as a bind parameter ($1..$n). Sorting is whitelisted
 * through SORTABLE_COLUMNS in the service layer, never string-interpolated from
 * user input.
 */
"use strict";

const { many, one } = require("../db/database");

/** Read-model columns shared by list + detail responses. */
const SELECT_COLUMNS = `
  va.subscription_id            AS id,
  va.company_id,
  va.vendor_name,
  va.product_name,
  va.category,
  va.category_group,
  va.billing_model,
  va.seats_paid,
  va.unit_cost_cents,
  va.recurring_cost_cents,
  va.currency,
  va.status,
  va.contract_owner_email,
  va.next_renewal_at,
  va.started_at,
  va.cancelled_at,
  va.notes,
  va.created_at,
  va.updated_at,
  va.assigned_seats,
  va.healthy_seats,
  va.stale_seats,
  va.idle_seats,
  va.stale_seat_cost_cents,
  va.avg_days_since_login,
  va.adoption_pct,
  va.is_zombie,
  va.health_score,
  va.category_vendors`;

/**
 * Paginated subscription list with server-side filters and sorting.
 * @param {object} params
 * @param {number} params.companyId
 * @param {string|null} params.status
 * @param {string|null} params.categoryGroup
 * @param {string|null} params.search           case-insensitive vendor/category/product match
 * @param {number|null} params.minMonthlyCents  only contracts at/above this monthly cost
 * @param {boolean} params.wastefulOnly         only rows with stale or idle seats
 * @param {string} params.orderBySql            pre-whitelisted "column DIRECTION" fragment
 * @param {number} params.limit
 * @param {number} params.offset
 */
async function listSubscriptions({
  companyId,
  status = null,
  categoryGroup = null,
  search = null,
  minMonthlyCents = null,
  wastefulOnly = false,
  orderBySql,
  limit,
  offset,
}) {
  const rows = await many(
    `SELECT ${SELECT_COLUMNS}, COUNT(*) OVER ()::int AS total_count
       FROM v_subscription_activity va
      WHERE va.company_id = $1
        AND ($2::text IS NULL OR va.status = $2)
        AND ($3::text IS NULL OR va.category_group = $3)
        AND ($4::text IS NULL OR va.vendor_name ILIKE '%' || $4 || '%'
                           OR va.category     ILIKE '%' || $4 || '%'
                           OR COALESCE(va.product_name, '') ILIKE '%' || $4 || '%')
        AND ($5::int IS NULL OR va.recurring_cost_cents >= $5)
        AND ($6::boolean IS FALSE OR va.stale_seats > 0 OR va.idle_seats > 0)
      ORDER BY ${orderBySql}
      LIMIT $7 OFFSET $8`,
    [companyId, status, categoryGroup, search, minMonthlyCents, wastefulOnly, limit, offset],
  );

  const total = rows.length > 0 ? rows[0].total_count : await countSubscriptions({ companyId, status, categoryGroup, search, minMonthlyCents, wastefulOnly });
  return { rows: rows.map(({ total_count: _totalCount, ...row }) => row), total };
}

/** COUNT for the current filter set (used when a page comes back empty). */
async function countSubscriptions({
  companyId,
  status = null,
  categoryGroup = null,
  search = null,
  minMonthlyCents = null,
  wastefulOnly = false,
}) {
  const row = await one(
    `SELECT COUNT(*)::int AS total
       FROM v_subscription_activity va
      WHERE va.company_id = $1
        AND ($2::text IS NULL OR va.status = $2)
        AND ($3::text IS NULL OR va.category_group = $3)
        AND ($4::text IS NULL OR va.vendor_name ILIKE '%' || $4 || '%'
                           OR va.category     ILIKE '%' || $4 || '%'
                           OR COALESCE(va.product_name, '') ILIKE '%' || $4 || '%')
        AND ($5::int IS NULL OR va.recurring_cost_cents >= $5)
        AND ($6::boolean IS FALSE OR va.stale_seats > 0 OR va.idle_seats > 0)`,
    [companyId, status, categoryGroup, search, minMonthlyCents, wastefulOnly],
  );
  return row?.total ?? 0;
}

/**
 * Resolves the owning tenant of a subscription. Used when a request targets a
 * subscription by its (globally unique) id without repeating ?companyId=.
 * Returns null when the id does not exist.
 */
async function findCompanyIdForSubscription(subscriptionId) {
  const row = await one(`SELECT company_id FROM subscriptions WHERE id = $1`, [subscriptionId]);
  return row?.company_id ?? null;
}

/** Single contract by id, scoped to the company (tenant isolation). */
async function findSubscriptionById(companyId, subscriptionId) {
  return one(
    `SELECT ${SELECT_COLUMNS}
       FROM v_subscription_activity va
      WHERE va.company_id = $1 AND va.subscription_id = $2`,
    [companyId, subscriptionId],
  );
}

/**
 * Locks a contract row for update inside a transaction so two concurrent
 * optimizations cannot double-reclaim the same seats.
 * @param {import('pg').PoolClient} client
 */
async function lockSubscription(client, companyId, subscriptionId) {
  const { rows } = await client.query(
    `SELECT *
       FROM subscriptions
      WHERE id = $1 AND company_id = $2
      FOR UPDATE`,
    [subscriptionId, companyId],
  );
  return rows[0] ?? null;
}

/** Seat rows of a contract, ordered worst-first (worst = safe to reclaim first). */
async function listSeatMappings(subscriptionId, { staleOnly = false, limit = 500 } = {}) {
  return many(
    `SELECT
       sm.id,
       sm.subscription_id,
       sm.user_id,
       u.full_name AS user_name,
       u.email     AS user_email,
       u.department,
       u.status    AS user_status,
       sm.status,
       sm.seat_cost_cents,
       sm.assigned_at,
       sm.revoked_at,
       sm.revoked_reason,
       sm.last_login_at,
       sm.logins_last_30d,
       FLOOR(EXTRACT(EPOCH FROM (now() - COALESCE(sm.last_login_at, u.terminated_at, sm.assigned_at))) / 86400)::int
         AS days_since_login
     FROM seat_mappings sm
     JOIN users u ON u.id = sm.user_id
     WHERE sm.subscription_id = $1
       AND ($2::boolean IS FALSE
            OR (sm.status = 'active'
                AND (u.status = 'terminated'
                     OR sm.last_login_at IS NULL
                     OR sm.last_login_at < now() - INTERVAL '60 days')))
     ORDER BY (sm.status = 'active') DESC, days_since_login DESC NULLS FIRST, sm.seat_cost_cents DESC
     LIMIT $3`,
    [subscriptionId, staleOnly, limit],
  );
}

/**
 * Revokes up to `seats` active seat grants, worst offenders first:
 * holders who left the company, then the longest-silent accounts.
 * @param {import('pg').PoolClient} client
 * @returns {Promise<object[]>} the revoked rows
 */
async function revokeWorstSeats(client, { subscriptionId, seats, reason }) {
  const { rows } = await client.query(
    `WITH candidates AS (
       SELECT sm.id
         FROM seat_mappings sm
         JOIN users u ON u.id = sm.user_id
        WHERE sm.subscription_id = $1
          AND sm.status = 'active'
        ORDER BY
          CASE WHEN u.status = 'terminated' THEN 0 ELSE 1 END,
          COALESCE(sm.last_login_at, u.terminated_at, sm.assigned_at) ASC,
          sm.id ASC
        LIMIT $2::int
     )
     UPDATE seat_mappings sm
        SET status = 'revoked',
            revoked_at = now(),
            revoked_reason = $3,
            logins_last_30d = 0
       FROM candidates c
      WHERE sm.id = c.id
      RETURNING sm.id, sm.user_id, sm.seat_cost_cents`,
    [subscriptionId, seats, reason],
  );
  return rows;
}

/** Revokes every remaining active seat (used when a contract is cancelled). */
async function revokeAllSeats(client, { subscriptionId, reason }) {
  const { rows } = await client.query(
    `UPDATE seat_mappings
        SET status = 'revoked',
            revoked_at = now(),
            revoked_reason = $2,
            logins_last_30d = 0
      WHERE subscription_id = $1
        AND status = 'active'
      RETURNING id, user_id, seat_cost_cents`,
    [subscriptionId, reason],
  );
  return rows;
}

/**
 * Applies a whitelisted patch to a subscription and returns the fresh row.
 * @param {import('pg').PoolClient} client
 * @param {number} subscriptionId
 * @param {object} patch already-normalised column values
 */
async function updateSubscription(client, subscriptionId, patch) {
  const { rows } = await client.query(
    `UPDATE subscriptions
        SET vendor_name          = COALESCE($2, vendor_name),
            product_name         = COALESCE($3, product_name),
            seats_paid           = COALESCE($4, seats_paid),
            unit_cost_cents      = COALESCE($5, unit_cost_cents),
            recurring_cost_cents = COALESCE($6, recurring_cost_cents),
            status               = COALESCE($7, status),
            contract_owner_email = COALESCE($8, contract_owner_email),
            next_renewal_at      = COALESCE($9, next_renewal_at),
            cancelled_at         = CASE WHEN $13::boolean THEN NULL ELSE COALESCE($10, cancelled_at) END,
            cancellation_reason  = CASE WHEN $13::boolean THEN NULL ELSE COALESCE($11, cancellation_reason) END,
            notes                = COALESCE($12, notes)
      WHERE id = $1
      RETURNING *`,
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
      // $13 — explicit NULL write, needed when a contract is reactivated
      // (COALESCE cannot distinguish "unchanged" from "set to null").
      patch.clearCancellation === true,
    ],
  );
  return rows[0] ?? null;
}

/** Candidate targets for a consolidation move (other vendors in the same bucket). */
async function listConsolidationTargets(companyId, { categoryGroup, excludeSubscriptionId }) {
  return many(
    `SELECT subscription_id AS id, vendor_name, product_name, category_group, seats_paid,
            unit_cost_cents, recurring_cost_cents, healthy_seats, health_score
       FROM v_subscription_activity
      WHERE company_id = $1
        AND category_group = $2
        AND subscription_id <> $3
        AND status = 'active'
      ORDER BY healthy_seats DESC, recurring_cost_cents DESC`,
    [companyId, categoryGroup, excludeSubscriptionId],
  );
}

/** Audit row written for every optimization. */
async function insertOptimizationEvent(client, event) {
  const { rows } = await client.query(
    `INSERT INTO optimization_events
       (company_id, subscription_id, action, seats_reclaimed, previous_cost_cents,
        new_cost_cents, savings_cents, payload, performed_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)
     RETURNING *`,
    [
      event.companyId,
      event.subscriptionId,
      event.action,
      event.seatsReclaimed,
      event.previousCostCents,
      event.newCostCents,
      event.savingsCents,
      JSON.stringify(event.payload ?? {}),
      event.performedBy,
    ],
  );
  return rows[0];
}

/** Optimization history (per contract, or company-wide). */
async function listOptimizationEvents({ companyId, subscriptionId = null, limit = 50 }) {
  return many(
    `SELECT e.id, e.company_id, e.subscription_id, s.vendor_name, e.action, e.seats_reclaimed,
            e.previous_cost_cents, e.new_cost_cents, e.savings_cents, e.payload, e.performed_by, e.created_at
       FROM optimization_events e
       JOIN subscriptions s ON s.id = e.subscription_id
      WHERE e.company_id = $1
        AND ($2::int IS NULL OR e.subscription_id = $2)
      ORDER BY e.created_at DESC, e.id DESC
      LIMIT $3`,
    [companyId, subscriptionId, limit],
  );
}

/** Companies available in the database (the tenant switcher for the demo UI). */
async function listCompanies() {
  return many(
    `SELECT c.id, c.name, c.domain, c.headcount, c.currency, c.stale_license_days, c.active_seat_days,
            (SELECT COUNT(*)::int FROM users u WHERE u.company_id = c.id)      AS users_count,
            (SELECT COUNT(*)::int FROM subscriptions s
              WHERE s.company_id = c.id AND s.status = 'active')               AS active_subscriptions
       FROM companies c
      ORDER BY c.name`,
  );
}

async function findCompanyById(companyId) {
  return one(
    `SELECT id, name, domain, headcount, currency, stale_license_days, active_seat_days
       FROM companies WHERE id = $1`,
    [companyId],
  );
}

module.exports = {
  SELECT_COLUMNS,
  listSubscriptions,
  countSubscriptions,
  findCompanyIdForSubscription,
  findSubscriptionById,
  lockSubscription,
  listSeatMappings,
  revokeWorstSeats,
  revokeAllSeats,
  updateSubscription,
  listConsolidationTargets,
  insertOptimizationEvent,
  listOptimizationEvents,
  listCompanies,
  findCompanyById,
};
