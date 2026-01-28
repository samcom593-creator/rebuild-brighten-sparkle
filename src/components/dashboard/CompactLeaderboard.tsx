import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Trophy, Medal, Award, Users, Flame, Zap } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { subDays, format, startOfWeek, endOfWeek, startOfMonth, endOfMonth } from "date-fns";
import { DateRangePicker, DateRange } from "@/components/ui/date-range-picker";

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

type Period = "day" | "week" | "month" | "custom";

const getAvatarColor = (name: string) => {
  const colors = [
    "from-emerald-400 to-teal-500",
    "from-violet-400 to-purple-500",
    "from-amber-400 to-orange-500",
    "from-rose-400 to-pink-500",
    "from-cyan-400 to-blue-500",
  ];
  const index = name.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return colors[index % colors.length];
};

// Podium card for top 3
function PodiumCard({ entry, position, maxALP }: { entry: LeaderboardEntry; position: 1 | 2 | 3; maxALP: number }) {
  const positionConfig = {
    1: { 
      height: "h-36", 
      gradient: "from-amber-400 via-yellow-400 to-amber-500",
      ring: "ring-2 ring-amber-400/50",
      icon: Trophy,
      iconColor: "text-amber-400",
      label: "1ST",
      glow: "shadow-lg shadow-amber-500/20"
    },
    2: { 
      height: "h-28", 
      gradient: "from-slate-300 via-gray-300 to-slate-400",
      ring: "ring-2 ring-slate-300/50",
      icon: Medal,
      iconColor: "text-slate-300",
      label: "2ND",
      glow: "shadow-md shadow-slate-400/20"
    },
    3: { 
      height: "h-24", 
      gradient: "from-amber-600 via-orange-500 to-amber-700",
      ring: "ring-2 ring-amber-600/50",
      icon: Award,
      iconColor: "text-amber-600",
      label: "3RD",
      glow: "shadow-md shadow-amber-600/20"
    },
  };
  
  const config = positionConfig[position];
  const Icon = config.icon;
  const firstName = entry.name.split(" ")[0];
  const initials = entry.name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();
  
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: position === 1 ? 0.1 : position === 2 ? 0 : 0.2, duration: 0.4 }}
      className={cn(
        "flex flex-col items-center justify-end pb-3 px-2 rounded-xl",
        "bg-gradient-to-b from-card/80 to-card/40 backdrop-blur-sm border border-border/30",
        config.height, config.ring, config.glow,
        position === 1 && "animate-rank-glow",
        entry.isCurrentUser && "ring-primary ring-2"
      )}
    >
      {/* Rank badge */}
      <div className={cn(
        "absolute -top-2 px-2 py-0.5 rounded-full text-[9px] font-black",
        `bg-gradient-to-r ${config.gradient} text-white shadow-sm`
      )}>
        {config.label}
      </div>
      
      {/* Avatar */}
      <div className={cn(
        "h-10 w-10 rounded-full flex items-center justify-center text-xs font-bold text-white mb-1.5 shadow-md",
        `bg-gradient-to-br ${getAvatarColor(entry.name)}`,
        position === 1 && "h-12 w-12"
      )}>
        {entry.avatarUrl ? (
          <img src={entry.avatarUrl} alt={entry.name} className="h-full w-full rounded-full object-cover" />
        ) : (
          initials
        )}
      </div>
      
      {/* Name */}
      <span className={cn(
        "text-xs font-semibold truncate max-w-full text-center",
        entry.isCurrentUser && "text-primary"
      )}>
        {entry.isCurrentUser ? "You" : firstName}
      </span>
      
      {/* Stats */}
      <div className="flex items-center gap-1 mt-0.5">
        <span className="text-[10px] text-muted-foreground">{entry.deals}×</span>
        <span className={cn(
          "text-sm font-bold",
          position === 1 && "text-amber-500",
          entry.isCurrentUser && position !== 1 && "text-primary"
        )}>
          ${entry.alp.toLocaleString()}
        </span>
      </div>
    </motion.div>
  );
}

// Row for positions 4+
function LeaderboardRow({ entry, index, maxALP }: { entry: LeaderboardEntry; index: number; maxALP: number }) {
  const progressPercent = maxALP > 0 ? Math.round((entry.alp / maxALP) * 100) : 0;
  const firstName = entry.name.split(" ")[0];
  const initials = entry.name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();
  
  // Deal dots (max 5 visible)
  const dealDots = Math.min(entry.deals, 5);
  
  return (
    <motion.div
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: 0.3 + index * 0.03 }}
      className={cn(
        "grid grid-cols-12 gap-2 items-center px-3 py-2 rounded-lg transition-all group",
        entry.isCurrentUser
          ? "bg-primary/10 border border-primary/30 shadow-[0_0_15px_rgba(20,184,166,0.15)]"
          : "hover:bg-muted/40"
      )}
    >
      {/* Rank */}
      <div className="col-span-1 text-xs font-bold text-muted-foreground">
        {entry.rank}
      </div>
      
      {/* Avatar + Name */}
      <div className="col-span-5 flex items-center gap-2 min-w-0">
        <div className={cn(
          "h-7 w-7 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0",
          `bg-gradient-to-br ${getAvatarColor(entry.name)}`
        )}>
          {entry.avatarUrl ? (
            <img src={entry.avatarUrl} alt={entry.name} className="h-full w-full rounded-full object-cover" />
          ) : (
            initials
          )}
        </div>
        <span className={cn(
          "text-xs font-medium truncate",
          entry.isCurrentUser && "text-primary font-semibold"
        )}>
          {entry.isCurrentUser ? "You" : firstName}
        </span>
      </div>
      
      {/* Deals as dots */}
      <div className="col-span-2 flex items-center gap-0.5 justify-center">
        {Array.from({ length: dealDots }).map((_, i) => (
          <span key={i} className="text-primary text-[8px]">●</span>
        ))}
        {entry.deals > 5 && (
          <span className="text-[9px] text-muted-foreground ml-0.5">+{entry.deals - 5}</span>
        )}
      </div>
      
      {/* ALP with progress bar */}
      <div className="col-span-4 flex flex-col gap-0.5">
        <div className="flex items-center justify-between">
          <span className={cn(
            "text-xs font-bold",
            entry.isCurrentUser ? "text-primary" : "text-foreground"
          )}>
            ${entry.alp.toLocaleString()}
          </span>
          <span className="text-[9px] text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity">
            {progressPercent}%
          </span>
        </div>
        <Progress 
          value={progressPercent} 
          className="h-1 bg-muted/50" 
        />
      </div>
    </motion.div>
  );
}

export function CompactLeaderboard({ currentAgentId, className }: CompactLeaderboardProps) {
  const [period, setPeriod] = useState<Period>("day");
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [isConnected, setIsConnected] = useState(true);
  const [customRange, setCustomRange] = useState<DateRange>({
    from: subDays(new Date(), 30),
    to: new Date(),
  });

  useEffect(() => {
    fetchLeaderboard();
    
    const channel = supabase
      .channel("compact-leaderboard")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "daily_production" },
        () => {
          setIsConnected(true);
          fetchLeaderboard();
        }
      )
      .subscribe((status) => {
        setIsConnected(status === "SUBSCRIBED");
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [period, currentAgentId, customRange]);

  const fetchLeaderboard = async () => {
    try {
      let startDate: string;
      let endDate: string;
      const today = new Date();
      
      switch (period) {
        case "week":
          startDate = format(startOfWeek(today, { weekStartsOn: 0 }), "yyyy-MM-dd");
          endDate = format(endOfWeek(today, { weekStartsOn: 0 }), "yyyy-MM-dd");
          break;
        case "month":
          startDate = format(startOfMonth(today), "yyyy-MM-dd");
          endDate = format(endOfMonth(today), "yyyy-MM-dd");
          break;
        case "custom":
          startDate = customRange.from ? format(customRange.from, "yyyy-MM-dd") : format(subDays(today, 30), "yyyy-MM-dd");
          endDate = customRange.to ? format(customRange.to, "yyyy-MM-dd") : format(today, "yyyy-MM-dd");
          break;
        default: // day
          startDate = format(today, "yyyy-MM-dd");
          endDate = startDate;
      }

      let query = supabase
        .from("daily_production")
        .select(`agent_id, aop, deals_closed, production_date`)
        .gte("production_date", startDate)
        .lte("production_date", endDate);

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
        .in("id", agentIds)
        .eq("is_deactivated", false)
        .eq("is_inactive", false);

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

      // Only include agents we can actually load (handles inactive/deactivated + deleted + RLS visibility)
      const allowedAgentIds = new Set(agents.map((a) => a.id));
      const visibleAgentIds = agentIds.filter((id) => allowedAgentIds.has(id));

      const leaderboardEntries: LeaderboardEntry[] = visibleAgentIds.map((agentId) => {
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

  const periodLabels: Record<Period, string> = {
    day: "Today",
    week: "This Week",
    month: "This Month",
    custom: customRange.from && customRange.to 
      ? `${format(customRange.from, "MMM d")} - ${format(customRange.to, "MMM d")}`
      : "Custom Range",
  };

  const top3 = entries.slice(0, 3);
  const rest = entries.slice(3);
  const maxALP = entries[0]?.alp || 0;

  return (
    <motion.div 
      className={cn(
        "bg-card/60 backdrop-blur-md rounded-2xl border border-border/40 p-4 shadow-lg",
        className
      )}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: 0.1 }}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-bold flex items-center gap-2">
          <Flame className="h-4 w-4 text-amber-400" />
          Leaderboard
          {/* Live indicator */}
          <span className={cn(
            "flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded-full",
            isConnected 
              ? "bg-emerald-500/20 text-emerald-400" 
              : "bg-muted text-muted-foreground"
          )}>
            <span className={cn(
              "h-1.5 w-1.5 rounded-full",
              isConnected ? "bg-emerald-400 animate-live-pulse" : "bg-muted-foreground"
            )} />
            {isConnected ? "LIVE" : "..."}
          </span>
        </h3>
        <div className="flex items-center gap-1">
          <Tabs value={period} onValueChange={(v) => setPeriod(v as Period)} className="w-auto">
            <TabsList className="h-7 p-0.5 bg-muted/50">
              <TabsTrigger value="day" className="text-[10px] px-2 h-6 data-[state=active]:bg-background">Day</TabsTrigger>
              <TabsTrigger value="week" className="text-[10px] px-2 h-6 data-[state=active]:bg-background">Week</TabsTrigger>
              <TabsTrigger value="month" className="text-[10px] px-2 h-6 data-[state=active]:bg-background">Month</TabsTrigger>
              <TabsTrigger value="custom" className="text-[10px] px-2 h-6 data-[state=active]:bg-background">Custom</TabsTrigger>
            </TabsList>
          </Tabs>
          {period === "custom" && (
            <DateRangePicker
              value={customRange}
              onChange={setCustomRange}
              simpleMode
              className="scale-90 origin-left"
            />
          )}
        </div>
      </div>

      <AnimatePresence mode="wait">
        {loading ? (
          <motion.div
            key="loading"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="space-y-3"
          >
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="animate-pulse flex items-center gap-3 py-2 px-3">
                <div className="h-7 w-7 rounded-full bg-muted" />
                <div className="flex-1 h-3 bg-muted rounded" />
                <div className="w-16 h-3 bg-muted rounded" />
              </div>
            ))}
          </motion.div>
        ) : entries.length === 0 ? (
          <motion.div
            key="empty"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="text-center py-10 text-muted-foreground"
          >
            <Users className="h-8 w-8 mx-auto mb-2 opacity-40" />
            <p className="text-sm font-medium">No production {periodLabels[period].toLowerCase()}</p>
            <p className="text-xs mt-1 opacity-60">Be the first to submit!</p>
          </motion.div>
        ) : (
          <motion.div
            key="content"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            {/* Top 3 Podium */}
            {top3.length >= 3 && (
              <div className="flex justify-center items-end gap-2 mb-4 px-2">
                <PodiumCard entry={top3[1]} position={2} maxALP={maxALP} />
                <PodiumCard entry={top3[0]} position={1} maxALP={maxALP} />
                <PodiumCard entry={top3[2]} position={3} maxALP={maxALP} />
              </div>
            )}
            
            {/* Fallback for < 3 entries */}
            {top3.length < 3 && top3.length > 0 && (
              <div className="flex justify-center gap-3 mb-4">
                {top3.map((entry, i) => (
                  <PodiumCard 
                    key={entry.agentId} 
                    entry={entry} 
                    position={(i + 1) as 1 | 2 | 3} 
                    maxALP={maxALP} 
                  />
                ))}
              </div>
            )}

            {/* Rest of leaderboard */}
            {rest.length > 0 && (
              <div className="space-y-1 max-h-[200px] overflow-y-auto scrollbar-thin pr-1">
                {rest.map((entry, index) => (
                  <LeaderboardRow 
                    key={entry.agentId} 
                    entry={entry} 
                    index={index}
                    maxALP={maxALP} 
                  />
                ))}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
