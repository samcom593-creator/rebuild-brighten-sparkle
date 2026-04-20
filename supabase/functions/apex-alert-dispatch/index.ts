// APEX alert dispatcher (v2 — minimal-noise).
//
// Noise-control rules:
//   critical → send email + SMS immediately on every flush
//   celebrate (big deal) → send email + SMS immediately
//   warn     → NEVER sent standalone. Rolled into the 7am morning digest.
//   info     → never emailed or SMSed. Stays in bot_alerts for posterity.
//
// Shared-secret auth for ad-hoc alerts via x-alert-dispatch-secret header.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { Resend } from "https://esm.sh/resend@2.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SAM_EMAIL = "info@kingofsales.net";
const SAM_PHONE = "4697676068";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);
const resend = new Resend(Deno.env.get("RESEND_API_KEY") ?? "");

// Only these severities trigger a standalone email/SMS. Everything else waits.
const STANDALONE = new Set(["critical", "celebrate"]);

function emailShell(subject: string, inner: string, severity: string) {
  const tone: Record<string, { bg: string; border: string; tag: string }> = {
    critical: { bg: "#fee2e2", border: "#dc2626", tag: "🚨 CRITICAL" },
    celebrate: { bg: "#dcfce7", border: "#16a34a", tag: "🎉 WIN" },
  };
  const t = tone[severity] ?? { bg: "#f3f4f6", border: "#64748b", tag: severity };
  return `<div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;max-width:560px;margin:0 auto;padding:20px;color:#0f172a;line-height:1.5">
<div style="border-left:3px solid ${t.border};padding-left:12px;margin-bottom:16px"><div style="color:${t.border};font-size:11px;font-weight:bold;letter-spacing:0.5px">${t.tag}</div><h2 style="margin:2px 0;font-size:18px">${subject}</h2></div>
${inner}
</div>`;
}

async function send(alert: any): Promise<{ email_id: string | null; sent_sms: boolean; error: string | null }> {
  const channels: string[] = alert.channels ?? ["email", "sms"];
  let email_id: string | null = null;
  let sent_sms = false;
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
      await supabase.functions.invoke("send-sms-auto-detect", {
        body: { phone: SAM_PHONE, message: String(alert.sms_body).slice(0, 90) },
      });
      sent_sms = true;
    } catch (e: any) {
      errs.push(`sms: ${e?.message ?? String(e)}`);
    }
  }
  return { email_id, sent_sms, error: errs.length ? errs.join("; ") : null };
}

async function flush(): Promise<{ scanned: number; sent: number; held: number }> {
  const { data: queue } = await supabase
    .from("bot_alerts")
    .select("*")
    .is("sent_at", null)
    .order("created_at", { ascending: true })
    .limit(50);

  let sent = 0, held = 0;
  for (const alert of queue ?? []) {
    const sev = (alert as any).severity;
    if (!STANDALONE.has(sev)) { held++; continue; }

    const r = await send(alert);
    if (r.email_id || r.sent_sms) {
      await supabase.from("bot_alerts").update({
        sent_at: new Date().toISOString(),
        sent_email_id: r.email_id,
        sent_sms_id: r.sent_sms ? "sent" : null,
      }).eq("id", (alert as any).id);
      sent++;
    }
  }
  return { scanned: queue?.length ?? 0, sent, held };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  let body: any = {};
  try { body = await req.json(); } catch { /* empty */ }

  // Ad-hoc alert: inserts + dispatches if severity is standalone
  if (body.event_type) {
    const severity = body.severity ?? "warn";
    const alert = {
      source: body.source ?? "manual",
      event_type: body.event_type,
      severity,
      subject: body.subject ?? body.event_type,
      body: body.body ?? "",
      sms_body: body.sms_body ?? body.subject ?? body.event_type,
      action_link: body.action_link ?? null,
      channels: body.channels ?? (severity === "critical" || severity === "celebrate" ? ["email", "sms"] : ["email"]),
    };
    const { data: inserted } = await supabase.from("bot_alerts").insert(alert).select("*").single();
    if (STANDALONE.has(severity)) {
      const r = await send(inserted);
      if (r.email_id || r.sent_sms) {
        await supabase.from("bot_alerts").update({
          sent_at: new Date().toISOString(),
          sent_email_id: r.email_id,
          sent_sms_id: r.sent_sms ? "sent" : null,
        }).eq("id", (inserted as any).id);
      }
      return new Response(JSON.stringify({ ok: true, alert_id: (inserted as any)?.id, dispatched: true, ...r }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ ok: true, alert_id: (inserted as any)?.id, dispatched: false, held: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Flush queue: only standalone severities escape the queue
  const result = await flush();
  return new Response(JSON.stringify({ ok: true, ...result }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
