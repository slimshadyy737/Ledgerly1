/**
 * Environment configuration + fail-fast validation.
 *
 * Loads `.env` from the repository root and (optionally) `server/.env`, then
 * validates everything the API needs at boot so a misconfiguration surfaces as a
 * clear startup error instead of a 500 later on.
 *
 * Copy `.env.example` and adjust:
 *   DATABASE_URL=postgresql://user:password@127.0.0.1:5432/app_db
 *   API_PORT=4000
 *   CORS_ORIGINS=http://localhost:3000     # or * for a demo
 */
"use strict";

const path = require("node:path");
const dotenv = require("dotenv");

// Root .env first, then server/.env (dotenv never overwrites already-set keys).
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const DEFAULTS = Object.freeze({
  PORT: 4000,
  DB_POOL_MAX: 10,
  DB_IDLE_TIMEOUT_MS: 30_000,
  DB_CONNECTION_TIMEOUT_MS: 5_000,
  DB_STATEMENT_TIMEOUT_MS: 10_000,
  STALE_LICENSE_DAYS: 60,
  ACTIVE_SEAT_DAYS: 30,
  DEFAULT_PAGE_SIZE: 25,
  MAX_PAGE_SIZE: 200,
});

function readInt(name, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new Error(`Invalid ${name}="${raw}" — expected an integer between ${min} and ${max}`);
  }
  return parsed;
}

function readBool(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  return ["1", "true", "yes", "on"].includes(raw.toLowerCase());
}

function parseCorsOrigins() {
  const raw = process.env.CORS_ORIGINS;
  // Unconfigured => permissive so the bundled demo front-ends just work.
  // A production deployment MUST set CORS_ORIGINS to the real allow-list.
  if (!raw || raw.trim() === "" || raw.trim() === "*") {
    return { origins: "*", isWildcard: true };
  }
  const origins = raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return { origins, isWildcard: false };
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL is required. Add it to .env at the project root, e.g.\n" +
      "  DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/app_db",
  );
}

const cors = parseCorsOrigins();

const env = Object.freeze({
  nodeEnv: process.env.NODE_ENV || "development",
  isProduction: (process.env.NODE_ENV || "development") === "production",
  serviceName: process.env.SERVICE_NAME || "ledgerpulse-spend-api",
  // API_PORT wins over PORT so the API can never accidentally steal the web app's port.
  port: readInt("API_PORT", readInt("PORT", DEFAULTS.PORT, { min: 1, max: 65535 }), {
    min: 1,
    max: 65535,
  }),
  databaseUrl,
  dbSsl: readBool("DB_SSL", false),
  dbPoolMax: readInt("DB_POOL_MAX", DEFAULTS.DB_POOL_MAX, { min: 1, max: 100 }),
  dbIdleTimeoutMs: readInt("DB_IDLE_TIMEOUT_MS", DEFAULTS.DB_IDLE_TIMEOUT_MS, { min: 1_000 }),
  dbConnectionTimeoutMs: readInt("DB_CONNECTION_TIMEOUT_MS", DEFAULTS.DB_CONNECTION_TIMEOUT_MS, {
    min: 500,
  }),
  dbStatementTimeoutMs: readInt("DB_STATEMENT_TIMEOUT_MS", DEFAULTS.DB_STATEMENT_TIMEOUT_MS, {
    min: 1_000,
  }),
  slowQueryMs: readInt("SLOW_QUERY_MS", 250, { min: 1 }),
  corsOrigins: cors.origins,
  corsWildcard: cors.isWildcard,
  staleLicenseDays: readInt("STALE_LICENSE_DAYS", DEFAULTS.STALE_LICENSE_DAYS, { min: 1, max: 3_650 }),
  activeSeatDays: readInt("ACTIVE_SEAT_DAYS", DEFAULTS.ACTIVE_SEAT_DAYS, { min: 1, max: 3_650 }),
  defaultPageSize: readInt("DEFAULT_PAGE_SIZE", DEFAULTS.DEFAULT_PAGE_SIZE, { min: 1, max: 500 }),
  maxPageSize: readInt("MAX_PAGE_SIZE", DEFAULTS.MAX_PAGE_SIZE, { min: 1, max: 1_000 }),
});

module.exports = { env, DEFAULTS };
