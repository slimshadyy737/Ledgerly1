# LedgerPulse Spend API — Node.js + Express + PostgreSQL

A clean, layered REST API that answers three questions for a B2B SaaS customer:

1. **What software are we paying for?** → `GET /api/subscriptions`
2. **Where is that money being wasted?** → `GET /api/analytics`
3. **Can I fix it right now?** → `POST /api/subscriptions/:id/optimize`

No external integrations: the demo company is generated locally (4 source files
described below) so every number is explainable in a viva.

---

## 1. Project layout

```
server/
├── .env.example                # every supported environment variable
├── README.md
└── src/
    ├── server.js               # entry point: bootstrap, listen, graceful shutdown
    ├── app.js                  # Express app: CORS, JSON parsing, routes, errors
    ├── config/env.js           # .env loading + fail-fast validation
    ├── db/
    │   ├── database.js         # pg Pool + query/one/many/withTransaction helpers
    │   ├── schema.sql          # DDL: companies, users, subscriptions, seat_mappings
    │   ├── migrate.js          # applies schema.sql (node src/db/migrate.js)
    │   ├── seedData.js         # the simulated source systems (80 staff, 21 vendors)
    │   ├── seed.js             # loads them into PostgreSQL in one transaction
    │   ├── seed_ghost_seat_demo.sql  # pure-SQL seed: 15 users / 6 vendors / 10 ghost seats
    │   └── seedDemoCompany.js        # runs the .sql above without needing psql
    ├── middleware/index.js     # asyncHandler, request logger, 404, error contract
    ├── repositories/           # ALL SQL lives here
    │   ├── analyticsRepository.js
    │   └── subscriptionRepository.js
    ├── services/               # business rules, no SQL, no req/res
    │   ├── analyticsService.js
    │   ├── companyService.js
    │   └── subscriptionService.js
    ├── routes/                 # HTTP layer only (parse → service → JSON)
    │   ├── subscriptions.routes.js
    │   ├── analytics.routes.js
    │   └── companies.routes.js
    └── utils/                  # logger, money, httpError, validate
```

**Layering rule:** routes never build SQL, repositories never build responses.

---

## 2. Run it locally

```bash
# 1. dependencies (from the repository root)
npm install

# 2. environment variables
cp server/.env.example .env        # or edit the existing .env
#    DATABASE_URL is the only required value:
#    DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/app_db

# 3. create the tables (idempotent; add --drop for a clean slate)
node server/src/db/migrate.js

# 4. load the demo company (80 users, 21 contracts, 590 seat grants)
node server/src/db/seed.js

# 5. start the API
node server/src/server.js          # http://localhost:4000
#    development auto-reload:
npx nodemon server/src/server.js
```

Verify:

```bash
curl -s localhost:4000/api/health
curl -s "localhost:4000/api/analytics" | head -40
curl -s "localhost:4000/api/subscriptions?pageSize=5&sort=health&order=asc"
curl -s -X POST localhost:4000/api/subscriptions/2/optimize \
     -H 'Content-Type: application/json' \
     -d '{"action":"reclaim_seats","seatsToReclaim":14}'
```

> The API port defaults to **4000** (`API_PORT`, falling back to `PORT`) so it can
> run side by side with the Next.js dashboard on 3000.

---

## 3. Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | *(required)* | PostgreSQL connection string |
| `API_PORT` / `PORT` | `4000` | listen port (`API_PORT` wins) |
| `CORS_ORIGINS` | `*` | comma-separated allow-list; set it in production |
| `DB_POOL_MAX` | `10` | pool size |
| `DB_IDLE_TIMEOUT_MS` | `30000` | close idle clients after |
| `DB_CONNECTION_TIMEOUT_MS` | `5000` | fail fast when the DB is down |
| `DB_STATEMENT_TIMEOUT_MS` | `10000` | per-statement timeout (prevents runaway queries) |
| `DB_SSL` | `false` | enable TLS for managed databases |
| `STALE_LICENSE_DAYS` | `60` | ghost-seat rule |
| `ACTIVE_SEAT_DAYS` | `30` | zombie-software rule |
| `DEFAULT_PAGE_SIZE` / `MAX_PAGE_SIZE` | `25` / `200` | pagination guard-rails |
| `SLOW_QUERY_MS` | `250` | log queries slower than this |
| `LOG_LEVEL` | `info` (`debug` in dev) | logger verbosity |

The `.env` file is read from the project root first, then `server/.env`
(API-only overrides). Missing `DATABASE_URL` stops the process with a readable
error instead of failing on the first request.

---

## 4. Data model (`src/db/schema.sql`)

| Table | Rows | Meaning |
| --- | --- | --- |
| `companies` | 1 | tenant + detector thresholds (`stale_license_days`, `active_seat_days`) |
| `users` | 80 | HRIS roster. `status = 'terminated'` marks leavers (8 of them) |
| `subscriptions` | 21 | contracts: vendor, category (+ normalised `category_group`), seats, unit cost, recurring cost, renewal date, owner |
| `seat_mappings` | 590 | the licence register: one row per user↔subscription with `last_login_at`, `logins_last_30d` |
| `optimization_events` | – | audit trail written by the optimize endpoint |

Plus the read model **`v_subscription_activity`**: one row per contract with
assigned / healthy / stale / idle seats, adoption %, `is_zombie` and a 0–100
`health_score`. All money is stored in **integer cents**; BIGINT aggregates are
parsed to JS numbers in `database.js`.

**Why `seat_mappings` is the bridge:** finance data (`subscriptions`) and identity
data (`users.last_login_at` from the SSO export) only meet inside that table. Every
waste query is a join across all three.

---

> **Same contract, two runtimes.** The Next.js app ships route handlers at the
> identical paths (`/api/analytics`, `/api/subscriptions`,
> `/api/subscriptions/:id/optimize`, `/api/analytics/optimizations`,
> `/api/companies`) implemented over the same tables (`src/lib/spend/*`). The React
> dashboard consumes that contract, so it can be pointed at this Express service
> instead without a single frontend change. This document and
> `src/lib/spend/types.ts` are the normative definition.

## 5. Endpoints

### `GET /api/health`
Liveness + database readiness. `200` when the DB answers, `503` otherwise.

### `GET /api/companies` · `GET /api/companies/:id/summary`
Tenants in the database, and the headline KPIs for one of them.

### `GET /api/subscriptions`
Paged contract list with seat utilisation, health score and waste per contract.

| Query param | Example | Notes |
| --- | --- | --- |
| `status` | `active` | `active` \| `paused` \| `cancelled` \| `consolidated` |
| `categoryGroup` | `Project Management` | normalised bucket |
| `search` | `hubspot` | vendor / product / category, case-insensitive |
| `minMonthlyCents` / `minMonthlyUsd` | `10000` / `100` | minimum recurring cost |
| `wastefulOnly` | `true` | only contracts with stale or idle seats |
| `sort` + `order` | `sort=health&order=asc` | `vendor, category, monthlyCost, seatsPaid, activeSeats, staleSeats, idleSeats, adoption, health, waste, renewal, updatedAt` |
| `page` + `pageSize` | `page=2&pageSize=25` | max 200 per page |

Response: `{ ok, company, pagination, sort, filters, count, data: [...] }`.
`sort` is whitelisted against a fixed map — user input never reaches the SQL text.

### `GET /api/subscriptions/:id`
One contract + its full seat register (`seatMappings[]` with `daysSinceLogin` and
`isStale`) + `consolidationTargets[]` + `optimizationHistory[]`. A subscription id
is globally unique, so `?companyId=` is optional here; when supplied it is enforced
(tenant isolation is never bypassed).

### `GET /api/analytics` — the analytics engine

Query params: `companyId`, `asOf` (ISO timestamp used as "now"), `staleDays`,
`activeDays`, `limit`.

```jsonc
{
  "totalSpend": {                      // (a) SUM of all active subscription costs
    "monthlyCents": 2350982, "monthlyDisplay": "$23,509.82",
    "annualizedCents": 28211784, "annualizedDisplay": "$282,118",
    "activeSubscriptions": 21, "seatsPaid": 451, "activeSeats": 253,
    "seatUtilisationPct": 56
  },
  "totalWaste": {                      // (b) duplicate categories + licences idle > 60 days
    "monthlyCents": 533979, "monthlyDisplay": "$5,339.79",
    "annualizedDisplay": "$64,077", "wasteRatePct": 22.7,
    "breakdown": [
      { "key": "stale_licenses",      "monthlyCents": 176793, "seats": 104, "detector": "STALE_LICENSE" },
      { "key": "duplicate_categories","monthlyCents": 248192, "seats": 9,   "detector": "DUPLICATE_CATEGORY" },
      { "key": "idle_seats",          "monthlyCents": 26494,  "seats": 18,  "detector": "IDLE_SEAT" },
      { "key": "zombie_subscriptions","monthlyCents": 82500,  "seats": 3,   "detector": "ZOMBIE_SOFTWARE" }
    ]
  },
  "detectors": [ /* every rule + threshold + its monthly $, so numbers stay auditable */ ],
  "duplicateCategories": [ /* category groups with >1 vendor, incumbent + candidates */ ],
  "staleLicences":       [ /* seat-by-seat evidence: who, which vendor, days since login */ ],
  "topWasteOffenders":   [ /* per-contract waste with a source split */ ],
  "categorySpend":       [ /* spend per normalised category */ ],
  "upcomingRenewals":    [ /* renewals inside 45 days */ ]
}
```

**How the two required calculations are done in SQL** (`analyticsRepository.js`,
one CTE chain: `bounds → seat_rollup → active_subs → ranked → lines → final`):

- **Total spend** — `SUM(recurring_cost_cents)` over `status = 'active'`.
- **Total waste** — each dollar is counted **once per month**:
  - *stale licences*: `seat_mappings.status = 'active' AND (users.status = 'terminated' OR last_login_at < as_of - 60 days OR last_login_at IS NULL)` → `SUM(seat_cost_cents)`;
  - *duplicate categories*: `ROW_NUMBER() OVER (PARTITION BY category_group ORDER BY adoption DESC, cost DESC) > 1` identifies non-incumbent tools; their bill counts as waste **minus leakage already counted on the same invoice**;
  - *idle seats*: `seats_paid - COUNT(active seat_mappings) > 0` × unit cost;
  - *zombie software*: a per-seat contract with zero seats active in 30 days → the **entire** recurring cost, and its stale/idle/duplicate components are then excluded so nothing is double-counted.

### `POST /api/subscriptions/:id/optimize`
Transactional write-back: `SELECT … FOR UPDATE` → mutate seats/status →
recalculate the recurring cost → insert an `optimization_events` audit row →
return the updated contract **plus a recomputed analytics summary** (one round trip).

| `action` | Body fields | Effect |
| --- | --- | --- |
| `reclaim_seats` | `seatsToReclaim` (optional → all dead seats), `allowActiveSeats`, `reason` | revokes the worst seats first (leavers, then longest-silent), `seats_paid -= n`, `recurring = seats_paid × unit_cost` |
| `cancel` | `reason` | revokes every seat, `status = 'cancelled'`, recurring cost → 0 |
| `consolidate` | `consolidateIntoSubscriptionId` (optional → best sibling by adoption) | revokes seats, `status = 'consolidated'`, records the migration target |
| `update_contract` | `status` (`active`/`paused`), `seatsPaid`, `unitCostCents`, `nextRenewalAt`, `contractOwnerEmail`, `notes` | edits terms; recalculates the monthly charge when licence maths change |

Optional on every action: `performedBy` (email, stored in the audit row),
`expectedUpdatedAt` (optimistic concurrency → `409` if someone else changed the
row) and `companyId` (only needed to *assert* a tenant for a multi-tenant client —
the subscription id already implies its owner).

Safety rules: reclaiming only ever touches seats that are already dead unless
`allowActiveSeats: true` is explicitly passed; `seatsToReclaim` is clamped to the
dead-seat population and the clamp is reported in the message and the audit payload.

Example:

```bash
curl -s -X POST localhost:4000/api/subscriptions/2/optimize \
  -H 'Content-Type: application/json' \
  -d '{"action":"reclaim_seats","seatsToReclaim":14,"performedBy":"cfo@northwind.io"}'
```

```jsonc
{
  "ok": true,
  "message": "reclaim_seats on Zoom: Revoked 14 seat grant(s); licence count 72 -> 58. Monthly recurring cost $1,080.00 -> $870.00 ($210/month, $2,520/year recovered).",
  "data": {
    "subscription": { "seatsPaid": 58, "monthlyCostCents": 87000, "healthScore": 67, "seats": { "stale": 0 } },
    "seatsReclaimed": 14,
    "revokedSeats": [ { "seatMappingId": 96, "userId": 8, "seatCostCents": 1500 } ],
    "savings": { "monthlyCents": 21000, "monthlyDisplay": "$210.00", "annualizedDisplay": "$2,520" },
    "auditEventId": 1,
    "analytics": { "totalSpend": {}, "totalWaste": {} }
  }
}
```

### `GET /api/analytics/optimizations`
Audit trail (actor, action, seats reclaimed, before/after cost, savings) with
company-wide totals.

---

## 6. Error contract

Every failure returns the same shape, with the request id echoed in the header
`X-Request-Id`, and PostgreSQL errors mapped to meaningful statuses
(`23505 → 409`, `23503 → 409`, `23514/22P02 → 400`, `40001 → 409`, `57014 → 503`):

```json
{
  "ok": false,
  "error": { "code": "unprocessable_entity", "message": "AWS is billed as \"usage\" — there are no seats to reclaim." },
  "requestId": "8d034683-ce75-4c2c-bfed-fee59fba0b8f",
  "timestamp": "2026-01-15T10:22:31.004Z"
}
```

Unhandled errors never leak internals: details and stack traces stay in the server
log, the client gets a generic `500`.

---

## 7. Ghost-seat demo seed — `src/db/seed_ghost_seat_demo.sql`

A self-contained SQL seed that builds a **second, deliberately wasteful tenant** so
the detectors can be demonstrated on a small, human-readable dataset. It replaces
only its own tenant (matched by `domain = 'ridgepoint.io'`), so the 21-vendor
Northwind dataset stays intact.

```bash
psql "$DATABASE_URL" -f server/src/db/seed_ghost_seat_demo.sql
# or, without the psql CLI:
node server/src/db/seedDemoCompany.js
```

### What it loads

| Objects | Values |
| --- | --- |
| Company | **Ridgepoint Software** (`ridgepoint.io`), 15 staff, 60-day ghost threshold |
| Users | **15 corporate users** — 12 active, 3 *completely inactive* for **96 / 84 / 71 days** (Marcus Lindgren, Grace Sullivan, Fatima Zahra) |
| Subscriptions | **6** — Zoom (14 seats), Slack (15), Asana (12), Monday.com (6), Figma (5), Hotjar (7) = 59 paid seats, $753.13/month |
| `seat_mappings` | **57 provisioned seats**, each with an explicit `assigned_at`, `last_login_at` and `logins_last_30d` |
| Views | `v_seat_last_activity`, `v_ghost_seats` (created `OR REPLACE`, so re-running is safe) |

Every timestamp is written as `now() - INTERVAL 'n days'`, so the "inactive for
70+ days" property keeps holding whenever the file is re-run — hard-coded dates
would silently expire and the demo would stop flagging ghost seats.

### Expected detector output (verified against `GET /api/analytics`)

```
total spend  $753.13/mo            waste $235.21/mo (31.23%)   annualised waste $2,822.52
├─ stale_licenses       $124.23  10 ghost seats (Zoom 3, Slack 3, Asana 2, Hotjar 2)
├─ duplicate_categories $ 84.00  Monday.com flagged as duplicate of Asana (same category group)
└─ idle_seats           $ 26.98  Asana invoiced for 12 seats, only 10 provisioned
   zombie_subscriptions $  0.00  not triggered: every vendor keeps 3+ active seats
```

### `last_login_at` vs `last_activity_at`

The schema's canonical column is **`seat_mappings.last_login_at`** (the SSO/IdP
export field), and that is what the seed writes. For teams whose mental model —
or earlier notes — call it `last_activity_at`, the view `v_seat_last_activity`
exposes the exact same value under that alias, so both spellings work:

```sql
SELECT vendor_name, user_email, last_activity_at, days_since_last_activity
  FROM v_seat_last_activity
 WHERE last_activity_at < now() - INTERVAL '60 days'
 ORDER BY days_since_last_activity DESC;

SELECT * FROM v_ghost_seats ORDER BY days_since_last_activity DESC;  -- the full detector report
```

### Verify it end to end

```bash
CO=$(psql "$DATABASE_URL" -tAc "SELECT id FROM companies WHERE domain='ridgepoint.io'")

curl -s "localhost:4000/api/analytics?companyId=$CO" \
  | jq '{spend: .totalSpend.monthlyDisplay, waste: .totalWaste.monthlyDisplay,
         detectors: [.detectors[] | {id, hits}]}'
# → spend "$753.13", waste "$235.21", STALE_LICENSE 10, DUPLICATE_CATEGORY 1, IDLE_SEAT 2, ZOMBIE_SOFTWARE 0

curl -s "localhost:4000/api/subscriptions?companyId=$CO&sort=staleSeats&order=desc"
# → Zoom 3 stale · Slack 3 stale · Asana 2 stale + 2 idle · Hotjar 2 stale
```

The file ends with five verification queries (tenant snapshot, the three inactive
users, the ghost-seat report, the inventory, and the waste summary that mirrors the
analytics endpoint) plus an optional "uncomment to trigger the other detectors"
section for zombie software, an offboarded holder and a never-logged-in seat.

---

## 8. Production notes

- **Pooling** — one shared `pg.Pool`, `statement_timeout` enforced server-side,
  slow queries logged; the pool is drained on `SIGTERM`/`SIGINT` with a 10s grace
  period (load balancers stop sending traffic first).
- **Boot validation** — the process refuses to start if `DATABASE_URL` is missing
  or the database is unreachable, so a bad deploy fails immediately.
- **Injection safety** — parameterised queries only; sorting/pagination/enums are
  whitelisted in `utils/validate.js`.
- **Concurrency** — row locks for the write path + optional `expectedUpdatedAt`
  optimistic checks; every mutation is audited in `optimization_events`.
- **Idempotent DDL/seed** — `migrate.js` and `seed.js` can be re-run any time;
  `seed.js --append` upserts instead of truncating.
