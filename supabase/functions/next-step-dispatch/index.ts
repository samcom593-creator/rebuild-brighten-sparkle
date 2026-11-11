// next-step-dispatch — drains public.next_step_messages and delivers each via
// Telegram → SMS → Email fallback chain. Logs every attempt + each fallback
// links back to its parent via fallback_of_id, so the message history of a
// single nudge is fully auditable.
//
// Triggers:
//   - trg_next_step_messages_auto_dispatch (AFTER INSERT): POST {message_id}
//     with the anon key, one call per queued row.
//   - fn_next_step_retry_drain (pg_cron 'next_step_retry_drain', every 5 min,
//     MP-ONBOARD-ANCHOR-PKG1): POST {message_id} with the anon key for rows this
//     function left retryable (transient provider error) or deferred (daily cap).
//   - fan-out: POST {} / {limit}, staff or service role only (see below)
//   - preview: POST {dry_run: true}, staff or service role only
//
// PL-WIB-NEXT-STEP-RESEND (2026-10-23). The SMS fallback for a telegram row
// logged a child row and never stamped the parent, so the parent read as
// queued forever. 2,051 of 2,067 "pending" rows had a sent SMS child. The
// fan-out path took the oldest pending rows first and was public
// (verify_jwt=false, no gate), so any bare POST re-sent texts people had
// already received months earlier. That happened twice: 2026-08-23 03:57Z
// (50 people) and 2026-10-23 05:43Z (39 people, a boot probe). Now:
//   1. a row with a verified sent child is delivered and is never sent again;
//   2. nothing older than MAX_QUEUE_AGE_HOURS is ever selected (a deferred or
//      retryable row: MAX_DEFERRED_AGE_HOURS), on either path;
//   3. fan-out and dry_run (which returns the person's email and phone)
//      require a staff JWT or the service key. The message_id path stays open
//      because the trigger posts with the anon key.
//
// Channels: telegram (via telegram_scheduled_messages → existing Telegram worker)
//           sms (Twilio REST when configured, else carrier email-to-text gateway)
//           email (Resend)
//
// WP4 (2026-11-10): what ends the ladder is decided in ladder.ts.
//
// MP-ONBOARD-ANCHOR-PKG1 (2026-11-12), message_map_and_copy.md section 4c:
//   F1/F2  only a provider receipt is "sent". A Telegram enqueue or a gateway SMS no
//          longer stamps the parent; the email rung always runs after them, and the
//          parent's sent_at is the email's (or a Twilio SID's). Best-effort rungs are
//          recorded in metadata.best_effort.
//   F3     a transient provider error (429, 5xx, network) leaves the row retryable
//          (metadata.retry + metadata.not_before); the drain retries it, 3 attempts max.
//   C8/F12 before anything is sent, public.fn_next_step_send_gate decides: open
//          agent_access_suspensions, unsubscribed, Resend-suppressed, and for applicant
//          rows bounced / do-not-contact / duplicate / closed / already an agent, or a
//          cadence step whose stage moved on. A skip is recorded on the row as
//          failed_at + "skipped: <reason>", never as a sent.
//   5d     at most one automated next-step email per recipient per local day: the gate
//          defers (metadata.not_before = next day 08:00 local), it never drops.
//   step copy comes from next_step_step_copy through the gate (per cadence step, and a
//          'rearm' variant after a missed call); the stage template is the fallback.
//   the dead "reply STOP" mailto is stripped from every rendered body (footer.ts).
//
// Deploy: 2026-05-19 v1

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { Resend } from "https://esm.sh/resend@2.0.0";
import { gateResend } from "../_shared/resend-gate.ts";
import { escapeLikePattern } from "../_shared/like-escape.ts";
import { requireSendAuth } from "../_shared/require-send-auth.ts";
import { BRAND_FROM, BRAND_REPLY_TO } from "../_shared/email.ts";
import { isTerminalSmsReceipt, runLadder } from "./ladder.ts";
import { classifyEmailError, EmailSendError, planRetry } from "./retry.ts";
import { hasEmptyHref, stripDeadReplyStop } from "./footer.ts";
import { rebookUrl } from "./rebook.ts";

// The trigger dispatches a row seconds after insert, and the nudge sweep never
// evaluates a step older than 20h (20261016210500_next_step_quiet_hours.sql).
// A queued row older than this is a missed send, and a late one is worse than
// none: "Welcome, step 1" four months after the person moved on.
const MAX_QUEUE_AGE_HOURS = 24;
// A row this function deferred (daily cap) or left retryable carries metadata.not_before
// and may wait until the next local morning; fn_next_step_claim enforces the same 72h.
const MAX_DEFERRED_AGE_HOURS = 72;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TWILIO_SID = Deno.env.get("TWILIO_ACCOUNT_SID") ?? "";
const TWILIO_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN") ?? "";
const TWILIO_FROM = Deno.env.get("TWILIO_MESSAGING_SID") ?? Deno.env.get("TWILIO_FROM") ?? "";
const RESEND_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
// WP4: one recruit-facing sender identity (_shared/email.ts). This used to be
// "Galaxy Financial <hello@...>" with no Reply-To, so a recruit's reply to a
// stage reminder went to an address nobody was shown to read.
const RESEND_FROM = Deno.env.get("RESEND_FROM") ?? BRAND_FROM;

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
const resend = gateResend(new Resend(RESEND_KEY));

type Stage = {
  stage_key: string;
  display_name: string;
  next_action_label: string;
  next_action_url: string | null;
  candidate_message_template: string;
  manager_alert_template: string;
  telegram_template: string;
  sms_template: string;
  email_subject_template: string;
  email_body_template: string;
};

type Person = {
  kind: "applicant" | "agent";
  application_id: string | null;
  agent_id: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  telegram_chat_id: number | null;
  telegram_opt_out: boolean;
  hiring_manager_user_id: string | null;
  seminar_date: string | null;
  exam_scheduled_at: string | null;
  days_in_stage: number;
};

/** What public.fn_next_step_send_gate answers for one queued row. */
type GateVerdict = {
  action: "send" | "skip" | "defer";
  reason?: string | null;
  not_before?: string | null;
  zone?: string | null;
  copy?: { subject?: string | null; body?: string | null; key?: string | null } | null;
  license_status?: string | null;
  call_track?: string | null;
};

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

function render(tpl: string, ctx: Record<string, any>): string {
  return tpl.replace(/\{\{\s*([\w_.]+)\s*\}\}/g, (_m, key) => {
    const v = ctx[key];
    return v === null || v === undefined ? "" : String(v);
  });
}

async function loadStage(stage_key: string): Promise<Stage | null> {
  const { data } = await supabase
    .from("next_step_stages")
    .select("*")
    .eq("stage_key", stage_key)
    .maybeSingle();
  return (data as Stage) ?? null;
}

async function loadPerson(application_id: string | null, agent_id: string | null): Promise<Person | null> {
  if (application_id) {
    const { data } = await supabase
      .from("applications")
      .select("id, first_name, last_name, email, phone, telegram_chat_id, telegram_opt_out, hiring_manager_user_id, seminar_date, exam_scheduled_at, created_at")
      .eq("id", application_id)
      .maybeSingle();
    if (!data) return null;
    return {
      kind: "applicant",
      application_id,
      agent_id: null,
      first_name: data.first_name,
      last_name: data.last_name,
      email: data.email,
      phone: data.phone,
      telegram_chat_id: data.telegram_chat_id,
      telegram_opt_out: !!data.telegram_opt_out,
      hiring_manager_user_id: data.hiring_manager_user_id ?? null,
      seminar_date: data.seminar_date ?? null,
      exam_scheduled_at: data.exam_scheduled_at ?? null,
      days_in_stage: 0,
    };
  }
  if (agent_id) {
    const { data: g } = await supabase
      .from("agents")
      .select("id, user_id, display_name, telegram_chat_id, telegram_opt_out, manager_id, created_at")
      .eq("id", agent_id)
      .maybeSingle();
    if (!g) return null;
    let email: string | null = null;
    let phone: string | null = null;
    let first_name: string | null = null;
    let last_name: string | null = null;
    if (g.user_id) {
      const { data: p } = await supabase
        .from("profiles")
        .select("full_name, email, phone")
        .eq("user_id", g.user_id)
        .maybeSingle();
      if (p) {
        email = p.email;
        phone = p.phone;
        const parts = (p.full_name || g.display_name || "").trim().split(/\s+/);
        first_name = parts[0] ?? null;
        last_name = parts.slice(1).join(" ") || null;
      }
    }
    if (!first_name && g.display_name) {
      const parts = g.display_name.trim().split(/\s+/);
      first_name = parts[0] ?? null;
      last_name = parts.slice(1).join(" ") || null;
    }
    // Fallback contact-info recovery: when profiles is empty (Sam-imported
    // agents often skip the profile row), look up agentlink_agents by name.
    if (!email || !phone) {
      const fn = (first_name ?? "").trim();
      const ln = (last_name ?? "").trim();
      if (fn) {
        const { data: ag } = await supabase
          .from("agentlink_agents")
          .select("email, contact_email, phone_number")
          .ilike("first_name", escapeLikePattern(fn))
          .ilike("last_name", ln ? escapeLikePattern(ln) : "%")
          .limit(1)
          .maybeSingle();
        if (ag) {
          if (!email) email = (ag as any).email ?? (ag as any).contact_email ?? null;
          if (!phone && (ag as any).phone_number) {
            phone = String((ag as any).phone_number).replace(/\D+/g, "");
          }
        }
      }
    }
    return {
      kind: "agent",
      application_id: null,
      agent_id,
      first_name,
      last_name,
      email,
      phone,
      telegram_chat_id: g.telegram_chat_id,
      telegram_opt_out: !!g.telegram_opt_out,
      hiring_manager_user_id: g.manager_id ?? null,
      seminar_date: null,
      exam_scheduled_at: null,
      days_in_stage: 0,
    };
  }
  return null;
}

async function logMessage(row: any) {
  const { data, error } = await supabase.from("next_step_messages").insert(row).select("id").single();
  if (error) console.error("logMessage insert error", error);
  return (data as any)?.id ?? null;
}

async function sendTelegram(chat_id: number, body: string, stage_key: string, dedupe: string | null) {
  // Use the existing telegram_scheduled_messages queue. The Telegram worker
  // drains it and ships via the Apex bot. A queue row is NOT a delivery
  // (MP-ONBOARD-ANCHOR-PKG1, F1): the caller records it as best effort.
  const { data, error } = await supabase
    .from("telegram_scheduled_messages")
    .insert({
      chat_id,
      template_key: `next_step:${stage_key}`,
      context: { body, source: "next-step-dispatch" },
      scheduled_at: new Date().toISOString(),
      status: "pending",
      dedupe_key: dedupe,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data?.id ?? null;
}

async function sendSms(to: string, body: string, application_id: string | null): Promise<string> {
  // Try direct Twilio first if configured; otherwise fall through to the
  // existing send-sms-auto-detect edge fn which fans out to carrier email
  // gateways (att/verizon/tmobile/sprint/uscellular/cricket/metro/boost).
  // Apex doesn't currently have direct Twilio so the gateway path is the
  // real SMS surface — keep both supported so adding Twilio later just
  // takes setting the env vars.
  if (TWILIO_SID && TWILIO_TOKEN && TWILIO_FROM) {
    const fromKey = TWILIO_FROM.startsWith("MG") ? "MessagingServiceSid" : "From";
    const params = new URLSearchParams({ To: to, Body: body, [fromKey]: TWILIO_FROM });
    const auth = btoa(`${TWILIO_SID}:${TWILIO_TOKEN}`);
    const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`, {
      method: "POST",
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.message || `twilio ${r.status}`);
    return `twilio:${j.sid}`;
  }
  // Carrier email gateway fallback via the existing edge fn.
  const r = await fetch(`${SUPABASE_URL}/functions/v1/send-sms-auto-detect`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ phone: to, message: body.substring(0, 160), applicationId: application_id }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || (j as any).error) {
    throw new Error((j as any).error ?? `send-sms-auto-detect ${r.status}`);
  }
  // MP-417: HTTP 200 is not delivery. send-sms-auto-detect answers 200 with
  // `outcome: "skipped"` when no carrier is on file and it sent NOTHING, and
  // 200 with `outcome: "failed"` when the gateway rejected it. Both used to
  // return a `gateway:` receipt here, which stamped next_step_messages.sent_at
  // AND set delivered = true in the caller, so the email fallback below never
  // ran for the one person the SMS could not reach. 14 receipts were written
  // that way between 2026-08-12 and 2026-09-03. Only "sent" is a send; every
  // other outcome throws so the ladder falls through to the next channel.
  const outcome = (j as any).outcome;
  if (outcome !== "sent") {
    throw new Error(
      `send-sms-auto-detect outcome=${outcome ?? "unknown"}` +
      (outcome === "skipped" ? " (no carrier on file — nothing was sent)" : ""),
    );
  }
  return `gateway:${(j as any).carrierSelected ?? "broadcast"}`;
}

// Resolves to the Resend message id; anything else throws an EmailSendError that carries
// the provider's error name and HTTP status, so retry.ts can tell 429/5xx from a refusal.
async function sendEmail(to: string, subject: string, html: string): Promise<string> {
  if (!RESEND_KEY) throw new EmailSendError("Resend not configured", { name: "missing_api_key" });
  let r: any;
  try {
    r = await resend.emails.send({ from: RESEND_FROM, to, subject, html, reply_to: BRAND_REPLY_TO });
  } catch (e) {
    throw new EmailSendError((e as Error)?.message ?? String(e), { name: "network_error", transient: true });
  }
  const err = r?.error;
  if (err) {
    throw new EmailSendError(err.message ?? String(err), { name: err.name ?? null, statusCode: err.statusCode ?? null });
  }
  const id = r?.data?.id;
  if (!id) throw new EmailSendError("provider accepted the send without a message id", { name: "no_receipt" });
  return String(id);
}

function smartPhone(phone: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D+/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (phone.startsWith("+")) return phone;
  return null;
}

// A parent whose delivery already happened is delivered. Only a VERIFIED child counts:
// an email child with a Resend id, or a Twilio SID. A gateway SMS child is best effort
// and must not close the row (MP-ONBOARD-ANCHOR-PKG1, F2): if it did, a retry after a
// transient email failure would mark the reminder delivered without sending the email.
async function sentFallbackChild(parentId: string): Promise<{ id: string; sent_at: string } | null> {
  const { data, error } = await supabase
    .from("next_step_messages")
    .select("id, sent_at, channel, external_id")
    .eq("fallback_of_id", parentId)
    .not("sent_at", "is", null)
    .order("sent_at", { ascending: true })
    .limit(10);
  // Could not look: refuse to send rather than risk a second copy.
  if (error) throw new Error(`fallback lookup failed: ${error.message}`);
  const verified = (data ?? []).find((c: any) =>
    (c.channel === "email" && typeof c.external_id === "string" && c.external_id.length > 0) ||
    (c.channel === "sms" && isTerminalSmsReceipt(c.external_id))
  );
  return verified ? { id: (verified as any).id, sent_at: (verified as any).sent_at } : null;
}

/** metadata without the claim marker, plus the patch. */
function metaWith(msg: Row, patch: Record<string, unknown>): Record<string, unknown> {
  const base = { ...(msg.metadata ?? {}) } as Record<string, unknown>;
  delete base.claimed_at;
  return { ...base, ...patch };
}

// Atomic claim (fn_next_step_claim): a row is processed by one invocation at a time, only
// while unsent/unfailed, only inside its age limit, and not before its not_before.
async function claim(messageId: string): Promise<Row | null> {
  const { data, error } = await supabase.rpc("fn_next_step_claim", { p_message_id: messageId });
  if (!error) return (data as Row | null) ?? null;
  // The claim function is missing (migration not applied yet): fall back to the
  // pre-PKG1 selection so a fresh reminder is not lost in the deploy window.
  console.error("[claim] fn_next_step_claim failed, legacy select:", error.message);
  const notBefore = new Date(Date.now() - MAX_QUEUE_AGE_HOURS * 3600_000).toISOString();
  const { data: rows, error: selErr } = await supabase.from("next_step_messages").select("*")
    .eq("id", messageId)
    .is("sent_at", null)
    .is("failed_at", null)
    .is("fallback_of_id", null)
    .gte("created_at", notBefore)
    .limit(1);
  if (selErr) throw selErr;
  return (rows?.[0] as Row) ?? null;
}

async function gateFor(msg: Row, email: string | null): Promise<{ verdict: GateVerdict | null; error: string | null }> {
  const { data, error } = await supabase.rpc("fn_next_step_send_gate", {
    p_message_id: msg.id,
    p_email: email ?? null,
  });
  if (error) return { verdict: null, error: error.message };
  const v = data as GateVerdict | null;
  if (!v || !v.action) return { verdict: null, error: "gate returned no verdict" };
  return { verdict: v, error: null };
}

async function scheduleRetry(msg: Row, reason: string, extra: Record<string, unknown> = {}) {
  const prev = (msg.metadata?.retry ?? {}) as Record<string, unknown>;
  const plan = planRetry(Number(prev.attempts ?? 0));
  const nowIso = new Date().toISOString();
  const retry = {
    attempts: plan.attempts,
    first_at: (prev.first_at as string) ?? nowIso,
    last_at: nowIso,
    last_error: reason.slice(0, 300),
  };
  if (plan.giveUp) {
    await supabase.from("next_step_messages").update({
      failed_at: nowIso,
      error: `gave up after ${plan.attempts} attempts: ${reason}`.slice(0, 500),
      metadata: metaWith(msg, { ...extra, retry }),
    }).eq("id", msg.id);
    return { ok: false, id: msg.id, gave_up: true, attempts: plan.attempts, error: reason };
  }
  await supabase.from("next_step_messages").update({
    metadata: metaWith(msg, { ...extra, retry, not_before: plan.notBefore }),
  }).eq("id", msg.id);
  return { ok: false, id: msg.id, retry_scheduled: true, attempts: plan.attempts, not_before: plan.notBefore, error: reason };
}

async function dispatchOne(msg: Row, dry: boolean) {
  const child = await sentFallbackChild(msg.id);
  if (child) {
    if (!dry) {
      await supabase.from("next_step_messages").update({ sent_at: child.sent_at, metadata: metaWith(msg, {}) })
        .eq("id", msg.id).is("sent_at", null);
    }
    return { ok: true, skipped: true, reason: "already_delivered_by_fallback", id: msg.id, child_id: child.id };
  }
  const stage = await loadStage(msg.stage_key);
  if (!stage) throw new Error(`stage ${msg.stage_key} not found`);
  const person = await loadPerson(msg.application_id, msg.agent_id);
  if (!person) throw new Error("person not found");

  // One place decides whether this person may be messaged now (read-only).
  const gate = await gateFor(msg, person.email);
  const verdict = gate.verdict;

  const ctx: Record<string, any> = {
    first_name: person.first_name ?? "there",
    last_name: person.last_name ?? "",
    next_action_url: stage.next_action_url ?? "",
    seminar_date: person.seminar_date ?? "",
    exam_date: person.exam_scheduled_at ?? "",
    phone: person.phone ?? "",
    email: encodeURIComponent(person.email ?? ""),
    application_id: msg.application_id ?? "",
    agent_id: msg.agent_id ?? "",
    days_in_stage: msg.metadata?.day ?? "",
  };
  // Post-call message: "pick a new time" is the call this person booked.
  if (stage.stage_key === "call_booked" && msg.application_id) {
    ctx.next_action_url = rebookUrl({
      callTrack: verdict?.call_track ?? null,
      licenseStatus: verdict?.license_status ?? null,
      applicationId: msg.application_id,
      firstName: person.first_name,
      lastName: person.last_name,
      email: person.email,
    });
  }
  const step = verdict?.copy ?? null;
  const tgBody = render(stage.telegram_template || stage.candidate_message_template, ctx);
  const smsBody = render(stage.sms_template || stage.candidate_message_template, ctx);
  const emailSubject = render(step?.subject || stage.email_subject_template || stage.display_name, ctx);
  const emailBody = stripDeadReplyStop(
    render(step?.body || stage.email_body_template || stage.candidate_message_template, ctx),
  );

  if (dry) {
    return {
      dry_run: true,
      id: msg.id,
      stage_key: stage.stage_key,
      step: msg.metadata?.step ?? null,
      variant: msg.metadata?.variant ?? null,
      first_name: person.first_name,
      gate: verdict ?? { error: gate.error },
      person,
      telegram: tgBody,
      sms: smsBody,
      email_subject: emailSubject,
      email_body: emailBody,
    };
  }

  // The gate could not answer: never send blind. Transient, so the drain retries.
  if (!verdict) {
    return await scheduleRetry(msg, `send_gate_unavailable: ${gate.error}`);
  }
  if (verdict.action === "skip") {
    await supabase.from("next_step_messages").update({
      failed_at: new Date().toISOString(),
      error: `skipped: ${verdict.reason ?? "gate"}`,
      metadata: metaWith(msg, { skip_reason: verdict.reason ?? "gate" }),
    }).eq("id", msg.id);
    return { ok: false, skipped: true, reason: verdict.reason, id: msg.id };
  }
  if (verdict.action === "defer") {
    await supabase.from("next_step_messages").update({
      metadata: metaWith(msg, {
        not_before: verdict.not_before,
        deferred: { reason: verdict.reason ?? "deferred", at: new Date().toISOString(), zone: verdict.zone ?? null },
      }),
    }).eq("id", msg.id);
    return { ok: false, deferred: true, reason: verdict.reason, not_before: verdict.not_before, id: msg.id };
  }
  // A link that renders blank is a broken email, not a reminder.
  if (person.email && hasEmptyHref(emailBody)) {
    await supabase.from("next_step_messages").update({
      failed_at: new Date().toISOString(),
      error: "skipped: template rendered an empty link",
      metadata: metaWith(msg, { skip_reason: "empty_link" }),
    }).eq("id", msg.id);
    return { ok: false, skipped: true, reason: "empty_link", id: msg.id };
  }

  const parent_id = msg.id;
  const smsTo = smartPhone(person.phone);
  // A retry re-runs only the email rung: the best-effort rungs already went out once.
  const isRetry = !!msg.metadata?.retry;
  const bestEffort: Record<string, unknown> = { ...(msg.metadata?.best_effort ?? {}) };

  const ladder = await runLadder({
    // Channel 1: Telegram (best effort: a queue row, not a delivery)
    telegram: !isRetry && person.telegram_chat_id && !person.telegram_opt_out
      ? async () => {
        const tgId = await sendTelegram(person.telegram_chat_id as number, tgBody, stage.stage_key, msg.dedupe_key);
        bestEffort.telegram = { queue_id: tgId ? String(tgId) : null, chat: String(person.telegram_chat_id), at: new Date().toISOString() };
        return tgId;
      }
      : null,
    // Channel 2: SMS. A Twilio SID is a delivery; a carrier-gateway receipt is best effort.
    sms: !isRetry && smsTo
      ? async () => {
        const sid = await sendSms(smsTo, smsBody, msg.application_id);
        if (isTerminalSmsReceipt(sid)) {
          await supabase.from("next_step_messages").update({
            sent_at: new Date().toISOString(),
            body: smsBody,
            recipient: smsTo,
            external_id: sid,
            channel: "sms",
            failed_at: null,
          }).eq("id", parent_id);
        } else {
          // Logged with its gateway receipt (v_sms_receipt_truth adjudicates these); the
          // parent stays unsent until a verified rung lands.
          await logMessage({
            application_id: msg.application_id,
            agent_id: msg.agent_id,
            stage_key: stage.stage_key,
            channel: "sms",
            template_key: msg.template_key,
            recipient: smsTo,
            body: smsBody,
            sent_at: new Date().toISOString(),
            external_id: sid,
            fallback_of_id: parent_id,
            metadata: { best_effort: true },
          });
          bestEffort.sms = { receipt: sid, at: new Date().toISOString() };
        }
        return sid;
      }
      : null,
    // Channel 3: Email (Resend id = the receipt)
    email: person.email
      ? async () => {
        const eid = await sendEmail(person.email as string, emailSubject, emailBody);
        await logMessage({
          application_id: msg.application_id,
          agent_id: msg.agent_id,
          stage_key: stage.stage_key,
          channel: "email",
          template_key: msg.template_key,
          recipient: person.email,
          body: emailBody,
          subject: emailSubject,
          sent_at: new Date().toISOString(),
          external_id: eid,
          fallback_of_id: parent_id,
          metadata: { reply_to: BRAND_REPLY_TO, step_copy: step?.key ?? null },
        });
        await supabase.from("next_step_messages").update({
          sent_at: new Date().toISOString(),
          failed_at: null,
        }).eq("id", parent_id).is("sent_at", null);
        return eid;
      }
      : null,
  });

  const lastError = ladder.errors.length ? ladder.errors.join("; ") : null;
  const rungMeta: Record<string, unknown> = {
    email_rung: ladder.emailRung,
    ...(Object.keys(bestEffort).length ? { best_effort: bestEffort } : {}),
    ...(ladder.smsBestEffort ? { sms_best_effort: true } : {}),
    ...(step?.key ? { step_copy: step.key } : {}),
  };

  if (ladder.anySent) {
    const done = metaWith(msg, rungMeta);
    delete done.not_before; // delivered: nothing is due any more
    await supabase.from("next_step_messages").update({ metadata: done }).eq("id", parent_id);
    await supabase.from("next_step_events").insert({
      application_id: msg.application_id,
      agent_id: msg.agent_id,
      to_stage: stage.stage_key,
      event_type: "message_sent",
      source: "cron",
      payload: { template_key: msg.template_key, parent_message_id: parent_id },
    });
    return {
      ok: true,
      parent_id,
      channel: ladder.terminal,
      email_rung: ladder.emailRung,
      ...(lastError ? { warnings: lastError } : {}),
    };
  }

  if (ladder.emailRung === "failed") {
    const cls = classifyEmailError(ladder.emailError);
    if (cls.transient) {
      return await scheduleRetry(msg, cls.message, rungMeta);
    }
    await supabase.from("next_step_messages").update({
      failed_at: new Date().toISOString(),
      error: `email failed: ${cls.message}`.slice(0, 500),
      metadata: metaWith(msg, { ...rungMeta, email_error: cls.message }),
    }).eq("id", parent_id);
    return { ok: false, id: parent_id, error: cls.message, email_rung: "failed" };
  }

  // No email on file. A best-effort rung may have gone out, but nothing is verifiable,
  // so the row is not "sent" (F1/F2).
  const why = ladder.bestEffortOnly
    ? "unverified: only a best-effort channel went out (telegram queue / gateway sms) and no email is on file"
    : (lastError ?? "no contact channel");
  await supabase.from("next_step_messages").update({
    failed_at: new Date().toISOString(),
    error: why.slice(0, 500),
    metadata: metaWith(msg, rungMeta),
  }).eq("id", parent_id);
  return { ok: false, id: parent_id, error: why };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const dry = !!body.dry_run;
    const single = typeof body.message_id === "string" && body.message_id.length > 0;
    if (dry || !single) {
      const auth = await requireSendAuth(req, { floor: "staff" });
      if (!auth.ok) {
        return new Response(JSON.stringify({ ok: false, error: auth.error ?? "unauthorized" }), {
          status: auth.status,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }
    const limit = Math.max(1, Math.min(200, body.limit ?? 50));
    const notBefore = new Date(Date.now() - MAX_QUEUE_AGE_HOURS * 3600_000).toISOString();
    const deferredFloor = new Date(Date.now() - MAX_DEFERRED_AGE_HOURS * 3600_000).toISOString();
    const results: any[] = [];

    if (single && !dry) {
      // The trigger and the drain post one id. The claim decides whether it is ours to send.
      const msg = await claim(body.message_id);
      if (!msg) {
        results.push({ id: body.message_id, skipped: true, reason: "not_claimable" });
      } else {
        try { results.push(await dispatchOne(msg, false)); }
        catch (e: any) {
          // Unexpected throw after the claim: release the row for the drain instead of
          // leaving it claimed and unsent.
          results.push(await scheduleRetry(msg, `dispatch_error: ${e?.message ?? String(e)}`).catch(() => ({ id: msg.id, error: e?.message ?? String(e) })));
        }
      }
    } else {
      let q = supabase.from("next_step_messages")
        .select("*")
        .is("sent_at", null)
        .is("failed_at", null)
        .is("fallback_of_id", null)
        .gte("created_at", single ? deferredFloor : notBefore)
        .order("created_at", { ascending: true })
        .limit(limit);
      if (single) q = q.eq("id", body.message_id);
      const { data: queue, error } = await q;
      if (error) throw error;
      for (const row of queue ?? []) {
        try {
          if (dry) { results.push(await dispatchOne(row, true)); continue; }
          const msg = await claim(row.id);
          if (!msg) { results.push({ id: row.id, skipped: true, reason: "not_claimable" }); continue; }
          results.push(await dispatchOne(msg, false));
        } catch (e: any) { results.push({ id: row.id, error: e?.message ?? String(e) }); }
      }
    }
    return new Response(JSON.stringify({ ok: true, processed: results.length, dry, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ ok: false, error: e?.message ?? String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
