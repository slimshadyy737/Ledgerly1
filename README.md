# Ledgerly — B2B Subscription Optimizer & SaaS Spend Management

Ledgerly reconciles a company's **accounting data** with its **identity-provider login telemetry** to
expose unused licences, duplicate platforms and forgotten employee accounts — then releases the spend
with one approved action. It is a working full-stack prototype: React + Next.js on the front, Node +
PostgreSQL behind it, with a deterministic sandbox company instead of live financial integrations.

> **DEMO DATA.** Every number in the product comes from a seeded sandbox company. Actions write to the
> sandbox database only — no real vendor account, invoice or identity provider is contacted.

---

## 1. Product vision

Built for CFOs, finance teams, IT administrators and founders who want to eliminate wasted SaaS spend.
The interface aims for *financial precision, intelligent automation and calm enterprise software*:
a near-black **Midnight Ledger** palette, restrained emerald accents for savings, coral for live
financial leaks, dense but aligned data layouts, and an equally considered light theme.

Key screens: **Overview** (spend intelligence) · **Spend Analytics** · **Subscriptions** ·
**Optimization Center** · **Team & Seats** · **Vendors** · **Reports** · **Audit Log** · **Settings**.

---

## 2. Stack

| Layer | Technology |
| --- | --- |
| UI | React 19, Next.js 16 App Router, Tailwind CSS v4, Lucide icons, Recharts |
| Client state | React context providers (`ThemeProvider`, `ToastProvider`, `LedgerDataProvider`) |
| API | Next.js route handlers (TypeScript) — `/api/analytics`, `/api/subscriptions`, `/api/demo/reset`, … |
| Companion API | Standalone Express service in `server/` serving the identical REST contract |
| Database | PostgreSQL via `pg` with raw parameterised SQL (no ORM in the read path, typed via shared DTOs) |
| Seed | Deterministic generators: `server/src/db/seedData.js` + `server/src/db/seed_ghost_seat_demo.sql` |

---

## 3. Quick start

```bash
# 1 · dependencies
npm install

# 2 · environment (only DATABASE_URL is required)
echo "DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/app_db" > .env
# optional extras — see the table in §9
# echo "ALLOW_DEMO_RESET=true" >> .env

# 3 · create the spend tables (idempotent)
node server/src/db/migrate.js

# 4 · load the deterministic demo company (80 employees / 21 contracts / 590 seats)
node server/src/db/seed.js

# 5 · run the product
npm run dev        # http://localhost:3000        →  Ledgerly
# http://localhost:3000/workspace                  →  raw ingestion console
# http://localhost:4000                            →  optional Express API
#    node server/src/server.js
```

Checks:

```bash
npx next typegen                 # route types
npm exec tsc -- --noEmit         # strict type check
npm run build                    # production build
curl -s localhost:3000/api/health
```

---

## 4. Architecture

```
src/
├── app/
│   ├── layout.tsx                 ThemeProvider + ToastProvider + no-flash theme script
│   ├── (app)/layout.tsx           AppShell (sidebar, topbar, command palette) + data provider
│   ├── (app)/page.tsx             Overview                  /analytics   Spend Analytics
│   ├── (app)/subscriptions/…      Subscriptions             /optimization Optimization Center
│   ├── (app)/team/…               Team & Seats              /vendors      Vendors
│   ├── (app)/reports/…            Reports                   /audit        Audit Log
│   ├── (app)/settings/…           Settings
│   ├── workspace/…                raw ingestion console (statement / SSO / roster tabs)
│   └── api/                       analytics · subscriptions · subscriptions/[id] · optimize
│                                  analytics/optimizations · companies · demo/reset · health · dashboard
├── components/ledgerly/
│   ├── app-shell.tsx              Sidebar · Topbar · CommandPalette · notifications · workspace switcher
│   ├── data.tsx                   LedgerDataProvider — all fetching, derivation and write-backs
│   ├── ui.tsx                     Button, Card, StatusBadge, HealthScore, ConfirmDialog, Drawer, Modal,
│   │                              ToastProvider, EmptyState, Skeleton, Tooltip, inputs
│   ├── charts.tsx                 Recharts wrappers (trend, category, vendor contribution, donut)
│   ├── metric-card.tsx            KPI module with comparison, sparkline and explanation tooltip
│   ├── opportunity.tsx            OpportunityItem + shared confirm→write-back workflow
│   ├── inventory-table.tsx        DataTable: search, sort, filters, pagination, selection, bulk reclaim
│   ├── vendor-drawer.tsx          Vendor profile + live seat register
│   └── pages/                     one file per product page
└── lib/
    ├── ledgerly/derive.ts         ALL business logic: opportunities, inventory, metrics, team,
    │                              vendors, report, concentration (pure, unit-testable)
    ├── ledgerly/api.ts            typed API client (AbortController timeout, normalised errors)
    ├── ledgerly/theme.tsx         Light / Dark / System provider + chart palettes per theme
    ├── ledgerly/theme-script.ts   inline bootstrap applied before first paint
    └── spend/{types,sql,service}.ts   canonical REST contract, SQL and server services
```

**Separation of concerns.** Presentation components contain no business logic; `derive.ts` contains no
React; `api.ts` contains no SQL; the SQL lives in `src/lib/spend/sql.ts` (Next runtime) and
`server/src/repositories/*.js` (Express runtime).

### Data flow

```
corporate card statement ─┐
licence register ─────────┼─► subscriptions ⨝ seat_mappings ⨝ users ─► detector SQL
identity-provider logins ─┘                                              │
                                                                         ▼
                            /api/analytics  +  /api/subscriptions  +  /api/analytics/optimizations
                                                                         │
                                                         LedgerDataProvider (client, single source)
                                                                         │
                                     derive.ts ─► KPIs · opportunities · inventory · team · vendors · report
                                                                         │
                          approve action ─► POST /api/subscriptions/:id/optimize ─► re-fetch everything
```

---

## 5. Pages and what they do

| Page | Contents |
| --- | --- |
| **Overview** | Context strip (period, windows, integrity check) · 4 KPI modules (spend, potential savings, active subscriptions, seat utilization) with comparisons, sparklines and calculation tooltips · *Spend intelligence* chart (seat vs usage split, 6-statement average reference) · *Opportunities detected* feed · subscription inventory table · category breakdown, top vendors and recent activity |
| **Spend Analytics** | Category spend ranking, monthly expenditure trend, vendor contribution with waste overlay, concentration donut, category detail table, monthly movement list |
| **Subscriptions** | Status filters (active/paused/cancelled/consolidated), KPI strip incl. renewals inside 30 days, full register (15 rows/page), renewal calendar, lifecycle notes |
| **Optimization Center** | Detection-engine explainer (rule + plain English + attribution) · review queue with type/severity filters · per-finding evidence, savings maths and confidence · review / dismiss / act controls · dismissed bucket with restore |
| **Team & Seats** | 80-employee roster with department, employment status, tool count, stale assignments, attributed seat spend, last activity; search + department/status/inactivity filters; expandable per-tool login recency |
| **Vendors** | Vendor profile cards (contract facts, seat economics, health, findings, charge trend) + full drawer with live seat register; billing-model summary |
| **Reports** | Executive summary, savings attribution by detector, identified opportunities table, completed simulated actions, CSV / JSON / print export |
| **Audit Log** | Every simulated write-back with timestamp, action, vendor, seats, previous → resulting cost, saving, actor, and a “Simulated” status; filters, CSV export, reset control |
| **Settings** | Theme control, palette swatches, detection policy readout, sandbox data controls, keyboard shortcuts, data-integrity notes, known limitations |

---

## 6. Detection engine and savings accounting

| Detector | Rule | Savings attribution |
| --- | --- | --- |
| **Ghost seats** | `users.status = 'terminated'` **or** `seat_mappings.last_login_at` older than the tenant window (default 60 days) | Sum of the affected seats' monthly cost |
| **Former-employee licences** | Same evidence, split out as its own finding because employment status is definitive | Sum of leaver seats' monthly cost |
| **Zombie software** | No login for 30 days across every seat while the invoice keeps charging | **Entire** contract's recurring cost |
| **Overlap duplication** | `ROW_NUMBER() OVER (PARTITION BY category_group ORDER BY adoption DESC, cost DESC) > 1` | Remaining duplicate spend = cost − leakage already counted |
| **Idle capacity** | `seats_paid − count(active seat_mappings) > 0` | Idle seats × unit cost |
| **Renewal review** | Top-spend contract renewing inside 21 days | No savings attributed (advisory) |

Rules the code enforces, and which the UI surfaces:

1. **One dollar, one finding.** A zombie contract claims its whole invoice, so its dead seats are not
   offered again as reclaims. `assertSavingsIntegrity()` asserts that the sum of opportunity savings
   equals the engine's waste figure; the Overview header shows the check result. *(This check caught a
   real $91 double-count during development.)*
2. **Identified ≠ realized.** Modelled opportunity savings and measured post-action savings from the
   audit log are tracked and displayed separately.
3. **Missing data is not inactivity.** Seats with no login telemetry are labelled *“no login recorded”*
   and flagged **unverified**, lowering the finding's confidence instead of assuming 60+ days idle.
4. **Consistent reference time.** One `as_of` timestamp drives every window; the UI prints it.
5. **Reclaim safety.** The backend clamps a reclaim to seats that are already dead — an explicit request
   can never revoke an active user's licence unless `allowActiveSeats` is passed.

---

## 7. Interaction model

* **Reclaim seats / Cancel / Consolidate** → confirmation dialog (vendor, seats affected, monthly and
  annual saving, sandbox-only warning) → `POST /api/subscriptions/:id/optimize` inside a DB transaction
  (row lock → revoke seats → recalculate cost → insert `optimization_events`) → provider re-fetches →
  KPIs, opportunity feed, inventory, reports and audit log all recalculate → success toast.
* **Bulk reclaim** from the inventory table: select rows → one confirmation listing every contract →
  each contract updated individually so savings are never counted twice.
* **Dismiss / restore** hides a finding locally (localStorage) and explains that the detector still
  reports it server-side.
* **Command palette** (`⌘K` / `Ctrl K` / `/`) navigates pages and runs actions (re-sync, theme switch,
  reset sandbox) with arrow-key navigation and focus management.
* Also functional: sidebar collapse (`⌘B`, persisted), theme selection, workspace switcher,
  notification centre, date-range (statement window) selector, filters, sorting, pagination, CSV/JSON
  export, skeletons, empty and error states.

---

## 8. Theme system

* Three options — **Light**, **Dark**, **System** — with **dark as the default**.
* Persisted under `ledgerly.theme`; applied instantly without reload; `System` follows the OS live.
* A tiny inline script in `<head>` applies the resolved class before first paint, so there is **no flash
  of the wrong theme** (`suppressHydrationWarning` is set on `<html>` for that reason).
* Both themes are defined as token sets in `globals.css` (`:root` = dark, `.light` = light) and exposed
  to Tailwind through `@theme inline`, so every component — including charts, tables, modals, drawers,
  tooltips and dropdowns — repaints from the same variables. Chart colours come from a per-theme
  palette object rather than hard-coded hex values.

---

## 9. Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | *(required)* | PostgreSQL connection string for the spend schema |
| `ALLOW_DEMO_RESET` | `true` | Set to `false` to disable `POST /api/demo/reset` |
| `API_PORT` / `PORT` | `4000` | Port for the optional Express service in `server/` |
| `CORS_ORIGINS` | `*` | Allow-list for the Express service |
| `DB_POOL_MAX`, `DB_SSL`, `DB_STATEMENT_TIMEOUT_MS` | `10`, `false`, `10000` | Express pool tuning |
| `STALE_LICENSE_DAYS` / `ACTIVE_SEAT_DAYS` | `60` / `30` | Fallback detector windows (per-tenant values live in `companies`) |
| `LOG_LEVEL` | `info` | Express logger verbosity |

---

## 10. API surface

| Method & path | Purpose |
| --- | --- |
| `GET /api/analytics` | Spend + waste calculations, detectors, duplicate groups, stale-licence evidence, offenders, category spend, renewals |
| `GET /api/subscriptions` | Contract register with seat counts, utilization, health and waste (filter/sort/paginate) |
| `GET /api/subscriptions/:id` | One contract + live seat register + consolidation targets + optimization history |
| `POST /api/subscriptions/:id/optimize` | `reclaim_seats` · `cancel` · `consolidate` · `update_contract` — transactional, audited, returns recomputed metrics |
| `GET /api/analytics/optimizations` | Audit ledger of applied actions |
| `GET /api/companies` | Tenants available in the database |
| `POST /api/demo/reset` | Rebuilds the sandbox company from the seed script |
| `GET /api/health` | Database readiness probe |
| `GET /api/dashboard`, `POST /api/ingest`, `GET /api/sandbox/raw` | Raw ingestion ledgers used by `/workspace` |

The same contract is implemented twice over the same tables — Next.js route handlers and the Express
service in `server/` — so the UI can be pointed at either without code changes.

---

## 11. Verification performed

| Check | Result |
| --- | --- |
| `npx next typegen` · `tsc --noEmit` · `npm run build` | pass (23 routes) |
| All nine product pages + `/workspace` | HTTP 200 |
| Derived business logic run against the live API (the exact `derive.ts` module) | **11/11 invariants pass**, including `identified savings == engine waste`, inventory waste sum, bucket sum, no zombie/ghost double count, sorted-by-impact, rule + maths present on every finding |
| Seat reclamation | spend $23,509.82 → $23,299.82 · waste $5,339.79 → $5,129.79 · ghost seats 104 → 90 · utilization 72% → 74% · audit entry #1 written with actor |
| Sandbox reset | `POST /api/demo/reset` reloads 80 employees / 21 contracts / 590 seats and clears the audit log |
| Both themes in compiled CSS | `#4be3a4` (dark brand), `#12795c` (light brand), `.light` scope, reduced-motion block present |
| Accessibility details | focus-visible rings, `aria-*` on dialogs/drawers/progress bars/badges, tab traps + focus return in overlays, Escape handling, status never conveyed by colour alone |

---

## 12. Known limitations

1. **Sandbox only.** No Plaid/Stripe/Okta/Slack integration and no API keys; the company is generated
   deterministically and stored locally.
2. **Dismissals are client-side** (localStorage per browser). The backend detector still reports the
   finding — intentional for a demo, documented in the UI.
3. **Statement history is six periods.** Month-over-month comparison exists for spend; seat-count and
   subscription-count deltas are deliberately shown as “no prior period available” rather than invented.
4. **Usage-billed contracts** (cloud, observability) carry no seat telemetry, so waste cannot be
   attributed to individuals for those vendors.
5. **`/api/demo/reset`** runs the local seed script, so it needs Node and the seed file next to the app;
   in a real deployment this would be a queued job.
6. **The raw ingestion console** (`/workspace`) always describes the primary demo tenant, because the
   ingestion ledgers are seeded for that company.
