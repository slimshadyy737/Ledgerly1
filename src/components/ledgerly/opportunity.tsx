"use client";

/**
 * OpportunityItem — one detection result with its evidence, savings maths and
 * the write-back controls (confirm dialog → POST → recalculate).
 */
import { useState } from "react";
import { ChevronRight, Clock, Info, ShieldAlert, Sparkles, Undo2 } from "lucide-react";
import { kindLabel, severityTheme, type Opportunity } from "@/lib/ledgerly/derive";
import { useLedgerData } from "./data";
import { Button, ConfirmDialog, StatusBadge, formatUsd, useToast } from "./ui";

export function OpportunityItem({
  opportunity,
  onOpenVendor,
  compact,
}: {
  opportunity: Opportunity;
  onOpenVendor?: (vendorId: number) => void;
  compact?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const theme = severityTheme(opportunity.severity);
  const unverified = opportunity.unverifiedCount;
  const isReview = opportunity.action === "review";

  return (
    <article className="rounded-xl border border-line bg-surface transition-colors hover:border-line-strong">
      <div className="flex flex-wrap items-start justify-between gap-3 p-3.5">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <StatusBadge
              tone={
                opportunity.severity === "critical"
                  ? "crit"
                  : opportunity.severity === "high"
                    ? "warn"
                    : opportunity.severity === "medium"
                      ? "info"
                      : "neutral"
              }
              icon={<ShieldAlert size={10} strokeWidth={2.4} />}
            >
              {theme.label}
            </StatusBadge>
            <span className="text-[10.5px] font-medium uppercase tracking-[0.08em] text-ink-3">
              {kindLabel(opportunity.kind)}
            </span>
            <span className="text-[10.5px] text-ink-3">·</span>
            <span className="text-[10.5px] text-ink-3">{opportunity.category}</span>
            {unverified > 0 && (
              <StatusBadge tone="neutral" icon={<Info size={10} strokeWidth={2.4} />}>
                {unverified} unverified
              </StatusBadge>
            )}
          </div>

          <h3 className="mt-1.5 text-[13.5px] font-semibold tracking-tight text-ink">{opportunity.title}</h3>
          {!compact && <p className="mt-1 text-xs leading-relaxed text-ink-2">{opportunity.explanation}</p>}
        </div>

        <div className="shrink-0 text-right">
          {opportunity.monthlyCents > 0 ? (
            <>
              <p className="num text-[15px] font-semibold text-brand">+{formatUsd(opportunity.monthlyCents)}</p>
              <p className="num text-[10.5px] text-ink-3">per month · {formatUsd(opportunity.annualCents)}/yr</p>
            </>
          ) : (
            <span className="text-[11px] text-ink-3">no savings attributed</span>
          )}
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-2 border-t border-line px-3.5 py-2.5 sm:grid-cols-4">
        <div>
          <dt className="label-xs">Vendor</dt>
          <dd className="mt-0.5 truncate text-[12px] text-ink">{opportunity.vendor}</dd>
        </div>
        <div>
          <dt className="label-xs">Seats affected</dt>
          <dd className="num mt-0.5 text-[12px] text-ink">{opportunity.seatsAffected || "—"}</dd>
        </div>
        <div>
          <dt className="label-xs">Evidence</dt>
          <dd className="mt-0.5 text-[12px] text-ink">
            {isReview ? "Advisory" : opportunity.confidence >= 0.9 ? "Confirmed" : opportunity.confidence >= 0.75 ? "Probable" : "Unverified"}
          </dd>
        </div>
        <div>
          <dt className="label-xs">Confidence</dt>
          <dd className="num mt-0.5 text-[12px] text-ink">{Math.round(opportunity.confidence * 100)}%</dd>
        </div>
      </dl>

      <div className="border-t border-line px-3.5 py-2.5">
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="focus-ring flex items-center gap-1.5 rounded-md text-[11.5px] font-medium text-ink-2 transition-colors hover:text-ink"
          aria-expanded={expanded}
        >
          <ChevronRight size={13} strokeWidth={2.2} className={`transition-transform ${expanded ? "rotate-90" : ""}`} />
          Why this was detected
        </button>

        {expanded && (
          <div className="animate-fade mt-2 space-y-2">
            <p className="rounded-lg border border-line bg-surface-2/60 px-2.5 py-2 font-mono text-[10.5px] text-ink-2">
              rule · {opportunity.rule}
            </p>
            <p className="text-[11.5px] leading-relaxed text-ink-2">
              <span className="text-ink-3">savings maths · </span>
              {opportunity.calculation}
            </p>
            {opportunity.evidence.length > 0 && (
              <div className="overflow-x-auto rounded-lg border border-line">
                <table className="w-full min-w-[600px] text-left text-[11px]">
                  <thead className="bg-surface-2 text-ink-3">
                    <tr>
                      <th className="px-2.5 py-1.5 font-medium">Employee</th>
                      <th className="px-2.5 py-1.5 font-medium">Department</th>
                      <th className="px-2.5 py-1.5 font-medium">Employment</th>
                      <th className="px-2.5 py-1.5 font-medium">Last login</th>
                      <th className="px-2.5 py-1.5 text-right font-medium">Logins/30d</th>
                      <th className="px-2.5 py-1.5 text-right font-medium">Seat cost</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--line)]">
                    {opportunity.evidence.slice(0, 10).map((seat) => (
                      <tr key={seat.email}>
                        <td className="px-2.5 py-1.5">
                          <span className="block text-ink">{seat.employee}</span>
                          <span className="text-ink-3">{seat.email}</span>
                        </td>
                        <td className="px-2.5 py-1.5 text-ink-2">{seat.department}</td>
                        <td className="px-2.5 py-1.5">
                          {seat.employmentStatus === "terminated" ? (
                            <StatusBadge tone="crit">Offboarded</StatusBadge>
                          ) : (
                            <StatusBadge tone="neutral">Active</StatusBadge>
                          )}
                        </td>
                        <td className="px-2.5 py-1.5 text-ink-2">
                          {seat.verified ? (
                            seat.daysSinceLogin === null ? (
                              "—"
                            ) : (
                              `${seat.daysSinceLogin} days ago`
                            )
                          ) : (
                            <span className="text-warn">no login recorded</span>
                          )}
                        </td>
                        <td className="num px-2.5 py-1.5 text-right text-ink-2">{seat.loginsLast30d}</td>
                        <td className="num px-2.5 py-1.5 text-right text-ink-2">{formatUsd(seat.seatCostCents, { exact: true })}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {opportunity.evidence.length === 0 && !isReview && (
              <p className="text-[11.5px] text-ink-3">
                This finding is derived from invoice-level maths (no seat rows to list).
              </p>
            )}
          </div>
        )}
      </div>
    </article>
  );
}

/**
 * Confirmation + execution workflow shared by every "act on this" button:
 * confirm dialog → backend write-back → metrics recalculated by the provider.
 */
export function useOpportunityWorkflow() {
  const { optimize, dismiss, restore, dismissed } = useLedgerData();
  const { push } = useToast();
  const [pending, setPending] = useState<Opportunity | null>(null);
  const [busy, setBusy] = useState(false);

  const request = (opportunity: Opportunity) => {
    if (opportunity.action === "review") {
      push({
        tone: "info",
        title: "Review item only",
        description: "Ledgerly found no confirmed waste here, so no seats or contracts are changed. Book a renewal review instead.",
      });
      return;
    }
    setPending(opportunity);
  };

  const confirm = async () => {
    if (!pending || pending.vendorId === null) return;
    setBusy(true);
    await optimize({
      vendorId: pending.vendorId,
      vendor: pending.vendor,
      action: pending.action as Exclude<Opportunity["action"], "review">,
      seats: pending.seatsAffected,
      reason: `${kindLabel(pending.kind)} — ${pending.title}`,
    });
    setBusy(false);
    setPending(null);
  };

  const dialog = (
    <ConfirmDialog
      open={pending !== null}
      busy={busy}
      onClose={() => (busy ? undefined : setPending(null))}
      onConfirm={() => void confirm()}
      tone={pending?.action === "cancel" ? "danger" : "primary"}
      title={pending ? `${pending.action === "reclaim_seats" ? "Reclaim unused seats" : pending.action === "consolidate" ? "Consolidate duplicate platform" : "Cancel subscription"}?` : ""}
      description="This is a simulated write-back: Ledgerly updates the sandbox database, records an audit entry and recalculates every metric. No real vendor account is modified."
      confirmLabel={pending?.action === "reclaim_seats" ? "Confirm reclaim" : pending?.action === "consolidate" ? "Confirm merge" : "Confirm cancellation"}
      details={
        pending && (
          <div className="space-y-3">
            <div className="rounded-lg border border-line bg-surface-2/60 p-3">
              <p className="text-[13px] font-medium text-ink">{pending.title}</p>
              <p className="mt-1 text-xs text-ink-2">{pending.explanation}</p>
            </div>
            <dl className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border border-line p-2.5">
                <dt className="label-xs">Vendor</dt>
                <dd className="mt-0.5 text-[12.5px] text-ink">{pending.vendor}</dd>
              </div>
              <div className="rounded-lg border border-line p-2.5">
                <dt className="label-xs">Seats affected</dt>
                <dd className="num mt-0.5 text-[12.5px] text-ink">{pending.seatsAffected}</dd>
              </div>
              <div className="rounded-lg border border-line p-2.5">
                <dt className="label-xs">Monthly saving</dt>
                <dd className="num mt-0.5 text-[12.5px] text-brand">{formatUsd(pending.monthlyCents)}</dd>
              </div>
              <div className="rounded-lg border border-line p-2.5">
                <dt className="label-xs">Annualised</dt>
                <dd className="num mt-0.5 text-[12.5px] text-brand">{formatUsd(pending.annualCents)}</dd>
              </div>
            </dl>
            <p className="flex items-start gap-1.5 text-[11px] text-ink-3">
              <Clock size={12} strokeWidth={2} className="mt-0.5" />
              The reclaim only touches seats flagged by the detector; active users are never revoked.
            </p>
          </div>
        )
      }
    />
  );

  return {
    request,
    dialog,
    pending,
    busy,
    dismiss,
    restore,
    dismissed,
    /**
     * Bulk reclaim used by the inventory table: one confirm dialog, one backend
     * call per contract, and the savings are counted once per contract by the
     * backend because each call mutates that subscription row.
     */
    bulkReclaim: async (rows: { vendorId: number; vendor: string; seats: number; monthlyCents: number }[]) => {
      for (const row of rows) {
        if (row.seats <= 0) continue;
        await optimize({
          vendorId: row.vendorId,
          vendor: row.vendor,
          action: "reclaim_seats",
          seats: row.seats,
          reason: `Bulk reclaim from inventory (${row.seats} unused seats)`,
        });
      }
      push({
        tone: "success",
        title: `Bulk reclaim queued for ${rows.length} contract${rows.length === 1 ? "" : "s"}`,
        description: `Approved ${formatUsd(rows.reduce((sum, row) => sum + row.monthlyCents, 0))}/month of identified waste.`,
      });
    },
    icon: <Sparkles size={14} strokeWidth={2} />,
    undoIcon: <Undo2 size={14} strokeWidth={2} />,
  };
}

export { Button };
