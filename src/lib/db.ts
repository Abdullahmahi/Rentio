import { PostgrestClient } from "@supabase/postgrest-js";
import { getToken } from "@clerk/tanstack-react-start";
import type { Database } from "@/lib/database.types";

/**
 * Same-origin fetch carrying the Clerk session token. Every server route and
 * the data API read it; none of them trust anything else from the browser.
 */
export async function apiFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const token = typeof window === "undefined" ? null : await getToken();
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(input, { ...init, headers });
}

// postgrest-js needs an absolute URL. On the server it is never called (all
// data loads in the browser), so the placeholder only has to parse.
const origin = typeof window === "undefined" ? "http://localhost" : window.location.origin;

/**
 * The data API: same query builder supabase-js wrapped, pointed at our own
 * PostgREST through the app server (src/routes/rest.v1.$.ts). RLS is still
 * what decides what comes back.
 */
export const db = new PostgrestClient<Database>(`${origin}/rest/v1`, {
  // Cast: Bun's `typeof fetch` also declares `preconnect`, which no wrapper has.
  fetch: apiFetch as typeof fetch,
});

/**
 * Calls a server route under /api/fn/<name>, the replacements for the old
 * Supabase Edge Functions. Same `{ data, error }` shape as
 * supabase.functions.invoke, so call sites read the same.
 */
export async function invokeFn<T = unknown>(name: string, { body }: { body?: unknown } = {}) {
  try {
    const response = await apiFetch(`/api/fn/${name}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
    const data = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
    if (!response.ok)
      return { data: null, error: new Error(data?.error ?? `HTTP ${response.status}`) };
    return { data: data as T, error: null };
  } catch (error) {
    return { data: null, error: error instanceof Error ? error : new Error(String(error)) };
  }
}

/** Raw API errors are not actionable. Map them to something an operator can act on. */
export function describeError(error: unknown): string {
  // postgrest-js errors are plain objects with the Postgres message and code.
  const err = (typeof error === "object" && error ? error : {}) as {
    message?: unknown;
    code?: unknown;
    error?: unknown;
  };
  const message = String(
    err.message ?? err.error ?? (error instanceof Error ? error.message : (error ?? "")),
  );
  const code = String(err.code ?? "");
  if (code === "23505" || /duplicate key|already exists|already has an account/i.test(message))
    return "errors.duplicate";
  if (code === "23503" || /violates foreign key|still referenced/i.test(message))
    return "errors.inUse";
  if (code === "PGRST301" || /jwt expired|unauthenticated|HTTP 401/i.test(message))
    return "errors.sessionExpired";
  if (/organization_suspended/i.test(message)) return "errors.suspended";
  if (/null value in column "org_id"/i.test(message)) return "errors.noCompany";
  // Our own triggers raise plain-language messages (late-fee guard, role guard):
  // show them as they are.
  if (code === "P0001" && message) return message;
  if (
    code === "42501" ||
    /row-level security|permission denied|insufficient|forbidden/i.test(message)
  )
    return "errors.forbidden";
  if (
    code === "23514" ||
    code === "23502" ||
    code === "22P02" ||
    /violates check constraint|violates not-null constraint|invalid input syntax/i.test(message)
  )
    return "errors.invalid";
  if (/Failed to fetch|NetworkError|fetch failed/i.test(message)) return "errors.network";
  return "errors.generic";
}
