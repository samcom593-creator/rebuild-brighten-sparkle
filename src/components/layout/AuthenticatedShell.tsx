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

function InnerPageLoader() {
  return (
    <div className="flex items-center justify-center p-8 w-full min-h-[50vh]">
      <div className="w-full max-w-md space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-48 w-full rounded-md" />
        <Skeleton className="h-10 w-full" />
      </div>
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
        const { data, error } = await supabase.auth.refreshSession();
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
      <TooltipProvider>
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
      </TooltipProvider>
    </ProtectedRoute>
  );
}
