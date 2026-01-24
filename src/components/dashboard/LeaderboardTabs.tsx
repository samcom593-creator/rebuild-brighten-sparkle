import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Trophy, Medal, Award, TrendingUp, Target, Percent, Users, Flame } from "lucide-react";
import { GlassCard } from "@/components/ui/glass-card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { AnimatedNumber } from "./AnimatedNumber";
import { cn } from "@/lib/utils";
import { subDays, format } from "date-fns";

interface LeaderboardTabsProps {
  currentAgentId?: string;
}

interface LeaderboardEntry {
  rank: number;
  agentId: string;
  name: string;
  avatarUrl?: string;
  alp: number;
  deals: number;
  presentations: number;
  passedPrice: number;
  closingRate: number;
  isCurrentUser: boolean;
}

type Period = "day" | "week" | "month";

const rankIcons: Record<number, JSX.Element> = {
  1: <Trophy className="h-5 w-5 text-amber-400" />,
  2: <Medal className="h-5 w-5 text-slate-300" />,
  3: <Award className="h-5 w-5 text-amber-600" />,
};

const getAvatarColor = (name: string) => {
  const colors = [
    "bg-gradient-to-br from-primary to-primary/60",
    "bg-gradient-to-br from-emerald-500 to-emerald-600",
    "bg-gradient-to-br from-amber-500 to-orange-500",
    "bg-gradient-to-br from-purple-500 to-pink-500",
    "bg-gradient-to-br from-cyan-500 to-blue-500",
  ];
  const index = name.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return colors[index % colors.length];
};

export function LeaderboardTabs({ currentAgentId }: LeaderboardTabsProps) {
  const [period, setPeriod] = useState<Period>("day");
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchLeaderboard();
    
    // Subscribe to realtime updates
    const channel = supabase
      .channel("leaderboard-changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "daily_production" },
        () => fetchLeaderboard()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [period, currentAgentId]);

  const fetchLeaderboard = async () => {
    try {
      let startDate: string;
      const today = new Date();
      
      switch (period) {
        case "week":
          startDate = subDays(today, 7).toISOString().split("T")[0];
          break;
        case "month":
          startDate = subDays(today, 30).toISOString().split("T")[0];
          break;
        default:
          startDate = today.toISOString().split("T")[0];
      }

      // Fetch production data
      let query = supabase
        .from("daily_production")
        .select(`
          agent_id,
          aop,
          deals_closed,
          presentations,
          passed_price,
          closing_rate,
          production_date
        `)
        .gte("production_date", startDate);

      if (period === "day") {
        query = query.eq("production_date", startDate);
      }

      const { data: production } = await query;

      if (!production) {
        setEntries([]);
        setLoading(false);
        return;
      }

      // Aggregate by agent
      const agentTotals: Record<string, {
        alp: number;
        deals: number;
        presentations: number;
        passedPrice: number;
        closingRates: number[];
      }> = {};

      production.forEach((p) => {
        if (!agentTotals[p.agent_id]) {
          agentTotals[p.agent_id] = {
            alp: 0,
            deals: 0,
            presentations: 0,
            passedPrice: 0,
            closingRates: [],
          };
        }
        agentTotals[p.agent_id].alp += Number(p.aop || 0);
        agentTotals[p.agent_id].deals += Number(p.deals_closed || 0);
        agentTotals[p.agent_id].presentations += Number(p.presentations || 0);
        agentTotals[p.agent_id].passedPrice += Number(p.passed_price || 0);
        if (Number(p.closing_rate) > 0) {
          agentTotals[p.agent_id].closingRates.push(Number(p.closing_rate));
        }
      });

      // Get agent profiles
      const agentIds = Object.keys(agentTotals);
      const { data: agents } = await supabase
        .from("agents")
        .select("id, user_id")
        .in("id", agentIds);

      if (!agents) {
        setEntries([]);
        setLoading(false);
        return;
      }

      const userIds = agents.map((a) => a.user_id).filter(Boolean);
      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, full_name, avatar_url")
        .in("user_id", userIds);

      // Build entries
      const leaderboardEntries: LeaderboardEntry[] = agentIds.map((agentId) => {
        const agent = agents.find((a) => a.id === agentId);
        const profile = profiles?.find((p) => p.user_id === agent?.user_id);
        const totals = agentTotals[agentId];
        
        const avgClosingRate = totals.closingRates.length > 0
          ? totals.closingRates.reduce((a, b) => a + b, 0) / totals.closingRates.length
          : totals.presentations > 0
            ? (totals.deals / totals.presentations) * 100
            : 0;

        return {
          rank: 0,
          agentId,
          name: profile?.full_name || "Unknown Agent",
          avatarUrl: profile?.avatar_url,
          alp: totals.alp,
          deals: totals.deals,
          presentations: totals.presentations,
          passedPrice: totals.passedPrice,
          closingRate: avgClosingRate,
          isCurrentUser: agentId === currentAgentId,
        };
      });

      // Sort by ALP and assign ranks
      leaderboardEntries.sort((a, b) => b.alp - a.alp);
      leaderboardEntries.forEach((entry, index) => {
        entry.rank = index + 1;
      });

      setEntries(leaderboardEntries);
    } catch (error) {
      console.error("Error fetching leaderboard:", error);
    } finally {
      setLoading(false);
    }
  };

  const periodLabels = {
    day: "Today",
    week: "This Week",
    month: "This Month",
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <GlassCard className="p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold gradient-text flex items-center gap-2">
            <Trophy className="h-5 w-5 text-amber-400" />
            Sales Leaderboard
          </h3>
          <Tabs value={period} onValueChange={(v) => setPeriod(v as Period)} className="w-auto">
            <TabsList className="h-8">
              <TabsTrigger value="day" className="text-xs px-3">Day</TabsTrigger>
              <TabsTrigger value="week" className="text-xs px-3">Week</TabsTrigger>
              <TabsTrigger value="month" className="text-xs px-3">Month</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        {/* Table Header */}
        <div className="grid grid-cols-12 gap-2 px-3 py-2 text-xs font-medium text-muted-foreground border-b border-border/50 mb-2">
          <div className="col-span-1">#</div>
          <div className="col-span-3">Agent</div>
          <div className="col-span-2 text-center">Deals</div>
          <div className="col-span-2 text-center">Presentations</div>
          <div className="col-span-2 text-center">Close %</div>
          <div className="col-span-2 text-right">ALP</div>
        </div>

        {/* Leaderboard Rows */}
        <div className="space-y-1 max-h-[400px] overflow-y-auto scrollbar-custom">
          <AnimatePresence mode="popLayout">
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="animate-pulse flex items-center gap-3 p-3">
                  <div className="h-8 w-8 rounded-full bg-muted" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 bg-muted rounded w-1/3" />
                  </div>
                </div>
              ))
            ) : entries.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Users className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p>No production logged {periodLabels[period].toLowerCase()}</p>
              </div>
            ) : (
              entries.map((entry, index) => (
                <motion.div
                  key={entry.agentId}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  transition={{ delay: index * 0.05 }}
                  className={cn(
                    "grid grid-cols-12 gap-2 items-center px-3 py-3 rounded-lg transition-all",
                    entry.isCurrentUser
                      ? "bg-primary/10 border border-primary/30 shadow-[0_0_20px_rgba(20,184,166,0.15)]"
                      : entry.rank <= 3
                        ? "bg-gradient-to-r from-amber-500/5 to-transparent"
                        : "hover:bg-muted/30"
                  )}
                >
                  {/* Rank */}
                  <div className="col-span-1 flex items-center justify-center">
                    {rankIcons[entry.rank] || (
                      <span className="text-sm font-bold text-muted-foreground">
                        {entry.rank}
                      </span>
                    )}
                  </div>

                  {/* Agent */}
                  <div className="col-span-3 flex items-center gap-2">
                    <div className={cn(
                      "h-8 w-8 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0",
                      entry.avatarUrl ? "" : getAvatarColor(entry.name)
                    )}>
                      {entry.avatarUrl ? (
                        <img 
                          src={entry.avatarUrl} 
                          alt={entry.name} 
                          className="h-full w-full rounded-full object-cover"
                        />
                      ) : (
                        entry.name.split(" ").map((n) => n[0]).join("").slice(0, 2)
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className={cn(
                        "font-medium text-sm truncate",
                        entry.isCurrentUser && "text-primary"
                      )}>
                        {entry.name}
                        {entry.isCurrentUser && (
                          <span className="ml-1 text-[10px] opacity-75">(You)</span>
                        )}
                      </p>
                    </div>
                  </div>

                  {/* Deals */}
                  <div className="col-span-2 text-center">
                    <span className="font-bold text-lg">{entry.deals}</span>
                  </div>

                  {/* Presentations */}
                  <div className="col-span-2 text-center">
                    <span className="text-sm">{entry.presentations}</span>
                    {entry.passedPrice > 0 && (
                      <span className="text-[10px] text-muted-foreground ml-1">
                        ({entry.passedPrice} PP)
                      </span>
                    )}
                  </div>

                  {/* Closing Rate */}
                  <div className="col-span-2 text-center">
                    <span className={cn(
                      "font-medium",
                      entry.closingRate >= 30 && "text-emerald-500",
                      entry.closingRate >= 50 && "text-amber-400"
                    )}>
                      {entry.closingRate.toFixed(0)}%
                    </span>
                    {entry.closingRate >= 40 && (
                      <Flame className="h-3 w-3 inline ml-1 text-orange-500" />
                    )}
                  </div>

                  {/* ALP */}
                  <div className="col-span-2 text-right">
                    <span className="font-bold text-primary">
                      ${entry.alp.toLocaleString()}
                    </span>
                  </div>
                </motion.div>
              ))
            )}
          </AnimatePresence>
        </div>

        {/* Summary Footer */}
        {entries.length > 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5 }}
            className="mt-4 pt-4 border-t border-border/50 flex justify-between text-xs text-muted-foreground"
          >
            <span>
              <span className="font-medium text-foreground">{entries.length}</span> agents ranked
            </span>
            <span>
              Total ALP: <span className="font-medium text-primary">
                ${entries.reduce((sum, e) => sum + e.alp, 0).toLocaleString()}
              </span>
            </span>
          </motion.div>
        )}
      </GlassCard>
    </motion.div>
  );
}
