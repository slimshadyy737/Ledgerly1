import { NextResponse } from "next/server";
import { SpendApiError, optimizeSubscription, type OptimizeBody } from "@/lib/spend/service";

export const dynamic = "force-dynamic";

/**
 * POST /api/subscriptions/:id/optimize — the write-back endpoint.
 *
 * Body:
 *   { "action": "reclaim_seats",  "seatsToReclaim": 14, "performedBy": "cfo@…" }
 *   { "action": "cancel",         "reason": "No logins in 45 days" }
 *   { "action": "consolidate",    "consolidateIntoSubscriptionId": 7 }
 *   { "action": "update_contract","seatsPaid": 64, "status": "paused",
 *     "nextRenewalAt": "2026-06-01T00:00:00Z" }
 *
 * Runs in a single transaction: row lock -> mutate seats/status -> recalculate
 * the recurring cost -> write an optimization_events audit row. The response
 * contains the updated contract AND a freshly recomputed analytics payload, so
 * the dashboard can refresh its metrics without a second round trip (it still
 * re-fetches, see DashboardApp.handleResolve).
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const subscriptionId = Number.parseInt(id, 10);
    if (!Number.isInteger(subscriptionId) || subscriptionId < 1 || String(subscriptionId) !== id.trim()) {
      throw SpendApiError.badRequest(`"id" must be a positive integer (received "${id}")`);
    }

    let body: OptimizeBody;
    try {
      body = (await request.json()) as OptimizeBody;
    } catch {
      throw SpendApiError.badRequest("Request body must be valid JSON");
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw SpendApiError.badRequest("Request body must be a JSON object");
    }

    const { searchParams } = new URL(request.url);
    const companyIdRaw = body.companyId ?? searchParams.get("companyId");
    const companyId =
      companyIdRaw === undefined || companyIdRaw === null || companyIdRaw === ""
        ? null
        : Number.parseInt(String(companyIdRaw), 10);

    const result = await optimizeSubscription({
      companyId: Number.isFinite(companyId as number) ? (companyId as number) : null,
      subscriptionId,
      body,
    });

    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof SpendApiError) {
      return NextResponse.json(
        { ok: false, error: { code: error.code, message: error.message, details: error.details } },
        { status: error.status },
      );
    }
    return NextResponse.json(
      {
        ok: false,
        error: { code: "internal_error", message: error instanceof Error ? error.message : "Optimization failed" },
      },
      { status: 500 },
    );
  }
}
