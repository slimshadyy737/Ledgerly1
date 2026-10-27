"use client";

import { useEffect, useState } from "react";
import type { Snapshot } from "@/lib/types";
import { formatDateTime, usdCompact } from "@/lib/format";
import { Badge, Panel } from "./ui";

interface RawPreview {
  statementSample: {
    statementPeriod: string;
    postedAt: string;
    merchantDescriptor: string;
    amountCents: number;
    cardLast4: string;
    anomaly: string | null;
  }[];
  ssoSample: {
    appName: string;
    employeeEmail: string;
    lastLoginAt: string | null;
    loginsLast30d: number;
    totalLogins90d: number;
  }[];
  counts: {
    employees: number;
    vendors: number;
    seatAssignments: number;
    ssoEvents: number;
    transactions: number;
  };
  meta: { company: string; narrative: string; periodMonths: number; offboardedCount: number };
}

const STEPS = [
  {
    title: "1 · Sandbox ingestion",
    body: "buildSandboxDataset() synthesises an 80-person company: HRIS roster, licence register, Workspace SSO logins and 6 months of card charges, then reseedSandbox() loads it into PostgreSQL through Drizzle.",
  },
  {
    title: "2 · Normalisation",
    body: "Raw merchant descriptors are fuzzy-matched to the vendor register (matchConfidence). Amounts land as integer cents; SSO rows are keyed by employee email so they join to the roster and the licence register.",
  },
  {
    title: "3 · Cross-reference",
    body: "runDetective() performs a three-way join (transactions ⨝ seat_assignments ⨝ sso_events) and applies five deterministic detectors. Pure functions — no I/O — so results are reproducible.",
  },
  {
    title: "4 · Write-back",
    body: "POST /api/actions revokes seats, downgrades licences or cancels contracts, writes an audit row into optimization_actions, and returns a recomputed snapshot so the KPIs animate instantly.",
  },
];

export function PipelineTab({
  snapshot,
  onReingest,
  ingesting,
}: {
  snapshot: Snapshot;
  onReingest: () => void;
  ingesting: boolean;
}) {
  const [raw, setRaw] = useState<RawPreview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/sandbox/raw")
      .then((res) => res.json())
      .then((data: RawPreview) => setRaw(data))
      .catch((err: Error) => setError(err.message));
  }, [snapshot.lastIngestAt]);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Panel title="Data pipeline walkthrough" subtitle="Four stages you can explain in one slide">
          <ol className="space-y-3 p-4">
            {STEPS.map((step, index) => (
              <li key={step.title} className="relative rounded-xl border border-slate-800 bg-slate-950/50 p-3 pl-11">
                <span className="absolute left-3 top-3 flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500/15 text-[11px] font-semibold text-emerald-300 ring-1 ring-inset ring-emerald-500/30">
                  {index + 1}
                </span>
                <p className="text-xs font-semibold text-slate-200">{step.title}</p>
                <p className="mt-1 text-[11px] leading-relaxed text-slate-400">{step.body}</p>
              </li>
            ))}
          </ol>
        </Panel>

        <Panel
          title="Detection rules"
          subtitle="Thresholds are exported as constants in src/lib/engine.ts"
          action={
            <button
              onClick={onReingest}
              disabled={ingesting}
              className="rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:opacity-60"
            >
              {ingesting ? "Re-ingesting…" : "Re-run ingestion job"}
            </button>
          }
        >
          <div className="divide-y divide-slate-800/70">
            {snapshot.detectionRules.map((rule) => (
              <div key={rule.name} className="px-4 py-3">
                <div className="flex items-center gap-2">
                  <p className="text-xs font-semibold text-slate-200">{rule.name}</p>
                  <Badge tone={rule.severity === "critical" ? "rose" : rule.severity === "high" ? "amber" : "sky"}>
                    {rule.severity}
                  </Badge>
                  <span className="text-[11px] text-slate-500">
                    {snapshot.findings.filter((f) => f.detectionRule === rule.rule).length} hit(s)
                  </span>
                </div>
                <p className="mt-1 text-[11px] leading-relaxed text-slate-400">{rule.rule}</p>
                <p className="mt-1 font-mono text-[10px] text-slate-500">{rule.threshold}</p>
              </div>
            ))}
            <div className="px-4 py-3 text-[11px] text-slate-400">
              <p className="font-semibold text-slate-200">Waste accounting rule</p>
              Each dollar is counted once: a zombie tool claims its whole invoice, otherwise ghost + idle + duplicate
              premium are summed per vendor. Duplicate-tooling savings are capped at{" "}
              <span className="font-mono">monthly_cost − already_counted_leakage</span> so nothing is inflated.
            </div>
          </div>
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Panel title="Run it locally" subtitle="Copy/paste instructions for your evaluator" className="lg:col-span-2">
          <div className="space-y-3 p-4">
            <pre className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950/80 p-4 font-mono text-[11px] leading-relaxed text-slate-300">
{`# 1. install dependencies
npm install

# 2. point the app at PostgreSQL (already in .env for this sandbox)
echo "DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/app_db" > .env

# 3. create the tables (Drizzle push — no migration files needed)
npx drizzle-kit push

# 4. run the app (sandbox data is ingested automatically on first request)
npm run dev        # http://localhost:3000

# production check
npm run build && npm run start

# optional: re-run the ingestion job from the CLI
curl -X POST http://localhost:3000/api/ingest`}
            </pre>
            <div className="grid grid-cols-1 gap-2 text-[11px] text-slate-400 sm:grid-cols-2">
              <p>
                <span className="text-slate-500">Stack:</span> Next.js 16 (App Router, React 19) · Tailwind CSS v4 ·
                Drizzle ORM · PostgreSQL
              </p>
              <p>
                <span className="text-slate-500">No external APIs:</span> Plaid/Stripe/Okta are replaced by the local
                sandbox generator in <span className="font-mono">src/lib/sandbox</span>.
              </p>
              <p>
                <span className="text-slate-500">Tables:</span>{" "}
                <span className="font-mono">
                  employees, vendors, seat_assignments, sso_events, transactions, optimization_actions, ingest_runs
                </span>
              </p>
              <p>
                <span className="text-slate-500">Last ingestion:</span> {formatDateTime(snapshot.lastIngestAt)} in{" "}
                {snapshot.ingestDurationMs}ms
              </p>
            </div>
          </div>
        </Panel>

        <Panel title="API surface" subtitle="Everything the dashboard consumes">
          <ul className="divide-y divide-slate-800/70 text-[11px]">
            {[
              { method: "GET", path: "/api/health", note: "DB connectivity probe used by the platform" },
              { method: "GET", path: "/api/dashboard", note: "metrics + findings + inventory + raw ledgers" },
              { method: "POST", path: "/api/actions", note: "reclaim_seats · cancel_subscription · consolidate" },
              { method: "POST", path: "/api/ingest", note: "re-runs the sandbox ingestion job" },
              { method: "GET", path: "/api/sandbox/raw", note: "sample of un-normalised statement + SSO rows" },
            ].map((route) => (
              <li key={route.path} className="flex items-start gap-2 px-4 py-2.5">
                <span
                  className={`mt-0.5 rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold ${
                    route.method === "GET" ? "bg-sky-500/15 text-sky-300" : "bg-emerald-500/15 text-emerald-300"
                  }`}
                >
                  {route.method}
                </span>
                <span>
                  <span className="font-mono text-slate-200">{route.path}</span>
                  <span className="block text-slate-500">{route.note}</span>
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      <Panel
        title="Raw source preview (pre-normalisation)"
        subtitle="GET /api/sandbox/raw — the exact shape of the mock accounting statement and SSO export"
        action={
          raw ? (
            <div className="flex flex-wrap gap-1.5 text-[10px]">
              <Badge tone="slate">{raw.counts.employees} employees</Badge>
              <Badge tone="slate">{raw.counts.vendors} vendors</Badge>
              <Badge tone="slate">{raw.counts.transactions} transactions</Badge>
              <Badge tone="slate">{raw.counts.ssoEvents} sso rows</Badge>
              <Badge tone="emerald">{usdCompact(snapshot.metrics.monthlySpendCents)}/mo modelled</Badge>
            </div>
          ) : null
        }
      >
        {error && <p className="p-4 text-xs text-rose-300">Failed to load preview: {error}</p>}
        {!raw && !error && <p className="p-4 text-xs text-slate-400">Loading raw payload sample…</p>}
        {raw && (
          <div className="grid grid-cols-1 gap-4 p-4 lg:grid-cols-2">
            <div>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                Statement rows (transactions.json)
              </p>
              <pre className="max-h-72 overflow-auto rounded-xl border border-slate-800 bg-slate-950/80 p-3 font-mono text-[10px] leading-relaxed text-slate-300">
                {JSON.stringify(raw.statementSample, null, 2)}
              </pre>
            </div>
            <div>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                Login rows (sso_events.json)
              </p>
              <pre className="max-h-72 overflow-auto rounded-xl border border-slate-800 bg-slate-950/80 p-3 font-mono text-[10px] leading-relaxed text-slate-300">
                {JSON.stringify(raw.ssoSample, null, 2)}
              </pre>
            </div>
            <p className="text-[11px] text-slate-400 lg:col-span-2">{raw.meta.narrative}</p>
          </div>
        )}
      </Panel>

      <Panel title="Ingested sources" subtitle="What the ingestion job loaded on the last run">
        <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
          {snapshot.ingestSources.map((source) => (
            <div key={source.name} className="rounded-xl border border-slate-800 bg-slate-950/50 p-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-slate-200">{source.name}</p>
                <Badge tone="emerald">{source.status}</Badge>
              </div>
              <p className="mt-1 font-mono text-[10px] text-slate-500">{source.format}</p>
              <p className="mt-2 text-lg font-semibold tabular-nums text-slate-100">{source.rows.toLocaleString()}</p>
              <p className="text-[11px] text-slate-500">rows loaded · {source.purpose}</p>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}
