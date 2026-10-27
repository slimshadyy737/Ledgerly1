-- ===========================================================================
--  seed_ghost_seat_demo.sql
--  ---------------------------------------------------------------------------
--  Comprehensive SQL seed for the LedgerPulse Spend API schema
--  (server/src/db/schema.sql).
--
--  WHAT IT CREATES — one clean, deterministic demo tenant:
--
--    • 1 company ........... "Ridgepoint Software" (ridgepoint.io), 15 staff
--    • 15 corporate users ... 12 active + 3 completely inactive for 71-96 days
--    • 6 subscriptions ...... Zoom, Slack, Asana, Monday.com, Figma, Hotjar
--    • 57 seat_mappings ..... every seat's activity timestamp set explicitly
--    • 2 helper views ....... v_seat_last_activity, v_ghost_seats
--
--  WHY THE DATA IS SHAPED THIS WAY (so all detectors fire):
--
--    GHOST SEATS ......... Marcus Lindgren (96d), Grace Sullivan (84d) and
--                          Fatima Zahra (71d) are still employed but have not
--                          logged into any tool for 70+ days. Their licences are
--                          still being paid for → 10 ghost seats, $124.23/month.
--    DUPLICATE CATEGORY .. Asana (12 seats, 8 active) and Monday.com (6 seats,
--                          3 active) are both in "Project Management". Asana is
--                          the incumbent (higher adoption + higher cost), so
--                          Monday.com's $84.00/month is flagged as redundancy.
--    IDLE SEATS .......... Asana is invoiced for 12 seats but only 10 were ever
--                          provisioned in the seat register → 2 idle seats,
--                          $26.98/month.
--    ZOMBIE SOFTWARE ..... deliberately NOT triggered: every subscription keeps
--                          at least three active (logged-in-in-30-days) seats.
--
--  TOTAL: $753.13/month spend → $235.21/month waste (31.23%).
--
--  HOW TO RUN
--  ---------------------------------------------------------------------------
--    psql "$DATABASE_URL" -f server/src/db/seed_ghost_seat_demo.sql
--
--    # or explicitly:
--    psql postgresql://postgres:postgres@127.0.0.1:5432/app_db \
--         -f server/src/db/seed_ghost_seat_demo.sql
--
--    # convenience wrapper (uses DATABASE_URL from .env):
--    node server/src/db/seedDemoCompany.js
--
--  PROPERTIES
--  ---------------------------------------------------------------------------
--    * IDEMPOTENT — re-running replaces ONLY the ridgepoint.io tenant (removed
--      via ON DELETE CASCADE, then re-inserted), so seat counts, costs and
--      ghost-seat totals are identical on every run. Other tenants are untouched.
--    * TRANSACTIONAL — the whole load runs in one transaction; a failure leaves
--      the database unchanged.
--    * TIME-RELATIVE — all timestamps are `now() - INTERVAL 'n days'`, so the
--      "inactive for 70+ days" rule keeps holding no matter when you run this
--      file (hard-coded dates would silently expire).
--    * MONEY IN CENTS — every amount is an integer number of cents.
--
--  COLUMN NAMING NOTE
--  ---------------------------------------------------------------------------
--    The canonical schema column for the SSO timestamp is
--    seat_mappings.last_login_at. If your mental model (or an earlier draft) calls
--    it `last_activity_at`, the compatibility view `v_seat_last_activity` exposes
--    the exact same value under that name, so both read fine:
--
--        SELECT * FROM v_seat_last_activity WHERE last_activity_at < now() - INTERVAL '60 days';
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- SECTION 0 — Reset this demo tenant only (cascades to its users,
-- subscriptions, seat mappings and optimization events).
-- ---------------------------------------------------------------------------
DELETE FROM companies WHERE domain = 'ridgepoint.io';

-- ---------------------------------------------------------------------------
-- SECTION 1 — The company (tenant + detector thresholds)
-- ---------------------------------------------------------------------------
WITH new_company AS (
  INSERT INTO companies (name, domain, headcount, currency, stale_license_days, active_seat_days)
  VALUES (
    'Ridgepoint Software',   -- name
    'ridgepoint.io',         -- domain (used as the natural key for this seed)
    15,                      -- headcount
    'USD',                   -- currency
    60,                      -- ghost-seat rule:    inactive for more than 60 days
    30                       -- zombie rule:        no login within 30 days
  )
  RETURNING id, stale_license_days
)

-- -------------------------------------------------------------------------
-- SECTION 2 — 15 corporate users (HRIS roster export)
--
-- All 15 are *employed* (status = 'active'), which is exactly what makes the
-- trio below "ghost seats" rather than offboarded leavers: HR still pays for
-- them, but nobody has signed in for 70+ days.
-- -------------------------------------------------------------------------
, seed_users (full_name, email, department, job_title, status, hired_days_ago) AS (
  VALUES
    -- ---- active staff -------------------------------------------------
    ('Elena Marsh',      'elena.marsh@ridgepoint.io',      'Executive',        'Chief Executive Officer',   'active', 1640),
    ('Daniel Okafor',    'daniel.okafor@ridgepoint.io',    'Engineering',      'Chief Technology Officer',  'active', 1520),
    ('Priya Nair',       'priya.nair@ridgepoint.io',       'Engineering',      'VP Engineering',            'active', 1180),
    ('Rohan Iyer',       'rohan.iyer@ridgepoint.io',       'Engineering',      'Senior Backend Engineer',   'active',  940),
    ('Hana Kim',         'hana.kim@ridgepoint.io',         'Engineering',      'Frontend Engineer',         'active',  710),
    ('Sofia Almeida',    'sofia.almeida@ridgepoint.io',    'Design',           'Head of Design',            'active', 1260),
    ('Chloe Bennett',    'chloe.bennett@ridgepoint.io',    'Design',           'Product Designer',          'active',  620),
    ('Lucas Ferreira',   'lucas.ferreira@ridgepoint.io',   'Product',          'Head of Product',           'active', 1320),
    ('Tobias Krause',    'tobias.krause@ridgepoint.io',    'Marketing',        'Head of Growth',            'active', 1010),
    ('Amara Abiola',     'amara.abiola@ridgepoint.io',     'Marketing',        'Growth Marketer',           'active',  480),
    ('Peter Novak',      'peter.novak@ridgepoint.io',      'Finance',          'Finance Lead',              'active',  880),
    ('Nora Lindqvist',   'nora.lindqvist@ridgepoint.io',   'People Ops',       'People Ops Partner',        'active',  560),

    -- ---- INACTIVE STAFF (still employed, but silent for 71-96 days) ----
    -- These three accounts are the ghost seats. Their `last_login_at` values
    -- are set further down in SECTION 4 (96, 84 and 71 days ago), i.e. more
    -- than 70 days — comfortably past the 60-day threshold the analytics
    -- engine uses.
    ('Marcus Lindgren',  'marcus.lindgren@ridgepoint.io',  'Engineering',      'Platform Engineer',         'active', 1090),
    ('Grace Sullivan',   'grace.sullivan@ridgepoint.io',   'Product',          'Product Analyst',           'active',  820),
    ('Fatima Zahra',     'fatima.zahra@ridgepoint.io',     'Marketing',        'Content Lead',              'active',  690)
)
INSERT INTO users (company_id, full_name, email, department, job_title, status, hired_at, terminated_at)
SELECT nc.id,
       u.full_name,
       u.email,
       u.department,
       u.job_title,
       u.status,
       now() - make_interval(days => u.hired_days_ago),
       NULL                       -- nobody is terminated in this dataset
  FROM new_company nc
 CROSS JOIN seed_users u;

-- ---------------------------------------------------------------------------
-- SECTION 3 — 6 software subscriptions
--
-- `category_group` is the normalised bucket used by the duplicate-category
-- detector: Asana and Monday.com deliberately share 'Project Management'.
-- `recurring_cost_cents` is derived (seats × unit cost) so the invoice always
-- matches the licence maths the optimize endpoint recalculates.
-- ---------------------------------------------------------------------------
WITH tenant AS (
  SELECT id FROM companies WHERE domain = 'ridgepoint.io'
)
INSERT INTO subscriptions (
  company_id, vendor_name, product_name, category, category_group, billing_model,
  seats_paid, unit_cost_cents, recurring_cost_cents, currency, status,
  contract_owner_email, next_renewal_at, started_at, notes
)
SELECT t.id,
       s.vendor_name,
       s.product_name,
       s.category,
       s.category_group,
       'per_seat',
       s.seats_paid,
       s.unit_cost_cents,
       s.seats_paid * s.unit_cost_cents,        -- monthly charge = seats × unit price
       'USD',
       'active',
       s.contract_owner_email,
       now() + make_interval(days => s.renewal_in_days),
       now() - make_interval(days => s.started_days_ago),
       s.notes
  FROM tenant t
 CROSS JOIN (VALUES
    ('Zoom',        'Workplace Pro', 'Video Conferencing',    'Video Conferencing',     14, 1500,  12, 505, 'it-ops@ridgepoint.io',
     'Company-wide meetings. Includes 3 seats held by users who have not signed in for 70+ days.'),
    ('Slack',       'Business+',     'Team Communication',    'Team Communication',     15,  875,  47, 540, 'people-ops@ridgepoint.io',
     'Seats for all 15 staff, including the 3 inactive accounts — prime ghost-seat candidate.'),
    ('Asana',       'Premium',       'Project Management',    'Project Management',     12, 1349,  31, 520, 'bizops@ridgepoint.io',
     'Invoiced for 12 seats but only 10 exist in the licence register (2 idle seats).'),
    ('Monday.com',  'Pro',           'Project Management',    'Project Management',      6, 1400,  26, 240, 'bizops@ridgepoint.io',
     'Trialed by Marketing; overlaps Asana in the same category group — consolidation candidate.'),
    ('Figma',       'Organization',  'Design & Prototyping',  'Design & Prototyping',    5, 1500,  63, 300, 'design-lead@ridgepoint.io',
     'Core design tool, healthy adoption across Design/Product/Engineering.'),
    ('Hotjar',      'Business',      'Product Analytics',     'Product Analytics',       7, 1300,  19, 280, 'growth@ridgepoint.io',
     'Session recording. 2 of 7 seats belong to inactive users. Renews soon.')
 ) AS s (vendor_name, product_name, category, category_group, seats_paid, unit_cost_cents,
         renewal_in_days, started_days_ago, contract_owner_email, notes);

-- ---------------------------------------------------------------------------
-- SECTION 4 — seat_mappings: the licence register + SSO activity telemetry
--
-- One row per provisioned seat. The three columns finance and identity meet on:
--
--   assigned_at      when the licence was granted
--   last_login_at    the SSO export's `last_login_at` (aliased as
--                    `last_activity_at` in v_seat_last_activity)
--   logins_last_30d  login count in the last 30 days (0 for every stale/cold seat)
--
-- The seed definitions are (vendor, user_email, assigned_days_ago,
-- last_login_days_ago, logins_last_30d). Note the explicit 96 / 84 / 71 day
-- values for the three inactive accounts — all beyond the 70-day bar you asked
-- for and well beyond the engine's 60-day ghost-seat threshold.
--
-- Seat plan at a glance (59 paid seats, 57 provisioned):
--   Slack 15/15 · Zoom 14/14 · Asana 10/12 · Monday.com 6/6 · Figma 5/5 · Hotjar 7/7
-- ---------------------------------------------------------------------------
WITH tenant AS (
  SELECT id FROM companies WHERE domain = 'ridgepoint.io'
),

-- Republishing the licence register is cheap and keeps the file re-runnable.
purge AS (
  DELETE FROM seat_mappings
   WHERE subscription_id IN (
     SELECT s.id FROM subscriptions s JOIN tenant t ON t.id = s.company_id
   )
  RETURNING 1
),

seat_defs (vendor_name, user_email, assigned_days_ago, last_login_days_ago, logins_last_30d) AS (
  VALUES
    -- ===================== Slack Business+ (15 seats) =====================
    ('Slack', 'elena.marsh@ridgepoint.io',     540,  1, 62),
    ('Slack', 'daniel.okafor@ridgepoint.io',   505,  0, 71),
    ('Slack', 'priya.nair@ridgepoint.io',      470,  3, 48),
    ('Slack', 'rohan.iyer@ridgepoint.io',      430,  2, 44),
    ('Slack', 'hana.kim@ridgepoint.io',        415,  4, 39),
    ('Slack', 'marcus.lindgren@ridgepoint.io', 395, 96,  0),  -- GHOST SEAT (inactive 96 days)
    ('Slack', 'sofia.almeida@ridgepoint.io',   380,  5, 33),
    ('Slack', 'chloe.bennett@ridgepoint.io',   360,  7, 28),
    ('Slack', 'lucas.ferreira@ridgepoint.io',  350,  3, 35),
    ('Slack', 'grace.sullivan@ridgepoint.io',  340, 84,  0),  -- GHOST SEAT (inactive 84 days)
    ('Slack', 'tobias.krause@ridgepoint.io',   330,  1, 52),
    ('Slack', 'amara.abiola@ridgepoint.io',    320,  6, 31),
    ('Slack', 'fatima.zahra@ridgepoint.io',    310, 71,  0),  -- GHOST SEAT (inactive 71 days)
    ('Slack', 'peter.novak@ridgepoint.io',     300,  9, 19),
    ('Slack', 'nora.lindqvist@ridgepoint.io',  290, 12, 14),

    -- ==================== Zoom Workplace Pro (14 seats) ==================
    ('Zoom', 'elena.marsh@ridgepoint.io',      540,  4, 26),
    ('Zoom', 'daniel.okafor@ridgepoint.io',    505,  2, 31),
    ('Zoom', 'priya.nair@ridgepoint.io',       470,  1, 29),
    ('Zoom', 'rohan.iyer@ridgepoint.io',       430,  6, 22),
    ('Zoom', 'hana.kim@ridgepoint.io',         415,  5, 18),
    ('Zoom', 'marcus.lindgren@ridgepoint.io',  395, 96,  0),  -- GHOST SEAT
    ('Zoom', 'sofia.almeida@ridgepoint.io',    380,  3, 24),
    ('Zoom', 'chloe.bennett@ridgepoint.io',    360,  8, 15),
    ('Zoom', 'lucas.ferreira@ridgepoint.io',   350,  2, 27),
    ('Zoom', 'grace.sullivan@ridgepoint.io',   340, 84,  0),  -- GHOST SEAT
    ('Zoom', 'tobias.krause@ridgepoint.io',    330,  7, 12),
    ('Zoom', 'amara.abiola@ridgepoint.io',     320, 11,  9),
    ('Zoom', 'fatima.zahra@ridgepoint.io',     310, 71,  0),  -- GHOST SEAT
    ('Zoom', 'peter.novak@ridgepoint.io',      300, 14,  6),
    -- Nora Lindqvist has no Zoom licence (14 of 15 staff are provisioned).

    -- ======================= Asana Premium (10 of 12) ====================
    ('Asana', 'elena.marsh@ridgepoint.io',     500,  5, 12),
    ('Asana', 'priya.nair@ridgepoint.io',      480,  2, 21),
    ('Asana', 'sofia.almeida@ridgepoint.io',   400,  6, 10),
    ('Asana', 'lucas.ferreira@ridgepoint.io',  365,  3, 16),
    ('Asana', 'tobias.krause@ridgepoint.io',   340,  8,  8),
    ('Asana', 'amara.abiola@ridgepoint.io',    335, 10,  7),
    ('Asana', 'grace.sullivan@ridgepoint.io',  345, 84,  0),  -- GHOST SEAT
    ('Asana', 'fatima.zahra@ridgepoint.io',    320, 71,  0),  -- GHOST SEAT
    ('Asana', 'peter.novak@ridgepoint.io',     300, 16,  5),
    ('Asana', 'nora.lindqvist@ridgepoint.io',  280, 13,  4),
    -- 2 paid seats have no row here on purpose → IDLE SEATS ($26.98/month).

    -- ===================== Monday.com Pro (6 seats) ======================
    ('Monday.com', 'sofia.almeida@ridgepoint.io',   240, 22, 6),   -- healthy
    ('Monday.com', 'chloe.bennett@ridgepoint.io',   235, 18, 9),   -- healthy
    ('Monday.com', 'nora.lindqvist@ridgepoint.io',  190, 26, 3),   -- healthy
    ('Monday.com', 'amara.abiola@ridgepoint.io',    210, 34, 0),   -- cold (not a ghost: < 60 days)
    ('Monday.com', 'lucas.ferreira@ridgepoint.io',  230, 36, 0),   -- cold
    ('Monday.com', 'peter.novak@ridgepoint.io',     200, 33, 0),   -- cold
    -- 3/6 active seats → Asana remains the incumbent of "Project Management".

    -- ==================== Figma Organization (5 seats) ===================
    ('Figma', 'sofia.almeida@ridgepoint.io',   300,  2, 19),
    ('Figma', 'chloe.bennett@ridgepoint.io',   260,  1, 23),
    ('Figma', 'lucas.ferreira@ridgepoint.io',  250,  4, 14),
    ('Figma', 'hana.kim@ridgepoint.io',        245,  3, 11),
    ('Figma', 'tobias.krause@ridgepoint.io',   220,  6,  9),

    -- ====================== Hotjar Business (7 seats) ====================
    ('Hotjar', 'tobias.krause@ridgepoint.io',  200,  2, 17),
    ('Hotjar', 'amara.abiola@ridgepoint.io',   195,  5, 13),
    ('Hotjar', 'grace.sullivan@ridgepoint.io',  190, 84,  0),  -- GHOST SEAT
    ('Hotjar', 'fatima.zahra@ridgepoint.io',    185, 71,  0),  -- GHOST SEAT
    ('Hotjar', 'lucas.ferreira@ridgepoint.io',  180,  8,  7),
    ('Hotjar', 'priya.nair@ridgepoint.io',      175, 12,  5),
    ('Hotjar', 'elena.marsh@ridgepoint.io',     170,  7,  6)
)
INSERT INTO seat_mappings (
  subscription_id, user_id, seat_cost_cents, status,
  assigned_at, last_login_at, logins_last_30d
)
SELECT
  s.id,
  u.id,
  s.unit_cost_cents,                                  -- per-seat price of that vendor
  'active',
  now() - make_interval(days => d.assigned_days_ago), -- licence grant date
  CASE
    WHEN d.last_login_days_ago IS NULL THEN NULL       -- never signed in
    ELSE now() - make_interval(days => d.last_login_days_ago)  -- <-- the ghost-seat signal
  END,
  d.logins_last_30d
FROM seat_defs d
JOIN tenant t ON TRUE
JOIN subscriptions s ON s.company_id = t.id AND s.vendor_name = d.vendor_name
JOIN users u         ON u.company_id = t.id AND u.email = d.user_email;

COMMIT;

-- ---------------------------------------------------------------------------
-- SECTION 5 — Analytics helper views (idempotent; safe to re-run)
--
-- These are convenience surfaces for psql demos and for any analytics worker
-- that prefers a view over a hand-written join. The Express API computes the
-- same numbers itself in repositories/analyticsRepository.js, parameterised by
-- company_id / as_of / staleDays / activeDays.
-- ---------------------------------------------------------------------------

-- 5a. Seat-level activity, with the requested `last_activity_at` alias so both
--     column names resolve to the same SSO timestamp.
CREATE OR REPLACE VIEW v_seat_last_activity AS
SELECT
  sm.id                          AS seat_mapping_id,
  sm.subscription_id,
  s.company_id,
  s.vendor_name,
  s.category_group,
  s.billing_model,
  sm.user_id,
  u.full_name,
  u.email,
  u.department,
  u.status                       AS user_status,
  sm.status                      AS seat_status,
  sm.seat_cost_cents,
  sm.logins_last_30d,
  sm.assigned_at,
  sm.last_login_at,                                      -- canonical schema column
  sm.last_login_at               AS last_activity_at,    -- compatibility alias
  FLOOR(EXTRACT(EPOCH FROM (now() - sm.last_login_at)) / 86400)::int
                                 AS days_since_last_activity,
  sm.revoked_at,
  sm.revoked_reason
FROM seat_mappings sm
JOIN users         u ON u.id = sm.user_id
JOIN subscriptions s ON s.id = sm.subscription_id;

-- 5b. The ghost-seat report: active billed seats whose holder left the company
--     or has been silent longer than the tenant's stale_license_days (60 here).
--     This is the SQL twin of the STALE_LICENSE detector in the API.
CREATE OR REPLACE VIEW v_ghost_seats AS
SELECT
  s.company_id,
  c.name                         AS company_name,
  s.id                           AS subscription_id,
  s.vendor_name,
  s.product_name,
  s.category_group,
  s.billing_model,
  s.seats_paid,
  sm.id                          AS seat_mapping_id,
  u.id                           AS user_id,
  u.full_name                    AS user_name,
  u.email                        AS user_email,
  u.department,
  u.status                       AS user_status,
  sm.seat_cost_cents,
  sm.last_login_at               AS last_activity_at,
  FLOOR(EXTRACT(EPOCH FROM (now() - sm.last_login_at)) / 86400)::int
                                 AS days_since_last_activity,
  CASE
    WHEN u.status = 'terminated'   THEN 'offboarded_holder'
    WHEN sm.last_login_at IS NULL  THEN 'never_logged_in'
    ELSE 'inactive_beyond_window'
  END                            AS ghost_reason,
  c.stale_license_days           AS threshold_days,
  sm.seat_cost_cents * 12        AS annualized_waste_cents
FROM seat_mappings sm
JOIN users         u ON u.id = sm.user_id
JOIN subscriptions s ON s.id = sm.subscription_id
JOIN companies     c ON c.id = s.company_id
WHERE sm.status = 'active'
  AND s.status  = 'active'
  AND (
        u.status = 'terminated'
     OR sm.last_login_at IS NULL
     OR sm.last_login_at < now() - make_interval(days => c.stale_license_days)
  );

-- ===========================================================================
-- SECTION 6 — VERIFICATION (read-only; runs after COMMIT so it reports reality)
-- ===========================================================================

-- V1. Tenant snapshot ------------------------------------------------------
SELECT
  c.id                       AS company_id,
  c.name                     AS company,
  c.domain,
  c.headcount                AS headcount_declared,
  (SELECT COUNT(*) FROM users u WHERE u.company_id = c.id)             AS users_loaded,
  (SELECT COUNT(*) FROM subscriptions s
    WHERE s.company_id = c.id AND s.status = 'active')                 AS subscriptions_active,
  (SELECT SUM(s.seats_paid) FROM subscriptions s
    WHERE s.company_id = c.id AND s.status = 'active')                 AS seats_paid,
  (SELECT COUNT(*) FROM seat_mappings sm
     JOIN subscriptions s2 ON s2.id = sm.subscription_id
    WHERE s2.company_id = c.id AND sm.status = 'active')               AS seats_provisioned,
  (SELECT SUM(s.recurring_cost_cents) FROM subscriptions s
    WHERE s.company_id = c.id AND s.status = 'active') / 100.0         AS monthly_spend_usd,
  c.stale_license_days       AS ghost_threshold_days
FROM companies c
WHERE c.domain = 'ridgepoint.io';

-- V2. The three inactive users (the reason this dataset exists) -------------
-- Every one of them is still on payroll, yet their most recent login is 70+
-- days old — so each licence they hold is a billable ghost seat.
SELECT
  u.full_name                                   AS inactive_user,
  u.email,
  u.department,
  u.status                                      AS hr_status,
  MAX(sm.last_login_at)::date                   AS last_activity_date,
  MIN(FLOOR(EXTRACT(EPOCH FROM (now() - sm.last_login_at)) / 86400))::int
                                                AS days_inactive,
  COUNT(sm.id)::int                             AS ghost_seats_held,
  SUM(sm.seat_cost_cents) / 100.0               AS ghost_spend_per_month_usd
FROM users u
JOIN seat_mappings sm ON sm.user_id = u.id
JOIN subscriptions s  ON s.id = sm.subscription_id
JOIN companies c      ON c.id = s.company_id
WHERE c.domain = 'ridgepoint.io'
  AND sm.status = 'active'
  AND sm.last_login_at < now() - INTERVAL '70 days'
GROUP BY u.id, u.full_name, u.email, u.department, u.status
ORDER BY days_inactive DESC;

-- V3. Ghost-seat report by vendor (reads the view from SECTION 5b) ----------
SELECT
  vendor_name,
  ghost_reason,
  COUNT(*)::int                    AS ghost_seats,
  SUM(seat_cost_cents) / 100.0     AS monthly_waste_usd,
  SUM(annualized_waste_cents) / 100.0 AS annualized_waste_usd
FROM v_ghost_seats
WHERE company_name = 'Ridgepoint Software'
GROUP BY vendor_name, ghost_reason
ORDER BY monthly_waste_usd DESC;

-- V4. Subscription inventory with seat utilisation -------------------------
SELECT
  s.vendor_name,
  s.category_group,
  s.seats_paid,
  COUNT(sm.id) FILTER (WHERE sm.status = 'active')                         AS seats_provisioned,
  COUNT(sm.id) FILTER (
    WHERE sm.status = 'active'
      AND sm.last_login_at >= now() - INTERVAL '30 days')                  AS active_users,
  GREATEST(s.seats_paid - COUNT(sm.id) FILTER (WHERE sm.status = 'active'), 0) AS idle_seats,
  s.recurring_cost_cents / 100.0                                           AS monthly_cost_usd,
  COUNT(*) OVER (PARTITION BY s.category_group)                            AS vendors_in_category
FROM subscriptions s
JOIN companies c     ON c.id = s.company_id
LEFT JOIN seat_mappings sm ON sm.subscription_id = s.id
WHERE c.domain = 'ridgepoint.io'
GROUP BY s.id, s.vendor_name, s.category_group, s.seats_paid, s.recurring_cost_cents
ORDER BY s.recurring_cost_cents DESC;

-- V5. Waste summary — mirrors what GET /api/analytics returns ---------------
WITH tenant AS (
  SELECT id, stale_license_days FROM companies WHERE domain = 'ridgepoint.io'
),
active_subs AS (
  SELECT s.id, s.vendor_name, s.category_group, s.billing_model, s.seats_paid,
         s.unit_cost_cents, s.recurring_cost_cents,
         COALESCE(r.assigned_seats, 0)        AS assigned_seats,
         COALESCE(r.healthy_seats, 0)         AS healthy_seats,
         COALESCE(r.stale_seats, 0)           AS stale_seats,
         COALESCE(r.stale_cost_cents, 0)      AS stale_cost_cents
  FROM subscriptions s
  JOIN tenant t ON t.id = s.company_id
  LEFT JOIN LATERAL (
    SELECT
      COUNT(*) FILTER (WHERE sm.status = 'active') AS assigned_seats,
      COUNT(*) FILTER (
        WHERE sm.status = 'active' AND u.status <> 'terminated'
          AND sm.last_login_at >= now() - INTERVAL '30 days') AS healthy_seats,
      COUNT(*) FILTER (
        WHERE sm.status = 'active'
          AND (u.status = 'terminated' OR sm.last_login_at IS NULL
               OR sm.last_login_at < now() - make_interval(days => t.stale_license_days))) AS stale_seats,
      COALESCE(SUM(sm.seat_cost_cents) FILTER (
        WHERE sm.status = 'active'
          AND (u.status = 'terminated' OR sm.last_login_at IS NULL
               OR sm.last_login_at < now() - make_interval(days => t.stale_license_days))), 0) AS stale_cost_cents
    FROM seat_mappings sm
    JOIN users u ON u.id = sm.user_id
    WHERE sm.subscription_id = s.id
  ) r ON TRUE
  WHERE s.status = 'active'
),
ranked AS (
  SELECT *,
         ROW_NUMBER() OVER (
           PARTITION BY category_group
           ORDER BY (CASE WHEN billing_model = 'per_seat' AND seats_paid > 0
                          THEN healthy_seats::numeric / seats_paid ELSE 1 END) DESC,
                    recurring_cost_cents DESC
         ) AS category_rank
  FROM active_subs
),
waste AS (
  SELECT
    recurring_cost_cents,
    stale_cost_cents                                                        AS ghost_waste_cents,
    CASE WHEN billing_model = 'per_seat'
         THEN GREATEST(seats_paid - assigned_seats, 0) * unit_cost_cents ELSE 0 END AS idle_waste_cents,
    CASE WHEN category_rank > 1
         THEN GREATEST(recurring_cost_cents - stale_cost_cents
                - CASE WHEN billing_model = 'per_seat'
                       THEN GREATEST(seats_paid - assigned_seats, 0) * unit_cost_cents ELSE 0 END, 0)
         ELSE 0 END                                                         AS duplicate_waste_cents
  FROM ranked
)
SELECT
  (SELECT SUM(recurring_cost_cents) FROM waste) / 100.0                    AS total_monthly_spend_usd,
  SUM(ghost_waste_cents) / 100.0                                          AS ghost_seat_waste_usd,
  SUM(idle_waste_cents) / 100.0                                           AS idle_seat_waste_usd,
  SUM(duplicate_waste_cents) / 100.0                                       AS duplicate_category_waste_usd,
  SUM(ghost_waste_cents + idle_waste_cents + duplicate_waste_cents) / 100.0 AS total_monthly_waste_usd,
  ROUND(100.0 * SUM(ghost_waste_cents + idle_waste_cents + duplicate_waste_cents)
        / NULLIF((SELECT SUM(recurring_cost_cents) FROM waste), 0), 2)      AS waste_rate_pct
FROM waste;

-- ===========================================================================
-- SECTION 7 — OPTIONAL scenarios (uncomment to exercise the other detectors)
-- ===========================================================================
--
-- (a) ZOMBIE SOFTWARE — silence every seat of one subscription so the entire
--     invoice is flagged as waste:
--
--     UPDATE seat_mappings sm
--        SET last_login_at = now() - INTERVAL '95 days', logins_last_30d = 0
--       FROM subscriptions s, companies c
--      WHERE sm.subscription_id = s.id AND s.company_id = c.id
--        AND c.domain = 'ridgepoint.io' AND s.vendor_name = 'Hotjar';
--
-- (b) OFFBOARDED HOLDER — a leaver whose licence is still paid for. The
--     schema requires terminated_at to be set when status = 'terminated':
--
--     UPDATE users SET status = 'terminated', terminated_at = now() - INTERVAL '45 days'
--      WHERE email = 'marcus.lindgren@ridgepoint.io';
--
-- (c) NEVER LOGGED IN — a provisioned seat with no activity at all:
--
--     UPDATE seat_mappings sm
--        SET last_login_at = NULL, logins_last_30d = 0
--       FROM subscriptions s, companies c
--      WHERE sm.subscription_id = s.id AND s.company_id = c.id
--        AND c.domain = 'ridgepoint.io' AND s.vendor_name = 'Figma';
--
-- ===========================================================================
-- SECTION 8 — DEMO COMMANDS
-- ===========================================================================
--
-- Resolve the tenant id once:
--   CO=$(psql "$DATABASE_URL" -tAc "SELECT id FROM companies WHERE domain='ridgepoint.io'")
--
-- 1. Ghost seats exactly as the API reports them:
--      curl -s "localhost:4000/api/analytics?companyId=$CO" \
--        | jq '{totalSpend: .totalSpend.monthlyDisplay,
--               totalWaste: .totalWaste.monthlyDisplay,
--               wasteRate: .totalWaste.wasteRatePct,
--               detectors: [.detectors[] | {id, hits, monthlyCents}]}'
--
-- 2. Contracts ranked by dead seats:
--      curl -s "localhost:4000/api/subscriptions?companyId=$CO&sort=staleSeats&order=desc"
--
-- 3. Reclaim the 3 Zoom ghost seats (transactional write-back + audit row):
--      curl -s -X POST "localhost:4000/api/subscriptions/<zoom_id>/optimize" \
--        -H 'Content-Type: application/json' \
--        -d '{"action":"reclaim_seats","seatsToReclaim":3,"performedBy":"cfo@ridgepoint.io"}'
--
-- 4. Consolidate the Monday.com duplicate into Asana:
--      curl -s -X POST "localhost:4000/api/subscriptions/<monday_id>/optimize" \
--        -H 'Content-Type: application/json' \
--        -d '{"action":"consolidate","consolidateIntoSubscriptionId":<asana_id>}'
--
-- 5. Pure-SQL check of the 60-day rule:
--      psql "$DATABASE_URL" -c "SELECT vendor_name, user_email, days_since_last_activity
--                               FROM v_ghost_seats ORDER BY days_since_last_activity DESC;"
-- ===========================================================================
