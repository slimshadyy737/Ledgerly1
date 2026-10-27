/**
 * Hand-rolled request validation helpers.
 *
 * Deliberately dependency-free: every helper either returns a normalised value
 * or throws HttpError.badRequest with field-level details, so handlers stay free
 * of `if (!x) return res.status(400)…` noise.
 */
"use strict";

const { HttpError } = require("./httpError");

/** Coerces to a trimmed string, or null when absent/empty. */
function optionalString(value, field, { maxLength = 500 } = {}) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") throw HttpError.badRequest(`"${field}" must be a string`);
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > maxLength) {
    throw HttpError.badRequest(`"${field}" must be at most ${maxLength} characters`);
  }
  return trimmed;
}

function requiredString(value, field, options = {}) {
  const parsed = optionalString(value, field, options);
  if (parsed === null) throw HttpError.badRequest(`"${field}" is required`);
  return parsed;
}

/** Parses an integer, optionally within [min, max]. */
function optionalInt(value, field, { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (value === undefined || value === null || value === "") return null;
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value), 10);
  if (!Number.isInteger(parsed)) throw HttpError.badRequest(`"${field}" must be an integer`);
  if (parsed < min || parsed > max) {
    throw HttpError.badRequest(`"${field}" must be between ${min} and ${max}`);
  }
  return parsed;
}

function requiredInt(value, field, options = {}) {
  const parsed = optionalInt(value, field, options);
  if (parsed === null) throw HttpError.badRequest(`"${field}" is required`);
  return parsed;
}

/** Parses an ISO-8601 date/time string into a Date (rejects unparseable input). */
function optionalDate(value, field) {
  if (value === undefined || value === null || value === "") return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw HttpError.badRequest(`"${field}" must be an ISO-8601 date string`);
  }
  return parsed;
}

/** Validates a value against an allow-list. */
function optionalEnum(value, field, allowed, { fallback = null } = {}) {
  if (value === undefined || value === null || value === "") return fallback;
  if (!allowed.includes(value)) {
    throw HttpError.badRequest(`"${field}" must be one of: ${allowed.join(", ")}`);
  }
  return value;
}

function requiredEnum(value, field, allowed) {
  const parsed = optionalEnum(value, field, allowed);
  if (parsed === null) throw HttpError.badRequest(`"${field}" is required`);
  return parsed;
}

/** Loose email check — good enough to catch typos, no RFC pedantry. */
function optionalEmail(value, field) {
  const parsed = optionalString(value, field, { maxLength: 320 });
  if (parsed === null) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(parsed)) {
    throw HttpError.badRequest(`"${field}" must be a valid email address`);
  }
  return parsed.toLowerCase();
}

/**
 * Parses ?page / ?pageSize into LIMIT/OFFSET.
 * @returns {{ page: number, pageSize: number, limit: number, offset: number }}
 */
function parsePagination(query, { defaultPageSize, maxPageSize }) {
  const page = optionalInt(query.page, "page", { min: 1 }) ?? 1;
  const pageSize = optionalInt(query.pageSize ?? query.limit, "pageSize", { min: 1, max: maxPageSize }) ?? defaultPageSize;
  return { page, pageSize, limit: pageSize, offset: (page - 1) * pageSize };
}

/**
 * Whitelists a sort parameter, returning a safe SQL fragment.
 * @param {{sort?: string, order?: string}} query
 * @param {Record<string, string>} allowed map of public sort key -> SQL expression
 * @param {string} defaultKey
 */
function parseSort(query, allowed, defaultKey) {
  const key = optionalString(query.sort, "sort") ?? defaultKey;
  if (!Object.prototype.hasOwnProperty.call(allowed, key)) {
    throw HttpError.badRequest(`"sort" must be one of: ${Object.keys(allowed).join(", ")}`);
  }
  const order = (optionalString(query.order, "order") ?? "desc").toLowerCase();
  if (!["asc", "desc"].includes(order)) {
    throw HttpError.badRequest('"order" must be "asc" or "desc"');
  }
  return { key, order, sql: `${allowed[key]} ${order.toUpperCase()}` };
}

module.exports = {
  optionalString,
  requiredString,
  optionalInt,
  requiredInt,
  optionalDate,
  optionalEnum,
  requiredEnum,
  optionalEmail,
  parsePagination,
  parseSort,
};
