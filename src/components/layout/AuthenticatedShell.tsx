import { Suspense, lazy, useEffect, useRef } from "react";
import { Outlet } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { SidebarLayout } from "./SidebarLayout";
import { PushNotificationPrompt } from "./PushNotificationPrompt";
import { CommandHintFab } from "./CommandHintFab";
import { WelcomeToast } from "./WelcomeToast";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { ComponentErrorBoundary } from "@/components/ComponentErrorBoundary";
import { Skeleton } from "@/components/ui/skeleton";
import { CommandPalette } from "@/components/command/CommandPalette";
import { CelebrationProvider } from "@/components/celebrations/CelebrationProvider";
import { RequireProfilePicture } from "@/components/profile/RequireProfilePicture";
// WAVE C1 · AskApex AI assistant docked bottom-right on every dashboard route.
// Lazy to keep landing chunk clean.
const AskApex = lazy(() => import("@/components/ai/AskApex").then((m) => ({ default: m.AskApex })));
// wave-18 (2026-06-04): TooltipProvider lives here, not in App.tsx. Every
// dashboard component that mounts a <Tooltip> is rendered under this shell,
// so context is in scope. Landing routes never mount tooltips — moving the
// provider out of App eliminates the only eager static-import edge to
// vendor-radix's tooltip slice on cold landing.
import { TooltipProvider } from "@/components/ui/tooltip";
// wave-31 (2026-07-11): ConfirmProvider mounts the shared Radix AlertDialog
// so every dashboard callsite can `await confirm({...})` instead of calling
// native window.confirm(). Native confirm is a hostile UX on mobile Safari
// (Sam's daily driver) — freezes the tab, no keyboard focus, silently
// swallowable by extensions. See check-blocking-modal.mjs wave-23 guard.
import { ConfirmProvider } from "@/hooks/useConfirm";
// perf/site-wide-optimization (2026-08-06): the two global
// `@media (prefers-reduced-motion: reduce)` blocks in src/index.css only
// neutralise CSS animations/transitions. framer-motion animates via inline
// transform/opacity driven by rAF, so those blocks never touched it — and
// framer-motion is imported by 117 files across the dashboard. Result: users
// who asked their OS for reduced motion still got every slide, spring and
// stagger at full amplitude. MotionConfig reducedMotion="user" makes the whole
// subtree honour the OS setting (transform/layout animations are dropped,
// opacity/colour crossfades are kept, which is the accessible behaviour).
// Mounted HERE and not in App.tsx on purpose: App.tsx is the cold-landing
// critical path and the landing tree deliberately contains no framer-motion
// (verified: only ApplicationConfirmationV2, itself lazy). Importing it at the
// App root would drag the ~117 KB raw / ~39 KB gz framer-motion chunk onto
// first paint and undo the wave-39/46/51 landing work. AuthenticatedShell is
// already lazy and every route under it pulls framer-motion anyway.
import { MotionConfig } from "framer-motion";

function InnerPageLoader() {
  return (
    // Every Skeleton bar is aria-hidden, so without a labelled container a
    // screen reader hears nothing at all during a route transition. role=status
    // + aria-live=polite announces the wait without interrupting.
    <div
      className="flex items-center justify-center p-8 w-full min-h-[50vh]"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="w-full max-w-md space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-48 w-full rounded-md" />
        <Skeleton className="h-10 w-full" />
      </div>
      <span className="sr-only">Loading page…</span>
    </div>
  );
}

/**
 * Authenticated shell that wraps all protected routes.
 * - Mounts the sidebar ONCE at the route level
 * - Uses <Outlet /> to render child routes
 * - Inner Suspense prevents full-page flash on tab switch
 * - ScheduleBar shows upcoming items at the top
 * - ComponentErrorBoundary prevents section crashes from taking down the page
 */
/**
 * 2026-06-15 v7.8 · GLOBAL SESSION REFRESH
 * Every authenticated page (admin/manager/agent dashboard routes) now gets a
 * silent supabase.auth.refreshSession() on mount AND every 30 minutes while
 * the tab stays open. This kills the entire class of bugs where Sam sees
 * "0 fetched" because his JWT expired and the refresh chain broke silently.
 *
 * Root cause story:
 *   Supabase JWT default lifetime = 1 hour. The client auto-refreshes via
 *   the refresh token chain. If the chain breaks (network hiccup, browser
 *   sleep, tab in background, refresh token rotated invalidly), the client
 *   keeps sending an expired token. Postgres sees auth.uid()=NULL,
 *   has_role(NULL,'admin')=FALSE, RLS rejects every row → fetch returns 0.
 *   useAuth keeps isAdmin=true from previous cache, so the UI lies about
 *   the user's identity.
 *
 * Fix: refresh proactively + invalidate all queries on success so they
 * re-fire with the fresh JWT. If refresh fails, leave it to the
 * per-page diagnostic banner to offer the user a fix path.
 */
function useGlobalSessionRefresh() {
  const queryClient = useQueryClient();
  const onceRef = useRef(false);
  useEffect(() => {
    if (onceRef.current) return;
    onceRef.current = true;
    let cancelled = false;
    const refresh = async (label: string) => {
      try {
        // CRITICAL: never call refreshSession() blindly. On a page reload it
        // races the client's own init/auto-refresh, and the refresh-token
        // rotation collision throws "Auth session missing", invalidates the
        // session, and bounces the user to /login on every reload. Read the
        // session first (safe, no network, no rotation) and only refresh when
        // the token is actually near expiry — supabase autoRefreshToken already
        // covers the steady state.
        const { data: { session } } = await supabase.auth.getSession();
        if (cancelled) return;
        if (!session) return; // nothing to refresh — do NOT wipe/sign out
        const secondsLeft = (session.expires_at ?? 0) - Math.floor(Date.now() / 1000);
        if (secondsLeft > 15 * 60) return; // still fresh; skip to avoid the race
        // Pass the explicit session so refresh can never throw "session missing".
        const { data, error } = await supabase.auth.refreshSession(session);
        if (cancelled) return;
        if (error || !data?.session) {
          console.warn(`[GlobalSessionRefresh:${label}] failed:`, error);
          return;
        }
        // Force every query to re-fire with the fresh JWT
        queryClient.invalidateQueries();
      } catch (e) {
        console.warn(`[GlobalSessionRefresh:${label}] threw:`, e);
      }
    };
    refresh("mount");
    // Re-refresh every 30 minutes while the tab is open. JWT lifetime is
    // 1 hour, so 30-min refresh gives 30 minutes of headroom against
    // network blips.
    const interval = setInterval(() => refresh("interval"), 30 * 60_000);
    // Also refresh whenever the tab regains focus (covers laptop-wake
    // scenarios where Supabase's auto-refresh missed a beat).
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh("visibility");
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [queryClient]);
}

export function AuthenticatedShell() {
  useGlobalSessionRefresh();
  return (
    <ProtectedRoute>
      <MotionConfig reducedMotion="user">
        <TooltipProvider>
        <ConfirmProvider>
          <SidebarLayout showPhoneBanner={true}>
            <CelebrationProvider />
            <CommandPalette />
            <CommandHintFab />
            <WelcomeToast />
            <PushNotificationPrompt />
            <RequireProfilePicture />
            <ComponentErrorBoundary name="page-content">
              <Suspense fallback={<InnerPageLoader />}>
                <Outlet />
              </Suspense>
            </ComponentErrorBoundary>
            <Suspense fallback={null}>
              <AskApex />
            </Suspense>
          </SidebarLayout>
        </ConfirmProvider>
        </TooltipProvider>
      </MotionConfig>
    </ProtectedRoute>
  );
}
