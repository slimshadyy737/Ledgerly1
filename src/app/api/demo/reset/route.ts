import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const run = promisify(execFile);

/**
 * POST /api/demo/reset
 *
 * Rebuilds the sandbox company in PostgreSQL by running the same deterministic
 * seed script used from the CLI (`server/src/db/seed.js`). It truncates the
 * contract register, licence register and audit log inside one transaction, then
 * reloads the 80-employee demo company.
 *
 * This is a demonstration control, not a production endpoint: it runs a local
 * Node script, so it requires the server process to have Node available and the
 * seed file present next to the app. Set ALLOW_DEMO_RESET=false to disable it.
 */
export async function POST() {
  if (process.env.ALLOW_DEMO_RESET === "false") {
    return NextResponse.json(
      { ok: false, error: { code: "disabled", message: "Demo reset is disabled (ALLOW_DEMO_RESET=false)." } },
      { status: 403 },
    );
  }

  const script = path.join(process.cwd(), "server", "src", "db", "seed.js");

  try {
    const { stdout } = await run(process.execPath, [script], { timeout: 55_000, cwd: process.cwd() });
    const line = stdout
      .split("\n")
      .reverse()
      .find((entry) => entry.includes("sandbox seed complete")) ?? "";

    const summary: Record<string, number> = {};
    const match = line.match(/\{.*\}/);
    if (match) {
      try {
        const parsed = JSON.parse(match[0]) as Record<string, unknown>;
        Object.entries(parsed).forEach(([key, value]) => {
          if (typeof value === "number") summary[key] = value;
        });
      } catch {
        /* summary is best-effort */
      }
    }

    return NextResponse.json({
      ok: true,
      message: `Sandbox rebuilt from the seed script — ${summary.users ?? 0} employees, ${summary.subscriptions ?? 0} contracts and ${summary.seatMappings ?? 0} seat records reloaded.`,
      summary,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "reset_failed",
          message: `Could not rebuild the sandbox database: ${detail}. Run \`node server/src/db/seed.js\` manually from the project root.`,
        },
      },
      { status: 500 },
    );
  }
}
