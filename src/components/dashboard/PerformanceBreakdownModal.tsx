import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { BarChart3, Brain, TrendingUp, Target, Users, Loader2, Zap, Award } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/glass-card";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Cell, RadarChart, PolarGrid, PolarAngleAxis, Radar, Legend } from "recharts";
import { cn } from "@/lib/utils";

interface LeaderboardEntry {
  rank: number;
  agentId: string;
  name: string;
  avatarUrl?: string;
  alp: number;
  deals: number;
  presentations: number;
  closingRate: number;
  hoursCalled?: number;
  referrals?: number;
  isCurrentUser: boolean;
}

interface PerformanceBreakdownModalProps {
  currentAgentId: string;
  entries: LeaderboardEntry[];
  period: string;
}

export function PerformanceBreakdownModal({ currentAgentId, entries, period }: PerformanceBreakdownModalProps) {
  const [open, setOpen] = useState(false);
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [loadingAI, setLoadingAI] = useState(false);

  const currentAgent = entries.find(e => e.agentId === currentAgentId);
  const currentRank = entries.findIndex(e => e.agentId === currentAgentId) + 1;

  // Calculate team averages
  const teamAverages = useMemo(() => {
    if (entries.length === 0) return { alp: 0, presentations: 0, deals: 0, closingRate: 0 };
    return {
      alp: entries.reduce((sum, e) => sum + e.alp, 0) / entries.length,
      presentations: entries.reduce((sum, e) => sum + e.presentations, 0) / entries.length,
      deals: entries.reduce((sum, e) => sum + e.deals, 0) / entries.length,
      closingRate: entries.reduce((sum, e) => sum + e.closingRate, 0) / entries.length,
    };
  }, [entries]);

  // Comparison bar chart data
  const barChartData = useMemo(() => {
    if (!currentAgent) return [];
    return [
      { name: "ALP", you: currentAgent.alp, team: teamAverages.alp },
      { name: "Presentations", you: currentAgent.presentations, team: teamAverages.presentations },
      { name: "Deals", you: currentAgent.deals, team: teamAverages.deals },
      { name: "Close %", you: currentAgent.closingRate, team: teamAverages.closingRate },
    ];
  }, [currentAgent, teamAverages]);

  // Radar chart data
  const radarData = useMemo(() => {
    if (!currentAgent || entries.length === 0) return [];
    
    const maxAlp = Math.max(...entries.map(e => e.alp)) || 1;
    const maxPresentations = Math.max(...entries.map(e => e.presentations)) || 1;
    const maxDeals = Math.max(...entries.map(e => e.deals)) || 1;
    const maxCloseRate = Math.max(...entries.map(e => e.closingRate)) || 1;

    return [
      { 
        metric: "ALP", 
        you: (currentAgent.alp / maxAlp) * 100, 
        teamAvg: (teamAverages.alp / maxAlp) * 100 
      },
      { 
        metric: "Presentations", 
        you: (currentAgent.presentations / maxPresentations) * 100, 
        teamAvg: (teamAverages.presentations / maxPresentations) * 100 
      },
      { 
        metric: "Deals", 
        you: (currentAgent.deals / maxDeals) * 100, 
        teamAvg: (teamAverages.deals / maxDeals) * 100 
      },
      { 
        metric: "Close Rate", 
        you: (currentAgent.closingRate / maxCloseRate) * 100, 
        teamAvg: (teamAverages.closingRate / maxCloseRate) * 100 
      },
    ];
  }, [currentAgent, entries, teamAverages]);

  const getAISummary = async () => {
    if (!currentAgent) return;
    setLoadingAI(true);
    try {
      const { data, error } = await supabase.functions.invoke("ai-assistant", {
        body: {
          type: "performance_breakdown",
          agentStats: {
            alp: currentAgent.alp,
            presentations: currentAgent.presentations,
            deals: currentAgent.deals,
            closingRate: currentAgent.closingRate,
          },
          teamAverages,
          rank: currentRank,
          totalAgents: entries.length,
        }
      });
      
      if (error) throw error;
      setAiSummary(data.content);
    } catch (error) {
      console.error("AI summary error:", error);
      setAiSummary("Unable to generate analysis. Please try again.");
    } finally {
      setLoadingAI(false);
    }
  };

  const getPercentageVsTeam = (value: number, teamAvg: number) => {
    if (teamAvg === 0) return value > 0 ? 100 : 0;
    return Math.round(((value - teamAvg) / teamAvg) * 100);
  };

  if (!currentAgent) return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5 text-xs">
          <BarChart3 className="h-3.5 w-3.5" />
          Where You Rank
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-primary" />
            Your Performance Breakdown
          </DialogTitle>
        </DialogHeader>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-6"
        >
          {/* Rank Summary */}
          <GlassCard className="p-6 text-center">
            <motion.div
              initial={{ scale: 0.8 }}
              animate={{ scale: 1 }}
              transition={{ type: "spring", damping: 10 }}
            >
              <p className="text-5xl font-bold text-primary">#{currentRank}</p>
              <p className="text-sm text-muted-foreground mt-1">
                out of {entries.length} agents ({period === "day" ? "Today" : period === "week" ? "This Week" : "All Time"})
              </p>
            </motion.div>
          </GlassCard>

          {/* Team Averages Comparison */}
          <div className="space-y-4">
            <h4 className="font-semibold flex items-center gap-2 text-sm">
              <Users className="h-4 w-4" />
              Your Stats vs Team Average
            </h4>
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: "ALP", value: currentAgent.alp, avg: teamAverages.alp, format: (v: number) => `$${v >= 1000 ? (v/1000).toFixed(1) + "k" : v.toFixed(0)}` },
                { label: "Presentations", value: currentAgent.presentations, avg: teamAverages.presentations, format: (v: number) => v.toFixed(0) },
                { label: "Deals", value: currentAgent.deals, avg: teamAverages.deals, format: (v: number) => v.toFixed(0) },
                { label: "Closing Rate", value: currentAgent.closingRate, avg: teamAverages.closingRate, format: (v: number) => `${v.toFixed(1)}%` },
              ].map((stat) => {
                const pct = getPercentageVsTeam(stat.value, stat.avg);
                const isAbove = pct >= 0;
                return (
                  <div key={stat.label} className="p-3 rounded-lg bg-muted/50 border border-border">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs text-muted-foreground">{stat.label}</span>
                      <span className={cn(
                        "text-xs font-medium flex items-center gap-0.5",
                        isAbove ? "text-emerald-500" : "text-red-400"
                      )}>
                        {isAbove ? <TrendingUp className="h-3 w-3" /> : <TrendingUp className="h-3 w-3 rotate-180" />}
                        {isAbove ? "+" : ""}{pct}%
                      </span>
                    </div>
                    <div className="flex items-end justify-between">
                      <span className="text-lg font-bold">{stat.format(stat.value)}</span>
                      <span className="text-xs text-muted-foreground">avg: {stat.format(stat.avg)}</span>
                    </div>
                    <Progress 
                      value={Math.min((stat.value / (stat.avg * 2)) * 100, 100)} 
                      className="h-1.5 mt-2"
                    />
                  </div>
                );
              })}
            </div>
          </div>

          {/* Visual Charts */}
          <div className="grid md:grid-cols-2 gap-4">
            {/* Bar Chart */}
            <div className="space-y-2">
              <h4 className="font-semibold text-sm flex items-center gap-2">
                <Target className="h-4 w-4" />
                Performance Comparison
              </h4>
              <div className="h-48 bg-muted/30 rounded-lg p-2">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={barChartData} barCategoryGap="20%">
                    <XAxis dataKey="name" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                    <Bar dataKey="you" name="You" radius={[4, 4, 0, 0]}>
                      {barChartData.map((_, index) => (
                        <Cell key={`you-${index}`} fill="hsl(var(--primary))" />
                      ))}
                    </Bar>
                    <Bar dataKey="team" name="Team Avg" radius={[4, 4, 0, 0]}>
                      {barChartData.map((_, index) => (
                        <Cell key={`team-${index}`} fill="hsl(var(--muted-foreground))" />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Radar Chart */}
            <div className="space-y-2">
              <h4 className="font-semibold text-sm flex items-center gap-2">
                <Zap className="h-4 w-4" />
                Skill Radar
              </h4>
              <div className="h-48 bg-muted/30 rounded-lg p-2">
                <ResponsiveContainer width="100%" height="100%">
                  <RadarChart data={radarData}>
                    <PolarGrid stroke="hsl(var(--border))" />
                    <PolarAngleAxis dataKey="metric" tick={{ fontSize: 10 }} />
                    <Radar 
                      name="You" 
                      dataKey="you" 
                      stroke="hsl(var(--primary))" 
                      fill="hsl(var(--primary))" 
                      fillOpacity={0.4} 
                    />
                    <Radar 
                      name="Team Avg" 
                      dataKey="teamAvg" 
                      stroke="hsl(var(--muted-foreground))" 
                      fill="hsl(var(--muted-foreground))" 
                      fillOpacity={0.2} 
                    />
                    <Legend wrapperStyle={{ fontSize: 10 }} />
                  </RadarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* AI Summary */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="font-semibold text-sm flex items-center gap-2">
                <Brain className="h-4 w-4" />
                AI Performance Analysis
              </h4>
              <Button 
                size="sm" 
                onClick={getAISummary} 
                disabled={loadingAI}
                className="gap-1.5"
              >
                {loadingAI ? (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Analyzing...
                  </>
                ) : aiSummary ? (
                  "Refresh"
                ) : (
                  <>
                    <Brain className="h-3 w-3" />
                    Get Analysis
                  </>
                )}
              </Button>
            </div>
            <AnimatePresence mode="popLayout">
              {aiSummary && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="p-4 rounded-lg bg-primary/5 border border-primary/20"
                >
                  <p className="text-sm leading-relaxed">{aiSummary}</p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Quick Tips */}
          {currentRank > 3 && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.3 }}
              className="p-4 rounded-lg bg-amber-500/10 border border-amber-500/20"
            >
              <div className="flex items-start gap-3">
                <Award className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-sm text-amber-500">Push to Top 3!</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    You need ${Math.max(0, (entries[2]?.alp || 0) - currentAgent.alp).toLocaleString()} more ALP to reach the top 3.
                    {entries[currentRank - 2] && ` Just ${Math.max(0, entries[currentRank - 2].alp - currentAgent.alp).toLocaleString()} ALP to pass ${entries[currentRank - 2].name.split(" ")[0]}!`}
                  </p>
                </div>
              </div>
            </motion.div>
          )}
        </motion.div>
      </DialogContent>
    </Dialog>
  );
}
