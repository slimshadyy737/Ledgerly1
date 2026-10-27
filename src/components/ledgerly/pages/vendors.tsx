"use client";

/** Vendors — profiles with contract facts, seat economics and related findings. */
import { useMemo, useState } from "react";
import { Building2, ExternalLink, Search, Sparkles } from "lucide-react";
import { useLedgerData } from "@/components/ledgerly/data";
import { VendorDrawer } from "@/components/ledgerly/vendor-drawer";
import { healthGrade, kindLabel } from "@/lib/ledgerly/derive";
import {
  Button,
  Card,
  CardHeader,
  Chip,
  DemoBadge,
  EmptyState,
  HealthScore,
  PageHeader,
  ProgressBar,
  SelectInput,
  Skeleton,
  Sparkline,
  StatusBadge,
  TextInput,
  formatUsd,
} from "@/components/ledgerly/ui";

type SortKey = "cost" | "waste" | "health" | "renewal";

export function VendorsPage() {
  const { vendors, opportunities, analytics, loading } = useLedgerData();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [sort, setSort] = useState<SortKey>("cost");
  const [vendorId, setVendorId] = useState<number | null>(null);

  const categories = useMemo(() => [...new Set(vendors.map((vendor) => vendor.categoryGroup))].sort(), [vendors]);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = vendors.filter((vendor) => {
      const matchesQuery =
        needle.length === 0 ||
        vendor.vendor.toLowerCase().includes(needle) ||
        vendor.category.toLowerCase().includes(needle) ||
        vendor.contractOwner.toLowerCase().includes(needle);
      const matchesCategory = category === "all" || vendor.categoryGroup === category;
      return matchesQuery && matchesCategory;
    });
    return [...filtered].sort((a, b) => {
      if (sort === "waste") return b.wasteCents - a.wasteCents;
      if (sort === "health") return a.healthScore - b.healthScore;
      if (sort === "renewal") return (a.renewalInDays ?? 9999) - (b.renewalInDays ?? 9999);
      return b.monthlyCostCents - a.monthlyCostCents;
    });
  }, [vendors, query, category, sort]);

  if (loading || !analytics) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-12 w-full" />
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-56 w-full" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Vendors"
        subtitle="One profile per software vendor: contract terms, seat economics, health score and every finding attached to the account."
        meta={
          <>
            <DemoBadge />
            <Chip tone="neutral">{vendors.length} vendors</Chip>
            <Chip tone="neutral">{categories.length} categories</Chip>
            <Chip tone={vendors.filter((vendor) => vendor.wasteCents > 0).length > 0 ? "crit" : "brand"}>
              {vendors.filter((vendor) => vendor.wasteCents > 0).length} with identified waste
            </Chip>
          </>
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <TextInput
              value={query}
              onChange={setQuery}
              placeholder="Search vendors or owners"
              icon={<Search size={13} strokeWidth={2} />}
              className="w-52"
            />
            <SelectInput
              ariaLabel="Filter by category"
              value={category}
              onChange={setCategory}
              options={[{ value: "all", label: "All categories" }, ...categories.map((item) => ({ value: item, label: item }))]}
            />
            <SelectInput
              ariaLabel="Sort vendors"
              value={sort}
              onChange={(value) => setSort(value as SortKey)}
              options={[
                { value: "cost", label: "Sort: monthly cost" },
                { value: "waste", label: "Sort: identified waste" },
                { value: "health", label: "Sort: worst health" },
                { value: "renewal", label: "Sort: next renewal" },
              ]}
            />
          </div>
        }
      />

      {rows.length === 0 ? (
        <Card>
          <EmptyState icon={<Building2 size={20} strokeWidth={1.8} />} title="No vendors match" description="Adjust the search or category filter." />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((vendor) => {
            const related = opportunities.filter((item) => item.vendorId === vendor.id);
            const savings = related.reduce((sum, item) => sum + item.monthlyCents, 0);
            return (
              <Card key={vendor.id} className="flex flex-col transition-colors hover:border-line-strong">
                <header className="flex items-start justify-between gap-2 border-b border-line p-3.5">
                  <div className="min-w-0">
                    <p className="truncate text-[13.5px] font-semibold text-ink">{vendor.vendor}</p>
                    <p className="truncate text-[11px] text-ink-3">
                      {vendor.product ? `${vendor.product} · ` : ""}
                      {vendor.categoryGroup}
                    </p>
                  </div>
                  <HealthScore score={vendor.healthScore} grade={healthGrade(vendor.healthScore)} compact />
                </header>

                <div className="flex-1 space-y-3 p-3.5">
                  <div className="grid grid-cols-2 gap-2.5">
                    <Fact label="Monthly cost" value={formatUsd(vendor.monthlyCostCents)} />
                    <Fact label="Annualised" value={formatUsd(vendor.annualizedCostCents)} />
                    <Fact
                      label="Seats"
                      value={vendor.billingModel === "per_seat" ? `${vendor.activeSeats}/${vendor.seatsPaid} active` : vendor.billingModel}
                    />
                    <Fact label="Identified waste" value={vendor.wasteCents > 0 ? formatUsd(vendor.wasteCents) : "none"} tone={vendor.wasteCents > 0 ? "crit" : "brand"} />
                  </div>

                  <div>
                    <p className="mb-1 flex items-center justify-between text-[11px] text-ink-3">
                      <span>Seat utilization</span>
                      <span className="num">{vendor.utilizationPct}%</span>
                    </p>
                    <ProgressBar
                      value={vendor.utilizationPct}
                      tone={vendor.utilizationPct >= 80 ? "brand" : vendor.utilizationPct >= 55 ? "warn" : "crit"}
                      label={`${vendor.vendor} utilization`}
                    />
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    <Chip tone={vendor.status === "active" ? "brand" : "neutral"}>{vendor.status}</Chip>
                    {vendor.renewalInDays !== null && (
                      <Chip tone={(vendor.renewalInDays ?? 999) <= 30 ? "warn" : "neutral"}>renews in {vendor.renewalInDays}d</Chip>
                    )}
                    {vendor.idleSeats > 0 && <Chip tone="info">{vendor.idleSeats} idle</Chip>}
                    {vendor.staleSeats > 0 && <Chip tone="crit">{vendor.staleSeats} unused</Chip>}
                    {vendor.monthlyTrend.length > 1 && (
                      <span className="ml-auto flex items-center gap-1.5">
                        <span className="text-[10px] uppercase tracking-[0.08em] text-ink-3">charge trend</span>
                        <Sparkline values={vendor.monthlyTrend} tone={vendor.wasteCents > 0 ? "crit" : "brand"} width={62} height={20} />
                      </span>
                    )}
                  </div>

                  <div className="rounded-lg border border-line bg-surface-2/50 p-2.5">
                    <p className="label-xs flex items-center gap-1.5">
                      <Sparkles size={11} strokeWidth={2.2} /> Findings
                      <span className="num text-ink-2">{related.length}</span>
                    </p>
                    {related.length === 0 ? (
                      <p className="mt-1 text-[11px] text-ink-3">No detection hits on this contract.</p>
                    ) : (
                      <ul className="mt-1 space-y-0.5">
                        {related.slice(0, 3).map((item) => (
                          <li key={item.id} className="flex items-center justify-between gap-2 text-[11px]">
                            <span className="truncate text-ink-2">{kindLabel(item.kind)}</span>
                            <span className="num shrink-0 text-crit">{item.monthlyCents > 0 ? `−${formatUsd(item.monthlyCents)}` : "review"}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>

                <footer className="flex items-center justify-between gap-2 border-t border-line p-3">
                  <span className="truncate text-[11px] text-ink-3">owner · {vendor.contractOwner}</span>
                  <Button tone="neutral" icon={<ExternalLink size={12} strokeWidth={2} />} onClick={() => setVendorId(vendor.id)}>
                    {savings > 0 ? `Review ${formatUsd(savings)}/mo` : "Open profile"}
                  </Button>
                </footer>
              </Card>
            );
          })}
        </div>
      )}

      <Card>
        <CardHeader icon={<Building2 size={14} strokeWidth={1.9} />} title="Billing models in the estate" subtitle="Facts behind the vendor cards" dense />
        <div className="grid grid-cols-1 gap-3 p-3.5 sm:grid-cols-3">
          {(["per_seat", "flat", "usage"] as const).map((model) => {
            const subset = vendors.filter((vendor) => vendor.billingModel === model);
            return (
              <div key={model} className="rounded-lg border border-line bg-surface-2/50 p-3">
                <p className="text-[12.5px] font-medium text-ink">
                  {model === "per_seat" ? "Per seat" : model === "flat" ? "Flat rate" : "Usage billed"}
                </p>
                <p className="num mt-1 text-[15px] font-semibold text-ink">
                  {formatUsd(subset.reduce((sum, vendor) => sum + vendor.monthlyCostCents, 0))}
                </p>
                <p className="mt-1 text-[11px] text-ink-2">
                  {subset.length} vendor{subset.length === 1 ? "" : "s"} ·{" "}
                  {model === "per_seat"
                    ? "measured against the activity window"
                    : "no seat telemetry — monitored for spend drift"}
                </p>
              </div>
            );
          })}
        </div>
      </Card>

      <VendorDrawer vendorId={vendorId} onClose={() => setVendorId(null)} />
    </div>
  );
}

function Fact({ label, value, tone = "ink" }: { label: string; value: string; tone?: "ink" | "crit" | "brand" }) {
  const colour = tone === "crit" ? "text-crit" : tone === "brand" ? "text-brand" : "text-ink";
  return (
    <div>
      <p className="label-xs">{label}</p>
      <p className={`num mt-0.5 text-[12.5px] font-medium ${colour}`}>{value}</p>
    </div>
  );
}
