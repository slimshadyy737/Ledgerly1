import { NextResponse } from "next/server";
import { getSnapshot, reseedSandbox } from "@/lib/server/store";

export const dynamic = "force-dynamic";

/**
 * POST /api/ingest — re-runs the sandbox ingestion job.
 * Drops the simulated company and rebuilds all four source tables, then returns
 * a fresh snapshot. This is the button you press to demo the pipeline live.
 */
export async function POST() {
  try {
    const { durationMs } = await reseedSandbox();
    const snapshot = await getSnapshot();
    return NextResponse.json({
      ok: true,
      message: `Sandbox re-ingested in ${durationMs}ms — ${snapshot.ingestSources
        .map((s) => `${s.rows} ${s.name.split(" ")[0].toLowerCase()}`)
        .join(", ")} records loaded.`,
      snapshot,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
