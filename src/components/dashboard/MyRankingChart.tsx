import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { BarChart3, Trophy, TrendingUp, Star, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerClose } from "@/components/ui/drawer";
import { cn } from "@/lib/utils";

interface RankingEntry {
  rank: number;
  agentId: string;
  name: string;
  alp: number;
  isCurrentUser: boolean;
}

interface MyRankingChartProps {
  currentAgentId?: string;
  entries: RankingEntry[];
}

export function MyRankingChart({ currentAgentId, entries }: MyRankingChartProps) {
  const [open, setOpen] = useState(false);
  
  // Sort by ALP descending and assign ranks
  const sortedEntries = [...entries]
    .sort((a, b) => b.alp - a.alp)
    .map((entry, index) => ({ ...entry, rank: index + 1 }));
  
  const maxALP = sortedEntries[0]?.alp || 1;
  const currentUser = sortedEntries.find(e => e.agentId === currentAgentId);
  const currentRank = currentUser?.rank || 0;
  const totalAgents = sortedEntries.length;
  const percentile = totalAgents > 0 ? Math.round(((totalAgents - currentRank + 1) / totalAgents) * 100) : 0;
  
  // Calculate gaps
  const prevAgent = currentRank > 1 ? sortedEntries[currentRank - 2] : null;
  const topAgent = sortedEntries[0];
  const gapToNext = prevAgent ? prevAgent.alp - (currentUser?.alp || 0) : 0;
  const gapToFirst = topAgent && currentUser ? topAgent.alp - currentUser.alp : 0;

  return (
    <>
      {/* Trigger Button */}
      <div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setOpen(true)}
          className={cn(
            "gap-1.5 text-xs font-semibold",
            "border-primary/30 hover:bg-primary/10 hover:border-primary/50",
            "bg-gradient-to-r from-primary/5 to-transparent"
          )}
        >
          <BarChart3 className="h-3.5 w-3.5 text-primary" />
          My Rank
        </Button>
      </div>

      {/* Drawer */}
      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerContent className="max-h-[85vh]">
          <DrawerHeader className="border-b border-border/50 pb-4">
            <div className="flex items-center justify-between">
              <DrawerTitle className="flex items-center gap-2 text-lg">
                <BarChart3 className="h-5 w-5 text-primary" />
                Where You Stand
              </DrawerTitle>
              <DrawerClose asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8">
                  <X className="h-4 w-4" />
                </Button>
              </DrawerClose>
            </div>
          </DrawerHeader>

          <div className="p-4 overflow-y-auto">
            {/* Current Position Summary */}
            {currentUser && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="mb-5 p-4 rounded-xl bg-gradient-to-r from-primary/10 to-primary/5 border border-primary/20"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-muted-foreground">Your Position</span>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-primary/20 text-primary font-semibold">
                    Top {percentile}%
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex items-center justify-center h-12 w-12 rounded-full bg-gradient-to-br from-primary to-primary/60">
                    <span className="text-xl font-bold text-white">#{currentRank}</span>
                  </div>
                  <div>
                    <p className="font-bold text-lg">{currentUser.name}</p>
                    <p className="text-sm text-muted-foreground">
                      out of {totalAgents} agents
                    </p>
                  </div>
                </div>
              </motion.div>
            )}

            {/* Visual Ranking Chart */}
            <div className="space-y-2 mb-5">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                Leaderboard Breakdown
              </h4>
              
              {sortedEntries.map((entry, index) => {
                const barWidth = maxALP > 0 ? (entry.alp / maxALP) * 100 : 0;
                const isCurrentUser = entry.agentId === currentAgentId;
                
                return (
                  <motion.div
                    key={entry.agentId}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: index * 0.03 }}
                    className={cn(
                      "relative flex items-center gap-2 p-2 rounded-lg transition-all",
                      isCurrentUser && "bg-primary/10 border border-primary/30"
                    )}
                  >
                    {/* Rank */}
                    <div className={cn(
                      "flex items-center justify-center h-6 w-6 rounded-full text-xs font-bold shrink-0",
                      entry.rank === 1 && "bg-gradient-to-br from-amber-400 to-amber-600 text-white",
                      entry.rank === 2 && "bg-gradient-to-br from-slate-300 to-slate-400 text-slate-700",
                      entry.rank === 3 && "bg-gradient-to-br from-amber-600 to-amber-800 text-white",
                      entry.rank > 3 && "bg-muted text-muted-foreground"
                    )}>
                      {entry.rank}
                    </div>
                    
                    {/* Name */}
                    <div className="flex items-center gap-1.5 min-w-[80px] shrink-0">
                      <span className={cn(
                        "text-sm font-medium truncate max-w-[70px]",
                        isCurrentUser && "text-primary font-bold"
                      )}>
                        {isCurrentUser ? "YOU" : entry.name.split(" ")[0]}
                      </span>
                      {isCurrentUser && <Star className="h-3 w-3 text-amber-400 fill-amber-400" />}
                    </div>
                    
                    {/* Bar */}
                    <div className="flex-1 h-5 bg-muted/50 rounded-full overflow-hidden relative">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${barWidth}%` }}
                        transition={{ delay: index * 0.03 + 0.1, duration: 0.5 }}
                        className={cn(
                          "absolute inset-y-0 left-0 rounded-full",
                          isCurrentUser 
                            ? "bg-gradient-to-r from-primary to-primary/70" 
                            : entry.rank <= 3 
                              ? "bg-gradient-to-r from-amber-500 to-amber-400"
                              : "bg-gradient-to-r from-muted-foreground/40 to-muted-foreground/20"
                        )}
                      />
                    </div>
                    
                    {/* ALP */}
                    <span className={cn(
                      "text-xs font-semibold min-w-[60px] text-right",
                      isCurrentUser ? "text-primary" : "text-muted-foreground"
                    )}>
                      ${entry.alp.toLocaleString()}
                    </span>
                  </motion.div>
                );
              })}
            </div>

            {/* Gap Analysis */}
            {currentUser && currentRank > 1 && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
                className="space-y-3 pt-4 border-t border-border/50"
              >
                {prevAgent && gapToNext > 0 && (
                  <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/30">
                    <TrendingUp className="h-5 w-5 text-emerald-500" />
                    <div className="flex-1">
                      <p className="text-sm font-medium">Gap to #{currentRank - 1}</p>
                      <p className="text-xs text-muted-foreground">
                        ${gapToNext.toLocaleString()} to overtake {prevAgent.name.split(" ")[0]}
                      </p>
                    </div>
                  </div>
                )}
                
                {currentRank > 1 && gapToFirst > 0 && (
                  <div className="flex items-center gap-3 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
                    <Trophy className="h-5 w-5 text-amber-500" />
                    <div className="flex-1">
                      <p className="text-sm font-medium">Gap to #1</p>
                      <p className="text-xs text-muted-foreground">
                        ${gapToFirst.toLocaleString()} to reach the top
                      </p>
                    </div>
                  </div>
                )}
              </motion.div>
            )}
          </div>
        </DrawerContent>
      </Drawer>
    </>
  );
}
