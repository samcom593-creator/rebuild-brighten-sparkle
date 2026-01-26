import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Users, Trophy, Medal, Award, Handshake, Home } from "lucide-react";
import { GlassCard } from "@/components/ui/glass-card";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { subDays } from "date-fns";

interface ReferralLeaderboardProps {
  currentAgentId?: string;
  period?: "day" | "week" | "month";
}

interface ReferralEntry {
  rank: number;
  agentId: string;
  name: string;
  referralsCaught: number;
  referralPresentations: number;
  bookedInHome: number;
  referralCloseRate: number;
  isCurrentUser: boolean;
}

const rankIcons: Record<number, JSX.Element> = {
  1: <Trophy className="h-4 w-4 text-amber-400" />,
  2: <Medal className="h-4 w-4 text-slate-300" />,
  3: <Award className="h-4 w-4 text-amber-600" />,
};

export function ReferralLeaderboard({ currentAgentId, period = "week" }: ReferralLeaderboardProps) {
  const [entries, setEntries] = useState<ReferralEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchLeaderboard();

    // Subscribe to realtime updates
    const channel = supabase
      .channel("referral-leaderboard")
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
      const today = new Date();
      let startDate: string;
      
      switch (period) {
        case "month":
          startDate = subDays(today, 30).toISOString().split("T")[0];
          break;
        case "day":
          startDate = today.toISOString().split("T")[0];
          break;
        default:
          startDate = subDays(today, 7).toISOString().split("T")[0];
      }

      const { data: production } = await supabase
        .from("daily_production")
        .select("agent_id, referrals_caught, referral_presentations, booked_inhome_referrals, deals_closed")
        .gte("production_date", startDate);

      if (!production) {
        setEntries([]);
        setLoading(false);
        return;
      }

      // Aggregate by agent
      const agentTotals: Record<string, { 
        referralsCaught: number; 
        referralPresentations: number;
        bookedInHome: number;
        deals: number;
      }> = {};

      production.forEach((p) => {
        if (!agentTotals[p.agent_id]) {
          agentTotals[p.agent_id] = { 
            referralsCaught: 0, 
            referralPresentations: 0,
            bookedInHome: 0,
            deals: 0,
          };
        }
        agentTotals[p.agent_id].referralsCaught += Number(p.referrals_caught || 0);
        agentTotals[p.agent_id].referralPresentations += Number(p.referral_presentations || 0);
        agentTotals[p.agent_id].bookedInHome += Number(p.booked_inhome_referrals || 0);
        agentTotals[p.agent_id].deals += Number(p.deals_closed || 0);
      });

      // Filter agents with referral activity
      const activeAgents = Object.entries(agentTotals)
        .filter(([_, totals]) => totals.referralsCaught > 0 || totals.referralPresentations > 0);

      if (activeAgents.length === 0) {
        setEntries([]);
        setLoading(false);
        return;
      }

      // Get profiles
      const agentIds = activeAgents.map(([id]) => id);
      const { data: agents } = await supabase
        .from("agents")
        .select("id, user_id")
        .in("id", agentIds);

      const userIds = agents?.map((a) => a.user_id).filter(Boolean) || [];
      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, full_name")
        .in("user_id", userIds);

      // Build entries
      const referralEntries: ReferralEntry[] = activeAgents.map(([agentId, totals]) => {
        const agent = agents?.find((a) => a.id === agentId);
        const profile = profiles?.find((p) => p.user_id === agent?.user_id);
        
        // Calculate referral close rate: referral presentations that led to deals
        // This is an approximation since we don't track which deals came from referrals
        const referralCloseRate = totals.referralPresentations > 0 
          ? Math.min((totals.deals / totals.referralPresentations) * 100, 100)
          : 0;

        return {
          rank: 0,
          agentId,
          name: profile?.full_name || "Unknown Agent",
          referralsCaught: totals.referralsCaught,
          referralPresentations: totals.referralPresentations,
          bookedInHome: totals.bookedInHome,
          referralCloseRate,
          isCurrentUser: agentId === currentAgentId,
        };
      });

      // Sort by referral presentations (most productive referral activity)
      referralEntries.sort((a, b) => b.referralPresentations - a.referralPresentations);
      referralEntries.forEach((entry, index) => {
        entry.rank = index + 1;
      });

      setEntries(referralEntries.slice(0, 10));
    } catch (error) {
      console.error("Error fetching referral leaderboard:", error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <GlassCard className="p-4">
      <div className="flex items-center gap-2 mb-3">
        <Handshake className="h-4 w-4 text-primary" />
        <h4 className="font-semibold text-sm">Top Referral Producers</h4>
      </div>

      <div className="space-y-2">
        <AnimatePresence mode="popLayout">
          {loading ? (
            Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="animate-pulse h-10 bg-muted/30 rounded" />
            ))
          ) : entries.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-4">
              No referral activity yet
            </p>
          ) : (
            entries.map((entry, index) => (
              <motion.div
                key={entry.agentId}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: index * 0.05 }}
                className={cn(
                  "flex items-center justify-between p-2 rounded-lg text-sm",
                  entry.isCurrentUser
                    ? "bg-primary/10 border border-primary/30"
                    : "hover:bg-muted/30"
                )}
              >
                <div className="flex items-center gap-2">
                  {rankIcons[entry.rank] || (
                    <span className="w-4 text-center text-xs text-muted-foreground">{entry.rank}</span>
                  )}
                  <span className={cn(
                    "font-medium truncate max-w-[80px]",
                    entry.isCurrentUser && "text-primary"
                  )}>
                    {entry.name.split(" ")[0]}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <div className="flex items-center gap-1 text-muted-foreground">
                    <Users className="h-3 w-3" />
                    <span>{entry.referralsCaught}</span>
                  </div>
                  <div className="flex items-center gap-1 text-muted-foreground">
                    <Home className="h-3 w-3" />
                    <span>{entry.bookedInHome}</span>
                  </div>
                  <span className="font-bold text-primary">
                    {entry.referralPresentations} pres
                  </span>
                </div>
              </motion.div>
            ))
          )}
        </AnimatePresence>
      </div>
    </GlassCard>
  );
}
