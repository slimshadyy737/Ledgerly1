"use client";

/**
 * ---------------------------------------------------------------------------
 * Live API client — the single place the React dashboard talks to the backend.
 * ---------------------------------------------------------------------------
 * Everything is plain `fetch` against the REST contract:
 *
 *   GET  /api/analytics                        spend + waste calculations
 *   GET  /api/subscriptions                    contract register
 *   GET  /api/analytics/optimizations          applied optimizations (audit)
 *   GET  /api/companies                        tenants
 *   POST /api/subscriptions/:id/optimize       write-back + audit row
 *
 * Design notes
 *  • Every call has an AbortController timeout (BACKEND_TIMEOUT_MS) so an
 *    unreachable backend fails in ~8s instead of hanging the UI forever.
 *  • Errors are normalised into `LiveApiError` with a human message, an HTTP
 *    status and a `isOffline` flag so components can render an offline state.
 *  • `signal` is accepted so unmounting the dashboard cancels in-flight calls.
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

export const BACKEND_TIMEOUT_MS = 8_000;

export class LiveApiError extends Error {
  status: number;
  code: string;
  isOffline: boolean;

  constructor(message: string, options: { status?: number; code?: string; isOffline?: boolean } = {}) {
    super(message);
    this.name = "LiveApiError";
    this.status = options.status ?? 0;
    this.code = options.code ?? "unknown_error";
    this.isOffline = options.isOffline ?? false;
  }
}

interface RequestOptions {
  method?: "GET" | "POST";
  body?: unknown;
  signal?: AbortSignal;
  timeoutMs?: number;
}

/** Performs one JSON request with a timeout, normalising every failure mode. */
export async function apiRequest<T>(url: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, signal, timeoutMs = BACKEND_TIMEOUT_MS } = options;
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(new Error("timeout")), timeoutMs);

  // Combine the caller's signal with the timeout signal.
  const onAbort = () => timeout.abort(signal?.reason);
  signal?.addEventListener("abort", onAbort, { once: true });

  try {
    const response = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: timeout.signal,
      cache: "no-store",
    });

    const text = await response.text();
    const payload = text ? (JSON.parse(text) as unknown) : null;

    if (!response.ok) {
      const errorPayload = payload as { error?: { code?: string; message?: string } } | null;
      throw new LiveApiError(
        errorPayload?.error?.message ?? `Request to ${url} failed with HTTP ${response.status}`,
        { status: response.status, code: errorPayload?.error?.code ?? `http_${response.status}` },
      );
    }

    return payload as T;
  } catch (error) {
    if (error instanceof LiveApiError) throw error;

    // AbortError covers both the timeout above and an explicit unmount abort.
    const isTimeout = error instanceof Error && /timeout|abort/i.test(error.message);
    throw new LiveApiError(
      isTimeout
        ? `The spend API did not respond within ${timeoutMs / 1000}s (${url}).`
        : `Cannot reach the spend API at ${url}. The backend may be offline.`,
      { isOffline: true, code: isTimeout ? "backend_timeout" : "backend_offline" },
    );
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

/* --------------------------- typed endpoint helpers ------------------------ */

export function fetchAnalytics(companyId: number | null, signal?: AbortSignal) {
  const query = new URLSearchParams({ limit: "200" });
  if (companyId !== null) query.set("companyId", String(companyId));
  return apiRequest<AnalyticsResponse>(`/api/analytics?${query.toString()}`, { signal });
}

export function fetchSubscriptions(companyId: number | null, signal?: AbortSignal) {
  const query = new URLSearchParams({ pageSize: "200", sort: "monthlyCost", order: "desc" });
  if (companyId !== null) query.set("companyId", String(companyId));
  return apiRequest<SubscriptionsListResponse>(`/api/subscriptions?${query.toString()}`, { signal });
}

export function fetchOptimizations(companyId: number | null, signal?: AbortSignal) {
  const query = new URLSearchParams({ limit: "25" });
  if (companyId !== null) query.set("companyId", String(companyId));
  return apiRequest<OptimizationsResponse>(`/api/analytics/optimizations?${query.toString()}`, { signal });
}

export function fetchCompanies(signal?: AbortSignal) {
  return apiRequest<CompaniesResponse>("/api/companies", { signal });
}

export function fetchSubscriptionDetail(subscriptionId: number, signal?: AbortSignal) {
  return apiRequest<{ ok: true; data: SubscriptionDetailDTO }>(`/api/subscriptions/${subscriptionId}`, {
    signal,
  });
}

/** The write-back call. `seats` maps to `seatsToReclaim`. */
export function optimizeSubscriptionRequest(
  subscriptionId: number,
  payload: {
    action: OptimizeAction;
    seats?: number;
    reason?: string;
    performedBy?: string;
    allowActiveSeats?: boolean;
    consolidateIntoSubscriptionId?: number;
  },
  signal?: AbortSignal,
) {
  const { seats, ...rest } = payload;
  return apiRequest<OptimizeResponse>(`/api/subscriptions/${subscriptionId}/optimize`, {
    method: "POST",
    signal,
    body: { ...rest, ...(seats !== undefined ? { seatsToReclaim: seats } : {}) },
  });
}
