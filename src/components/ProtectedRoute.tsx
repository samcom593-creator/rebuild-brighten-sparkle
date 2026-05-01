import { useRef } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { SkeletonLoader } from "@/components/ui/skeleton-loader";

interface ProtectedRouteProps {
  children: React.ReactNode;
  requireAdmin?: boolean;
  /**
   * If true and the page is requireAdmin, also let managers through.
   * Pages opt in when they handle the manager-scoped data view themselves
   * (e.g. HiringPipeline filters to the manager's downline). RLS still
   * enforces row-level access on the server.
   */
  allowManagers?: boolean;
}

export function ProtectedRoute({ children, requireAdmin = false, allowManagers = false }: ProtectedRouteProps) {
  const { user, isLoading, isAdmin, isManager } = useAuth();
  const location = useLocation();
  // Once we've confirmed auth at least once, never show the skeleton again
  const hasResolved = useRef(false);

  if (!isLoading) {
    hasResolved.current = true;
  }

  // Show skeleton only on the very first auth check
  if (isLoading && !hasResolved.current) {
    return <SkeletonLoader variant="page" />;
  }

  // Not authenticated - redirect to appropriate login
  if (!user) {
    const agentPages = ["/apex-daily-numbers", "/agent-portal", "/numbers"];
    const isAgentPage = agentPages.some(page => location.pathname.startsWith(page));
    const loginPath = isAgentPage ? "/agent-login" : "/login";
    return <Navigate to={loginPath} state={{ from: location }} replace />;
  }

  // Admin required but user is not admin (or manager when opted-in)
  if (requireAdmin && !isAdmin && !(allowManagers && isManager)) {
    return <Navigate to="/dashboard" replace />;
  }

  // Allow all authenticated users
  return <>{children}</>;
}
