import { motion } from "framer-motion";
import { Trophy } from "lucide-react";
import { GlassCard } from "@/components/ui/glass-card";
import { Badge } from "@/components/ui/badge";

interface LeaderboardEntry {
  agentId: string;
  name: string;
  apps: number;
  views: number;
  followers: number;
  latestCount: number;
}

interface GrowthLeaderboardProps {
  leaderboard: LeaderboardEntry[];
  weekStart: string;
}

export function GrowthLeaderboard({ leaderboard, weekStart }: GrowthLeaderboardProps) {
  return (
    <GlassCard className="p-4">
      <h3 className="font-semibold mb-3 flex items-center gap-2">
        <Trophy className="h-4 w-4 text-primary" />
        Weekly Manager Rankings
        <Badge variant="outline" className="ml-auto text-xs">Week of {weekStart}</Badge>
      </h3>

      {leaderboard.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-6">No data yet this week. Be the first to log!</p>
      ) : (
        <div className="space-y-2">
          {leaderboard.map((entry, i) => (
            <motion.div
              key={entry.agentId}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.05 }}
              className={`flex items-center gap-3 p-3 rounded-lg border transition-all ${
                i === 0 ? "border-primary/30 bg-primary/5" : "border-border bg-card/50"
              }`}
            >
              <span className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                i === 0 ? "bg-primary text-primary-foreground" : i === 1 ? "bg-muted text-foreground" : "bg-muted/50 text-muted-foreground"
              }`}>
                {i + 1}
              </span>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm truncate">{entry.name}</p>
              </div>
              <div className="flex items-center gap-4 text-xs">
                <div className="text-center">
                  <p className="font-bold text-foreground">{entry.apps}</p>
                  <p className="text-muted-foreground">Apps</p>
                </div>
                <div className="text-center">
                  <p className="font-bold text-foreground">{entry.views.toLocaleString()}</p>
                  <p className="text-muted-foreground">Views</p>
                </div>
                <div className="text-center">
                  <p className="font-bold text-foreground">+{entry.followers}</p>
                  <p className="text-muted-foreground">Followers</p>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </GlassCard>
  );
}
