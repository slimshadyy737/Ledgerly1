"use client";

/** Team & Seats — the 80-person roster with licence footprint and login recency. */
import { useMemo, useState } from "react";
import { ChevronRight, Search, UserMinus, Users } from "lucide-react";
import { useLedgerData } from "@/components/ledgerly/data";
import { MetricCard } from "@/components/ledgerly/metric-card";
import {
  Card,
  CardHeader,
  Chip,
  DemoBadge,
  EmptyState,
  PageHeader,
  SelectInput,
  Skeleton,
  StatusBadge,
  TextInput,
  formatUsd,
} from "@/components/ledgerly/ui";

type StatusFilter = "all" | "active" | "offboarded";
type InactivityFilter = "all" | "gt60" | "gt30" | "never";

export function TeamPage() {
  const { analytics, team, metrics, sandbox, sandboxTenantMismatch, loading } = useLedgerData();
  const [query, setQuery] = useState("");
  const [department, setDepartment] = useState("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [inactivity, setInactivity] = useState<InactivityFilter>("all");
  const [expanded, setExpanded] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const departments = useMemo(() => [...new Set(team.map((row) => row.department))].sort(), [team]);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return team.filter((row) => {
      const matchesQuery =
        needle.length === 0 || row.name.toLowerCase().includes(needle) || row.email.toLowerCase().includes(needle) || row.title.toLowerCase().includes(needle);
      const matchesDepartment = department === "all" || row.department === department;
      const matchesStatus = status === "all" || row.employmentStatus === status;
      const matchesInactivity =
        inactivity === "all"
          ? true
          : inactivity === "never"
            ? row.lastActivityAt === null
            : inactivity === "gt60"
              ? (row.lastActivityDays ?? 0) > 60 || row.employmentStatus === "offboarded"
              : (row.lastActivityDays ?? 0) > 30;
      return matchesQuery && matchesDepartment && matchesStatus && matchesInactivity;
    });
  }, [team, query, department, status, inactivity]);

  if (loading || !analytics || !metrics) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageRows = rows.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const offboarded = team.filter((row) => row.employmentStatus === "offboarded");
  const staleHouseholds = team.filter((row) => (row.lastActivityDays ?? 0) > 60);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Team & seats"
        subtitle="The sandbox company roster joined to licence data: which tools each person holds, when they last authenticated and what those seats cost."
        meta={
          <>
            <DemoBadge />
            <Chip tone="neutral">{team.length} employees</Chip>
            <Chip tone="neutral">{departments.length} departments</Chip>
            {sandboxTenantMismatch && <Chip tone="warn">roster reflects the primary demo tenant</Chip>}
          </>
        }
      />

      <section className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Headcount"
          value={String(team.length)}
          explanation="Employees in the sandbox HRIS roster. The roster is the source of truth for employment status used by the ghost-seat detector."
          caption={`${team.length - offboarded.length} active · ${offboarded.length} offboarded`}
          progress={{ value: ((team.length - offboarded.length) / Math.max(team.length, 1)) * 100, label: "Active headcount share" }}
        />
        <MetricCard
          label="Offboarded with licences"
          value={String(offboarded.filter((row) => row.appsAssigned > 0).length)}
          explanation="Former employees who still hold at least one paid licence. These are the highest-confidence ghost seats because employment status is definitive."
          caption={`${formatUsd(offboarded.reduce((sum, row) => sum + row.seatSpendCents, 0))}/month of seat spend attributed to leavers`}
          progress={{ value: offboarded.length > 0 ? 100 : 0, tone: "crit", label: "Leaver licence risk" }}
        />
        <MetricCard
          label="Inactive 60+ days"
          value={String(staleHouseholds.length)}
          explanation="People whose most recent activity across every tool is older than the inactivity window — their licences are candidates for reclamation."
          caption={`${staleHouseholds.reduce((sum, row) => sum + row.staleApps, 0)} stale tool assignments`}
          progress={{ value: (staleHouseholds.length / Math.max(team.length, 1)) * 100, tone: "warn", label: "Inactive population" }}
        />
        <MetricCard
          label="Attributed seat spend"
          value={formatUsd(team.reduce((sum, row) => sum + row.seatSpendCents, 0))}
          explanation="Monthly seat cost attributed across the roster (per-seat contracts only — usage-billed spend is not attributable to individuals)."
          caption={`${metrics.seatsPaid} seats · ${metrics.unattachedSeats} unattached`}
        />
      </section>

      <Card>
        <CardHeader
          icon={<Users size={14} strokeWidth={1.9} />}
          title="Employee licence footprint"
          subtitle={`${rows.length} of ${team.length} employees shown · expand a row for the individual tool list`}
          action={
            <div className="flex flex-wrap items-center gap-2">
              <TextInput
                value={query}
                onChange={(value) => {
                  setQuery(value);
                  setPage(1);
                }}
                placeholder="Search name, email, role"
                icon={<Search size={13} strokeWidth={2} />}
                className="w-52"
              />
              <SelectInput
                ariaLabel="Filter by department"
                value={department}
                onChange={(value) => {
                  setDepartment(value);
                  setPage(1);
                }}
                options={[{ value: "all", label: "All departments" }, ...departments.map((item) => ({ value: item, label: item }))]}
              />
              <SelectInput
                ariaLabel="Filter by employment status"
                value={status}
                onChange={(value) => {
                  setStatus(value as StatusFilter);
                  setPage(1);
                }}
                options={[
                  { value: "all", label: "Any status" },
                  { value: "active", label: "Active employees" },
                  { value: "offboarded", label: "Offboarded" },
                ]}
              />
              <SelectInput
                ariaLabel="Filter by inactivity"
                value={inactivity}
                onChange={(value) => {
                  setInactivity(value as InactivityFilter);
                  setPage(1);
                }}
                options={[
                  { value: "all", label: "Any activity" },
                  { value: "gt60", label: "Inactive 60+ days" },
                  { value: "gt30", label: "Inactive 30+ days" },
                  { value: "never", label: "No activity recorded" },
                ]}
              />
            </div>
          }
        />

        <div className="overflow-x-auto">
          <table className="w-full min-w-[960px] text-left text-[12px]">
            <thead className="border-b border-line bg-surface-2/40 text-[10.5px] uppercase tracking-[0.08em] text-ink-3">
              <tr>
                <th className="px-3.5 py-2 font-semibold">Employee</th>
                <th className="px-3.5 py-2 font-semibold">Department</th>
                <th className="px-3.5 py-2 font-semibold">Employment</th>
                <th className="px-3.5 py-2 text-right font-semibold">Tools</th>
                <th className="px-3.5 py-2 text-right font-semibold">Stale</th>
                <th className="px-3.5 py-2 text-right font-semibold">Seat spend</th>
                <th className="px-3.5 py-2 font-semibold">Last activity</th>
                <th className="px-3.5 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--line)]">
              {pageRows.map((row) => {
                const open = expanded === row.id;
                return (
                  <>
                    <tr
                      key={row.id}
                      className="cursor-pointer transition-colors hover:bg-surface-2/50"
                      onClick={() => setExpanded(open ? null : row.id)}
                    >
                      <td className="px-3.5 py-2.5">
                        <span className="block text-ink">{row.name}</span>
                        <span className="block text-[10.5px] text-ink-3">
                          {row.email} · {row.title}
                        </span>
                      </td>
                      <td className="px-3.5 py-2.5 text-ink-2">{row.department}</td>
                      <td className="px-3.5 py-2.5">
                        {row.employmentStatus === "offboarded" ? (
                          <StatusBadge tone="crit" icon={<UserMinus size={10} strokeWidth={2.4} />}>
                            Offboarded
                          </StatusBadge>
                        ) : (
                          <StatusBadge tone="brand">Active</StatusBadge>
                        )}
                      </td>
                      <td className="num px-3.5 py-2.5 text-right text-ink-2">{row.appsAssigned}</td>
                      <td className="num px-3.5 py-2.5 text-right">
                        <span className={row.staleApps > 0 ? "text-warn" : "text-ink-3"}>{row.staleApps}</span>
                      </td>
                      <td className="num px-3.5 py-2.5 text-right text-ink">{formatUsd(row.seatSpendCents)}</td>
                      <td className="px-3.5 py-2.5 text-ink-2">
                        {row.lastActivityAt ? `${row.lastActivityDays} days ago` : <span className="text-warn">no activity recorded</span>}
                      </td>
                      <td className="px-3.5 py-2.5 text-right">
                        <ChevronRight size={14} strokeWidth={2} className={`inline text-ink-3 transition-transform ${open ? "rotate-90" : ""}`} />
                      </td>
                    </tr>
                    {open && (
                      <tr key={`${row.id}-detail`} className="bg-surface-2/40">
                        <td colSpan={8} className="px-3.5 py-3">
                          {row.tools.length === 0 ? (
                            <p className="text-[11.5px] text-ink-3">No tool assignments recorded for this employee.</p>
                          ) : (
                            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
                              {row.tools.map((tool) => (
                                <div key={tool.app} className="flex items-center justify-between gap-2 rounded-lg border border-line bg-surface px-2.5 py-2">
                                  <span className="min-w-0">
                                    <span className="block truncate text-[12px] text-ink">{tool.app}</span>
                                    <span className="num block text-[10.5px] text-ink-3">{tool.loginsLast30d} logins / 30d</span>
                                  </span>
                                  <span className={`num shrink-0 text-[11px] ${(tool.daysSinceLogin ?? 999) > 60 ? "text-warn" : "text-ink-3"}`}>
                                    {tool.daysSinceLogin === null ? "no login" : `${tool.daysSinceLogin}d`}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                          {row.offboardedAt && (
                            <p className="mt-2 text-[11px] text-crit">
                              Offboarded {new Date(row.offboardedAt).toLocaleDateString("en-US")} — licences should have been revoked at that point.
                            </p>
                          )}
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>

        {rows.length === 0 && (
          <EmptyState
            compact
            title="No employees match these filters"
            description="Clear the search or department filter to see the full roster."
            action={
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  setDepartment("all");
                  setStatus("all");
                  setInactivity("all");
                }}
                className="focus-ring rounded-lg border border-line px-2.5 py-1.5 text-xs text-ink-2 hover:text-ink"
              >
                Reset filters
              </button>
            }
          />
        )}

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-3.5 py-2.5 text-[11px] text-ink-3">
          <span>
            {rows.length === 0 ? "0" : `${(currentPage - 1) * pageSize + 1}–${Math.min(currentPage * pageSize, rows.length)}`} of {rows.length}
          </span>
          <span className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={currentPage === 1}
              onClick={() => setPage(currentPage - 1)}
              className="focus-ring rounded-lg border border-line px-2.5 py-1 disabled:opacity-40"
            >
              Previous
            </button>
            <span className="num">
              Page {currentPage} / {totalPages}
            </span>
            <button
              type="button"
              disabled={currentPage >= totalPages}
              onClick={() => setPage(currentPage + 1)}
              className="focus-ring rounded-lg border border-line px-2.5 py-1 disabled:opacity-40"
            >
              Next
            </button>
          </span>
        </footer>
      </Card>

      <p className="text-[11px] text-ink-3">
        Roster size: {sandbox?.employees.length ?? team.length} employees. Seat spend excludes usage-billed contracts (cloud, observability)
        because those charges cannot be attributed to an individual.
      </p>
    </div>
  );
}
