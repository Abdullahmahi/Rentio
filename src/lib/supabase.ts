import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

const url = import.meta.env.VITE_SUPABASE_URL ?? "";
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? "";

/** False until the project is pointed at a Supabase instance. Pages use this
 *  to show a setup notice instead of an endless spinner. */
export const isSupabaseConfigured = Boolean(url && anonKey);

// Fall back to a syntactically valid placeholder so importing this module can
// never throw during SSR or before the env is filled in — requests just fail,
// and the page error states handle it.
export const supabase = createClient<Database>(
  url || "http://127.0.0.1:54321",
  anonKey || "public-anon-key-not-configured",
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  },
);

/** Raw Supabase errors are not actionable. Map them to something an operator can act on. */
export function describeError(error: unknown): string {
  if (!isSupabaseConfigured) return "errors.notConfigured";
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (/duplicate key|already exists/i.test(message)) return "errors.duplicate";
  if (/row-level security|permission denied|insufficient/i.test(message)) return "errors.forbidden";
  if (/Failed to fetch|NetworkError|fetch failed/i.test(message)) return "errors.network";
  if (/Invalid login credentials/i.test(message)) return "errors.invalidCredentials";
  return "errors.generic";
}
