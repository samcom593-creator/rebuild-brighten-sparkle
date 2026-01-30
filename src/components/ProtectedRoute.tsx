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

  // Show skeleton while auth is loading
  if (isLoading) {
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
