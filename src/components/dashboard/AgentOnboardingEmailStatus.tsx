import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, AlertCircle, Clock, Mail, Send, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

/**
 * AgentOnboardingEmailStatus — inline pill + Resend-now button on the
 * AgentProfileDrawer so Sam can see at a glance whether THIS agent got
 * their course + Discord emails, and re-fire if not.
 *
 * Sam directive 2026-06-17 (verbatim): "people who are saying they're not
 * getting emails after I... like, for example, I have someone who just says
 * he didn't get the email after he just signed up and logged up with me.
 * I need this shit all fixed and everything tightened out and no gaps."
 *
 * Backed by v_agents_onboarding_status — column `course_state` is one of:
 *   sent · queued · gap · no_email · not_licensed
 */

interface OnboardingStatusRow {
  agent_id: string;
  display_name: string | null;
  license_status: string | null;
  email: string | null;
  course_sent_at: string | null;
  course_last_error: string | null;
  discord_sent_at: string | null;
  course_state: "sent" | "queued" | "gap" | "no_email" | "not_licensed" | string;
}

interface Props {
  agentId: string;
}

function fmtTime(iso: string | null): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

export function AgentOnboardingEmailStatus({ agentId }: Props) {
  const qc = useQueryClient();
  const [firing, setFiring] = useState(false);

  const { data, isLoading } = useQuery<OnboardingStatusRow | null>({
    queryKey: ["agent-onboarding-email-status", agentId],
    enabled: !!agentId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_agents_onboarding_status" as any)
        .select(
          "agent_id, display_name, license_status, email, course_sent_at, course_last_error, discord_sent_at, course_state",
        )
        .eq("agent_id", agentId)
        .maybeSingle();
      if (error) {
        return null;
      }
      return data as any;
    },
    staleTime: 15_000,
  });

  async function resendCourse() {
    if (!data) return;
    if (data.course_state === "not_licensed") {
      toast.error("Agent isn't licensed — course email skipped per Apex rule");
      return;
    }
    if (data.course_state === "no_email") {
      toast.error("No email on profile — fix the contact first");
      return;
    }
    setFiring(true);
    try {
      // Enqueue (re)send for THIS agent only, course + discord.
      const { error: insErr } = await supabase
        .from("agent_onboarding_queue" as any)
        .upsert(
          [
            { agent_id: agentId, email_kind: "course", target_send_at: new Date().toISOString(), sent_at: null, attempt_count: 0, last_error: null },
            { agent_id: agentId, email_kind: "discord", target_send_at: new Date().toISOString(), sent_at: null, attempt_count: 0, last_error: null },
          ],
          { onConflict: "agent_id,email_kind" },
        );
      if (insErr) throw insErr;
      // Fire the drain edge fn synchronously so Sam sees the result NOW.
      const { error: fnErr } = await supabase.functions.invoke("send-agent-onboarding-email", { body: {} });
      if (fnErr) throw fnErr;
      toast.success("Course + Discord emails sent");
      await qc.invalidateQueries({ queryKey: ["agent-onboarding-email-status", agentId] });
    } catch (e: any) {
      toast.error(`Send failed: ${e?.message?.slice(0, 100) ?? "unknown"}`);
    } finally {
      setFiring(false);
    }
  }

  if (isLoading || !data) {
    return null;
  }

  const state = data.course_state;
  const courseSentLabel = data.course_sent_at ? fmtTime(data.course_sent_at) : "";

  let icon = <Mail className="h-3.5 w-3.5" />;
  let pillClass = "bg-muted/50 text-muted-foreground border-border";
  let label = "Onboarding email";

  if (state === "sent") {
    icon = <CheckCircle2 className="h-3.5 w-3.5" />;
    pillClass = "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20";
    label = `Course sent · ${courseSentLabel}`;
  } else if (state === "queued") {
    icon = <Clock className="h-3.5 w-3.5" />;
    pillClass = "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20";
    label = "Course queued · next drain ≤ 1h";
  } else if (state === "gap") {
    icon = <AlertCircle className="h-3.5 w-3.5" />;
    pillClass = "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20";
    label = "Course NOT sent · gap";
  } else if (state === "no_email") {
    icon = <AlertCircle className="h-3.5 w-3.5" />;
    pillClass = "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20";
    label = "No email on profile";
  } else if (state === "not_licensed") {
    icon = <Mail className="h-3.5 w-3.5" />;
    pillClass = "bg-slate-500/10 text-slate-500 border-slate-500/20";
    label = "Not licensed · no course email";
  }

  const canResend = state === "sent" || state === "queued" || state === "gap";

  return (
    <div className="rounded-3xl border border-border bg-card/40 px-4 py-3 space-y-2">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <Badge variant="outline" className={`gap-1.5 text-[11px] ${pillClass}`}>
          {icon}
          {label}
        </Badge>
        {canResend && (
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1.5 text-[11px]"
            disabled={firing}
            onClick={resendCourse}
            title="Re-queue + send course + Discord emails for this agent now"
          >
            {firing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
            {state === "sent" ? "Resend" : "Send now"}
          </Button>
        )}
      </div>
      {data.discord_sent_at && state === "sent" && (
        <p className="text-[10px] text-muted-foreground">
          Discord invite sent · {fmtTime(data.discord_sent_at)}
        </p>
      )}
      {data.course_last_error && state === "gap" && (
        <p className="text-[10px] text-rose-500 truncate">last error: {data.course_last_error}</p>
      )}
    </div>
  );
}

export default AgentOnboardingEmailStatus;
