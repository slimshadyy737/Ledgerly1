"use client";

/** Subscriptions — the full contract register with renewals and health. */
import { useMemo, useState } from "react";
import { CalendarClock, CircleDollarSign, HeartPulse, History } from "lucide-react";
import { useLedgerData } from "@/components/ledgerly/data";
import { InventoryTable } from "@/components/ledgerly/inventory-table";
import { MetricCard } from "@/components/ledgerly/metric-card";
import { VendorDrawer } from "@/components/ledgerly/vendor-drawer";
import {
  Card,
  CardHeader,
  Chip,
  DemoBadge,
  EmptyState,
  PageHeader,
  SegmentedControl,
  Skeleton,
  StatusBadge,
  formatUsd,
} from "@/components/ledgerly/ui";

type StatusFilter = "all" | "active" | "paused" | "cancelled" | "consolidated";

export function SubscriptionsPage() {
  const { analytics, inventory, metrics, loading } = useLedgerData();
  const [status, setStatus] = useState<StatusFilter>("all");
  const [vendorId, setVendorId] = useState<number | null>(null);

  const rows = useMemo(
    () => (status === "all" ? inventory : inventory.filter((row) => row.status === status)),
    [inventory, status],
  );

  if (loading || !analytics || !metrics) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  const renewals = analytics.upcomingRenewals;
  const renewingSoon = renewals.filter((renewal) => renewal.daysUntilRenewal <= 30);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Subscriptions"
        subtitle="Every software contract on file with seat counts, costs, utilization, health score and renewal dates."
        meta={
          <>
            <DemoBadge />
            <Chip tone="neutral">{analytics.estate.subscriptionsActive} active</Chip>
            <Chip tone="neutral">{analytics.estate.subscriptionsCancelled} cancelled</Chip>
            <Chip tone="neutral">{analytics.estate.subscriptionsConsolidated} consolidated</Chip>
          </>
        }
        actions={
          <SegmentedControl<StatusFilter>
            ariaLabel="Filter by contract status"
            value={status}
            onChange={setStatus}
            options={[
              { value: "all", label: "All" },
              { value: "active", label: "Active" },
              { value: "paused", label: "Paused" },
              { value: "cancelled", label: "Cancelled" },
              { value: "consolidated", label: "Consolidated" },
            ]}
          />
        }
      />

      <section className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Active contracts"
          value={String(metrics.activeSubscriptions)}
          explanation="Contracts with status 'active' — these drive the spend and waste totals."
          caption={`${metrics.retiredSubscriptions} retired through optimisation`}
          progress={{ value: (metrics.activeSubscriptions / Math.max(analytics.estate.subscriptionsTotal, 1)) * 100, label: "Active share" }}
        />
        <MetricCard
          label="Contracted spend"
          value={formatUsd(metrics.monthlySpendCents)}
          explanation="Monthly recurring cost across active contracts."
          caption={`${formatUsd(metrics.annualizedSpendCents)} committed annually`}
          progress={{ value: 100 - metrics.wasteRatePct, tone: "brand", label: "Proportion with confirmed usage" }}
        />
        <MetricCard
          label="Renewing within 30 days"
          value={String(renewingSoon.length)}
          explanation="Contracts whose renewal date falls inside 30 days. Act before the date or the current terms roll over."
          caption={renewingSoon.map((renewal) => renewal.vendorName).slice(0, 3).join(" · ") || "Nothing renews inside 30 days"}
          progress={{ value: renewals.length > 0 ? (renewingSoon.length / renewals.length) * 100 : 0, tone: "warn", label: "Renewals inside 30 days" }}
        />
        <MetricCard
          label="Average health score"
          value={String(metrics.averageHealthScore)}
          unit="/100"
          explanation="Mean optimisation health across active contracts: adoption, stale seats, duplicate categories and zombie status."
          caption={`${inventory.filter((row) => row.healthScore < 55).length} contracts below 55`}
          progress={{ value: metrics.averageHealthScore, tone: metrics.averageHealthScore >= 70 ? "brand" : "warn", label: "Estate health" }}
        />
      </section>

      <InventoryTable
        rows={rows}
        title="Contract register"
        subtitle={`${rows.length} contract${rows.length === 1 ? "" : "s"} shown · click a vendor name for the full profile and seat register`}
        defaultPageSize={15}
        pageSizeOptions={[15, 30, 60]}
        onOpenVendor={setVendorId}
      />

      <section className="grid grid-cols-1 gap-3.5 xl:grid-cols-2">
        <Card>
          <CardHeader
            icon={<CalendarClock size={14} strokeWidth={1.9} />}
            title="Renewal calendar"
            subtitle="Next 45 days of contract renewals"
            dense
          />
          {renewals.length === 0 ? (
            <EmptyState compact title="No renewals in the next 45 days" description="Ledgerly will surface contracts as their renewal dates approach." />
          ) : (
            <ul className="divide-y divide-[var(--line)]">
              {renewals.map((renewal) => (
                <li key={renewal.subscriptionId} className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-[12.5px] text-ink">{renewal.vendorName}</p>
                    <p className="num text-[10.5px] text-ink-3">
                      {new Date(renewal.nextRenewalAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} ·{" "}
                      {renewal.categoryGroup}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="num text-[12px] text-ink">{renewal.monthlyDisplay}</span>
                    <StatusBadge tone={renewal.daysUntilRenewal <= 14 ? "crit" : renewal.daysUntilRenewal <= 30 ? "warn" : "neutral"} pulse={renewal.daysUntilRenewal <= 14}>
                      {renewal.daysUntilRenewal}d
                    </StatusBadge>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader icon={<History size={14} strokeWidth={1.9} />} title="Contract lifecycle notes" subtitle="How Ledgerly treats each status" />
          <div className="space-y-3 p-3.5">
            <Note icon={<CircleDollarSign size={13} strokeWidth={2} />} title="Active">
              Counted in spend, waste and renewal calculations. Seat-priced contracts are measured against the activity window.
            </Note>
            <Note icon={<HeartPulse size={13} strokeWidth={2} />} title="Paused">
              Still on file but excluded from spend; useful for a temporary suspension during review.
            </Note>
            <Note icon={<CircleDollarSign size={13} strokeWidth={2} />} title="Cancelled & consolidated">
              Recurring cost is set to zero and every seat is revoked. The contract stays visible for reporting history, and the
              released spend is counted as realized savings rather than potential savings.
            </Note>
          </div>
        </Card>
      </section>

      {rows.length === 0 && (
        <Card>
          <EmptyState
            title={`No ${status} contracts`}
            description="Switch the status filter to see the rest of the register."
          />
        </Card>
      )}

      <VendorDrawer vendorId={vendorId} onClose={() => setVendorId(null)} />
    </div>
  );
}

function Note({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-line bg-surface-2/50 p-2.5">
      <span className="mt-0.5 text-ink-3">{icon}</span>
      <div>
        <p className="text-[12px] font-medium text-ink">{title}</p>
        <p className="mt-0.5 text-[11.5px] leading-relaxed text-ink-2">{children}</p>
      </div>
    </div>
  );
}
