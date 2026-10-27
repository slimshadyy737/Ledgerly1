#!/usr/bin/env node
/**
 * seedDemoCompany.js — runs seed_ghost_seat_demo.sql through the shared pool.
 *
 *   node server/src/db/seedDemoCompany.js
 *
 * Equivalent to:
 *   psql "$DATABASE_URL" -f server/src/db/seed_ghost_seat_demo.sql
 *
 * The .sql file is plain, portable SQL (no psql meta-commands), so this wrapper
 * simply reads it, executes it as one multi-statement batch, and prints the
 * verification result sets the script ends with. Handy when psql is not
 * installed on the machine running the demo.
 */
"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { pool } = require("./database");
const { logger } = require("../utils/logger");

const SQL_PATH = path.join(__dirname, "seed_ghost_seat_demo.sql");

async function main() {
  const sql = await fs.readFile(SQL_PATH, "utf8");
  const client = await pool.connect();
  try {
    logger.info("running ghost-seat demo seed", { file: path.basename(SQL_PATH) });
    const result = await client.query(sql); // pg returns an array for multi-statement batches

    const results = Array.isArray(result) ? result : [result];
    results
      .filter((entry) => Array.isArray(entry.rows) && entry.rows.length > 0)
      .forEach((entry, index) => {
        const label = ["tenant snapshot", "inactive users", "ghost seats", "inventory", "waste summary"][index] ?? `result ${index}`;
        process.stdout.write(`\n── ${label.toUpperCase()} ──\n`);
        console.table(entry.rows);
      });

    const summary = results.flatMap((entry) => entry.rows ?? []).find((row) => row.total_monthly_waste_usd !== undefined);
    if (summary) {
      logger.info("ghost-seat demo ready", {
        company: "Ridgepoint Software",
        monthlySpendUsd: Number(summary.total_monthly_spend_usd),
        monthlyWasteUsd: Number(summary.total_monthly_waste_usd),
        wasteRatePct: Number(summary.waste_rate_pct),
      });
    }
  } finally {
    client.release();
  }
}

if (require.main === module) {
  main()
    .then(() => pool.end())
    .catch(async (error) => {
      logger.error("ghost-seat demo seed failed", { error: error.message });
      await pool.end().catch(() => {});
      process.exitCode = 1;
    });
}

module.exports = { main };
