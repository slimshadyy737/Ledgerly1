import { NextResponse } from "next/server";
import { SpendApiError, getAnalytics } from "@/lib/spend/service";

export const dynamic = "force-dynamic";

/**
 * GET /api/analytics
 *
 * (a) TOTAL SPEND — SUM(recurring_cost_cents) over active subscriptions.
 * (b) TOTAL WASTE — duplicate-category spend + licences unused for >60 days
 *     (seat_mappings.last_login_at), counted once per dollar.
 *
 * Query params: companyId, asOf, staleDays, activeDays, limit
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const int = (key: string, fallback: number | null = null): number | null => {
    const raw = searchParams.get(key);
    if (raw === null || raw === "") return fallback;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
  };

  try {
    const asOfRaw = searchParams.get("asOf");
    const asOf = asOfRaw ? new Date(asOfRaw) : new Date();
    if (Number.isNaN(asOf.getTime())) {
      return NextResponse.json(
        { ok: false, error: { code: "validation_error", message: '"asOf" must be an ISO-8601 date string' } },
        { status: 400 },
      );
    }

    const analytics = await getAnalytics({
      companyId: int("companyId"),
      asOf,
      staleDays: int("staleDays"),
      activeDays: int("activeDays"),
      limitPerSection: Math.min(Math.max(int("limit", 25) ?? 25, 1), 200),
    });

    return NextResponse.json(analytics, {
      headers: { "Cache-Control": "no-store" },
    });
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
        error: {
          code: "internal_error",
          message: error instanceof Error ? error.message : "Analytics query failed",
        },
      },
      { status: 500 },
    );
  }
}
