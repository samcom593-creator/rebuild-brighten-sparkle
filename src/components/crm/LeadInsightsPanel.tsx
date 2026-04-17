import { useState } from "react";
import { Sparkles, Loader2, TrendingUp, AlertTriangle, CheckCircle2, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { GlassCard } from "@/components/ui/glass-card";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface NextAction {
  action: string;
  priority: "high" | "medium" | "low";
  why: string;
}

interface Insights {
  score: number;
  tier: "hot" | "warm" | "cold" | "dead";
  summary: string;
  strengths: string[];
  risks: string[];
  next_actions: NextAction[];
  suggested_message: string;
}

interface LeadInsightsPanelProps {
  applicationId?: string;
  agentId?: string;
  className?: string;
}

const TIER_COLORS: Record<Insights["tier"], string> = {
  hot: "bg-red-500/15 text-red-400 border-red-500/30",
  warm: "bg-orange-500/15 text-orange-400 border-orange-500/30",
  cold: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  dead: "bg-muted text-muted-foreground border-border",
};

const PRIORITY_COLORS: Record<NextAction["priority"], string> = {
  high: "bg-red-500/15 text-red-400",
  medium: "bg-yellow-500/15 text-yellow-400",
  low: "bg-muted text-muted-foreground",
};

export function LeadInsightsPanel({ applicationId, agentId, className }: LeadInsightsPanelProps) {
  const [loading, setLoading] = useState(false);
  const [insights, setInsights] = useState<Insights | null>(null);

  const generate = async () => {
    if (!applicationId && !agentId) return;
    setLoading(true);
    setInsights(null);
    try {
      const { data, error } = await supabase.functions.invoke("ai-lead-insights", {
        body: applicationId ? { applicationId } : { agentId },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      setInsights((data as any).insights);
    } catch (err: any) {
      toast.error(err.message || "Failed to generate insights");
    } finally {
      setLoading(false);
    }
  };

  return (
    <GlassCard className={cn("p-4 space-y-4", className)}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <h3 className="font-semibold">AI Insights</h3>
        </div>
        <Button
          size="sm"
          variant={insights ? "outline" : "default"}
          onClick={generate}
          disabled={loading}
          className="gap-1.5"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          {insights ? "Regenerate" : "Analyze"}
        </Button>
      </div>

      {!insights && !loading && (
        <p className="text-sm text-muted-foreground">
          Get AI-powered analysis: score, strengths, risks, and recommended next actions.
        </p>
      )}

      {loading && (
        <div className="flex items-center justify-center py-8 text-muted-foreground gap-2 text-sm">
          <Loader2 className="h-4 w-4 animate-spin" /> Analyzing...
        </div>
      )}

      {insights && (
        <div className="space-y-4">
          {/* Score + tier */}
          <div className="flex items-center gap-3">
            <div className="text-3xl font-bold tabular-nums">{insights.score}</div>
            <Badge className={cn("uppercase text-xs", TIER_COLORS[insights.tier])} variant="outline">
              {insights.tier}
            </Badge>
            <p className="text-sm text-foreground flex-1">{insights.summary}</p>
          </div>

          {/* Strengths */}
          {insights.strengths.length > 0 && (
            <div>
              <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground mb-1.5">
                <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                Strengths
              </div>
              <ul className="space-y-1 text-sm">
                {insights.strengths.map((s, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="text-green-500">▸</span> {s}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Risks */}
          {insights.risks.length > 0 && (
            <div>
              <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground mb-1.5">
                <AlertTriangle className="h-3.5 w-3.5 text-yellow-500" />
                Risks
              </div>
              <ul className="space-y-1 text-sm">
                {insights.risks.map((r, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="text-yellow-500">▸</span> {r}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Next actions */}
          {insights.next_actions.length > 0 && (
            <div>
              <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground mb-1.5">
                <TrendingUp className="h-3.5 w-3.5 text-primary" />
                Next Actions
              </div>
              <ul className="space-y-2">
                {insights.next_actions.map((a, i) => (
                  <li key={i} className="text-sm border border-border/50 rounded-md p-2 space-y-1">
                    <div className="flex items-start gap-2">
                      <Badge className={cn("text-[10px] uppercase", PRIORITY_COLORS[a.priority])} variant="secondary">
                        {a.priority}
                      </Badge>
                      <span className="font-medium flex-1">{a.action}</span>
                    </div>
                    <p className="text-xs text-muted-foreground pl-1">{a.why}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Suggested message */}
          {insights.suggested_message && (
            <div>
              <div className="flex items-center justify-between text-xs font-medium text-muted-foreground mb-1.5">
                <span>Suggested opener</span>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(insights.suggested_message);
                    toast.success("Copied");
                  }}
                  className="flex items-center gap-1 hover:text-foreground transition-colors"
                >
                  <Copy className="h-3 w-3" /> Copy
                </button>
              </div>
              <div className="text-sm bg-muted/30 rounded-md p-2 italic">
                {insights.suggested_message}
              </div>
            </div>
          )}
        </div>
      )}
    </GlassCard>
  );
}
