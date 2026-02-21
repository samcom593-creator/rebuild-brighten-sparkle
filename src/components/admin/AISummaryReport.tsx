import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  Brain, Sparkles, RefreshCw, Loader2, ChevronDown, ChevronUp,
  TrendingUp, Users, AlertTriangle, Award, BarChart3,
} from "lucide-react";
import { GlassCard } from "@/components/ui/glass-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { format, subDays } from "date-fns";

export function AISummaryReport() {
  const [open, setOpen] = useState(true);
  const [report, setReport] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Fetch summary data for the AI to analyze
  const { data: stats } = useQuery({
    queryKey: ["ai-summary-report-stats"],
    queryFn: async () => {
      const today = format(new Date(), "yyyy-MM-dd");
      const weekAgo = format(subDays(new Date(), 7), "yyyy-MM-dd");
      const monthAgo = format(subDays(new Date(), 30), "yyyy-MM-dd");

      // Active agents count
      const { count: activeAgents } = await supabase
        .from("agents")
        .select("id", { count: "exact", head: true })
        .eq("status", "active")
        .eq("is_deactivated", false);

      // This week's production
      const { data: weekProd } = await supabase
        .rpc("get_agent_production_stats", { start_date: weekAgo, end_date: today });

      const weekAlp = weekProd?.reduce((s: number, p: any) => s + Number(p.total_alp || 0), 0) || 0;
      const weekDeals = weekProd?.reduce((s: number, p: any) => s + Number(p.total_deals || 0), 0) || 0;
      const weekPresentations = weekProd?.reduce((s: number, p: any) => s + Number(p.total_presentations || 0), 0) || 0;
      const producersCount = weekProd?.filter((p: any) => Number(p.total_alp) > 0).length || 0;

      // Applications stats
      const { count: totalApps } = await supabase
        .from("applications")
        .select("id", { count: "exact", head: true })
        .is("terminated_at", null);

      const { count: newThisWeek } = await supabase
        .from("applications")
        .select("id", { count: "exact", head: true })
        .gte("created_at", new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString())
        .is("terminated_at", null);

      const { count: licensedCount } = await supabase
        .from("applications")
        .select("id", { count: "exact", head: true })
        .eq("license_progress", "licensed")
        .is("terminated_at", null);

      const { count: inCourse } = await supabase
        .from("applications")
        .select("id", { count: "exact", head: true })
        .in("license_progress", ["course_purchased", "finished_course"])
        .is("terminated_at", null);

      const { count: testPhase } = await supabase
        .from("applications")
        .select("id", { count: "exact", head: true })
        .in("license_progress", ["test_scheduled", "passed_test"])
        .is("terminated_at", null);

      // Overdue (no contact 48h+)
      const cutoff = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
      const { count: overdueCount } = await supabase
        .from("applications")
        .select("id", { count: "exact", head: true })
        .is("terminated_at", null)
        .or(`last_contacted_at.lt.${cutoff},last_contacted_at.is.null`);

      return {
        activeAgents: activeAgents || 0,
        weekAlp,
        weekDeals,
        weekPresentations,
        producersCount,
        closingRate: weekPresentations > 0 ? Math.round((weekDeals / weekPresentations) * 100) : 0,
        totalApps: totalApps || 0,
        newThisWeek: newThisWeek || 0,
        licensedCount: licensedCount || 0,
        inCourse: inCourse || 0,
        testPhase: testPhase || 0,
        overdueCount: overdueCount || 0,
      };
    },
    staleTime: 300_000,
  });

  const generateReport = async () => {
    if (!stats) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("ai-assistant", {
        body: {
          type: "weekly_digest",
          stats,
        },
      });
      if (error) throw error;
      setReport(data.content);
    } catch (err) {
      console.error("AI Report error:", err);
      toast.error("Failed to generate report");
    } finally {
      setLoading(false);
    }
  };

  const quickStats = stats ? [
    { icon: Users, label: "Active Agents", value: stats.activeAgents, color: "text-blue-400" },
    { icon: TrendingUp, label: "Week ALP", value: `$${stats.weekAlp.toLocaleString()}`, color: "text-emerald-400" },
    { icon: BarChart3, label: "Producers", value: stats.producersCount, color: "text-purple-400" },
    { icon: AlertTriangle, label: "Overdue Leads", value: stats.overdueCount, color: "text-amber-400" },
    { icon: Award, label: "Licensed", value: stats.licensedCount, color: "text-emerald-400" },
  ] : [];

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <GlassCard className="overflow-hidden">
        <CollapsibleTrigger asChild>
          <button className="flex items-center gap-2 w-full px-4 py-3 text-sm font-semibold hover:bg-accent/30 transition-colors">
            <Brain className="h-4 w-4 text-primary" />
            <span className="gradient-text font-bold">AI Summary Report</span>
            <Badge className="text-[9px] bg-primary/20 text-primary border-primary/30 ml-1">
              Weekly Digest
            </Badge>
            {open ? <ChevronUp className="h-3.5 w-3.5 ml-auto text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 ml-auto text-muted-foreground" />}
          </button>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="px-4 pb-4 space-y-3">
            {/* Quick stats row */}
            {quickStats.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {quickStats.map((s) => (
                  <div key={s.label} className="flex items-center gap-1.5 rounded-full border border-border/60 bg-card px-3 py-1.5">
                    <s.icon className={cn("h-3 w-3", s.color)} />
                    <span className="text-[10px] text-muted-foreground">{s.label}</span>
                    <span className={cn("text-xs font-bold", s.color)}>{s.value}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Generate button */}
            <Button
              size="sm"
              onClick={generateReport}
              disabled={loading || !stats}
              className="text-xs h-7 gap-1.5"
            >
              {loading ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : report ? (
                <RefreshCw className="h-3 w-3" />
              ) : (
                <Sparkles className="h-3 w-3" />
              )}
              {report ? "Refresh Report" : "Generate AI Report"}
            </Button>

            {/* Report content */}
            <AnimatePresence>
              {report && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden"
                >
                  <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 text-sm text-foreground whitespace-pre-wrap leading-relaxed">
                    {report}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </CollapsibleContent>
      </GlassCard>
    </Collapsible>
  );
}