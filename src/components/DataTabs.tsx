"use client";

import { useMemo, useState } from "react";
import type { Snapshot } from "@/lib/types";
import { formatDate, relativeDays, usd, usdExact } from "@/lib/format";
import { Badge, Panel } from "./ui";

/* ------------------------- Tab 3: card statement --------------------------- */

export function StatementTab({ snapshot }: { snapshot: Snapshot }) {
  const periods = useMemo(
    () => [...new Set(snapshot.transactions.map((t) => t.statementPeriod))].sort().reverse(),
    [snapshot.transactions],
  );
  const [period, setPeriod] = useState(periods[0] ?? "all");
  const [query, setQuery] = useState("");

  const rows = useMemo(
    () =>
      snapshot.transactions.filter((t) => {
        const matchesPeriod = period === "all" || t.statementPeriod === period;
        const q = query.trim().toLowerCase();
        const matchesQuery =
          q.length === 0 ||
          t.merchantDescriptor.toLowerCase().includes(q) ||
          (t.vendorName ?? "").toLowerCase().includes(q) ||
          t.category.toLowerCase().includes(q);
        return matchesPeriod && matchesQuery;
      }),
    [snapshot.transactions, period, query],
  );

  const total = rows.reduce((sum, t) => sum + t.amountCents, 0);
  const anomalies = rows.filter((t) => t.anomaly !== null).length;

  return (
    <Panel
      title="Accounting / corporate card statement"
      subtitle={`${rows.length} normalised recurring charges · ${usd(total)} for the selected period · ${anomalies} anomaly flag(s)`}
      action={
        <div className="flex items-center gap-2">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search descriptor / vendor…"
            className="w-56 rounded-lg border border-slate-800 bg-slate-950/70 px-3 py-1.5 text-xs text-slate-200 placeholder:text-slate-500 focus:border-emerald-500/60 focus:outline-none"
          />
          <select
            value={period}
            onChange={(event) => setPeriod(event.target.value)}
            className="rounded-lg border border-slate-800 bg-slate-950/70 px-2.5 py-1.5 text-xs text-slate-200 focus:border-emerald-500/60 focus:outline-none"
          >
            <option value="all">All periods</option>
            {periods.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
      }
    >
      <div className="max-h-[640px] overflow-auto">
        <table className="w-full min-w-[900px] text-left text-xs">
          <thead className="sticky top-0 bg-slate-900/95 text-[11px] uppercase tracking-wide text-slate-400">
            <tr>
              <th className="px-4 py-2.5 font-medium">Posted</th>
              <th className="px-4 py-2.5 font-medium">Merchant descriptor (raw)</th>
              <th className="px-4 py-2.5 font-medium">Matched vendor</th>
              <th className="px-4 py-2.5 font-medium">Category</th>
              <th className="px-4 py-2.5 font-medium text-right">Amount</th>
              <th className="px-4 py-2.5 font-medium">Card</th>
              <th className="px-4 py-2.5 font-medium text-right">Match</th>
              <th className="px-4 py-2.5 font-medium">Flags</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/70">
            {rows.map((tx) => (
              <tr key={tx.id} className="hover:bg-slate-900/40">
                <td className="px-4 py-2.5 whitespace-nowrap text-slate-400">
                  {formatDate(tx.postedAt)}
                  <span className="ml-2 text-[10px] text-slate-500">{tx.statementPeriod}</span>
                </td>
                <td className="px-4 py-2.5 font-mono text-[11px] text-slate-400">{tx.merchantDescriptor}</td>
                <td className="px-4 py-2.5 text-slate-200">{tx.vendorName ?? "— unmatched —"}</td>
                <td className="px-4 py-2.5 text-slate-400">{tx.category}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-slate-100">{usdExact(tx.amountCents)}</td>
                <td className="px-4 py-2.5 text-slate-400">
                  •••• {tx.cardLast4}
                  <span className="ml-2 text-[10px] text-slate-500">{tx.cardholderEmail}</span>
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">
                  <span className={tx.matchConfidence >= 95 ? "text-emerald-300" : "text-amber-300"}>
                    {tx.matchConfidence}%
                  </span>
                </td>
                <td className="px-4 py-2.5">
                  {tx.anomaly ? <Badge tone="rose">{tx.anomaly}</Badge> : <span className="text-slate-600">clean</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="border-t border-slate-800/70 px-4 py-3 text-[11px] text-slate-500">
        Pipeline note: raw descriptors are fuzzy-matched to the vendor register (<span className="font-mono">
          matchConfidence
        </span>) so the same vendor can bill under several legal entities. Usage-priced vendors (AWS, Datadog) carry no seat
        count and are monitored for spend drift instead.
      </p>
    </Panel>
  );
}

/* --------------------------- Tab 4: SSO login log -------------------------- */

export function SsoTab({ snapshot, onAction, pendingKey }: { snapshot: Snapshot; onAction: (p: { vendorId: number; actionType: "reclaim_seats"; seats: number; findingKind: "ghost_seats" }) => void; pendingKey: string | null }) {
  const [query, setQuery] = useState("");
  const [staleOnly, setStaleOnly] = useState(false);
  const [unmatchedOnly, setUnmatchedOnly] = useState(false);

  const rows = useMemo(
    () =>
      snapshot.ssoLog.filter((row) => {
        const q = query.trim().toLowerCase();
        const matchesQuery =
          q.length === 0 || row.employeeEmail.toLowerCase().includes(q) || row.appName.toLowerCase().includes(q);
        const matchesStale = !staleOnly || (row.daysSinceLogin ?? 9999) > 60 || row.employeeStatus === "offboarded";
        const matchesUnmatched = !unmatchedOnly || !row.billed;
        return matchesQuery && matchesStale && matchesUnmatched;
      }),
    [snapshot.ssoLog, query, staleOnly, unmatchedOnly],
  );

  const vendorIdByName = useMemo(() => {
    const map = new Map<string, number>();
    snapshot.inventory.forEach((v) => map.set(v.vendorName, v.vendorId));
    return map;
  }, [snapshot.inventory]);

  return (
    <Panel
      title="Google Workspace SSO login telemetry"
      subtitle={`${snapshot.ssoLog.length} app/employee login records ingested · ${rows.length} matching the current filter`}
      action={
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search email or app…"
            className="w-52 rounded-lg border border-slate-800 bg-slate-950/70 px-3 py-1.5 text-xs text-slate-200 placeholder:text-slate-500 focus:border-emerald-500/60 focus:outline-none"
          />
          <button
            onClick={() => setStaleOnly((v) => !v)}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
              staleOnly ? "bg-amber-500/20 text-amber-300 ring-1 ring-inset ring-amber-500/40" : "border border-slate-800 text-slate-400 hover:text-slate-200"
            }`}
          >
            60d+ inactive
          </button>
          <button
            onClick={() => setUnmatchedOnly((v) => !v)}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
              unmatchedOnly ? "bg-violet-500/20 text-violet-300 ring-1 ring-inset ring-violet-500/40" : "border border-slate-800 text-slate-400 hover:text-slate-200"
            }`}
          >
            Shadow IT only
          </button>
        </div>
      }
    >
      <div className="max-h-[640px] overflow-auto">
        <table className="w-full min-w-[900px] text-left text-xs">
          <thead className="sticky top-0 bg-slate-900/95 text-[11px] uppercase tracking-wide text-slate-400">
            <tr>
              <th className="px-4 py-2.5 font-medium">App (IdP)</th>
              <th className="px-4 py-2.5 font-medium">Employee email</th>
              <th className="px-4 py-2.5 font-medium">Dept</th>
              <th className="px-4 py-2.5 font-medium">last_login_at</th>
              <th className="px-4 py-2.5 font-medium text-right">Logins / 30d</th>
              <th className="px-4 py-2.5 font-medium">Billing match</th>
              <th className="px-4 py-2.5 font-medium text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/70">
            {rows.slice(0, 400).map((row) => {
              const vendorId = row.vendorName ? vendorIdByName.get(row.vendorName) : undefined;
              return (
                <tr key={row.id} className="hover:bg-slate-900/40">
                  <td className="px-4 py-2.5 text-slate-200">{row.appName}</td>
                  <td className="px-4 py-2.5">
                    <span className="text-slate-300">{row.employeeEmail}</span>
                    {row.employeeStatus === "offboarded" && (
                      <span className="ml-2 text-[10px] uppercase text-rose-400">offboarded</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-slate-400">{row.department}</td>
                  <td className="px-4 py-2.5">
                    <span className="text-slate-300">{formatDate(row.lastLoginAt)}</span>
                    <span
                      className={`ml-2 ${(row.daysSinceLogin ?? 0) > 60 ? "text-rose-300" : (row.daysSinceLogin ?? 0) > 30 ? "text-amber-300" : "text-slate-500"}`}
                    >
                      {relativeDays(row.daysSinceLogin)}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-slate-300">{row.loginsLast30d}</td>
                  <td className="px-4 py-2.5">
                    {row.billed ? (
                      <Badge tone="emerald">matched · {row.seatStatus}</Badge>
                    ) : (
                      <Badge tone="violet">no invoice (shadow IT)</Badge>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {vendorId && row.seatStatus === "active" && ((row.daysSinceLogin ?? 0) > 60 || row.employeeStatus === "offboarded") ? (
                      <button
                        onClick={() =>
                          onAction({
                            vendorId,
                            actionType: "reclaim_seats",
                            seats: 1,
                            findingKind: "ghost_seats",
                          })
                        }
                        disabled={pendingKey !== null}
                        className="rounded-lg bg-emerald-500/90 px-2.5 py-1 text-[11px] font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:opacity-50"
                      >
                        Reclaim seat
                      </button>
                    ) : (
                      <span className="text-[11px] text-slate-600">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="border-t border-slate-800/70 px-4 py-3 text-[11px] text-slate-500">
        This is the detector&apos;s activity source. Seats with <span className="font-mono">logins_last_30d = 0</span> and a
        login older than 60 days are ghost seats; a vendor where <em>every</em> row is silent is zombie software.
      </p>
    </Panel>
  );
}

/* ------------------------------ Tab 5: roster ------------------------------ */

export function TeamTab({ snapshot }: { snapshot: Snapshot }) {
  const [showOffboarded, setShowOffboarded] = useState(false);
  const [query, setQuery] = useState("");

  const rows = useMemo(
    () =>
      snapshot.employees.filter((employee) => {
        const matchesStatus = showOffboarded ? employee.status === "offboarded" : true;
        const q = query.trim().toLowerCase();
        const matchesQuery =
          q.length === 0 ||
          employee.fullName.toLowerCase().includes(q) ||
          employee.email.toLowerCase().includes(q) ||
          employee.department.toLowerCase().includes(q);
        return matchesStatus && matchesQuery;
      }),
    [snapshot.employees, showOffboarded, query],
  );

  const offboarded = snapshot.employees.filter((e) => e.status === "offboarded");

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Panel title="Headcount" className="lg:col-span-1">
          <div className="grid grid-cols-2 gap-3 p-4">
            <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3">
              <p className="text-[11px] text-slate-500">Active staff</p>
              <p className="text-xl font-semibold text-slate-100">{snapshot.employees.length - offboarded.length}</p>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3">
              <p className="text-[11px] text-slate-500">Offboarded</p>
              <p className="text-xl font-semibold text-rose-300">{offboarded.length}</p>
            </div>
            <div className="col-span-2 rounded-xl border border-slate-800 bg-slate-950/50 p-3">
              <p className="text-[11px] text-slate-500">Monthly spend on seats held by leavers</p>
              <p className="text-xl font-semibold text-amber-300 tabular-nums">
                {usd(
                  offboarded.reduce((sum, e) => sum + e.seatSpendCents, 0),
                )}
              </p>
              <p className="mt-1 text-[11px] text-slate-500">
                HR marks a person inactive; nobody tells the vendors. This is the #1 source of ghost seats.
              </p>
            </div>
          </div>
        </Panel>

        <Panel title="Departments" className="lg:col-span-2">
          <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3">
            {[...new Set(snapshot.employees.map((e) => e.department))].map((department) => {
              const members = snapshot.employees.filter((e) => e.department === department);
              const spend = members.reduce((sum, e) => sum + e.seatSpendCents, 0);
              return (
                <div key={department} className="rounded-xl border border-slate-800 bg-slate-950/50 p-3">
                  <p className="truncate text-[11px] text-slate-400">{department}</p>
                  <p className="text-sm font-semibold text-slate-100">{members.length} people</p>
                  <p className="text-[11px] tabular-nums text-slate-500">{usd(spend)}/mo in seats</p>
                </div>
              );
            })}
          </div>
        </Panel>
      </div>

      <Panel
        title="Employee ↔ licence footprint"
        subtitle={`${rows.length} people · sorted by attributed monthly seat spend`}
        action={
          <div className="flex items-center gap-2">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search name, email, dept…"
              className="w-52 rounded-lg border border-slate-800 bg-slate-950/70 px-3 py-1.5 text-xs text-slate-200 placeholder:text-slate-500 focus:border-emerald-500/60 focus:outline-none"
            />
            <button
              onClick={() => setShowOffboarded((v) => !v)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                showOffboarded
                  ? "bg-rose-500/20 text-rose-300 ring-1 ring-inset ring-rose-500/40"
                  : "border border-slate-800 text-slate-400 hover:text-slate-200"
              }`}
            >
              Leavers only
            </button>
          </div>
        }
      >
        <div className="max-h-[560px] overflow-auto">
          <table className="w-full min-w-[820px] text-left text-xs">
            <thead className="sticky top-0 bg-slate-900/95 text-[11px] uppercase tracking-wide text-slate-400">
              <tr>
                <th className="px-4 py-2.5 font-medium">Employee</th>
                <th className="px-4 py-2.5 font-medium">Department / title</th>
                <th className="px-4 py-2.5 font-medium">HR status</th>
                <th className="px-4 py-2.5 font-medium text-right">Apps</th>
                <th className="px-4 py-2.5 font-medium text-right">Stale apps</th>
                <th className="px-4 py-2.5 font-medium text-right">Seat spend</th>
                <th className="px-4 py-2.5 font-medium">Last activity</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {rows
                .slice()
                .sort((a, b) => b.seatSpendCents - a.seatSpendCents)
                .map((employee) => (
                  <tr key={employee.id} className="hover:bg-slate-900/40">
                    <td className="px-4 py-2.5">
                      <p className="text-slate-200">{employee.fullName}</p>
                      <p className="text-[11px] text-slate-500">{employee.email}</p>
                    </td>
                    <td className="px-4 py-2.5">
                      <p className="text-slate-300">{employee.department}</p>
                      <p className="text-[11px] text-slate-500">{employee.jobTitle}</p>
                    </td>
                    <td className="px-4 py-2.5">
                      {employee.status === "offboarded" ? (
                        <Badge tone="rose">left {relativeDays(employee.offboardedAt ? Math.round((Date.now() - new Date(employee.offboardedAt).getTime()) / 86_400_000) : null)}</Badge>
                      ) : (
                        <Badge tone="emerald">active</Badge>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-300">{employee.appsAssigned}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      <span className={employee.staleApps > 0 ? "text-amber-300" : "text-slate-500"}>
                        {employee.staleApps}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-200">
                      {usd(employee.seatSpendCents)}
                    </td>
                    <td className="px-4 py-2.5 text-slate-400">{relativeDays(employee.lastActivityAt ? Math.max(0, Math.round((Date.now() - new Date(employee.lastActivityAt).getTime()) / 86_400_000)) : null)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
