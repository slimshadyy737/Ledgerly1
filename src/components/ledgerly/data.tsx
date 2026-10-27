"use client";

/**
 * LedgerDataProvider — the single data source for every Ledgerly page.
 *
 * Fetches the sandbox company from the backend (analytics, subscription
 * register, audit ledger, tenants and raw ingestion ledgers), derives the view
 * models on the client, and exposes the write-back actions. The backend is the
 * source of truth: after an optimization the provider re-fetches everything so
 * every page recalculates from the same numbers.
 *
 * Dismissals are a sandbox-only convenience (localStorage) — documented in the
 * README as a known limitation; nothing is deleted server-side.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ledgerApi, ApiError } from "@/lib/ledgerly/api";
import {
  assertSavingsIntegrity,
  buildInventory,
  buildMetrics,
  buildOpportunities,
  buildReport,
  buildTeam,
  buildTrend,
  buildVendors,
  type InventoryRow,
  type Metrics,
  type Opportunity,
  type OpportunityAction,
  type ReportPayload,
  type TeamRow,
  type TrendPoint,
  type VendorProfile,
  type LedgerInput,
} from "@/lib/ledgerly/derive";
import type {
  AnalyticsResponse,
  CompaniesResponse,
  OptimizationEventDTO,
  OptimizeResponse,
  SubscriptionDTO,
} from "@/lib/spend/types";
import type { Snapshot } from "@/lib/types";
import { useToast } from "./ui";

const DISMISS_KEY = "ledgerly.dismissals.v1";

export interface OptimizeRequest {
  vendorId: number;
  vendor: string;
  /** "review" items never reach the backend — they are advisory only. */
  action: Exclude<OpportunityAction, "review">;
  seats?: number;
  reason: string;
  consolidateIntoSubscriptionId?: number;
}

interface LedgerDataValue {
  /* raw */
  analytics: AnalyticsResponse | null;
  subscriptions: SubscriptionDTO[];
  audit: OptimizationEventDTO[];
  companies: CompaniesResponse["data"];
  sandbox: Snapshot | null;
  /* derived */
  opportunities: Opportunity[];
  inventory: InventoryRow[];
  team: TeamRow[];
  vendors: VendorProfile[];
  metrics: Metrics | null;
  trend: TrendPoint[];
  integrity: { balanced: boolean; deltaCents: number };
  report: ReportPayload | null;
  activeOpportunities: Opportunity[];
  /* state */
  loading: boolean;
  refreshing: boolean;
  error: { message: string; code?: string } | null;
  lastSyncedAt: Date | null;
  companyId: number | null;
  sandboxTenantMismatch: boolean;
  dismissed: string[];
  /* actions */
  setCompanyId: (id: number | null) => void;
  refresh: (options?: { background?: boolean }) => Promise<void>;
  optimize: (request: OptimizeRequest) => Promise<OptimizeResponse | null>;
  dismiss: (id: string) => void;
  restore: (id: string) => void;
  resetDemo: () => Promise<void>;
  tenant: { name: string; id: number; domain: string } | null;
}

const LedgerDataContext = createContext<LedgerDataValue | null>(null);

function readDismissals(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(DISMISS_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : [];
  } catch {
    return [];
  }
}

export function LedgerDataProvider({ children }: { children: ReactNode }) {
  const { push } = useToast();
  const [analytics, setAnalytics] = useState<AnalyticsResponse | null>(null);
  const [subscriptions, setSubscriptions] = useState<SubscriptionDTO[]>([]);
  const [audit, setAudit] = useState<OptimizationEventDTO[]>([]);
  const [companies, setCompanies] = useState<CompaniesResponse["data"]>([]);
  const [sandbox, setSandbox] = useState<Snapshot | null>(null);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<{ message: string; code?: string } | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const [companyId, setCompanyId] = useState<number | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    setDismissed(readDismissals());
    return () => {
      alive.current = false;
    };
  }, []);

  const load = useCallback(
    async (options: { background?: boolean; signal?: AbortSignal } = {}) => {
      const { background = false, signal } = options;
      if (background) setRefreshing(true);
      else setLoading(true);

      const [analyticsResult, subscriptionsResult, auditResult, companiesResult, sandboxResult] =
        await Promise.allSettled([
          ledgerApi.analytics(companyId, signal),
          ledgerApi.subscriptions(companyId, signal),
          ledgerApi.audit(companyId, signal),
          ledgerApi.companies(signal),
          ledgerApi.ledgerSandbox(signal),
        ]);

      if (signal?.aborted || !alive.current) return;

      if (analyticsResult.status === "fulfilled") {
        setAnalytics(analyticsResult.value);
        setError(null);
      } else {
        const reason = analyticsResult.reason;
        setError({
          message: reason instanceof Error ? reason.message : "Could not load the analytics engine.",
          code: reason instanceof ApiError ? reason.code : undefined,
        });
      }

      if (subscriptionsResult.status === "fulfilled") setSubscriptions(subscriptionsResult.value.data);
      if (auditResult.status === "fulfilled") setAudit(auditResult.value.data);
      if (companiesResult.status === "fulfilled") setCompanies(companiesResult.value.data);
      if (sandboxResult.status === "fulfilled") setSandbox(sandboxResult.value);

      setLastSyncedAt(new Date());
      setLoading(false);
      setRefreshing(false);
    },
    [companyId],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load({ signal: controller.signal });
    return () => controller.abort();
  }, [load]);

  /* ------------------------------ derived data --------------------------- */
  /** Non-null only once the analytics engine has answered. */
  const baseInput = useMemo<LedgerInput | null>(
    () => (analytics ? { analytics, subscriptions, audit, sandbox, dismissedIds: dismissed } : null),
    [analytics, subscriptions, audit, sandbox, dismissed],
  );

  const opportunities = useMemo(() => (baseInput ? buildOpportunities(baseInput) : []), [baseInput]);
  const inventory = useMemo(() => (baseInput ? buildInventory(baseInput) : []), [baseInput]);
  const team = useMemo(() => buildTeam(sandbox), [sandbox]);
  const vendors = useMemo(() => (baseInput ? buildVendors(baseInput, opportunities) : []), [baseInput, opportunities]);
  const metrics = useMemo(() => (baseInput ? buildMetrics(baseInput, opportunities) : null), [baseInput, opportunities]);
  const trend = useMemo(() => buildTrend(sandbox, 6), [sandbox]);
  const integrity = useMemo(
    () => (analytics && metrics ? assertSavingsIntegrity(metrics, analytics) : { balanced: true, deltaCents: 0 }),
    [analytics, metrics],
  );
  const report = useMemo(
    () => (baseInput && metrics ? buildReport(baseInput, opportunities, metrics) : null),
    [baseInput, opportunities, metrics],
  );
  const activeOpportunities = useMemo(
    () => opportunities.filter((item) => !dismissed.includes(item.id)),
    [opportunities, dismissed],
  );

  const sandboxTenantMismatch = useMemo(() => {
    if (companyId === null || companies.length === 0) return false;
    return companyId !== companies[0]?.id;
  }, [companyId, companies]);

  /* -------------------------------- actions ------------------------------ */
  const refresh = useCallback(async (options: { background?: boolean } = {}) => {
    await load({ background: options.background ?? true });
  }, [load]);

  const optimize = useCallback(
    async (request: OptimizeRequest) => {
      try {
        const response = await ledgerApi.optimize(request.vendorId, {
          action: request.action,
          ...(request.action === "reclaim_seats" && request.seats ? { seatsToReclaim: request.seats } : {}),
          ...(request.consolidateIntoSubscriptionId
            ? { consolidateIntoSubscriptionId: request.consolidateIntoSubscriptionId }
            : {}),
          reason: request.reason,
          performedBy: "operator@ledgerly.app",
        });
        await load({ background: true });
        push({
          tone: "success",
          title: response.message,
          description: `Sandbox write-back complete — the audit ledger recorded event #${response.data.auditEventId}. Metrics recalculated from the database.`,
        });
        return response;
      } catch (caught) {
        push({
          tone: "error",
          title: "Optimization failed",
          description: caught instanceof Error ? caught.message : "Unknown error",
        });
        return null;
      }
    },
    [load, push],
  );

  const dismiss = useCallback(
    (id: string) => {
      setDismissed((previous) => {
        const next = [...new Set([...previous, id])];
        try {
          window.localStorage.setItem(DISMISS_KEY, JSON.stringify(next));
        } catch {
          /* ignore storage failures */
        }
        return next;
      });
      push({ tone: "info", title: "Opportunity dismissed", description: "Hidden locally in this browser only — the backend finding is unchanged." });
    },
    [push],
  );

  const restore = useCallback((id: string) => {
    setDismissed((previous) => {
      const next = previous.filter((entry) => entry !== id);
      try {
        window.localStorage.setItem(DISMISS_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const resetDemo = useCallback(async () => {
    try {
      const response = await ledgerApi.resetDemo();
      setDismissed([]);
      try {
        window.localStorage.removeItem(DISMISS_KEY);
      } catch {
        /* ignore */
      }
      await load({ background: true });
      push({
        tone: "success",
        title: "Sandbox reset",
        description: response.message,
      });
    } catch (caught) {
      push({
        tone: "error",
        title: "Reset failed",
        description: caught instanceof Error ? caught.message : "Unknown error",
      });
    }
  }, [load, push]);

  const tenant = useMemo(() => {
    const active = companies.find((company) => company.id === (companyId ?? companies[0]?.id));
    return active ? { name: active.name, id: active.id, domain: active.domain } : null;
  }, [companies, companyId]);

  const value = useMemo<LedgerDataValue>(
    () => ({
      analytics,
      subscriptions,
      audit,
      companies,
      sandbox,
      opportunities,
      inventory,
      team,
      vendors,
      metrics,
      trend,
      integrity,
      report,
      activeOpportunities,
      loading,
      refreshing,
      error,
      lastSyncedAt,
      companyId,
      sandboxTenantMismatch,
      dismissed,
      setCompanyId: (id) => {
        setCompanyId(id);
        setLoading(true);
      },
      refresh,
      optimize,
      dismiss,
      restore,
      resetDemo,
      tenant,
    }),
    [
      analytics, subscriptions, audit, companies, sandbox, opportunities, inventory, team, vendors,
      metrics, trend, integrity, report, activeOpportunities, loading, refreshing, error, lastSyncedAt,
      companyId, sandboxTenantMismatch, dismissed, refresh, optimize, dismiss, restore, resetDemo, tenant,
    ],
  );

  return <LedgerDataContext.Provider value={value}>{children}</LedgerDataContext.Provider>;
}

export function useLedgerData(): LedgerDataValue {
  const context = useContext(LedgerDataContext);
  if (!context) throw new Error("useLedgerData must be used inside <LedgerDataProvider>");
  return context;
}
