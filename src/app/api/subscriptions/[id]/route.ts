import { NextResponse } from "next/server";
import { SpendApiError, getSubscription } from "@/lib/spend/service";

export const dynamic = "force-dynamic";

function parseId(raw: string): number {
  const id = Number.parseInt(raw, 10);
  if (!Number.isInteger(id) || id < 1 || String(id) !== raw.trim()) {
    throw SpendApiError.badRequest(`"id" must be a positive integer (received "${raw}")`);
  }
  return id;
}

/**
 * GET /api/subscriptions/:id
 * One contract + its full seat register (the SSO/activity telemetry) +
 * consolidation targets + optimization history. `?companyId=` is optional and
 * enforced when supplied.
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const { searchParams } = new URL(request.url);
    const companyIdRaw = searchParams.get("companyId");
    const companyId = companyIdRaw ? Number.parseInt(companyIdRaw, 10) : null;

    const result = await getSubscription(Number.isFinite(companyId) ? (companyId as number) : null, parseId(id));
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
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
