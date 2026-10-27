import { NextResponse } from "next/server";
import { getRawSandboxPreview } from "@/lib/server/store";

export const dynamic = "force-dynamic";

/**
 * GET /api/sandbox/raw — returns a sample of the *un-ingested* mock payloads
 * (card statement rows + SSO login rows) so evaluators can see the raw source
 * shape before normalisation.
 */
export async function GET() {
  try {
    const preview = await getRawSandboxPreview();
    return NextResponse.json(preview);
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
