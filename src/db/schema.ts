/**
 * ---------------------------------------------------------------------------
 * LedgerPulse — SaaS Spend Management
 * Database schema (PostgreSQL via Drizzle ORM)
 * ---------------------------------------------------------------------------
 * The schema mirrors a real spend-intelligence data pipeline:
 *
 *   1. employees            <- HRIS export (Workday/BambooHR style roster)
 *   2. vendors              <- Contract / license register (what we PAY for)
 *   3. seatAssignments      <- License register: WHICH employee holds a seat
 *   4. ssoEvents            <- Google Workspace SSO export (who actually LOGS IN)
 *   5. transactions         <- Corporate card / accounting statement (the $)
 *   6. optimizationActions  <- Write-back log (reclaims, cancellations, merges)
 *   7. ingestRuns           <- Observability for the sandbox ingestion engine
 *
 * All money is stored as INTEGER CENTS to avoid floating point drift — the same
 * convention used by Stripe/Plaid style ledgers.
 */
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

export const employees = pgTable("employees", {
  id: serial("id").primaryKey(),
  fullName: text("full_name").notNull(),
  email: text("email").notNull().unique(),
  department: text("department").notNull(),
  jobTitle: text("job_title").notNull(),
  /** active | offboarded  (offboarded = left the company, seat may still be billed) */
  status: text("status").notNull().default("active"),
  hiredAt: timestamp("hired_at", { withTimezone: true }).notNull(),
  offboardedAt: timestamp("offboarded_at", { withTimezone: true }),
  managerEmail: text("manager_email"),
});

export const vendors = pgTable(
  "vendors",
  {
    id: serial("id").primaryKey(),
    vendorKey: text("vendor_key").notNull().unique(),
    name: text("name").notNull(),
    category: text("category").notNull(),
    /** normalised bucket used to detect overlapping/duplicate tooling */
    categoryGroup: text("category_group").notNull(),
    /** per_seat | flat | usage */
    billingModel: text("billing_model").notNull(),
    seatUnitCostCents: integer("seat_unit_cost_cents").notNull().default(0),
    seatsPaid: integer("seats_paid").notNull().default(0),
    /** paid-for seats that were never provisioned to a human */
    idleSeats: integer("idle_seats").notNull().default(0),
    flatMonthlyCents: integer("flat_monthly_cents").notNull().default(0),
    /** denormalised current monthly cost so the dashboard read path is a single join */
    monthlyCostCents: integer("monthly_cost_cents").notNull().default(0),
    contractOwner: text("contract_owner").notNull(),
    renewalDate: timestamp("renewal_date", { withTimezone: true }).notNull(),
    /** active | cancelled | consolidated */
    status: text("status").notNull().default("active"),
    statusReason: text("status_reason"),
    logoEmoji: text("logo_emoji").notNull().default("🧩"),
    notes: text("notes"),
  },
  (table) => [index("vendors_status_idx").on(table.status)],
);

export const seatAssignments = pgTable(
  "seat_assignments",
  {
    id: serial("id").primaryKey(),
    vendorId: integer("vendor_id").notNull(),
    employeeId: integer("employee_id").notNull(),
    seatCostCents: integer("seat_cost_cents").notNull().default(0),
    /** active | revoked */
    status: text("status").notNull().default("active"),
    assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull(),
    /** denormalised last activity, as exported by some vendor admin consoles */
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    loginsLast30d: integer("logins_last_30d").notNull().default(0),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedReason: text("revoked_reason"),
  },
  (table) => [
    index("seat_vendor_idx").on(table.vendorId),
    index("seat_employee_idx").on(table.employeeId),
  ],
);

export const ssoEvents = pgTable(
  "sso_events",
  {
    id: serial("id").primaryKey(),
    /** app name exactly as reported by the IdP (may not match a paid vendor!) */
    appName: text("app_name").notNull(),
    employeeId: integer("employee_id").notNull(),
    employeeEmail: text("employee_email").notNull(),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    loginsLast30d: integer("logins_last_30d").notNull().default(0),
    totalLogins90d: integer("total_logins_90d").notNull().default(0),
    samlApp: boolean("saml_app").notNull().default(true),
  },
  (table) => [
    index("sso_app_idx").on(table.appName),
    index("sso_employee_idx").on(table.employeeId),
  ],
);

export const transactions = pgTable(
  "transactions",
  {
    id: serial("id").primaryKey(),
    statementPeriod: text("statement_period").notNull(), // 2026-03
    postedAt: timestamp("posted_at", { withTimezone: true }).notNull(),
    /** raw merchant string straight off the card statement */
    merchantDescriptor: text("merchant_descriptor").notNull(),
    vendorId: integer("vendor_id"),
    vendorKey: text("vendor_key"),
    category: text("category").notNull().default("Uncategorised"),
    amountCents: integer("amount_cents").notNull(),
    cardLast4: text("card_last4").notNull(),
    cardholderEmail: text("cardholder_email").notNull(),
    isRecurring: boolean("is_recurring").notNull().default(true),
    /** 0-100 fuzzy-match score between descriptor and vendor register */
    matchConfidence: integer("match_confidence").notNull().default(100),
    anomaly: text("anomaly"),
  },
  (table) => [index("tx_period_idx").on(table.statementPeriod)],
);

export const optimizationActions = pgTable("optimization_actions", {
  id: serial("id").primaryKey(),
  vendorId: integer("vendor_id"),
  vendorName: text("vendor_name").notNull(),
  /** reclaim_seats | cancel_subscription | consolidate */
  actionType: text("action_type").notNull(),
  title: text("title").notNull(),
  detail: text("detail").notNull(),
  seatsAffected: integer("seats_affected").notNull().default(0),
  monthlySavingsCents: integer("monthly_savings_cents").notNull().default(0),
  status: text("status").notNull().default("applied"),
  triggeredBy: text("triggered_by").notNull().default("cfo@northwind.io"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  payload: jsonb("payload"),
});

export const ingestRuns = pgTable("ingest_runs", {
  id: serial("id").primaryKey(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  sourceNote: text("source_note").notNull().default("sandbox-engine"),
  employeesIngested: integer("employees_ingested").notNull().default(0),
  vendorsIngested: integer("vendors_ingested").notNull().default(0),
  seatsIngested: integer("seats_ingested").notNull().default(0),
  ssoEventsIngested: integer("sso_events_ingested").notNull().default(0),
  transactionsIngested: integer("transactions_ingested").notNull().default(0),
  durationMs: integer("duration_ms").notNull().default(0),
  status: text("status").notNull().default("succeeded"),
});
