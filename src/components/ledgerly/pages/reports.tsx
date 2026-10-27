"use client";

/** Reports — a shareable savings report generated from the current sandbox state. */
import { useMemo, useState } from "react";
import { CheckCircle2, Download, FileJson, FileText, Printer, ShieldAlert } from "lucide-react";
import { useLedgerData } from "@/components/ledgerly/data";
import { DETECTOR_COPY, kindLabel } from "@/lib/ledgerly/derive";
import {
  Button,
  Card,
  CardHeader,
  Chip,
  DemoBadge,
  EmptyState,
  KeyValue,
  PageHeader,
  SegmentedControl,
  Skeleton,
  StatusBadge,
  useToast,
  formatUsd,
} from "@/components/ledgerly/ui";

type Format = "summary" | "findings" | "actions";

export function ReportsPage() {
  const { report, metrics, analytics, audit, loading, tenant } = useLedgerData();
  const { push } = useToast();
  const [format, setFormat] = useState<Format>("summary");

  const csv = useMemo(() => (report ? buildReportCsv(report) : ""), [report]);

  if (loading || !report || !metrics || !analytics) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-7 w-44" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-80 w-full" />
      </div>
    );
  }

  const download = (content: string, filename: string, type: string) => {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
    push({ tone: "success", title: `Exported ${filename}`, description: "Generated from the current sandbox state." });
  };

  const stamp = new Date().toISOString().slice(0, 10);
  const realizedMonthly = audit.reduce((sum, event) => sum + event.savingsCents, 0);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Savings report"
        subtitle="A point-in-time report of identified and realized savings, with export for finance review."
        meta={
          <>
            <DemoBadge />
            <Chip tone="neutral">Generated {new Date(report.generatedAt).toLocaleString("en-US")}</Chip>
            <Chip tone="neutral">{tenant?.name ?? report.company.name}</Chip>
            <StatusBadge tone={report.integrity.balanced ? "brand" : "warn"} pulse={!report.integrity.balanced}>
              {report.integrity.balanced ? "Integrity verified" : `Δ ${formatUsd(report.integrity.deltaCents)}`}
            </StatusBadge>
          </>
        }
        actions={
          <>
            <Button
              tone="neutral"
              icon={<Download size={13} strokeWidth={2} />}
              onClick={() => download(csv, `ledgerly-report-${stamp}.csv`, "text/csv;charset=utf-8")}
            >
              Export CSV
            </Button>
            <Button
              tone="neutral"
              icon={<FileJson size={13} strokeWidth={2} />}
              onClick={() => download(JSON.stringify(report, null, 2), `ledgerly-report-${stamp}.json`, "application/json")}
            >
              Export JSON
            </Button>
            <Button tone="ghost" icon={<Printer size={13} strokeWidth={2} />} onClick={() => window.print()}>
              Print
            </Button>
          </>
        }
      />

      <div className="no-print">
        <SegmentedControl<Format>
          ariaLabel="Report section"
          value={format}
          onChange={setFormat}
          options={[
            { value: "summary", label: "Executive summary" },
            { value: "findings", label: "Identified opportunities" },
            { value: "actions", label: "Completed actions" },
          ]}
        />
      </div>

      {format === "summary" && (
        <div className="space-y-3.5">
          <Card className="p-4">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="label-xs flex items-center gap-1.5">
                  <FileText size={12} strokeWidth={2} /> Executive summary
                </p>
                <h2 className="mt-1 text-lg font-semibold tracking-tight text-ink">
                  {report.company.name} — SaaS spend review
                </h2>
                <p className="mt-1 max-w-3xl text-[12.5px] leading-relaxed text-ink-2">
                  Ledgerly reconciled {analytics.estate.subscriptionsActive} active contracts covering {metrics.seatsPaid} paid seats
                  against identity-provider login activity using a {report.windows.staleLicenseDays}-day licence inactivity window and a{" "}
                  {report.windows.activeSeatDays}-day zombie window. It identified {formatUsd(metrics.identifiedSavingsCents)} of monthly
                  waste ({report.metrics.wasteRatePct.toFixed(1)}% of spend) and recorded {audit.length} simulated optimization action
                  {audit.length === 1 ? "" : "s"} worth {formatUsd(realizedMonthly)} per month.
                </p>
              </div>
              <dl className="min-w-[240px] space-y-0.5">
                <KeyValue label="Reporting period">{new Date(report.generatedAt).toLocaleDateString("en-US", { month: "long", year: "numeric" })}</KeyValue>
                <KeyValue label="Seat utilization">{metrics.seatUtilizationPct.toFixed(0)}%</KeyValue>
                <KeyValue label="Estate health">{metrics.averageHealthScore}/100</KeyValue>
              </dl>
            </div>
          </Card>

          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
            <SummaryTile label="Current monthly spend" value={formatUsd(metrics.monthlySpendCents)} note={`${formatUsd(metrics.annualizedSpendCents)} annualised`} />
            <SummaryTile label="Identified monthly savings" value={formatUsd(metrics.identifiedSavingsCents)} note={`${formatUsd(metrics.identifiedSavingsAnnualCents)} annualised`} tone="brand" />
            <SummaryTile label="Realized simulated savings" value={formatUsd(realizedMonthly)} note={`${audit.length} action${audit.length === 1 ? "" : "s"} applied`} tone="brand" />
            <SummaryTile label="Remaining opportunities" value={String(metrics.openOpportunityCount)} note={`${metrics.ghostSeats} unused seats referenced`} tone="crit" />
          </div>

          <Card>
            <CardHeader title="Savings attribution by detector" subtitle="How each rule contributes to the identified total" dense />
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-[12px]">
                <thead className="border-b border-line bg-surface-2/40 text-[10.5px] uppercase tracking-[0.08em] text-ink-3">
                  <tr>
                    <th className="px-3.5 py-2 font-semibold">Detector</th>
                    <th className="px-3.5 py-2 font-semibold">Rule</th>
                    <th className="px-3.5 py-2 text-right font-semibold">Hits</th>
                    <th className="px-3.5 py-2 text-right font-semibold">Monthly</th>
                    <th className="px-3.5 py-2 text-right font-semibold">Annualised</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--line)]">
                  {report.detectors.map((detector) => (
                    <tr key={detector.id}>
                      <td className="px-3.5 py-2.5 text-ink">{DETECTOR_COPY[detector.id]?.name ?? detector.id}</td>
                      <td className="px-3.5 py-2.5 font-mono text-[10.5px] text-ink-3">{detector.rule}</td>
                      <td className="num px-3.5 py-2.5 text-right text-ink-2">{detector.hits}</td>
                      <td className="num px-3.5 py-2.5 text-right text-ink">{formatUsd(detector.monthlyCents)}</td>
                      <td className="num px-3.5 py-2.5 text-right text-ink-2">{formatUsd(detector.monthlyCents * 12)}</td>
                    </tr>
                  ))}
                  <tr className="bg-surface-2/40 font-semibold">
                    <td className="px-3.5 py-2.5 text-ink" colSpan={3}>
                      Total identified
                    </td>
                    <td className="num px-3.5 py-2.5 text-right text-brand">{formatUsd(metrics.identifiedSavingsCents)}</td>
                    <td className="num px-3.5 py-2.5 text-right text-brand">{formatUsd(metrics.identifiedSavingsAnnualCents)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {format === "findings" && (
        <Card>
          <CardHeader
            icon={<ShieldAlert size={14} strokeWidth={1.9} />}
            title="Identified opportunities"
            subtitle={`${report.opportunities.length} findings · ${formatUsd(metrics.identifiedSavingsCents)}/month · each dollar attributed once`}
          />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-[12px]">
              <thead className="border-b border-line bg-surface-2/40 text-[10.5px] uppercase tracking-[0.08em] text-ink-3">
                <tr>
                  <th className="px-3.5 py-2 font-semibold">Severity</th>
                  <th className="px-3.5 py-2 font-semibold">Type</th>
                  <th className="px-3.5 py-2 font-semibold">Vendor</th>
                  <th className="px-3.5 py-2 text-right font-semibold">Seats</th>
                  <th className="px-3.5 py-2 text-right font-semibold">Monthly</th>
                  <th className="px-3.5 py-2 text-right font-semibold">Annualised</th>
                  <th className="px-3.5 py-2 text-right font-semibold">Confidence</th>
                  <th className="px-3.5 py-2 font-semibold">Recommended action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--line)]">
                {report.opportunities.map((item) => (
                  <tr key={item.id} className="transition-colors hover:bg-surface-2/50">
                    <td className="px-3.5 py-2.5">
                      <StatusBadge tone={item.severity === "critical" ? "crit" : item.severity === "high" ? "warn" : item.severity === "medium" ? "info" : "neutral"}>
                        {item.severity}
                      </StatusBadge>
                    </td>
                    <td className="px-3.5 py-2.5 text-ink-2">{kindLabel(item.kind)}</td>
                    <td className="px-3.5 py-2.5 text-ink">{item.vendor}</td>
                    <td className="num px-3.5 py-2.5 text-right text-ink-2">{item.seatsAffected || "—"}</td>
                    <td className="num px-3.5 py-2.5 text-right text-ink">{item.monthlyCents > 0 ? formatUsd(item.monthlyCents) : "—"}</td>
                    <td className="num px-3.5 py-2.5 text-right text-brand">{item.annualCents > 0 ? formatUsd(item.annualCents) : "—"}</td>
                    <td className="num px-3.5 py-2.5 text-right text-ink-2">{Math.round(item.confidence * 100)}%</td>
                    <td className="px-3.5 py-2.5 text-ink-2">{item.recommendedAction}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-surface-2/40 font-semibold">
                  <td className="px-3.5 py-2.5 text-ink" colSpan={4}>
                    Total identified
                  </td>
                  <td className="num px-3.5 py-2.5 text-right text-brand">{formatUsd(metrics.identifiedSavingsCents)}</td>
                  <td className="num px-3.5 py-2.5 text-right text-brand">{formatUsd(metrics.identifiedSavingsAnnualCents)}</td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
        </Card>
      )}

      {format === "actions" && (
        <Card>
          <CardHeader
            icon={<CheckCircle2 size={14} strokeWidth={1.9} />}
            title="Completed simulated actions"
            subtitle={`${audit.length} write-back${audit.length === 1 ? "" : "s"} recorded in the audit ledger · ${formatUsd(realizedMonthly)}/month released`}
          />
          {audit.length === 0 ? (
            <EmptyState
              compact
              title="No actions applied yet"
              description="Approve an opportunity in the Optimization Center and the resulting write-back appears here with its measured saving."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[840px] text-left text-[12px]">
                <thead className="border-b border-line bg-surface-2/40 text-[10.5px] uppercase tracking-[0.08em] text-ink-3">
                  <tr>
                    <th className="px-3.5 py-2 font-semibold">Timestamp</th>
                    <th className="px-3.5 py-2 font-semibold">Action</th>
                    <th className="px-3.5 py-2 font-semibold">Vendor</th>
                    <th className="px-3.5 py-2 text-right font-semibold">Seats</th>
                    <th className="px-3.5 py-2 text-right font-semibold">Before → after</th>
                    <th className="px-3.5 py-2 text-right font-semibold">Monthly saving</th>
                    <th className="px-3.5 py-2 font-semibold">Actor</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--line)]">
                  {audit.map((event) => (
                    <tr key={event.id}>
                      <td className="px-3.5 py-2.5 text-ink-2">{new Date(event.createdAt).toLocaleString("en-US")}</td>
                      <td className="px-3.5 py-2.5 text-ink">{event.action.replace(/_/g, " ")}</td>
                      <td className="px-3.5 py-2.5 text-ink-2">{event.vendorName}</td>
                      <td className="num px-3.5 py-2.5 text-right text-ink-2">{event.seatsReclaimed}</td>
                      <td className="num px-3.5 py-2.5 text-right text-ink-2">
                        {formatUsd(event.previousCostCents)} → {formatUsd(event.newCostCents)}
                      </td>
                      <td className="num px-3.5 py-2.5 text-right text-brand">{event.savingsDisplay}</td>
                      <td className="px-3.5 py-2.5 text-ink-3">{event.performedBy}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-surface-2/40 font-semibold">
                    <td className="px-3.5 py-2.5 text-ink" colSpan={5}>
                      Realized monthly saving
                    </td>
                    <td className="num px-3.5 py-2.5 text-right text-brand">{formatUsd(realizedMonthly)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </Card>
      )}

      <p className="text-[11px] leading-relaxed text-ink-3">
        Limitations: this report describes the seeded sandbox company only. “Identified” savings are modelled opportunities; “realized”
        savings are the arithmetic effect of simulated write-backs on the sandbox database and do not represent money recovered from a real
        vendor. Historical comparisons are limited to the six statement periods present in the dataset.
      </p>
    </div>
  );
}

function SummaryTile({ label, value, note, tone = "ink" }: { label: string; value: string; note: string; tone?: "ink" | "brand" | "crit" }) {
  const colour = tone === "brand" ? "text-brand" : tone === "crit" ? "text-crit" : "text-ink";
  return (
    <Card className="p-3.5">
      <p className="label-xs">{label}</p>
      <p className={`num mt-1.5 text-[22px] font-semibold leading-none ${colour}`}>{value}</p>
      <p className="mt-1.5 text-[11px] text-ink-3">{note}</p>
    </Card>
  );
}

function buildReportCsv(report: NonNullable<ReturnType<typeof useLedgerData>["report"]>): string {
  const lines: string[] = [];
  lines.push("Ledgerly savings report");
  lines.push(`Company,${report.company.name}`);
  lines.push(`Generated,${report.generatedAt}`);
  lines.push(`Monthly spend,${(report.metrics.monthlySpendCents / 100).toFixed(2)}`);
  lines.push(`Identified monthly savings,${(report.metrics.identifiedSavingsCents / 100).toFixed(2)}`);
  lines.push(`Realized monthly savings,${(report.metrics.realizedSavingsCents / 100).toFixed(2)}`);
  lines.push(`Waste rate %,${report.metrics.wasteRatePct.toFixed(2)}`);
  lines.push("");
  lines.push("Severity,Type,Vendor,Seats,Monthly savings,Annualised savings,Confidence,Recommended action");
  report.opportunities.forEach((item) => {
    lines.push(
      [
        item.severity,
        kindLabel(item.kind),
        `"${item.vendor}"`,
        item.seatsAffected,
        (item.monthlyCents / 100).toFixed(2),
        (item.annualCents / 100).toFixed(2),
        Math.round(item.confidence * 100),
        `"${item.recommendedAction}"`,
      ].join(","),
    );
  });
  lines.push("");
  lines.push("Timestamp,Action,Vendor,Seats,Previous cost,New cost,Monthly saving,Actor");
  report.realized.forEach((event) => {
    lines.push(
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
    );
  });
  return lines.join("\n");
}
