/**
 * database.js — PostgreSQL connection pool (node-postgres `pg`).
 *
 * Exposes a tiny, explicit data-access toolkit so services never touch the pool
 * directly:
 *
 *   query(text, params)          run a single parameterised statement
 *   one(text, params)            first row or null
 *   many(text, params)           all rows
 *   withTransaction(fn)          BEGIN / COMMIT / ROLLBACK + pooled client
 *   checkConnection()            startup + /api/health probe
 *   closePool()                  graceful shutdown
 *
 * Parameterised queries only — no string concatenation of user input, anywhere.
 */
"use strict";

const { Pool, types } = require("pg");
const { env } = require("../config/env");
const { logger } = require("../utils/logger");

/**
 * Money aggregates come back as BIGINT (SUM of integer cents). node-postgres
 * returns int8/numeric as strings by default to protect precision; the API
 * contract is JSON numbers, and a company's monthly spend in cents is orders of
 * magnitude below Number.MAX_SAFE_INTEGER, so we parse them explicitly.
 */
types.setTypeParser(types.builtins.INT8, (value) => Number(value));
types.setTypeParser(types.builtins.NUMERIC, (value) => (value === null ? null : Number(value)));

const pool = new Pool({
  connectionString: env.databaseUrl,
  max: env.dbPoolMax,
  idleTimeoutMillis: env.dbIdleTimeoutMs,
  connectionTimeoutMillis: env.dbConnectionTimeoutMs,
  statement_timeout: env.dbStatementTimeoutMs,
  application_name: env.serviceName,
  ssl: env.dbSsl ? { rejectUnauthorized: false } : undefined,
});

// A background client error (network drop, DB restart) must never crash the API.
pool.on("error", (error) => {
  logger.error("idle PostgreSQL client error", { error: error.message });
});

pool.on("connect", () => {
  logger.debug("new PostgreSQL connection established");
});

/**
 * Runs a parameterised statement and logs anything slower than SLOW_QUERY_MS.
 * @param {string} text SQL with $1..$n placeholders
 * @param {unknown[]} [params]
 */
async function query(text, params = []) {
  const startedAt = process.hrtime.bigint();
  try {
    return await pool.query(text, params);
  } finally {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    if (durationMs >= env.slowQueryMs) {
      logger.warn("slow query", {
        durationMs: Math.round(durationMs),
        rows: text.length > 400 ? `${text.slice(0, 400)}…` : text.replace(/\s+/g, " ").trim(),
      });
    }
  }
}

/** @returns {Promise<object|null>} first row, or null when the result is empty */
async function one(text, params = []) {
  const result = await query(text, params);
  return result.rows[0] ?? null;
}

/** @returns {Promise<object[]>} every row */
async function many(text, params = []) {
  const result = await query(text, params);
  return result.rows;
}

/**
 * Executes `fn(client)` inside a single transaction on one pooled connection.
 * Rolls back on any thrown error, then releases the client back to the pool.
 * @template T
 * @param {(client: import('pg').PoolClient) => Promise<T>} fn
 * @returns {Promise<T>}
 */
async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      logger.error("transaction rollback failed", { error: rollbackError.message });
    }
    throw error;
  } finally {
    client.release();
  }
}

/** Lightweight connectivity probe used at boot and by GET /api/health. */
async function checkConnection() {
  const result = await query("SELECT now() AS server_time, current_database() AS database");
  return { serverTime: result.rows[0].server_time, database: result.rows[0].database };
}

/** Drains the pool. Called from the graceful-shutdown handler in server.js. */
async function closePool() {
  await pool.end();
  logger.info("PostgreSQL pool closed");
}

module.exports = { pool, query, one, many, withTransaction, checkConnection, closePool };
