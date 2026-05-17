import { useEffect, useMemo, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import confetti from "canvas-confetti";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useRealtimeTable } from "@/shared/realtime/useRealtimeTable";
import { PageHeader } from "@/components/ui/page-header";
import { GlassCard } from "@/components/ui/glass-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Shield, CheckCircle2, AlertTriangle, Flame, ShieldAlert, Skull,
  Mail, BadgeCheck, Link as LinkIcon,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { toast } from "sonner";

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
  const qc = useQueryClient();
  const previousStanding = useRef<string | null>(null);

  // Look up the agent_id for the current user
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
      return (data ?? []) as any[];
    },
  });

  useRealtimeTable(
    { table: "agent_strikes", channelSuffix: "self", filter: agentRow?.id ? `agent_id=eq.${agentRow.id}` : undefined, enabled: !!agentRow?.id },
    () => {
      qc.invalidateQueries({ queryKey: ["my-strikes", agentRow?.id] });
    }
  );

  const summary = useMemo(() => {
    const active = strikes.filter((s) => s.status === "active");
    const major = active.filter((s) => s.severity === "major" || s.severity === "terminal");
    let standing: "clear" | "flagged" | "on_notice" | "review_required" | "terminal" = "clear";
    if (active.some((s) => s.severity === "terminal")) standing = "terminal";
    else if (major.length >= 3) standing = "review_required";
    else if (major.length > 0) standing = "on_notice";
    else if (active.length > 0) standing = "flagged";
    return { activeCount: active.length, majorCount: major.length, standing };
  }, [strikes]);

  // Confetti when standing transitions to clear
  useEffect(() => {
    if (
      previousStanding.current &&
      previousStanding.current !== "clear" &&
      summary.standing === "clear"
    ) {
      const t = setTimeout(() => {
        confetti({
          particleCount: 120,
          spread: 90,
          origin: { y: 0.45 },
          colors: ["#22d3a5", "#a78bfa", "#f59e0b", "#fbbf24"],
        });
      }, 200);
      toast.success("Board cleared 🎉", { description: "You're back to clear standing." });
      return () => clearTimeout(t);
    }
    previousStanding.current = summary.standing;
  }, [summary.standing]);

  async function acknowledge(strikeId: string) {
    const { error } = await supabase.rpc("acknowledge_strike" as any, { p_strike_id: strikeId });
    if (error) { toast.error(`Ack failed: ${error.message}`); return; }
    toast.success("Acknowledged — your manager can see you've read it");
    qc.invalidateQueries({ queryKey: ["my-strikes", agentRow?.id] });
  }

  return (
    <div className="page-enter px-4 sm:px-6 pb-24">
      <PageHeader
        eyebrow="Conduct"
        eyebrowIcon={<Shield className="h-3 w-3" />}
        title="My Strikes"
        subtitle="Your conduct record. Strikes track missed commitments, complaints, or quality issues. Tap Acknowledge so your manager knows you've read it."
        accent={summary.standing === "clear" ? "emerald" : summary.standing === "flagged" ? "amber" : "rose"}
      />

      {/* Standing hero */}
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
              <p className={`text-4xl font-bold mt-1 ${
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
                {summary.activeCount} active · {summary.majorCount} major+
              </p>
            </div>
            {summary.standing === "clear" ? (
              <motion.div animate={{ rotate: [0, -5, 5, 0] }} transition={{ duration: 2, repeat: Infinity, repeatDelay: 4 }}>
                <CheckCircle2 className="h-14 w-14 text-emerald-400 opacity-80" />
              </motion.div>
            ) : (
              <Flame className="h-14 w-14 text-rose-400 opacity-80 streak-flame" />
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
        <EmptyState
          icon={<CheckCircle2 className="h-7 w-7" />}
          title="No strikes on record"
          description="Keep showing up, hitting your numbers, and treating your clients right. That's how you stay clear."
          variant="success"
        />
      ) : (
        <div className="space-y-3">
          {strikes.map((s: any, i: number) => {
            const sev = SEVERITY[s.severity];
            const SevIcon = sev.icon;
            const ackAt = s.metadata?.acknowledged_at;
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
                        {ackAt && (
                          <Badge variant="outline" className="text-xs bg-emerald-500/10 text-emerald-400 border-emerald-500/40">
                            <BadgeCheck className="h-3 w-3 mr-1" /> Acknowledged
                          </Badge>
                        )}
                        <span className="text-xs text-muted-foreground ml-auto">
                          {formatDistanceToNow(new Date(s.issued_at))} ago
                        </span>
                      </div>
                      <p className="text-sm leading-relaxed">{s.description}</p>
                      {s.evidence_urls && s.evidence_urls.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {s.evidence_urls.map((url: string, idx: number) => (
                            <a
                              key={idx}
                              href={url}
                              target="_blank"
                              rel="noreferrer"
                              className="text-[11px] text-primary hover:underline truncate max-w-[260px] inline-flex items-center gap-1"
                            >
                              <LinkIcon className="h-3 w-3" /> {(() => { try { return new URL(url).hostname; } catch { return "link"; } })()}
                            </a>
                          ))}
                        </div>
                      )}
                      {s.resolution_note && (
                        <p className="text-xs text-muted-foreground mt-2 border-l-2 border-emerald-500/40 pl-2 italic">
                          Resolved: {s.resolution_note}
                        </p>
                      )}
                      <p className="text-[11px] text-muted-foreground mt-2">
                        Issued {format(new Date(s.issued_at), "PPp")}
                        {s.issued_by_name && <> by {s.issued_by_name}</>}
                      </p>
                      {s.status === "active" && !ackAt && (
                        <div className="mt-3">
                          <Button size="sm" variant="outline" onClick={() => acknowledge(s.id)}>
                            <BadgeCheck className="h-4 w-4 mr-1.5" /> Acknowledge
                          </Button>
                        </div>
                      )}
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
