import { Outlet } from "react-router-dom";
import { SidebarLayout } from "./SidebarLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";

/**
 * Authenticated shell that wraps all protected routes.
 * - Mounts the sidebar ONCE at the route level
 * - Uses <Outlet /> to render child routes
 * - Prevents sidebar re-renders during page transitions
 */
export function AuthenticatedShell() {
  return (
    <ProtectedRoute>
      <SidebarLayout showPhoneBanner={true}>
        <Outlet />
      </SidebarLayout>
    </ProtectedRoute>
  );
}
