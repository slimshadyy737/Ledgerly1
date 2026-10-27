"use client";

/** Optimization Center — the review queue for every detected opportunity. */
import { useMemo, useState } from "react";
import { BookOpenCheck, ShieldAlert, Sparkles, Undo2 } from "lucide-react";
import { useLedgerData } from "@/components/ledgerly/data";
import { OpportunityItem, useOpportunityWorkflow } from "@/components/ledgerly/opportunity";
import { VendorDrawer } from "@/components/ledgerly/vendor-drawer";
import { DETECTOR_COPY, kindLabel, severityTheme, type Opportunity, type OpportunityKind, type Severity } from "@/lib/ledgerly/derive";
import {
  Button,
  Card,
  CardHeader,
  Chip,
  DemoBadge,
  EmptyState,
  InfoHint,
  PageHeader,
  SegmentedControl,
  Skeleton,
  StatusBadge,
  formatUsd,
} from "@/components/ledgerly/ui";

type Scope = "open" | "all" | "dismissed";

export function OptimizationPage() {
  const { analytics, opportunities, activeOpportunities, dismissed, restore, metrics, loading } = useLedgerData();
  const workflow = useOpportunityWorkflow();
  const [scope, setScope] = useState<Scope>("open");
  const [kind, setKind] = useState<"all" | OpportunityKind>("all");
  const [severity, setSeverity] = useState<"all" | Severity>("all");
  const [vendorId, setVendorId] = useState<number | null>(null);

  const queue = useMemo(() => {
    const source =
      scope === "open" ? activeOpportunities : scope === "dismissed" ? opportunities.filter((item) => dismissed.includes(item.id)) : opportunities;
    return source.filter((item) => (kind === "all" || item.kind === kind) && (severity === "all" || item.severity === severity));
  }, [scope, activeOpportunities, opportunities, dismissed, kind, severity]);

  if (loading || !analytics || !metrics) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-7 w-64" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  const kinds: (OpportunityKind)[] = ["offboarded_holder", "ghost_seats", "zombie_software", "overlap_duplication", "idle_seats", "cost_review"];
  const totals = queue.reduce(
    (acc, item) => ({ monthly: acc.monthly + item.monthlyCents, seats: acc.seats + item.seatsAffected }),
    { monthly: 0, seats: 0 },
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title="Optimization center"
        subtitle="Every detection Leadgerly made, why it fired, what the supporting licence data shows, and the recommended next step. Actions are simulated write-backs to the sandbox database."
        meta={
          <>
            <DemoBadge />
            <Chip tone="crit">
              {formatUsd(metrics.identifiedSavingsCents)}/mo identifiable
            </Chip>
            <Chip tone="neutral">{activeOpportunities.length} open findings</Chip>
            <Chip tone="neutral">{dismissed.length} dismissed locally</Chip>
          </>
        }
        actions={
          <SegmentedControl<Scope>
            ariaLabel="Queue scope"
            value={scope}
            onChange={setScope}
            options={[
              { value: "open", label: "Open queue" },
              { value: "all", label: "All findings" },
              { value: "dismissed", label: "Dismissed" },
            ]}
          />
        }
      />

      {/* detection engine explainer */}
      <Card>
        <CardHeader
          icon={<BookOpenCheck size={14} strokeWidth={1.9} />}
          title="Detection engine"
          subtitle="Four transparent rules run in SQL against the contract register, the licence register and the login telemetry"
        />
        <div className="grid grid-cols-1 gap-3 p-3.5 sm:grid-cols-2 xl:grid-cols-4">
          {analytics.detectors.map((detector) => {
            const copy = DETECTOR_COPY[detector.id];
            const tone = detector.id === "ZOMBIE_SOFTWARE" ? "crit" : detector.id === "DUPLICATE_CATEGORY" ? "info" : detector.id === "IDLE_SEAT" ? "warn" : "crit";
            return (
              <div key={detector.id} className="rounded-lg border border-line bg-surface-2/50 p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[12.5px] font-semibold text-ink">{copy?.name ?? detector.id}</p>
                  <StatusBadge tone={tone as "crit" | "info" | "warn"}>{detector.hits} hits</StatusBadge>
                </div>
                <p className="mt-1.5 text-[11.5px] leading-relaxed text-ink-2">{copy?.plain}</p>
                <p className="mt-2 font-mono text-[10px] leading-relaxed text-ink-3">{detector.rule}</p>
                <p className="num mt-2 text-[11.5px] text-ink">
                  {formatUsd(detector.monthlyCents)}/month attributed
                </p>
                <p className="mt-0.5 text-[10.5px] text-ink-3">Savings basis: {detector.waste}</p>
              </div>
            );
          })}
        </div>
      </Card>

      {/* filters */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="label-xs mr-1">Type</span>
        <Chip active={kind === "all"} onClick={() => setKind("all")}>
          All
        </Chip>
        {kinds.map((item) => (
          <Chip key={item} active={kind === item} onClick={() => setKind(item)} tone="info">
            {kindLabel(item)}
          </Chip>
        ))}
        <span className="label-xs mx-1 ml-auto">Severity</span>
        {(["all", "critical", "high", "medium", "low"] as const).map((item) => (
          <Chip
            key={item}
            active={severity === item}
            tone={item === "critical" ? "crit" : item === "high" ? "warn" : "info"}
            onClick={() => setSeverity(item)}
          >
            {item === "all" ? "Any" : item}
          </Chip>
        ))}
        <InfoHint>
          Severity combines the dollar impact, the detector confidence and the verification state of the supporting seats.
        </InfoHint>
      </div>

      <Card>
        <CardHeader
          icon={<ShieldAlert size={14} strokeWidth={1.9} />}
          title={scope === "dismissed" ? "Dismissed findings" : "Review queue"}
          subtitle={`${queue.length} finding${queue.length === 1 ? "" : "s"} · ${formatUsd(totals.monthly)}/month · ${totals.seats} seats referenced`}
          action={
            queue.length > 0 && scope !== "dismissed" ? (
              <Button
                tone="primary"
                icon={<Sparkles size={13} strokeWidth={2} />}
                onClick={() => {
                  const first = queue[0];
                  if (first) workflow.request(first);
                }}
              >
                Review top finding
              </Button>
            ) : undefined
          }
        />
        <div className="space-y-2.5 p-3.5">
          {queue.map((opportunity: Opportunity) => (
            <div key={opportunity.id} className="space-y-2">
              <OpportunityItem opportunity={opportunity} onOpenVendor={setVendorId} />
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-surface-2/40 px-3 py-2">
                <p className="text-[11.5px] text-ink-2">
                  <span className="text-ink-3">Next step · </span>
                  {opportunity.recommendedAction}
                </p>
                <div className="flex flex-wrap items-center gap-1.5">
                  {scope === "dismissed" ? (
                    <Button tone="neutral" icon={<Undo2 size={13} strokeWidth={2} />} onClick={() => restore(opportunity.id)}>
                      Restore to queue
                    </Button>
                  ) : (
                    <>
                      <Button tone="ghost" onClick={() => workflow.dismiss(opportunity.id)}>
                        Dismiss
                      </Button>
                      {opportunity.action !== "review" ? (
                        <Button
                          tone={opportunity.action === "cancel" ? "danger" : "primary"}
                          onClick={() => workflow.request(opportunity)}
                        >
                          {opportunity.action === "reclaim_seats"
                            ? `Reclaim ${opportunity.seatsAffected} seat${opportunity.seatsAffected === 1 ? "" : "s"}`
                            : opportunity.action === "consolidate"
                              ? "Consolidate"
                              : "Cancel subscription"}
                        </Button>
                      ) : (
                        <Button tone="neutral" onClick={() => opportunity.vendorId && setVendorId(opportunity.vendorId)}>
                          Open vendor
                        </Button>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>
          ))}

          {queue.length === 0 && (
            <EmptyState
              icon={<BookOpenCheck size={20} strokeWidth={1.8} />}
              title={scope === "dismissed" ? "No dismissed findings" : "No findings match these filters"}
              description={
                scope === "dismissed"
                  ? "Dismissed findings are hidden locally in this browser only — the backend detector still reports them."
                  : "Clear the type and severity filters, or re-sync the sandbox to re-run the detectors."
              }
            />
          )}
        </div>
      </Card>

      <p className="text-[11px] leading-relaxed text-ink-3">
        Verification note: seats whose telemetry is missing are labelled <span className="text-warn">no login recorded</span> and treated as
        suspected inactivity, not measured inactivity. Findings with unverified evidence carry a lower confidence score and are marked
        accordingly in the queue.
      </p>

      {workflow.dialog}
      <VendorDrawer vendorId={vendorId} onClose={() => setVendorId(null)} />
    </div>
  );
}
