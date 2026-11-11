// reactivation-send: send ONE reactivation v2 email for ONE application.
//
// Caller: pg_cron -> public.fn_reactivation_dispatch() -> net.http_post, one request per
// claimed application. Nothing else calls this.
//
// Auth: the x-reactivation-key header, compared in constant time against the
// REACTIVATION_SEND_KEY edge secret (its vault twin is reactivation_send_key). An unset
// secret fails closed. config.toml sets verify_jwt = false because the caller presents no
// JWT; this check, above every read and every send, is the gate.
//
// Copy lives in next_step_stages for the stage_key the caller names, never in this file:
// email_subject_template (one subject variant per row), email_body_template (html) and
// candidate_message_template (the plain-text body).
//
// Receipts: every outcome writes a next_step_messages row AFTER the decision, with sent_at
// (accepted) or failed_at (refused or skipped) already set, so the AFTER INSERT dispatch
// trigger (WHEN sent_at IS NULL AND failed_at IS NULL) never fires on it. The campaign
// trigger fn_reactivation_on_receipt reads that row to advance or stop the sequence, so a
// person is never left claimed. Only a sent row carries dedupe_key (it is partially unique;
// a refused row holding it would block every retry).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.90.1";
import { Resend } from "https://esm.sh/resend@2.0.0";
import { gateResend } from "../_shared/resend-gate.ts";
import { BRAND_FROM, BRAND_REPLY_TO } from "../_shared/email.ts";
import { safeEqual } from "../_shared/send-floor.ts";
import { buildBookingUrl, SCHEDULING_LINKS, statusPageUrl } from "../_shared/scheduling-links.ts";
import {
  bookingBaseFor,
  isRetryable,
  normalizeName,
  parseStageKey,
  renderTemplate,
  subjectTemplateFor,
} from "./render.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const RESEND_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const SEND_KEY = Deno.env.get("REACTIVATION_SEND_KEY") ?? "";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

/** Constant-time compare of the presented key against the edge secret. An unset secret never matches. */
function verifySendKey(expected: string, presented: string | null): boolean {
  if (!expected || !presented) return false;
  return safeEqual(presented.trim(), expected);
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Campaign attribution on top of buildBookingUrl, which already set name/email prefill and utm_content. */
function withCampaignUtm(url: string, term: string): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch (e) {
    console.warn(`reactivation-send: booking url not parseable, sending as-is: ${errorText(e)}`);
    return url;
  }
  u.searchParams.set("utm_source", "reactivation");
  u.searchParams.set("utm_medium", "email");
  u.searchParams.set("utm_campaign", "reactivation_v2");
  u.searchParams.set("utm_term", term);
  return u.toString();
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204 });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  if (!verifySendKey(SEND_KEY, req.headers.get("x-reactivation-key"))) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }
  if (!SUPABASE_URL || !SERVICE_KEY || !RESEND_KEY) {
    return json({ ok: false, error: "not_configured" }, 503);
  }

  let payload: Record<string, unknown>;
  try {
    const parsed: unknown = await req.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return json({ ok: false, error: "body must be a JSON object" }, 400);
    }
    payload = parsed as Record<string, unknown>;
  } catch (e) {
    return json({ ok: false, error: `body must be JSON: ${errorText(e)}` }, 400);
  }

  const applicationId = String(payload.application_id ?? "").trim().toLowerCase();
  const stageKey = String(payload.stage_key ?? "").trim();
  const stage = parseStageKey(stageKey);
  if (!UUID.test(applicationId) || !stage) {
    return json({ ok: false, error: "bad_request" }, 400);
  }

  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  // stage_key is the primary key, so this read cannot be ambiguous.
  const { data: tpl, error: tplErr } = await sb
    .from("next_step_stages")
    .select("stage_key, email_subject_template, email_body_template, candidate_message_template")
    .eq("stage_key", stageKey)
    .maybeSingle();
  if (tplErr) return json({ ok: false, error: `stage unreadable: ${tplErr.message}` }, 500);
  if (!tpl) return json({ ok: false, error: "unknown_stage" }, 404);

  // applications.id is the primary key.
  const { data: app, error: appErr } = await sb
    .from("applications")
    .select("id, first_name, last_name, email, email_consent_given, do_not_contact_at")
    .eq("id", applicationId)
    .maybeSingle();
  if (appErr) return json({ ok: false, error: `application unreadable: ${appErr.message}` }, 500);
  if (!app) return json({ ok: false, error: "no_application" }, 404);

  const address = String(app.email ?? "").trim().toLowerCase();

  // A refused or skipped attempt still writes a receipt, so the campaign trigger releases the
  // claim with the reason instead of leaving the person claimed until it goes stale.
  const refuse = async (reason: string, status: number, subject: string | null, retryable: boolean): Promise<Response> => {
    const { error: ledgerErr } = await sb.from("next_step_messages").insert({
      application_id: applicationId,
      stage_key: stageKey,
      channel: "email",
      template_key: stageKey,
      recipient: address || null,
      subject,
      failed_at: new Date().toISOString(),
      error: reason.slice(0, 500),
      metadata: {
        campaign: "reactivation_v2", track: stage.track, touch: stage.touch, variant: stage.variant,
        retryable,
      },
    });
    const { error: eventErr } = await sb.from("next_step_events").insert({
      application_id: applicationId,
      to_stage: stageKey,
      event_type: "message_failed",
      source: "cron",
      payload: { channel: "email", campaign: "reactivation_v2", error: reason.slice(0, 300), retryable },
    });
    return json({ ok: false, error: reason, retryable, ledger_error: ledgerErr?.message ?? eventErr?.message ?? null }, status);
  };

  if (!address.includes("@")) return await refuse("skipped: no_email", 422, null, false);
  // The SQL gate checked these seconds ago; checking again on the row we are about to mail costs nothing.
  if (app.email_consent_given !== true) return await refuse("skipped: no_email_consent", 409, null, false);
  if (app.do_not_contact_at) return await refuse("skipped: do_not_contact", 409, null, false);

  // The opt-out list decides the send, and an unreadable list stops it.
  const { data: optOut, error: optErr } = await sb
    .from("email_unsubscribes")
    .select("email")
    .eq("email", address)
    .limit(1);
  if (optErr) return json({ ok: false, error: `email_unsubscribes unreadable, nothing sent: ${optErr.message}` }, 503);
  if ((optOut ?? []).length > 0) return await refuse("skipped: unsubscribed", 409, null, false);

  // One accepted send per touch per application. dedupe_key is only PARTIALLY unique
  // (WHERE dedupe_key IS NOT NULL), so this is a limit(1) read, never maybeSingle.
  const dedupeKey = `${applicationId}:reactivation_v2:t${stage.touch}`;
  const { data: prior, error: priorErr } = await sb
    .from("next_step_messages")
    .select("id")
    .eq("dedupe_key", dedupeKey)
    .limit(1);
  if (priorErr) return json({ ok: false, error: `ledger unreadable, nothing sent: ${priorErr.message}` }, 503);
  if ((prior ?? []).length > 0) {
    return json({ ok: false, skipped: "already_sent", message_id: prior?.[0]?.id ?? null }, 409);
  }

  const firstName = normalizeName(app.first_name);
  const lastName = normalizeName(app.last_name);
  const statusUrl = statusPageUrl(applicationId);
  const base = bookingBaseFor(stage.track, {
    questions: SCHEDULING_LINKS.questions,
    licensing: SCHEDULING_LINKS.licensing,
    licensed: SCHEDULING_LINKS.licensed,
  });
  const term = `${stage.track}_t${stage.touch}_${stage.variant}`;
  const bookingUrl = base
    ? withCampaignUtm(buildBookingUrl(base, { applicationId, firstName, lastName, email: address }), term)
    : statusUrl;
  const unsubscribeUrl = `${SUPABASE_URL}/functions/v1/unsubscribe?u=${encodeURIComponent(address)}`;
  const vars: Record<string, string> = {
    first_name: firstName || "there",
    booking_url: bookingUrl,
    status_url: statusUrl,
    unsubscribe_url: unsubscribeUrl,
  };
  const subject = renderTemplate(subjectTemplateFor(String(tpl.email_subject_template ?? ""), firstName !== ""), vars, "plain");
  const html = renderTemplate(String(tpl.email_body_template ?? ""), vars, "html");
  const text = renderTemplate(String(tpl.candidate_message_template ?? ""), vars, "text");
  if (!subject.text || !html.text || !text.text || subject.missing.length || html.missing.length || text.missing.length) {
    // A broken template is a configuration fault for the whole track, not a reason to stop this
    // person: no receipt, so the claim goes stale and is held for review (doctor #70 shows held).
    return json({ ok: false, error: "template_invalid", missing: [...subject.missing, ...html.missing, ...text.missing] }, 500);
  }

  const resend = gateResend(new Resend(RESEND_KEY));
  const { data: sent, error: sendErr } = await resend.emails.send({
    from: BRAND_FROM,
    to: [address],
    reply_to: BRAND_REPLY_TO,
    subject: subject.text,
    html: html.text,
    text: text.text,
    headers: {
      "List-Unsubscribe": `<${unsubscribeUrl}>, <mailto:${BRAND_REPLY_TO}?subject=unsubscribe>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
    tags: [
      { name: "campaign", value: "reactivation_v2" },
      { name: "track", value: stage.track },
      { name: "touch", value: `t${stage.touch}` },
      { name: "variant", value: stage.variant },
    ],
  });

  if (sendErr || !sent?.id) {
    const reason = String(sendErr?.message ?? "provider returned no id");
    return await refuse(reason, 502, subject.text, isRetryable(reason));
  }

  const { data: msg, error: msgErr } = await sb
    .from("next_step_messages")
    .insert({
      application_id: applicationId,
      stage_key: stageKey,
      channel: "email",
      template_key: stageKey,
      recipient: address,
      subject: subject.text,
      body: html.text,
      sent_at: new Date().toISOString(),
      external_id: sent.id,
      dedupe_key: dedupeKey,
      metadata: {
        campaign: "reactivation_v2", track: stage.track, touch: stage.touch, variant: stage.variant,
        resend_id: sent.id, email_rung: "sent", sender: "reactivation-send",
      },
    })
    .select("id")
    .single();
  const { error: eventErr } = await sb.from("next_step_events").insert({
    application_id: applicationId,
    to_stage: stageKey,
    event_type: "message_sent",
    source: "cron",
    payload: { channel: "email", campaign: "reactivation_v2", resend_id: sent.id, message_id: msg?.id ?? null },
  });

  if (msgErr) {
    // The email is out and the receipt is not. Say so. The claim stays set, so the stale-claim
    // sweep HOLDS this person for review instead of letting a later tick mail them again.
    return json({ ok: false, sent: true, resend_id: sent.id, error: `sent_but_unrecorded: ${msgErr.message}` }, 500);
  }
  return json({ ok: true, resend_id: sent.id, message_id: msg?.id ?? null, event_error: eventErr?.message ?? null });
});
