import { useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Loader2 } from "lucide-react";

interface ProtectedRouteProps {
  children: React.ReactNode;
  requireAdmin?: boolean;
}

export function ProtectedRoute({ children, requireAdmin = false }: ProtectedRouteProps) {
  const [loading, setLoading] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [agentStatus, setAgentStatus] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const location = useLocation();

  useEffect(() => {
    const checkAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session) {
        setAuthenticated(false);
        setLoading(false);
        return;
      }

      setAuthenticated(true);

      // Check if user is admin
      const { data: roles } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", session.user.id);

      const hasAdminRole = roles?.some(r => r.role === "admin" || r.role === "manager") || false;
      setIsAdmin(hasAdminRole);

      // If admin, don't check agent status
      if (hasAdminRole) {
        setAgentStatus("active");
        setLoading(false);
        return;
      }

      // Check agent verification status
      const { data: agent } = await supabase
        .from("agents")
        .select("status")
        .eq("user_id", session.user.id)
        .single();

      setAgentStatus(agent?.status || null);
      setLoading(false);
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => {
      checkAuth();
    });

    checkAuth();

    return () => subscription.unsubscribe();
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!authenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // If agent status is pending and user is not admin, redirect to pending approval
  if (agentStatus === "pending" && !isAdmin) {
    return <Navigate to="/pending-approval" replace />;
  }

  // If agent doesn't exist yet (newly signed up), also redirect to pending
  if (!agentStatus && !isAdmin) {
    return <Navigate to="/pending-approval" replace />;
  }

  return <>{children}</>;
}
