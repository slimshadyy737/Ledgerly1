"use client";

/**
 * VendorDrawer — full vendor profile: contract facts, seat register fetched
 * live from GET /api/subscriptions/:id, related findings and write-back actions.
 */
import { useEffect, useState } from "react";
import { AlertTriangle, Building2, CalendarClock, Sparkles, UserCog } from "lucide-react";
import { ledgerApi } from "@/lib/ledgerly/api";
import { healthGrade, kindLabel, severityTheme, type InventoryRow } from "@/lib/ledgerly/derive";
import { useLedgerData } from "./data";
import { useOpportunityWorkflow } from "./opportunity";
import {
  Button,
  Chip,
  Drawer,
  EmptyState,
  HealthScore,
  KeyValue,
  ProgressBar,
  Skeleton,
  StatusBadge,
  formatUsd,
} from "./ui";

export function VendorDrawer({ vendorId, onClose }: { vendorId: number | null; onClose: () => void }) {
  const { inventory, opportunities } = useLedgerData();
  const workflow = useOpportunityWorkflow();
  const [detail, setDetail] = useState<Awaited<ReturnType<typeof ledgerApi.subscriptionDetail>>["data"] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const row: InventoryRow | undefined = inventory.find((item) => item.id === vendorId);

  useEffect(() => {
    if (vendorId === null) {
      setDetail(null);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    ledgerApi
      .subscriptionDetail(vendorId, controller.signal)
      .then((response) => setDetail(response.data))
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Could not load the seat register."))
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [vendorId]);

  if (vendorId === null || !row) return null;

  const vendorOpportunities = opportunities.filter((item) => item.vendorId === vendorId);

  return (
    <>
      <Drawer
        open
        onClose={onClose}
        title={row.vendor}
        subtitle={
          <span className="flex flex-wrap items-center gap-1.5">
            <Chip tone="neutral">{row.categoryGroup}</Chip>
            <Chip tone={row.status === "active" ? "brand" : "neutral"}>{row.status}</Chip>
            <span className="text-[11px] text-ink-3">
              {row.billingModel === "per_seat" ? `${formatUsd(row.unitCostCents, { exact: true })} per seat` : row.billingModel}
            </span>
          </span>
        }
        footer={
          <>
            <Button tone="ghost" onClick={onClose}>
              Close
            </Button>
            {row.staleSeats > 0 && (
              <Button
                tone="primary"
                onClick={() =>
                  workflow.request({
                    id: `drawer-${row.id}`,
                    kind: "ghost_seats",
                    severity: "high",
                    vendorId: row.id,
                    vendor: row.vendor,
                    category: row.categoryGroup,
                    title: `Reclaim ${row.staleSeats} unused ${row.vendor} seat${row.staleSeats === 1 ? "" : "s"}`,
                    explanation: `The licence register shows ${row.staleSeats} active seats without recent authentication.`,
                    calculation: `${row.staleSeats} seats · ${formatUsd(row.wasteCents)}/month`,
                    rule: "licence register activity window",
                    seatsAffected: row.staleSeats,
                    monthlyCents: row.wasteCents,
                    annualCents: row.wasteCents * 12,
                    confidence: 0.92,
                    recommendedAction: `Reclaim ${row.staleSeats} seats`,
                    action: "reclaim_seats",
                    evidence: [],
                    unverifiedCount: 0,
                  })
                }
              >
                Reclaim {row.staleSeats} seats
              </Button>
            )}
            {row.isZombie && (
              <Button
                tone="danger"
                onClick={() =>
                  workflow.request({
                    id: `drawer-cancel-${row.id}`,
                    kind: "zombie_software",
                    severity: "critical",
                    vendorId: row.id,
                    vendor: row.vendor,
                    category: row.categoryGroup,
                    title: `Cancel ${row.vendor}`,
                    explanation: "No employee has authenticated in the detection window while the invoice keeps charging.",
                    calculation: `Entire contract: ${formatUsd(row.monthlyCostCents)}/month`,
                    rule: "zombie software detector",
                    seatsAffected: row.seatsPaid,
                    monthlyCents: row.wasteCents,
                    annualCents: row.wasteCents * 12,
                    confidence: 0.96,
                    recommendedAction: "Cancel the contract and revoke the seats",
                    action: "cancel",
                    evidence: [],
                    unverifiedCount: 0,
                  })
                }
              >
                Cancel contract
              </Button>
            )}
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <Stat label="Monthly cost" value={formatUsd(row.monthlyCostCents)} />
            <Stat label="Annualised" value={formatUsd(row.annualizedCostCents)} />
            <Stat label="Identified waste" value={row.wasteCents > 0 ? formatUsd(row.wasteCents) : "none"} tone={row.wasteCents > 0 ? "crit" : "brand"} />
            <Stat label="Health" value={`${row.healthScore} · ${healthGrade(row.healthScore)}`} />
          </div>

          <section className="card p-3.5">
            <p className="label-xs flex items-center gap-1.5">
              <Building2 size={12} strokeWidth={2} /> Contract facts
            </p>
            <dl className="mt-1.5 divide-y divide-[var(--line)]">
              <KeyValue label="Seats paid">{row.seatsPaid || "—"}</KeyValue>
              <KeyValue label="Active users">{row.activeSeats}</KeyValue>
              <KeyValue label="Unused / idle seats" hint="Unused = active seats with no recent login. Idle = invoiced seats that never appear in the licence register.">
                {row.staleSeats} unused · {row.idleSeats} idle
              </KeyValue>
              <KeyValue label="Contract owner">{row.contractOwner}</KeyValue>
              <KeyValue label="Renewal">
                {row.renewalDate ? `${new Date(row.renewalDate).toLocaleDateString("en-US")} (${row.renewalInDays} days)` : "not set"}
              </KeyValue>
              <KeyValue label="Detection">{row.openFindings} open finding{row.openFindings === 1 ? "" : "s"}</KeyValue>
            </dl>
            <div className="mt-3">
              <p className="mb-1 flex items-center justify-between text-[11px] text-ink-3">
                <span>Seat utilization</span>
                <span className="num">{row.utilizationPct}%</span>
              </p>
              <ProgressBar value={row.utilizationPct} tone={row.utilizationPct >= 80 ? "brand" : "crit"} label="Seat utilization" />
            </div>
          </section>

          <section className="card p-3.5">
            <p className="label-xs flex items-center gap-1.5">
              <Sparkles size={12} strokeWidth={2} /> Related findings
            </p>
            {vendorOpportunities.length === 0 ? (
              <EmptyState compact title="No detection hits on this contract" description="Ledgerly found no unused seats, idle capacity or duplicate spend here." />
            ) : (
              <ul className="mt-2 space-y-2">
                {vendorOpportunities.map((item) => {
                  const theme = severityTheme(item.severity);
                  return (
                    <li key={item.id} className="rounded-lg border border-line bg-surface-2/50 p-2.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="flex items-center gap-2">
                          <StatusBadge tone={item.severity === "critical" ? "crit" : item.severity === "high" ? "warn" : "info"}>
                            {kindLabel(item.kind)}
                          </StatusBadge>
                          <span className="text-[12px] text-ink">{item.title}</span>
                        </span>
                        {item.monthlyCents > 0 && (
                          <span className="num text-[11.5px] font-medium text-brand">{formatUsd(item.monthlyCents)}/mo</span>
                        )}
                      </div>
                      <p className="mt-1 text-[11px] leading-relaxed text-ink-2">{item.recommendedAction}</p>
                      {item.action !== "review" && (
                        <div className="mt-2">
                          <Button tone="primary" onClick={() => workflow.request(item)}>
                            {item.action === "reclaim_seats" ? "Reclaim seats" : item.action === "consolidate" ? "Merge vendor" : "Cancel vendor"}
                          </Button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="card">
            <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3.5 py-2.5">
              <div>
                <p className="label-xs flex items-center gap-1.5">
                  <UserCog size={12} strokeWidth={2} /> Licence register
                </p>
                <p className="mt-0.5 text-[11px] text-ink-3">
                  Live from <span className="font-mono">GET /api/subscriptions/{row.id}</span>
                </p>
              </div>
              <StatusBadge tone={loading ? "info" : "neutral"} pulse={loading}>
                {loading ? "loading" : `${detail?.seatMappings.length ?? 0} seats`}
              </StatusBadge>
            </header>

            {error && <p className="px-3.5 py-3 text-xs text-crit">{error}</p>}
            {loading && !detail && (
              <div className="space-y-2 p-3.5">
                <Skeleton className="h-5 w-full" />
                <Skeleton className="h-5 w-5/6" />
                <Skeleton className="h-5 w-4/6" />
              </div>
            )}
            {detail && (
              <div className="max-h-80 overflow-auto">
                <table className="w-full min-w-[560px] text-left text-[11.5px]">
                  <thead className="sticky top-0 bg-surface-2 text-ink-3">
                    <tr>
                      <th className="px-3 py-2 font-medium">Employee</th>
                      <th className="px-3 py-2 font-medium">Department</th>
                      <th className="px-3 py-2 font-medium">Last login</th>
                      <th className="px-3 py-2 text-right font-medium">Logins/30d</th>
                      <th className="px-3 py-2 font-medium">Seat state</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--line)]">
                    {detail.seatMappings.map((seat) => (
                      <tr key={seat.seatMappingId} className="transition-colors hover:bg-surface-2/50">
                        <td className="px-3 py-1.5">
                          <span className="block text-ink">{seat.userName}</span>
                          <span className="text-ink-3">{seat.userEmail}</span>
                        </td>
                        <td className="px-3 py-1.5 text-ink-2">{seat.department}</td>
                        <td className="px-3 py-1.5 text-ink-2">
                          {seat.lastLoginAt ? `${seat.daysSinceLogin} days ago` : <span className="text-warn">no login recorded</span>}
                        </td>
                        <td className="num px-3 py-1.5 text-right text-ink-2">{seat.loginsLast30d}</td>
                        <td className="px-3 py-1.5">
                          {seat.seatStatus === "revoked" ? (
                            <StatusBadge tone="neutral">Reclaimed</StatusBadge>
                          ) : seat.userStatus === "terminated" ? (
                            <StatusBadge tone="crit">Offboarded</StatusBadge>
                          ) : seat.isStale ? (
                            <StatusBadge tone="warn" icon={<AlertTriangle size={10} strokeWidth={2.4} />}>
                              Inactive
                            </StatusBadge>
                          ) : (
                            <StatusBadge tone="brand">Active</StatusBadge>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="flex items-center gap-1.5 border-t border-line px-3.5 py-2 text-[11px] text-ink-3">
              <CalendarClock size={12} strokeWidth={2} />
              Seats marked “no login recorded” have missing telemetry — treated as suspected, not measured, inactivity.
            </p>
          </section>

          <section>
            <HealthScore score={row.healthScore} grade={row.healthGrade} />
          </section>
        </div>
      </Drawer>
      {workflow.dialog}
    </>
  );
}

function Stat({ label, value, tone = "ink" }: { label: string; value: string; tone?: "ink" | "crit" | "brand" }) {
  const colour = tone === "crit" ? "text-crit" : tone === "brand" ? "text-brand" : "text-ink";
  return (
    <div className="rounded-lg border border-line bg-surface-2/50 p-2.5">
      <p className="label-xs">{label}</p>
      <p className={`num mt-1 text-[14px] font-semibold ${colour}`}>{value}</p>
    </div>
  );
}
