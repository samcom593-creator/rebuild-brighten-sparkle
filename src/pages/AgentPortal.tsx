import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { format } from "date-fns";
import { RefreshCw, User, Calendar, LogOut, Trophy, TrendingUp, Sparkles, Quote } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ThemeToggle";
import { ProductionEntry } from "@/components/dashboard/ProductionEntry";
import { LeaderboardTabs } from "@/components/dashboard/LeaderboardTabs";
import { PersonalStatsCard } from "@/components/dashboard/PersonalStatsCard";
import { ProductionHistoryChart } from "@/components/dashboard/ProductionHistoryChart";
import { ClosingRateLeaderboard } from "@/components/dashboard/ClosingRateLeaderboard";
import { ReferralLeaderboard } from "@/components/dashboard/ReferralLeaderboard";
import { TeamGoalsTracker } from "@/components/dashboard/TeamGoalsTracker";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

const motivationalQuotes = [
  "Success is not final, failure is not fatal: it's the courage to continue that counts.",
  "The only way to do great work is to love what you do.",
  "Your limitation—it's only your imagination.",
  "Push yourself, because no one else is going to do it for you.",
  "Great things never come from comfort zones.",
  "Dream it. Wish it. Do it.",
  "Stay focused and never give up.",
  "The harder you work, the luckier you get.",
];

export default function AgentPortal() {
  const navigate = useNavigate();
  const { user, profile, isLoading: authLoading, isAdmin, isManager } = useAuth();
  const [agentId, setAgentId] = useState<string | null>(null);
  const [todayProduction, setTodayProduction] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [isAdminViewing, setIsAdminViewing] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  // Random quote for the day (consistent per session)
  const [quote] = useState(() => 
    motivationalQuotes[Math.floor(Math.random() * motivationalQuotes.length)]
  );

  useEffect(() => {
    if (!authLoading && !user) {
      navigate("/login");
      return;
    }
    if (user && !authLoading) {
      fetchAgentData();
    }
  }, [user, authLoading, isAdmin, isManager]);

  const fetchAgentData = async () => {
    try {
      // Admin/Manager bypass - they can view the portal without being a Live agent
      if (isAdmin || isManager) {
        setIsAdminViewing(true);
        
        // Try to get their agent record if they have one
        const { data: agent } = await supabase
          .from("agents")
          .select("id, onboarding_stage")
          .eq("user_id", user!.id)
          .single();
        
        if (agent) {
          setAgentId(agent.id);
          // Fetch today's production for their agent record
          const today = new Date().toISOString().split("T")[0];
          const { data: production } = await supabase
            .from("daily_production")
            .select("*")
            .eq("agent_id", agent.id)
            .eq("production_date", today)
            .single();
          if (production) setTodayProduction(production);
        }
        // No redirect - admins can view even without agent record
        setLoading(false);
        return;
      }

      // Regular agent logic - must have agent record and be Live
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

  const handleSaved = () => {
    fetchAgentData();
    setRefreshKey((k) => k + 1);
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/login");
  };

  if (authLoading || loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <RefreshCw className="h-8 w-8 animate-spin text-primary mx-auto mb-4" />
          <p className="text-muted-foreground">Loading your portal...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-gradient-to-br from-primary to-cyan-500 flex items-center justify-center text-white font-bold shadow-lg shadow-primary/20">
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
        {/* Admin Notice */}
        {isAdminViewing && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3"
          >
            <p className="text-sm text-amber-600 dark:text-amber-400 font-medium">
              Admin View — You are viewing the Agent Portal for testing purposes
            </p>
          </motion.div>
        )}

        {/* Welcome Section */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4"
        >
          <div>
            <h2 className="text-2xl sm:text-3xl font-bold gradient-text flex items-center gap-2">
              <Sparkles className="h-6 w-6 sm:h-7 sm:w-7" />
              Agent Performance Portal
            </h2>
            <p className="text-muted-foreground mt-1">
              Track your numbers, compete with peers, and crush your goals
            </p>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <TrendingUp className="h-4 w-4 text-emerald-500" />
            <span className="text-muted-foreground">Live updates</span>
          </div>
        </motion.div>

        {/* SECTION 1: Production Entry (Always at top) */}
        <section>
          {agentId ? (
            <ProductionEntry
              agentId={agentId}
              existingData={todayProduction}
              onSaved={handleSaved}
            />
          ) : isAdminViewing ? (
            <GlassCard className="p-6 text-center">
              <User className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
              <p className="text-muted-foreground">No agent record found. Production entry is view-only.</p>
            </GlassCard>
          ) : null}
        </section>

        {/* SECTION 2: Main Leaderboard with Day/Week/Month Tabs */}
        <section>
          <LeaderboardTabs key={`leaderboard-${refreshKey}`} currentAgentId={agentId || undefined} />
        </section>

        {/* SECTION 3: Personal Stats vs Agency Averages */}
        {agentId && (
          <section>
            <PersonalStatsCard 
              key={`stats-${refreshKey}`}
              agentId={agentId} 
              todayProduction={todayProduction} 
            />
          </section>
        )}

        {/* SECTION 4: 4-Week Production History Chart */}
        {agentId && (
          <section>
            <ProductionHistoryChart key={`history-${refreshKey}`} agentId={agentId} />
          </section>
        )}

        {/* SECTION 5: Team Goals Tracker */}
        <section>
          <TeamGoalsTracker key={`goals-${refreshKey}`} />
        </section>

        {/* SECTION 6: Additional Leaderboards (Closing Rate & Referrals) */}
        <section>
          <div className="grid md:grid-cols-2 gap-4">
            <ClosingRateLeaderboard 
              key={`closing-${refreshKey}`}
              currentAgentId={agentId || undefined}
              period="week" 
            />
            <ReferralLeaderboard 
              key={`referral-${refreshKey}`}
              currentAgentId={agentId || undefined} 
              period="week" 
            />
          </div>
        </section>

        {/* SECTION 6: Motivational Footer */}
        <motion.section
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
        >
          <GlassCard className="p-6 text-center bg-gradient-to-br from-primary/5 via-transparent to-emerald-500/5">
            <Quote className="h-6 w-6 mx-auto mb-3 text-primary/50" />
            <p className="text-sm sm:text-base italic text-muted-foreground max-w-2xl mx-auto">
              "{quote}"
            </p>
            <div className="mt-4 flex items-center justify-center gap-2">
              <Trophy className="h-4 w-4 text-amber-400" />
              <span className="text-xs text-muted-foreground">
                Keep grinding. Your success is built one day at a time.
              </span>
            </div>
          </GlassCard>
        </motion.section>
      </main>
    </div>
  );
}
