/**
 * app.js — builds the Express application (middleware + routes).
 *
 * Configuration details (CORS, JSON body parsing, security headers, request
 * logging, error contract) live here so `server.js` stays a thin bootstrap that
 * starts this app on a port, wires process signals, and shuts it down cleanly.
 * The same app object is exported for supertest-style integration tests.
 */
"use strict";

const express = require("express");
const cors = require("cors");
const { env } = require("./config/env");
const { logger } = require("./utils/logger");
const { requestLogger, notFoundHandler, errorHandler } = require("./middleware");
const subscriptionsRouter = require("./routes/subscriptions.routes");
const analyticsRouter = require("./routes/analytics.routes");
const companiesRouter = require("./routes/companies.routes");
const { checkConnection } = require("./db/database");

function buildApp() {
  const app = express();

  /* --------------------------- platform settings -------------------------- */
  // Trust the reverse proxy in front of us so req.ip reflects the caller.
  app.set("trust proxy", true);
  app.disable("x-powered-by");
  app.set("json spaces", env.isProduction ? 0 : 2);

  /* ------------------------------- middleware ----------------------------- */
  // CORS: allow-list from CORS_ORIGINS, or "*" when unset (demo default).
  app.use(
    cors({
      origin: env.corsWildcard ? true : env.corsOrigins,
      methods: ["GET", "POST", "PATCH", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization", "X-Request-Id"],
      exposedHeaders: ["X-Request-Id"],
      credentials: !env.corsWildcard,
      maxAge: 86_400,
      optionsSuccessStatus: 204,
    }),
  );

  // JSON body parsing with a hard size cap (defensive: rejects huge payloads).
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: false, limit: "1mb" }));

  // Baseline security headers (no helmet dependency required).
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    next();
  });

  app.use(requestLogger);

  /* -------------------------------- routes -------------------------------- */
  /**
   * GET /api/health — liveness + database readiness.
   *  200 when the DB answers, 503 when it does not (so orchestrators can act).
   */
  app.get("/api/health", async (_req, res) => {
    const startedAt = process.hrtime.bigint();
    try {
      const db = await checkConnection();
      res.json({
        ok: true,
        service: env.serviceName,
        environment: env.nodeEnv,
        uptimeSeconds: Math.round(process.uptime()),
        db: { database: db.database, serverTime: db.serverTime },
        latencyMs: Math.round((Number(process.hrtime.bigint() - startedAt) / 1e6) * 10) / 10,
      });
    } catch (error) {
      logger.error("health check failed", { error: error.message });
      res.status(503).json({
        ok: false,
        service: env.serviceName,
        error: { code: "database_unavailable", message: error.message },
      });
    }
  });

  app.use("/api/subscriptions", subscriptionsRouter);
  app.use("/api/analytics", analyticsRouter);
  app.use("/api/companies", companiesRouter);

  // Machine-readable endpoint index — handy during a demo/viva.
  app.get("/", (_req, res) => {
    res.json({
      service: env.serviceName,
      version: "1.0.0",
      docs: {
        health: "GET /api/health",
        companies: "GET /api/companies",
        subscriptions: "GET /api/subscriptions?status=active&sort=monthlyCost&order=desc&page=1&pageSize=25",
        subscription: "GET /api/subscriptions/:id",
        optimize: "POST /api/subscriptions/:id/optimize",
        analytics: "GET /api/analytics?asOf=2026-01-01T00:00:00Z&staleDays=60&activeDays=30",
        optimizations: "GET /api/analytics/optimizations",
      },
    });
  });

  /* -------------------------- 404 + error handling ------------------------ */
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

module.exports = { buildApp };
