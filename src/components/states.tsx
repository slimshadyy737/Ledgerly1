"use client";

/**
 * Loading + error surfaces for the live-data dashboard.
 * Kept dumb and reusable so every fetch path renders the same feedback.
 */
import { Badge, Panel } from "./ui";

/** Shimmering skeleton shown while /api/analytics + /api/subscriptions load. */
export function DashboardSkeleton({ label = "Connecting to the spend API…" }: { label?: string }) {
  return (
    <div className="min-h-screen bg-[#060a15]">
      <div className="mx-auto max-w-[1500px] px-5 py-10">
        <div className="flex items-center gap-3">
          <span className="relative flex h-3 w-3">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-3 w-3 rounded-full bg-emerald-500" />
          </span>
          <p className="text-sm text-slate-300">{label}</p>
        </div>

        <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
          {Array.from({ length: 5 }).map((_, index) => (
            <div key={index} className="h-32 animate-pulse rounded-2xl border border-slate-800/70 bg-slate-900/40" />
          ))}
        </div>

        <div className="mt-6 grid grid-cols-1 gap-5 xl:grid-cols-3">
          <div className="space-y-3 xl:col-span-2">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="h-28 animate-pulse rounded-2xl border border-slate-800/70 bg-slate-900/40" />
            ))}
          </div>
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={index} className="h-40 animate-pulse rounded-2xl border border-slate-800/70 bg-slate-900/40" />
            ))}
          </div>
        </div>

        <p className="mt-8 text-xs text-slate-500">
          Fetching <span className="font-mono text-slate-400">/api/analytics</span> and{" "}
          <span className="font-mono text-slate-400">/api/subscriptions</span> in parallel…
        </p>
      </div>
    </div>
  );
}

/**
 * Full-page error state. Used when the analytics endpoint cannot be reached at
 * all — i.e. the backend is offline, the database is down, or the tenant has no
 * seeded data yet. Always offers a retry.
 */
export function BackendOfflinePanel({
  message,
  code,
  onRetry,
  retrying,
}: {
  message: string;
  code?: string;
  onRetry: () => void;
  retrying: boolean;
}) {
  const offline = code === "backend_offline" || code === "backend_timeout" || code === "backend_unavailable";

  return (
    <div className="mx-auto max-w-2xl px-5 py-20">
      <Panel className="overflow-hidden">
        <div className="border-b border-slate-800/70 bg-rose-500/5 px-6 py-5">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-rose-500/15 text-lg ring-1 ring-inset ring-rose-500/30">
              📡
            </span>
            <div>
              <h1 className="text-base font-semibold text-white">
                {offline ? "Spend API backend offline" : "Could not load spend data"}
              </h1>
              <p className="text-xs text-slate-400">
                The dashboard fetches <span className="font-mono">/api/analytics</span> and{" "}
                <span className="font-mono">/api/subscriptions</span> on mount.
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-4 px-6 py-5">
          <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3">
            <p className="text-xs font-medium text-rose-200">{message}</p>
            {code && <p className="mt-1 font-mono text-[10px] text-rose-300/80">code: {code}</p>}
          </div>

          <div>
            <p className="text-xs font-semibold text-slate-200">Bring the backend back up</p>
            <pre className="mt-2 overflow-x-auto rounded-xl border border-slate-800 bg-slate-950/80 p-4 font-mono text-[11px] leading-relaxed text-slate-300">
{`# 1. Next.js API routes (this dashboard) + PostgreSQL
pg_isready -h 127.0.0.1 -p 5432          # is the database up?
npm run dev                              # http://localhost:3000

# 2. first run only — create tables and load a tenant
node server/src/db/migrate.js
node server/src/db/seed.js               # or: psql -f server/src/db/seed_ghost_seat_demo.sql

# 3. optional — the standalone Express service on port 4000
node server/src/server.js                # same REST contract, same tables`}
            </pre>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={onRetry}
              disabled={retrying}
              className="rounded-lg bg-emerald-500 px-3.5 py-2 text-xs font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:opacity-60"
            >
              {retrying ? "Retrying…" : "Retry now"}
            </button>
            <a
              href="/api/health"
              target="_blank"
              rel="noreferrer"
              className="rounded-lg border border-slate-800 px-3.5 py-2 text-xs font-medium text-slate-300 transition hover:border-slate-700 hover:text-white"
            >
              Check /api/health
            </a>
            <a
              href="/api/analytics"
              target="_blank"
              rel="noreferrer"
              className="rounded-lg border border-slate-800 px-3.5 py-2 text-xs font-medium text-slate-300 transition hover:border-slate-700 hover:text-white"
            >
              Inspect /api/analytics
            </a>
          </div>

          <p className="text-[11px] leading-relaxed text-slate-500">
            Requests time out after 8 seconds, so a sleeping backend surfaces here instead of hanging the page. No data is
            cached between attempts — pressing retry re-issues both requests.
          </p>
        </div>
      </Panel>
    </div>
  );
}

/** Inline warning used when the secondary endpoint fails but KPIs are usable. */
export function PartialDataNotice({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2.5">
      <p className="text-xs text-amber-200">
        <Badge tone="amber">degraded</Badge> <span className="ml-2">{message}</span>
      </p>
      <button
        onClick={onRetry}
        className="rounded-lg border border-amber-500/40 px-2.5 py-1 text-[11px] font-medium text-amber-200 transition hover:bg-amber-500/10"
      >
        Retry
      </button>
    </div>
  );
}
