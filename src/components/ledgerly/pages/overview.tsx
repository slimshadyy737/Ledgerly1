"use client";

/**
 * Overview — the CFO landing page: context, financial KPIs, the spend
 * intelligence chart, detected opportunities, the inventory table and
 * secondary insights. All values are derived from the sandbox backend.
 */
import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  BadgeCheck,
  Coins,
  Download,
  Gauge,
  Layers,
  PiggyBank,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  TriangleAlert,
  Wallet,
} from "lucide-react";
import { useLedgerData } from "@/components/ledgerly/data";
import { useShell } from "@/components/ledgerly/app-shell";
import { MetricCard } from "@/components/ledgerly/metric-card";
import { OpportunityItem, useOpportunityWorkflow } from "@/components/ledgerly/opportunity";
import { InventoryTable } from "@/components/ledgerly/inventory-table";
import { VendorDrawer } from "@/components/ledgerly/vendor-drawer";
import { CategorySpendChart, ConcentrationDonut, SpendTrendChart } from "@/components/ledgerly/charts";
import { useChartPalette } from "@/lib/ledgerly/theme";
import { concentration, kindLabel, severityTheme } from "@/lib/ledgerly/derive";
import {
  Button,
  Card,
  CardHeader,
  Chip,
  DemoBadge,
  EmptyState,
  InfoHint,
  PageHeader,
  ProgressBar,
  Skeleton,
  StatusBadge,
  Tooltip,
  formatUsd,
} from "@/components/ledgerly/ui";

export function OverviewPage() {
  const {
    analytics,
    sandbox,
    metrics,
    trend,
    inventory,
    audit,
    activeOpportunities,
    opportunities,
    loading,
    refreshing,
    integrity,
    refresh,
    lastSyncedAt,
    tenant,
  } = useLedgerData();
  const { trendMonths } = useShell();
  const palette = useChartPalette();
  const workflow = useOpportunityWorkflow();
  const [vendorId, setVendorId] = useState<number | null>(null);

  const spendTrendValues = useMemo(() => trend.map((point) => point.totalCents), [trend]);
  const wasteTrendValues = useMemo(
    () => trend.map((point) => point.totalCents - point.seatCents),
    [trend],
  );

  if (loading || !analytics || !metrics) {
    return <OverviewSkeleton />;
  }

  /* Real month-over-month comparison — only shown because statement history exists. */
  const comparison =
    trend.length >= 2
      ? (() => {
          const current = trend[trend.length - 1].totalCents;
          const previous = trend[trend.length - 2].totalCents;
          if (previous === 0) return null;
          const delta = ((current - previous) / previous) * 100;
          return {
            value: `${delta >= 0 ? "+" : "−"}${Math.abs(delta).toFixed(1)}%`,
            direction: (delta >= 0 ? "up" : "down") as "up" | "down",
            favourable: delta <= 0,
            label: `vs ${trend[trend.length - 2].label}`,
          };
        })()
      : null;

  const periodLabel = sandbox?.spendTrend.at(-1)?.period ?? analytics.generatedAt.slice(0, 7);
  const focusCategories = concentration(analytics);
  const topOpportunities = activeOpportunities.slice(0, 5);

  return (
    <div className="space-y-5">
      {/* A. welcome + context -------------------------------------------------- */}
      <PageHeader
        title="Spend intelligence"
        subtitle="Every subscription accounted for. Every opportunity quantified. Ledgerly reconciles the corporate card against real login activity from your identity provider."
        meta={
          <>
            <DemoBadge />
            <Chip tone="neutral">Reporting period · {periodLabel}</Chip>
            <Chip tone="neutral">{tenant?.name ?? analytics.company.name}</Chip>
            <Chip tone="neutral">
              Windows · {analytics.windows.staleLicenseDays}d ghost / {analytics.windows.activeSeatDays}d zombie
            </Chip>
            <Tooltip
              content={
                <>
                  <span className="block font-semibold text-ink">Savings integrity check</span>
                  Opportunity savings are attributed exactly once and must equal the engine&apos;s waste figure.
                  {integrity.balanced
                    ? ` Verified: ${formatUsd(metrics.identifiedSavingsCents)} identified = ${formatUsd(analytics.totalWaste.monthlyCents)} engine waste.`
                    : ` Mismatch of ${formatUsd(integrity.deltaCents)} detected — values may still be recalculating.`}
                </>
              }
            >
              {integrity.balanced ? (
                <StatusBadge tone="brand" icon={<BadgeCheck size={10} strokeWidth={2.4} />}>
                  Savings accounted once
                </StatusBadge>
              ) : (
                <StatusBadge tone="crit" icon={<TriangleAlert size={10} strokeWidth={2.4} />}>
                  Recalculating
                </StatusBadge>
              )}
            </Tooltip>
          </>
        }
        actions={
          <>
            <Button
              tone="neutral"
              icon={<RefreshCw size={13} strokeWidth={2} />}
              busy={refreshing}
              onClick={() => void refresh()}
            >
              Re-sync
            </Button>
            <Link
              href="/reports"
              className="focus-ring inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-[color:var(--brand-ink)] transition-[filter] hover:brightness-110"
            >
              <Download size={13} strokeWidth={2} />
              Savings report
            </Link>
          </>
        }
      />

      {lastSyncedAt && (
        <p className="text-[11px] text-ink-3">
          Calculated {lastSyncedAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" })} from{" "}
          <span className="font-mono">/api/analytics</span> · {analytics.estate.subscriptionsTotal} contracts on file ·{" "}
          {metrics.seatsPaid} paid seats
        </p>
      )}

      {/* B. financial KPIs ---------------------------------------------------- */}
      <section aria-label="Financial key metrics" className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Total monthly SaaS spend"
          value={formatUsd(metrics.monthlySpendCents)}
          explanation="Sum of every active subscription's recurring monthly cost, normalised from the sandbox contract register (per-seat invoices are seats × unit cost)."
          caption={`${formatUsd(metrics.annualizedSpendCents)} annualised across ${metrics.activeSubscriptions} active contracts`}
          comparison={comparison}
          trend={spendTrendValues}
          footer={
            <p className="flex items-center gap-1.5 text-[11px] text-ink-3">
              <Wallet size={12} strokeWidth={2} /> {metrics.activeSubscriptions} active · {metrics.retiredSubscriptions} retired this cycle
            </p>
          }
        />
        <MetricCard
          label="Potential monthly savings"
          value={formatUsd(metrics.identifiedSavingsCents)}
          explanation="Waste identified by the four detectors: unused licences beyond the inactivity window, former-employee licences, zombie subscriptions and duplicate category spend. Each dollar is attributed to exactly one opportunity."
          caption={`${formatUsd(metrics.identifiedSavingsAnnualCents)} annualised · ${metrics.openOpportunityCount} actionable findings`}
          progress={{
            value: metrics.wasteRatePct,
            tone: "crit",
            label: "Share of spend identified as waste",
          }}
          emphasis
          footer={
            <div className="flex flex-wrap items-center gap-1.5">
              <Chip tone="crit">{metrics.ghostSeats} unused seats</Chip>
              <Chip tone="crit">{metrics.zombieTools} zombie tools</Chip>
              <Chip tone="info">{metrics.overlappingVendors} overlaps</Chip>
              <Chip tone="warn">{metrics.idleSeats} idle seats</Chip>
            </div>
          }
        />
        <MetricCard
          label="Active subscriptions"
          value={String(metrics.activeSubscriptions)}
          unit="contracts"
          explanation="Contracts with status 'active' in the register. Cancelled and consolidated contracts are excluded from spend and waste totals."
          caption={`${metrics.seatsPaid} paid seats provisioned · ${metrics.unattachedSeats} not attached to an active user`}
          trend={spendTrendValues}
          trendTone="info"
          footer={
            <p className="flex items-center gap-1.5 text-[11px] text-ink-3">
              <Layers size={12} strokeWidth={2} /> {analytics.duplicateCategories.length} categories carry more than one vendor
            </p>
          }
        />
        <MetricCard
          label="Seat utilization"
          value={`${metrics.seatUtilizationPct.toFixed(0)}%`}
          explanation="Active seats divided by paid seats across seat-priced contracts. A seat is active when its holder logged in within the activity window."
          caption={`${metrics.activeSeats} of ${metrics.seatsPaid} seats in use · estate health ${metrics.averageHealthScore}/100`}
          progress={{ value: metrics.seatUtilizationPct, tone: metrics.seatUtilizationPct >= 80 ? "brand" : "warn", label: "Seat utilization" }}
          footer={
            <p className="flex items-center gap-1.5 text-[11px] text-ink-3">
              <Gauge size={12} strokeWidth={2} /> {formatUsd(metrics.realizedSavingsCents)}/mo already recovered
            </p>
          }
        />
      </section>

      {/* C. spend intelligence chart ----------------------------------------- */}
      <section className="grid grid-cols-1 gap-3.5 xl:grid-cols-[1.55fr_1fr]">
        <Card>
          <CardHeader
            icon={<Sparkles size={14} strokeWidth={1.9} />}
            title="Spend intelligence"
            subtitle={`Monthly SaaS expenditure from the sandbox statement — last ${trendMonths} statements, split by seat licences and usage billing`}
            action={
              <div className="flex items-center gap-2">
                <StatusBadge tone="neutral">{trend.length} periods</StatusBadge>
                <InfoHint>
                  Values come from the seeded corporate-card statement. The dashed reference line is the average of the
                  displayed periods — Ledgerly does not forecast without supporting data.
                </InfoHint>
              </div>
            }
          />
          <div className="p-3.5">
            <SpendTrendChart points={trend.slice(-trendMonths)} />
            <dl className="mt-3 grid grid-cols-2 gap-3 border-t border-line pt-3 sm:grid-cols-4">
              <ChartStat label="Latest month" value={formatUsd(spendTrendValues.at(-1) ?? 0)} />
              <ChartStat
                label="Period average"
                value={formatUsd(spendTrendValues.length > 0 ? spendTrendValues.reduce((a, b) => a + b, 0) / spendTrendValues.length : 0)}
              />
              <ChartStat label="Usage-billed share" value={`${usageShare(trend)}%`} />
              <ChartStat label="Changes monthly" value={`${wasteTrendValues.filter((value) => value > 0).length} bills`} />
            </dl>
          </div>
        </Card>

        <Card>
          <CardHeader
            icon={<PiggyBank size={14} strokeWidth={1.9} />}
            title="Spend concentration"
            subtitle="Where the money sits across normalised categories"
          />
          <div className="p-3.5">
            <ConcentrationDonut
              slices={focusCategories.categories.slice(0, 6).map((slice) => ({ label: slice.categoryGroup, value: slice.monthlyCents }))}
              totalCents={focusCategories.totalCents}
              height={214}
            />
            <dl className="mt-3 space-y-1.5 border-t border-line pt-3">
              <Row label="Top 3 categories" value={`${focusCategories.top3SharePct.toFixed(0)}% of spend`} />
              <Row label="Largest category" value={focusCategories.largestCategory?.categoryGroup ?? "—"} />
              <Row label="Vendors in that category" value={String(focusCategories.largestCategory?.vendorCount ?? 0)} />
              <Row label="Categories with overlaps" value={String(analytics.duplicateCategories.length)} />
            </dl>
          </div>
        </Card>
      </section>

      {/* D. opportunities detected ------------------------------------------- */}
      <Card>
        <CardHeader
          icon={<ShieldAlert size={14} strokeWidth={1.9} />}
          title="Opportunities detected"
          subtitle={`${activeOpportunities.length} actionable findings · ${formatUsd(metrics.identifiedSavingsCents)}/month · sorted by financial impact`}
          action={
            <Link href="/optimization" className="focus-ring inline-flex items-center gap-1 rounded-md text-[11.5px] font-medium text-brand">
              Open optimization center <ArrowUpRight size={12} strokeWidth={2.2} />
            </Link>
          }
        />
        <div className="space-y-2.5 p-3.5">
          {topOpportunities.map((opportunity) => (
            <OpportunityItem key={opportunity.id} opportunity={opportunity} onOpenVendor={setVendorId} />
          ))}
          {topOpportunities.length === 0 && (
            <EmptyState
              compact
              icon={<BadgeCheck size={18} strokeWidth={1.8} />}
              title="Nothing to action right now"
              description="Every billed licence is attached to a user who logged in inside the activity window."
            />
          )}
        </div>
        {activeOpportunities.length > topOpportunities.length && (
          <p className="border-t border-line px-3.5 py-2.5 text-[11px] text-ink-3">
            {activeOpportunities.length - topOpportunities.length} further findings are queued in the optimization center
            {opportunities.length > activeOpportunities.length ? ` · ${opportunities.length - activeOpportunities.length} dismissed locally` : ""}.
          </p>
        )}
      </Card>

      {/* E. inventory -------------------------------------------------------- */}
      <InventoryTable rows={inventory} onOpenVendor={setVendorId} />

      {/* F. secondary insights ----------------------------------------------- */}
      <section className="grid grid-cols-1 gap-3.5 xl:grid-cols-3">
        <Card>
          <CardHeader title="Category breakdown" subtitle="Monthly spend and overlapping tool count" dense />
          <div className="p-3.5">
            <CategorySpendChart slices={analytics.categorySpend.slice(0, 6)} height={220} />
          </div>
        </Card>

        <Card>
          <CardHeader title="Top spending vendors" subtitle="Cost versus identified waste" dense />
          <ul className="divide-y divide-[var(--line)]">
            {analytics.topWasteOffenders.slice(0, 6).map((offender) => (
              <li key={offender.subscriptionId}>
                <button
                  type="button"
                  onClick={() => setVendorId(offender.subscriptionId)}
                  className="focus-ring flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition-colors hover:bg-surface-2/50"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] font-medium text-ink">{offender.vendorName}</span>
                    <span className="num block text-[10.5px] text-ink-3">
                      {offender.activeSeats}/{offender.seatsPaid} seats · {offender.categoryGroup}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="num block text-[12px] font-medium text-ink">{offender.monthlyDisplay}</span>
                    <span className="num block text-[10.5px] text-crit">−{offender.wasteDisplay}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Card>

        <Card>
          <CardHeader title="Recent activity" subtitle="Simulated write-backs and detector alerts" dense />
          <ul className="divide-y divide-[var(--line)]">
            {audit.slice(0, 4).map((event) => (
              <li key={event.id} className="flex items-start gap-2.5 px-3.5 py-2.5">
                <span className="mt-0.5 text-brand">
                  <Sparkles size={13} strokeWidth={2} />
                </span>
                <span className="min-w-0">
                  <span className="block text-[12px] text-ink">
                    {event.action.replace(/_/g, " ")} · {event.vendorName}
                  </span>
                  <span className="num block text-[10.5px] text-ink-3">
                    {event.savingsDisplay}/mo · {new Date(event.createdAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                  </span>
                </span>
              </li>
            ))}
            {activeOpportunities.slice(0, Math.max(0, 5 - audit.length)).map((item) => {
              const theme = severityTheme(item.severity);
              return (
                <li key={item.id} className="flex items-start gap-2.5 px-3.5 py-2.5">
                  <span className={`mt-0.5 ${theme.text}`}>
                    <Coins size={13} strokeWidth={2} />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[12px] text-ink">{kindLabel(item.kind)} detected · {item.vendor}</span>
                    <span className="num block text-[10.5px] text-ink-3">
                      {formatUsd(item.monthlyCents)}/mo · {item.seatsAffected} seats
                    </span>
                  </span>
                </li>
              );
            })}
            {audit.length === 0 && activeOpportunities.length === 0 && (
              <li className="px-3.5 py-4 text-[11.5px] text-ink-3">No activity recorded in this session.</li>
            )}
          </ul>
        </Card>
      </section>

      {workflow.dialog}
      <VendorDrawer vendorId={vendorId} onClose={() => setVendorId(null)} />
    </div>
  );
}

function usageShare(trend: { totalCents: number; usageCents: number }[]) {
  const total = trend.reduce((sum, point) => sum + point.totalCents, 0);
  const usage = trend.reduce((sum, point) => sum + point.usageCents, 0);
  return total > 0 ? ((usage / total) * 100).toFixed(0) : "0";
}

function ChartStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="label-xs">{label}</dt>
      <dd className="num mt-0.5 text-[13px] font-medium text-ink">{value}</dd>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2 text-[11.5px]">
      <dt className="text-ink-3">{label}</dt>
      <dd className="num truncate text-ink">{value}</dd>
    </div>
  );
}

function OverviewSkeleton() {
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Skeleton className="h-6 w-56" />
        <Skeleton className="h-4 w-full max-w-2xl" />
        <Skeleton className="h-5 w-72" />
      </div>
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-36 w-full" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-3.5 xl:grid-cols-[1.55fr_1fr]">
        <Skeleton className="h-[360px] w-full" />
        <Skeleton className="h-[360px] w-full" />
      </div>
      <Skeleton className="h-64 w-full" />
    </div>
  );
}
