/**
 * subscriptions.routes.js
 *
 *   GET  /api/subscriptions              list contracts (filter/sort/paginate)
 *   GET  /api/subscriptions/:id          one contract + seat register + history
 *   POST /api/subscriptions/:id/optimize apply an optimization (write-back)
 */
"use strict";

const express = require("express");
const subscriptionService = require("../services/subscriptionService");
const { asyncHandler } = require("../middleware");
const { HttpError } = require("../utils/httpError");
const { optionalInt } = require("../utils/validate");

const router = express.Router();

/** Parses :id, rejecting anything that is not a positive integer. */
function parseId(raw) {
  const id = Number.parseInt(raw, 10);
  if (!Number.isInteger(id) || id < 1 || String(id) !== String(raw).trim()) {
    throw HttpError.badRequest(`"id" must be a positive integer (received "${raw}")`);
  }
  return id;
}

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const result = await subscriptionService.listSubscriptions(req.query);
    res.json(result);
  }),
);

// ?companyId= is optional: the subscription id itself identifies the tenant.
router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const result = await subscriptionService.getSubscription(
      optionalInt(req.query.companyId, "companyId", { min: 1 }),
      parseId(req.params.id),
    );
    res.json(result);
  }),
);

/**
 * Write-back endpoint. Example bodies:
 *
 *   { "action": "reclaim_seats", "seatsToReclaim": 14, "performedBy": "cfo@northwind.io" }
 *   { "action": "cancel", "reason": "No logins in 45 days" }
 *   { "action": "consolidate", "consolidateIntoSubscriptionId": 7 }
 *   { "action": "update_contract", "seatsPaid": 64, "status": "paused",
 *     "nextRenewalAt": "2026-06-01T00:00:00Z" }
 */
router.post(
  "/:id/optimize",
  asyncHandler(async (req, res) => {
    if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
      throw HttpError.badRequest("Request body must be a JSON object");
    }
    // Tenant scope is derived from the subscription; an explicit companyId in the
    // body (or query string) is still honoured and enforced when present.
    const requestedCompanyId =
      optionalInt(req.body.companyId, "companyId", { min: 1 }) ??
      optionalInt(req.query.companyId, "companyId", { min: 1 });

    const result = await subscriptionService.optimizeSubscription({
      companyId: requestedCompanyId,
      subscriptionId: parseId(req.params.id),
      body: req.body,
    });
    res.status(200).json(result);
  }),
);

module.exports = router;
