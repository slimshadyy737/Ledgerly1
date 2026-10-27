"use client";

/**
 * ---------------------------------------------------------------------------
 * LEDGERLY — application shell (LedgerDataProvider · Sidebar · Topbar ·
 * Command palette · notification centre · workspace switcher)
 * ---------------------------------------------------------------------------
 * Desktop-first, responsive down to mobile (sidebar becomes an overlay sheet,
 * tables scroll horizontally, filters wrap). Navigation, search, theme and all
 * data come from real sandbox state.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  AlertTriangle,
  BarChart3,
  Bell,
  Building2,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  Command,
  FileText,
  History,
  LayoutDashboard,
  LifeBuoy,
  Menu,
  RefreshCw,
  Search,
  Settings,
  Sparkles,
  UserRound,
  Users,
  X,
} from "lucide-react";
import { LedgerDataProvider, useLedgerData } from "./data";
import { ThemeSelector, useTheme } from "@/lib/ledgerly/theme";
import {
  BadgeTone,
  Button,
  Card,
  Chip,
  DemoBadge,
  IconButton,
  SelectInput,
  StatusBadge,
  formatUsd,
} from "./ui";

/* --------------------------------- shell UI -------------------------------- */

interface ShellContextValue {
  trendMonths: number;
  setTrendMonths: (months: number) => void;
  collapsed: boolean;
  setCollapsed: (value: boolean) => void;
  openPalette: () => void;
}

const ShellContext = createContext<ShellContextValue | null>(null);

export function useShell(): ShellContextValue {
  const context = useContext(ShellContext);
  if (!context) throw new Error("useShell must be used inside <AppShell>");
  return context;
}

export const NAV_ITEMS = [
  { href: "/", label: "Overview", icon: LayoutDashboard, hint: "Spend intelligence" },
  { href: "/analytics", label: "Spend Analytics", icon: BarChart3, hint: "Categories & trends" },
  { href: "/subscriptions", label: "Subscriptions", icon: CircleDollarSign, hint: "Contract register" },
  { href: "/optimization", label: "Optimization Center", icon: Sparkles, hint: "Detected opportunities" },
  { href: "/team", label: "Team & Seats", icon: Users, hint: "People and licences" },
  { href: "/vendors", label: "Vendors", icon: Building2, hint: "Vendor profiles" },
  { href: "/reports", label: "Reports", icon: FileText, hint: "Savings report" },
  { href: "/audit", label: "Audit Log", icon: History, hint: "Simulated actions" },
] as const;

const MOBILE_BREAKPOINT = "(max-width: 1023px)";

/* ------------------------------- brand mark -------------------------------- */

function LedgerMark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden role="presentation">
      <rect x="2.5" y="2.5" width="19" height="19" rx="5" fill="var(--surface-2)" stroke="var(--line)" />
      <rect x="6.5" y="7" width="11" height="1.8" rx="0.9" fill="var(--brand)" />
      <rect x="6.5" y="11.1" width="7.5" height="1.8" rx="0.9" fill="var(--brand)" opacity="0.62" />
      <rect x="6.5" y="15.2" width="9.5" height="1.8" rx="0.9" fill="var(--ink-3)" />
      <path d="M17.4 15.2v1.8h-1.4" fill="none" stroke="var(--brand)" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

/* --------------------------------- sidebar -------------------------------- */

function Sidebar({
  collapsed,
  onToggle,
  mobileOpen,
  onCloseMobile,
}: {
  collapsed: boolean;
  onToggle: () => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}) {
  const pathname = usePathname();
  const { tenant, companies, companyId, setCompanyId, sandboxTenantMismatch } = useLedgerData();

  const nav = (
    <nav aria-label="Primary" className="flex-1 space-y-0.5 overflow-y-auto px-2 py-2">
      {NAV_ITEMS.map((item) => {
        const active = pathname === item.href;
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onCloseMobile}
            aria-current={active ? "page" : undefined}
            title={collapsed ? item.label : undefined}
            className={`focus-ring group relative flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium transition-colors ${
              active ? "bg-surface-2 text-ink" : "text-ink-2 hover:bg-surface-2/60 hover:text-ink"
            }`}
          >
            {active && (
              <span
                aria-hidden
                className="absolute left-0 top-1/2 h-5 w-[2.5px] -translate-y-1/2 rounded-full"
                style={{ background: "var(--brand)" }}
              />
            )}
            <Icon size={16} strokeWidth={1.9} className={active ? "text-brand" : "text-ink-3 group-hover:text-ink-2"} />
            {!collapsed && <span className="truncate">{item.label}</span>}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <>
      {/* mobile scrim */}
      {mobileOpen && (
        <div
          className="animate-fade fixed inset-0 z-40 lg:hidden"
          style={{ background: "var(--overlay)" }}
          onClick={onCloseMobile}
          aria-hidden
        />
      )}

      <aside
        className={`no-print fixed inset-y-0 left-0 z-50 flex flex-col border-r border-line transition-[width,transform] duration-200 lg:sticky lg:top-0 lg:z-30 lg:h-screen lg:translate-x-0 ${
          collapsed ? "w-[68px]" : "w-[248px]"
        } ${mobileOpen ? "translate-x-0" : "-translate-x-full"}`}
        style={{ background: "var(--sidebar)" }}
        aria-label="Ledgerly navigation"
      >
        {/* brand */}
        <div className="flex h-14 items-center gap-2.5 border-b border-line px-3">
          <Link href="/" onClick={onCloseMobile} className="focus-ring flex min-w-0 items-center gap-2.5">
            <LedgerMark />
            {!collapsed && (
              <span className="flex min-w-0 flex-col leading-tight">
                <span className="truncate text-[13px] font-semibold tracking-[0.14em] text-ink">LEDGERLY</span>
                <span className="truncate text-[9.5px] font-medium uppercase tracking-[0.16em] text-ink-3">
                  SaaS spend control
                </span>
              </span>
            )}
          </Link>
          <div className="ml-auto flex items-center gap-1">
            <IconButton label="Close navigation" className="lg:hidden" onClick={onCloseMobile}>
              <X size={14} strokeWidth={2} />
            </IconButton>
            <IconButton
              label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              className="hidden lg:inline-flex"
              onClick={onToggle}
            >
              {collapsed ? <ChevronRight size={14} strokeWidth={2} /> : <ChevronLeft size={14} strokeWidth={2} />}
            </IconButton>
          </div>
        </div>

        {!collapsed && (
          <div className="flex items-center gap-2 border-b border-line px-3 py-2">
            <DemoBadge label="Sandbox" />
            {sandboxTenantMismatch && (
              <span className="truncate text-[10px] text-ink-3" title="Ingestion ledgers always describe the primary demo company">
                ledgers: primary tenant
              </span>
            )}
          </div>
        )}

        {nav}

        {/* bottom cluster */}
        <div className="space-y-2 border-t border-line p-2">
          {!collapsed ? (
            <label className="block">
              <span className="label-xs px-1">Workspace</span>
              <SelectInput
                ariaLabel="Switch workspace"
                className="mt-1 w-full"
                value={String(companyId ?? companies[0]?.id ?? "")}
                onChange={(value) => setCompanyId(Number(value))}
                options={
                  companies.length > 0
                    ? companies.map((company) => ({
                        value: String(company.id),
                        label: `${company.name} · ${company.active_subscriptions} contracts`,
                      }))
                    : [{ value: "", label: "No workspace loaded" }]
                }
              />
            </label>
          ) : (
            <IconButton label="Workspace switcher" className="w-full">
              <Building2 size={15} strokeWidth={1.9} />
            </IconButton>
          )}

          <div className={`flex ${collapsed ? "flex-col" : "items-center gap-1"}`}>
            <Link
              href="/settings"
              onClick={onCloseMobile}
              className={`focus-ring flex items-center gap-2 rounded-lg px-2.5 py-2 text-[12.5px] text-ink-2 transition-colors hover:bg-surface-2/60 hover:text-ink ${
                collapsed ? "justify-center" : "flex-1"
              }`}
            >
              <Settings size={15} strokeWidth={1.9} className="text-ink-3" />
              {!collapsed && "Settings"}
            </Link>
            <a
              href="/workspace"
              target="_blank"
              rel="noreferrer"
              className={`focus-ring flex items-center gap-2 rounded-lg px-2.5 py-2 text-[12.5px] text-ink-2 transition-colors hover:bg-surface-2/60 hover:text-ink ${
                collapsed ? "justify-center" : "flex-1"
              }`}
              title="Open the raw ingestion console (statement, SSO log, roster)"
            >
              <LifeBuoy size={15} strokeWidth={1.9} className="text-ink-3" />
              {!collapsed && "Help"}
            </a>
          </div>

          <div className={`flex items-center gap-2 rounded-lg border border-line bg-surface px-2 py-1.5 ${collapsed ? "justify-center" : ""}`}>
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand/15 text-[10px] font-semibold text-brand">
              RC
            </span>
            {!collapsed && (
              <span className="min-w-0 leading-tight">
                <span className="block truncate text-[11.5px] font-medium text-ink">R. Chandra</span>
                <span className="block truncate text-[10px] uppercase tracking-[0.08em] text-ink-3">CFO · Admin</span>
              </span>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}

/* --------------------------------- topbar --------------------------------- */

function Topbar({ onOpenMobile }: { onOpenMobile: () => void }) {
  const pathname = usePathname();
  const { companies, companyId, setCompanyId } = useLedgerData();
  const { trendMonths, setTrendMonths, openPalette } = useShell();
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);

  const active =
    NAV_ITEMS.find((item) => item.href === pathname) ?? NAV_ITEMS[0];

  return (
    <header className="no-print sticky top-0 z-30 border-b border-line backdrop-blur-md" style={{ background: "color-mix(in oklab, var(--canvas) 88%, transparent)" }}>
      <div className="flex flex-wrap items-center gap-2 px-3 py-2.5 sm:px-4">
        <IconButton label="Open navigation" className="lg:hidden" onClick={onOpenMobile}>
          <Menu size={16} strokeWidth={2} />
        </IconButton>

        {/* breadcrumb + context title */}
        <div className="min-w-0 flex-1">
          <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-[11px] text-ink-3">
            <Link href="/" className="transition-colors hover:text-ink-2">
              Ledgerly
            </Link>
            <span aria-hidden>/</span>
            <span className="truncate text-ink-2">{active.label}</span>
          </nav>
          <div className="flex items-center gap-2">
            <h1 className="truncate text-[15px] font-semibold tracking-tight text-ink">{active.label}</h1>
            <span className="hidden text-[11px] text-ink-3 sm:inline">{active.hint}</span>
          </div>
        </div>

        {/* search trigger */}
        <button
          type="button"
          onClick={openPalette}
          className="focus-ring hidden h-8 items-center gap-2 rounded-lg border border-line bg-surface px-2.5 text-xs text-ink-3 transition-colors hover:border-line-strong hover:text-ink-2 sm:inline-flex"
        >
          <Search size={14} strokeWidth={2} />
          <span>Search or jump to…</span>
          <kbd className="ml-2 inline-flex items-center gap-0.5 rounded border border-line bg-surface-2 px-1 py-0.5 font-mono text-[10px] text-ink-3">
            <Command size={9} strokeWidth={2.4} />K
          </kbd>
        </button>

        <div className="flex items-center gap-1.5">
          <div className="hidden md:block">
            <SelectInput
              ariaLabel="Statement window"
              value={String(trendMonths)}
              onChange={(value) => setTrendMonths(Number(value))}
              options={[
                { value: "3", label: "Last 3 statements" },
                { value: "6", label: "Last 6 statements" },
              ]}
            />
          </div>

          <div className="relative">
            <IconButton label="Notification centre" onClick={() => setNotificationsOpen((open) => !open)} active={notificationsOpen}>
              <Bell size={15} strokeWidth={1.9} />
            </IconButton>
            {notificationsOpen && <NotificationCentre onClose={() => setNotificationsOpen(false)} />}
          </div>

          <div className="hidden sm:block">
            <ThemeSelector compact />
          </div>

          <div className="relative">
            <button
              type="button"
              onClick={() => setProfileOpen((open) => !open)}
              className="focus-ring flex h-8 items-center gap-2 rounded-lg border border-line bg-surface px-1.5 pr-2 text-xs text-ink-2 transition-colors hover:border-line-strong hover:text-ink"
              aria-haspopup="menu"
              aria-expanded={profileOpen}
            >
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-brand/15 text-[9.5px] font-semibold text-brand">
                RC
              </span>
              <UserRound size={13} strokeWidth={2} className="hidden sm:block" />
            </button>
            {profileOpen && (
              <div
                role="menu"
                className="animate-fade-up absolute right-0 top-10 z-40 w-64 rounded-xl border border-line bg-surface p-3 shadow-[var(--shadow-3)]"
              >
                <div className="flex items-center gap-2.5">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand/15 text-[11px] font-semibold text-brand">
                    RC
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-[12.5px] font-medium text-ink">Riya Chandra</p>
                    <p className="truncate text-[11px] text-ink-3">cfo@northwind.io · Admin</p>
                  </div>
                </div>
                <div className="mt-3 space-y-1 border-t border-line pt-3">
                  <p className="label-xs">Workspace</p>
                  <SelectInput
                    ariaLabel="Switch workspace"
                    className="w-full"
                    value={String(companyId ?? companies[0]?.id ?? "")}
                    onChange={(value) => setCompanyId(Number(value))}
                    options={
                      companies.length > 0
                        ? companies.map((company) => ({ value: String(company.id), label: company.name }))
                        : [{ value: "", label: "No workspace" }]
                    }
                  />
                </div>
                <div className="mt-3 border-t border-line pt-3">
                  <ThemeSelector />
                </div>
                <Link
                  href="/settings"
                  onClick={() => setProfileOpen(false)}
                  className="focus-ring mt-3 flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
                >
                  <Settings size={14} strokeWidth={1.9} /> Sandbox &amp; data settings
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}

function NotificationCentre({ onClose }: { onClose: () => void }) {
  const { activeOpportunities, audit, refresh, refreshing } = useLedgerData();
  const urgent = activeOpportunities.filter((item) => item.monthlyCents > 0).slice(0, 4);

  return (
    <div
      role="dialog"
      aria-label="Notifications"
      className="animate-fade-up absolute right-0 top-10 z-40 w-[min(94vw,26rem)] rounded-xl border border-line bg-surface shadow-[var(--shadow-3)]"
    >
      <header className="flex items-center justify-between border-b border-line px-3.5 py-2.5">
        <div>
          <p className="text-[13px] font-semibold text-ink">Notification centre</p>
          <p className="text-[11px] text-ink-3">Detection results and recent sandbox actions</p>
        </div>
        <IconButton label="Close notifications" onClick={onClose}>
          <X size={14} strokeWidth={2} />
        </IconButton>
      </header>
      <div className="max-h-80 overflow-y-auto p-3">
        <p className="label-xs">Detected waste</p>
        <ul className="mt-1.5 space-y-1.5">
          {urgent.map((item) => (
            <li key={item.id} className="rounded-lg border border-line bg-surface-2/60 p-2.5">
              <div className="flex items-start justify-between gap-2">
                <p className="text-[12px] font-medium text-ink">{item.title}</p>
                <span className="num shrink-0 text-[11px] font-semibold text-crit">−{formatUsd(item.monthlyCents)}/mo</span>
              </div>
              <p className="mt-0.5 text-[11px] text-ink-3">
                {item.vendor} · {item.seatsAffected} seats · {fmtConfidence(item.confidence)}
              </p>
            </li>
          ))}
          {urgent.length === 0 && <li className="text-[11px] text-ink-3">No open waste findings.</li>}
        </ul>

        <p className="label-xs mt-4">Recent simulated actions</p>
        <ul className="mt-1.5 space-y-1.5">
          {audit.slice(0, 3).map((event) => (
            <li key={event.id} className="flex items-start gap-2 rounded-lg border border-line bg-surface-2/60 p-2.5">
              <Sparkles size={13} strokeWidth={2} className="mt-0.5 text-brand" />
              <div className="min-w-0">
                <p className="text-[12px] text-ink">
                  {event.action.replace(/_/g, " ")} · {event.vendorName}
                </p>
                <p className="text-[11px] text-ink-3">
                  {event.savingsDisplay}/mo · {new Date(event.createdAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                </p>
              </div>
            </li>
          ))}
          {audit.length === 0 && <li className="text-[11px] text-ink-3">No actions applied yet.</li>}
        </ul>
      </div>
      <footer className="flex items-center justify-between gap-2 border-t border-line px-3.5 py-2.5">
        <Button tone="ghost" icon={<RefreshCw size={13} strokeWidth={2} />} busy={refreshing} onClick={() => void refresh()}>
          Re-sync backend
        </Button>
        <Link href="/optimization" onClick={onClose} className="focus-ring rounded-lg px-2 py-1 text-xs font-medium text-brand">
          Open optimization center
        </Link>
      </footer>
    </div>
  );
}

function fmtConfidence(confidence: number) {
  return confidence >= 0.9 ? "high confidence" : confidence >= 0.75 ? "medium confidence" : "needs review";
}

/* ----------------------------- command palette ----------------------------- */

interface PaletteCommand {
  id: string;
  label: string;
  hint: string;
  group: "Navigate" | "Actions";
  icon: ReactNode;
  run: () => void;
}

function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const { refresh, resetDemo, activeOpportunities, metrics } = useLedgerData();
  const { setTheme } = useTheme();
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);

  const commands = useMemo<PaletteCommand[]>(() => {
    const nav: PaletteCommand[] = NAV_ITEMS.map((item) => {
      const Icon = item.icon;
      return {
        id: `go-${item.href}`,
        label: item.label,
        hint: item.hint,
        group: "Navigate",
        icon: <Icon size={14} strokeWidth={1.9} />,
        run: () => router.push(item.href),
      };
    });
    const actions: PaletteCommand[] = [
      {
        id: "action-refresh",
        label: "Re-sync sandbox data",
        hint: "Re-run the analytics query against PostgreSQL",
        group: "Actions",
        icon: <RefreshCw size={14} strokeWidth={1.9} />,
        run: () => void refresh(),
      },
      {
        id: "action-theme-dark",
        label: "Theme: dark",
        hint: "Midnight Ledger (default)",
        group: "Actions",
        icon: <Sparkles size={14} strokeWidth={1.9} />,
        run: () => setTheme("dark"),
      },
      {
        id: "action-theme-light",
        label: "Theme: light",
        hint: "Daylight ledger",
        group: "Actions",
        icon: <Sparkles size={14} strokeWidth={1.9} />,
        run: () => setTheme("light"),
      },
      {
        id: "action-theme-system",
        label: "Theme: follow system",
        hint: "Match the operating system preference",
        group: "Actions",
        icon: <Sparkles size={14} strokeWidth={1.9} />,
        run: () => setTheme("system"),
      },
      {
        id: "action-reset",
        label: "Reset sandbox demo data",
        hint: "Reload the deterministic 80-employee company",
        group: "Actions",
        icon: <AlertTriangle size={14} strokeWidth={1.9} />,
        run: () => void resetDemo(),
      },
    ];
    return [...nav, ...actions];
  }, [refresh, resetDemo, router, setTheme]);

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return commands;
    return commands.filter(
      (command) => command.label.toLowerCase().includes(needle) || command.hint.toLowerCase().includes(needle),
    );
  }, [commands, query]);

  useEffect(() => {
    setCursor(0);
  }, [query, open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        setCursor((value) => Math.min(value + 1, results.length - 1));
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setCursor((value) => Math.max(value - 1, 0));
      } else if (event.key === "Enter") {
        const command = results[cursor];
        if (command) {
          event.preventDefault();
          command.run();
          onClose();
        }
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose, results, cursor]);

  if (!open) return null;

  return (
    <div className="no-print fixed inset-0 z-[75] flex items-start justify-center p-4 pt-[12vh]">
      <div className="animate-fade fixed inset-0" style={{ background: "var(--overlay)" }} onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="animate-fade-up relative w-full max-w-xl overflow-hidden rounded-xl border border-line bg-surface shadow-[var(--shadow-3)]"
      >
        <div className="flex items-center gap-2 border-b border-line px-3.5 py-3">
          <Search size={15} strokeWidth={2} className="text-ink-3" />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search pages, actions and vendors…"
            aria-label="Command search"
            className="w-full bg-transparent text-[13px] text-ink placeholder:text-ink-3 focus:outline-none"
          />
          <kbd className="rounded border border-line bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-ink-3">esc</kbd>
        </div>

        <div className="max-h-[52vh] overflow-y-auto p-2">
          {(["Navigate", "Actions"] as const).map((group) => {
            const groupItems = results.filter((command) => command.group === group);
            if (groupItems.length === 0) return null;
            return (
              <div key={group} className="mb-1">
                <p className="label-xs px-2.5 py-1.5">{group}</p>
                <ul>
                  {groupItems.map((command) => {
                    const index = results.indexOf(command);
                    return (
                      <li key={command.id}>
                        <button
                          type="button"
                          onMouseEnter={() => setCursor(index)}
                          onClick={() => {
                            command.run();
                            onClose();
                          }}
                          className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors ${
                            index === cursor ? "bg-surface-2 text-ink" : "text-ink-2 hover:bg-surface-2/60"
                          }`}
                        >
                          <span className="text-ink-3">{command.icon}</span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[12.5px] font-medium">{command.label}</span>
                            <span className="block truncate text-[11px] text-ink-3">{command.hint}</span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
          {results.length === 0 && <p className="px-3 py-6 text-center text-xs text-ink-3">Nothing matches “{query}”.</p>}
        </div>

        <footer className="flex items-center justify-between border-t border-line px-3.5 py-2 text-[11px] text-ink-3">
          <span className="flex items-center gap-3">
            <span>↑↓ navigate</span>
            <span>↵ select</span>
            <span>esc close</span>
          </span>
          <span className="num">
            {metrics ? `${formatUsd(metrics.identifiedSavingsCents)}/mo identified` : `${activeOpportunities.length} findings`}
          </span>
        </footer>
      </div>
    </div>
  );
}

/* -------------------------------- app shell -------------------------------- */

function ShellFrame({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [trendMonths, setTrendMonths] = useState(6);
  const [offline, setOffline] = useState(false);
  const { error } = useLedgerData();

  // Persist the collapse preference locally.
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem("ledgerly.sidebar");
      if (stored === "collapsed") setCollapsed(true);
    } catch {
      /* ignore */
    }
  }, []);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((value) => {
      try {
        window.localStorage.setItem("ledgerly.sidebar", value ? "expanded" : "collapsed");
      } catch {
        /* ignore */
      }
      return !value;
    });
  }, []);

  // Global shortcuts: ⌘K / Ctrl+K search, ⌘B sidebar, ⌘⇧R reset, ⌘/ theme.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const meta = event.metaKey || event.ctrlKey;
      if (meta && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen(true);
      } else if (meta && event.key.toLowerCase() === "b") {
        event.preventDefault();
        toggleCollapsed();
      } else if (event.key === "/" && !meta && !(event.target as HTMLElement)?.matches("input, textarea")) {
        event.preventDefault();
        setPaletteOpen(true);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [toggleCollapsed]);

  // Close the mobile sheet when the layout grows past the desktop breakpoint.
  useEffect(() => {
    const query = window.matchMedia(MOBILE_BREAKPOINT);
    const listener = () => {
      if (!query.matches) setMobileOpen(false);
    };
    query.addEventListener("change", listener);
    return () => query.removeEventListener("change", listener);
  }, []);

  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  const shellValue = useMemo<ShellContextValue>(
    () => ({ trendMonths, setTrendMonths, collapsed, setCollapsed: toggleCollapsed, openPalette: () => setPaletteOpen(true) }),
    [trendMonths, collapsed, toggleCollapsed],
  );

  return (
    <ShellContext.Provider value={shellValue}>
      <div className="flex min-h-screen" style={{ background: "var(--canvas)" }}>
        <Sidebar
          collapsed={collapsed}
          onToggle={toggleCollapsed}
          mobileOpen={mobileOpen}
          onCloseMobile={() => setMobileOpen(false)}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar onOpenMobile={() => setMobileOpen(true)} />
          {(offline || error) && (
            <div className="no-print border-b border-crit/30 bg-crit/10 px-4 py-2 text-[11.5px] text-crit">
              {offline
                ? "You are offline. Ledgerly is showing the last data it received."
                : `Backend problem: ${error?.message}${error?.code ? ` (${error.code})` : ""}`}
            </div>
          )}
          <main className="min-w-0 flex-1 px-3 py-4 sm:px-4 sm:py-5">{children}</main>
          <footer className="no-print border-t border-line px-4 py-3 text-[11px] leading-relaxed text-ink-3">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <DemoBadge />
              <span>
                All figures come from the seeded sandbox company. Actions write to the sandbox database only — no real vendor
                account is touched.
              </span>
              <Chip tone={"info" as BadgeTone}>Demo data</Chip>
            </div>
          </footer>
        </div>
      </div>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </ShellContext.Provider>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <LedgerDataProvider>
      <ShellFrame>{children}</ShellFrame>
    </LedgerDataProvider>
  );
}
