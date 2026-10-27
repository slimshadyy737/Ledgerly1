/**
 * Request/response plumbing middleware: async wrapping, access logging, 404 and
 * the single centralised error handler.
 *
 * Express 5 forwards rejected promises to the error handler automatically; the
 * `asyncHandler` wrapper is kept for explicit intent (and so the handlers stay
 * portable if the app is ever mounted on Express 4).
 */
"use strict";

const { randomUUID } = require("node:crypto");
const { HttpError } = require("../utils/httpError");
const { logger } = require("../utils/logger");
const { env } = require("../config/env");

/** Wraps an async route handler so rejections reach next(error). */
function asyncHandler(handler) {
  return function wrapped(req, res, next) {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

/** Attaches a request id, logs one line per completed request. */
function requestLogger(req, res, next) {
  const requestId = req.headers["x-request-id"] || randomUUID();
  req.id = requestId;
  res.setHeader("X-Request-Id", requestId);
  const startedAt = process.hrtime.bigint();

  res.on("finish", () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    const level = res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info";
    logger[level](`${req.method} ${req.originalUrl} ${res.statusCode}`, {
      requestId,
      durationMs: Math.round(durationMs * 10) / 10,
      ip: req.ip,
    });
  });

  next();
}

/** Terminal middleware for unmatched routes. */
function notFoundHandler(req, _res, next) {
  next(HttpError.notFound(`No route matches ${req.method} ${req.originalUrl}`));
}

/** PostgreSQL error codes we translate into meaningful HTTP responses. */
const PG_ERROR_MAP = {
  "23505": { status: 409, code: "unique_violation", message: "Resource already exists" },
  "23503": { status: 409, code: "foreign_key_violation", message: "Referenced resource does not exist" },
  "23502": { status: 400, code: "not_null_violation", message: "A required column was null" },
  "23514": { status: 400, code: "check_violation", message: "A value violated a database constraint" },
  "22P02": { status: 400, code: "invalid_text_representation", message: "Malformed value in request" },
  "40001": { status: 409, code: "serialization_failure", message: "Concurrent update conflict, please retry" },
  "57014": { status: 503, code: "query_cancelled", message: "Query exceeded the statement timeout" },
};

/**
 * Central error handler — the ONLY place that shapes error responses.
 * Express identifies it by its four-argument signature.
 */
function errorHandler(error, req, res, _next) {
  const mapped = PG_ERROR_MAP[error.code];
  const status = error.status || (mapped ? mapped.status : 500);
  const body = {
    ok: false,
    error: {
      code: error.code && !mapped ? error.code : (mapped?.code ?? "internal_error"),
      message:
        status >= 500 && !error.expose
          ? "Internal server error"
          : (error.message || mapped?.message || "Internal server error"),
      ...(error.details ? { details: error.details } : {}),
    },
    requestId: req.id,
    timestamp: new Date().toISOString(),
  };

  const logContext = { requestId: req.id, status, route: `${req.method} ${req.originalUrl}` };
  if (status >= 500) {
    logger.error("unhandled request error", { ...logContext, error: error.message, stack: error.stack });
  } else {
    logger.warn("request rejected", { ...logContext, error: body.error.message });
  }

  // Never leak internals outside the contract.
  if (status >= 500 && env.isProduction) body.error.details = undefined;
  res.status(status).json(body);
}

module.exports = { asyncHandler, requestLogger, notFoundHandler, errorHandler };
