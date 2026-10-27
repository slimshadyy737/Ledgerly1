"use client";

/** Spend Analytics — category spend, vendor contribution, trend and concentration. */
import { useState } from "react";
import { BarChart3, Building2, Layers, Percent, TrendingUp } from "lucide-react";
import { useLedgerData } from "@/components/ledgerly/data";
import { CategorySpendChart, SpendTrendChart, VendorContributionChart } from "@/components/ledgerly/charts";
import { MetricCard } from "@/components/ledgerly/metric-card";
import { VendorDrawer } from "@/components/ledgerly/vendor-drawer";
import { concentration } from "@/lib/ledgerly/derive";
import {
  Card,
  CardHeader,
  Chip,
  DemoBadge,
  PageHeader,
  ProgressBar,
  Skeleton,
  StatusBadge,
  formatUsd,
} from "@/components/ledgerly/ui";

export function AnalyticsPage() {
  const { analytics, metrics, trend, inventory, loading } = useLedgerData();
  const [vendorId, setVendorId] = useState<number | null>(null);

  if (loading || !analytics || !metrics) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-7 w-52" />
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-32 w-full" />
          ))}
        </div>
        <Skeleton className="h-80 w-full" />
      </div>
    );
  }

  const focus = concentration(analytics);
  const previousMonth = trend.at(-2);
  const latestMonth = trend.at(-1);
  const monthDelta =
    previousMonth && latestMonth && previousMonth.totalCents > 0
      ? ((latestMonth.totalCents - previousMonth.totalCents) / previousMonth.totalCents) * 100
      : null;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Spend analytics"
        subtitle="Category-level spend, vendor contribution, monthly movement and concentration — the analytical view behind the optimization queue."
        meta={
          <>
            <DemoBadge />
            <Chip tone="neutral">{analytics.categorySpend.length} categories</Chip>
            <Chip tone="neutral">{analytics.estate.subscriptionsActive} active contracts</Chip>
            <Chip tone="neutral">{trend.length} statement periods</Chip>
          </>
        }
      />

      <section className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Monthly spend"
          value={formatUsd(metrics.monthlySpendCents)}
          explanation="Total recurring monthly cost of active subscriptions in the register."
          caption={`${formatUsd(metrics.annualizedSpendCents)} annualised`}
          trend={trend.map((point) => point.totalCents)}
          comparison={
            monthDelta === null
              ? null
              : {
                  value: `${monthDelta >= 0 ? "+" : "−"}${Math.abs(monthDelta).toFixed(1)}%`,
                  direction: monthDelta >= 0 ? "up" : "down",
                  favourable: monthDelta <= 0,
                  label: `statement ${latestMonth?.label} vs ${previousMonth?.label}`,
                }
          }
        />
        <MetricCard
          label="Top 3 concentration"
          value={`${focus.top3SharePct.toFixed(0)}%`}
          explanation="Share of total spend held by the three largest software categories. High concentration means fewer contracts carry most of the risk."
          caption={`${focus.categories.slice(0, 3).map((slice) => slice.categoryGroup).join(" · ") || "—"}`}
          progress={{ value: focus.top3SharePct, tone: focus.top3SharePct > 60 ? "warn" : "brand", label: "Top 3 concentration" }}
        />
        <MetricCard
          label="Usage-billed share"
          value={`${usageSharePct(trend)}%`}
          explanation="Portion of spend billed on consumption (cloud, observability) rather than seats — these contracts have no seat telemetry and are monitored for spend drift instead."
          caption="Seat licences make up the remainder"
          trend={trend.map((point) => point.usageCents)}
          trendTone="info"
        />
        <MetricCard
          label="Identified waste"
          value={formatUsd(metrics.identifiedSavingsCents)}
          explanation="Waste attributed across the detectors, counted once per dollar."
          caption={`${metrics.wasteRatePct.toFixed(1)}% of spend · ${metrics.openOpportunityCount} findings`}
          progress={{ value: metrics.wasteRatePct, tone: "crit", label: "Waste rate" }}
          emphasis
        />
      </section>

      <section className="grid grid-cols-1 gap-3.5 xl:grid-cols-2">
        <Card>
          <CardHeader
            icon={<BarChart3 size={14} strokeWidth={1.9} />}
            title="Spend by category"
            subtitle="Normalised category groups, largest first"
          />
          <div className="p-3.5">
            <CategorySpendChart slices={analytics.categorySpend} height={330} max={9} />
          </div>
        </Card>

        <Card>
          <CardHeader
            icon={<TrendingUp size={14} strokeWidth={1.9} />}
            title="Monthly expenditure"
            subtitle="Seat licences versus usage-billed spend from the sandbox statement"
          />
          <div className="p-3.5">
            <SpendTrendChart points={trend} height={330} />
          </div>
        </Card>
      </section>

      <Card>
        <CardHeader
          icon={<Building2 size={14} strokeWidth={1.9} />}
          title="Vendor contribution"
          subtitle="Largest vendors by monthly cost with identified waste overlaid — click a bar label to open the vendor list"
        />
        <div className="p-3.5">
          <VendorContributionChart
            rows={inventory.map((row) => ({ vendor: row.vendor, monthlyCostCents: row.monthlyCostCents, wasteCents: row.wasteCents }))}
            height={300}
            max={8}
          />
        </div>
      </Card>

      <section className="grid grid-cols-1 gap-3.5 xl:grid-cols-[1.3fr_1fr]">
        <Card>
          <CardHeader icon={<Layers size={14} strokeWidth={1.9} />} title="Category detail" subtitle="Spend, waste and overlap per normalised category" dense />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-left text-[12px]">
              <thead className="border-b border-line bg-surface-2/40 text-[10.5px] uppercase tracking-[0.08em] text-ink-3">
                <tr>
                  <th className="px-3.5 py-2 font-semibold">Category</th>
                  <th className="px-3.5 py-2 text-right font-semibold">Vendors</th>
                  <th className="px-3.5 py-2 text-right font-semibold">Monthly</th>
                  <th className="px-3.5 py-2 text-right font-semibold">Share</th>
                  <th className="px-3.5 py-2 text-right font-semibold">Waste</th>
                  <th className="px-3.5 py-2 font-semibold">Overlap</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--line)]">
                {analytics.categorySpend.map((slice) => (
                  <tr key={slice.categoryGroup} className="transition-colors hover:bg-surface-2/50">
                    <td className="px-3.5 py-2 text-ink">{slice.categoryGroup}</td>
                    <td className="num px-3.5 py-2 text-right text-ink-2">{slice.vendorCount}</td>
                    <td className="num px-3.5 py-2 text-right text-ink">{slice.monthlyDisplay}</td>
                    <td className="px-3.5 py-2">
                      <div className="flex items-center justify-end gap-2">
                        <span className="num w-10 text-right text-ink-2">{slice.sharePct.toFixed(1)}%</span>
                        <span className="w-16">
                          <ProgressBar value={slice.sharePct} tone="info" height={4} label={`${slice.categoryGroup} share`} />
                        </span>
                      </div>
                    </td>
                    <td className="num px-3.5 py-2 text-right text-crit">{slice.wasteCents > 0 ? formatUsd(slice.wasteCents) : "—"}</td>
                    <td className="px-3.5 py-2">
                      {slice.overlappingVendorCount > 1 ? (
                        <StatusBadge tone="info">{slice.overlappingVendorCount} tools</StatusBadge>
                      ) : (
                        <span className="text-[11px] text-ink-3">single tool</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card>
          <CardHeader
            icon={<Percent size={14} strokeWidth={1.9} />}
            title="Monthly movement"
            subtitle="Statement totals with the seat/usage split"
            dense
          />
          <ul className="divide-y divide-[var(--line)]">
            {[...trend].reverse().map((point) => (
              <li key={point.period} className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                <div>
                  <p className="text-[12px] text-ink">
                    {point.label} <span className="num text-[10.5px] text-ink-3">{point.period}</span>
                  </p>
                  <p className="num text-[10.5px] text-ink-3">
                    seats {formatUsd(point.seatCents)} · usage {formatUsd(point.usageCents)}
                  </p>
                </div>
                <p className="num text-[12.5px] font-medium text-ink">{formatUsd(point.totalCents)}</p>
              </li>
            ))}
            {trend.length === 0 && <li className="px-3.5 py-4 text-[11.5px] text-ink-3">No statement history available.</li>}
          </ul>
        </Card>
      </section>

      <VendorDrawer vendorId={vendorId} onClose={() => setVendorId(null)} />
    </div>
  );
}

function usageSharePct(trend: { totalCents: number; usageCents: number }[]) {
  const total = trend.reduce((sum, point) => sum + point.totalCents, 0);
  const usage = trend.reduce((sum, point) => sum + point.usageCents, 0);
  return total > 0 ? ((usage / total) * 100).toFixed(0) : "0";
}
