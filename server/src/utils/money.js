/**
 * Money helpers. Every amount that crosses a boundary in this API is an integer
 * number of cents; only the JSON `*Display` fields are pre-formatted strings.
 */
"use strict";

const USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const USD_WHOLE = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

/** @param {number} cents */
function toUsd(cents) {
  return USD.format((Number(cents) || 0) / 100);
}

/** @param {number} cents */
function toUsdWhole(cents) {
  return USD_WHOLE.format((Number(cents) || 0) / 100);
}

/** Rounds a percentage to `digits` decimals, guarding against NaN. */
function toPercent(value, digits = 1) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Number(numeric.toFixed(digits));
}

/** Safely converts an integer-cents column (INT8/BIGINT arrives as number). */
function cents(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : 0;
}

module.exports = { toUsd, toUsdWhole, toPercent, cents };
