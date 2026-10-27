import { NextResponse } from "next/server";
import { applyAction } from "@/lib/server/store";
import type { ActionRequestPayload } from "@/lib/types";

export const dynamic = "force-dynamic";

const VALID_TYPES = ["reclaim_seats", "cancel_subscription", "consolidate"];

/**
 * POST /api/actions — the write-back endpoint.
 * Body: { vendorId, actionType, seats?, findingKind? }
 * Applies the optimisation, records the audit row, and returns a fresh snapshot
 * so the dashboard does not need a second round trip.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Partial<ActionRequestPayload>;

    if (typeof body.vendorId !== "number" || !Number.isFinite(body.vendorId)) {
      return NextResponse.json({ ok: false, error: "vendorId (number) is required" }, { status: 400 });
    }
    if (!body.actionType || !VALID_TYPES.includes(body.actionType)) {
      return NextResponse.json(
        { ok: false, error: `actionType must be one of ${VALID_TYPES.join(", ")}` },
        { status: 400 },
      );
    }

    const result = await applyAction({
      vendorId: body.vendorId,
      actionType: body.actionType,
      seats: typeof body.seats === "number" ? body.seats : undefined,
      findingKind: body.findingKind,
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 400 },
    );
  }
}
