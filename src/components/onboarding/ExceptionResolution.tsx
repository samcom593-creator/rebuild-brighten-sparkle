import { useState } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/hooks/useConfirm";
import { openAgentProfile } from "@/stores/agentProfileDrawer";
import type { OnboardingException, OnboardingFacts } from "@/lib/onboardingExceptions";
import { ExpectedStartControl } from "./ExpectedStartControl";
import { ONBOARDING_FACTS_KEY } from "./useOnboardingExceptionFacts";

export interface ResolutionPermissions {
  /** send-agent-portal-login admits admin + manager only (VA gets 403). */
  canSendLogin: boolean;
  /** /dashboard/contracting is admin-only. */
  canOpenContracting: boolean;
}

/** What request_onboarding_call_booking's verdict means, in operator words.
 *  'queued' is not 'sent': the existing dispatcher sends it. */
export function bookingVerdictText(reason: string | undefined): { ok: boolean; text: string } {
  switch (reason) {
    case "queued": return { ok: true, text: "Booking email queued. The onboarding dispatcher sends it; it is not sent yet." };
    case "already_queued": return { ok: true, text: "A booking email is already queued for them." };
    case "already_sent": return { ok: true, text: "The booking email was already sent. Follow up by phone." };
    case "booking_exists": return { ok: true, text: "They already have an onboarding call booked." };
    case "not_licensed": return { ok: false, text: "Not sent: the booking link goes to licensed hires only." };
    case "agent_not_active": return { ok: false, text: "Not sent: they are not an active agent." };
    default: return { ok: false, text: `Not sent (${reason ?? "no answer from the server"}).` };
  }
}

async function edgeErrorText(error: unknown): Promise<string> {
  const ctx = (error as { context?: unknown })?.context;
  if (ctx instanceof Response) {
    try {
      const body = (await ctx.clone().json()) as { message?: string; error?: string };
      return body.message ?? body.error ?? `HTTP ${ctx.status}`;
    } catch (parseErr) {
      return `HTTP ${ctx.status} (${parseErr instanceof Error ? "unreadable body" : "error"})`;
    }
  }
  return error instanceof Error ? error.message : "request failed";
}

/** The one direct action that resolves an exception, wired to the existing
 *  RPC / edge function / surface for that requirement. */
export function ExceptionResolution({
  facts,
  exception,
  perms,
}: {
  facts: OnboardingFacts;
  exception: OnboardingException;
  perms: ResolutionPermissions;
}) {
  const qc = useQueryClient();
  const askConfirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const name = facts.agent_name?.trim() || "this hire";
  const refresh = () => qc.invalidateQueries({ queryKey: ONBOARDING_FACTS_KEY });
  const r = exception.resolution;

  const profileButton = (label = "Open record") => (
    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => openAgentProfile(facts.agent_id)}>
      {label}
    </Button>
  );

  if (r.kind === "set_start" || r.kind === "start_outcome") {
    return <ExpectedStartControl facts={facts} compact />;
  }

  if (r.kind === "open_profile") return profileButton();

  if (r.kind === "open_contracting") {
    return perms.canOpenContracting ? (
      <Button asChild size="sm" variant="outline" className="h-7 text-xs"><Link to="/dashboard/contracting">Open contracting</Link></Button>
    ) : profileButton();
  }

  if (r.kind === "open_recruit_stages") {
    return (
      <Button asChild size="sm" variant="outline" className="h-7 text-xs">
        <Link to={`/dashboard/recruits?q=${encodeURIComponent(facts.agent_name ?? "")}`}>Update license</Link>
      </Button>
    );
  }

  if (r.kind === "open_training") {
    return <Button asChild size="sm" variant="outline" className="h-7 text-xs"><Link to="/dashboard/training/progress">Open course progress</Link></Button>;
  }

  if (r.kind === "send_login") {
    if (!perms.canSendLogin) return profileButton();
    const send = async () => {
      const ok = await askConfirm({
        title: `Email a portal login link to ${name}?`,
        description: "This sends a real email through the portal-login function. A sent link is not a sign-in; the row clears only when they actually sign in.",
        confirmText: "Send login link",
      });
      if (!ok) return;
      setBusy(true);
      const { data, error } = await supabase.functions.invoke("send-agent-portal-login", { body: { agentId: facts.agent_id } });
      setBusy(false);
      if (error) { toast.error(`${name}: ${await edgeErrorText(error)}`); return; }
      const res = (data ?? {}) as { success?: boolean; message?: string; error?: string };
      if (res.success !== true) { toast.error(`${name}: ${res.message ?? res.error ?? "the login link was not sent"}`); return; }
      toast.success(`${name}: login link accepted by the email provider. Delivery is not confirmed until they sign in.`);
      await refresh();
    };
    return (
      <Button size="sm" className="h-7 text-xs" disabled={busy} onClick={() => void send()}>
        {busy ? "Sending…" : "Send login link"}
      </Button>
    );
  }

  if (r.kind === "request_booking") {
    const request = async () => {
      setBusy(true);
      const { data, error } = await supabase.rpc("request_onboarding_call_booking" as never, { p_agent_id: facts.agent_id } as never);
      setBusy(false);
      if (error) { toast.error(`${name}: ${error.message}`); return; }
      const verdict = bookingVerdictText((data as { reason?: string } | null)?.reason);
      (verdict.ok ? toast.success : toast.error)(`${name}: ${verdict.text}`);
      await refresh();
    };
    return (
      <Button size="sm" variant="outline" className="h-7 text-xs" disabled={busy} onClick={() => void request()}>
        {busy ? "Queuing…" : "Send booking link"}
      </Button>
    );
  }

  if (r.kind === "call_outcome") {
    const record = async (outcome: "attended" | "no_show" | "rescheduled") => {
      setBusy(true);
      const { error } = await supabase.rpc("record_onboarding_call_outcome" as never, {
        p_event_id: r.eventId, p_outcome: outcome, p_note: null,
      } as never);
      setBusy(false);
      if (error) { toast.error(`${name}: ${error.message}`); return; }
      toast.success(`${name}: onboarding call marked ${outcome === "no_show" ? "no-show" : outcome}. Employment status unchanged.`);
      await refresh();
    };
    return (
      <div className="flex flex-wrap gap-1">
        <Button size="sm" variant="outline" className="h-7 text-xs" disabled={busy} onClick={() => void record("attended")}>Attended</Button>
        <Button size="sm" variant="outline" className="h-7 text-xs" disabled={busy} onClick={() => void record("no_show")}>No-show</Button>
        <Button size="sm" variant="outline" className="h-7 text-xs" disabled={busy} onClick={() => void record("rescheduled")}>Rescheduled</Button>
      </div>
    );
  }

  return profileButton();
}
