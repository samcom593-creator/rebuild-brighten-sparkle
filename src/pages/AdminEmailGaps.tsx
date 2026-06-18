import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, CheckCircle2, Clock, Mail, Send, Loader2, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { supabase } from "@/integrations/supabase/client";
import { useAgentProfileDrawer } from "@/stores/agentProfileDrawer";
import { toast } from "sonner";
import { usePageTitle } from "@/hooks/usePageTitle";

/**
 * /admin/email-gaps — Surface every licensed agent whose course email
 * never went out. Sam directive 2026-06-17: "no gaps in the process."
 *
 * Each row has a Resend button — Sam can tap once to re-queue and fire.
 * Avatar / name → AgentProfileDrawer (existing flow).
 */

interface GapRow {
  agent_id: string;
  display_name: string | null;
  agent_code: string | null;
  license_status: string | null;
  email: string | null;
  course_sent_at: string | null;
  course_last_error: string | null;
  discord_sent_at: string | null;
  course_state: string;
}

const STATE_META: Record<string, { label: string; icon: any; pill: string }> = {
  sent:        { label: "Sent",     icon: CheckCircle2, pill: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20" },
  queued:      { label: "Queued",   icon: Clock,        pill: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20" },
  gap:         { label: "GAP",      icon: AlertCircle,  pill: "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20" },
  no_email:    { label: "No email", icon: AlertCircle,  pill: "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20" },
  not_licensed:{ label: "Not licensed", icon: Mail,     pill: "bg-slate-500/10 text-slate-500 border-slate-500/20" },
};

function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  } catch { return "—"; }
}

export default function AdminEmailGaps() {
  usePageTitle("Email Gaps · Apex Admin");
  const qc = useQueryClient();
  const openAgent = useAgentProfileDrawer((s) => s.openAgent);
  const [filter, setFilter] = useState<"gap" | "all" | "sent" | "queued">("gap");
  const [firingId, setFiringId] = useState<string | null>(null);

  const { data: rows, isLoading } = useQuery<GapRow[]>({
    queryKey: ["admin-email-gaps", filter],
    queryFn: async () => {
      const q = (supabase as any).from("v_agents_onboarding_status").select("*").eq("license_status", "licensed");
      if (filter !== "all") q.eq("course_state", filter);
      const { data, error } = await q.limit(500);
      if (error) {
        toast.error(`Load failed: ${error.message.slice(0, 80)}`);
        return [];
      }
      return (data as GapRow[]) ?? [];
    },
    staleTime: 15_000,
  });

  const stats = (rows ?? []).reduce<Record<string, number>>((acc, r) => {
    acc[r.course_state] = (acc[r.course_state] ?? 0) + 1;
    return acc;
  }, {});

  async function resend(agentId: string) {
    setFiringId(agentId);
    try {
      const { error: insErr } = await supabase
        .from("agent_onboarding_queue" as any)
        .upsert(
          [
            { agent_id: agentId, email_kind: "course",  target_send_at: new Date().toISOString(), sent_at: null, attempt_count: 0, last_error: null },
            { agent_id: agentId, email_kind: "discord", target_send_at: new Date().toISOString(), sent_at: null, attempt_count: 0, last_error: null },
          ],
          { onConflict: "agent_id,email_kind" },
        );
      if (insErr) throw insErr;
      const { error: fnErr } = await supabase.functions.invoke("send-agent-onboarding-email", { body: {} });
      if (fnErr) throw fnErr;
      toast.success("Sent");
      await qc.invalidateQueries({ queryKey: ["admin-email-gaps"] });
    } catch (e: any) {
      toast.error(`Send failed: ${e?.message?.slice(0, 100) ?? "unknown"}`);
    } finally {
      setFiringId(null);
    }
  }

  async function resendAllGaps() {
    if (!rows?.length) return;
    const gaps = rows.filter((r) => r.course_state === "gap");
    if (!gaps.length) {
      toast.info("No gaps to send");
      return;
    }
    const ok = window.confirm(`Re-queue + send course + Discord to ${gaps.length} agents?`);
    if (!ok) return;
    setFiringId("__all__");
    try {
      const upserts = gaps.flatMap((r) => [
        { agent_id: r.agent_id, email_kind: "course",  target_send_at: new Date().toISOString(), sent_at: null, attempt_count: 0, last_error: null },
        { agent_id: r.agent_id, email_kind: "discord", target_send_at: new Date().toISOString(), sent_at: null, attempt_count: 0, last_error: null },
      ]);
      const { error: insErr } = await supabase
        .from("agent_onboarding_queue" as any)
        .upsert(upserts, { onConflict: "agent_id,email_kind" });
      if (insErr) throw insErr;
      const { error: fnErr } = await supabase.functions.invoke("send-agent-onboarding-email", { body: {} });
      if (fnErr) throw fnErr;
      toast.success(`Fired ${gaps.length * 2} emails`);
      await qc.invalidateQueries({ queryKey: ["admin-email-gaps"] });
    } catch (e: any) {
      toast.error(`Bulk send failed: ${e?.message?.slice(0, 100) ?? "unknown"}`);
    } finally {
      setFiringId(null);
    }
  }

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-5xl mx-auto">
      <PageHeader
        title="Email Gaps"
        subtitle="Licensed agents whose course email never went out. Tap to resend, or bulk-send all gaps."
        accent="rose"
      />

      {/* Stat strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {(["sent", "queued", "gap", "no_email"] as const).map((s) => {
          const m = STATE_META[s];
          const Icon = m.icon;
          const n = stats[s] ?? 0;
          return (
            <button
              key={s}
              onClick={() => setFilter(s === "no_email" ? "all" : s)}
              className={`rounded-3xl border bg-card/40 px-4 py-3 text-left hover:bg-card/70 transition-colors ${filter === s ? "ring-2 ring-amber-500/40" : ""}`}
            >
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <Icon className="h-3.5 w-3.5" />
                <span className="text-[10px] uppercase tracking-wider font-semibold">{m.label}</span>
              </div>
              <p className="mt-1 text-2xl font-black tabular-nums">{n}</p>
            </button>
          );
        })}
      </div>

      {/* Bulk action */}
      {filter === "gap" && (stats.gap ?? 0) > 0 && (
        <div className="rounded-3xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
          <p className="text-sm">
            {stats.gap} licensed agent{stats.gap === 1 ? "" : "s"} never got the course email.
          </p>
          <Button
            size="sm"
            className="gap-1.5"
            disabled={firingId === "__all__"}
            onClick={resendAllGaps}
          >
            {firingId === "__all__" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            Send all gaps now
          </Button>
        </div>
      )}

      {/* List */}
      {isLoading ? (
        <Card><CardContent className="p-8 text-center text-muted-foreground">Loading…</CardContent></Card>
      ) : !rows?.length ? (
        <Card><CardContent className="p-8 text-center text-muted-foreground">No agents in this state.</CardContent></Card>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => {
            const m = STATE_META[r.course_state] ?? STATE_META.gap;
            const Icon = m.icon;
            return (
              <Card key={r.agent_id} className="hover:bg-muted/20 transition-colors">
                <CardContent className="p-3 sm:p-4 flex items-center justify-between gap-3 flex-wrap">
                  <button
                    onClick={() => openAgent(r.agent_id)}
                    className="flex-1 min-w-0 text-left"
                  >
                    <p className="text-sm font-bold leading-tight truncate">
                      {r.display_name?.trim() || "—"} {r.agent_code && <span className="text-muted-foreground">· {r.agent_code}</span>}
                    </p>
                    <p className="text-xs text-muted-foreground truncate flex items-center gap-1.5 mt-0.5">
                      <Mail className="h-3 w-3" /> {r.email || "(no email)"}
                    </p>
                    {r.course_sent_at && (
                      <p className="text-[10px] text-emerald-600 dark:text-emerald-400 mt-0.5">
                        Sent · {fmtTime(r.course_sent_at)}
                      </p>
                    )}
                    {r.course_last_error && (
                      <p className="text-[10px] text-rose-500 mt-0.5 truncate">last error: {r.course_last_error}</p>
                    )}
                  </button>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge variant="outline" className={`gap-1 text-[10px] ${m.pill}`}>
                      <Icon className="h-3 w-3" /> {m.label}
                    </Badge>
                    {(r.course_state === "gap" || r.course_state === "sent" || r.course_state === "queued") && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 gap-1 text-[11px]"
                        disabled={firingId === r.agent_id || firingId === "__all__"}
                        onClick={() => resend(r.agent_id)}
                      >
                        {firingId === r.agent_id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                        {r.course_state === "sent" ? "Resend" : "Send"}
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
