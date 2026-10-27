/**
 * analytics.routes.js
 *
 *   GET /api/analytics                      spend + waste summary (default "now")
 *   GET /api/analytics/optimizations        audit trail of applied optimizations
 *
 * Query parameters (all optional):
 *   companyId       target tenant
 *   asOf            ISO timestamp used as "now" for the activity windows
 *   staleDays       override the 60-day stale-licence rule
 *   activeDays      override the 30-day active-seat rule
 *   limit           detail rows per section (default 25, max 200)
 */
"use strict";

const express = require("express");
const analyticsService = require("../services/analyticsService");
const subscriptionRepository = require("../repositories/subscriptionRepository");
const { resolveCompany } = require("../services/companyService");
const { asyncHandler } = require("../middleware");
const { env } = require("../config/env");
const { optionalInt, optionalDate } = require("../utils/validate");

const router = express.Router();

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const result = await analyticsService.getAnalytics({
      companyId: optionalInt(req.query.companyId, "companyId", { min: 1 }),
      asOf: optionalDate(req.query.asOf, "asOf") ?? new Date(),
      staleDays: optionalInt(req.query.staleDays, "staleDays", { min: 1, max: 3_650 }),
      activeDays: optionalInt(req.query.activeDays, "activeDays", { min: 1, max: 3_650 }),
      limitPerSection: optionalInt(req.query.limit, "limit", { min: 1, max: env.maxPageSize }) ?? 25,
    });
    res.json(result);
  }),
);

router.get(
  "/optimizations",
  asyncHandler(async (req, res) => {
    const company = await resolveCompany(optionalInt(req.query.companyId, "companyId", { min: 1 }));
    const events = await subscriptionRepository.listOptimizationEvents({
      companyId: company.id,
      subscriptionId: optionalInt(req.query.subscriptionId, "subscriptionId", { min: 1 }),
      limit: optionalInt(req.query.limit, "limit", { min: 1, max: env.maxPageSize }) ?? 50,
    });

    const totals = events.reduce(
      (acc, event) => ({
        seatsReclaimed: acc.seatsReclaimed + event.seats_reclaimed,
        monthlySavingsCents: acc.monthlySavingsCents + Number(event.savings_cents),
      }),
      { seatsReclaimed: 0, monthlySavingsCents: 0 },
    );

    res.json({
      ok: true,
      company: { id: company.id, name: company.name },
      count: events.length,
      totals: { ...totals, annualizedSavingsCents: totals.monthlySavingsCents * 12 },
      data: events,
    });
  }),
);

module.exports = router;
