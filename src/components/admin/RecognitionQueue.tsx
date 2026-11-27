import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Award, Loader2, Send, Eye, RefreshCw } from "lucide-react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { useBusinessToday } from "@/hooks/useBusinessToday";
import { looseSupabase } from "@/lib/looseSupabase";
import {
  assertRecognitionSent, buildRecognitionCandidates, readRecognitionProduction,
  recognitionWindows, RECOGNITION_MILESTONES, type PlaqueCandidate, type RecognitionAward,
} from "@/lib/recognitionQueue";

const achievementConfig = {
  bronze: { label: "Bronze Achievement", threshold: 1000, color: "bg-amber-700", textColor: "text-amber-700" },
  gold: { label: "Gold Achievement", threshold: 3000, color: "bg-amber-500", textColor: "text-amber-500" },
  platinum: { label: "Platinum Achievement", threshold: 5000, color: "bg-gray-300", textColor: "text-gray-600" },
  weekly: { label: "Weekly Diamond", threshold: 10000, color: "bg-info", textColor: "text-info" },
  monthly: { label: "Elite Producer", threshold: 25000, color: "bg-purple-600", textColor: "text-purple-600" },
};

export function RecognitionQueue() {
  const queryClient = useQueryClient();
  const [previewCandidate, setPreviewCandidate] = useState<PlaqueCandidate | null>(null);

  const { user } = useAuth();
  const today = useBusinessToday();
  const { data: candidates, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ["recognition-candidates", user?.id, today],
    enabled: Boolean(user?.id),
    staleTime: 120_000,
    retry: 1,
    queryFn: async () => {
      const windows = recognitionWindows(today);
      const readPeriod = async (period: keyof typeof windows) => {
        const window = windows[period];
        // Reuse the scoreboard cache and its server-side identity/scope rules.
        // Do not add a polling loop to this expensive production read.
        const value = await queryClient.fetchQuery({
          queryKey: ["scoped-production-scoreboard", window.start, window.end, user!.id],
          staleTime: 120_000,
          queryFn: async () => {
            const { data, error } = await looseSupabase.rpc("scoped_production_scoreboard", {
              p_start: window.start, p_end: window.end,
            });
            if (error) throw error;
            return data;
          },
        });
        return readRecognitionProduction(value);
      };
      const readAwards = async () => {
        const awards: RecognitionAward[] = [];
        const start = windows.week.start < windows.month.start ? windows.week.start : windows.month.start;
        for (let offset = 0; ; offset += 1000) {
          const { data, error } = await supabase.from("plaque_awards")
            .select("agent_id, milestone_type, milestone_date, email_sent_at, email_delivery_status")
            .gte("milestone_date", start).lte("milestone_date", today)
            .order("id").range(offset, offset + 999);
          if (error) throw error;
          if (!data) throw new Error("Existing recognition records could not be loaded.");
          awards.push(...data);
          if (data.length < 1000) return awards;
        }
      };
      const [day, week, month, awards] = await Promise.all([
        readPeriod("day"), readPeriod("week"), readPeriod("month"), readAwards(),
      ]);
      return buildRecognitionCandidates(today, { day, week, month }, awards);
    },
  });

  // Send plaque mutation
  const sendPlaque = useMutation({
    mutationFn: async (candidate: PlaqueCandidate) => {
      const { data, error } = await supabase.functions.invoke("send-plaque-recognition", {
        body: {
          agentId: candidate.agentId,
          milestoneType: RECOGNITION_MILESTONES[candidate.achievement],
          amount: candidate.amount,
          date: candidate.period,
        },
      });

      if (error) throw error;
      assertRecognitionSent(data);
    },
    onSuccess: (_, candidate) => {
      toast("Recognition sent", { description: `${achievementConfig[candidate.achievement].label} plaque sent to ${candidate.agentName}` });
      void queryClient.invalidateQueries({ queryKey: ["recognition-candidates", user?.id] });
      void queryClient.invalidateQueries({ queryKey: ["email-delivery-log"] });
    },
    onError: (error) => {
      toast.error("Failed to send", { description: error.message });
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
          <p className="mb-3 text-xs text-muted-foreground">Posted annual premium · business dates · your production scope</p>
          {isError ? (
            <div role="alert" className="space-y-3 py-5 text-sm">
              <p>Recognition could not be checked. {error instanceof Error ? error.message : "Retry to load production and delivery records."}</p>
              <Button variant="outline" size="sm" onClick={() => void refetch()} disabled={isFetching}>
                <RefreshCw className="mr-2 h-4 w-4" /> Retry
              </Button>
            </div>
          ) : isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : !candidates || candidates.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Award className="h-10 w-10 mx-auto mb-3 opacity-50" />
              <p className="text-sm">No pending recognitions</p>
              <p className="text-xs mt-1">No unsent milestones found for these business dates.</p>
            </div>
          ) : (
            <div className="space-y-3 max-h-[400px] overflow-y-auto scrollbar-custom">
              {candidates.map((candidate) => {
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
                      <p className="font-bold">${Math.round(candidate.amount).toLocaleString()}</p>
                    </div>

                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Preview plaque"
                        className="h-8 w-8"
                        onClick={() => setPreviewCandidate(candidate)}
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="default"
                        size="icon"
                        aria-label="Send plaque"
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
          <Link to="/dashboard/email-log" className="mt-4 inline-flex min-h-11 items-center text-sm font-medium text-primary underline underline-offset-4">
            Review recognition delivery
          </Link>
        </CardContent>
      </Card>

      {/* Preview Dialog */}
      <Dialog open={!!previewCandidate} onOpenChange={() => setPreviewCandidate(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Plaque Preview</DialogTitle>
          </DialogHeader>
          {previewCandidate && (
            <div className="bg-white dark:bg-card p-6 rounded-lg text-center space-y-4">
              <p className="text-xs uppercase tracking-widest text-muted-foreground">
                {achievementConfig[previewCandidate.achievement].label}
              </p>
              <h2 className="text-2xl font-serif font-bold text-foreground">
                {previewCandidate.agentName}
              </h2>
              <div className="text-4xl font-bold text-amber-400">
                ${Math.round(previewCandidate.amount).toLocaleString()}
              </div>
              <p className="text-sm text-muted-foreground">{previewCandidate.periodLabel}</p>
              <div className="pt-4 border-t border-border">
                <p className="text-xs text-muted-foreground">GALAXY FINANCIAL GROUP</p>
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
