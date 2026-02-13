import { useRef } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { SkeletonLoader } from "@/components/ui/skeleton-loader";

interface ProtectedRouteProps {
  children: React.ReactNode;
  requireAdmin?: boolean;
}

export function ProtectedRoute({ children, requireAdmin = false }: ProtectedRouteProps) {
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

  // Admin required but user is not admin
  if (requireAdmin && !isAdmin) {
    return <Navigate to="/dashboard" replace />;
  }

  // Allow all authenticated users
  return <>{children}</>;
}
