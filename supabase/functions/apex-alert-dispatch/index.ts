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
import { postNtfyGraded } from "../_shared/ntfy-post.ts";
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
  // License-returned alerts are contracting work, not production/numbers chat.
  // Keep all other Pulse alerts on the existing production route.
  const discordSettingKey = alert?.event_type === "agent_license_returned"
    ? "discord_webhook_url_contracting"
    : "discord_webhook_url";
  const { data } = await supabase
    .from("system_settings")
    .select("value")
    .eq("key", discordSettingKey)
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

// WhatsApp channel removed 2026-09-07 (team is Slack + Discord only; no bot_alerts row ever seeded 'whatsapp').

// MP-542: this constant was deleted on 2026-09-07 by 66d59f20 ("remove WhatsApp
// from the product") — it sat between the WhatsApp sender and the next function,
// so removing that block took it along. Its ONLY use site, in the topic resolver
// below, survived. system_settings has never held an `ntfy_topic_url` row, so the
// `||` fallback is evaluated on EVERY real alert, and an undefined identifier
// there is an uncaught ReferenceError, not a falsy value.
//
// Proven live before the fix, both directions, against deployed v171:
//   selftest WITH a topic override  -> {"ok":true,"receipt":"ok"}
//   selftest WITHOUT one            -> 500 Internal Server Error
//
// Inside send() the throw lands in the ntfy try/catch, so email and Discord kept
// delivering and the alert still recorded as sent. The honest claim is therefore
// NOT "Sam heard nothing" — it is that for 8 days the one channel that reaches
// his pocket could not be reached by the dispatcher, and nothing said so.
export const NTFY_DEFAULT_TOPIC = "https://ntfy.sh/sams-agent-yrkv9kbqp9e987nb";

/**
 * Resolve Sam's ntfy topic the way every real alert resolves it.
 *
 * Returns the source alongside the url because "which branch answered" is the
 * thing the selftest has to be able to see — see the selftest note in Deno.serve.
 * Never throws: a resolver that dies takes the whole invocation with it, which is
 * exactly how this defect presented.
 */
async function resolveNtfyTopic(): Promise<{ url: string; source: string }> {
  try {
    const { data } = await supabase
      .from("system_settings")
      .select("value")
      .eq("key", "ntfy_topic_url")
      .maybeSingle();
    const configured = (data as any)?.value;
    if (configured) return { url: String(configured), source: "system_settings" };
    return { url: NTFY_DEFAULT_TOPIC, source: "default_constant" };
  } catch (e: any) {
    return { url: NTFY_DEFAULT_TOPIC, source: `default_constant_after_error:${e?.message ?? String(e)}` };
  }
}

async function postNtfy(alert: any, topicOverride?: string): Promise<{ ok: boolean; receipt: string; topicSource: string }> {
  // ntfy.sh — Sam's primary mobile push. Always available, no creds needed.
  //
  // The resolver runs even when a destination override is supplied. A probe that
  // skips resolution grades a branch no real alert takes: apex-doctor Check #21
  // passes a throwaway topic, so it returned "ok" every run for 8 days while the
  // live path 500'd. Resolve always, send wherever the caller asked.
  const resolved = await resolveNtfyTopic();
  const url = topicOverride || resolved.url;
  // Receipt now NAMES the refusal instead of printing a bare `http:429`. On
  // 2026-09-14 that bare status sent apex-doctor Check #21 to the false sentence
  // "Sam's primary phone push is not delivering" while the channel was up and
  // carrying 23 messages — the cause was ntfy code 42908, a per-visitor-IP daily
  // quota on the shared Supabase egress, readable only from the response body.
  const res = await postNtfyGraded(url, {
    title: String(alert.subject ?? "APEX alert"),
    body: String(alert.sms_body || alert.subject || ""),
    tags: alert.severity === "critical" ? "rotating_light" : alert.severity === "celebrate" ? "tada,fire" : "bell",
    priority: alert.severity === "critical" ? "5" : "4",
    click: alert.action_link ? String(alert.action_link) : undefined,
  });
  return { ok: res.ok, receipt: res.receipt, topicSource: resolved.source };
}

async function send(alert: any): Promise<{ email_id: string | null; sent_sms: boolean; sms_receipt: string | null; sent_discord: boolean; sent_ntfy: boolean; error: string | null }> {
  // Default channel set: every standalone alert fans out to ALL channels Sam
  // owns so no notification path silently skips. Discord + ntfy always go;
  // email + sms also when configured.
  const requested: string[] = alert.channels ?? ["email", "sms", "discord", "ntfy"];
  const channels = new Set([...requested, "discord", "ntfy"]); // always include
  let email_id: string | null = null;
  let sent_sms = false;
  let sms_receipt: string | null = null;
  let sent_discord = false;
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
      // MP-273: this used to set sent_sms=true the instant the round trip finished.
      // Two reasons that was never a delivery signal:
      //   1. functions.invoke resolves with { error } on a non-2xx, it does not throw,
      //      so the catch below could not see a failed call.
      //   2. send-sms-auto-detect answers 200 with outcome:"skipped" when it sent
      //      NOTHING, and its own comment asks callers to branch on that rather than
      //      "treating the person as contacted". This was the only caller that didn't.
      // Result: 5 of 5 alerts since 2026-07-31 recorded sent_sms_id='sent' while the
      // SMS log recorded 'skipped — no carrier on file' for the same 5 messages.
      const { data: smsRes, error: smsErr } = await supabase.functions.invoke(
        "send-sms-auto-detect",
        { body: { phone: SAM_PHONE, message: String(alert.sms_body).slice(0, 90) } },
      );
      if (smsErr) {
        errs.push(`sms: invoke failed: ${smsErr.message ?? String(smsErr)}`);
      } else if (smsRes?.outcome === "sent") {
        sent_sms = true;
        // A gateway that accepted the message is the strongest receipt this path can
        // produce -- carrier delivery is asynchronous and never reports back. Name the
        // gateway so the column says what actually happened instead of "sent".
        sms_receipt = `gateway:${smsRes.carrierSelected ?? "unknown"}`;
      } else {
        const why = smsRes?.attempts?.[smsRes.attempts.length - 1]?.error ?? "nothing sent";
        errs.push(`sms: ${smsRes?.outcome ?? "no response"} — ${why}`);
      }
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

  if (channels.has("ntfy")) {
    try {
      const n = await postNtfy(alert);
      sent_ntfy = n.ok;
      // A silent false is how the emoji-header throw survived. Record the reason.
      if (!n.ok) errs.push(`ntfy: ${n.receipt}`);
    } catch (e: any) {
      errs.push(`ntfy: ${e?.message ?? String(e)}`);
    }
  }
  return { email_id, sent_sms, sms_receipt, sent_discord, sent_ntfy, error: errs.length ? errs.join("; ") : null };
}

async function flush(): Promise<{ scanned: number; sent: number; held: number; expired: number }> {
  // Pull standalone-eligible alerts FIRST (celebrate + critical) so a glut of
  // warn/info alerts can never starve the queue. Sam reported 17 celebrate
  // big_deal alerts buried under 185 stuck warns; that's fixed here.
  //
  // STALENESS GUARD (2026-08-11). This query had no age bound, and cron
  // 'apex-alert-dispatch-flush' had not existed for 106 days, so the first tick
  // after the cron was restored would have fired the entire backlog: 1,533
  // alerts, 1,407 of them over a week old, including 97 celebrate rows that are
  // one applicant_newly_licensed backfill batch sharing a single created_at.
  // Sam would have received 97 separate phone pushes congratulating him about
  // people licensed days ago. Turning a silent failure into a pager storm is not
  // a fix — it is the trade the cron gate made four times this week.
  //
  // Alerts older than the window are terminal (bot_alerts.expired_at, set by
  // migration 20260811180000). expired_at NEVER implies delivery: sent_at stays
  // null and v_bot_alert_delivery_truth reports them as expired_undelivered, a
  // state of their own. Stamping sent_at instead would have recorded 1,531
  // deliveries that never happened — the 465-row InsuraCloud disease, inside the
  // table that exists to report on delivery.
  const MAX_ALERT_AGE_HOURS = Number(Deno.env.get("ALERT_MAX_AGE_HOURS") ?? 24);
  const cutoff = new Date(Date.now() - MAX_ALERT_AGE_HOURS * 3600_000).toISOString();

  const { data: queue } = await supabase
    .from("bot_alerts")
    .select("*")
    .is("sent_at", null)
    .is("expired_at", null)
    .gte("created_at", cutoff)
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
    const anyLanded = !!(r.email_id || r.sent_sms || r.sent_discord || r.sent_ntfy);
    if (anyLanded) {
      await supabase.from("bot_alerts").update({
        sent_at: new Date().toISOString(),
        sent_email_id: r.email_id,
        sent_sms_id: r.sms_receipt,
      }).eq("id", (alert as any).id);
      sent++;
    }
  }

  // Age out anything that passed the window without being delivered. Without
  // this the backlog silently regrows into the same 1,533-row pile the guard was
  // built to drain, and apex-doctor Check #18 goes permanently red again — which
  // is how a check stops being read. Expiry is recorded as its own terminal
  // state; it is never dressed up as delivery.
  const { count: expired } = await supabase
    .from("bot_alerts")
    .update(
      {
        expired_at: new Date().toISOString(),
        expired_reason: `undelivered for more than ${MAX_ALERT_AGE_HOURS}h`,
      },
      { count: "exact" },
    )
    .is("sent_at", null)
    .is("expired_at", null)
    .lt("created_at", cutoff);

  return { scanned: queue?.length ?? 0, sent, held, expired: expired ?? 0 };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  let body: any = {};
  try { body = await req.json(); } catch { /* empty */ }

  // Live liveness probe for apex-doctor. Exercises the REAL encoder + POST path
  // in the deployed function, but takes a topic override so the weekly check
  // never pushes to Sam's phone. Writes no row. Emoji subject is the point:
  // an unencoded one throws while constructing the Request.
  if (body.selftest_ntfy) {
    const n = await postNtfy(
      { subject: body.subject ?? "🎓 apex-doctor ntfy selftest", sms_body: "selftest", severity: "info" },
      body.ntfy_topic || undefined,
    );
    // topic_source is published so a green probe proves the REAL resolution path
    // answered, not just that a hardcoded override accepted a POST.
    return new Response(JSON.stringify({ ok: n.ok, selftest: "ntfy", receipt: n.receipt, topic_source: n.topicSource }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

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
      // Same "any channel landed" test flush() uses. This path used to count only
      // email+sms, so a Discord/ntfy-only delivery stayed sent_at NULL forever and
      // got re-dispatched by the next flush.
      if (r.email_id || r.sent_sms || r.sent_discord || r.sent_ntfy) {
        await supabase.from("bot_alerts").update({
          sent_at: new Date().toISOString(),
          sent_email_id: r.email_id,
          sent_sms_id: r.sms_receipt,
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
