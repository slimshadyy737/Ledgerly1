import { NextResponse } from "next/server";
import { SpendApiError, listOptimizations } from "@/lib/spend/service";

export const dynamic = "force-dynamic";

/**
 * GET /api/analytics/optimizations
 * Audit trail written by the optimize endpoint (actor, action, savings).
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const int = (key: string): number | null => {
    const raw = searchParams.get(key);
    if (raw === null || raw === "") return null;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : null;
  };

  try {
    const response = await listOptimizations(
      int("companyId"),
      int("subscriptionId"),
      Math.min(Math.max(int("limit") ?? 50, 1), 200),
    );
    return NextResponse.json(response, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof SpendApiError) {
      return NextResponse.json(
        { ok: false, error: { code: error.code, message: error.message } },
        { status: error.status },
      );
    }
    return NextResponse.json(
      { ok: false, error: { code: "internal_error", message: error instanceof Error ? error.message : "Failed" } },
      { status: 500 },
    );
  }
}
