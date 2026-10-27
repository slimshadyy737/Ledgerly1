#!/usr/bin/env node
/**
 * ===========================================================================
 *  server.js — Spend API entry point
 * ===========================================================================
 *  LedgerPulse Spend API: a REST service over PostgreSQL that answers
 *  "what are we paying for, who actually uses it, and where is the waste?"
 *
 *  Setup (see server/README.md for the full walkthrough)
 *  -------------------------------------------------------------------------
 *   1. Install dependencies (from the project root):
 *        npm install
 *   2. Configure environment variables — create `.env` at the project root
 *      (or `server/.env`, which takes precedence for API-only settings):
 *
 *        # required
 *        DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/app_db
 *
 *        # API (all optional, shown with defaults)
 *        API_PORT=4000              # API_PORT wins over PORT
 *        CORS_ORIGINS=http://localhost:3000   # comma list, or * for any origin
 *        DB_POOL_MAX=10
 *        DB_SSL=false
 *        STALE_LICENSE_DAYS=60      # ghost-seat rule
 *        ACTIVE_SEAT_DAYS=30        # zombie-software rule
 *        LOG_LEVEL=info             # error | warn | info | debug
 *
 *   3. Create the schema and load the demo company:
 *        node server/src/db/migrate.js
 *        node server/src/db/seed.js
 *   4. Run the API:
 *        node server/src/server.js            # http://localhost:4000
 *        # or, with auto-restart during development:
 *        npx nodemon server/src/server.js
 *
 *  Endpoints
 *  -------------------------------------------------------------------------
 *   GET  /api/health                          liveness + DB readiness
 *   GET  /api/companies                       tenants in the database
 *   GET  /api/subscriptions                   all contracts (filter/sort/page)
 *   GET  /api/subscriptions/:id               one contract + seats + history
 *   POST /api/subscriptions/:id/optimize      reclaim / cancel / consolidate
 *   GET  /api/analytics                       total spend + total waste breakdown
 *   GET  /api/analytics/optimizations         audit trail of applied actions
 * ===========================================================================
 */
"use strict";

const http = require("node:http");
const { env } = require("./config/env");
const { logger } = require("./utils/logger");
const { buildApp } = require("./app");
const { checkConnection, closePool } = require("./db/database");

/** Long-running sockets are not health-check traffic — stop them on shutdown. */
const SHUTDOWN_GRACE_MS = 10_000;

async function main() {
  const app = buildApp();
  const server = http.createServer(app);
  server.keepAliveTimeout = 61_000;
  server.headersTimeout = 65_000;

  // Fail fast if the database is unreachable at boot (better than a 500 later).
  const db = await checkConnection();
  logger.info("database connection verified", { database: db.database, serverTime: db.serverTime });

  if (env.corsWildcard && env.isProduction) {
    logger.warn("CORS_ORIGINS is not set — allowing every origin. Set it in production.");
  }

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(env.port, () => {
      server.off("error", reject);
      resolve();
    });
  });

  logger.info(`Spend API listening on http://localhost:${env.port}`, {
    environment: env.nodeEnv,
    cors: env.corsWildcard ? "*" : env.corsOrigins,
    poolMax: env.dbPoolMax,
    staleLicenseDays: env.staleLicenseDays,
    activeSeatDays: env.activeSeatDays,
  });

  /* ------------------------------ shutdown -------------------------------- */
  let shuttingDown = false;

  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`received ${signal} — shutting down gracefully`);

    const forceExit = setTimeout(() => {
      logger.error("graceful shutdown timed out — forcing exit");
      process.exit(1);
    }, SHUTDOWN_GRACE_MS);
    forceExit.unref();

    server.close(async (error) => {
      if (error) logger.error("error closing HTTP server", { error: error.message });
      try {
        await closePool();
      } catch (poolError) {
        logger.error("error closing database pool", { error: poolError.message });
      }
      clearTimeout(forceExit);
      logger.info("shutdown complete");
      process.exit(error ? 1 : 0);
    });
  }

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  // Never leave the process in an undefined state.
  process.on("unhandledRejection", (reason) => {
    logger.error("unhandled promise rejection", {
      error: reason instanceof Error ? reason.message : String(reason),
    });
  });
  process.on("uncaughtException", (error) => {
    logger.error("uncaught exception", { error: error.message, stack: error.stack });
    void shutdown("uncaughtException");
  });

  return server;
}

if (require.main === module) {
  main().catch(async (error) => {
    logger.error("failed to start Spend API", { error: error.message, stack: error.stack });
    await closePool().catch(() => {});
    process.exitCode = 1;
  });
}

module.exports = { main };
