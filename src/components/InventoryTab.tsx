"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import type { ActionRequestPayload, InventoryRow, Snapshot } from "@/lib/types";
import type { SeatMappingDTO } from "@/lib/spend/types";
import { fetchSubscriptionDetail } from "@/lib/live/client";
import { formatDate, healthColor, relativeDays, usd, usdExact } from "@/lib/format";
import { Badge, Meter, Panel, Sparkline } from "./ui";

type SortKey = "vendorName" | "seatsPaid" | "activeUsers" | "monthlyCostCents" | "healthScore" | "wastedCents";

export function InventoryTab({
  snapshot,
  onAction,
  pendingKey,
}: {
  snapshot: Snapshot;
  onAction: (payload: ActionRequestPayload) => void;
  pendingKey: string | null;
}) {
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState("all");
  const [riskOnly, setRiskOnly] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({
    key: "monthlyCostCents",
    dir: "desc",
  });
  const [expanded, setExpanded] = useState<number | null>(null);
  // Seat registers are fetched on demand from GET /api/subscriptions/:id and
  // cached per vendor, so expanding a row always shows live telemetry.
  const [seatCache, setSeatCache] = useState<Record<number, SeatMappingDTO[]>>({});
  const [seatState, setSeatState] = useState<"idle" | "loading" | "error">("idle");

  const groups = useMemo(
    () => [...new Set(snapshot.inventory.map((v) => v.categoryGroup))].sort(),
    [snapshot.inventory],
  );

  const rows = useMemo(() => {
    const filtered = snapshot.inventory.filter((v) => {
      const q = query.trim().toLowerCase();
      const matchesQuery =
        q.length === 0 ||
        v.vendorName.toLowerCase().includes(q) ||
        v.category.toLowerCase().includes(q) ||
        v.contractOwner.toLowerCase().includes(q);
      const matchesGroup = group === "all" || v.categoryGroup === group;
      const matchesRisk = !riskOnly || v.wastedCents > 0 || v.healthScore < 60;
      return matchesQuery && matchesGroup && matchesRisk;
    });
    return filtered.sort((a, b) => {
      const dir = sort.dir === "asc" ? 1 : -1;
      if (sort.key === "vendorName") return a.vendorName.localeCompare(b.vendorName) * dir;
      return ((a[sort.key] as number) - (b[sort.key] as number)) * dir;
    });
  }, [snapshot.inventory, query, group, riskOnly, sort]);

  const totals = useMemo(
    () =>
      rows.reduce(
        (acc, v) => ({
          cost: acc.cost + v.monthlyCostCents,
          waste: acc.waste + v.wastedCents,
          seats: acc.seats + v.seatsPaid,
          active: acc.active + v.activeUsers,
        }),
        { cost: 0, waste: 0, seats: 0, active: 0 },
      ),
    [rows],
  );

  useEffect(() => {
    if (expanded === null || seatCache[expanded]) return;
    const controller = new AbortController();
    setSeatState("loading");
    fetchSubscriptionDetail(expanded, controller.signal)
      .then((response) => {
        setSeatCache((previous) => ({ ...previous, [expanded]: response.data.seatMappings }));
        setSeatState("idle");
      })
      .catch(() => setSeatState("error"));
    return () => controller.abort();
  }, [expanded, seatCache]);

  const header = (key: SortKey, label: string, align: "left" | "right" = "right") => (
    <th
      className={`cursor-pointer select-none whitespace-nowrap px-3 py-2.5 text-[11px] font-medium uppercase tracking-wide text-slate-400 transition hover:text-slate-100 ${align === "right" ? "text-right" : "text-left"}`}
      onClick={() =>
        setSort((prev) => ({ key, dir: prev.key === key && prev.dir === "desc" ? "asc" : "desc" }))
      }
    >
      {label}
      {sort.key === key && <span className="ml-1 text-emerald-400">{sort.dir === "desc" ? "▾" : "▴"}</span>}
    </th>
  );

  return (
    <Panel
      title="Subscription inventory"
      subtitle={`${rows.length} active vendors · ${usd(totals.cost)}/mo · ${totals.active}/${totals.seats} seats active · ${usd(totals.waste)}/mo flagged`}
      action={
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search vendor, category, owner…"
            className="w-56 rounded-lg border border-slate-800 bg-slate-950/70 px-3 py-1.5 text-xs text-slate-200 placeholder:text-slate-500 focus:border-emerald-500/60 focus:outline-none"
          />
          <select
            value={group}
            onChange={(event) => setGroup(event.target.value)}
            className="rounded-lg border border-slate-800 bg-slate-950/70 px-2.5 py-1.5 text-xs text-slate-200 focus:border-emerald-500/60 focus:outline-none"
          >
            <option value="all">All categories</option>
            {groups.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
          <button
            onClick={() => setRiskOnly((v) => !v)}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
              riskOnly
                ? "bg-rose-500/20 text-rose-300 ring-1 ring-inset ring-rose-500/40"
                : "border border-slate-800 text-slate-400 hover:text-slate-200"
            }`}
          >
            Risk only
          </button>
        </div>
      }
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[980px] text-left text-xs">
          <thead className="bg-slate-900/70">
            <tr>
              {header("vendorName", "Vendor", "left")}
              <th className="px-3 py-2.5 text-left text-[11px] font-medium uppercase tracking-wide text-slate-400">
                Category
              </th>
              {header("seatsPaid", "Seats paid")}
              {header("activeUsers", "Active users")}
              <th className="px-3 py-2.5 text-right text-[11px] font-medium uppercase tracking-wide text-slate-400">
                Ghost seats
              </th>
              {header("monthlyCostCents", "Monthly cost")}
              {header("wastedCents", "Wasted $")}
              {header("healthScore", "Health")}
              <th className="px-3 py-2.5 text-left text-[11px] font-medium uppercase tracking-wide text-slate-400">
                Renewal
              </th>
              <th className="px-3 py-2.5 text-right text-[11px] font-medium uppercase tracking-wide text-slate-400">
                Action
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/70">
            {rows.map((vendor) => {
              const isOpen = expanded === vendor.vendorId;
              const seatRecords = seatCache[vendor.vendorId] ?? [];
              const seatsLoading = isOpen && seatState === "loading" && seatRecords.length === 0;
              // Pending keys are `${vendorId}:${actionType}` (see DashboardApp.handleResolve).
              const actionKey = `${vendor.vendorId}:reclaim_seats`;
              return (
                <Fragment key={vendor.vendorId}>
                  <tr
                    className={`cursor-pointer transition ${isOpen ? "bg-slate-900/60" : "hover:bg-slate-900/40"}`}
                    onClick={() => setExpanded(isOpen ? null : vendor.vendorId)}
                  >
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2.5">
                        <span className="text-base">{vendor.logoEmoji}</span>
                        <div>
                          <p className="font-medium text-slate-100">{vendor.vendorName}</p>
                          <p className="text-[11px] text-slate-500">
                            {vendor.billingModel === "per_seat"
                              ? `${usdExact(vendor.unitCostCents)}/seat`
                              : vendor.billingModel === "usage"
                                ? "usage-priced"
                                : "flat rate"}{" "}
                            · {vendor.contractOwner}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <p className="text-slate-300">{vendor.category}</p>
                      {vendor.overlapGroup && <Badge tone="amber">overlap</Badge>}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-slate-300">
                      {vendor.billingModel === "per_seat" ? vendor.seatsPaid : "—"}
                    </td>
                    <td className="px-3 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <span className="tabular-nums text-slate-300">
                          {vendor.billingModel === "per_seat" ? vendor.activeUsers : "—"}
                        </span>
                        <div className="w-16">
                          <Meter value={vendor.utilizationPct} color={healthColor(vendor.healthScore)} height={4} />
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums">
                      {vendor.ghostSeats + vendor.idleSeats > 0 ? (
                        <span className="text-rose-300">{vendor.ghostSeats + vendor.idleSeats}</span>
                      ) : (
                        <span className="text-slate-500">0</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-right">
                      <p className="tabular-nums text-slate-100">{usd(vendor.monthlyCostCents)}</p>
                      <p className="text-[11px] text-slate-500 tabular-nums">{usd(vendor.annualizedCostCents)}/yr</p>
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums">
                      {vendor.wastedCents > 0 ? (
                        <span className="text-amber-300">{usd(vendor.wastedCents)}</span>
                      ) : (
                        <span className="text-slate-500">—</span>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2">
                        <span
                          className="w-8 text-sm font-semibold tabular-nums"
                          style={{ color: healthColor(vendor.healthScore) }}
                        >
                          {vendor.healthScore}
                        </span>
                        <div className="w-16">
                          <Meter value={vendor.healthScore} color={healthColor(vendor.healthScore)} height={5} />
                        </div>
                        <span className="text-[10px] uppercase tracking-wide text-slate-500">{vendor.healthGrade}</span>
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <p className={`text-[11px] ${vendor.renewalInDays < 30 ? "text-amber-300" : "text-slate-400"}`}>
                        {formatDate(vendor.renewalDate)}
                      </p>
                      <p className="text-[10px] text-slate-500">{vendor.renewalInDays} days left</p>
                    </td>
                    <td className="px-3 py-3 text-right">
                      {vendor.ghostSeats > 0 ? (
                        <button
                          onClick={(event) => {
                            event.stopPropagation();
                            onAction({
                              vendorId: vendor.vendorId,
                              actionType: "reclaim_seats",
                              seats: vendor.ghostSeats,
                              findingKind: "ghost_seats",
                            });
                          }}
                          disabled={pendingKey === actionKey}
                          className="rounded-lg bg-emerald-500/90 px-2.5 py-1 text-[11px] font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:opacity-60"
                        >
                          {pendingKey === actionKey ? "…" : `Reclaim ${vendor.ghostSeats}`}
                        </button>
                      ) : vendor.healthScore < 30 ? (
                        <button
                          onClick={(event) => {
                            event.stopPropagation();
                            if (!window.confirm(`Cancel ${vendor.vendorName}?`)) return;
                            onAction({ vendorId: vendor.vendorId, actionType: "cancel_subscription", findingKind: "zombie_software" });
                          }}
                          className="rounded-lg border border-rose-500/50 px-2.5 py-1 text-[11px] font-semibold text-rose-300 transition hover:bg-rose-500/15"
                        >
                          Cancel
                        </button>
                      ) : (
                        <span className="text-[11px] text-slate-600">clear</span>
                      )}
                    </td>
                  </tr>
                  {isOpen && (
                    <tr className="bg-slate-950/60">
                      <td colSpan={10} className="px-4 py-4">
                        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                          <div className="lg:col-span-2">
                            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                              Live seat register ({seatRecords.length} rows from GET /api/subscriptions/{vendor.vendorId})
                            </p>
                            <div className="max-h-64 overflow-y-auto rounded-lg border border-slate-800">
                              <table className="w-full text-left text-[11px]">
                                <thead className="sticky top-0 bg-slate-900/90 text-slate-400">
                                  <tr>
                                    <th className="px-3 py-1.5 font-medium">Employee</th>
                                    <th className="px-3 py-1.5 font-medium">Department</th>
                                    <th className="px-3 py-1.5 font-medium">Last login</th>
                                    <th className="px-3 py-1.5 font-medium text-right">Logins / 30d</th>
                                    <th className="px-3 py-1.5 font-medium">Flag</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-800/70">
                                  {seatsLoading && (
                                    <tr>
                                      <td colSpan={5} className="px-3 py-3 text-slate-400">
                                        Loading the seat register from /api/subscriptions/{vendor.vendorId}…
                                      </td>
                                    </tr>
                                  )}
                                  {!seatsLoading && seatState === "error" && seatRecords.length === 0 && (
                                    <tr>
                                      <td colSpan={5} className="px-3 py-3 text-rose-300">
                                        Could not load the seat register for this vendor. Close and re-open the row to retry.
                                      </td>
                                    </tr>
                                  )}
                                  {seatRecords.map((seat) => (
                                    <tr key={seat.seatMappingId}>
                                      <td className="px-3 py-1.5 text-slate-300">
                                        {seat.userEmail}
                                        {seat.seatStatus === "revoked" && (
                                          <span className="ml-2 text-[10px] uppercase text-slate-500">revoked</span>
                                        )}
                                      </td>
                                      <td className="px-3 py-1.5 text-slate-500">{seat.department}</td>
                                      <td className="px-3 py-1.5 text-slate-400">{relativeDays(seat.daysSinceLogin)}</td>
                                      <td className="px-3 py-1.5 text-right tabular-nums text-slate-400">
                                        {seat.loginsLast30d}
                                      </td>
                                      <td className="px-3 py-1.5">
                                        {seat.userStatus === "terminated" ? (
                                          <Badge tone="rose">terminated</Badge>
                                        ) : seat.isStale ? (
                                          <Badge tone="amber">inactive 60d+</Badge>
                                        ) : (seat.daysSinceLogin ?? 999) > 30 ? (
                                          <Badge tone="sky">cold</Badge>
                                        ) : (
                                          <Badge tone="emerald">healthy</Badge>
                                        )}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                          <div className="space-y-2 rounded-lg border border-slate-800 bg-slate-950/50 p-3 text-[11px]">
                            <p className="font-semibold text-slate-300">Contract &amp; waste notes</p>
                            <p className="text-slate-400">
                              <span className="text-slate-500">Health:</span> {vendor.healthLabel} ({vendor.healthGrade}) —{" "}
                              {vendor.utilizationPct}% seat utilisation
                              {vendor.avgDaysSinceLogin !== null
                                ? `, avg last login ${vendor.avgDaysSinceLogin} days ago`
                                : ""}
                            </p>
                            {vendor.wasteReason && (
                              <p className="text-amber-300">
                                <span className="text-slate-500">Flagged:</span> {vendor.wasteReason}
                              </p>
                            )}
                            {vendor.wastedCents > 0 && (
                              <p className="text-rose-300">
                                <span className="text-slate-500">Waste:</span> {usd(vendor.wastedCents)}/mo (
                                {usd(vendor.wastedCents * 12)}/yr)
                              </p>
                            )}
                            <p className="text-slate-400">
                              <span className="text-slate-500">Renewal:</span> {formatDate(vendor.renewalDate)} in{" "}
                              {vendor.renewalInDays} days · owner {vendor.contractOwner}
                            </p>
                            <div className="flex items-center justify-between pt-1">
                              <span className="text-slate-500">6-month charge trend</span>
                              <Sparkline values={vendor.monthsTrend} color={healthColor(vendor.healthScore)} />
                            </div>
                          </div>
                        </div>
                      </td>
                    </tr>
                   )}
                 </Fragment>
               );
             })}
           </tbody>
        </table>
      </div>
    </Panel>
  );
}
