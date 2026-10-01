import { supabase } from "@/integrations/supabase/client";
import { resolveBrand } from "@/config/brand";

/**
 * "No longer with us" — one flow, two surfaces (contracting call list and
 * Recruit Stages). Sets an agent inactive through mark_no_longer_with_us(),
 * which also records who did it and why, then emails the person that the door
 * is still open. mark_no_longer_with_us() checks email_unsubscribes because
 * send-email does not; anyone unsubscribed is removed but never emailed. A
 * failed send never undoes the roster change, and the caller gets a sentence
 * that says exactly what happened.
 */
const escapeHtml = (v: string) =>
  v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Short and direct, Sam's voice.
export function reengageEmail(name: string) {
  const first = escapeHtml((name || "").trim().split(/\s+/)[0] || "there");
  const org = escapeHtml(resolveBrand().legalName);
  return {
    subject: "The door's still open",
    html: `<p>Hey ${first},</p>
<p>It's Sam from ${org}. Looks like the timing didn't line up for you with us right now, and that's okay.</p>
<p>If you ever want another shot at building this, the door is open. Reply to this email or apply again at <a href="https://apex-financial.org/apply">apex-financial.org/apply</a> and I'll get you plugged back in.</p>
<p>Hold the standard,<br/>Sam James<br/>${org}</p>`,
  };
}

export type NoLongerWithUsResult = {
  ok: boolean;
  /** One sentence for the toast. */
  message: string;
  /** True when the roster change landed but the email did not. */
  emailFailed: boolean;
};

export async function markNoLongerWithUs(args: {
  agentId: string | null;
  checkinId?: string | null;
  displayName: string;
  reason?: string | null;
}): Promise<NoLongerWithUsResult> {
  const { data, error } = await supabase.rpc("mark_no_longer_with_us" as never, {
    p_checkin_id: args.agentId ? null : args.checkinId ?? null,
    p_agent_id: args.agentId,
    p_reason: args.reason ?? null,
  } as never);
  if (error) return { ok: false, message: `${args.displayName} was not removed: ${error.message}`, emailFailed: false };

  const res = (data ?? {}) as { checkin_id?: string; email?: string | null; unsubscribed?: boolean };
  let emailNote = "no email on file, so nothing was sent";
  let emailFailed = false;
  if (res.email && res.unsubscribed) {
    emailNote = `${res.email} unsubscribed from our emails, so nothing was sent`;
  } else if (res.email) {
    const mail = reengageEmail(args.displayName);
    const { error: mailErr } = await supabase.functions.invoke("send-email", {
      body: { to: res.email, subject: mail.subject, html: mail.html, reply_to: resolveBrand().supportEmail },
    });
    if (mailErr) {
      emailFailed = true;
      emailNote = `the email to ${res.email} failed (${mailErr.message})`;
    } else {
      emailNote = `re-engagement email sent to ${res.email}`;
      if (res.checkin_id) await supabase.rpc("mark_reengage_email_sent" as never, { p_checkin_id: res.checkin_id } as never);
    }
  }
  return {
    ok: true,
    emailFailed,
    message: emailFailed
      ? `${args.displayName} removed, but ${emailNote}.`
      : `${args.displayName} removed from your roster; ${emailNote}.`,
  };
}
