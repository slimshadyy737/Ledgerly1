import { NextResponse } from "next/server";
import { getSnapshot } from "@/lib/server/store";

export const dynamic = "force-dynamic";

/** GET /api/dashboard — full spend-intelligence snapshot (metrics + findings). */
export async function GET() {
  try {
    const snapshot = await getSnapshot();
    return NextResponse.json(snapshot);
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
