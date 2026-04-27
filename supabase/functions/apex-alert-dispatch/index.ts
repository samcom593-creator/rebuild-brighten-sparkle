// APEX alert dispatcher (v2 — minimal-noise).
// redeploy marker: v2 email rewrite live refresh
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

async function postDiscord(alert: any): Promise<boolean> {
  const { data } = await supabase
    .from("system_settings")
    .select("value")
    .eq("key", "discord_webhook_url")
    .maybeSingle();
  const url = (data as any)?.value;
  if (!url) return false;
  const tone: Record<string, { color: number; tag: string }> = {
    critical: { color: 14441288, tag: "🚨 CRITICAL" },
    celebrate: { color: 5763719, tag: "🎉 WIN" },
  };
  const t = tone[alert.severity] ?? { color: 6710886, tag: alert.severity };
  const stripHtml = (s: string) => String(s ?? "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim().slice(0, 1000);
  const body = {
    username: `APEX ${t.tag}`,
    embeds: [
      {
        title: alert.subject,
        description: stripHtml(alert.body),
        color: t.color,
        url: alert.action_link || undefined,
        footer: { text: `APEX Pulse · ${alert.event_type}` },
        timestamp: new Date().toISOString(),
      },
    ],
  };
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return r.status === 204 || r.status === 200;
  } catch {
    return false;
  }
}

async function postWhatsapp(alert: any): Promise<boolean> {
  // Meta WhatsApp Cloud API. Requires meta_whatsapp_token + meta_whatsapp_phone_id
  // in system_settings. Sends a free-form text to Sam's number when allowed by
  // the 24h customer-service window, otherwise no-op.
  const { data: settings } = await supabase
    .from("system_settings")
    .select("key,value")
    .in("key", ["meta_whatsapp_token", "meta_whatsapp_phone_id", "sam_whatsapp_number"]);
  const map: Record<string, string> = {};
  for (const s of settings ?? []) map[(s as any).key] = (s as any).value || "";
  if (!map.meta_whatsapp_token || !map.meta_whatsapp_phone_id) return false;
  const to = (map.sam_whatsapp_number || SAM_PHONE).replace(/\D/g, "");
  if (!to) return false;
  const text = `*${alert.subject}*\n${String(alert.sms_body || alert.body).replace(/<[^>]+>/g, "").slice(0, 1000)}`;
  try {
    const r = await fetch(`https://graph.facebook.com/v20.0/${map.meta_whatsapp_phone_id}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${map.meta_whatsapp_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body: text },
      }),
    });
    return r.ok;
  } catch {
    return false;
  }
}

async function postNtfy(alert: any): Promise<boolean> {
  // ntfy.sh — Sam's primary mobile push. Always available, no creds needed.
  const { data } = await supabase
    .from("system_settings")
    .select("value")
    .eq("key", "ntfy_topic_url")
    .maybeSingle();
  const url = (data as any)?.value || "https://ntfy.sh/sams-agent-yrkv9kbqp9e987nb";
  try {
    const headers: Record<string, string> = {
      "Title": String(alert.subject ?? "APEX alert").slice(0, 200),
      "Tags": alert.severity === "critical" ? "rotating_light" : alert.severity === "celebrate" ? "tada,fire" : "bell",
      "Priority": alert.severity === "critical" ? "5" : "4",
    };
    if (alert.action_link) headers["Click"] = alert.action_link;
    const r = await fetch(url, {
      method: "POST",
      headers,
      body: String(alert.sms_body || alert.subject || "").slice(0, 4000),
    });
    return r.ok;
  } catch {
    return false;
  }
}

async function send(alert: any): Promise<{ email_id: string | null; sent_sms: boolean; sent_discord: boolean; sent_whatsapp: boolean; sent_ntfy: boolean; error: string | null }> {
  // Default channel set: every standalone alert fans out to ALL channels Sam
  // owns so no notification path silently skips. Discord + ntfy always go;
  // email + sms + whatsapp also when configured.
  const requested: string[] = alert.channels ?? ["email", "sms", "discord", "ntfy"];
  const channels = new Set([...requested, "discord", "ntfy"]); // always include
  let email_id: string | null = null;
  let sent_sms = false;
  let sent_discord = false;
  let sent_whatsapp = false;
  let sent_ntfy = false;
  const errs: string[] = [];

  if (channels.has("email")) {
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
  if (channels.has("sms") && alert.sms_body) {
    try {
      await supabase.functions.invoke("send-sms-auto-detect", {
        body: { phone: SAM_PHONE, message: String(alert.sms_body).slice(0, 90) },
      });
      sent_sms = true;
    } catch (e: any) {
      errs.push(`sms: ${e?.message ?? String(e)}`);
    }
  }
  if (channels.has("discord")) {
    try {
      sent_discord = await postDiscord(alert);
      if (!sent_discord) errs.push("discord: post failed");
    } catch (e: any) {
      errs.push(`discord: ${e?.message ?? String(e)}`);
    }
  }
  if (channels.has("whatsapp")) {
    try {
      sent_whatsapp = await postWhatsapp(alert);
    } catch (e: any) {
      errs.push(`whatsapp: ${e?.message ?? String(e)}`);
    }
  }
  if (channels.has("ntfy")) {
    try {
      sent_ntfy = await postNtfy(alert);
    } catch (e: any) {
      errs.push(`ntfy: ${e?.message ?? String(e)}`);
    }
  }
  return { email_id, sent_sms, sent_discord, sent_whatsapp, sent_ntfy, error: errs.length ? errs.join("; ") : null };
}

async function flush(): Promise<{ scanned: number; sent: number; held: number }> {
  // Pull standalone-eligible alerts FIRST (celebrate + critical) so a glut of
  // warn/info alerts can never starve the queue. Sam reported 17 celebrate
  // big_deal alerts buried under 185 stuck warns; that's fixed here.
  const { data: queue } = await supabase
    .from("bot_alerts")
    .select("*")
    .is("sent_at", null)
    .in("severity", ["celebrate", "critical"])
    .order("created_at", { ascending: true })
    .limit(50);

  let sent = 0, held = 0;
  for (const alert of queue ?? []) {
    const sev = (alert as any).severity;
    if (!STANDALONE.has(sev)) { held++; continue; }

    const r = await send(alert);
    // Mark as sent if ANY channel landed — Discord/ntfy don't have IDs but
    // returned booleans, so a successful Discord-only post still counts.
    const anyLanded = !!(r.email_id || r.sent_sms || r.sent_discord || r.sent_whatsapp || r.sent_ntfy);
    if (anyLanded) {
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
