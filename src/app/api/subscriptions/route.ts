import { NextResponse } from "next/server";
import { SpendApiError, listSubscriptions } from "@/lib/spend/service";

export const dynamic = "force-dynamic";

/**
 * GET /api/subscriptions
 * The contract register with seat utilisation, health score and per-contract
 * waste. Filters: status, categoryGroup, search, minMonthlyCents, wastefulOnly.
 * Sorting: sort=<key>&order=asc|desc. Pagination: page, pageSize (max 200).
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const get = (key: string): string | null => searchParams.get(key);

  try {
    const result = await listSubscriptions({
      companyId: get("companyId"),
      status: get("status"),
      categoryGroup: get("categoryGroup"),
      search: get("search") ?? get("q"),
      minMonthlyCents:
        get("minMonthlyCents") ??
        (get("minMonthlyUsd") ? Number.parseInt(get("minMonthlyUsd") as string, 10) * 100 : null),
      wastefulOnly: get("wastefulOnly"),
      sort: get("sort"),
      order: get("order"),
      page: get("page"),
      pageSize: get("pageSize") ?? get("limit"),
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
        error: { code: "internal_error", message: error instanceof Error ? error.message : "Query failed" },
      },
      { status: 500 },
    );
  }
}
