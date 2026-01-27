import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Award, Check, X, Loader2, Send, Eye } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { format, startOfWeek, startOfMonth } from "date-fns";

interface PlaqueCandidate {
  agentId: string;
  agentName: string;
  achievement: "bronze" | "gold" | "platinum" | "weekly" | "monthly";
  amount: number;
  period: string;
  periodLabel: string;
}

const achievementConfig = {
  bronze: { label: "Bronze Achievement", threshold: 1000, color: "bg-amber-700", textColor: "text-amber-700" },
  gold: { label: "Gold Achievement", threshold: 3000, color: "bg-amber-500", textColor: "text-amber-500" },
  platinum: { label: "Platinum Achievement", threshold: 5000, color: "bg-gray-300", textColor: "text-gray-600" },
  weekly: { label: "Weekly Diamond", threshold: 10000, color: "bg-cyan-400", textColor: "text-cyan-500" },
  monthly: { label: "Elite Producer", threshold: 25000, color: "bg-purple-600", textColor: "text-purple-600" },
};

export function RecognitionQueue() {
  const queryClient = useQueryClient();
  const [previewCandidate, setPreviewCandidate] = useState<PlaqueCandidate | null>(null);

  // Scan for recognition candidates
  const { data: candidates, isLoading } = useQuery({
    queryKey: ["recognition-candidates"],
    queryFn: async () => {
      const now = new Date();
      const weekStart = format(startOfWeek(now, { weekStartsOn: 1 }), "yyyy-MM-dd");
      const monthStart = format(startOfMonth(now), "yyyy-MM-dd");
      const today = format(now, "yyyy-MM-dd");

      // Get all production with agent names
      const { data: production, error } = await supabase
        .from("daily_production")
        .select(`
          agent_id,
          aop,
          production_date,
          agents!daily_production_agent_id_fkey (
            profiles!agents_profile_id_fkey (
              full_name
            )
          )
        `)
        .gte("production_date", monthStart);

      if (error) throw error;

      const candidates: PlaqueCandidate[] = [];
      const agentStats = new Map<string, { 
        name: string; 
        daily: Map<string, number>;
        weekTotal: number;
        monthTotal: number;
      }>();

      // Aggregate production
      production?.forEach((p) => {
        const name = p.agents?.profiles?.full_name || "Unknown";
        if (name === "Unknown" || !name.trim()) return;

        const existing = agentStats.get(p.agent_id) || {
          name,
          daily: new Map(),
          weekTotal: 0,
          monthTotal: 0,
        };

        const dayAmount = existing.daily.get(p.production_date) || 0;
        existing.daily.set(p.production_date, dayAmount + Number(p.aop || 0));
        existing.monthTotal += Number(p.aop || 0);
        
        if (p.production_date >= weekStart) {
          existing.weekTotal += Number(p.aop || 0);
        }

        agentStats.set(p.agent_id, existing);
      });

      // Scan for achievements
      agentStats.forEach((stats, agentId) => {
        // Daily achievements (today only for queue)
        const todayAmount = stats.daily.get(today) || 0;
        
        if (todayAmount >= 5000) {
          candidates.push({
            agentId,
            agentName: stats.name,
            achievement: "platinum",
            amount: Math.round(todayAmount),
            period: today,
            periodLabel: "Today",
          });
        } else if (todayAmount >= 3000) {
          candidates.push({
            agentId,
            agentName: stats.name,
            achievement: "gold",
            amount: Math.round(todayAmount),
            period: today,
            periodLabel: "Today",
          });
        } else if (todayAmount >= 1000) {
          candidates.push({
            agentId,
            agentName: stats.name,
            achievement: "bronze",
            amount: Math.round(todayAmount),
            period: today,
            periodLabel: "Today",
          });
        }

        // Weekly achievement
        if (stats.weekTotal >= 10000) {
          candidates.push({
            agentId,
            agentName: stats.name,
            achievement: "weekly",
            amount: Math.round(stats.weekTotal),
            period: weekStart,
            periodLabel: "This Week",
          });
        }

        // Monthly achievement
        if (stats.monthTotal >= 25000) {
          candidates.push({
            agentId,
            agentName: stats.name,
            achievement: "monthly",
            amount: Math.round(stats.monthTotal),
            period: monthStart,
            periodLabel: format(now, "MMMM yyyy"),
          });
        }
      });

      // Sort by amount descending
      return candidates.sort((a, b) => b.amount - a.amount);
    },
    refetchInterval: 60000, // Refresh every minute
  });

  // Send plaque mutation
  const sendPlaque = useMutation({
    mutationFn: async (candidate: PlaqueCandidate) => {
      const milestoneTypeMap: Record<string, string> = {
        bronze: "single_day_bronze",
        gold: "single_day",
        platinum: "single_day",
        weekly: "weekly",
        monthly: "monthly",
      };

      const { error } = await supabase.functions.invoke("send-plaque-recognition", {
        body: {
          agentId: candidate.agentId,
          milestoneType: milestoneTypeMap[candidate.achievement],
          amount: candidate.amount,
          date: candidate.period,
        },
      });

      if (error) throw error;
    },
    onSuccess: (_, candidate) => {
      toast({
        title: "Recognition sent",
        description: `${achievementConfig[candidate.achievement].label} plaque sent to ${candidate.agentName}`,
      });
      queryClient.invalidateQueries({ queryKey: ["recognition-candidates"] });
    },
    onError: (error) => {
      toast({
        title: "Failed to send",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg font-semibold flex items-center gap-2">
              <Award className="h-5 w-5 text-primary" />
              Recognition Queue
            </CardTitle>
            {candidates && candidates.length > 0 && (
              <Badge className="bg-primary">{candidates.length} pending</Badge>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : !candidates || candidates.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Award className="h-10 w-10 mx-auto mb-3 opacity-50" />
              <p className="text-sm">No pending recognitions</p>
              <p className="text-xs mt-1">Achievements will appear here automatically</p>
            </div>
          ) : (
            <div className="space-y-3 max-h-[400px] overflow-y-auto scrollbar-custom">
              {candidates.map((candidate, index) => {
                const config = achievementConfig[candidate.achievement];
                return (
                  <div
                    key={`${candidate.agentId}-${candidate.achievement}-${candidate.period}`}
                    className="flex items-center gap-3 p-3 rounded-lg bg-muted/50 border border-border"
                  >
                    <div className={cn(
                      "w-2 h-10 rounded-full",
                      config.color
                    )} />
                    
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">{candidate.agentName}</p>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className={cn("text-xs", config.textColor)}>
                          {config.label}
                        </Badge>
                        <span className="text-xs text-muted-foreground">{candidate.periodLabel}</span>
                      </div>
                    </div>

                    <div className="text-right mr-2">
                      <p className="font-bold">${candidate.amount.toLocaleString()}</p>
                    </div>

                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => setPreviewCandidate(candidate)}
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="default"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => sendPlaque.mutate(candidate)}
                        disabled={sendPlaque.isPending}
                      >
                        {sendPlaque.isPending ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Send className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Preview Dialog */}
      <Dialog open={!!previewCandidate} onOpenChange={() => setPreviewCandidate(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Plaque Preview</DialogTitle>
          </DialogHeader>
          {previewCandidate && (
            <div className="bg-gradient-to-b from-gray-900 to-black p-6 rounded-lg text-center space-y-4">
              <p className="text-xs uppercase tracking-widest text-gray-400">
                {achievementConfig[previewCandidate.achievement].label}
              </p>
              <h2 className="text-2xl font-serif font-bold text-white">
                {previewCandidate.agentName}
              </h2>
              <div className="text-4xl font-bold text-amber-400">
                ${previewCandidate.amount.toLocaleString()}
              </div>
              <p className="text-sm text-gray-400">{previewCandidate.periodLabel}</p>
              <div className="pt-4 border-t border-gray-800">
                <p className="text-xs text-gray-500">APEX FINANCIAL GROUP</p>
              </div>
            </div>
          )}
          <div className="flex gap-2 mt-4">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => setPreviewCandidate(null)}
            >
              Close
            </Button>
            <Button
              className="flex-1 gap-2"
              onClick={() => {
                if (previewCandidate) {
                  sendPlaque.mutate(previewCandidate);
                  setPreviewCandidate(null);
                }
              }}
              disabled={sendPlaque.isPending}
            >
              <Send className="h-4 w-4" />
              Send Plaque
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
