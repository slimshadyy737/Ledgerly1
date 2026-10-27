-- ===========================================================================
--  LedgerPulse Spend API — PostgreSQL schema
--  ---------------------------------------------------------------------------
--  Apply with:   node server/src/db/migrate.js
--  The script is fully idempotent (IF NOT EXISTS / CREATE OR REPLACE), so it is
--  safe to run against an existing database as many times as you like.
--
--  Money is stored as INTEGER CENTS everywhere (never floating point) which is
--  the same convention Stripe / Plaid style ledgers use. Aggregations promote
--  to BIGINT and are converted to JS numbers by the driver (see database.js).
--
--  Tables:
--    companies              tenant / the buying organisation
--    users                  employees (HRIS roster), incl. terminated leavers
--    subscriptions          software contracts (what the company pays for)
--    seat_mappings          licence grants: user <-> subscription + login data
--    optimization_events    audit trail written by the optimize endpoint
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 0. Helpers
-- ---------------------------------------------------------------------------

-- Keeps updated_at honest without relying on application code.
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- 1. companies
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS companies (
  id           SERIAL PRIMARY KEY,
  name         TEXT        NOT NULL,
  domain       TEXT        NOT NULL,
  headcount    INTEGER     NOT NULL DEFAULT 0 CHECK (headcount >= 0),
  currency     CHAR(3)     NOT NULL DEFAULT 'USD',
  -- Detector thresholds are per-tenant so each company can tune its own policy.
  stale_license_days INTEGER NOT NULL DEFAULT 60 CHECK (stale_license_days > 0),
  active_seat_days   INTEGER NOT NULL DEFAULT 30 CHECK (active_seat_days   > 0),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT companies_domain_key UNIQUE (domain)
);

DROP TRIGGER IF EXISTS trg_companies_updated_at ON companies;
CREATE TRIGGER trg_companies_updated_at
  BEFORE UPDATE ON companies
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. users  (HRIS roster: "who works here")
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  company_id    INTEGER     NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  full_name     TEXT        NOT NULL,
  email         TEXT        NOT NULL,
  department    TEXT        NOT NULL,
  job_title     TEXT,
  -- 'terminated' is what turns a paid licence into a ghost seat.
  status        TEXT        NOT NULL DEFAULT 'active'
                            CHECK (status IN ('active', 'terminated')),
  hired_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  terminated_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT users_company_email_key UNIQUE (company_id, email),
  CONSTRAINT users_terminated_at_chk
    CHECK ((status = 'terminated' AND terminated_at IS NOT NULL)
        OR (status = 'active'     AND terminated_at IS NULL))
);

CREATE INDEX IF NOT EXISTS users_company_status_idx ON users (company_id, status);
CREATE INDEX IF NOT EXISTS users_department_idx     ON users (company_id, department);

DROP TRIGGER IF EXISTS trg_users_updated_at ON users;
CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- 3. subscriptions  (software contracts on the corporate card)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS subscriptions (
  id                   SERIAL PRIMARY KEY,
  company_id           INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  vendor_name          TEXT    NOT NULL,
  product_name         TEXT,
  -- Display category shown to finance, e.g. "Project Management".
  category             TEXT    NOT NULL,
  -- Normalised bucket used by the duplicate-category detector. Several display
  -- categories can share one bucket (e.g. Dropbox + Google Workspace).
  category_group       TEXT    NOT NULL,
  billing_model        TEXT    NOT NULL
                               CHECK (billing_model IN ('per_seat', 'flat', 'usage')),
  seats_paid           INTEGER NOT NULL DEFAULT 0 CHECK (seats_paid >= 0),
  unit_cost_cents      INTEGER NOT NULL DEFAULT 0 CHECK (unit_cost_cents >= 0),
  -- Current recurring monthly charge in cents. Derived from
  -- seats_paid * unit_cost_cents for per_seat vendors, overridden for flat/usage.
  recurring_cost_cents INTEGER NOT NULL DEFAULT 0 CHECK (recurring_cost_cents >= 0),
  currency             CHAR(3) NOT NULL DEFAULT 'USD',
  status               TEXT    NOT NULL DEFAULT 'active'
                               CHECK (status IN ('active', 'paused', 'cancelled', 'consolidated')),
  contract_owner_email TEXT,
  next_renewal_at      TIMESTAMPTZ,
  started_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  cancelled_at         TIMESTAMPTZ,
  cancellation_reason  TEXT,
  notes                TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT subscriptions_company_vendor_key UNIQUE (company_id, vendor_name)
);

CREATE INDEX IF NOT EXISTS subscriptions_company_status_idx ON subscriptions (company_id, status);
CREATE INDEX IF NOT EXISTS subscriptions_category_idx       ON subscriptions (company_id, category_group);
CREATE INDEX IF NOT EXISTS subscriptions_renewal_idx        ON subscriptions (company_id, next_renewal_at);

DROP TRIGGER IF EXISTS trg_subscriptions_updated_at ON subscriptions;
CREATE TRIGGER trg_subscriptions_updated_at
  BEFORE UPDATE ON subscriptions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- 4. seat_mappings  (licence register + SSO login telemetry per seat)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS seat_mappings (
  id               SERIAL PRIMARY KEY,
  subscription_id  INTEGER NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  user_id          INTEGER NOT NULL REFERENCES users(id)         ON DELETE CASCADE,
  seat_cost_cents  INTEGER NOT NULL DEFAULT 0 CHECK (seat_cost_cents >= 0),
  status           TEXT    NOT NULL DEFAULT 'active'
                           CHECK (status IN ('active', 'revoked')),
  assigned_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at       TIMESTAMPTZ,
  revoked_reason   TEXT,
  -- Activity telemetry copied from the IdP (Google Workspace / Okta export).
  last_login_at    TIMESTAMPTZ,
  logins_last_30d  INTEGER NOT NULL DEFAULT 0 CHECK (logins_last_30d >= 0),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT seat_mappings_subscription_user_key UNIQUE (subscription_id, user_id),
  CONSTRAINT seat_mappings_revoked_chk
    CHECK ((status = 'revoked' AND revoked_at IS NOT NULL)
        OR (status = 'active'  AND revoked_at IS NULL))
);

CREATE INDEX IF NOT EXISTS seat_mappings_subscription_idx
  ON seat_mappings (subscription_id, status);
CREATE INDEX IF NOT EXISTS seat_mappings_user_idx
  ON seat_mappings (user_id);
-- Partial index: the analytics + list endpoints always filter on active seats.
CREATE INDEX IF NOT EXISTS seat_mappings_stale_idx
  ON seat_mappings (last_login_at) WHERE status = 'active';

DROP TRIGGER IF EXISTS trg_seat_mappings_updated_at ON seat_mappings;
CREATE TRIGGER trg_seat_mappings_updated_at
  BEFORE UPDATE ON seat_mappings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- 5. optimization_events  (audit trail for POST /api/subscriptions/:id/optimize)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS optimization_events (
  id                 SERIAL PRIMARY KEY,
  company_id         INTEGER NOT NULL REFERENCES companies(id)     ON DELETE CASCADE,
  subscription_id    INTEGER NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  action             TEXT    NOT NULL,
  seats_reclaimed    INTEGER NOT NULL DEFAULT 0,
  previous_cost_cents INTEGER NOT NULL DEFAULT 0,
  new_cost_cents     INTEGER NOT NULL DEFAULT 0,
  savings_cents      INTEGER NOT NULL DEFAULT 0,
  payload            JSONB   NOT NULL DEFAULT '{}'::jsonb,
  performed_by       TEXT    NOT NULL DEFAULT 'system',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS optimization_events_subscription_idx
  ON optimization_events (subscription_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- 6. Read model: v_subscription_activity
--    One row per subscription with seat utilisation, staleness and a 0-100
--    optimisation health score. Window defaults mirror companies.*_days and
--    are what GET /api/subscriptions reads; /api/analytics recomputes the same
--    logic parameterised by an as-of timestamp (see analyticsRepository.js).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_subscription_activity AS
WITH seat_rollup AS (
  SELECT
    sm.subscription_id,
    COUNT(*) FILTER (WHERE sm.status = 'active') AS assigned_seats,
    COUNT(*) FILTER (
      WHERE sm.status = 'active'
        AND u.status <> 'terminated'
        AND sm.last_login_at IS NOT NULL
        AND sm.last_login_at >= now() - INTERVAL '30 days'
    ) AS healthy_seats,
    COUNT(*) FILTER (
      WHERE sm.status = 'active'
        AND (
          u.status = 'terminated'
          OR sm.last_login_at IS NULL
          OR sm.last_login_at < now() - INTERVAL '60 days'
        )
    ) AS stale_seats,
    COALESCE(SUM(sm.seat_cost_cents) FILTER (
      WHERE sm.status = 'active'
        AND (
          u.status = 'terminated'
          OR sm.last_login_at IS NULL
          OR sm.last_login_at < now() - INTERVAL '60 days'
        )
    ), 0) AS stale_seat_cost_cents,
    ROUND(AVG(
      EXTRACT(EPOCH FROM (now() - COALESCE(sm.last_login_at, sm.assigned_at))) / 86400.0
    ) FILTER (WHERE sm.status = 'active'))::int AS avg_days_since_login
  FROM seat_mappings sm
  JOIN users u ON u.id = sm.user_id
  GROUP BY sm.subscription_id
),
base AS (
  SELECT
    s.id AS subscription_id,
    s.company_id,
    s.vendor_name,
    s.product_name,
    s.category,
    s.category_group,
    s.billing_model,
    s.seats_paid,
    s.unit_cost_cents,
    s.recurring_cost_cents,
    s.currency,
    s.status,
    s.contract_owner_email,
    s.next_renewal_at,
    s.started_at,
    s.cancelled_at,
    s.notes,
    s.created_at,
    s.updated_at,
    COALESCE(r.assigned_seats, 0)      AS assigned_seats,
    COALESCE(r.healthy_seats, 0)       AS healthy_seats,
    COALESCE(r.stale_seats, 0)         AS stale_seats,
    COALESCE(r.stale_seat_cost_cents, 0) AS stale_seat_cost_cents,
    COALESCE(r.avg_days_since_login, 0) AS avg_days_since_login,
    GREATEST(s.seats_paid - COALESCE(r.assigned_seats, 0), 0) AS idle_seats,
    COUNT(*) OVER (PARTITION BY s.company_id, s.category_group) AS category_vendors
  FROM subscriptions s
  LEFT JOIN seat_rollup r ON r.subscription_id = s.id
)
SELECT
  b.*,
  CASE
    WHEN b.billing_model = 'per_seat' AND b.seats_paid > 0
      THEN ROUND(100.0 * b.healthy_seats / b.seats_paid, 1)
    ELSE NULL
  END AS adoption_pct,
  (b.billing_model = 'per_seat'
    AND b.seats_paid > 0
    AND b.assigned_seats > 0
    AND b.healthy_seats = 0) AS is_zombie,
  GREATEST(0, LEAST(100, ROUND(
    COALESCE(
      100.0 * b.healthy_seats / NULLIF(b.seats_paid, 0),
      CASE WHEN b.billing_model = 'flat' THEN 88 ELSE 92 END
    )
    - CASE WHEN b.category_vendors > 1 THEN 10 ELSE 0 END
    - CASE
        WHEN b.stale_seats > 0
          THEN 25.0 * b.stale_seats / NULLIF(b.seats_paid, 0)
        ELSE 0
      END
  )))::int AS health_score
FROM base b;
