/**
 * analyticsRepository.js — all spend/waste SQL lives here.
 *
 * The analytics pipeline is expressed as a chain of CTEs, built once in
 * `pipeline` below and appended to by each query. It performs a three-way join:
 *
 *   subscriptions (the money)
 *     ⨝ seat_mappings (which user holds which paid seat)
 *     ⨝ users         (is that user still employed?)
 *
 * CTE chain:
 *   bounds        -> resolves as-of timestamp + the two configurable windows
 *   seat_rollup   -> per-subscription seat counts: assigned / healthy / stale
 *   active_subs   -> adds idle seats (paid but never provisioned)
 *   ranked        -> ROW_NUMBER() per category_group => isolates the incumbent
 *   lines         -> per-subscription waste candidates (stale / idle / duplicate)
 *   final         -> resolves the single money figure per line (zombie override)
 *
 * WASTE IS COUNTED ONCE. A zombie subscription (zero healthy seats for 30+ days)
 * claims its entire recurring cost; every other subscription contributes
 * stale-seat cost + idle-seat cost + a duplicate premium that is capped at
 * (recurring cost - already counted leakage), so a dollar is never counted twice.
 */
"use strict";

const { many, one } = require("../db/database");

/**
 * Shared CTE pipeline. Placeholders:
 *   $1 company_id  $2 as_of (timestamptz)  $3 stale window (days)  $4 active window (days)
 */
const pipeline = `
WITH bounds AS (
  SELECT $1::int              AS company_id,
         $2::timestamptz      AS as_of,
         make_interval(days => $3::int) AS stale_window,
         make_interval(days => $4::int) AS active_window
),
seat_rollup AS (
  SELECT
    sm.subscription_id,
    COUNT(*) FILTER (WHERE sm.status = 'active') AS assigned_seats,
    COUNT(*) FILTER (
      WHERE sm.status = 'active'
        AND u.status <> 'terminated'
        AND sm.last_login_at IS NOT NULL
        AND sm.last_login_at >= b.as_of - b.active_window
    ) AS healthy_seats,
    COUNT(*) FILTER (
      WHERE sm.status = 'active'
        AND (u.status = 'terminated' OR sm.last_login_at IS NULL OR sm.last_login_at < b.as_of - b.stale_window)
    ) AS stale_seats,
    COALESCE(SUM(sm.seat_cost_cents) FILTER (
      WHERE sm.status = 'active'
        AND (u.status = 'terminated' OR sm.last_login_at IS NULL OR sm.last_login_at < b.as_of - b.stale_window)
    ), 0) AS stale_seat_cost_cents
  FROM seat_mappings sm
  JOIN users u ON u.id = sm.user_id
  CROSS JOIN bounds b
  GROUP BY sm.subscription_id
),
active_subs AS (
  SELECT
    s.id,
    s.vendor_name,
    s.product_name,
    s.category,
    s.category_group,
    s.billing_model,
    s.seats_paid,
    s.unit_cost_cents,
    s.recurring_cost_cents,
    s.contract_owner_email,
    s.next_renewal_at,
    COALESCE(r.assigned_seats, 0)        AS assigned_seats,
    COALESCE(r.healthy_seats, 0)         AS healthy_seats,
    COALESCE(r.stale_seats, 0)           AS stale_seats,
    COALESCE(r.stale_seat_cost_cents, 0) AS stale_waste_cents,
    GREATEST(s.seats_paid - COALESCE(r.assigned_seats, 0), 0) AS idle_seats
  FROM subscriptions s
  LEFT JOIN seat_rollup r ON r.subscription_id = s.id
  CROSS JOIN bounds b
  WHERE s.company_id = b.company_id
    AND s.status = 'active'
),
ranked AS (
  SELECT
    a.*,
    -- Adoption ratio drives both the duplicate ranking and the health score.
    CASE
      WHEN a.billing_model = 'per_seat' AND a.seats_paid > 0
        THEN a.healthy_seats::numeric / a.seats_paid
      ELSE 1
    END AS adoption_ratio,
    COUNT(*) OVER (PARTITION BY a.category_group) AS category_vendors,
    ROW_NUMBER() OVER (
      PARTITION BY a.category_group
      ORDER BY
        CASE WHEN a.billing_model = 'per_seat' AND a.seats_paid > 0
             THEN a.healthy_seats::numeric / a.seats_paid ELSE 1 END DESC,
        a.recurring_cost_cents DESC
    ) AS category_rank
  FROM active_subs a
),
lines AS (
  SELECT
    r.*,
    (r.billing_model = 'per_seat' AND r.seats_paid > 0 AND r.assigned_seats > 0 AND r.healthy_seats = 0)
      AS is_zombie,
    CASE WHEN r.billing_model = 'per_seat' THEN r.idle_seats * r.unit_cost_cents ELSE 0 END
      AS idle_waste_cents,
    CASE
      WHEN r.category_vendors > 1 AND r.category_rank > 1
        THEN GREATEST(
          r.recurring_cost_cents - r.stale_waste_cents
          - CASE WHEN r.billing_model = 'per_seat' THEN r.idle_seats * r.unit_cost_cents ELSE 0 END,
          0
        )
      ELSE 0
    END AS duplicate_waste_cents
  FROM ranked r
),
final AS (
  SELECT
    l.*,
    CASE
      WHEN l.is_zombie THEN l.recurring_cost_cents
      ELSE l.stale_waste_cents + l.idle_waste_cents + l.duplicate_waste_cents
    END AS line_waste_cents
  FROM lines l
)`;

/**
 * (a) Total spend + (b) total waste, with the waste split into its sources.
 * @param {{companyId: number, asOf: Date, staleDays: number, activeDays: number}} params
 */
async function getSpendSummary({ companyId, asOf, staleDays, activeDays }) {
  return one(
    `${pipeline}
     SELECT
       COUNT(*)::int                                    AS active_subscriptions,
       COALESCE(SUM(recurring_cost_cents), 0)::bigint   AS monthly_spend_cents,
       COALESCE(SUM(seats_paid), 0)::int                AS seats_paid,
       COALESCE(SUM(assigned_seats), 0)::int            AS assigned_seats,
       COALESCE(SUM(healthy_seats), 0)::int             AS healthy_seats,
       COALESCE(SUM(stale_seats), 0)::int               AS stale_seats,
       COALESCE(SUM(idle_seats), 0)::int                AS idle_seats,
       COUNT(*) FILTER (WHERE is_zombie)::int           AS zombie_subscriptions,
       COUNT(*) FILTER (WHERE category_vendors > 1 AND category_rank > 1)::int
                                                        AS duplicate_subscriptions,
       COUNT(DISTINCT category_group) FILTER (WHERE category_vendors > 1)::int
                                                        AS duplicate_category_groups,
       COALESCE(SUM(stale_waste_cents)     FILTER (WHERE NOT is_zombie), 0)::bigint AS stale_license_waste_cents,
       COALESCE(SUM(idle_waste_cents)      FILTER (WHERE NOT is_zombie), 0)::bigint AS idle_seat_waste_cents,
       COALESCE(SUM(duplicate_waste_cents) FILTER (WHERE NOT is_zombie), 0)::bigint AS duplicate_category_waste_cents,
       COALESCE(SUM(recurring_cost_cents)  FILTER (WHERE is_zombie), 0)::bigint      AS zombie_waste_cents,
       COALESCE(SUM(line_waste_cents), 0)::bigint       AS total_waste_cents,
       -- Estate-wide seat utilisation: active seats over paid seats for seat-priced
       -- contracts (aggregate ratio, not an average of per-vendor ratios).
       COALESCE(ROUND(
         100.0 * SUM(healthy_seats) FILTER (WHERE billing_model = 'per_seat')
               / NULLIF(SUM(seats_paid) FILTER (WHERE billing_model = 'per_seat'), 0)
       ), 0)::int AS seat_utilisation_pct
     FROM final`,
    [companyId, asOf, staleDays, activeDays],
  );
}

/** Estate-wide status counts (active vs cancelled vs consolidated), from the view. */
async function getEstateSummary(companyId) {
  return one(
    `SELECT
       COUNT(*)::int                                                       AS subscriptions_total,
       COUNT(*) FILTER (WHERE status = 'active')::int                      AS subscriptions_active,
       COUNT(*) FILTER (WHERE status = 'cancelled')::int                   AS subscriptions_cancelled,
       COUNT(*) FILTER (WHERE status = 'consolidated')::int                AS subscriptions_consolidated,
       COUNT(*) FILTER (WHERE status = 'paused')::int                      AS subscriptions_paused,
       COALESCE(SUM(recurring_cost_cents) FILTER (WHERE status = 'active'), 0)::bigint  AS active_mrr_cents,
       COALESCE(ROUND(AVG(health_score) FILTER (WHERE status = 'active')), 0)::int      AS avg_health_score
     FROM v_subscription_activity
     WHERE company_id = $1`,
    [companyId],
  );
}

/**
 * Waste attributed to licences whose holder is offboarded or silent beyond the
 * stale window (>60 days by default). Returns the individual seat rows so the
 * API can show *why* each dollar is considered wasted.
 */
async function listStaleLicenses({ companyId, asOf, staleDays, activeDays, limit }) {
  return many(
    `WITH bounds AS (
       SELECT $1::int AS company_id,
              $2::timestamptz AS as_of,
              make_interval(days => $3::int) AS stale_window,
              make_interval(days => $4::int) AS active_window
     )
     SELECT
       s.id                    AS subscription_id,
       s.vendor_name,
       s.product_name,
       s.category,
       s.category_group,
       s.billing_model,
       u.id                    AS user_id,
       u.full_name             AS user_name,
       u.email                 AS user_email,
       u.department,
       u.status                AS user_status,
       sm.id                   AS seat_mapping_id,
       sm.seat_cost_cents,
       sm.logins_last_30d,
       sm.last_login_at,
       FLOOR(EXTRACT(EPOCH FROM (
         b.as_of - COALESCE(sm.last_login_at, u.terminated_at, sm.assigned_at)
       )) / 86400)::int        AS days_since_login,
       CASE
         WHEN u.status = 'terminated'      THEN 'offboarded_holder'
         WHEN sm.last_login_at IS NULL     THEN 'never_logged_in'
         ELSE 'inactive_beyond_window'
       END                     AS reason
     FROM seat_mappings sm
     JOIN users u         ON u.id = sm.user_id
     JOIN subscriptions s ON s.id = sm.subscription_id
     CROSS JOIN bounds b
     WHERE s.company_id = b.company_id
       AND s.status = 'active'
       AND sm.status = 'active'
       AND (u.status = 'terminated'
            OR sm.last_login_at IS NULL
            OR sm.last_login_at < b.as_of - b.stale_window)
     ORDER BY days_since_login DESC, sm.seat_cost_cents DESC
     LIMIT $5::int`,
    [companyId, asOf, staleDays, activeDays, limit],
  );
}

/**
 * Duplicate-tooling groups: every category_group where more than one active
 * subscription is billed. `category_rank = 1` is the incumbent (highest seat
 * adoption, then highest cost); the rest are consolidation candidates.
 */
async function listDuplicateCategories({ companyId, asOf, staleDays, activeDays }) {
  return many(
    `${pipeline}
     SELECT
       category_group,
       COUNT(*)::int                             AS vendor_count,
       COALESCE(SUM(recurring_cost_cents), 0)::bigint  AS category_monthly_cents,
       COALESCE(SUM(duplicate_waste_cents), 0)::bigint AS duplicate_waste_cents,
       json_agg(json_build_object(
         'subscriptionId', id,
         'vendorName', vendor_name,
         'productName', product_name,
         'category', category,
         'billingModel', billing_model,
         'monthlyCents', recurring_cost_cents,
         'seatsPaid', seats_paid,
         'healthySeats', healthy_seats,
         'staleSeats', stale_seats,
         'adoptionPct', CASE
             WHEN billing_model = 'per_seat' AND seats_paid > 0
               THEN ROUND(100.0 * healthy_seats / seats_paid, 1)
             ELSE NULL
           END,
         'categoryRank', category_rank,
         'isIncumbent', category_rank = 1,
         'isDuplicateCandidate', category_rank > 1 AND duplicate_waste_cents > 0,
         'duplicateWasteCents', duplicate_waste_cents,
         'isZombie', is_zombie
       ) ORDER BY category_rank) AS vendors
     FROM final
     WHERE category_vendors > 1
     GROUP BY category_group
     ORDER BY COALESCE(SUM(duplicate_waste_cents), 0) DESC, COALESCE(SUM(recurring_cost_cents), 0) DESC`,
    [companyId, asOf, staleDays, activeDays],
  );
}

/** Per-vendor waste, largest first — the "where do I start" list for a CFO. */
async function listWasteOffenders({ companyId, asOf, staleDays, activeDays, limit }) {
  return many(
    `${pipeline}
     SELECT
       id                        AS subscription_id,
       vendor_name,
       product_name,
       category,
       category_group,
       billing_model,
       seats_paid,
       healthy_seats,
       stale_seats,
       idle_seats,
       is_zombie,
       category_vendors,
       category_rank,
       recurring_cost_cents,
       stale_waste_cents,
       idle_waste_cents,
       duplicate_waste_cents,
       line_waste_cents
     FROM final
     WHERE line_waste_cents > 0
     ORDER BY line_waste_cents DESC, recurring_cost_cents DESC
     LIMIT $5::int`,
    [companyId, asOf, staleDays, activeDays, limit],
  );
}

/** Spend by normalised category group (drives the dashboard donut). */
async function listCategorySpend({ companyId, asOf, staleDays, activeDays }) {
  return many(
    `${pipeline}
     SELECT
       category_group,
       COUNT(*)::int                                   AS vendor_count,
       COALESCE(SUM(recurring_cost_cents), 0)::bigint  AS monthly_cents,
       COALESCE(SUM(line_waste_cents), 0)::bigint      AS waste_cents,
       COALESCE(SUM(seats_paid), 0)::int               AS seats_paid,
       COUNT(*) FILTER (WHERE category_vendors > 1)::int AS overlapping_vendor_count
     FROM final
     GROUP BY category_group
     ORDER BY monthly_cents DESC`,
    [companyId, asOf, staleDays, activeDays],
  );
}

/** Renewals inside the next N days — used for the "act before it auto-renews" nudge. */
async function listUpcomingRenewals({ companyId, withinDays }) {
  return many(
    `SELECT
       id AS subscription_id,
       vendor_name,
       category_group,
       recurring_cost_cents,
       next_renewal_at,
       GREATEST(0, CEIL(EXTRACT(EPOCH FROM (next_renewal_at - now())) / 86400))::int AS days_until_renewal
     FROM subscriptions
     WHERE company_id = $1
       AND status = 'active'
       AND next_renewal_at IS NOT NULL
       AND next_renewal_at <= now() + make_interval(days => $2::int)
     ORDER BY next_renewal_at ASC`,
    [companyId, withinDays],
  );
}

module.exports = {
  pipeline,
  getSpendSummary,
  getEstateSummary,
  listStaleLicenses,
  listDuplicateCategories,
  listWasteOffenders,
  listCategorySpend,
  listUpcomingRenewals,
};
