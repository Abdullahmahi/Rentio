import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useAuth as useClerkAuth, useUser } from "@clerk/tanstack-react-start";
import { apiFetch } from "@/lib/db";
import type { Tables, Enums } from "@/lib/database.types";

type Profile = Tables<"profiles">;
type Role = Enums<"user_role">;

interface AuthValue {
  /** The Clerk login. Signed in is not the same as having access: see `profile`. */
  user: { id: string; email: string | null } | null;
  profile: Profile | null;
  role: Role | null;
  /** True until the login AND the profile have resolved. Guards must wait
   *  on this or an authenticated user briefly sees the login page. */
  loading: boolean;
  /** Signed in, but no profile was found or linked for this login. */
  noAccess: boolean;
  isAdmin: boolean;
  isManager: boolean;
  isStaff: boolean;
  /** PortfolioAI staff. `profile.org_id` is the company they are acting in, if any. */
  isSuperAdmin: boolean;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

/** Clerk's sign-in and sign-up cards in the app's own colors and type. */
export const clerkAppearance = {
  variables: {
    colorPrimary: "#1B4D3E",
    fontFamily: "Inter Variable, Inter, system-ui, sans-serif",
    borderRadius: "0.625rem",
  },
  elements: { rootBox: "w-full", cardBox: "w-full shadow-none" },
};

/** Where a role belongs when it lands on the wrong shell. */
export function homeFor(role: Role | null) {
  return role === "tenant" ? "/portal" : "/app";
}

/**
 * Clerk says who is signed in; /api/me says what they may do. The profile
 * is fetched from the server rather than read from the database directly
 * because the first request is also what links a new login to the profile
 * staff invited (see src/lib/server/session.ts).
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const { isLoaded, userId, signOut: clerkSignOut } = useClerkAuth();
  const { user: clerkUser } = useUser();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [noAccess, setNoAccess] = useState(false);
  // Which login the current `profile` was actually fetched for. Without this
  // there is a window where the login has changed but the profile still
  // belongs to the previous user, and a consumer cannot tell "no profile
  // yet" from "no profile exists".
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  const loadProfile = useCallback(async () => {
    const response = await apiFetch("/api/me");
    if (response.ok) {
      const body = (await response.json()) as { profile: Profile };
      setProfile(body.profile);
      setNoAccess(false);
    } else {
      setProfile(null);
      setNoAccess(response.status === 403);
    }
  }, []);

  useEffect(() => {
    if (!isLoaded) return;
    if (!userId) {
      setProfile(null);
      setNoAccess(false);
      setLoadedFor(null);
      return;
    }
    let active = true;
    void loadProfile()
      .catch((error: unknown) => console.error("profile load failed", error))
      .finally(() => {
        if (active) setLoadedFor(userId);
      });
    return () => {
      active = false;
    };
  }, [isLoaded, userId, loadProfile]);

  const signOut = useCallback(async () => {
    await clerkSignOut();
    setProfile(null);
  }, [clerkSignOut]);

  const loading = !isLoaded || (Boolean(userId) && loadedFor !== userId);

  const value = useMemo<AuthValue>(() => {
    const role = profile?.role ?? null;
    return {
      user: userId
        ? { id: userId, email: clerkUser?.primaryEmailAddress?.emailAddress ?? null }
        : null,
      profile,
      role,
      loading,
      noAccess,
      isAdmin: role === "admin" || role === "super_admin",
      isManager: role === "manager",
      isStaff: role === "admin" || role === "manager" || role === "super_admin",
      isSuperAdmin: role === "super_admin",
      signOut,
      refreshProfile: loadProfile,
    };
  }, [userId, clerkUser, profile, loading, noAccess, signOut, loadProfile]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside <AuthProvider>");
  return value;
}

/** Hides financial and destructive controls from managers. */
export function AdminOnly({
  children,
  fallback = null,
}: {
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const { isAdmin } = useAuth();
  return <>{isAdmin ? children : fallback}</>;
}
