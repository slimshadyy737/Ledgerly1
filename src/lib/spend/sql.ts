/**
 * ---------------------------------------------------------------------------
 * Spend API — SQL layer (Next.js runtime)
 * ---------------------------------------------------------------------------
 * The exact same statements the standalone Express service runs in
 * `server/src/repositories/*.js`, kept here in TypeScript so the Next.js route
 * handlers can serve the identical REST contract from the identical tables
 * (companies, users, subscriptions, seat_mappings, optimization_events).
 *
 * Two implementations, one contract: whichever backend the React dashboard talks
 * to, `/api/analytics` and `/api/subscriptions` return the same JSON.
 *
 * Placeholder convention for the analytics pipeline:
 *   $1 company_id   $2 as_of (timestamptz)   $3 stale window (days)   $4 active window (days)
 */

/**
 * Shared CTE pipeline:
 *   bounds       resolves the as-of timestamp + the two configurable windows
 *   seat_rollup  per-subscription seat counts: assigned / healthy / stale
 *   active_subs  adds idle seats (paid but never provisioned)
 *   ranked       ranks vendors within a category group (incumbent = rank 1)
 *   lines        per-subscription waste candidates
 *   final        resolves ONE money figure per line (zombie overrides)
 *
 * Waste is counted once per month: a zombie contract claims its whole invoice;
 * otherwise stale + idle + a duplicate premium capped at
 * (cost - already counted leakage) is used.
 */
export const PIPELINE = `
WITH bounds AS (
  SELECT $1::int                  AS company_id,
         $2::timestamptz          AS as_of,
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

/** (a) total spend + (b) total waste, split by source. */
export const SPEND_SUMMARY_SQL = `${PIPELINE}
SELECT
  COUNT(*)::int                                    AS active_subscriptions,
  COALESCE(SUM(recurring_cost_cents), 0)::bigint    AS monthly_spend_cents,
  COALESCE(SUM(seats_paid), 0)::int                 AS seats_paid,
  COALESCE(SUM(assigned_seats), 0)::int             AS assigned_seats,
  COALESCE(SUM(healthy_seats), 0)::int              AS healthy_seats,
  COALESCE(SUM(stale_seats), 0)::int                AS stale_seats,
  COALESCE(SUM(idle_seats), 0)::int                 AS idle_seats,
  COUNT(*) FILTER (WHERE is_zombie)::int            AS zombie_subscriptions,
  COUNT(*) FILTER (WHERE category_vendors > 1 AND category_rank > 1)::int
                                                    AS duplicate_subscriptions,
  COUNT(DISTINCT category_group) FILTER (WHERE category_vendors > 1)::int
                                                    AS duplicate_category_groups,
  COALESCE(SUM(stale_waste_cents)     FILTER (WHERE NOT is_zombie), 0)::bigint AS stale_license_waste_cents,
  COALESCE(SUM(idle_waste_cents)      FILTER (WHERE NOT is_zombie), 0)::bigint AS idle_seat_waste_cents,
  COALESCE(SUM(duplicate_waste_cents) FILTER (WHERE NOT is_zombie), 0)::bigint AS duplicate_category_waste_cents,
  COALESCE(SUM(recurring_cost_cents)  FILTER (WHERE is_zombie), 0)::bigint      AS zombie_waste_cents,
  COALESCE(SUM(line_waste_cents), 0)::bigint        AS total_waste_cents,
  COALESCE(ROUND(
    100.0 * SUM(healthy_seats) FILTER (WHERE billing_model = 'per_seat')
          / NULLIF(SUM(seats_paid) FILTER (WHERE billing_model = 'per_seat'), 0)
  ), 0)::int AS seat_utilisation_pct
FROM final`;

/** Estate-wide status counts + average health. */
export const ESTATE_SUMMARY_SQL = `
SELECT
  COUNT(*)::int                                                  AS subscriptions_total,
  COUNT(*) FILTER (WHERE status = 'active')::int                 AS subscriptions_active,
  COUNT(*) FILTER (WHERE status = 'cancelled')::int              AS subscriptions_cancelled,
  COUNT(*) FILTER (WHERE status = 'consolidated')::int           AS subscriptions_consolidated,
  COUNT(*) FILTER (WHERE status = 'paused')::int                 AS subscriptions_paused,
  COALESCE(SUM(recurring_cost_cents) FILTER (WHERE status = 'active'), 0)::bigint AS active_mrr_cents,
  COALESCE(ROUND(AVG(health_score) FILTER (WHERE status = 'active')), 0)::int     AS avg_health_score
FROM v_subscription_activity
WHERE company_id = $1`;

/** Seat-by-seat evidence behind the ghost-seat rule (>60 days or offboarded). */
export const STALE_LICENSES_SQL = `
WITH bounds AS (
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
  )) / 86400)::int         AS days_since_login,
  CASE
    WHEN u.status = 'terminated'      THEN 'offboarded_holder'
    WHEN sm.last_login_at IS NULL     THEN 'never_logged_in'
    ELSE 'inactive_beyond_window'
  END                      AS reason
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
LIMIT $5::int`;

/** Duplicate-tooling groups (category_groups with more than one active vendor). */
export const DUPLICATE_CATEGORIES_SQL = `${PIPELINE}
SELECT
  category_group,
  COUNT(*)::int                                   AS vendor_count,
  COALESCE(SUM(recurring_cost_cents), 0)::bigint   AS category_monthly_cents,
  COALESCE(SUM(duplicate_waste_cents), 0)::bigint  AS duplicate_waste_cents,
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
ORDER BY COALESCE(SUM(duplicate_waste_cents), 0) DESC, COALESCE(SUM(recurring_cost_cents), 0) DESC`;

/** Per-vendor waste, largest first. */
export const WASTE_OFFENDERS_SQL = `${PIPELINE}
SELECT
  id AS subscription_id, vendor_name, product_name, category, category_group, billing_model,
  seats_paid, healthy_seats, stale_seats, idle_seats, is_zombie,
  category_vendors, category_rank, recurring_cost_cents,
  stale_waste_cents, idle_waste_cents, duplicate_waste_cents, line_waste_cents
FROM final
WHERE line_waste_cents > 0
ORDER BY line_waste_cents DESC, recurring_cost_cents DESC
LIMIT $5::int`;

/** Spend per normalised category group. */
export const CATEGORY_SPEND_SQL = `${PIPELINE}
SELECT
  category_group,
  COUNT(*)::int                                    AS vendor_count,
  COALESCE(SUM(recurring_cost_cents), 0)::bigint    AS monthly_cents,
  COALESCE(SUM(line_waste_cents), 0)::bigint        AS waste_cents,
  COALESCE(SUM(seats_paid), 0)::int                 AS seats_paid,
  COUNT(*) FILTER (WHERE category_vendors > 1)::int AS overlapping_vendor_count
FROM final
GROUP BY category_group
ORDER BY monthly_cents DESC`;

/** Renewals inside the next N days. */
export const UPCOMING_RENEWALS_SQL = `
SELECT
  id AS subscription_id, vendor_name, category_group, recurring_cost_cents, next_renewal_at,
  GREATEST(0, CEIL(EXTRACT(EPOCH FROM (next_renewal_at - now())) / 86400))::int AS days_until_renewal
FROM subscriptions
WHERE company_id = $1
  AND status = 'active'
  AND next_renewal_at IS NOT NULL
  AND next_renewal_at <= now() + make_interval(days => $2::int)
ORDER BY next_renewal_at ASC`;

/* ---------------------------------------------------------------------------
 * Subscription list + detail (read model: v_subscription_activity)
 * ---------------------------------------------------------------------------
 * `:filters` is filled with the exact predicate list so list/detail/count always
 * agree. Values are always bound, never interpolated.
 */
export const SUBSCRIPTION_COLUMNS = `
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

export const SUBSCRIPTION_FILTERS = `
        va.company_id = $1
    AND ($2::text IS NULL OR va.status = $2)
    AND ($3::text IS NULL OR va.category_group = $3)
    AND ($4::text IS NULL OR va.vendor_name ILIKE '%' || $4 || '%'
                        OR va.category     ILIKE '%' || $4 || '%'
                        OR COALESCE(va.product_name, '') ILIKE '%' || $4 || '%')
    AND ($5::int IS NULL OR va.recurring_cost_cents >= $5)
    AND ($6::boolean IS FALSE OR va.stale_seats > 0 OR va.idle_seats > 0)`;

/** Whitelisted sort keys -> SQL expressions (user input never reaches the SQL text). */
export const SUBSCRIPTION_SORTS: Record<string, string> = {
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
};

/* ------------------------------ write path -------------------------------- */

/**
 * Reclaimable seats inside one contract: active grants whose holder left the
 * company, never signed in, or has been silent beyond the tenant's window.
 * Ordered worst-first so a partial reclaim always removes dead seats.
 */
export const RECLAIMABLE_SEATS_SQL = `
SELECT sm.id, sm.user_id, sm.seat_cost_cents
  FROM seat_mappings sm
  JOIN users u ON u.id = sm.user_id
 WHERE sm.subscription_id = $1
   AND sm.status = 'active'
   AND (u.status = 'terminated'
        OR sm.last_login_at IS NULL
        OR sm.last_login_at < now() - make_interval(days => $2::int))
 ORDER BY CASE WHEN u.status = 'terminated' THEN 0 ELSE 1 END,
          COALESCE(sm.last_login_at, u.terminated_at, sm.assigned_at) ASC,
          sm.id ASC
 LIMIT $3::int`;

export const REVOKE_ALL_SEATS_SQL = `
UPDATE seat_mappings
   SET status = 'revoked', revoked_at = now(), revoked_reason = $2, logins_last_30d = 0
 WHERE subscription_id = $1 AND status = 'active'
 RETURNING id, user_id, seat_cost_cents`;

export const LOCK_SUBSCRIPTION_SQL = `
SELECT * FROM subscriptions WHERE id = $1 AND company_id = $2 FOR UPDATE`;

export const UPDATE_SUBSCRIPTION_SQL = `
UPDATE subscriptions
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
 RETURNING *`;

export const INSERT_EVENT_SQL = `
INSERT INTO optimization_events
  (company_id, subscription_id, action, seats_reclaimed, previous_cost_cents,
   new_cost_cents, savings_cents, payload, performed_by)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)
RETURNING *`;

export const OPTIMIZATION_EVENTS_SQL = `
SELECT e.id, e.company_id, e.subscription_id, s.vendor_name, e.action, e.seats_reclaimed,
       e.previous_cost_cents, e.new_cost_cents, e.savings_cents, e.payload, e.performed_by, e.created_at
  FROM optimization_events e
  JOIN subscriptions s ON s.id = e.subscription_id
 WHERE e.company_id = $1
   AND ($2::int IS NULL OR e.subscription_id = $2)
 ORDER BY e.created_at DESC, e.id DESC
 LIMIT $3`;

export const SEAT_MAPPINGS_SQL = `
SELECT
  sm.id, sm.subscription_id, sm.user_id, u.full_name AS user_name, u.email AS user_email,
  u.department, u.status AS user_status, sm.status, sm.seat_cost_cents, sm.assigned_at,
  sm.revoked_at, sm.revoked_reason, sm.last_login_at, sm.logins_last_30d,
  FLOOR(EXTRACT(EPOCH FROM (now() - COALESCE(sm.last_login_at, u.terminated_at, sm.assigned_at))) / 86400)::int
    AS days_since_login
FROM seat_mappings sm
JOIN users u ON u.id = sm.user_id
WHERE sm.subscription_id = $1
ORDER BY (sm.status = 'active') DESC, days_since_login DESC NULLS FIRST, sm.seat_cost_cents DESC
LIMIT $2`;

export const CONSOLIDATION_TARGETS_SQL = `
SELECT subscription_id AS id, vendor_name, product_name, category_group, seats_paid,
       unit_cost_cents, recurring_cost_cents, healthy_seats, health_score
  FROM v_subscription_activity
 WHERE company_id = $1 AND category_group = $2 AND subscription_id <> $3 AND status = 'active'
 ORDER BY healthy_seats DESC, recurring_cost_cents DESC`;

export const COMPANIES_SQL = `
SELECT c.id, c.name, c.domain, c.headcount, c.currency, c.stale_license_days, c.active_seat_days,
       (SELECT COUNT(*)::int FROM users u WHERE u.company_id = c.id) AS users_count,
       (SELECT COUNT(*)::int FROM subscriptions s WHERE s.company_id = c.id AND s.status = 'active')
         AS active_subscriptions
  FROM companies c
 ORDER BY c.name`;

export const COMPANY_BY_ID_SQL = `
SELECT id, name, domain, headcount, currency, stale_license_days, active_seat_days
  FROM companies WHERE id = $1`;

export const COMPANY_ID_FOR_SUBSCRIPTION_SQL = `SELECT company_id FROM subscriptions WHERE id = $1`;
