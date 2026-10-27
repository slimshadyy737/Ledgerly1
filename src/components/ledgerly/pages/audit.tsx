"use client";

/** Audit Log — every simulated optimization action with before/after values. */
import { useMemo, useState } from "react";
import { CheckCircle2, DatabaseZap, History, RotateCcw } from "lucide-react";
import { useLedgerData } from "@/components/ledgerly/data";
import { MetricCard } from "@/components/ledgerly/metric-card";
import {
  Button,
  Card,
  CardHeader,
  Chip,
  ConfirmDialog,
  DemoBadge,
  EmptyState,
  PageHeader,
  SelectInput,
  Skeleton,
  StatusBadge,
  TextInput,
  formatUsd,
} from "@/components/ledgerly/ui";

export function AuditPage() {
  const { audit, metrics, analytics, loading, resetDemo } = useLedgerData();
  const [query, setQuery] = useState("");
  const [action, setAction] = useState("all");
  const [resetOpen, setResetOpen] = useState(false);
  const [resetting, setResetting] = useState(false);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return audit.filter((event) => {
      const matchesQuery =
        needle.length === 0 || event.vendorName.toLowerCase().includes(needle) || event.performedBy.toLowerCase().includes(needle);
      const matchesAction = action === "all" || event.action === action;
      return matchesQuery && matchesAction;
    });
  }, [audit, query, action]);

  if (loading || !analytics || !metrics) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-80 w-full" />
      </div>
    );
  }

  const realizedMonthly = audit.reduce((sum, event) => sum + event.savingsCents, 0);
  const seatsReclaimed = audit.reduce((sum, event) => sum + event.seatsReclaimed, 0);
  const vendorsTouched = new Set(audit.map((event) => event.vendorName)).size;
  const actions = [...new Set(audit.map((event) => event.action))];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Audit log"
        subtitle="Immutable record of every optimization Ledgerly applied to the sandbox database: what changed, why, and the measured saving."
        meta={
          <>
            <DemoBadge />
            <Chip tone="neutral">{audit.length} entries</Chip>
            <Chip tone="neutral">actor · operator@ledgerly.app</Chip>
            <StatusBadge tone="info" icon={<DatabaseZap size={10} strokeWidth={2.4} />}>
              sandbox writes only
            </StatusBadge>
          </>
        }
        actions={
          <>
            <Button
              tone="neutral"
              icon={<RotateCcw size={13} strokeWidth={2} />}
              onClick={() => setResetOpen(true)}
            >
              Reset sandbox
            </Button>
            <Button
              tone="neutral"
              disabled={audit.length === 0}
              onClick={() => {
                const header = ["Timestamp", "Action", "Vendor", "Seats", "Previous cost", "New cost", "Saving", "Actor"];
                const csv = [
                  header.join(","),
                  ...audit.map((event) =>
                    [
                      event.createdAt,
                      event.action,
                      `"${event.vendorName}"`,
                      event.seatsReclaimed,
                      (event.previousCostCents / 100).toFixed(2),
                      (event.newCostCents / 100).toFixed(2),
                      (event.savingsCents / 100).toFixed(2),
                      event.performedBy,
                    ].join(","),
                  ),
                ].join("\n");
                const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
                const url = URL.createObjectURL(blob);
                const link = document.createElement("a");
                link.href = url;
                link.download = `ledgerly-audit-${new Date().toISOString().slice(0, 10)}.csv`;
                link.click();
                URL.revokeObjectURL(url);
              }}
            >
              Export audit CSV
            </Button>
          </>
        }
      />

      <section className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Actions applied"
          value={String(audit.length)}
          explanation="Optimization write-backs recorded in the audit table. Each entry is transactional: the seat change, the recalculated cost and the saving are written together."
          caption={`${vendorsTouched} distinct vendor${vendorsTouched === 1 ? "" : "s"} affected`}
          progress={{ value: Math.min(100, audit.length * 10), label: "Audit coverage" }}
        />
        <MetricCard
          label="Realized monthly saving"
          value={formatUsd(realizedMonthly)}
          explanation="Sum of measured monthly cost reductions from applied actions. This is separate from identified savings and never double-counted."
          caption={`${formatUsd(realizedMonthly * 12)} annualised`}
          progress={{ value: metrics.identifiedSavingsCents + realizedMonthly > 0 ? (realizedMonthly / (metrics.identifiedSavingsCents + realizedMonthly)) * 100 : 0, tone: "brand", label: "Share of identified waste recovered" }}
          emphasis
        />
        <MetricCard
          label="Seats reclaimed"
          value={String(seatsReclaimed)}
          explanation="Licence grants revoked in the sandbox. Only seats flagged by the detectors are revoked; active users are never removed."
          caption={`${metrics.seatsPaid} seats still provisioned`}
        />
        <MetricCard
          label="Identified remaining"
          value={formatUsd(metrics.identifiedSavingsCents)}
          explanation="Waste still open in the optimization center."
          caption={`${metrics.openOpportunityCount} opportunities queued`}
          progress={{ value: metrics.wasteRatePct, tone: "crit", label: "Waste rate" }}
        />
      </section>

      <Card>
        <CardHeader
          icon={<History size={14} strokeWidth={1.9} />}
          title="Optimization events"
          subtitle={`${rows.length} of ${audit.length} entries · newest first`}
          action={
            <div className="flex flex-wrap items-center gap-2">
              <TextInput
                value={query}
                onChange={setQuery}
                placeholder="Search vendor or actor"
                className="w-48"
              />
              <SelectInput
                ariaLabel="Filter by action"
                value={action}
                onChange={setAction}
                options={[{ value: "all", label: "All actions" }, ...actions.map((item) => ({ value: item, label: item.replace(/_/g, " ") }))]}
              />
            </div>
          }
        />

        {rows.length === 0 ? (
          <EmptyState
            icon={<CheckCircle2 size={20} strokeWidth={1.8} />}
            title={audit.length === 0 ? "No optimizations recorded yet" : "No entries match these filters"}
            description={
              audit.length === 0
                ? "Approve a finding in the Optimization Center — the write-back, the recalculated cost and the audit entry are committed together."
                : "Clear the search box or pick a different action type."
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[940px] text-left text-[12px]">
              <thead className="border-b border-line bg-surface-2/40 text-[10.5px] uppercase tracking-[0.08em] text-ink-3">
                <tr>
                  <th className="px-3.5 py-2 font-semibold">#</th>
                  <th className="px-3.5 py-2 font-semibold">Timestamp</th>
                  <th className="px-3.5 py-2 font-semibold">Action</th>
                  <th className="px-3.5 py-2 font-semibold">Vendor</th>
                  <th className="px-3.5 py-2 text-right font-semibold">Seats</th>
                  <th className="px-3.5 py-2 text-right font-semibold">Previous</th>
                  <th className="px-3.5 py-2 text-right font-semibold">Resulting</th>
                  <th className="px-3.5 py-2 text-right font-semibold">Saving</th>
                  <th className="px-3.5 py-2 font-semibold">Actor</th>
                  <th className="px-3.5 py-2 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--line)]">
                {rows.map((event) => (
                  <tr key={event.id} className="transition-colors hover:bg-surface-2/50">
                    <td className="num px-3.5 py-2.5 text-ink-3">{event.id}</td>
                    <td className="px-3.5 py-2.5 text-ink-2">{new Date(event.createdAt).toLocaleString("en-US")}</td>
                    <td className="px-3.5 py-2.5 text-ink">{event.action.replace(/_/g, " ")}</td>
                    <td className="px-3.5 py-2.5 text-ink-2">{event.vendorName}</td>
                    <td className="num px-3.5 py-2.5 text-right text-ink-2">{event.seatsReclaimed}</td>
                    <td className="num px-3.5 py-2.5 text-right text-ink-2">{formatUsd(event.previousCostCents)}</td>
                    <td className="num px-3.5 py-2.5 text-right text-ink">{formatUsd(event.newCostCents)}</td>
                    <td className="num px-3.5 py-2.5 text-right text-brand">{event.savingsDisplay}</td>
                    <td className="px-3.5 py-2.5 text-ink-3">{event.performedBy}</td>
                    <td className="px-3.5 py-2.5">
                      <StatusBadge tone="info">Simulated</StatusBadge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className="p-3.5">
        <p className="text-[11.5px] leading-relaxed text-ink-3">
          <span className="font-semibold text-ink-2">Provenance.</span> Ledgerly writes to the seeded sandbox database only. Nothing in
          this log reflects a change to a live vendor account, and no external billing, identity or procurement API is contacted. Resetting
          the sandbox truncates the contract register, licence register and this audit log, then reloads the deterministic demo company —
          which is also the correct way to prepare a clean demonstration.
        </p>
      </Card>

      <ConfirmDialog
        open={resetOpen}
        busy={resetting}
        tone="danger"
        onClose={() => setResetOpen(false)}
        onConfirm={async () => {
          setResetting(true);
          await resetDemo();
          setResetting(false);
          setResetOpen(false);
        }}
        title="Reset the sandbox company?"
        description="Every simulated action, seat revocation and dismissed finding is discarded and the deterministic demo company is reloaded from the seed script."
        confirmLabel="Reset sandbox data"
        details={
          <ul className="space-y-1 text-[11.5px] text-ink-2">
            <li>• Contract register, licence register and audit log are truncated and reloaded.</li>
            <li>• Detection windows return to {analytics.windows.staleLicenseDays}d / {analytics.windows.activeSeatDays}d.</li>
            <li>• {audit.length} audit entr{audit.length === 1 ? "y" : "ies"} and {seatsReclaimed} seat revocation(s) will be lost.</li>
          </ul>
        }
      />
    </div>
  );
}
