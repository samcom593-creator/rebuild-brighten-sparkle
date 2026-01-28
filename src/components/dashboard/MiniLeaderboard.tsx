import { useState, useEffect } from "react";
import { Trophy, Medal, Award, ChevronRight } from "lucide-react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";

interface LeaderEntry {
  rank: number;
  name: string;
  total: number;
  isCurrentUser: boolean;
}

export function MiniLeaderboard() {
  const { user } = useAuth();
  const [entries, setEntries] = useState<LeaderEntry[]>([]);
  const [currentUserEntry, setCurrentUserEntry] = useState<LeaderEntry | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchLeaderboard();

    // Subscribe to realtime updates for applications (recruitment leaderboard)
    const channel = supabase
      .channel("mini-leaderboard")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "applications" },
        () => fetchLeaderboard()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user]);

  const fetchLeaderboard = async () => {
    try {
      // Get all active managers with their lead counts
      const { data: managers } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("role", "manager");

      if (!managers?.length) {
        setLoading(false);
        return;
      }

      const managerUserIds = managers.map(m => m.user_id);

      // Get agent records
      const { data: agents } = await supabase
        .from("agents")
        .select("id, user_id")
        .in("user_id", managerUserIds)
        .eq("status", "active")
        .eq("is_deactivated", false)
        .eq("is_inactive", false);

      if (!agents?.length) {
        setLoading(false);
        return;
      }

      // Get profiles for names
      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, full_name")
        .in("user_id", managerUserIds);

      const profileMap = new Map(profiles?.map(p => [p.user_id, p.full_name]) || []);

      // Get application counts
      const agentIds = agents.map(a => a.id);
      const { data: applications } = await supabase
        .from("applications")
        .select("assigned_agent_id")
        .in("assigned_agent_id", agentIds)
        .is("terminated_at", null);

      // Count per agent
      const countMap = new Map<string, number>();
      applications?.forEach(app => {
        const count = countMap.get(app.assigned_agent_id) || 0;
        countMap.set(app.assigned_agent_id, count + 1);
      });

      // Build rankings
      const rankings = agents.map(agent => ({
        agentId: agent.id,
        userId: agent.user_id,
        name: profileMap.get(agent.user_id) || "Unknown",
        total: countMap.get(agent.id) || 0,
      }));

      rankings.sort((a, b) => b.total - a.total);

      const top3 = rankings.slice(0, 3).map((r, idx) => ({
        rank: idx + 1,
        name: r.name.split(" ")[0], // First name only
        total: r.total,
        isCurrentUser: r.userId === user?.id,
      }));

      setEntries(top3);

      // Find current user if not in top 3
      const currentUserRank = rankings.findIndex(r => r.userId === user?.id);
      if (currentUserRank >= 3) {
        setCurrentUserEntry({
          rank: currentUserRank + 1,
          name: rankings[currentUserRank].name.split(" ")[0],
          total: rankings[currentUserRank].total,
          isCurrentUser: true,
        });
      } else {
        setCurrentUserEntry(null);
      }
    } catch (error) {
      console.error("Error fetching mini leaderboard:", error);
    } finally {
      setLoading(false);
    }
  };

  if (loading || entries.length === 0) {
    return null;
  }

  const rankIcons = [
    <Trophy className="h-4 w-4 text-yellow-500" />,
    <Medal className="h-4 w-4 text-gray-400" />,
    <Award className="h-4 w-4 text-amber-600" />,
  ];

  return (
    <div className="border-t border-border pt-4 mt-4">
      <div className="flex items-center justify-between mb-3 px-4">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Top Recruiters
        </span>
        <Link 
          to="/dashboard" 
          className="text-xs text-primary hover:underline flex items-center gap-1"
        >
          Full Board
          <ChevronRight className="h-3 w-3" />
        </Link>
      </div>
      
      <div className="space-y-1 px-2">
        {entries.map((entry) => (
          <div
            key={entry.rank}
            className={cn(
              "flex items-center gap-2 px-2 py-1.5 rounded-md text-sm",
              entry.isCurrentUser && "bg-primary/10"
            )}
          >
            <span className="w-5 flex justify-center">
              {rankIcons[entry.rank - 1]}
            </span>
            <span className={cn(
              "flex-1 truncate",
              entry.isCurrentUser ? "font-semibold text-primary" : "text-muted-foreground"
            )}>
              {entry.name}
              {entry.isCurrentUser && " (You)"}
            </span>
            <span className="text-xs font-medium tabular-nums">
              {entry.total}
            </span>
          </div>
        ))}

        {currentUserEntry && (
          <>
            <div className="text-center text-muted-foreground text-xs py-1">...</div>
            <div className="flex items-center gap-2 px-2 py-1.5 rounded-md text-sm bg-primary/10">
              <span className="w-5 flex justify-center text-xs font-medium text-muted-foreground">
                #{currentUserEntry.rank}
              </span>
              <span className="flex-1 truncate font-semibold text-primary">
                {currentUserEntry.name} (You)
              </span>
              <span className="text-xs font-medium tabular-nums">
                {currentUserEntry.total}
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
