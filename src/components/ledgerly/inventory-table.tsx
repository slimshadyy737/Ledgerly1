"use client";

/**
 * InventoryTable — the dense subscription register used on Overview,
 * Subscriptions and Vendors pages: search, sorting, category + health filters,
 * pagination, row selection, bulk reclaim and a vendor detail drawer.
 */
import { useMemo, useState } from "react";
import {
  ArrowDownUp,
  Download,
  ExternalLink,
  Filter,
  RotateCcw,
  Search,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { healthLabel, type InventoryRow } from "@/lib/ledgerly/derive";
import { useLedgerData } from "./data";
import {
  Button,
  Card,
  CardHeader,
  Chip,
  ConfirmDialog,
  EmptyState,
  HealthScore,
  ProgressBar,
  SelectInput,
  StatusBadge,
  TextInput,
  formatUsd,
} from "./ui";
import { useOpportunityWorkflow } from "./opportunity";

type SortKey = "waste" | "cost" | "vendor" | "seats" | "utilization" | "health" | "renewal";
type HealthFilter = "all" | "healthy" | "review" | "critical" | "zombie" | "duplicate";

function statusOf(row: InventoryRow): { tone: "brand" | "crit" | "warn" | "info" | "neutral"; label: string } {
  if (row.status === "cancelled") return { tone: "neutral", label: "Cancelled" };
  if (row.status === "consolidated") return { tone: "info", label: "Consolidated" };
  if (row.isZombie) return { tone: "crit", label: "Zombie" };
  if (row.idleSeats > 0 && row.staleSeats > 0) return { tone: "warn", label: "Ghost + idle" };
  if (row.staleSeats > 0) return { tone: "warn", label: "Ghost seats" };
  if (row.idleSeats > 0) return { tone: "info", label: "Idle capacity" };
  if (row.isDuplicate) return { tone: "info", label: "Overlapping" };
  return { tone: "brand", label: "Healthy" };
}

export function InventoryTable({
  rows,
  title = "Subscription inventory",
  subtitle,
  pageSizeOptions = [8, 15, 30],
  defaultPageSize = 8,
  onOpenVendor,
  showSelection = true,
}: {
  rows: InventoryRow[];
  title?: string;
  subtitle?: string;
  pageSizeOptions?: number[];
  defaultPageSize?: number;
  onOpenVendor: (vendorId: number) => void;
  showSelection?: boolean;
}) {
  const { subscriptions } = useLedgerData();
  const workflow = useOpportunityWorkflow();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [health, setHealth] = useState<HealthFilter>("all");
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "waste", dir: "desc" });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(defaultPageSize);
  const [selected, setSelected] = useState<number[]>([]);
  const [bulkOpen, setBulkOpen] = useState(false);

  const categories = useMemo(
    () => [...new Set(rows.map((row) => row.categoryGroup))].sort((a, b) => a.localeCompare(b)),
    [rows],
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const list = rows.filter((row) => {
      const matchesQuery =
        needle.length === 0 ||
        row.vendor.toLowerCase().includes(needle) ||
        row.category.toLowerCase().includes(needle) ||
        row.contractOwner.toLowerCase().includes(needle);
      const matchesCategory = category === "all" || row.categoryGroup === category;
      const matchesHealth =
        health === "all"
          ? true
          : health === "healthy"
            ? row.wasteCents === 0 && !row.isZombie
            : health === "review"
              ? row.staleSeats > 0 || row.idleSeats > 0
              : health === "critical"
                ? row.healthScore < 55 || row.isZombie
                : health === "zombie"
                  ? row.isZombie
                  : row.isDuplicate;
      return matchesQuery && matchesCategory && matchesHealth;
    });

    const direction = sort.dir === "asc" ? 1 : -1;
    return [...list].sort((a, b) => {
      switch (sort.key) {
        case "vendor":
          return a.vendor.localeCompare(b.vendor) * direction;
        case "cost":
          return (a.monthlyCostCents - b.monthlyCostCents) * direction;
        case "seats":
          return (a.seatsPaid - b.seatsPaid) * direction;
        case "utilization":
          return (a.utilizationPct - b.utilizationPct) * direction;
        case "health":
          return (a.healthScore - b.healthScore) * direction;
        case "renewal":
          return ((a.renewalInDays ?? 9999) - (b.renewalInDays ?? 9999)) * direction;
        default:
          return (a.wasteCents - b.wasteCents) * direction;
      }
    });
  }, [rows, query, category, health, sort]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageRows = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const selectedRows = useMemo(() => rows.filter((row) => selected.includes(row.id)), [rows, selected]);
  const reclaimable = selectedRows.filter((row) => row.staleSeats > 0);
  const selectedWaste = reclaimable.reduce((sum, row) => sum + row.wasteCents, 0);

  const header = (key: SortKey, label: string, align: "left" | "right" = "right") => (
    <th scope="col" className={`whitespace-nowrap px-3 py-2 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-3 ${align === "right" ? "text-right" : "text-left"}`}>
      <button
        type="button"
        onClick={() => setSort((previous) => ({ key, dir: previous.key === key && previous.dir === "desc" ? "asc" : "desc" }))}
        className={`focus-ring inline-flex items-center gap-1 rounded transition-colors hover:text-ink ${align === "right" ? "flex-row-reverse" : ""}`}
      >
        {label}
        <ArrowDownUp size={10} strokeWidth={2.4} className={sort.key === key ? "text-brand" : "text-ink-3/60"} />
      </button>
    </th>
  );

  const exportCsv = () => {
    const source = selectedRows.length > 0 ? selectedRows : filtered;
    const headerRow = ["Vendor", "Category", "Seats paid", "Active users", "Utilization %", "Monthly cost", "Waste", "Health", "Status", "Owner", "Renewal"];
    const csv = [
      headerRow.join(","),
      ...source.map((row) =>
        [
          `"${row.vendor}"`,
          `"${row.categoryGroup}"`,
          row.seatsPaid,
          row.activeSeats,
          row.utilizationPct,
          (row.monthlyCostCents / 100).toFixed(2),
          (row.wasteCents / 100).toFixed(2),
          row.healthScore,
          statusOf(row).label,
          `"${row.contractOwner}"`,
          row.renewalDate ? new Date(row.renewalDate).toISOString().slice(0, 10) : "",
        ].join(","),
      ),
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `ledgerly-inventory-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card>
      <CardHeader
        icon={<Filter size={14} strokeWidth={1.9} />}
        title={title}
        subtitle={
          subtitle ??
          `${filtered.length} of ${rows.length} contracts · ${formatUsd(filtered.reduce((sum, row) => sum + row.monthlyCostCents, 0))}/month · ${formatUsd(
            filtered.reduce((sum, row) => sum + row.wasteCents, 0),
          )} identified waste`
        }
        action={
          <div className="flex flex-wrap items-center gap-2">
            <TextInput
              value={query}
              onChange={(value) => {
                setQuery(value);
                setPage(1);
              }}
              placeholder="Search vendor, category, owner"
              icon={<Search size={13} strokeWidth={2} />}
              className="w-52"
            />
            <SelectInput
              ariaLabel="Filter by category"
              value={category}
              onChange={(value) => {
                setCategory(value);
                setPage(1);
              }}
              options={[{ value: "all", label: "All categories" }, ...categories.map((item) => ({ value: item, label: item }))]}
            />
            <Button icon={<Download size={13} strokeWidth={2} />} onClick={exportCsv}>
              CSV
            </Button>
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-3.5 py-2.5">
        {(
          [
            ["all", "All"],
            ["healthy", "Clean"],
            ["review", "Unused seats"],
            ["zombie", "Zombie"],
            ["duplicate", "Overlapping"],
            ["critical", "Critical health"],
          ] as [HealthFilter, string][]
        ).map(([key, label]) => (
          <Chip
            key={key}
            tone={key === "zombie" || key === "critical" ? "crit" : key === "healthy" ? "brand" : "info"}
            active={health === key}
            onClick={() => {
              setHealth(key);
              setPage(1);
            }}
          >
            {label}
          </Chip>
        ))}
        {health !== "all" && (
          <Button
            tone="ghost"
            icon={<RotateCcw size={12} strokeWidth={2} />}
            onClick={() => {
              setHealth("all");
              setCategory("all");
              setQuery("");
            }}
          >
            Clear
          </Button>
        )}
        <span className="ml-auto text-[11px] text-ink-3">
          {showSelection ? "Select rows for bulk reclaim" : "Row click opens the vendor drawer"}
        </span>
      </div>

      {showSelection && selectedRows.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-surface-2/60 px-3.5 py-2.5">
          <p className="text-[11.5px] text-ink-2">
            <span className="num font-semibold text-ink">{selectedRows.length}</span> selected ·{" "}
            <span className="num text-crit">{formatUsd(reclaimable.reduce((sum, row) => sum + row.wasteCents, 0))}/mo</span> identified
            waste · <span className="num">{reclaimable.reduce((sum, row) => sum + row.staleSeats, 0)}</span> unused seats
          </p>
          <div className="flex items-center gap-2">
            <Button tone="ghost" icon={<Trash2 size={13} strokeWidth={2} />} onClick={() => setSelected([])}>
              Clear selection
            </Button>
            <Button
              tone="primary"
              disabled={reclaimable.length === 0}
              onClick={() => setBulkOpen(true)}
              icon={<ShieldCheck size={13} strokeWidth={2} />}
            >
              Reclaim unused seats ({reclaimable.length})
            </Button>
          </div>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[1020px] border-collapse text-left">
          <thead className="border-b border-line bg-surface-2/40">
            <tr>
              {showSelection && (
                <th scope="col" className="w-8 px-3 py-2">
                  <input
                    type="checkbox"
                    aria-label="Select all rows on this page"
                    checked={pageRows.length > 0 && pageRows.every((row) => selected.includes(row.id))}
                    onChange={(event) =>
                      setSelected((previous) =>
                        event.target.checked
                          ? [...new Set([...previous, ...pageRows.map((row) => row.id)])]
                          : previous.filter((id) => !pageRows.some((row) => row.id === id)),
                      )
                    }
                    className="h-3.5 w-3.5 accent-[var(--brand)]"
                  />
                </th>
              )}
              {header("vendor", "Vendor", "left")}
              <th scope="col" className="px-3 py-2 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-3">
                Category
              </th>
              {header("seats", "Paid seats")}
              {header("utilization", "Active")}
              <th scope="col" className="px-3 py-2 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-3">
                Utilization
              </th>
              {header("cost", "Monthly")}
              {header("waste", "Waste")}
              {header("health", "Health")}
              <th scope="col" className="px-3 py-2 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-3">
                Status
              </th>
              {header("renewal", "Renewal")}
              <th scope="col" className="px-3 py-2 text-right text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-3">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row) => {
              const status = statusOf(row);
              return (
                <tr
                  key={row.id}
                  className="border-b border-line/70 transition-colors hover:bg-surface-2/50"
                >
                  {showSelection && (
                    <td className="px-3 py-2.5">
                      <input
                        type="checkbox"
                        aria-label={`Select ${row.vendor}`}
                        checked={selected.includes(row.id)}
                        onChange={(event) =>
                          setSelected((previous) =>
                            event.target.checked ? [...new Set([...previous, row.id])] : previous.filter((id) => id !== row.id),
                          )
                        }
                        className="h-3.5 w-3.5 accent-[var(--brand)]"
                      />
                    </td>
                  )}
                  <td className="px-3 py-2.5">
                    <button
                      type="button"
                      onClick={() => onOpenVendor(row.id)}
                      className="focus-ring rounded text-left"
                    >
                      <span className="block text-[12.5px] font-medium text-ink hover:text-brand">{row.vendor}</span>
                      <span className="num block text-[10.5px] text-ink-3">
                        {row.billingModel === "per_seat"
                          ? `${formatUsd(row.unitCostCents, { exact: true })}/seat`
                          : row.billingModel === "usage"
                            ? "usage billed"
                            : "flat rate"}{" "}
                        · {row.contractOwner}
                      </span>
                    </button>
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="text-[12px] text-ink-2">{row.categoryGroup}</span>
                    {row.isDuplicate && (
                      <span className="mt-0.5 block text-[10.5px] text-info">overlaps category</span>
                    )}
                  </td>
                  <td className="num px-3 py-2.5 text-right text-[12px] text-ink-2">
                    {row.billingModel === "per_seat" ? row.seatsPaid : "—"}
                  </td>
                  <td className="num px-3 py-2.5 text-right text-[12px] text-ink-2">
                    {row.billingModel === "per_seat" ? row.activeSeats : "—"}
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className="num w-9 text-[11.5px] text-ink-2">{row.utilizationPct}%</span>
                      <span className="w-16">
                        <ProgressBar
                          value={row.utilizationPct}
                          tone={row.utilizationPct >= 80 ? "brand" : row.utilizationPct >= 55 ? "warn" : "crit"}
                          label={`${row.vendor} seat utilization`}
                        />
                      </span>
                    </div>
                  </td>
                  <td className="num px-3 py-2.5 text-right text-[12.5px] font-medium text-ink">
                    {formatUsd(row.monthlyCostCents)}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    {row.wasteCents > 0 ? (
                      <span className="num text-[12px] font-medium text-crit">−{formatUsd(row.wasteCents)}</span>
                    ) : (
                      <span className="text-[11px] text-ink-3">none</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    <HealthScore score={row.healthScore} grade={row.healthGrade} />
                  </td>
                  <td className="px-3 py-2.5">
                    <StatusBadge tone={status.tone} pulse={row.isZombie}>
                      {status.label}
                    </StatusBadge>
                    <span className="mt-0.5 block text-[10.5px] text-ink-3">{healthLabel(row.healthScore)}</span>
                  </td>
                  <td className="px-3 py-2.5">
                    {row.renewalDate ? (
                      <>
                        <span className="block text-[11.5px] text-ink-2">
                          {new Date(row.renewalDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                        </span>
                        <span className={`num block text-[10.5px] ${(row.renewalInDays ?? 999) <= 30 ? "text-warn" : "text-ink-3"}`}>
                          {row.renewalInDays === null ? "—" : `${row.renewalInDays} days`}
                        </span>
                      </>
                    ) : (
                      <span className="text-[11px] text-ink-3">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      {row.staleSeats > 0 && (
                        <Button
                          tone="primary"
                          onClick={() =>
                            workflow.request({
                              id: `inline-${row.id}`,
                              kind: "ghost_seats",
                              severity: "high",
                              vendorId: row.id,
                              vendor: row.vendor,
                              category: row.categoryGroup,
                              title: `${row.staleSeats} unused ${row.vendor} seat${row.staleSeats === 1 ? "" : "s"}`,
                              explanation: `Detected from the licence register: ${row.staleSeats} active seats with no recent authentication on ${row.vendor}.`,
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
                          Reclaim {row.staleSeats}
                        </Button>
                      )}
                      <Button tone="ghost" onClick={() => onOpenVendor(row.id)} title="Open vendor drawer">
                        <ExternalLink size={13} strokeWidth={2} />
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {filtered.length === 0 && (
        <EmptyState
          compact
          icon={<Search size={18} strokeWidth={1.8} />}
          title="No contracts match these filters"
          description="Try clearing the search box or resetting the category and health filters."
          action={
            <Button
              tone="neutral"
              onClick={() => {
                setQuery("");
                setCategory("all");
                setHealth("all");
              }}
            >
              Reset filters
            </Button>
          }
        />
      )}

      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-3.5 py-2.5">
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-ink-3">Rows per page</span>
          <SelectInput
            ariaLabel="Rows per page"
            value={String(pageSize)}
            onChange={(value) => {
              setPageSize(Number(value));
              setPage(1);
            }}
            options={pageSizeOptions.map((size) => ({ value: String(size), label: String(size) }))}
          />
          <span className="text-[11px] text-ink-3">
            {filtered.length === 0 ? "0" : `${(currentPage - 1) * pageSize + 1}–${Math.min(currentPage * pageSize, filtered.length)}`} of{" "}
            {filtered.length}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <Button tone="ghost" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>
            Previous
          </Button>
          <span className="num text-[11px] text-ink-3">
            Page {currentPage} / {totalPages}
          </span>
          <Button tone="ghost" disabled={currentPage >= totalPages} onClick={() => setPage(currentPage + 1)}>
            Next
          </Button>
        </div>
      </footer>

      <ConfirmDialog
        open={bulkOpen}
        busy={workflow.busy}
        onClose={() => setBulkOpen(false)}
        onConfirm={async () => {
          await workflow.bulkReclaim(
            reclaimable.map((row) => ({ vendorId: row.id, vendor: row.vendor, seats: row.staleSeats, monthlyCents: row.wasteCents })),
          );
          setSelected([]);
          setBulkOpen(false);
        }}
        title={`Reclaim seats across ${reclaimable.length} contract${reclaimable.length === 1 ? "" : "s"}?`}
        description="Each contract is updated individually so savings are never double-counted. Every change writes an audit entry."
        confirmLabel={`Reclaim ${formatUsd(selectedWaste)}/mo`}
        details={
          <ul className="max-h-56 space-y-1.5 overflow-y-auto">
            {reclaimable.map((row) => (
              <li key={row.id} className="flex items-center justify-between rounded-lg border border-line px-2.5 py-1.5 text-[11.5px]">
                <span className="text-ink">{row.vendor}</span>
                <span className="num text-ink-2">
                  {row.staleSeats} seats · {formatUsd(row.wasteCents)}/mo
                </span>
              </li>
            ))}
          </ul>
        }
      />
      {workflow.dialog}
      {subscriptions.length === 0 && <span className="hidden">loading</span>}
    </Card>
  );
}
