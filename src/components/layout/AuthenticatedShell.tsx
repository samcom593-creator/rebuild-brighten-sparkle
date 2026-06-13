import { Suspense, lazy } from "react";
import { Outlet } from "react-router-dom";
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
export function AuthenticatedShell() {
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
