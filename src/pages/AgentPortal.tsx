import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { format } from "date-fns";
import { RefreshCw, User, Calendar, LogOut } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ThemeToggle";
import { ProductionEntry } from "@/components/dashboard/ProductionEntry";
import { LiveLeaderboard } from "@/components/dashboard/LiveLeaderboard";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

export default function AgentPortal() {
  const navigate = useNavigate();
  const { user, profile, isLoading: authLoading } = useAuth();
  const [agentId, setAgentId] = useState<string | null>(null);
  const [todayProduction, setTodayProduction] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!authLoading && !user) {
      navigate("/login");
      return;
    }
    if (user) {
      fetchAgentData();
    }
  }, [user, authLoading]);

  const fetchAgentData = async () => {
    try {
      // Get current agent
      const { data: agent, error: agentError } = await supabase
        .from("agents")
        .select("id, onboarding_stage")
        .eq("user_id", user!.id)
        .single();

      if (agentError || !agent) {
        toast.error("You don't have access to the Agent Portal");
        navigate("/dashboard");
        return;
      }

      // Check if agent is "live" (evaluated)
      if (agent.onboarding_stage !== "evaluated") {
        toast.error("Agent Portal is only available for Live agents");
        navigate("/dashboard");
        return;
      }

      setAgentId(agent.id);

      // Get today's production if exists
      const today = new Date().toISOString().split("T")[0];
      const { data: production } = await supabase
        .from("daily_production")
        .select("*")
        .eq("agent_id", agent.id)
        .eq("production_date", today)
        .single();

      if (production) {
        setTodayProduction(production);
      }
    } catch (error) {
      console.error("Error fetching agent data:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/login");
  };

  if (authLoading || loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <RefreshCw className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-gradient-to-br from-primary to-cyan-500 flex items-center justify-center text-white font-bold">
              {profile?.full_name?.charAt(0).toUpperCase() || "A"}
            </div>
            <div>
              <h1 className="font-semibold">{profile?.full_name || "Agent"}</h1>
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <Calendar className="h-3 w-3" />
                {format(new Date(), "EEEE, MMMM d, yyyy")}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Button variant="ghost" size="icon" onClick={handleLogout}>
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-6 space-y-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <h2 className="text-2xl font-bold gradient-text mb-2">Agent Portal</h2>
          <p className="text-muted-foreground">
            Log your daily numbers and track your performance
          </p>
        </motion.div>

        <div className="grid lg:grid-cols-2 gap-6">
          {/* Production Entry */}
          <div>
            <ProductionEntry
              agentId={agentId!}
              existingData={todayProduction}
              onSaved={fetchAgentData}
            />

            {/* Stats Summary */}
            {todayProduction && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="mt-4"
              >
                <GlassCard className="p-4">
                  <h3 className="font-semibold text-sm mb-2">Today's Summary</h3>
                  <div className="grid grid-cols-3 gap-3 text-center">
                    <div>
                      <p className="text-2xl font-bold text-primary">
                        {todayProduction.deals_closed}
                      </p>
                      <p className="text-xs text-muted-foreground">Deals</p>
                    </div>
                    <div>
                      <p className="text-2xl font-bold gradient-text">
                        ${Number(todayProduction.aop).toLocaleString()}
                      </p>
                      <p className="text-xs text-muted-foreground">AOP</p>
                    </div>
                    <div>
                      <p className="text-2xl font-bold">
                        {Number(todayProduction.closing_rate).toFixed(0)}%
                      </p>
                      <p className="text-xs text-muted-foreground">Close Rate</p>
                    </div>
                  </div>
                </GlassCard>
              </motion.div>
            )}
          </div>

          {/* Leaderboard */}
          <div>
            <LiveLeaderboard currentAgentId={agentId || undefined} />
          </div>
        </div>
      </main>
    </div>
  );
}
