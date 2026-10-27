"use client";

import { useMemo, useState } from "react";
import type { ActionRequestPayload, Finding, Snapshot, WasteLedgerRow } from "@/lib/types";
import {
  CATEGORY_COLORS,
  formatDateTime,
  healthColor,
  kindLabel,
  pct,
  relativeDays,
  severityStyle,
  usd,
  usdCompact,
  usdExact,
} from "@/lib/format";
import { AreaChart, Badge, DonutChart, Meter, Panel, Sparkline } from "./ui";

const WASTE_LABEL: Record<WasteLedgerRow["reason"], string> = {
  ghost_seats: "Ghost seats",
  zombie_software: "Zombie software",
  duplicate_tooling: "Duplicate tooling",
  idle_seats: "Idle / unprovisioned",
};

export function OverviewTab({
  snapshot,
  onAction,
  pendingKey,
}: {
  snapshot: Snapshot;
  onAction: (payload: ActionRequestPayload) => void;
  pendingKey: string | null;
}) {
  const { metrics, findings, history, inventory, wasteLedger, categorySpend, spendTrend } = snapshot;

  const [filter, setFilter] = useState<"all" | Finding["kind"]>("all");

  const visibleFindings = useMemo(
    () => (filter === "all" ? findings : findings.filter((f) => f.kind === filter)),
    [findings, filter],
  );

  const donutSlices = categorySpend.slice(0, 7).map((slice, i) => ({
    label: slice.categoryGroup,
    value: slice.monthlyCents,
    color: CATEGORY_COLORS[i % CATEGORY_COLORS.length],
  }));

  const watchlist = [...inventory].sort((a, b) => a.healthScore - b.healthScore).slice(0, 6);

  const wasteByReason = (["zombie_software", "duplicate_tooling", "ghost_seats", "idle_seats"] as const).map(
    (reason) => ({
      reason,
      cents: wasteLedger.filter((w) => w.reason === reason).reduce((sum, w) => sum + w.monthlyCents, 0),
    }),
  );
  const provenWaste =
    wasteLedger
      .filter((w) => w.reason !== "duplicate_tooling")
      .reduce((sum, w) => sum + w.monthlyCents, 0);

  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
      {/* ---------------------------- action feed --------------------------- */}
      <div className="space-y-5 xl:col-span-2">
        <Panel
          title="Optimisation queue"
          subtitle={`${findings.length} open action item${findings.length === 1 ? "" : "s"} · ${usd(metrics.recoverableCents)}/month recoverable · sorted by impact`}
          action={
            <div className="flex flex-wrap gap-1.5">
              {(["all", "ghost_seats", "zombie_software", "overlap_duplication", "idle_seats", "shadow_it"] as const).map(
                (kind) => {
                  const count = kind === "all" ? findings.length : findings.filter((f) => f.kind === kind).length;
                  return (
                    <button
                      key={kind}
                      onClick={() => setFilter(kind)}
                      className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition ${
                        filter === kind
                          ? "bg-emerald-500/20 text-emerald-300 ring-1 ring-inset ring-emerald-500/40"
                          : "text-slate-400 hover:bg-slate-800/60 hover:text-slate-200"
                      }`}
                    >
                      {kind === "all" ? "All" : kindLabel(kind)} · {count}
                    </button>
                  );
                },
              )}
            </div>
          }
        >
          <div className="max-h-[720px] space-y-3 overflow-y-auto p-4">
            {visibleFindings.length === 0 && (
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-6 text-center">
                <p className="text-sm font-medium text-emerald-300">🎉 No open findings in this category</p>
                <p className="mt-1 text-xs text-slate-400">
                  Every dollar in the stack is attached to an active user. Re-run the ingestion job to simulate the next quarter.
                </p>
              </div>
            )}
            {visibleFindings.map((finding) => {
              const style = severityStyle(finding.severity);
              // Aligned with DashboardApp.runAction(): `${vendorId}:${actionType}`
              const isPending = pendingKey === `${finding.vendorId}:${finding.actionType}`;
              const alreadyResolved = finding.actionType === "review_contract";

              return (
                <article
                  key={finding.id}
                  className={`rounded-xl border border-slate-800 bg-slate-950/50 p-4 border-l-4 ${style.border} transition hover:border-slate-700`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${style.chip}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
                        {kindLabel(finding.kind)}
                      </span>
                      <Badge tone={finding.severity === "critical" ? "rose" : finding.severity === "high" ? "amber" : "slate"}>
                        {finding.severity}
                      </Badge>
                      <span className="text-[11px] text-slate-500">
                        {finding.category} · confidence {(finding.confidence * 100).toFixed(0)}%
                      </span>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold tabular-nums text-emerald-300">
                        {finding.impactCents > 0 ? `+${usd(finding.impactCents)}/mo` : "risk only"}
                      </p>
                      {finding.impactCents > 0 && (
                        <p className="text-[11px] text-slate-500 tabular-nums">{usdCompact(finding.impactCents * 12)}/yr</p>
                      )}
                    </div>
                  </div>

                  <h3 className="mt-3 text-sm font-semibold text-slate-100">{finding.title}</h3>
                  <p className="mt-1 text-xs leading-relaxed text-slate-400">{finding.detail}</p>

                  {finding.evidence.length > 0 && (
                    <details className="group mt-3">
                      <summary className="cursor-pointer list-none text-[11px] font-medium text-slate-400 transition hover:text-slate-200">
                        <span className="inline-block transition group-open:rotate-90">▸</span> Show {finding.evidence.length} seat
                        record{finding.evidence.length === 1 ? "" : "s"} behind this alert
                      </summary>
                      <div className="mt-2 overflow-hidden rounded-lg border border-slate-800">
                        <table className="w-full text-left text-[11px]">
                          <thead className="bg-slate-900/70 text-slate-400">
                            <tr>
                              <th className="px-3 py-1.5 font-medium">Employee</th>
                              <th className="px-3 py-1.5 font-medium">Dept</th>
                              <th className="px-3 py-1.5 font-medium">HR status</th>
                              <th className="px-3 py-1.5 font-medium">Last SSO login</th>
                              <th className="px-3 py-1.5 font-medium text-right">Seat cost</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-800/70">
                            {finding.evidence.slice(0, 8).map((seat) => (
                              <tr key={seat.employeeEmail} className="text-slate-300">
                                <td className="px-3 py-1.5">
                                  <span className="block text-slate-200">{seat.employeeName}</span>
                                  <span className="text-slate-500">{seat.employeeEmail}</span>
                                </td>
                                <td className="px-3 py-1.5 text-slate-400">{seat.department}</td>
                                <td className="px-3 py-1.5">
                                  {seat.employeeStatus === "offboarded" ? (
                                    <Badge tone="rose">offboarded</Badge>
                                  ) : (
                                    <Badge tone="emerald">active</Badge>
                                  )}
                                </td>
                                <td className="px-3 py-1.5 text-slate-400">
                                  {relativeDays(seat.daysSinceLogin)}
                                  {seat.loginsLast30d === 0 && <span className="ml-1 text-rose-400">· 0 logins/30d</span>}
                                </td>
                                <td className="px-3 py-1.5 text-right tabular-nums text-slate-300">
                                  {usdExact(seat.seatCostCents)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </details>
                  )}

                  <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                    <p className="font-mono text-[10px] text-slate-500">
                      <span className="text-slate-600">rule:</span> {finding.detectionRule}
                    </p>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => {
                          if (finding.actionType !== "reclaim_seats" && !window.confirm(`${finding.recommendedAction}?`)) return;
                          onAction({
                            vendorId: finding.vendorId ?? 0,
                            actionType: finding.actionType === "review_contract" ? "reclaim_seats" : finding.actionType,
                            seats: finding.seatsAffected,
                            findingKind: finding.kind,
                          });
                        }}
                        disabled={alreadyResolved || isPending || !finding.vendorId}
                        className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                          alreadyResolved || !finding.vendorId
                            ? "cursor-not-allowed bg-slate-800 text-slate-500"
                            : "bg-emerald-500 text-slate-950 hover:bg-emerald-400 disabled:opacity-60"
                        }`}
                      >
                        {isPending
                          ? "Applying…"
                          : finding.actionType === "reclaim_seats"
                            ? finding.kind === "idle_seats"
                              ? `Downgrade ${finding.seatsAffected} seats`
                              : `Reclaim ${finding.seatsAffected} seat${finding.seatsAffected === 1 ? "" : "s"}`
                            : finding.actionType === "consolidate"
                              ? "Consolidate tool"
                              : finding.actionType === "cancel_subscription"
                                ? "Cancel subscription"
                                : "Assign owner"}
                      </button>
                    </div>
                  </div>
                  <p className="mt-2 text-[11px] text-slate-500">➜ {finding.recommendedAction}</p>
                </article>
              );
            })}
          </div>
        </Panel>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          {/* With 6 months of statement history we plot the trend; when the
              backend only exposes the current invoice we show spend by
              category instead of inventing a time series. */}
          {spendTrend.length >= 2 ? (
            <Panel
              title="SaaS spend by month"
              subtitle="Card statement, last 6 periods — dashed line = seat-based portion"
            >
              <div className="p-5">
                <AreaChart
                  points={spendTrend.map((p) => ({ label: p.label, value: p.totalCents, secondary: p.seatCents }))}
                />
                <div className="mt-4 flex items-center justify-between text-[11px] text-slate-400">
                  <span className="flex items-center gap-2">
                    <span className="h-2 w-4 rounded-full bg-emerald-400" /> Total charged
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="h-0.5 w-4 rounded-full bg-blue-400" /> Seat licences
                  </span>
                  <span className="tabular-nums">
                    latest {usd(spendTrend.at(-1)?.totalCents ?? 0)} · annualised{" "}
                    {usdCompact(metrics.annualizedSpendCents)}
                  </span>
                </div>
              </div>
            </Panel>
          ) : (
            <Panel
              title="Monthly spend vs waste by category"
              subtitle="Live contract register — each bar is one normalised category group"
            >
              <div className="space-y-2.5 p-5">
                {categorySpend.slice(0, 7).map((slice, index) => (
                  <div key={slice.categoryGroup}>
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="flex items-center gap-2 text-slate-300">
                        <span
                          className="h-2 w-2 rounded-full"
                          style={{ background: CATEGORY_COLORS[index % CATEGORY_COLORS.length] }}
                        />
                        {slice.categoryGroup}
                        {slice.overlap && <Badge tone="amber">overlap</Badge>}
                      </span>
                      <span className="tabular-nums text-slate-400">
                        {usd(slice.monthlyCents)} · {pct(slice.sharePct, 1)}
                      </span>
                    </div>
                    <div className="mt-1.5">
                      <Meter
                        value={slice.monthlyCents > 0 ? (slice.monthlyCents / metrics.monthlySpendCents) * 100 : 0}
                        color={CATEGORY_COLORS[index % CATEGORY_COLORS.length]}
                        height={5}
                      />
                    </div>
                    {slice.vendorCount > 1 && (
                      <p className="mt-1 text-[10px] text-amber-300/80">
                        {slice.vendorCount} vendors share this category — consolidation candidate
                      </p>
                    )}
                  </div>
                ))}
                <p className="pt-1 text-[11px] text-slate-500">
                  Annualised spend {usdCompact(metrics.annualizedSpendCents)} · {pct(metrics.wasteRatePct, 1)} of it is
                  flagged as waste.
                </p>
              </div>
            </Panel>
          )}

          <Panel title="Spend concentration" subtitle="Normalised category groups (top 7 of 20)">
            <div className="p-5">
              <DonutChart
                slices={donutSlices}
                total={donutSlices.reduce((sum, s) => sum + s.value, 0)}
                centerLabel="per month"
                centerValue={usdCompact(metrics.monthlySpendCents)}
              />
              <div className="mt-4 grid grid-cols-2 gap-2 text-[11px]">
                <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-2.5">
                  <p className="text-slate-500">Categories with duplicate tools</p>
                  <p className="mt-0.5 text-sm font-semibold text-amber-300">
                    {categorySpend.filter((c) => c.overlap).length} of {categorySpend.length}
                  </p>
                </div>
                <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-2.5">
                  <p className="text-slate-500">Recovered via dashboard</p>
                  <p className="mt-0.5 text-sm font-semibold text-emerald-300 tabular-nums">
                    {usd(metrics.recoveredCents)}/mo
                  </p>
                </div>
              </div>
            </div>
          </Panel>
        </div>
      </div>

      {/* ------------------------------ side rail --------------------------- */}
      <div className="space-y-5">
        <Panel title="Waste ledger" subtitle="Every dollar counted exactly once — no double counting">
          <div className="p-4">
            <div className="space-y-3">
              {wasteByReason.map((row) => (
                <div key={row.reason}>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-300">{WASTE_LABEL[row.reason]}</span>
                    <span className="tabular-nums text-slate-400">{usd(row.cents)}/mo</span>
                  </div>
                  <div className="mt-1.5">
                    <Meter
                      value={metrics.recoverableCents > 0 ? (row.cents / metrics.recoverableCents) * 100 : 0}
                      color={row.reason === "zombie_software" ? "#fb7185" : row.reason === "duplicate_tooling" ? "#60a5fa" : "#fbbf24"}
                    />
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-4 space-y-2 rounded-xl border border-slate-800 bg-slate-950/50 p-3 text-[11px]">
              <div className="flex justify-between text-slate-400">
                <span>Proven leakage (dead seats + zombies)</span>
                <span className="tabular-nums text-slate-200">{usd(provenWaste)}/mo</span>
              </div>
              <div className="flex justify-between text-slate-400">
                <span>Consolidation opportunity (overlap)</span>
                <span className="tabular-nums text-slate-200">
                  {usd(metrics.recoverableCents - provenWaste)}/mo
                </span>
              </div>
              <div className="flex justify-between border-t border-slate-800 pt-2 font-semibold text-emerald-300">
                <span>Total identified</span>
                <span className="tabular-nums">{usd(metrics.recoverableCents)}/mo</span>
              </div>
            </div>
          </div>
        </Panel>

        <Panel title="Vendor watchlist" subtitle="Lowest optimisation health score first">
          <ul className="divide-y divide-slate-800/70">
            {watchlist.map((vendor) => (
              <li key={vendor.vendorId} className="flex items-center gap-3 px-4 py-3">
                <span className="text-lg">{vendor.logoEmoji}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-slate-200">{vendor.vendorName}</p>
                  <p className="text-[11px] text-slate-500">
                    {vendor.billingModel === "per_seat"
                      ? `${vendor.activeUsers}/${vendor.seatsPaid} active seats`
                      : vendor.billingModel === "usage"
                        ? "usage-priced"
                        : "flat rate"}{" "}
                    · {usd(vendor.monthlyCostCents)}/mo
                  </p>
                  <div className="mt-1.5">
                    <Meter value={vendor.healthScore} color={healthColor(vendor.healthScore)} height={4} />
                  </div>
                </div>
                <div className="text-right">
                  <p
                    className="text-sm font-semibold tabular-nums"
                    style={{ color: healthColor(vendor.healthScore) }}
                  >
                    {vendor.healthScore}
                  </p>
                  <p className="text-[10px] uppercase tracking-wide text-slate-500">{vendor.healthGrade}</p>
                </div>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title="Decision log" subtitle="Write-backs persisted to optimization_actions">
          {history.length === 0 ? (
            <p className="p-4 text-xs text-slate-400">
              No actions applied yet. Click <span className="text-emerald-300">Reclaim seats</span> on a ghost-seat alert to
              write back to the ledger and watch the KPIs move.
            </p>
          ) : (
            <ol className="max-h-96 space-y-3 overflow-y-auto p-4">
              {history.map((action) => (
                <li key={action.id} className="relative border-l border-emerald-500/40 pl-4">
                  <span className="absolute -left-[5px] top-1.5 h-2.5 w-2.5 rounded-full bg-emerald-400" />
                  <p className="text-xs font-medium text-slate-200">{action.title}</p>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-slate-400">{action.detail}</p>
                  <p className="mt-1 text-[10px] uppercase tracking-wide text-slate-500">
                    {formatDateTime(action.createdAt)} · {action.triggeredBy} · +{usd(action.monthlySavingsCents)}/mo ·{" "}
                    {usdCompact(action.annualizedSavingsCents)}/yr
                  </p>
                </li>
              ))}
            </ol>
          )}
        </Panel>

        <Panel title="Largest line items" subtitle="Where the budget actually goes">
          <ul className="divide-y divide-slate-800/70">
            {inventory.slice(0, 6).map((vendor) => (
              <li key={vendor.vendorId} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs text-slate-200">{vendor.vendorName}</p>
                  <p className="text-[11px] text-slate-500">{vendor.category}</p>
                </div>
                <Sparkline values={vendor.monthsTrend} color={healthColor(vendor.healthScore)} />
                <span className="w-20 text-right text-xs tabular-nums text-slate-300">{usd(vendor.monthlyCostCents)}</span>
              </li>
            ))}
          </ul>
          <p className="border-t border-slate-800/70 px-4 py-3 text-[11px] text-slate-500">
            Seat utilisation across the estate: <span className="text-slate-300">{pct(metrics.seatUtilizationPct, 1)}</span> ·{" "}
            {metrics.activeUsers} of {metrics.seatsPaid} paid seats logged in within 30 days
          </p>
        </Panel>
      </div>
    </div>
  );
}
