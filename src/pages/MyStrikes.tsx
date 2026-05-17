import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { PageHeader } from "@/components/ui/page-header";
import { GlassCard } from "@/components/ui/glass-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Shield, CheckCircle2, AlertTriangle, Flame, ShieldAlert, Skull,
  Mail, ExternalLink,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";

const SEVERITY: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  warning:  { label: "Warning",  color: "bg-amber-500/15 text-amber-400 border-amber-500/40",   icon: AlertTriangle },
  minor:    { label: "Minor",    color: "bg-orange-500/15 text-orange-400 border-orange-500/40", icon: ShieldAlert },
  major:    { label: "Major",    color: "bg-rose-500/15 text-rose-400 border-rose-500/40",      icon: Flame },
  terminal: { label: "Terminal", color: "bg-red-600/20 text-red-300 border-red-600/50",         icon: Skull },
};

const REASON_LABEL: Record<string, string> = {
  no_show: "No-show",
  ghosted_lead: "Ghosted lead",
  customer_complaint: "Customer complaint",
  false_charge: "False charge",
  dnq_application: "DNQ application",
  no_followup: "No follow-up",
  billing_dispute: "Billing dispute",
  compliance: "Compliance",
  misrepresentation: "Misrepresentation",
  other: "Other",
};

export default function MyStrikes() {
  const { user } = useAuth();

  // Look up the agent_id for the current user, then pull strikes via RLS-filtered view.
  const { data: agentRow } = useQuery({
    queryKey: ["my-agent-row", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("agents")
        .select("id, display_name, agent_code")
        .eq("user_id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const { data: strikes = [], isLoading } = useQuery({
    queryKey: ["my-strikes", agentRow?.id],
    enabled: !!agentRow?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_agent_strikes" as any)
        .select("*")
        .eq("agent_id", agentRow!.id)
        .order("issued_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const summary = useMemo(() => {
    const active = strikes.filter((s: any) => s.status === "active");
    const major = active.filter((s: any) => s.severity === "major" || s.severity === "terminal");
    let standing: "clear" | "flagged" | "on_notice" | "review_required" | "terminal" = "clear";
    if (active.some((s: any) => s.severity === "terminal")) standing = "terminal";
    else if (major.length >= 3) standing = "review_required";
    else if (major.length > 0) standing = "on_notice";
    else if (active.length > 0) standing = "flagged";
    return { activeCount: active.length, majorCount: major.length, standing };
  }, [strikes]);

  return (
    <div className="page-enter px-4 sm:px-6 pb-24">
      <PageHeader
        eyebrow="Conduct"
        eyebrowIcon={<Shield className="h-3 w-3" />}
        title="My Strikes"
        subtitle="Your conduct record. Strikes track missed commitments, complaints, or quality issues. Resolve them by completing the listed action and replying to your manager."
        accent={summary.standing === "clear" ? "emerald" : summary.standing === "flagged" ? "amber" : "rose"}
      />

      {/* Standing card */}
      <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
        <GlassCard
          variant="default"
          className={`p-5 mb-5 border-2 ${
            summary.standing === "clear" ? "border-emerald-500/40" :
            summary.standing === "flagged" ? "border-amber-500/40" :
            "border-rose-500/40"
          }`}
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-widest text-muted-foreground font-semibold">Current standing</p>
              <p className={`text-3xl font-bold mt-1 ${
                summary.standing === "clear" ? "text-emerald-400" :
                summary.standing === "flagged" ? "text-amber-400" :
                "text-rose-400"
              }`}>
                {summary.standing === "clear" ? "Clear" :
                 summary.standing === "flagged" ? "Flagged" :
                 summary.standing === "on_notice" ? "On Notice" :
                 summary.standing === "review_required" ? "Review Required" :
                 "Terminal"}
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                {summary.activeCount} active · {summary.majorCount} major
              </p>
            </div>
            {summary.standing === "clear" ? (
              <CheckCircle2 className="h-12 w-12 text-emerald-400 opacity-70" />
            ) : (
              <Flame className="h-12 w-12 text-rose-400 opacity-70" />
            )}
          </div>
          {summary.standing !== "clear" && (
            <div className="mt-4 pt-4 border-t border-border/40 flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                Need to dispute a strike or ask for clarification?
              </p>
              <Button variant="outline" size="sm" asChild>
                <a href="mailto:sam.com593@gmail.com?subject=Strike%20dispute&body=Strike%20ID%3A%20">
                  <Mail className="h-4 w-4 mr-1.5" /> Contact Sam
                </a>
              </Button>
            </div>
          )}
        </GlassCard>
      </motion.div>

      {/* Strike list */}
      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="h-24 rounded-xl skeleton-shimmer" />
          ))}
        </div>
      ) : strikes.length === 0 ? (
        <GlassCard variant="subtle" className="p-12 text-center">
          <CheckCircle2 className="h-16 w-16 text-emerald-500 mx-auto mb-4 opacity-80" />
          <p className="text-xl font-bold">No strikes on record</p>
          <p className="text-sm text-muted-foreground mt-2 max-w-md mx-auto">
            Keep showing up, hitting your numbers, and treating your clients right. That's how you stay clear.
          </p>
        </GlassCard>
      ) : (
        <div className="space-y-3">
          {strikes.map((s: any, i: number) => {
            const sev = SEVERITY[s.severity];
            const SevIcon = sev.icon;
            return (
              <motion.div
                key={s.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.04 }}
              >
                <GlassCard variant="subtle" className={`p-4 ${s.status === "active" ? "" : "opacity-60"}`}>
                  <div className="flex flex-col gap-3 md:flex-row md:items-start">
                    <span className={`h-10 w-10 rounded-lg flex items-center justify-center border ${sev.color} shrink-0`}>
                      <SevIcon className="h-5 w-5" />
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <Badge variant="outline" className={sev.color}>{sev.label}</Badge>
                        <Badge variant="outline" className="text-xs">{REASON_LABEL[s.reason_code] ?? s.reason_code}</Badge>
                        {s.status !== "active" && (
                          <Badge variant="outline" className="text-xs">{s.status}</Badge>
                        )}
                        <span className="text-xs text-muted-foreground ml-auto">
                          {formatDistanceToNow(new Date(s.issued_at))} ago
                        </span>
                      </div>
                      <p className="text-sm leading-relaxed">{s.description}</p>
                      {s.resolution_note && (
                        <p className="text-xs text-muted-foreground mt-2 border-l-2 border-emerald-500/40 pl-2 italic">
                          Resolved: {s.resolution_note}
                        </p>
                      )}
                      <p className="text-[11px] text-muted-foreground mt-2">
                        Issued {format(new Date(s.issued_at), "PPp")}
                        {s.issued_by_name && <> by {s.issued_by_name}</>}
                      </p>
                    </div>
                  </div>
                </GlassCard>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}
