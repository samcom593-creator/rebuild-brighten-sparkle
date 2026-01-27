import { useState, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Trophy, Medal, Award, Users, Flame } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { subDays } from "date-fns";

interface CompactLeaderboardProps {
  currentAgentId?: string;
  className?: string;
}

interface LeaderboardEntry {
  rank: number;
  agentId: string;
  name: string;
  avatarUrl?: string;
  alp: number;
  deals: number;
  isCurrentUser: boolean;
}

type Period = "day" | "week" | "all";

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

export function CompactLeaderboard({ currentAgentId, className }: CompactLeaderboardProps) {
  const [period, setPeriod] = useState<Period>("day");
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchLeaderboard();
    
    const channel = supabase
      .channel("compact-leaderboard")
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
        case "all":
          startDate = subDays(today, 365).toISOString().split("T")[0];
          break;
        default:
          startDate = today.toISOString().split("T")[0];
      }

      let query = supabase
        .from("daily_production")
        .select(`agent_id, aop, deals_closed, production_date`)
        .gte("production_date", startDate);

      if (period === "day") {
        query = query.eq("production_date", startDate);
      }

      const { data: production } = await query;

      if (!production || production.length === 0) {
        setEntries([]);
        setLoading(false);
        return;
      }

      const agentTotals: Record<string, { alp: number; deals: number }> = {};

      production.forEach((p) => {
        if (!agentTotals[p.agent_id]) {
          agentTotals[p.agent_id] = { alp: 0, deals: 0 };
        }
        agentTotals[p.agent_id].alp += Number(p.aop || 0);
        agentTotals[p.agent_id].deals += Number(p.deals_closed || 0);
      });

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

      const leaderboardEntries: LeaderboardEntry[] = agentIds.map((agentId) => {
        const agent = agents.find((a) => a.id === agentId);
        const profile = profiles?.find((p) => p.user_id === agent?.user_id);
        const totals = agentTotals[agentId];

        return {
          rank: 0,
          agentId,
          name: profile?.full_name || "Unknown",
          avatarUrl: profile?.avatar_url,
          alp: totals.alp,
          deals: totals.deals,
          isCurrentUser: agentId === currentAgentId,
        };
      });

      // Sort by ALP
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

  const rankIcons: Record<number, JSX.Element> = {
    1: <Trophy className="h-4 w-4 text-amber-400" />,
    2: <Medal className="h-4 w-4 text-slate-300" />,
    3: <Award className="h-4 w-4 text-amber-600" />,
  };

  const periodLabels = {
    day: "Today",
    week: "This Week",
    all: "All Time",
  };

  return (
    <div className={cn("bg-card/50 backdrop-blur-sm rounded-xl border border-border/50 p-4", className)}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold flex items-center gap-1.5">
          <Flame className="h-4 w-4 text-amber-400" />
          Leaderboard
        </h3>
        <Tabs value={period} onValueChange={(v) => setPeriod(v as Period)} className="w-auto">
          <TabsList className="h-7 p-0.5">
            <TabsTrigger value="day" className="text-[10px] px-2 h-6">Day</TabsTrigger>
            <TabsTrigger value="week" className="text-[10px] px-2 h-6">Week</TabsTrigger>
            <TabsTrigger value="all" className="text-[10px] px-2 h-6">All</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* Compact header */}
      <div className="grid grid-cols-12 gap-1 px-2 py-1.5 text-[10px] font-medium text-muted-foreground border-b border-border/30 mb-1">
        <div className="col-span-1">#</div>
        <div className="col-span-6">Agent</div>
        <div className="col-span-2 text-center">Deals</div>
        <div className="col-span-3 text-right">ALP</div>
      </div>

      {/* High-density rows */}
      <div className="space-y-0.5 max-h-[280px] overflow-y-auto scrollbar-thin">
        <AnimatePresence mode="popLayout">
          {loading ? (
            Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="animate-pulse flex items-center gap-2 py-2 px-2">
                <div className="h-6 w-6 rounded-full bg-muted" />
                <div className="flex-1 h-3 bg-muted rounded" />
              </div>
            ))
          ) : entries.length === 0 ? (
            <div className="text-center py-6 text-muted-foreground">
              <Users className="h-6 w-6 mx-auto mb-1 opacity-50" />
              <p className="text-xs">No production {periodLabels[period].toLowerCase()}</p>
            </div>
          ) : (
            entries.map((entry, index) => (
              <motion.div
                key={entry.agentId}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0 }}
                transition={{ delay: index * 0.02 }}
                className={cn(
                  "grid grid-cols-12 gap-1 items-center px-2 py-1.5 rounded-md transition-all",
                  entry.isCurrentUser
                    ? "bg-primary/15 border border-primary/30 shadow-[0_0_12px_rgba(20,184,166,0.2)]"
                    : index < 3
                      ? "bg-amber-500/5"
                      : "hover:bg-muted/30"
                )}
                style={{ minHeight: "40px" }}
              >
                {/* Rank */}
                <div className="col-span-1 flex items-center justify-center">
                  {index < 3 ? rankIcons[index + 1] : (
                    <span className="text-xs font-bold text-muted-foreground">
                      {index + 1}
                    </span>
                  )}
                </div>

                {/* Agent */}
                <div className="col-span-6 flex items-center gap-1.5 min-w-0">
                  <div className={cn(
                    "h-6 w-6 rounded-full flex items-center justify-center text-[9px] font-bold text-white shrink-0",
                    entry.avatarUrl ? "" : getAvatarColor(entry.name)
                  )}>
                    {entry.avatarUrl ? (
                      <img 
                        src={entry.avatarUrl} 
                        alt={entry.name} 
                        className="h-full w-full rounded-full object-cover"
                      />
                    ) : (
                      entry.name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()
                    )}
                  </div>
                  <span className={cn(
                    "text-xs font-medium truncate",
                    entry.isCurrentUser && "text-primary"
                  )}>
                    {entry.isCurrentUser ? "You" : entry.name.split(" ")[0]}
                  </span>
                </div>

                {/* Deals */}
                <div className="col-span-2 text-center">
                  <span className="text-xs font-bold">{entry.deals}</span>
                </div>

                {/* ALP */}
                <div className="col-span-3 text-right">
                  <span className={cn(
                    "text-xs font-bold",
                    entry.isCurrentUser ? "text-primary" : "text-foreground"
                  )}>
                    ${entry.alp.toLocaleString()}
                  </span>
                </div>
              </motion.div>
            ))
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
