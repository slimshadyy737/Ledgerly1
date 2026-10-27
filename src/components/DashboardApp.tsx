"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AnalyticsResponse,
  CompaniesResponse,
  OptimizeAction,
  OptimizationEventDTO,
  SubscriptionDTO,
} from "@/lib/spend/types";
import type { ActionRequestPayload, AppliedActionDTO, Snapshot } from "@/lib/types";
import { buildLiveSnapshot } from "@/lib/live/adapter";
import {
  LiveApiError,
  fetchAnalytics,
  fetchCompanies,
  fetchOptimizations,
  fetchSubscriptions,
  optimizeSubscriptionRequest,
} from "@/lib/live/client";
import { formatDateTime, pct, usd, usdCompact } from "@/lib/format";
import { CountUp, Meter, Toast } from "./ui";
import { BackendOfflinePanel, DashboardSkeleton, PartialDataNotice } from "./states";
import { OverviewTab } from "./OverviewTab";
import { InventoryTab } from "./InventoryTab";
import { PipelineTab } from "./PipelineTab";
import { SsoTab, StatementTab, TeamTab } from "./DataTabs";

type TabKey = "overview" | "inventory" | "statement" | "sso" | "team" | "pipeline";

const TABS: { key: TabKey; label: string; hint: string }[] = [
  { key: "overview", label: "CFO Overview", hint: "live metrics + action feed" },
  { key: "inventory", label: "Inventory", hint: "vendor table (live)" },
  { key: "statement", label: "Statement Ledger", hint: "card transactions" },
  { key: "sso", label: "SSO Login Log", hint: "activity telemetry" },
  { key: "team", label: "Team", hint: "roster ↔ licences" },
  { key: "pipeline", label: "Pipeline & Docs", hint: "how it works" },
];

/** Tabs whose data comes from the simulated sandbox ledgers (/api/dashboard). */
const SANDBOX_TABS: TabKey[] = ["statement", "sso", "team", "pipeline"];

type LoadState = "loading" | "ready" | "refreshing" | "error";

export function DashboardApp() {
  /* ------------------------------ live API state ------------------------- */
  // No hardcoded arrays: every value below is filled by the mount effect.
  const [analytics, setAnalytics] = useState<AnalyticsResponse | null>(null);
  const [subscriptions, setSubscriptions] = useState<SubscriptionDTO[]>([]);
  const [auditTrail, setAuditTrail] = useState<OptimizationEventDTO[]>([]);
  const [companies, setCompanies] = useState<CompaniesResponse["data"]>([]);
  const [companyId, setCompanyId] = useState<number | null>(null);

  /* --------------------------- fetch/UX state ---------------------------- */
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [error, setError] = useState<{ message: string; code?: string } | null>(null);
  const [inventoryError, setInventoryError] = useState<string | null>(null);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; tone: "success" | "error" } | null>(null);
  const [tab, setTab] = useState<TabKey>("overview");

  /* ------------------- sandbox ledgers (secondary source) ---------------- */
  const [sandbox, setSandbox] = useState<Snapshot | null>(null);
  const [sandboxState, setSandboxState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [ingesting, setIngesting] = useState(false);

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  /* ---------------------------------------------------------------------- */
  /* 1. useEffect: fetch("/api/analytics") + fetch("/api/subscriptions")     */
  /* ---------------------------------------------------------------------- */
  const loadLiveData = useCallback(
    async (options: { background?: boolean; signal?: AbortSignal } = {}) => {
      const { background = false, signal } = options;
      setLoadState((previous) => (background && previous === "ready" ? "refreshing" : "loading"));

      try {
        // Both endpoints are requested in parallel on mount / refresh.
        const [analyticsResult, subscriptionsResult] = await Promise.allSettled([
          fetchAnalytics(companyId, signal),
          fetchSubscriptions(companyId, signal),
        ]);

        if (signal?.aborted) return;

        // The analytics payload drives the metrics panel, so it is required.
        if (analyticsResult.status === "rejected") throw analyticsResult.reason;

        setAnalytics(analyticsResult.value);

        if (subscriptionsResult.status === "fulfilled") {
          setSubscriptions(subscriptionsResult.value.data);
          setInventoryError(null);
        } else {
          // Degrade gracefully: KPIs and the action feed still render.
          const reason = subscriptionsResult.reason;
          setInventoryError(
            reason instanceof Error ? reason.message : "Could not load /api/subscriptions — inventory unavailable.",
          );
        }

        setError(null);
        setLoadState("ready");

        // Secondary data (audit trail, tenant list) never blocks the render.
        fetchOptimizations(companyId, signal)
          .then((response) => {
            if (mounted.current) setAuditTrail(response.data);
          })
          .catch(() => undefined);
        fetchCompanies(signal)
          .then((response) => {
            if (mounted.current) setCompanies(response.data);
          })
          .catch(() => undefined);
      } catch (caught) {
        if (signal?.aborted) return;
        const apiError = caught instanceof LiveApiError ? caught : null;
        setError({
          message:
            caught instanceof Error ? caught.message : "Unknown error while loading the spend dashboard.",
          code: apiError?.code ?? (apiError?.isOffline ? "backend_offline" : undefined),
        });
        setLoadState("error");
      }
    },
    [companyId],
  );

  // Mount / tenant switch => load. Unmount => abort in-flight requests.
  useEffect(() => {
    const controller = new AbortController();
    void loadLiveData({ signal: controller.signal });
    return () => controller.abort();
  }, [loadLiveData]);

  // Sandbox ledgers load lazily, only when a tab that needs them is opened.
  useEffect(() => {
    if (!SANDBOX_TABS.includes(tab) || sandbox || sandboxState === "loading") return;
    const controller = new AbortController();
    setSandboxState("loading");
    fetch("/api/dashboard", { signal: controller.signal, cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error(`GET /api/dashboard failed with HTTP ${response.status}`);
        return response.json() as Promise<Snapshot>;
      })
      .then((snapshot) => {
        if (!mounted.current) return;
        setSandbox(snapshot);
        setSandboxState("ready");
      })
      .catch(() => {
        if (mounted.current) setSandboxState("error");
      });
    return () => controller.abort();
  }, [tab, sandbox, sandboxState]);

  /* ---------------------------------------------------------------------- */
  /* 2. handleResolve: POST /api/subscriptions/:id/optimize, then re-fetch   */
  /* ---------------------------------------------------------------------- */
  const handleResolve = useCallback(
    async (payload: ActionRequestPayload) => {
      if (!payload.vendorId) {
        setToast({ tone: "error", message: "No vendor is attached to this action item." });
        return;
      }

      // The view model uses UI vocabulary; the API contract uses action names.
      const action: OptimizeAction = payload.actionType === "cancel_subscription" ? "cancel" : payload.actionType;
      const key = `${payload.vendorId}:${payload.actionType}`;
      setPendingKey(key);

      try {
        const response = await optimizeSubscriptionRequest(payload.vendorId, {
          action,
          seats: action === "reclaim_seats" ? payload.seats : undefined,
          reason:
            action === "consolidate"
              ? `Consolidated at the recommendation of the ${payload.findingKind ?? "overlap"} detector`
              : `Applied from the CFO dashboard (${payload.findingKind ?? "manual review"})`,
          performedBy: analytics?.company.domain === "ridgepoint.io" ? "cfo@ridgepoint.io" : "cfo@northwind.io",
        });

        setToast({ tone: "success", message: response.message });

        // Re-fetch the latest calculations so every KPI reflects the write-back.
        await loadLiveData({ background: true });

        if (mounted.current) {
          setAuditTrail((previous) => {
            const next: OptimizationEventDTO = {
              id: response.data.auditEventId,
              subscriptionId: payload.vendorId,
              vendorName: response.data.subscription?.vendor ?? "vendor",
              action: response.data.action,
              seatsReclaimed: response.data.seatsReclaimed,
              previousCostCents: response.data.savings.previousMonthlyCents,
              newCostCents: response.data.savings.newMonthlyCents,
              savingsCents: response.data.savings.monthlyCents,
              savingsDisplay: response.data.savings.monthlyDisplay,
              performedBy: "cfo@northwind.io",
              createdAt: new Date().toISOString(),
              detail: null,
            };
            return [next, ...previous.filter((event) => event.id !== next.id)];
          });
        }
      } catch (caught) {
        setToast({
          tone: "error",
          message:
            caught instanceof Error
              ? `Optimization failed: ${caught.message}`
              : "Optimization failed: unknown error",
        });
      } finally {
        if (mounted.current) setPendingKey(null);
      }
    },
    [analytics?.company.domain, loadLiveData],
  );

  /* --------------------------------- derived ----------------------------- */
  const recoveredCents = useMemo(
    () => auditTrail.reduce((sum, event) => sum + event.savingsCents, 0),
    [auditTrail],
  );

  const snapshot: Snapshot | null = useMemo(() => {
    if (!analytics) return null;
    const base = buildLiveSnapshot(analytics, subscriptions, recoveredCents, sandbox);
    const history: AppliedActionDTO[] = auditTrail.map((event) => ({
      id: event.id,
      vendorId: event.subscriptionId,
      vendorName: event.vendorName,
      actionType: event.action === "cancel" ? "cancel_subscription" : event.action,
      title: `${event.action.replace(/_/g, " ")} on ${event.vendorName}`,
      detail: event.detail ?? `Recurring cost set to ${usd(event.newCostCents)}/month.`,
      seatsAffected: event.seatsReclaimed,
      monthlySavingsCents: event.savingsCents,
      annualizedSavingsCents: event.savingsCents * 12,
      triggeredBy: event.performedBy,
      createdAt: event.createdAt,
    }));
    return { ...base, history };
  }, [analytics, subscriptions, recoveredCents, sandbox, auditTrail]);

  const reingestSandbox = useCallback(async () => {
    setIngesting(true);
    try {
      const response = await fetch("/api/ingest", { method: "POST" });
      const data = (await response.json()) as { ok: boolean; message?: string; snapshot?: Snapshot; error?: string };
      if (data.ok && data.snapshot) {
        setSandbox(data.snapshot);
        setSandboxState("ready");
        setToast({ tone: "success", message: data.message ?? "Sandbox ledgers re-ingested." });
      } else {
        setToast({ tone: "error", message: data.error ?? "Sandbox ingestion failed." });
      }
    } catch (caught) {
      setToast({
        tone: "error",
        message: caught instanceof Error ? caught.message : "Sandbox ingestion failed.",
      });
    } finally {
      setIngesting(false);
    }
  }, []);

  const exportJson = useCallback(() => {
    if (!snapshot || !analytics) return;
    const blob = new Blob(
      [JSON.stringify({ analytics, subscriptions, auditTrail }, null, 2)],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `saas-spend-${analytics.company.name.toLowerCase().replace(/\s+/g, "-")}-${new Date()
      .toISOString()
      .slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    setToast({ tone: "success", message: "Exported the live API payloads (analytics + subscriptions + audit trail)." });
  }, [snapshot, analytics, auditTrail]);

  /* --------------------------------- render ------------------------------ */

  // 3. Loading state
  if (loadState === "loading" && !analytics) {
    return <DashboardSkeleton label="Loading spend data from the API…" />;
  }

  // 3. Error / backend-offline state
  if (loadState === "error" || !snapshot || !analytics) {
    return (
      <div className="min-h-screen bg-[#060a15]">
        <BackendOfflinePanel
          message={error?.message ?? "The spend API returned no data."}
          code={error?.code}
          onRetry={() => void loadLiveData()}
          retrying={loadState === "loading"}
        />
      </div>
    );
  }

  const { metrics } = snapshot;
  const trendDelta = 0; // No statement history in the canonical schema.

  return (
    <div className="min-h-screen bg-[#060a15] text-slate-200">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(1200px_600px_at_20%_-10%,rgba(16,185,129,0.10),transparent),radial-gradient(900px_500px_at_90%_0%,rgba(56,189,248,0.08),transparent)]" />

      <div className="relative mx-auto max-w-[1500px] px-5 pb-16 pt-6">
        {/* ------------------------------ top bar ---------------------------- */}
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-400 to-teal-600 text-lg font-black text-slate-950 shadow-lg shadow-emerald-500/20">
              ₪
            </div>
            <div>
              <h1 className="flex items-center gap-2 text-lg font-semibold tracking-tight text-white">
                LedgerPulse
                <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-emerald-300 ring-1 ring-inset ring-emerald-500/30">
                  B2B Subscription Optimizer
                </span>
                {loadState === "refreshing" && (
                  <span className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-sky-300">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-sky-400" />
                    refreshing
                  </span>
                )}
              </h1>
              <p className="text-xs text-slate-400">
                {analytics.company.name} · {analytics.company.headcount} employees · live data from{" "}
                <span className="font-mono text-slate-500">/api/analytics</span> +{" "}
                <span className="font-mono text-slate-500">/api/subscriptions</span> · updated{" "}
                {formatDateTime(analytics.generatedAt)}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {companies.length > 1 && (
              <select
                value={companyId ?? analytics.company.id}
                onChange={(event) => setCompanyId(Number(event.target.value))}
                className="rounded-lg border border-slate-800 bg-slate-900/60 px-2.5 py-1.5 text-xs text-slate-200 focus:border-emerald-500/60 focus:outline-none"
              >
                {companies.map((company) => (
                  <option key={company.id} value={company.id}>
                    {company.name} — {company.active_subscriptions} subscriptions
                  </option>
                ))}
              </select>
            )}
            <button
              onClick={() => void loadLiveData()}
              className="rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-1.5 text-xs font-medium text-slate-300 transition hover:border-slate-700 hover:text-white"
            >
              Refresh API data
            </button>
            <button
              onClick={exportJson}
              className="rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-1.5 text-xs font-medium text-slate-300 transition hover:border-slate-700 hover:text-white"
            >
              Export JSON
            </button>
          </div>
        </header>

        {inventoryError && (
          <div className="mt-4">
            <PartialDataNotice
              message={`${inventoryError} The KPI panel and action feed below still reflect /api/analytics.`}
              onRetry={() => void loadLiveData()}
            />
          </div>
        )}

        {/* ------------------------------ KPI row ---------------------------- */}
        <section className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <KpiCard
            label="Total monthly SaaS spend"
            value={metrics.monthlySpendCents}
            caption={`${usdCompact(metrics.annualizedSpendCents)} annualised across ${metrics.activeSubscriptions} active subscriptions`}
            tone="emerald"
            delta={trendDelta}
            footer={<Meter value={100 - Math.min(100, metrics.wasteRatePct)} color="#34d399" height={4} />}
          />
          <KpiCard
            label="Total wasted budget"
            value={metrics.wastedCents}
            caption={`${pct(metrics.wasteRatePct, 1)} of spend · ${usdCompact(metrics.wastedCents * 12)} per year`}
            tone="rose"
            footer={
              <div className="flex flex-wrap gap-1.5 text-[10px] text-slate-400">
                <span className="rounded bg-rose-500/15 px-1.5 py-0.5 text-rose-300">
                  {metrics.ghostSeatCount} ghost seats
                </span>
                <span className="rounded bg-rose-500/15 px-1.5 py-0.5 text-rose-300">
                  {metrics.zombieCount} zombie tools
                </span>
                <span className="rounded bg-sky-500/15 px-1.5 py-0.5 text-sky-300">
                  {metrics.overlapCount} overlaps
                </span>
              </div>
            }
          />
          <KpiCard
            label="Active subscriptions"
            value={metrics.activeSubscriptions}
            raw
            caption={`${metrics.cancelledSubscriptions} retired · ${metrics.seatsPaid} seats provisioned`}
            tone="sky"
            footer={
              <div className="flex items-center justify-between text-[10px] text-slate-400">
                <span>{metrics.activeUsers} seats active</span>
                <span className="tabular-nums text-slate-300">{pct(metrics.seatUtilizationPct, 1)} utilised</span>
              </div>
            }
          />
          <KpiCard
            label="Savings recovered"
            value={metrics.recoveredCents}
            caption={`${usdCompact(metrics.recoveredAnnualizedCents)} annualised · ${snapshot.history.length} decision(s) logged`}
            tone="violet"
            footer={
              <div className="text-[10px] text-slate-400">
                Remaining opportunity:{" "}
                <span className="tabular-nums text-amber-300">{usd(metrics.recoverableCents)}/mo</span>
              </div>
            }
          />
          <KpiCard
            label="Estate health score"
            value={metrics.avgHealthScore}
            raw
            suffix="/100"
            caption={`${metrics.idleSeatCount} unprovisioned seats · ${metrics.openFindings} open findings`}
            tone={metrics.avgHealthScore >= 70 ? "emerald" : metrics.avgHealthScore >= 55 ? "amber" : "rose"}
            footer={
              <Meter
                value={metrics.avgHealthScore}
                color={metrics.avgHealthScore >= 70 ? "#34d399" : metrics.avgHealthScore >= 55 ? "#fbbf24" : "#fb7185"}
                height={4}
              />
            }
          />
        </section>

        {/* -------------------------------- tabs ----------------------------- */}
        <nav className="mt-6 flex flex-wrap gap-1.5 rounded-xl border border-slate-800/80 bg-slate-900/40 p-1.5">
          {TABS.map((item) => {
            const needsSandbox = SANDBOX_TABS.includes(item.key);
            return (
              <button
                key={item.key}
                onClick={() => setTab(item.key)}
                className={`flex-1 rounded-lg px-3 py-2 text-left transition ${
                  tab === item.key ? "bg-emerald-500/15 ring-1 ring-inset ring-emerald-500/30" : "hover:bg-slate-800/50"
                }`}
              >
                <span
                  className={`block text-xs font-semibold ${tab === item.key ? "text-emerald-300" : "text-slate-300"}`}
                >
                  {item.label}
                  {needsSandbox && (
                    <span className="ml-1 text-[9px] font-normal uppercase tracking-wide text-slate-500">sandbox</span>
                  )}
                </span>
                <span className="block text-[10px] text-slate-500">{item.hint}</span>
              </button>
            );
          })}
        </nav>

        <main className="mt-5">
          {tab === "overview" && (
            <OverviewTab snapshot={snapshot} onAction={handleResolve} pendingKey={pendingKey} />
          )}
          {tab === "inventory" && (
            <InventoryTab snapshot={snapshot} onAction={handleResolve} pendingKey={pendingKey} />
          )}

          {SANDBOX_TABS.includes(tab) && sandboxState !== "ready" && (
            <div className="rounded-2xl border border-slate-800/80 bg-slate-900/50 p-10 text-center">
              <p className="text-sm text-slate-300">
                {sandboxState === "error"
                  ? "Sandbox ledger source (/api/dashboard) is unavailable."
                  : "Loading the simulated statement + SSO ledgers…"}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                The KPI panel, action feed and inventory above come from the live spend API; these tabs additionally show
                the raw ingestion ledgers.
              </p>
              {sandboxState === "error" && (
                <button
                  onClick={() => setSandboxState("idle")}
                  className="mt-4 rounded-lg border border-slate-800 px-3 py-1.5 text-xs text-slate-300 transition hover:border-slate-700 hover:text-white"
                >
                  Retry ledger load
                </button>
              )}
            </div>
          )}

          {tab === "statement" && sandbox && <StatementTab snapshot={snapshot} />}
          {tab === "sso" && sandbox && (
            <SsoTab snapshot={snapshot} onAction={handleResolve} pendingKey={pendingKey} />
          )}
          {tab === "team" && sandbox && <TeamTab snapshot={snapshot} />}
          {tab === "pipeline" && (
            <PipelineTab snapshot={snapshot} onReingest={reingestSandbox} ingesting={ingesting} />
          )}
        </main>

        <footer className="mt-10 border-t border-slate-800/70 pt-5 text-[11px] text-slate-500">
          <p>
            LedgerPulse prototype · Next.js App Router + Tailwind + PostgreSQL. Metrics, the optimisation queue and the
            inventory table are fetched at runtime from{" "}
            <span className="font-mono">GET /api/analytics</span> and <span className="font-mono">GET /api/subscriptions</span>;
            every action button issues <span className="font-mono">POST /api/subscriptions/:id/optimize</span> and then
            re-fetches so the panel recalculates.
          </p>
          <p className="mt-1">
            Waste rules live in SQL: ghost seats (inactive &gt; {analytics.windows.staleLicenseDays} days or offboarded
            holder), zombie software ({analytics.windows.activeSeatDays} days with zero logins while billing), duplicate
            category spend and idle unprovisioned seats — each dollar counted once.
          </p>
        </footer>
      </div>

      {toast && <Toast message={toast.message} tone={toast.tone} onClose={() => setToast(null)} />}
    </div>
  );
}

/* ---------------------------------- KPI card -------------------------------- */

function KpiCard({
  label,
  value,
  caption,
  tone,
  footer,
  delta,
  suffix,
  raw = false,
}: {
  label: string;
  value: number;
  caption: string;
  tone: "emerald" | "rose" | "sky" | "violet" | "amber";
  footer?: React.ReactNode;
  delta?: number;
  suffix?: string;
  raw?: boolean;
}) {
  const tones: Record<string, string> = {
    emerald: "text-emerald-300",
    rose: "text-rose-300",
    sky: "text-sky-300",
    violet: "text-violet-300",
    amber: "text-amber-300",
  };
  const glow: Record<string, string> = {
    emerald: "from-emerald-500/10",
    rose: "from-rose-500/10",
    sky: "from-sky-500/10",
    violet: "from-violet-500/10",
    amber: "from-amber-500/10",
  };

  return (
    <div className="relative overflow-hidden rounded-2xl border border-slate-800/80 bg-slate-900/50 p-4">
      <div className={`pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b ${glow[tone]} to-transparent`} />
      <div className="relative">
        <p className="text-[11px] uppercase tracking-wider text-slate-500">{label}</p>
        <div className="mt-2 flex items-baseline gap-2">
          <CountUp
            value={value}
            format={(n) => (raw ? Math.round(n).toString() : usd(n))}
            className={`text-2xl font-semibold ${tones[tone]}`}
          />
          {suffix && <span className="text-sm text-slate-500">{suffix}</span>}
          {delta !== undefined && delta !== 0 && (
            <span className={`text-[11px] font-medium ${delta > 0 ? "text-rose-300" : "text-emerald-300"}`}>
              {delta > 0 ? "▲" : "▼"} {Math.abs(delta).toFixed(1)}% MoM
            </span>
          )}
        </div>
        <p className="mt-1.5 text-[11px] leading-relaxed text-slate-400">{caption}</p>
        {footer && <div className="mt-3">{footer}</div>}
      </div>
    </div>
  );
}
