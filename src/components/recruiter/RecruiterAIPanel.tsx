import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Brain, Sparkles, Flame, AlertTriangle, Clock, TrendingUp,
  ChevronDown, ChevronUp, Loader2, RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/glass-card";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { SCORE_THRESHOLDS, PROGRESS_COLUMNS } from "@/lib/apexConfig";

interface Lead {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  city: string | null;
  state: string | null;
  created_at: string;
  last_contacted_at: string | null;
  contacted_at: string | null;
  license_status: string;
  license_progress: string | null;
  test_scheduled_date: string | null;
  notes: string | null;
  assigned_agent_id: string | null;
  referral_source: string | null;
}

function computeScoreSimple(lead: Lead): number {
  let score = 50;
  if (lead.license_progress === "licensed") score += 30;
  if (lead.test_scheduled_date) score += 15;
  const lastContact = lead.last_contacted_at || lead.contacted_at;
  if (lastContact) {
    const hrs = (Date.now() - new Date(lastContact).getTime()) / (1000 * 60 * 60);
    if (hrs <= 48) score += 10;
    if (hrs > 72) score -= 15;
  }
  if (lead.notes && lead.notes.trim().length > 10) score += 5;
  if (lead.referral_source) score += 5;
  return Math.max(0, Math.min(100, score));
}

export function RecruiterAIPanel({ leads }: { leads: Lead[] }) {
  const [open, setOpen] = useState(true);
  const [aiBrief, setAiBrief] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const insights = useMemo(() => {
    const now = Date.now();
    const hotLeads = leads.filter((l) => computeScoreSimple(l) >= SCORE_THRESHOLDS.medium);
    const atRisk = leads.filter((l) => computeScoreSimple(l) < SCORE_THRESHOLDS.low);
    const overdue = leads.filter((l) => {
      const ts = l.last_contacted_at || l.contacted_at;
      if (!ts) return true;
      return (now - new Date(ts).getTime()) > 48 * 3600 * 1000;
    });
    const oneWeekAgo = now - 7 * 24 * 3600 * 1000;
    const newThisWeek = leads.filter((l) => new Date(l.created_at).getTime() > oneWeekAgo);
    const contacted = leads.filter((l) => l.last_contacted_at || l.contacted_at);
    const licensed = leads.filter((l) => l.license_progress === "licensed");
    const inProgress = leads.filter((l) => l.license_progress && l.license_progress !== "unlicensed" && l.license_progress !== "licensed");

    const pipelineBreakdown: Record<string, number> = {};
    for (const col of PROGRESS_COLUMNS) {
      pipelineBreakdown[col.label] = leads.filter((l) =>
        (col.values as readonly string[]).includes(l.license_progress || "unlicensed")
      ).length;
    }

    return {
      hotLeads,
      atRisk,
      overdue,
      newThisWeek,
      contacted,
      licensed,
      inProgress,
      contactRate: leads.length > 0 ? Math.round((contacted.length / leads.length) * 100) : 0,
      licenseRate: leads.length > 0 ? Math.round((licensed.length / leads.length) * 100) : 0,
      pipelineBreakdown,
    };
  }, [leads]);

  const fetchAIBrief = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("ai-assistant", {
        body: {
          type: "recruiter_insights",
          stats: {
            totalLeads: leads.length,
            needsContact: insights.overdue.length,
            inProgress: insights.inProgress.length,
            hotLeads: insights.hotLeads.length,
            atRisk: insights.atRisk.length,
            overdueFollowups: insights.overdue.length,
            newThisWeek: insights.newThisWeek.length,
            contactRate: insights.contactRate,
            licenseRate: insights.licenseRate,
            pipelineBreakdown: insights.pipelineBreakdown,
          },
        },
      });
      if (error) throw error;
      setAiBrief(data.content);
    } catch (err) {
      console.error("AI brief error:", err);
      toast.error("Failed to generate AI brief");
    } finally {
      setLoading(false);
    }
  };

  const statCards = [
    { icon: Flame, label: "Hot Leads", value: insights.hotLeads.length, color: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20" },
    { icon: AlertTriangle, label: "At-Risk", value: insights.atRisk.length, color: "text-rose-400 bg-rose-500/10 border-rose-500/20" },
    { icon: Clock, label: "Overdue", value: insights.overdue.length, color: "text-amber-400 bg-amber-500/10 border-amber-500/20" },
    { icon: TrendingUp, label: "In Progress", value: insights.inProgress.length, color: "text-purple-400 bg-purple-500/10 border-purple-500/20" },
  ];

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <GlassCard className="overflow-hidden">
        <CollapsibleTrigger asChild>
          <button className="flex items-center gap-2 w-full px-4 py-3 text-sm font-semibold hover:bg-accent/30 transition-colors">
            <Brain className="h-4 w-4 text-pink-400" />
            <span className="bg-gradient-to-r from-pink-400 to-purple-400 bg-clip-text text-transparent">
              AI Intelligence Panel
            </span>
            <Badge className="text-[9px] bg-pink-500/20 text-pink-400 border-pink-500/30 ml-1">
              {leads.length} leads
            </Badge>
            {open ? <ChevronUp className="h-3.5 w-3.5 ml-auto text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 ml-auto text-muted-foreground" />}
          </button>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="px-4 pb-4 space-y-3">
            {/* Quick stat cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {statCards.map((s) => (
                <div
                  key={s.label}
                  className={cn("flex items-center gap-2 rounded-xl border p-2.5", s.color)}
                >
                  <s.icon className="h-4 w-4 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-lg font-bold leading-tight">{s.value}</p>
                    <p className="text-[10px] text-muted-foreground">{s.label}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* AI Brief */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  onClick={fetchAIBrief}
                  disabled={loading}
                  className="text-xs h-7 gap-1.5 bg-gradient-to-r from-pink-500/20 to-purple-500/20 text-pink-300 hover:from-pink-500/30 hover:to-purple-500/30 border border-pink-500/30"
                >
                  {loading ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : aiBrief ? (
                    <RefreshCw className="h-3 w-3" />
                  ) : (
                    <Sparkles className="h-3 w-3" />
                  )}
                  {aiBrief ? "Refresh Brief" : "Get AI Daily Brief"}
                </Button>
              </div>

              <AnimatePresence>
                {aiBrief && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="rounded-xl border border-pink-500/20 bg-pink-500/5 p-3 text-sm text-foreground whitespace-pre-wrap leading-relaxed">
                      {aiBrief}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </CollapsibleContent>
      </GlassCard>
    </Collapsible>
  );
}

// ── Per-lead AI Summary popover content ──
export function LeadAISummary({ lead }: { lead: Lead }) {
  const [summary, setSummary] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchSummary = async () => {
    if (summary) return; // cached
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("ai-assistant", {
        body: {
          type: "summary",
          applicant: {
            fullName: `${lead.first_name} ${lead.last_name}`.trim(),
            email: lead.email,
            phone: lead.phone,
            city: lead.city || "",
            state: lead.state || "",
            instagramHandle: "",
            hasLicense: lead.license_status === "licensed",
            yearsExperience: "",
            currentOccupation: "",
            whyJoin: "",
            status: lead.license_progress || "unlicensed",
            createdAt: lead.created_at,
          },
        },
      });
      if (error) throw error;
      setSummary(data.content);
    } catch {
      toast.error("Failed to get AI summary");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-64 p-1">
      {!summary && !loading && (
        <Button
          size="sm"
          onClick={fetchSummary}
          className="w-full text-xs h-7 gap-1.5"
        >
          <Brain className="h-3 w-3" />
          Summarize Lead
        </Button>
      )}
      {loading && (
        <div className="flex items-center justify-center py-4 gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Analyzing...
        </div>
      )}
      {summary && (
        <div className="text-xs leading-relaxed text-foreground whitespace-pre-wrap">
          {summary}
        </div>
      )}
    </div>
  );
}
