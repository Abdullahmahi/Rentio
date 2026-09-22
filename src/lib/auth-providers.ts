import { useQuery } from "@tanstack/react-query";

/**
 * Which social logins this Supabase project actually has switched on.
 *
 * Asked at runtime rather than hard-coded, because enabling a provider is a
 * dashboard action, not a code change. A button that is rendered before the
 * provider exists sends people to a Supabase error page, and one that needs a
 * redeploy after the switch is flipped is a second job nobody remembers to
 * do. This way the button appears on its own.
 *
 * `/auth/v1/settings` is a public, unauthenticated endpoint — it is what the
 * hosted Supabase UI reads for the same purpose.
 */
export const SUPPORTED_PROVIDERS = ["google"] as const;
export type AuthProvider = (typeof SUPPORTED_PROVIDERS)[number];

interface AuthSettings {
  external?: Record<string, boolean>;
}

export function useEnabledProviders() {
  const url = import.meta.env.VITE_SUPABASE_URL ?? "";
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? "";

  return useQuery({
    queryKey: ["auth-providers"],
    enabled: Boolean(url && anonKey),
    // Flipping a provider is rare; don't re-ask on every mount.
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<AuthProvider[]> => {
      const response = await fetch(`${url}/auth/v1/settings`, { headers: { apikey: anonKey } });
      if (!response.ok) return [];
      const settings = (await response.json()) as AuthSettings;
      return SUPPORTED_PROVIDERS.filter((provider) => settings.external?.[provider] === true);
    },
    // A provider list we could not fetch is an empty one: fall back to
    // email and password rather than showing a button that cannot work.
    retry: false,
  });
}
