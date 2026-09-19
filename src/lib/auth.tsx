import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import type { Tables, Enums } from "@/lib/database.types";

type Profile = Tables<"profiles">;
type Role = Enums<"user_role">;

interface AuthValue {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  role: Role | null;
  /** True until the session AND the profile have resolved. Guards must wait
   *  on this or an authenticated user briefly sees the login page. */
  loading: boolean;
  isAdmin: boolean;
  isManager: boolean;
  isStaff: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

/** Where a role belongs when it lands on the wrong shell. */
export function homeFor(role: Role | null) {
  return role === "tenant" ? "/portal" : "/app";
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  const loadProfile = useCallback(async (userId: string | undefined) => {
    if (!userId) {
      setProfile(null);
      return;
    }
    const { data } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
    setProfile(data ?? null);
  }, []);

  useEffect(() => {
    let active = true;

    void (async () => {
      const { data } = await supabase.auth.getSession();
      if (!active) return;
      setSession(data.session);
      await loadProfile(data.session?.user.id);
      if (active) setLoading(false);
    })();

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!active) return;
      setSession(nextSession);
      // Deferred: calling back into supabase inside this callback can deadlock.
      setTimeout(() => {
        void loadProfile(nextSession?.user.id);
      }, 0);
    });

    return () => {
      active = false;
      subscription.subscription.unsubscribe();
    };
  }, [loadProfile]);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setProfile(null);
  }, []);

  const refreshProfile = useCallback(async () => {
    await loadProfile(session?.user.id);
  }, [loadProfile, session]);

  const value = useMemo<AuthValue>(() => {
    const role = profile?.role ?? null;
    return {
      user: session?.user ?? null,
      session,
      profile,
      role,
      loading,
      isAdmin: role === "admin",
      isManager: role === "manager",
      isStaff: role === "admin" || role === "manager",
      signIn,
      signOut,
      refreshProfile,
    };
  }, [session, profile, loading, signIn, signOut, refreshProfile]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside <AuthProvider>");
  return value;
}

/** Hides financial and destructive controls from managers. */
export function AdminOnly({ children, fallback = null }: { children: ReactNode; fallback?: ReactNode }) {
  const { isAdmin } = useAuth();
  return <>{isAdmin ? children : fallback}</>;
}
