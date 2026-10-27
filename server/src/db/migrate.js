#!/usr/bin/env node
/**
 * migrate.js — applies db/schema.sql to the configured database.
 *
 *   node server/src/db/migrate.js             # apply schema (idempotent)
 *   node server/src/db/migrate.js --drop      # DROP everything first (dev only)
 *
 * The whole file runs inside one transaction: either every DDL statement lands
 * or none of them do.
 */
"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { pool, withTransaction } = require("./database");
const { env } = require("../config/env");
const { logger } = require("../utils/logger");

const SCHEMA_PATH = path.join(__dirname, "schema.sql");
const DROP_ORDER = [
  "optimization_events",
  "seat_mappings",
  "subscriptions",
  "users",
  "companies",
];

async function migrate({ drop = false } = {}) {
  const sql = await fs.readFile(SCHEMA_PATH, "utf8");

  await withTransaction(async (client) => {
    if (drop) {
      logger.warn("--drop supplied: removing existing LedgerPulse tables");
      // CASCADE also removes the dependent view.
      await client.query(`DROP VIEW IF EXISTS v_subscription_activity`);
      for (const table of DROP_ORDER) {
        await client.query(`DROP TABLE IF EXISTS ${table} CASCADE`);
      }
    }
    await client.query(sql);
  });

  const { rows } = await pool.query(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('companies','users','subscriptions','seat_mappings','optimization_events')
      ORDER BY table_name`,
  );
  const view = await pool.query(
    `SELECT 1 FROM information_schema.views
      WHERE table_schema = 'public' AND table_name = 'v_subscription_activity'`,
  );

  logger.info("schema applied", {
    database: new URL(env.databaseUrl).pathname.replace(/^\//, ""),
    tables: rows.map((row) => row.table_name),
    view: view.rowCount === 1 ? "v_subscription_activity" : "missing",
  });
}

if (require.main === module) {
  const drop = process.argv.includes("--drop");
  migrate({ drop })
    .then(() => pool.end())
    .catch(async (error) => {
      logger.error("migration failed", { error: error.message });
      await pool.end().catch(() => {});
      process.exitCode = 1;
    });
}

module.exports = { migrate };
