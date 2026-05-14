import { useEffect, useRef, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { SkeletonLoader } from "@/components/ui/skeleton-loader";
import { supabase } from "@/integrations/supabase/client";

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
  /**
   * If true and the page is requireAdmin, also let users with agents.is_presenting
   * through. Used for seminar presenters such as KJ who need candidate visibility
   * without granting broader manager/admin access.
   */
  allowPresenters?: boolean;
}

export function ProtectedRoute({
  children,
  requireAdmin = false,
  allowManagers = false,
  allowPresenters = false,
}: ProtectedRouteProps) {
  const { user, isLoading, isAdmin, isManager } = useAuth();
  const location = useLocation();
  const [isPresenter, setIsPresenter] = useState(false);
  const [presenterLoading, setPresenterLoading] = useState(false);
  const [presenterCheckedUserId, setPresenterCheckedUserId] = useState<string | null>(null);
  // Once we've confirmed auth at least once, never show the skeleton again
  const hasResolved = useRef(false);

  useEffect(() => {
    let cancelled = false;

    if (!requireAdmin || !allowPresenters || !user || isAdmin || (allowManagers && isManager)) {
      setIsPresenter(false);
      setPresenterLoading(false);
      setPresenterCheckedUserId(null);
      return () => {
        cancelled = true;
      };
    }

    setPresenterLoading(true);
    setPresenterCheckedUserId(null);
    supabase
      .from("agents")
      .select("is_presenting")
      .eq("user_id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) {
          setIsPresenter(Boolean(data?.is_presenting));
          setPresenterCheckedUserId(user.id);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setIsPresenter(false);
          setPresenterCheckedUserId(user.id);
        }
      })
      .finally(() => {
        if (!cancelled) setPresenterLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [allowManagers, allowPresenters, isAdmin, isManager, requireAdmin, user?.id]);

  if (!isLoading) {
    hasResolved.current = true;
  }

  // Show skeleton only on the very first auth check
  const needsPresenterCheck = requireAdmin && allowPresenters && !!user && !isAdmin && !(allowManagers && isManager);
  const presenterCheckPending = needsPresenterCheck && (presenterLoading || presenterCheckedUserId !== user.id);

  if ((isLoading && !hasResolved.current) || presenterCheckPending) {
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
  if (requireAdmin && !isAdmin && !(allowManagers && isManager) && !(allowPresenters && isPresenter)) {
    return <Navigate to="/dashboard" replace />;
  }

  // Allow all authenticated users
  return <>{children}</>;
}
