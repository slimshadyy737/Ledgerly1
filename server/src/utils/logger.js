/**
 * Minimal structured logger (JSON in production, human-readable in dev).
 * Kept dependency-free so the API has as few moving parts as possible.
 */
"use strict";

const { env } = require("../config/env");

const LEVELS = { error: 50, warn: 40, info: 30, debug: 20 };
const activeLevel = LEVELS[process.env.LOG_LEVEL] ?? (env.isProduction ? LEVELS.info : LEVELS.debug);

function emit(level, message, context = {}) {
  if (LEVELS[level] < activeLevel) return;
  const payload = { level, time: new Date().toISOString(), service: env.serviceName, message, ...context };
  const line = env.isProduction ? JSON.stringify(payload) : formatPretty(payload);
  const stream = level === "error" || level === "warn" ? process.stderr : process.stdout;
  stream.write(`${line}\n`);
}

function formatPretty(payload) {
  const { level, time, service, message, ...rest } = payload;
  const extra = Object.keys(rest).length ? ` ${JSON.stringify(rest)}` : "";
  return `${time} [${level.toUpperCase().padEnd(5)}] ${service}: ${message}${extra}`;
}

const logger = {
  error: (message, context) => emit("error", message, context),
  warn: (message, context) => emit("warn", message, context),
  info: (message, context) => emit("info", message, context),
  debug: (message, context) => emit("debug", message, context),
  child(bindings) {
    return {
      error: (message, context = {}) => emit("error", message, { ...bindings, ...context }),
      warn: (message, context = {}) => emit("warn", message, { ...bindings, ...context }),
      info: (message, context = {}) => emit("info", message, { ...bindings, ...context }),
      debug: (message, context = {}) => emit("debug", message, { ...bindings, ...context }),
    };
  },
};

module.exports = { logger };
