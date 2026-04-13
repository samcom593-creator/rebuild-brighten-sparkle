import { useState, useEffect } from "react";
import { Trophy, Zap, Star } from "lucide-react";
import { GlassCard } from "@/components/ui/glass-card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";

interface Achievement {
  id: string;
  agent_name: string;
  achievement_name: string;
  earned_at: string;
  icon: string | null;
}

const mapAchievements = (data: any[]): Achievement[] =>
  data.map((a: any) => ({
    id: a.id,
    agent_name: a.agents?.profiles?.full_name || a.agents?.display_name || "Agent",
    achievement_name: a.achievements?.name || "Achievement",
    earned_at: a.earned_at,
    icon: a.achievements?.icon,
  }));

const QUERY = `id, earned_at,
  agents!agent_achievements_agent_id_fkey(display_name, profiles!agents_profile_id_fkey(full_name)),
  achievements!agent_achievements_achievement_id_fkey(name, icon)`;

export function AchievementFeed() {
  const [achievements, setAchievements] = useState<Achievement[]>([]);

  useEffect(() => {
    let mounted = true;

    const fetchData = async () => {
      const { data } = await supabase
        .from("agent_achievements")
        .select(QUERY)
        .order("earned_at", { ascending: false })
        .limit(10);
      if (data && mounted) setAchievements(mapAchievements(data));
    };

    fetchData();

    const channel = supabase
      .channel(`achievement-feed-${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "agent_achievements" }, () => {
        if (mounted) fetchData();
      })
      .subscribe();

    return () => {
      mounted = false;
      supabase.removeChannel(channel);
    };
  }, []);

  const getTimeAgo = (date: string) => {
    const diff = Date.now() - new Date(date).getTime();
    const hours = Math.floor(diff / 3600000);
    if (hours < 1) return "Just now";
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  };

  return (
    <GlassCard className="p-4 space-y-3">
      <h3 className="font-display font-semibold flex items-center gap-2 text-sm">
        <Trophy className="h-4 w-4 text-primary" />
        Achievement Feed
        <Zap className="h-3 w-3 text-amber-400 ml-1" />
      </h3>
      {achievements.length === 0 ? (
        <p className="text-xs text-muted-foreground text-center py-3">No achievements yet</p>
      ) : (
        <div className="space-y-1.5 max-h-48 overflow-y-auto">
          {achievements.map(a => (
            <div key={a.id} className="flex items-center gap-2 p-2 rounded-lg bg-card/50 border border-border text-xs">
              <Star className="h-3.5 w-3.5 text-amber-400 flex-shrink-0" />
              <span className="font-medium truncate">{a.agent_name}</span>
              <Badge variant="secondary" className="text-[10px] ml-auto">{a.achievement_name}</Badge>
              <span className="text-muted-foreground text-[10px] flex-shrink-0">{getTimeAgo(a.earned_at)}</span>
            </div>
          ))}
        </div>
      )}
    </GlassCard>
  );
}
