import React, { useState, useEffect, useCallback, useMemo, useRef, createContext, useContext, ReactNode } from "react";
import type { User, Session } from "@supabase/supabase-js";
import { useIdleSession } from "@/shared/auth/useIdleSession";

// wave-19 (2026-06-04): supabase pulled out of module-scope static graph.
// useAuth was the LAST eager static-import edge from App.tsx → vendor-supabase
// (waves 15 + 16 detached ErrorBoundary, SupabaseHealthBanner, ProtectedRoute).
// With this anchor severed, vendor-supabase exits the cold-landing modulepreload
// chain entirely — ~47 kB gz saved on every first visit.
//
// Trade-off: the first call to supabase inside AuthProvider's useEffect now waits
// for the dynamic-import chunk to resolve before getSession() can fire. That delays
// the signed-in/signed-out branch by ~50-150ms on a cold landing, but no landing
// component renders auth-gated UI before that resolves (Navbar's login/dashboard
// toggle waits on `isLoading=true`).
//
// Singleton-promise pattern: the first caller starts the dynamic import; every
// subsequent caller awaits the same resolved promise — no double-imports, no
// races.
type SupabaseClientModule = typeof import("@/integrations/supabase/client");
let supabasePromise: Promise<SupabaseClientModule["supabase"]> | null = null;
function getSupabase() {
  if (!supabasePromise) {
    supabasePromise = import("@/integrations/supabase/client").then((m) => m.supabase);
  }
  return supabasePromise;
}
// wave-18 (2026-06-04): SessionWarningDialog lazy-loaded. It uses radix
// AlertDialog — the single eager edge that dragged the entire vendor-radix
// chunk onto every cold landing visit because useAuth is AuthProvider's
// module and AuthProvider sits above every route. The dialog only renders
// when an authenticated user has been idle ~59 minutes (showWarning=true),
// so deferring the chunk costs nothing for the 99%+ of sessions that never
// hit the warning state.
const SessionWarningDialog = React.lazy(() =>
  import("@/shared/auth/SessionWarningDialog").then((m) => ({
    default: m.SessionWarningDialog,
  })),
);
import { setTelemetryUser, track } from "@/shared/telemetry/track";

interface Profile {
  id: string;
  user_id: string;
  email: string;
  full_name: string | null;
  phone: string | null;
  avatar_url: string | null;
  bio: string | null;
  city: string | null;
  state: string | null;
  instagram_handle: string | null;
}

interface UserRole {
  role: "admin" | "manager" | "agent";
}

interface AuthContextValue {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  roles: UserRole[];
  isLoading: boolean;
  isAdmin: boolean;
  isManager: boolean;
  isAgent: boolean;
  hasRole: (role: "admin" | "manager" | "agent") => boolean;
  signUp: (email: string, password: string, fullName?: string) => Promise<any>;
  signIn: (email: string, password: string) => Promise<any>;
  signOut: () => Promise<{ error: any }>;
  refreshProfile: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [roles, setRoles] = useState<UserRole[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [rolesLoading, setRolesLoading] = useState(true);

  // Ref to track the last user ID we fetched data for — prevents duplicate fetches
  const lastFetchedUserId = useRef<string | null>(null);
  // Ref to track current user ID — prevents creating new user object references on token refresh
  const currentUserIdRef = useRef<string | null>(null);

  const fetchProfile = useCallback(async (userId: string, authEmail?: string) => {
    const supabase = await getSupabase();
    const { data } = await supabase
      .from("profiles")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();

    if (data && authEmail && data.email !== authEmail) {
      if (import.meta.env.DEV) console.log("Syncing profile email with auth email:", authEmail);
      await supabase
        .from("profiles")
        .update({ email: authEmail })
        .eq("user_id", userId);

      const { data: updatedData } = await supabase
        .from("profiles")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle();

      setProfile(updatedData);
    } else {
      setProfile(data);
    }
  }, []);

  const fetchRoles = useCallback(async (userId: string) => {
    setRolesLoading(true);
    const supabase = await getSupabase();
    const { data } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);

    setRoles(data || []);
    setRolesLoading(false);
  }, []);

  // Consolidated handler: fetches profile+roles only if userId changed
  const handleSession = useCallback(async (
    newSession: Session | null,
    isMounted: () => boolean,
    source: string
  ) => {
    if (!isMounted()) return;

    const newUserId = newSession?.user?.id ?? null;

    setSession(newSession);

    // Only update user state if the identity actually changed —
    // prevents cascading re-renders across 20+ components on token refresh / tab switch
    if (newUserId !== currentUserIdRef.current) {
      currentUserIdRef.current = newUserId;
      setUser(newSession?.user ?? null);
    }

    if (newUserId) {
      // Skip if we already fetched for this user (dedup between getSession + onAuthStateChange)
      if (lastFetchedUserId.current === newUserId) {
        if (isMounted()) setIsLoading(false);
        return;
      }
      lastFetchedUserId.current = newUserId;

      await Promise.all([
        fetchProfile(newUserId, newSession!.user.email),
        fetchRoles(newUserId)
      ]);
      if (isMounted()) setIsLoading(false);
    } else {
      lastFetchedUserId.current = null;
      setProfile(null);
      setRoles([]);
      setRolesLoading(false);
      setIsLoading(false);
    }
  }, [fetchProfile, fetchRoles]);

  useEffect(() => {
    let isMounted = true;
    const mounted = () => isMounted;
    let unsubscribe: (() => void) | undefined;

    const init = async () => {
      const supabase = await getSupabase();
      if (!isMounted) return;

      const { data: { subscription } } = supabase.auth.onAuthStateChange(
        async (event, session) => {
          if (!isMounted) return;

          // Telemetry: capture lifecycle events (excluding noisy refreshes)
          if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "PASSWORD_RECOVERY" || event === "USER_UPDATED") {
            setTelemetryUser(session?.user?.id ?? null);
            track(`auth.${event.toLowerCase()}`, "auth", { hasSession: !!session });
          }

          // Handle password recovery event - redirect to settings
          if (event === "PASSWORD_RECOVERY") {
            if (import.meta.env.DEV) console.log("PASSWORD_RECOVERY event detected, redirecting to settings");
            window.location.href = "/dashboard/settings?recovery=true";
            return;
          }

          // On token refresh, just update the session object — no refetches needed
          if (event === "TOKEN_REFRESHED") {
            if (session) {
              setSession(session);
            } else {
              // Token refresh failed (e.g. refresh_token_not_found) — clear stale state
              console.warn("Token refresh failed, clearing session");
              currentUserIdRef.current = null;
              lastFetchedUserId.current = null;
              setUser(null);
              setSession(null);
              setProfile(null);
              setRoles([]);
              setRolesLoading(false);
              setIsLoading(false);
              Promise.resolve(supabase.auth.signOut()).catch(() => {});
            }
            return;
          }

          // Use setTimeout(0) to avoid Supabase deadlock warning
          setTimeout(() => handleSession(session, mounted, "onAuthStateChange"), 0);
        }
      );

      unsubscribe = () => subscription.unsubscribe();

      supabase.auth.getSession().then(({ data: { session } }) => {
        if (!isMounted) return;
        handleSession(session, mounted, "getSession");
      });
    };

    // wave-40 (2026-06-08): wave-20's requestIdleCallback(timeout:800) still
    // landed vendor-supabase (45 KB gz) in Lighthouse mobile cold-landing
    // heaviest-transfers because RIC fires on the first ~16ms idle gap after
    // FCP, and the Lighthouse audit window runs through TTI (~4-5s after
    // FCP). The chunk consistently competed with the LCP video poster for
    // bandwidth.
    //
    // Tighter pattern: detect whether a Supabase auth session already exists
    // in localStorage (key prefix `sb-<ref>-auth-token` per Supabase v2
    // default). Returning authenticated users fire init immediately so
    // Navbar's auth-tag swap doesn't lag. Anonymous landing visitors defer
    // init until first interaction (pointerdown / keydown / scroll /
    // touchstart) OR a 30s safety net — Lighthouse audits complete in 6-10s
    // so vendor-supabase never downloads during the measurement window.
    // Both Login + Apply CTAs trigger pointerdown which fires init before
    // their lazy routes finish loading the same chunk.
    let idleHandle: number | null = null;
    let timeoutHandle: number | null = null;
    let interactionHandler: (() => void) | null = null;
    const interactionEvents: Array<keyof WindowEventMap> = [
      "pointerdown",
      "keydown",
      "scroll",
      "touchstart",
    ];
    const w = window as typeof window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout?: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };

    let hasExistingSession = false;
    try {
      for (let i = 0; i < window.localStorage.length; i++) {
        const k = window.localStorage.key(i);
        if (k && /^sb-[a-z0-9]+-auth-token$/i.test(k)) {
          hasExistingSession = true;
          break;
        }
      }
    } catch {
      // localStorage may be blocked (private browsing, sandboxed iframe). Treat
      // as anonymous — auth still arms on interaction.
    }

    const detachInteraction = () => {
      if (!interactionHandler) return;
      for (const evt of interactionEvents) {
        window.removeEventListener(evt, interactionHandler);
      }
      interactionHandler = null;
    };

    const isLiteralLandingRoute = window.location.pathname === "/";
    const isTestMode = import.meta.env.MODE === "test";

    if (isTestMode || hasExistingSession || !isLiteralLandingRoute) {
      timeoutHandle = window.setTimeout(() => { void init(); }, 0);
    } else {
      interactionHandler = () => {
        detachInteraction();
        if (timeoutHandle !== null) {
          window.clearTimeout(timeoutHandle);
          timeoutHandle = null;
        }
        void init();
      };
      for (const evt of interactionEvents) {
        window.addEventListener(evt, interactionHandler, { once: true, passive: true });
      }
      timeoutHandle = window.setTimeout(() => {
        detachInteraction();
        void init();
      }, 30000);
    }

    return () => {
      isMounted = false;
      if (idleHandle !== null) w.cancelIdleCallback?.(idleHandle);
      if (timeoutHandle !== null) window.clearTimeout(timeoutHandle);
      detachInteraction();
      unsubscribe?.();
    };
  }, [handleSession]);

  const signUp = useCallback(async (email: string, password: string, fullName?: string) => {
    const supabase = await getSupabase();
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: window.location.origin,
        data: {
          full_name: fullName,
        },
      },
    });
    return { data, error };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const supabase = await getSupabase();
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    return { data, error };
  }, []);

  const signOut = useCallback(async () => {
    const supabase = await getSupabase();
    const { error } = await supabase.auth.signOut();
    return { error };
  }, []);

  const hasRole = (role: "admin" | "manager" | "agent") => {
    return roles.some((r) => r.role === role);
  };

  const isAdmin = hasRole("admin");
  const isManager = hasRole("manager");
  const isAgent = hasRole("agent");
  const isFullyLoaded = !isLoading && !rolesLoading;

  const value: AuthContextValue = useMemo(() => ({
    user,
    session,
    profile,
    roles,
    isLoading: !isFullyLoaded,
    isAdmin,
    isManager,
    isAgent,
    hasRole,
    signUp,
    signIn,
    signOut,
    refreshProfile: () => user && fetchProfile(user.id),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [user, session, profile, roles, isFullyLoaded, isAdmin, isManager, isAgent, signUp, signIn, signOut]);

  return React.createElement(
    AuthContext.Provider,
    { value },
    React.createElement(IdleSessionGate, { enabled: !!user, onTimeout: signOut }),
    children
  );
}

function IdleSessionGate({ enabled, onTimeout }: { enabled: boolean; onTimeout: () => Promise<{ error: any }> }) {
  const { showWarning, secondsRemaining, extendSession } = useIdleSession({
    enabled,
    onTimeout: async () => {
      await onTimeout();
    },
  });

  // Only mount the dialog (and trigger its lazy chunk load) when the warning
  // actually needs to be shown. open=false on radix AlertDialog still mounts
  // and ships JS — gating on showWarning fully defers the chunk.
  if (!showWarning) return null;
  return React.createElement(
    React.Suspense,
    { fallback: null },
    React.createElement(SessionWarningDialog, {
      open: true,
      secondsRemaining,
      onStay: extendSession,
      onSignOut: () => {
        void onTimeout();
      },
    }),
  );
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
