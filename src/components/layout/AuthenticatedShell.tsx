import { Suspense } from "react";
import { Outlet } from "react-router-dom";
import { SidebarLayout } from "./SidebarLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { Skeleton } from "@/components/ui/skeleton";

function InnerPageLoader() {
  return (
    <div className="flex items-center justify-center p-8 w-full min-h-[50vh]">
      <div className="w-full max-w-md space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-48 w-full rounded-xl" />
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
 */
export function AuthenticatedShell() {
  return (
    <ProtectedRoute>
      <SidebarLayout showPhoneBanner={true}>
        <Suspense fallback={<InnerPageLoader />}>
          <Outlet />
        </Suspense>
      </SidebarLayout>
    </ProtectedRoute>
  );
}
