import { NextResponse } from "next/server";
import { SpendApiError, listCompanies } from "@/lib/spend/service";

export const dynamic = "force-dynamic";

/** GET /api/companies — tenants available to the spend API (multi-tenant switcher). */
export async function GET() {
  try {
    const response = await listCompanies();
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
