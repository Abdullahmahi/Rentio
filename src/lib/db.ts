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
  // postgrest-js errors carry the Postgres message; read it off any object.
  const message =
    typeof error === "object" && error && "message" in error
      ? String((error as { message: unknown }).message)
      : String(error ?? "");
  if (/duplicate key|already exists|already has an account/i.test(message))
    return "errors.duplicate";
  if (/row-level security|permission denied|insufficient|forbidden|42501/i.test(message))
    return "errors.forbidden";
  if (/null value in column "org_id"/i.test(message)) return "errors.noCompany";
  if (/violates check constraint|violates not-null constraint|invalid input syntax/i.test(message))
    return "errors.invalid";
  if (/Failed to fetch|NetworkError|fetch failed/i.test(message)) return "errors.network";
  return "errors.generic";
}
