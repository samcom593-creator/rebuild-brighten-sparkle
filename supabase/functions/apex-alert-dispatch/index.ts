// APEX alert dispatcher.
//
// Two modes:
//   1. No body / {mode:"flush"} → drain bot_alerts.sent_at IS NULL and send
//      each via Resend (email) + send-sms-auto-detect (SMS). Called by the
//      30-min cron and at the end of apex-audit-engine's cron.
//   2. {event_type, severity, subject, body, sms_body?, action_link?} →
//      ad-hoc alert from a DB trigger or another edge function. We insert
//      it into bot_alerts and dispatch immediately.
//
// Owner targets: hard-coded to Sam (sam@apex-financial.org + 4697676068).
// When/if we grow to multi-admin, look these up from user_roles + profiles.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { Resend } from "https://esm.sh/resend@2.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// deploy trigger: b985c2e

const SAM_EMAIL = "info@kingofsales.net";
const SAM_PHONE = "4697676068";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

const resend = new Resend(Deno.env.get("RESEND_API_KEY") ?? "");

function emailShell(subject: string, bodyHtml: string, severity: string) {
  const tone = {
    critical: { bg: "#fee2e2", border: "#dc2626", label: "🚨 CRITICAL" },
    warn: { bg: "#fef3c7", border: "#d97706", label: "⚠️  WARN" },
    info: { bg: "#e0f2fe", border: "#0284c7", label: "ℹ️  INFO" },
    celebrate: { bg: "#dcfce7", border: "#16a34a", label: "🎉 WIN" },
  }[severity] ?? { bg: "#f3f4f6", border: "#64748b", label: severity };
  return `
<div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;max-width:640px;margin:0 auto;padding:24px;color:#0f172a">
  <div style="background:${tone.bg};border-left:4px solid ${tone.border};padding:16px;border-radius:6px;margin-bottom:16px">
    <div style="font-weight:bold;font-size:13px;color:${tone.border};margin-bottom:4px">${tone.label}</div>
    <h2 style="margin:0;color:#0f172a">${subject}</h2>
  </div>
  ${bodyHtml}
  <p style="color:#64748b;font-size:12px;margin-top:32px">APEX Autonomous Engine · ${new Date().toISOString()}</p>
</div>`;
}

async function send(alert: any): Promise<{ sent_email_id: string | null; sent_sms_id: string | null; error: string | null }> {
  const channels: string[] = alert.channels ?? ["email", "sms"];
  let email_id: string | null = null;
  let sms_id: string | null = null;
  const errs: string[] = [];

  if (channels.includes("email")) {
    try {
      const html = emailShell(alert.subject, alert.body, alert.severity);
      const r = await resend.emails.send({
        from: "APEX Engine <sam@apex-financial.org>",
        to: SAM_EMAIL,
        subject: alert.subject,
        html,
      });
      email_id = (r as any)?.data?.id ?? null;
    } catch (e: any) {
      errs.push(`email: ${e?.message ?? String(e)}`);
    }
  }
  if (channels.includes("sms") && alert.sms_body) {
    try {
      const resp = await supabase.functions.invoke("send-sms-auto-detect", {
        body: { phone: SAM_PHONE, message: alert.sms_body.slice(0, 160) },
      });
      sms_id = (resp as any)?.data?.phone ?? "sent";
    } catch (e: any) {
      errs.push(`sms: ${e?.message ?? String(e)}`);
    }
  }
  return { sent_email_id: email_id, sent_sms_id: sms_id, error: errs.length ? errs.join("; ") : null };
}

async function flush(): Promise<{ processed: number; sent: number; failed: number }> {
  const { data: queue } = await supabase
    .from("bot_alerts")
    .select("*")
    .is("sent_at", null)
    .order("created_at", { ascending: true })
    .limit(50);

  let sent = 0, failed = 0;
  for (const alert of queue ?? []) {
    const r = await send(alert);
    const anySent = r.sent_email_id || r.sent_sms_id;
    if (anySent) {
      await supabase.from("bot_alerts").update({
        sent_at: new Date().toISOString(),
        sent_email_id: r.sent_email_id,
        sent_sms_id: r.sent_sms_id,
      }).eq("id", (alert as any).id);
      sent++;
    } else {
      failed++;
    }
  }
  return { processed: queue?.length ?? 0, sent, failed };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  let body: any = {};
  try { body = await req.json(); } catch { /* empty */ }

  // Mode 2: ad-hoc alert insert + dispatch
  if (body.event_type) {
    const alert = {
      source: body.source ?? "manual",
      event_type: body.event_type,
      severity: body.severity ?? "warn",
      subject: body.subject ?? body.event_type,
      body: body.body ?? "",
      sms_body: body.sms_body ?? body.subject ?? body.event_type,
      action_link: body.action_link ?? null,
      channels: body.channels ?? (body.severity === "critical" ? ["email", "sms"] : ["email"]),
    };
    const { data: inserted } = await supabase.from("bot_alerts").insert(alert).select("*").single();
    const r = await send(inserted);
    if (r.sent_email_id || r.sent_sms_id) {
      await supabase.from("bot_alerts").update({
        sent_at: new Date().toISOString(),
        sent_email_id: r.sent_email_id,
        sent_sms_id: r.sent_sms_id,
      }).eq("id", (inserted as any).id);
    }
    return new Response(JSON.stringify({ ok: true, alert_id: (inserted as any)?.id, ...r }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Mode 1: flush queue
  const result = await flush();
  return new Response(JSON.stringify({ ok: true, ...result }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});