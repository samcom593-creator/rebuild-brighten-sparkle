// send-calendly-invite edge function (MP-224)
// Sends a personal Calendly invite to unlicensed applicants via Resend.
//
// Guards (per APEX 465-row InsuraCloud fake-success lesson + MP-224 §1):
//   - Honors outreach_queue.do_not_contact (skip)
//   - Idempotent: skip if outreach_queue row for this applicant_id + source_run
//     already has sent_at NOT NULL
//   - Resend HTML-body fake-success detection (response body starts with <html / <!doctype)
//   - Per-batch rate-limit to stay under Resend's 10 req/sec ceiling
//
// Modes:
//   1. Single send  → POST { applicant_id, applicant_email?, applicant_first_name? }
//   2. Batch drain  → POST {} or {"mode":"batch","batch_size":25}
//                     Pulls pending rows from outreach_queue where
//                     source_run='calendly-invite' AND sent_at IS NULL.
//
// Returns: { processed, sent, failed, skipped }
//
// Deploy:
//   npx supabase functions deploy send-calendly-invite --no-verify-jwt

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SOURCE_RUN = "calendly-invite";
const FROM = "Sam James <sam@apex-financial.org>";
const SUBJECT = "Personal invite from Samuel James — let's talk about your career";
const CALENDLY_URL = "https://calendly.com/apexfinancialempire/licensed-prospect-call-clone";
const RESEND_SEND_URL = "https://api.resend.com/emails";
const DEFAULT_BATCH = 25;
const MAX_BATCH = 200;

type SinglePayload = {
  applicant_id?: string;
  applicant_email?: string;
  applicant_first_name?: string;
  mode?: "single" | "batch";
  batch_size?: number;
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function looksLikeHtmlMasquerade(text: string): boolean {
  if (!text) return false;
  const head = text.trim().slice(0, 256).toLowerCase();
  return head.includes("<html") || head.includes("<!doctype");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildHtml(firstName: string): string {
  const safeFirst = escapeHtml(firstName || "there");
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Personal invite from Samuel James</title>
</head>
<body style="margin:0;padding:0;background-color:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#1a1a1a;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#f5f5f5;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 14px rgba(0,0,0,0.08);">
          <tr>
            <td style="background:linear-gradient(135deg,#0f172a,#1e293b);padding:28px 24px;text-align:center;">
              <h1 style="margin:0;font-size:22px;font-weight:700;color:#ffffff;letter-spacing:0.4px;">APEX FINANCIAL</h1>
              <p style="margin:6px 0 0;font-size:13px;color:#94a3b8;">Hold the Standard.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:28px 24px 8px;">
              <p style="font-size:17px;line-height:1.55;margin:0 0 16px;color:#1a1a1a;">
                Hey ${safeFirst},
              </p>
              <p style="font-size:16px;line-height:1.65;margin:0 0 16px;color:#1a1a1a;">
                Sam James here, Managing Partner at Apex Financial. I personally read every application that comes through, and yours caught my eye.
              </p>
              <p style="font-size:16px;line-height:1.65;margin:0 0 16px;color:#1a1a1a;">
                I want to spend 15 minutes with you on a call — no pitch, no pressure. Just a straight conversation about where you are, where you want to go, and whether what we're building at Apex actually fits.
              </p>
              <p style="font-size:16px;line-height:1.65;margin:0 0 20px;color:#1a1a1a;">
                Pick a time that works for you and lock it in below:
              </p>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:0 24px 8px;">
              <table role="presentation" cellspacing="0" cellpadding="0">
                <tr>
                  <td bgcolor="#0ea5e9" style="border-radius:8px;">
                    <a href="${CALENDLY_URL}" target="_blank" style="display:inline-block;color:#ffffff;padding:14px 28px;text-decoration:none;font-weight:700;font-size:16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
                      Book My Call With Sam
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:14px 24px 24px;" align="center">
              <p style="font-size:13px;line-height:1.5;margin:0;color:#475569;">
                Or paste this link in your browser:<br>
                <a href="${CALENDLY_URL}" style="color:#0ea5e9;word-break:break-all;">${CALENDLY_URL}</a>
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 24px 28px;">
              <p style="font-size:15px;line-height:1.65;margin:0 0 8px;color:#1a1a1a;">
                Talk soon,
              </p>
              <p style="font-size:15px;line-height:1.55;margin:0;color:#1a1a1a;">
                <strong>Samuel James</strong><br>
                <span style="color:#475569;font-size:13px;">Managing Partner, Apex Financial</span>
              </p>
            </td>
          </tr>
          <tr>
            <td style="background:#0f172a;padding:14px 24px;text-align:center;">
              <p style="margin:0;color:#94a3b8;font-size:11px;line-height:1.5;">
                Apex Financial · sam@apex-financial.org<br>
                You're receiving this because you applied to join our team.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

type Outcome = {
  processed: number;
  sent: number;
  failed: number;
  skipped: number;
  details?: any[];
};

async function sendOne(
  resendKey: string,
  toEmail: string,
  firstName: string,
): Promise<{ ok: boolean; providerId?: string; error?: string }> {
  const html = buildHtml(firstName);
  const res = await fetch(RESEND_SEND_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: FROM,
      to: [toEmail],
      subject: SUBJECT,
      html,
      reply_to: "sam@apex-financial.org",
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    return { ok: false, error: `resend ${res.status}: ${text.slice(0, 280)}` };
  }
  if (looksLikeHtmlMasquerade(text)) {
    return { ok: false, error: "fake-success: Resend returned HTML body" };
  }
  let providerId: string | undefined;
  try {
    const j = JSON.parse(text);
    providerId = j?.id;
  } catch (_) {
    return { ok: false, error: "fake-success: Resend response not JSON" };
  }
  if (!providerId) {
    return { ok: false, error: "fake-success: no provider id in Resend response" };
  }
  return { ok: true, providerId };
}

async function handleSingle(
  supabase: any,
  resendKey: string,
  payload: SinglePayload,
): Promise<Outcome> {
  const out: Outcome = { processed: 1, sent: 0, failed: 0, skipped: 0, details: [] };
  const applicantId = payload.applicant_id!;
  let email = payload.applicant_email || null;
  let firstName = payload.applicant_first_name || null;

  // Hydrate from applications if needed
  if (!email || !firstName) {
    const { data: appRow } = await supabase
      .from("applications")
      .select("email, first_name, license_status")
      .eq("id", applicantId)
      .maybeSingle();
    if (appRow) {
      if (!email) email = appRow.email;
      if (!firstName) firstName = appRow.first_name;
    }
  }

  if (!email || !email.includes("@")) {
    out.failed = 1;
    out.details!.push({ applicant_id: applicantId, status: "failed", reason: "missing email" });
    return out;
  }

  const idempotencyKey = `calendly-${applicantId}`;

  // Look up / upsert queue row, check sent_at + do_not_contact
  const { data: existing } = await supabase
    .from("outreach_queue")
    .select("id, sent_at, do_not_contact")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();

  if (existing) {
    if (existing.do_not_contact) {
      out.skipped = 1;
      out.sent = 0;
      out.processed = 1;
      out.details!.push({ applicant_id: applicantId, status: "skipped", reason: "do_not_contact" });
      return out;
    }
    if (existing.sent_at) {
      out.skipped = 1;
      out.processed = 1;
      out.details!.push({ applicant_id: applicantId, status: "skipped", reason: "already sent" });
      return out;
    }
  } else {
    // Insert a queue row so we have a durable receipt
    const { error: insErr } = await supabase
      .from("outreach_queue")
      .insert({
        channel: "email",
        source_run: SOURCE_RUN,
        application_id: applicantId,
        to_email: email,
        subject: SUBJECT,
        idempotency_key: idempotencyKey,
        status: "pending",
        scheduled_for: new Date().toISOString(),
        template_key: "calendly-invite-v1",
      });
    if (insErr) {
      // Conflict on unique idempotency_key is OK; anything else fails.
      const msg = String(insErr.message || insErr);
      if (!msg.toLowerCase().includes("duplicate")) {
        out.failed = 1;
        out.details!.push({ applicant_id: applicantId, status: "failed", reason: `queue insert: ${msg}` });
        return out;
      }
    }
  }

  const r = await sendOne(resendKey, email!, firstName || "there");
  const nowIso = new Date().toISOString();
  if (r.ok) {
    await supabase
      .from("outreach_queue")
      .update({
        sent_at: nowIso,
        status: "sent",
        provider_message_id: r.providerId,
        last_attempted_at: nowIso,
      })
      .eq("idempotency_key", idempotencyKey);
    out.sent = 1;
    out.details!.push({ applicant_id: applicantId, status: "sent", provider_id: r.providerId });
  } else {
    await supabase
      .from("outreach_queue")
      .update({
        status: "failed",
        last_attempted_at: nowIso,
        last_error: r.error?.slice(0, 500) ?? "unknown",
      })
      .eq("idempotency_key", idempotencyKey);
    out.failed = 1;
    out.details!.push({ applicant_id: applicantId, status: "failed", reason: r.error });
  }
  return out;
}

async function handleBatch(
  supabase: any,
  resendKey: string,
  batchSize: number,
): Promise<Outcome> {
  const out: Outcome = { processed: 0, sent: 0, failed: 0, skipped: 0, details: [] };

  const { data: rows, error } = await supabase
    .from("outreach_queue")
    .select("id, application_id, to_email, do_not_contact, sent_at, idempotency_key")
    .eq("source_run", SOURCE_RUN)
    .is("sent_at", null)
    .neq("status", "failed_permanent")
    .order("created_at", { ascending: true })
    .limit(batchSize);

  if (error) {
    return { processed: 0, sent: 0, failed: 1, skipped: 0, details: [{ status: "failed", reason: error.message }] };
  }
  if (!rows || rows.length === 0) return out;

  for (const row of rows) {
    out.processed += 1;
    if (row.do_not_contact) {
      out.skipped += 1;
      await supabase
        .from("outreach_queue")
        .update({ status: "skipped", last_error: "do_not_contact" })
        .eq("id", row.id);
      out.details!.push({ queue_id: row.id, status: "skipped", reason: "do_not_contact" });
      continue;
    }
    if (row.sent_at) {
      out.skipped += 1;
      out.details!.push({ queue_id: row.id, status: "skipped", reason: "already sent" });
      continue;
    }

    // Hydrate email + first_name
    let email = row.to_email as string | null;
    let firstName: string | null = null;
    if (row.application_id) {
      const { data: appRow } = await supabase
        .from("applications")
        .select("email, first_name")
        .eq("id", row.application_id)
        .maybeSingle();
      if (appRow) {
        if (!email) email = appRow.email;
        firstName = appRow.first_name;
      }
    }
    if (!email || !email.includes("@")) {
      out.failed += 1;
      await supabase
        .from("outreach_queue")
        .update({ status: "failed", last_error: "missing email" })
        .eq("id", row.id);
      out.details!.push({ queue_id: row.id, status: "failed", reason: "missing email" });
      continue;
    }

    const r = await sendOne(resendKey, email, firstName || "there");
    const nowIso = new Date().toISOString();
    if (r.ok) {
      await supabase
        .from("outreach_queue")
        .update({
          sent_at: nowIso,
          status: "sent",
          provider_message_id: r.providerId,
          last_attempted_at: nowIso,
          to_email: email,
        })
        .eq("id", row.id);
      out.sent += 1;
      out.details!.push({ queue_id: row.id, status: "sent", provider_id: r.providerId });
    } else {
      await supabase
        .from("outreach_queue")
        .update({
          status: "failed",
          last_attempted_at: nowIso,
          last_error: r.error?.slice(0, 500) ?? "unknown",
        })
        .eq("id", row.id);
      out.failed += 1;
      out.details!.push({ queue_id: row.id, status: "failed", reason: r.error });
    }
    // Stay well under Resend's 10/sec ceiling
    await sleep(150);
  }
  return out;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (!supabaseUrl || !serviceKey) {
    return new Response(JSON.stringify({ error: "supabase env missing" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (!resendKey) {
    return new Response(JSON.stringify({ error: "RESEND_API_KEY missing" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: SinglePayload = {};
  try {
    body = await req.json();
  } catch (_) {
    body = {};
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  try {
    let result: Outcome;
    if (body.applicant_id) {
      result = await handleSingle(supabase, resendKey, body);
    } else {
      const size = Math.max(1, Math.min(MAX_BATCH, body.batch_size ?? DEFAULT_BATCH));
      result = await handleBatch(supabase, resendKey, size);
    }
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(
      JSON.stringify({ error: String((e as any)?.message || e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
