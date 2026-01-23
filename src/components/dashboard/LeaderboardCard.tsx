import { motion } from "framer-motion";
import { Trophy, Medal, Award } from "lucide-react";
import { GlassCard } from "@/components/ui/glass-card";
import { cn } from "@/lib/utils";

interface LeaderboardEntry {
  rank: number;
  name: string;
  value: number;
  isCurrentUser?: boolean;
}

interface LeaderboardCardProps {
  title: string;
  entries: LeaderboardEntry[];
  valueLabel?: string;
  className?: string;
}

const rankIcons = {
  1: <Trophy className="h-5 w-5 text-yellow-400" />,
  2: <Medal className="h-5 w-5 text-gray-300" />,
  3: <Award className="h-5 w-5 text-amber-600" />,
};

export function LeaderboardCard({ 
  title, 
  entries, 
  valueLabel = "",
  className 
}: LeaderboardCardProps) {
  return (
    <GlassCard className={cn("p-6", className)}>
      <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
        <Trophy className="h-5 w-5 text-primary" />
        {title}
      </h3>
      <div className="space-y-3">
        {entries.length === 0 ? (
          <div className="text-center py-6 text-muted-foreground">
            <p className="text-sm">Leaderboard will populate as your team grows</p>
          </div>
        ) : (
          entries.slice(0, 10).map((entry, index) => (
            <motion.div
              key={entry.rank}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.05 }}
              className={cn(
                "flex items-center gap-3 p-3 rounded-lg transition-colors",
                entry.isCurrentUser 
                  ? "bg-primary/20 border border-primary/30" 
                  : "bg-muted/50"
              )}
            >
              <div className="w-8 flex justify-center">
                {entry.rank <= 3 
                  ? rankIcons[entry.rank as 1 | 2 | 3]
                  : <span className="text-muted-foreground font-medium">{entry.rank}</span>
                }
              </div>
              <div className="flex-1">
                <p className={cn(
                  "font-medium text-sm",
                  entry.isCurrentUser && "text-primary"
                )}>
                  {entry.name}
                  {entry.isCurrentUser && <span className="ml-2 text-xs">(You)</span>}
                </p>
              </div>
              <div className="text-right">
                <p className="font-bold text-foreground">{entry.value}</p>
                {valueLabel && (
                  <p className="text-xs text-muted-foreground">{valueLabel}</p>
                )}
              </div>
            </motion.div>
          ))
        )}
      </div>
    </GlassCard>
  );
}
