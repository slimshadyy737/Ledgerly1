#!/usr/bin/env node
/**
 * seed.js — loads the simulated company into PostgreSQL (the "ingestion job").
 *
 *   node server/src/db/seed.js          # truncate + reload the demo company
 *   node server/src/db/seed.js --append # keep existing rows (idempotent upsert)
 *
 * Everything happens inside one transaction, in dependency order:
 *   companies -> users -> subscriptions -> seat_mappings
 * The seat rows are the bridge between finance (subscriptions) and identity
 * (users.last_login_at), which is exactly what the analytics queries join on.
 */
"use strict";

const { pool, withTransaction } = require("./database");
const { buildSeedDataset } = require("./seedData");
const { HttpError } = require("../utils/httpError");
const { logger } = require("../utils/logger");

/** @param {{ truncate?: boolean, now?: Date }} [options] */
async function seed({ truncate = true, now = new Date() } = {}) {
  const dataset = buildSeedDataset(now);

  const summary = await withTransaction(async (client) => {
    if (truncate) {
      await client.query(
        "TRUNCATE optimization_events, seat_mappings, subscriptions, users, companies RESTART IDENTITY CASCADE",
      );
    }

    /* ---------------------------- 1. company ---------------------------- */
    const company = await client.query(
      `INSERT INTO companies (name, domain, headcount, currency, stale_license_days, active_seat_days)
       VALUES ($1, $2, $3, 'USD', $4, $5)
       ON CONFLICT (domain) DO UPDATE
         SET name = EXCLUDED.name,
             headcount = EXCLUDED.headcount,
             stale_license_days = EXCLUDED.stale_license_days,
             active_seat_days = EXCLUDED.active_seat_days
       RETURNING id`,
      [
        dataset.company.name,
        dataset.company.domain,
        dataset.users.length,
        dataset.company.staleLicenseDays,
        dataset.company.activeSeatDays,
      ],
    );
    const companyId = company.rows[0].id;

    /* ----------------------------- 2. users ----------------------------- */
    const userResult = await client.query(
      `INSERT INTO users (company_id, full_name, email, department, job_title, status, hired_at, terminated_at)
       SELECT $1, u.full_name, u.email, u.department, u.job_title, u.status, u.hired_at, u.terminated_at
         FROM jsonb_to_recordset($2::jsonb) AS u(
           full_name TEXT, email TEXT, department TEXT, job_title TEXT,
           status TEXT, hired_at TIMESTAMPTZ, terminated_at TIMESTAMPTZ
         )
       RETURNING id, email`,
      [
        companyId,
        JSON.stringify(
          dataset.users.map((user) => ({
            full_name: user.fullName,
            email: user.email,
            department: user.department,
            job_title: user.jobTitle,
            status: user.status,
            hired_at: user.hiredAt.toISOString(),
            terminated_at: user.terminatedAt ? user.terminatedAt.toISOString() : null,
          })),
        ),
      ],
    );
    const userIdByEmail = new Map(userResult.rows.map((row) => [row.email, row.id]));

    /* ------------------------- 3. subscriptions ------------------------- */
    const subscriptionResult = await client.query(
      `INSERT INTO subscriptions (
         company_id, vendor_name, product_name, category, category_group, billing_model,
         seats_paid, unit_cost_cents, recurring_cost_cents, status, contract_owner_email,
         next_renewal_at, started_at, notes
       )
       SELECT $1, s.vendor_name, s.product_name, s.category, s.category_group, s.billing_model,
              s.seats_paid, s.unit_cost_cents, s.recurring_cost_cents, s.status, s.contract_owner_email,
              s.next_renewal_at, s.started_at, s.notes
         FROM jsonb_to_recordset($2::jsonb) AS s(
           vendor_name TEXT, product_name TEXT, category TEXT, category_group TEXT, billing_model TEXT,
           seats_paid INT, unit_cost_cents INT, recurring_cost_cents INT, status TEXT,
           contract_owner_email TEXT, next_renewal_at TIMESTAMPTZ, started_at TIMESTAMPTZ, notes TEXT
         )
       ON CONFLICT (company_id, vendor_name) DO UPDATE
         SET product_name = EXCLUDED.product_name,
             category = EXCLUDED.category,
             category_group = EXCLUDED.category_group,
             billing_model = EXCLUDED.billing_model,
             seats_paid = EXCLUDED.seats_paid,
             unit_cost_cents = EXCLUDED.unit_cost_cents,
             recurring_cost_cents = EXCLUDED.recurring_cost_cents,
             status = EXCLUDED.status,
             contract_owner_email = EXCLUDED.contract_owner_email,
             next_renewal_at = EXCLUDED.next_renewal_at,
             notes = EXCLUDED.notes
       RETURNING id, vendor_name`,
      [
        companyId,
        JSON.stringify(
          dataset.subscriptions.map((subscription) => ({
            vendor_name: subscription.vendorName,
            product_name: subscription.productName,
            category: subscription.category,
            category_group: subscription.categoryGroup,
            billing_model: subscription.billingModel,
            seats_paid: subscription.seatsPaid,
            unit_cost_cents: subscription.unitCostCents,
            recurring_cost_cents: subscription.recurringCostCents,
            status: subscription.status,
            contract_owner_email: subscription.contractOwnerEmail,
            next_renewal_at: subscription.nextRenewalAt.toISOString(),
            started_at: subscription.startedAt.toISOString(),
            notes: subscription.notes,
          })),
        ),
      ],
    );
    const subscriptionIdByVendor = new Map(
      subscriptionResult.rows.map((row) => [row.vendor_name, row.id]),
    );

    /* -------------------------- 4. seat_mappings ------------------------ */
    const seatRows = dataset.seats.map((seat) => {
      const subscriptionId = subscriptionIdByVendor.get(seat.vendorName);
      const userId = userIdByEmail.get(seat.userEmail);
      if (!subscriptionId || !userId) {
        throw new HttpError(500, `Seed integrity error: unresolved seat for ${seat.vendorName}/${seat.userEmail}`);
      }
      return {
        subscription_id: subscriptionId,
        user_id: userId,
        seat_cost_cents: seat.seatCostCents,
        status: "active",
        assigned_at: seat.assignedAt.toISOString(),
        last_login_at: seat.lastLoginAt.toISOString(),
        logins_last_30d: seat.loginsLast30d,
      };
    });

    await client.query(
      `INSERT INTO seat_mappings (
         subscription_id, user_id, seat_cost_cents, status, assigned_at, last_login_at, logins_last_30d
       )
       SELECT m.subscription_id, m.user_id, m.seat_cost_cents, m.status, m.assigned_at, m.last_login_at, m.logins_last_30d
         FROM jsonb_to_recordset($1::jsonb) AS m(
           subscription_id INT, user_id INT, seat_cost_cents INT, status TEXT,
           assigned_at TIMESTAMPTZ, last_login_at TIMESTAMPTZ, logins_last_30d INT
         )
       ON CONFLICT (subscription_id, user_id) DO UPDATE
         SET seat_cost_cents = EXCLUDED.seat_cost_cents,
             status = EXCLUDED.status,
             last_login_at = EXCLUDED.last_login_at,
             logins_last_30d = EXCLUDED.logins_last_30d`,
      [JSON.stringify(seatRows)],
    );

    return {
      companyId,
      users: dataset.users.length,
      terminatedUsers: dataset.users.filter((user) => user.status === "terminated").length,
      subscriptions: dataset.subscriptions.length,
      seatMappings: seatRows.length,
      monthlyRecurringCents: dataset.subscriptions.reduce((sum, s) => sum + s.recurringCostCents, 0),
    };
  });

  logger.info("sandbox seed complete", {
    company: dataset.company.name,
    ...summary,
    monthlyRecurringUsd: `$${(summary.monthlyRecurringCents / 100).toFixed(2)}`,
  });

  return summary;
}

if (require.main === module) {
  const append = process.argv.includes("--append");
  seed({ truncate: !append })
    .then(() => pool.end())
    .catch(async (error) => {
      logger.error("seed failed", { error: error.message });
      await pool.end().catch(() => {});
      process.exitCode = 1;
    });
}

module.exports = { seed };
