/**
 * http.ts: real backend client transport layer; /api/* is proxied to the Go backend by next.config rewrites.
 * Domain methods live in sibling domain files and are aggregated in lib/api.ts; http/sseUrl are re-exported by the facade.
 * Main functions/types:
 *   - http / get / post / put / patch / del: fetch wrappers with auth and unified error handling (short-circuited to the mock handler in MOCK builds)
 *   - sseUrl: builds SSE stream URLs (same-origin in production, direct :8787 in development)
 *   - getToken: reads the login token from localStorage
 *   - arr / tq / findingFilterParams / interceptPageQuery: empty-array fallback, task query string, and filter serialization helpers
 */

import type { FindingQuery, InterceptApprovalFilter } from "@/lib/types";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("artex_token");
}

export async function http<T>(path: string, init?: RequestInit): Promise<T> {
  // The dynamic import keeps the 6800-line mock data out of non-MOCK bundles: the
  // process.env check must be inlined here (not via the MOCK constant in lib/mock/enabled). Default Turbopack
  // builds replace the mock handler with an empty stub via next.config.mjs resolveAlias; explicit
  // webpack builds fold it into if(false) via DefinePlugin — both builds eliminate this
  // import() dependency.
  if (process.env.NEXT_PUBLIC_MOCK === "1")
    return (await import("@/lib/mock/handler")).mockHandle<T>(init?.method ?? "GET", path, init?.body ?? null);
  const token = getToken();
  const r = await fetch(`/api${path}`, {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers as Record<string, string> | undefined),
    },
  });
  if (r.status === 401) {
    if (typeof window !== "undefined") {
      localStorage.removeItem("artex_token");
      document.cookie = "artex_token=; path=/; max-age=0";
      window.location.href = "/login";
    }
    throw new Error("Unauthorized");
  }
  if (!r.ok) {
    const fallback = `${init?.method ?? "GET"} ${path}: ${r.status}`;
    let message = fallback;
    try {
      const payload = (await r.json()) as { error?: unknown };
      if (typeof payload.error === "string" && payload.error.trim()) {
        message = payload.error.trim();
      }
    } catch {
      // Keep the status-based fallback for empty or non-JSON error responses.
    }
    throw new Error(message);
  }
  if (r.status === 204) return undefined as T;
  return r.json();
}

// sseUrl builds SSE URLs. Same-origin streams carry the login cookie from the browser, avoiding putting the JWT in
// the URL query string where it would leak into access logs; the token is only appended for cross-origin cases where that cookie cannot be used.
export function sseUrl(path: string): string {
  const base =
    process.env.NEXT_PUBLIC_SSE_BASE ??
    (process.env.NODE_ENV !== "production" && typeof window !== "undefined"
      ? `${window.location.protocol}//${window.location.hostname}:8787`
      : "");
  const token = base !== "" ? getToken() : null;
  const sep = path.includes("?") ? "&" : "?";
  return token ? `${base}${path}${sep}token=${encodeURIComponent(token)}` : `${base}${path}`;
}

export const get = <T>(p: string) => http<T>(p);
export const post = <T>(p: string, body?: unknown) =>
  http<T>(p, { method: "POST", body: body ? JSON.stringify(body) : undefined });
export const put = <T>(p: string, body?: unknown) =>
  http<T>(p, { method: "PUT", body: body ? JSON.stringify(body) : undefined });
export const patch = <T>(p: string, body?: unknown) =>
  http<T>(p, { method: "PATCH", body: body ? JSON.stringify(body) : undefined });
export const del = <T>(p: string, body?: unknown) =>
  http<T>(p, { method: "DELETE", body: body ? JSON.stringify(body) : undefined });

// Go serializes nil slices as JSON null — coerce to [].
export const arr = <T>(x: T[] | null | undefined): T[] => x ?? [];
export const tq = (task?: string, sep: "?" | "&" = "?") => (task ? `${sep}task=${encodeURIComponent(task)}` : "");

// findingFilterParams serializes the findings page filters into a query string. List / groups /
// asset tree / export all share this one; new filters are added only here (the backend parses only this one too).
export function findingFilterParams(q: Omit<FindingQuery, "page" | "pageSize">): URLSearchParams {
  const p = new URLSearchParams();
  if (q.severity && q.severity !== "all") p.set("severity", q.severity);
  if (q.status && q.status !== "all") p.set("status", q.status);
  if (q.vulnclass && q.vulnclass !== "all") p.set("vulnclass", q.vulnclass);
  if (q.task && q.task !== "all") p.set("task_id", q.task);
  if (q.query?.trim()) p.set("q", q.query.trim());
  if (q.sort) p.set("sort", q.sort);
  if (q.assetScope) p.set("asset_scope", q.assetScope);
  if (q.assetIDs?.length) p.set("asset_ids", q.assetIDs.join(","));
  return p;
}

export function interceptPageQuery(page: number, size: number, filter: InterceptApprovalFilter) {
  const query = new URLSearchParams({ page: String(page), size: String(size) });
  if (filter.status) query.set("status", filter.status);
  if (filter.decision_source) query.set("decision_source", filter.decision_source);
  return query.toString();
}
