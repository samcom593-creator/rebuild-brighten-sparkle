// DashboardRouter — Sam's launch dispatcher (2026-05-15).
//
// /dashboard used to dump every user into the legacy Dashboard.tsx, which
// is admin-shaped and felt unchanged to agents. The Router renders the
// right operating-system view per role:
//
//   admin   → DashboardCommandCenter (legacy admin OS, kept for now)
//   manager → DashboardCommandCenter (manager-scoped via existing logic)
//   agent   → AgentCommandDashboard  (new lean agent OS)
//   presenter (agents.is_presenting=true) → AgentCommandDashboard with a
//                                            seminar quick-access banner
//
// The legacy heavy Dashboard.tsx is still mounted at /dashboard/legacy
// so admins can fall back if needed. /agent-portal also routes to the
// new AgentCommandDashboard.

import { lazy, Suspense } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { SkeletonLoader } from "@/components/ui/skeleton-loader";

const DashboardCommandCenter = lazy(() => import("./DashboardCommandCenter"));
const AgentCommandDashboard = lazy(() => import("./AgentCommandDashboard"));

export default function DashboardRouter() {
  const { user, isLoading: authLoading, isAdmin, isManager } = useAuth();

  // Async presenter check — only matters when user isn't already
  // admin/manager. Drives whether KJ sees the agent view (with seminar
  // emphasis) vs gets bounced.
  const presenterQuery = useQuery({
    queryKey: ["dashboard-router-is-presenter", user?.id],
    enabled: !!user?.id && !isAdmin && !isManager,
    queryFn: async () => {
      const { data } = await supabase
        .from("agents")
        .select("is_presenting")
        .eq("user_id", user!.id)
        .maybeSingle();
      return Boolean(data?.is_presenting);
    },
  });

  if (authLoading) return <SkeletonLoader variant="page" />;
  if (!user) return null;

  if (isAdmin || isManager) {
    return (
      <Suspense fallback={<SkeletonLoader variant="page" />}>
        <DashboardCommandCenter />
      </Suspense>
    );
  }

  // Plain agents (including presenters) land on the new agent OS. We don't
  // block the render on the presenter check — the seminar control link is
  // always reachable from the new dashboard anyway.
  return (
    <Suspense fallback={<SkeletonLoader variant="page" />}>
      <AgentCommandDashboard />
    </Suspense>
  );
}
