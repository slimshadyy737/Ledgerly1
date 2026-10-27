/**
 * companies.routes.js
 *
 *   GET /api/companies                      tenants available in the database
 *   GET /api/companies/:id/summary          headline KPIs for one tenant
 *
 * Multi-tenant ready: every other endpoint accepts ?companyId= to scope queries.
 */
"use strict";

const express = require("express");
const companyService = require("../services/companyService");
const analyticsService = require("../services/analyticsService");
const { asyncHandler } = require("../middleware");
const { HttpError } = require("../utils/httpError");

const router = express.Router();

router.get(
  "/",
  asyncHandler(async (_req, res) => {
    const companies = await companyService.listCompanies();
    res.json({ ok: true, count: companies.length, data: companies });
  }),
);

router.get(
  "/:id/summary",
  asyncHandler(async (req, res) => {
    const companyId = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(companyId) || companyId < 1) {
      throw HttpError.badRequest(`"id" must be a positive integer (received "${req.params.id}")`);
    }
    const analytics = await analyticsService.getAnalytics({ companyId });
    res.json({
      ok: true,
      data: {
        company: analytics.company,
        windows: analytics.windows,
        totalSpend: analytics.totalSpend,
        totalWaste: analytics.totalWaste,
        estate: analytics.estate,
        averageHealthScore: analytics.totalSpend.averageHealthScore,
      },
    });
  }),
);

module.exports = router;
