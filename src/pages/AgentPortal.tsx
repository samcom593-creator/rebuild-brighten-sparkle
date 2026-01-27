import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { format, startOfWeek, endOfWeek, startOfMonth, endOfMonth } from "date-fns";
import { Link } from "react-router-dom";
import { 
  RefreshCw, 
  User,
  Calendar, 
  LogOut, 
  Trophy, 
  Sparkles, 
  Quote,
  Target,
  DollarSign,
  BarChart3,
  Award,
  Zap,
  Copy,
  UserPlus,
  Menu,
  LayoutDashboard,
  Settings,
  Users
} from "lucide-react";
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
import { IncomeGoalTracker } from "@/components/dashboard/IncomeGoalTracker";
import { PerformanceDashboardSection } from "@/components/dashboard/PerformanceDashboardSection";
import { WeeklyBadgesCard } from "@/components/dashboard/WeeklyBadges";
import { YearPerformanceCard } from "@/components/dashboard/YearPerformanceCard";
import { AgentRankBadge } from "@/components/dashboard/AgentRankBadge";
import { Sheet, SheetContent, SheetTrigger, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import apexIcon from "@/assets/apex-icon.png";

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

// Quick stat card component for the hero section
function QuickStat({ 
  icon: Icon, 
  label, 
  value, 
  color = "primary",
  delay = 0 
}: { 
  icon: React.ElementType; 
  label: string; 
  value: string | number; 
  color?: "primary" | "amber" | "emerald" | "violet";
  delay?: number;
}) {
  const colorClasses = {
    primary: "from-primary/20 to-primary/5 border-primary/20 text-primary",
    amber: "from-amber-500/20 to-amber-500/5 border-amber-500/20 text-amber-400",
    emerald: "from-emerald-500/20 to-emerald-500/5 border-emerald-500/20 text-emerald-400",
    violet: "from-violet-500/20 to-violet-500/5 border-violet-500/20 text-violet-400",
  };
  
  return (
    <motion.div
      initial={{ opacity: 0, y: 20, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ delay, duration: 0.3, type: "spring", stiffness: 200 }}
    >
      <div className={cn(
        "relative overflow-hidden rounded-xl border bg-gradient-to-br p-4 backdrop-blur-sm transition-all hover:scale-[1.02] hover:shadow-lg",
        colorClasses[color]
      )}>
        <div className="flex items-center gap-3">
          <div className={cn(
            "flex h-10 w-10 items-center justify-center rounded-lg bg-background/50",
            colorClasses[color]
          )}>
            <Icon className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs font-medium text-muted-foreground">{label}</p>
            <p className="text-xl font-bold text-foreground">{value}</p>
          </div>
        </div>
        {/* Decorative glow */}
        <div className="absolute -right-4 -top-4 h-16 w-16 rounded-full bg-current opacity-10 blur-xl" />
      </div>
    </motion.div>
  );
}

export default function AgentPortal() {
  const navigate = useNavigate();
  const { user, profile, isLoading: authLoading, isAdmin, isManager } = useAuth();
  const [agentId, setAgentId] = useState<string | null>(null);
  const [todayProduction, setTodayProduction] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [isAdminViewing, setIsAdminViewing] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [activeTab, setActiveTab] = useState<"numbers" | "leaderboard" | "stats">("leaderboard");
  
  // Team stats for managers/admins - now with time range support
  const [statsTimeRange, setStatsTimeRange] = useState<"week" | "month" | "all">("week");
  const [teamTodayStats, setTeamTodayStats] = useState({
    totalALP: 0,
    totalDeals: 0,
    totalPresentations: 0,
    avgCloseRate: 0,
  });

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

  // Helper to get date range based on selection
  const getDateRange = (range: "week" | "month" | "all") => {
    const now = new Date();
    switch (range) {
      case "week":
        return {
          start: format(startOfWeek(now, { weekStartsOn: 0 }), "yyyy-MM-dd"),
          end: format(endOfWeek(now, { weekStartsOn: 0 }), "yyyy-MM-dd"),
        };
      case "month":
        return {
          start: format(startOfMonth(now), "yyyy-MM-dd"),
          end: format(endOfMonth(now), "yyyy-MM-dd"),
        };
      case "all":
        return { start: "2020-01-01", end: "2099-12-31" };
    }
  };

  // Fetch team stats for managers/admins with dynamic time range
  const fetchTeamStats = async (currentAgentId: string | null, timeRange: "week" | "month" | "all" = "week") => {
    try {
      let agentIds: string[] = [];
      
      if (isAdmin) {
        // Admin sees ALL agents INCLUDING terminated ones for totals
        const { data: allAgents } = await supabase
          .from("agents")
          .select("id");
        agentIds = allAgents?.map(a => a.id) || [];
      } else if (isManager && currentAgentId) {
        // Manager sees their direct reports + themselves (active only)
        const { data: teamAgents } = await supabase
          .from("agents")
          .select("id")
          .eq("invited_by_manager_id", currentAgentId)
          .eq("is_deactivated", false);
        agentIds = [currentAgentId, ...(teamAgents?.map(a => a.id) || [])];
      }
      
      if (agentIds.length === 0) return;
      
      // Fetch production based on time range
      const { start, end } = getDateRange(timeRange);
      const { data: teamProduction } = await supabase
        .from("daily_production")
        .select("aop, deals_closed, presentations, closing_rate")
        .in("agent_id", agentIds)
        .gte("production_date", start)
        .lte("production_date", end);
      
      const totalALP = (teamProduction || []).reduce((sum, p) => sum + Number(p.aop || 0), 0);
      const totalDeals = (teamProduction || []).reduce((sum, p) => sum + (p.deals_closed || 0), 0);
      const totalPresentations = (teamProduction || []).reduce((sum, p) => sum + (p.presentations || 0), 0);
      const avgCloseRate = totalPresentations > 0 
        ? Math.round((totalDeals / totalPresentations) * 100) 
        : 0;
      
      setTeamTodayStats({ totalALP, totalDeals, totalPresentations, avgCloseRate });
    } catch (error) {
      console.error("Error fetching team stats:", error);
    }
  };

  // Re-fetch team stats when time range changes
  useEffect(() => {
    if (isAdmin && agentId) {
      fetchTeamStats(agentId, statsTimeRange);
    }
  }, [statsTimeRange]);

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
          
          // Fetch team stats for managers/admins
          await fetchTeamStats(agent.id);
        } else {
          // Even without agent record, fetch team stats for admins
          await fetchTeamStats(null);
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

  // Calculate quick stats from today's production
  const todayALP = todayProduction?.aop || 0;
  const todayDeals = todayProduction?.deals_closed || 0;
  const todayPresentations = todayProduction?.presentations || 0;
  const todayCloseRate = todayPresentations > 0 
    ? Math.round((todayDeals / todayPresentations) * 100) 
    : 0;

  if (authLoading || loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5 flex items-center justify-center">
        <motion.div 
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="text-center"
        >
          <div className="relative">
            <RefreshCw className="h-12 w-12 animate-spin text-primary mx-auto mb-4" />
            <div className="absolute inset-0 h-12 w-12 mx-auto rounded-full bg-primary/20 blur-xl animate-pulse" />
          </div>
          <p className="text-muted-foreground font-medium">Loading your portal...</p>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5">
      {/* Apex Financial Branding */}
      <div className="bg-gradient-to-r from-primary/10 via-transparent to-primary/10 border-b border-primary/20">
        <div className="container mx-auto px-4 py-2">
          <div className="flex items-center justify-center gap-2">
            <img src={apexIcon} alt="Apex" className="h-5 w-5" />
            <span className="font-bold text-sm tracking-wide bg-gradient-to-r from-primary to-emerald-400 bg-clip-text text-transparent">
              APEX FINANCIAL
            </span>
          </div>
        </div>
      </div>

      {/* Modern Header */}
      <header className="sticky top-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-xl">
        <div className="container mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              {/* Avatar with gradient ring */}
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: "spring", stiffness: 200, delay: 0.1 }}
                className="relative"
              >
                <div className="absolute inset-0 rounded-full bg-gradient-to-br from-primary via-violet-500 to-amber-500 p-[2px] animate-[spin_4s_linear_infinite]" style={{ animationDirection: "reverse" }}>
                  <div className="h-full w-full rounded-full bg-background" />
                </div>
                <div className="relative h-12 w-12 rounded-full bg-gradient-to-br from-primary to-violet-500 flex items-center justify-center text-white font-bold text-lg shadow-lg shadow-primary/20">
                  {profile?.full_name?.charAt(0).toUpperCase() || "A"}
                </div>
              </motion.div>
              
              <div>
                <div className="flex items-center gap-2">
                  <motion.h1 
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="font-bold text-lg"
                  >
                    {profile?.full_name || "Agent"}
                  </motion.h1>
                  {agentId && (
                    <AgentRankBadge agentId={agentId} size="sm" />
                  )}
                </div>
                <motion.p 
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.1 }}
                  className="text-xs text-muted-foreground flex items-center gap-1.5"
                >
                  <Calendar className="h-3 w-3" />
                  {format(new Date(), "EEEE, MMMM d, yyyy")}
                </motion.p>
              </div>
            </div>
            
            <div className="flex items-center gap-2">
              {/* Dashboard Navigation Menu */}
              <Sheet>
                <SheetTrigger asChild>
                  <Button variant="ghost" size="icon" className="hover:bg-muted">
                    <Menu className="h-4 w-4" />
                  </Button>
                </SheetTrigger>
                <SheetContent side="left" className="w-64">
                  <SheetHeader>
                    <SheetTitle className="flex items-center gap-2">
                      <img src={apexIcon} alt="Apex" className="h-6 w-6" />
                      Navigation
                    </SheetTitle>
                  </SheetHeader>
                  <nav className="space-y-2 mt-6">
                    <Link 
                      to="/dashboard" 
                      className="flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-muted transition-colors"
                    >
                      <LayoutDashboard className="h-5 w-5 text-primary" />
                      <span>Dashboard</span>
                    </Link>
                    <Link 
                      to="/dashboard/team" 
                      className="flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-muted transition-colors"
                    >
                      <Users className="h-5 w-5 text-violet-500" />
                      <span>My Team</span>
                    </Link>
                    <Link 
                      to="/dashboard/settings" 
                      className="flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-muted transition-colors"
                    >
                      <Settings className="h-5 w-5 text-muted-foreground" />
                      <span>Settings</span>
                    </Link>
                  </nav>
                </SheetContent>
              </Sheet>
              
              <ThemeToggle />
              <Button variant="ghost" size="icon" onClick={handleLogout} className="hover:bg-destructive/10 hover:text-destructive transition-colors">
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-6 space-y-6">
        {/* Admin Notice */}
        <AnimatePresence>
          {isAdminViewing && (
            <motion.div
              initial={{ opacity: 0, y: -10, height: 0 }}
              animate={{ opacity: 1, y: 0, height: "auto" }}
              exit={{ opacity: 0, y: -10, height: 0 }}
              className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3 backdrop-blur-sm"
            >
              <p className="text-sm text-amber-500 font-medium flex items-center gap-2">
                <Zap className="h-4 w-4" />
                Admin View — You are viewing the Agent Portal for testing purposes
              </p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Hero Section with Quick Stats */}
        <section className="space-y-4">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center sm:text-left"
          >
            <h2 className="text-2xl sm:text-3xl font-bold">
              <span className="bg-gradient-to-r from-primary via-violet-500 to-amber-500 bg-clip-text text-transparent">
                Performance Dashboard
              </span>
            </h2>
            <p className="text-muted-foreground mt-1 text-sm sm:text-base">
              Track your numbers, compete with the team, and crush your goals
            </p>
          </motion.div>

          {/* Time Range Toggle for Admin */}
          {isAdmin && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex gap-2 flex-wrap"
            >
              {(["week", "month", "all"] as const).map((range) => (
                <Button
                  key={range}
                  variant={statsTimeRange === range ? "default" : "outline"}
                  size="sm"
                  onClick={() => setStatsTimeRange(range)}
                  className="text-xs"
                >
                  {range === "week" ? "This Week" : range === "month" ? "This Month" : "All Time"}
                </Button>
              ))}
            </motion.div>
          )}

          {/* Quick Stats Grid */}
          {(() => {
            // Show team stats ONLY for admin (not managers)
            const showTeamStats = isAdmin;
            const timeLabel = statsTimeRange === "week" ? "Week" : statsTimeRange === "month" ? "Month" : "All Time";
            const statsLabel = showTeamStats ? `Team (${timeLabel})` : "Today's";
            const displayALP = showTeamStats ? teamTodayStats.totalALP : todayALP;
            const displayDeals = showTeamStats ? teamTodayStats.totalDeals : todayDeals;
            const displayPresentations = showTeamStats ? teamTodayStats.totalPresentations : todayPresentations;
            const displayCloseRate = showTeamStats ? teamTodayStats.avgCloseRate : todayCloseRate;

            return (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <QuickStat
                  icon={DollarSign}
                  label={showTeamStats ? `${timeLabel} ALP` : "Today's ALP"}
                  value={`$${displayALP.toLocaleString()}`}
                  color="primary"
                  delay={0.1}
                />
                <QuickStat
                  icon={Trophy}
                  label={showTeamStats ? `${timeLabel} Deals` : "Deals Today"}
                  value={displayDeals}
                  color="amber"
                  delay={0.15}
                />
                <QuickStat
                  icon={Target}
                  label={showTeamStats ? `${timeLabel} Pres` : "Presentations"}
                  value={displayPresentations}
                  color="violet"
                  delay={0.2}
                />
                <QuickStat
                  icon={BarChart3}
                  label={showTeamStats ? `${timeLabel} Close %` : "Close Rate"}
                  value={`${displayCloseRate}%`}
                  color="emerald"
                  delay={0.25}
                />
              </div>
            );
          })()}
        </section>

        {/* Tab Navigation for Mobile */}
        <motion.div 
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="flex gap-2 overflow-x-auto pb-2 sm:hidden"
        >
          {[
            { key: "leaderboard", label: "Leaderboard", icon: Trophy },
            { key: "numbers", label: "Log Numbers", icon: Sparkles },
            { key: "stats", label: "My Stats", icon: BarChart3 },
          ].map((tab) => (
            <Button
              key={tab.key}
              variant={activeTab === tab.key ? "default" : "outline"}
              size="sm"
              onClick={() => setActiveTab(tab.key as any)}
              className="flex-shrink-0 gap-1.5"
            >
              <tab.icon className="h-4 w-4" />
              {tab.label}
            </Button>
          ))}
        </motion.div>

        {/* Main Leaderboard - FIRST so agents see their rank immediately */}
        <AnimatePresence mode="wait">
          {(activeTab === "leaderboard" || window.innerWidth >= 640) && (
            <motion.section
              key="leaderboard"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ delay: 0.3 }}
              className={cn(
                activeTab !== "leaderboard" && "hidden sm:block"
              )}
            >
              <LeaderboardTabs key={`leaderboard-${refreshKey}`} currentAgentId={agentId || undefined} />
            </motion.section>
          )}
        </AnimatePresence>

        {/* Production Entry - Below leaderboard for motivation flow */}
        <AnimatePresence mode="wait">
          {(activeTab === "numbers" || window.innerWidth >= 640) && (
            <motion.section
              key="production"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ delay: 0.35 }}
              className={cn(
                activeTab !== "numbers" && "hidden sm:block"
              )}
            >
              {agentId ? (
                <ProductionEntry
                  agentId={agentId}
                  existingData={todayProduction}
                  onSaved={handleSaved}
                />
              ) : isAdminViewing ? (
                <GlassCard className="p-8 text-center">
                  <User className="h-12 w-12 mx-auto mb-3 text-muted-foreground" />
                  <p className="text-muted-foreground">No agent record found. Production entry is view-only.</p>
                </GlassCard>
              ) : null}
            </motion.section>
          )}
        </AnimatePresence>

        {/* Performance Dashboard */}
        <PerformanceDashboardSection />

        {/* Personal Stats */}
        <AnimatePresence mode="wait">
          {agentId && (activeTab === "stats" || window.innerWidth >= 640) && (
            <motion.section
              id="personal-stats"
              key="stats"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ delay: 0.4 }}
              className={cn(
                activeTab !== "stats" && "hidden sm:block"
              )}
            >
              <PersonalStatsCard 
                key={`stats-${refreshKey}`}
                agentId={agentId} 
                todayProduction={todayProduction} 
              />
            </motion.section>
          )}
        </AnimatePresence>

        {/* Year Performance Card - NEW, replaces Weekly Badges position */}
        {agentId && (
          <motion.section
            id="year-performance"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.32 }}
            className="hidden sm:block"
          >
            <YearPerformanceCard key={`year-${refreshKey}`} agentId={agentId} />
          </motion.section>
        )}

        {/* Production History Chart */}
        {agentId && (
          <motion.section
            id="production-history"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.35 }}
            className="hidden sm:block"
          >
            <ProductionHistoryChart key={`history-${refreshKey}`} agentId={agentId} />
          </motion.section>
        )}

        {/* Income Goal Tracker */}
        {agentId && (
          <motion.section
            id="income-goals"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.38 }}
            className="hidden sm:block"
          >
            <IncomeGoalTracker key={`income-goal-${refreshKey}`} agentId={agentId} />
          </motion.section>
        )}

        {/* Team Goals */}
        <motion.section
          id="team-goals"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.42 }}
          className="hidden sm:block"
        >
          <TeamGoalsTracker key={`goals-${refreshKey}`} />
        </motion.section>

        {/* Additional Leaderboards */}
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.45 }}
          className="hidden sm:block"
        >
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
        </motion.section>

        {/* Referral & Sharing Section */}
        <motion.section
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.48 }}
          className="grid sm:grid-cols-2 gap-4"
        >
          {/* Agent Referral Link */}
          <GlassCard className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <UserPlus className="h-5 w-5 text-primary" />
              <h3 className="font-semibold">Refer a Friend</h3>
            </div>
            <p className="text-xs text-muted-foreground mb-3">
              Know someone who'd be great at this? Share your referral link!
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs bg-muted p-2 rounded truncate">
                {typeof window !== 'undefined' ? `${window.location.origin}/apply?ref=${profile?.full_name?.replace(/\s+/g, '-').toLowerCase() || 'agent'}` : ''}
              </code>
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => {
                  const refLink = `${window.location.origin}/apply?ref=${profile?.full_name?.replace(/\s+/g, '-').toLowerCase() || 'agent'}`;
                  navigator.clipboard.writeText(refLink);
                  toast.success("Referral link copied!");
                }}
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          </GlassCard>

          {/* Direct Portal Link */}
          <GlassCard className="p-4 overflow-hidden">
            <div className="flex items-center gap-3 mb-4">
              <img src={apexIcon} alt="Apex" className="h-10 w-10 rounded-xl shadow-lg" />
              <div>
                <h3 className="font-semibold">Agent Portal</h3>
                <p className="text-xs text-muted-foreground">
                  Share with your team for daily entry
                </p>
              </div>
            </div>
            
            {/* Branded Preview Card */}
            <div className="bg-gradient-to-br from-primary/10 via-violet-500/10 to-amber-500/10 border border-border/50 rounded-xl p-4 mb-4">
              <div className="flex items-center gap-3">
                <img src={apexIcon} alt="Apex" className="h-12 w-12 rounded-lg" />
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm">Agent Portal</p>
                  <p className="text-xs text-muted-foreground truncate">apex-financial.org/agent-portal</p>
                </div>
              </div>
            </div>
            
            <Button 
              className="w-full gap-2"
              onClick={() => {
                const logLink = "https://apex-financial.org/agent-portal";
                navigator.clipboard.writeText(logLink);
                toast.success("Link copied to clipboard!");
              }}
            >
              <Copy className="h-4 w-4" />
              Copy Link
            </Button>
          </GlassCard>
        </motion.section>

        {/* Weekly Badges Card - MOVED TO BOTTOM */}
        {agentId && (
          <motion.section
            id="weekly-badges"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.52 }}
            className="hidden sm:block"
          >
            <WeeklyBadgesCard key={`badges-${refreshKey}`} agentId={agentId} />
          </motion.section>
        )}

        {/* Motivational Footer */}
        <motion.section
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.55 }}
        >
          <GlassCard className="p-6 text-center relative overflow-hidden">
            {/* Gradient background */}
            <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-violet-500/5" />
            
            <div className="relative">
              <Quote className="h-8 w-8 mx-auto mb-4 text-primary/30" />
              <p className="text-base sm:text-lg italic text-muted-foreground max-w-2xl mx-auto leading-relaxed">
                "{quote}"
              </p>
              <div className="mt-6 flex items-center justify-center gap-2">
                <Award className="h-5 w-5 text-amber-400" />
                <span className="text-sm text-muted-foreground font-medium">
                  Keep grinding. Your success is built one day at a time.
                </span>
              </div>
            </div>
          </GlassCard>
        </motion.section>
      </main>
    </div>
  );
}
