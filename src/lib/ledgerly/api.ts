/**
 * Centralised, typed API client for Ledgerly.
 *
 * Every network call in the app goes through this module so error handling,
 * timeouts and the response contract live in exactly one place. The backend
 * (Next.js route handlers over PostgreSQL) remains the source of truth for all
 * mutations.
 */
import type {
  AnalyticsResponse,
  CompaniesResponse,
  OptimizeAction,
  OptimizeResponse,
  OptimizationsResponse,
  SubscriptionDetailDTO,
  SubscriptionsListResponse,
} from "@/lib/spend/types";
import type { Snapshot } from "@/lib/types";

export const REQUEST_TIMEOUT_MS = 10_000;

export class ApiError extends Error {
  status: number;
  code: string;
  isOffline: boolean;
  constructor(message: string, options: { status?: number; code?: string; isOffline?: boolean } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = options.status ?? 0;
    this.code = options.code ?? "unknown_error";
    this.isOffline = options.isOffline ?? false;
  }
}

async function request<T>(
  url: string,
  options: { method?: "GET" | "POST"; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const { method = "GET", body, signal } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("timeout")), REQUEST_TIMEOUT_MS);
  const forward = () => controller.abort(signal?.reason);
  signal?.addEventListener("abort", forward, { once: true });

  try {
    const response = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
      cache: "no-store",
    });
    const text = await response.text();
    const payload: unknown = text ? JSON.parse(text) : null;

    if (!response.ok) {
      const shaped = payload as { error?: { code?: string; message?: string } } | null;
      throw new ApiError(shaped?.error?.message ?? `Request failed (HTTP ${response.status})`, {
        status: response.status,
        code: shaped?.error?.code ?? `http_${response.status}`,
      });
    }
    return payload as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    const aborted = error instanceof Error && /timeout|abort/i.test(error.message);
    throw new ApiError(
      aborted
        ? `The backend did not respond within ${REQUEST_TIMEOUT_MS / 1000}s.`
        : "Cannot reach the Ledgerly backend. It may be offline.",
      { isOffline: true, code: aborted ? "backend_timeout" : "backend_offline" },
    );
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", forward);
  }
}

const scope = (companyId: number | null) => (companyId === null ? "" : `companyId=${companyId}`);

export const ledgerApi = {
  analytics: (companyId: number | null = null, signal?: AbortSignal) =>
    request<AnalyticsResponse>(`/api/analytics?limit=200${scope(companyId) ? `&${scope(companyId)}` : ""}`, { signal }),

  subscriptions: (companyId: number | null = null, signal?: AbortSignal) =>
    request<SubscriptionsListResponse>(
      `/api/subscriptions?pageSize=200&sort=monthlyCost&order=desc${scope(companyId) ? `&${scope(companyId)}` : ""}`,
      { signal },
    ),

  audit: (companyId: number | null = null, signal?: AbortSignal) =>
    request<OptimizationsResponse>(`/api/analytics/optimizations?limit=100${scope(companyId) ? `&${scope(companyId)}` : ""}`, {
      signal,
    }),

  companies: (signal?: AbortSignal) => request<CompaniesResponse>("/api/companies", { signal }),

  /** Raw ingestion ledgers (employees, statement rows, SSO log) — primary demo tenant only. */
  ledgerSandbox: (signal?: AbortSignal) => request<Snapshot>("/api/dashboard", { signal }),

  subscriptionDetail: (id: number, signal?: AbortSignal) =>
    request<{ ok: true; data: SubscriptionDetailDTO }>(`/api/subscriptions/${id}`, { signal }),

  optimize: (
    id: number,
    body: {
      action: OptimizeAction;
      seatsToReclaim?: number;
      reason?: string;
      performedBy?: string;
      consolidateIntoSubscriptionId?: number;
    },
    signal?: AbortSignal,
  ) => request<OptimizeResponse>(`/api/subscriptions/${id}/optimize`, { method: "POST", body, signal }),

  /** Rebuilds the sandbox company (truncate + deterministic reload) in the database. */
  resetDemo: (signal?: AbortSignal) =>
    request<{ ok: true; message: string; summary?: Record<string, number> }>("/api/demo/reset", {
      method: "POST",
      signal,
    }),
};

export type { SubscriptionDetailDTO, OptimizeResponse, OptimizationsResponse };
