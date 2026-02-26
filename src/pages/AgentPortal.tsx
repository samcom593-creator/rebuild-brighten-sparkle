import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { format, startOfWeek, endOfWeek, startOfMonth, endOfMonth, subDays } from "date-fns";
import { Link } from "react-router-dom";
import { 
  RefreshCw, 
  User,
  Calendar, 
  Trophy, 
  Sparkles, 
  Quote,
  Target,
  DollarSign,
  BarChart3,
  Award,
  Zap,
  Copy,
  UserPlus
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";
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
import { AccountLinkForm } from "@/components/dashboard/AccountLinkForm";
import { AgentRankBadge } from "@/components/dashboard/AgentRankBadge";
import { DashboardLayout } from "@/components/dashboard/DashboardLayout";
import { DateRangePicker, DateRange } from "@/components/ui/date-range-picker";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { getTodayPST } from "@/lib/dateUtils";
import apexIcon from "@/assets/apex-icon.png";
import { ProductionForecast } from "@/components/dashboard/ProductionForecast";
import { useSoundEffects } from "@/hooks/useSoundEffects";

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
  const { playSound } = useSoundEffects();
  const { user, profile, isLoading: authLoading, isAdmin, isManager } = useAuth();
  const [agentId, setAgentId] = useState<string | null>(null);
  const [todayProduction, setTodayProduction] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [isAdminViewing, setIsAdminViewing] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [activeTab, setActiveTab] = useState<"numbers" | "leaderboard" | "stats">("leaderboard");
  
  // Team stats for managers/admins - now with time range support
  const [statsTimeRange, setStatsTimeRange] = useState<"week" | "month" | "custom">("week");
  const [customRange, setCustomRange] = useState<DateRange>({ 
    from: subDays(new Date(), 30), 
    to: new Date() 
  });
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
    // Don't redirect if not logged in - we'll show a login prompt instead
    if (user && !authLoading) {
      fetchAgentData();
    } else if (!authLoading && !user) {
      setLoading(false);
    }
  }, [user?.id, authLoading, isAdmin, isManager]);

  // Helper to get date range based on selection
  const getDateRange = (range: "week" | "month" | "custom") => {
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
      case "custom":
        // Use actual custom range if set
        if (customRange.from && customRange.to) {
          return {
            start: format(customRange.from, "yyyy-MM-dd"),
            end: format(customRange.to, "yyyy-MM-dd"),
          };
        }
        // Fallback to last 30 days
        const thirtyDaysAgo = subDays(now, 30);
        return { start: format(thirtyDaysAgo, "yyyy-MM-dd"), end: format(now, "yyyy-MM-dd") };
    }
  };

  // Fetch team stats for managers/admins with dynamic time range
  const fetchTeamStats = async (currentAgentId: string | null, timeRange: "week" | "month" | "custom" = "week") => {
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

  // Re-fetch team stats when time range or custom dates change
  useEffect(() => {
    if (isAdmin && agentId) {
      fetchTeamStats(agentId, statsTimeRange);
    }
  }, [statsTimeRange, customRange]);

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
          // Fetch today's production for their agent record (PST timezone)
          const today = getTodayPST();
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

      // Regular agent logic - fetch agent record with status fields
      const { data: agent, error: agentError } = await supabase
        .from("agents")
        .select("id, status, onboarding_stage, is_deactivated, is_inactive")
        .eq("user_id", user!.id)
        .maybeSingle();

      if (agentError) {
        console.error("Error fetching agent:", agentError);
        toast.error("Error loading your agent profile");
        setLoading(false);
        return;
      }

      if (!agent) {
        // No agent record - show message (handled in render)
        setLoading(false);
        return;
      }

      // Check if agent is deactivated or inactive
      if (agent.is_deactivated || agent.is_inactive || agent.status === "terminated") {
        // Show inactive message (handled in render)
        setLoading(false);
        return;
      }

      // Check if agent is pending approval
      if (agent.status === "pending") {
        navigate("/pending-approval");
        return;
      }

      // Allow access for active agents regardless of onboarding stage
      setAgentId(agent.id);

      // Get today's production if exists (PST timezone)
      const today = getTodayPST();
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
    playSound("celebrate");
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
      <div className="min-h-screen bg-background flex items-center justify-center">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="text-center"
        >
          <div className="relative">
            <img 
              src={apexIcon} 
              alt="Apex" 
              className="h-12 w-12 mx-auto mb-4 animate-pulse"
            />
            <div className="absolute inset-0 h-12 w-12 mx-auto rounded-full bg-primary/20 blur-xl animate-pulse" />
          </div>
          <p className="text-muted-foreground font-medium text-sm">
            Powered by Apex
          </p>
        </motion.div>
      </div>
    );
  }

  // Show login screen for unauthenticated users
  if (!user) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5 flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center max-w-md w-full"
        >
          <GlassCard className="p-8">
            <div className="relative mb-6">
              <img 
                src={apexIcon} 
                alt="Apex" 
                className="h-16 w-16 mx-auto"
              />
              <div className="absolute inset-0 h-16 w-16 mx-auto rounded-full bg-primary/20 blur-xl" />
            </div>
            <h1 className="text-2xl font-bold mb-2">Agent Portal</h1>
            <p className="text-muted-foreground mb-6">
              Please log in to access your portal and log your numbers.
            </p>
            <div className="space-y-3">
              <Link to="/install">
                <Button className="w-full" size="lg">
                  <Zap className="h-4 w-4 mr-2" />
                  Instant Login
                </Button>
              </Link>
              <Link to="/login">
                <Button variant="outline" className="w-full" size="lg">
                  <User className="h-4 w-4 mr-2" />
                  Admin Login
                </Button>
              </Link>
            </div>
          </GlassCard>
        </motion.div>
      </div>
    );
  }

  // Show self-link form if user has no agent record
  if (!agentId && !isAdminViewing) {
    return <AccountLinkForm user={user} profile={profile} onSuccess={() => window.location.reload()} onLogout={handleLogout} />;
  }

  return (
    <div className="space-y-6 page-enter">
      <div className="space-y-6">
        {/* Hero Section with Quick Stats */}
        <section className="space-y-4">
          {/* Agent Info Bar */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-wrap items-center gap-3"
          >
            <div className="flex items-center gap-3">
              <div className="relative h-12 w-12 rounded-full bg-gradient-to-br from-primary to-violet-500 flex items-center justify-center text-white font-bold text-lg shadow-lg shadow-primary/20">
                {profile?.full_name?.charAt(0).toUpperCase() || "A"}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="font-bold text-lg">{profile?.full_name || "Agent"}</h1>
                  {agentId && <AgentRankBadge agentId={agentId} size="sm" />}
                </div>
                <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <Calendar className="h-3 w-3" />
                  {format(new Date(), "EEEE, MMMM d, yyyy")}
                </p>
              </div>
            </div>
          </motion.div>

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
              {(["week", "month", "custom"] as const).map((range) => (
                <Button
                  key={range}
                  variant={statsTimeRange === range ? "default" : "outline"}
                  size="sm"
                  onClick={() => setStatsTimeRange(range)}
                  className="text-xs"
                >
                  {range === "week" ? "This Week" : range === "month" ? "This Month" : "Custom Dates"}
                </Button>
              ))}
              {statsTimeRange === "custom" && (
                <DateRangePicker
                  value={customRange}
                  onChange={setCustomRange}
                  simpleMode
                />
              )}
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
              onClick={() => { playSound("click"); setActiveTab(tab.key as any); }}
              className="flex-shrink-0 gap-1.5"
            >
              <tab.icon className="h-4 w-4" />
              {tab.label}
            </Button>
          ))}
        </motion.div>

        {/* ── Production Forecast (Admin Only) ── */}
        {agentId && isAdmin && (
          <motion.section
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.25 }}
          >
            <ProductionForecast agentId={agentId} />
          </motion.section>
        )}

        {/* Main Leaderboard - FIRST so agents see their rank immediately */}
        <AnimatePresence initial={false}>
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
        <AnimatePresence initial={false}>
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
        <AnimatePresence initial={false}>
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

        {/* Year Performance Card - ADMIN ONLY */}
        {agentId && isAdmin && (
          <motion.section
            id="year-performance"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.32 }}
            className="hidden sm:block"
          >
            <YearPerformanceCard key={`year-${refreshKey}`} agentId={agentId} isAdmin={isAdmin} isManager={isManager} />
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
            <ProductionHistoryChart key={`history-${refreshKey}`} agentId={agentId} showAgencyWide={isAdmin} />
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
          className="grid gap-4"
        >
          {/* Agent Referral Link */}
          <GlassCard className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <UserPlus className="h-5 w-5 text-primary shrink-0" />
              <h3 className="font-semibold">Refer a Friend</h3>
            </div>
            <p className="text-xs text-muted-foreground mb-3">
              Know someone who'd be great at this? Share your referral link!
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs bg-muted p-2 rounded truncate min-w-0">
                {typeof window !== 'undefined' ? `${window.location.origin}/apply?ref=${profile?.full_name?.replace(/\s+/g, '-').toLowerCase() || 'agent'}` : ''}
              </code>
              <Button 
                variant="outline" 
                size="sm"
                className="shrink-0"
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
              <img src={apexIcon} alt="Apex" className="h-10 w-10 rounded-xl shadow-lg shrink-0" />
              <div className="min-w-0">
                <h3 className="font-semibold">Agent Portal</h3>
                <p className="text-xs text-muted-foreground truncate">
                  Share with your team for daily entry
                </p>
              </div>
            </div>
            
            {/* Branded Preview Card */}
            <div className="bg-gradient-to-br from-primary/10 via-violet-500/10 to-amber-500/10 border border-border/50 rounded-xl p-4 mb-4">
              <div className="flex items-center gap-3">
                <img src={apexIcon} alt="Apex" className="h-10 w-10 sm:h-12 sm:w-12 rounded-lg shrink-0" />
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
      </div>
    </div>
  );
}
