import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { GlassCard } from "@/components/ui/glass-card";
import { Award } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface PlaqueAward {
  id: string;
  agent_id: string;
  milestone_type: string;
  milestone_date: string;
  amount: number | null;
  awarded_at: string | null;
  agent_name?: string;
}

const milestoneEmoji: Record<string, string> = {
  first_deal_ever: "🎯",
  first_deal_of_day: "🔥",
  diamond_week: "💎",
  streak_5: "5️⃣",
  streak_10: "🔟",
  streak_20: "🏆",
  monthly_top: "👑",
  rank_passed: "📈",
};

const milestoneLabel: Record<string, string> = {
  first_deal_ever: "First Deal Ever",
  first_deal_of_day: "First Deal of Day",
  diamond_week: "Diamond Week ($10K+)",
  streak_5: "5-Day Streak",
  streak_10: "10-Day Streak",
  streak_20: "20-Day Streak",
  monthly_top: "Top Producer",
  rank_passed: "Rank Passed",
};

export function AwardFeedLive() {
  const [awards, setAwards] = useState<PlaqueAward[]>([]);
  const [agentMap, setAgentMap] = useState<Record<string, string>>({});

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      const { data: agents } = await supabase
        .from("agents")
        .select("id, display_name, profiles(full_name)");

      const map: Record<string, string> = {};
      (agents || []).forEach((a: any) => {
        map[a.id] = a.display_name || a.profiles?.full_name || "Agent";
      });
      if (mounted) setAgentMap(map);

      const { data } = await supabase
        .from("plaque_awards")
        .select("*")
        .order("awarded_at", { ascending: false })
        .limit(20);

      if (mounted) setAwards(data || []);
    };

    load();

    const channel = supabase
      .channel("awards-live-feed")
      .on("postgres_changes", {
        event: "INSERT",
        schema: "public",
        table: "plaque_awards",
      }, (payload) => {
        if (mounted) {
          setAwards((prev) => [payload.new as PlaqueAward, ...prev.slice(0, 19)]);
        }
      })
      .subscribe();

    return () => {
      mounted = false;
      supabase.removeChannel(channel);
    };
  }, []);

  if (awards.length === 0) {
    return (
      <GlassCard className="p-4 text-center text-sm text-muted-foreground">
        <Award className="h-8 w-8 mx-auto mb-2 text-muted-foreground/50" />
        No awards yet — log numbers to unlock achievements!
      </GlassCard>
    );
  }

  return (
    <GlassCard className="p-4">
      <div className="flex items-center gap-2 mb-3">
        <Award className="h-4 w-4 text-primary" />
        <span className="text-sm font-semibold">Award Feed</span>
      </div>
      <div className="space-y-0 divide-y divide-border">
        {awards.map((award) => (
          <div key={award.id} className="flex items-center gap-3 py-2.5">
            <span className="text-lg shrink-0">
              {milestoneEmoji[award.milestone_type] || "🏅"}
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">
                {agentMap[award.agent_id] || "Agent"}
              </div>
              <div className="text-xs text-muted-foreground">
                {milestoneLabel[award.milestone_type] || award.milestone_type}
                {award.amount ? ` · $${Number(award.amount).toLocaleString()}` : ""}
              </div>
            </div>
            <div className="text-[10px] text-muted-foreground shrink-0">
              {award.awarded_at ? formatDistanceToNow(new Date(award.awarded_at), { addSuffix: true }) : "recently"}
            </div>
          </div>
        ))}
      </div>
    </GlassCard>
  );
}
