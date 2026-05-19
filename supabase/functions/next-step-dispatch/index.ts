// next-step-dispatch — drains public.next_step_messages and delivers each via
// Telegram → SMS → Email fallback chain. Logs every attempt + each fallback
// links back to its parent via fallback_of_id, so the message history of a
// single nudge is fully auditable.
//
// Triggers:
//   - pg_cron every 5 min: POST {} to fan out queued msgs
//   - inline from server actions: POST {message_id: "..."} for a single dispatch
//   - manual: POST {dry_run: true} to preview without sending
//
// Channels: telegram (via telegram_scheduled_messages → existing Telegram worker)
//           sms (Twilio REST)
//           email (Resend)
// Order is determined by per-person preferences and which contact details exist.
//
// Deploy: 2026-05-19 v1

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { Resend } from "https://esm.sh/resend@2.0.0";

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
const RESEND_FROM = Deno.env.get("RESEND_FROM") ?? "Apex Financial <hello@apex-financial.org>";

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
const resend = new Resend(RESEND_KEY);

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

function render(tpl: string, ctx: Record<string, any>): string {
  return tpl.replace(/\{\{\s*([\w_\.]+)\s*\}\}/g, (_m, key) => {
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
  // drains it and ships via the Apex bot.
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

async function sendSms(to: string, body: string): Promise<string> {
  if (!TWILIO_SID || !TWILIO_TOKEN || !TWILIO_FROM) throw new Error("Twilio not configured");
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
  return j.sid;
}

async function sendEmail(to: string, subject: string, html: string): Promise<string> {
  if (!RESEND_KEY) throw new Error("Resend not configured");
  const r = await resend.emails.send({ from: RESEND_FROM, to, subject, html });
  if ((r as any).error) throw new Error((r as any).error.message);
  return (r as any).data?.id ?? "";
}

function smartPhone(phone: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D+/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (phone.startsWith("+")) return phone;
  return null;
}

async function dispatchOne(msg: any, dry: boolean) {
  const stage = await loadStage(msg.stage_key);
  if (!stage) throw new Error(`stage ${msg.stage_key} not found`);
  const person = await loadPerson(msg.application_id, msg.agent_id);
  if (!person) throw new Error("person not found");

  const ctx: Record<string, any> = {
    first_name: person.first_name ?? "there",
    last_name: person.last_name ?? "",
    next_action_url: stage.next_action_url ?? "",
    seminar_date: person.seminar_date ?? "",
    exam_date: person.exam_scheduled_at ?? "",
    phone: person.phone ?? "",
    days_in_stage: msg.metadata?.day ?? "",
  };
  const tgBody = render(stage.telegram_template || stage.candidate_message_template, ctx);
  const smsBody = render(stage.sms_template || stage.candidate_message_template, ctx);
  const emailSubject = render(stage.email_subject_template || stage.display_name, ctx);
  const emailBody = render(stage.email_body_template || stage.candidate_message_template, ctx);

  if (dry) {
    return { dry_run: true, person, telegram: tgBody, sms: smsBody, email_subject: emailSubject, email_body: emailBody };
  }

  // Mark the queued message as the parent
  const parent_id = msg.id;
  let delivered = false;
  let lastError: string | null = null;

  // Channel 1: Telegram
  if (!delivered && person.telegram_chat_id && !person.telegram_opt_out) {
    try {
      const tgId = await sendTelegram(person.telegram_chat_id, tgBody, stage.stage_key, msg.dedupe_key);
      await supabase.from("next_step_messages").update({
        sent_at: new Date().toISOString(),
        body: tgBody,
        recipient: String(person.telegram_chat_id),
        external_id: tgId ? String(tgId) : null,
        channel: "telegram",
      }).eq("id", parent_id);
      delivered = true;
    } catch (e: any) {
      lastError = `telegram: ${e?.message ?? e}`;
    }
  }

  // Channel 2: SMS
  if (!delivered) {
    const to = smartPhone(person.phone);
    if (to) {
      try {
        const sid = await sendSms(to, smsBody);
        if (msg.channel !== "telegram") {
          // upgrade the queued parent
          await supabase.from("next_step_messages").update({
            sent_at: new Date().toISOString(),
            body: smsBody,
            recipient: to,
            external_id: sid,
            channel: "sms",
          }).eq("id", parent_id);
        } else {
          await logMessage({
            application_id: msg.application_id,
            agent_id: msg.agent_id,
            stage_key: stage.stage_key,
            channel: "sms",
            template_key: msg.template_key,
            recipient: to,
            body: smsBody,
            sent_at: new Date().toISOString(),
            external_id: sid,
            fallback_of_id: parent_id,
          });
        }
        delivered = true;
      } catch (e: any) {
        lastError = `sms: ${e?.message ?? e}`;
      }
    }
  }

  // Channel 3: Email
  if (!delivered && person.email) {
    try {
      const eid = await sendEmail(person.email, emailSubject, emailBody);
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
      });
      await supabase.from("next_step_messages").update({
        sent_at: new Date().toISOString(),
        failed_at: null,
      }).eq("id", parent_id);
      delivered = true;
    } catch (e: any) {
      lastError = `email: ${e?.message ?? e}`;
    }
  }

  if (!delivered) {
    await supabase.from("next_step_messages").update({
      failed_at: new Date().toISOString(),
      error: lastError ?? "no contact channel",
    }).eq("id", parent_id);
    return { ok: false, error: lastError ?? "no contact channel" };
  }

  // Log event
  await supabase.from("next_step_events").insert({
    application_id: msg.application_id,
    agent_id: msg.agent_id,
    to_stage: stage.stage_key,
    event_type: "message_sent",
    source: "cron",
    payload: { template_key: msg.template_key, parent_message_id: parent_id },
  });

  return { ok: true, parent_id, channel: delivered ? (await supabase.from("next_step_messages").select("channel").eq("id", parent_id).single()).data?.channel : null };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const dry = !!body.dry_run;
    const limit = Math.max(1, Math.min(200, body.limit ?? 50));
    let q = supabase.from("next_step_messages")
      .select("*")
      .is("sent_at", null)
      .is("failed_at", null)
      .order("created_at", { ascending: true })
      .limit(limit);
    if (body.message_id) {
      q = supabase.from("next_step_messages").select("*").eq("id", body.message_id).limit(1);
    }
    const { data: queue, error } = await q;
    if (error) throw error;
    const results: any[] = [];
    for (const msg of queue ?? []) {
      try { results.push(await dispatchOne(msg, dry)); }
      catch (e: any) { results.push({ id: msg.id, error: e?.message ?? String(e) }); }
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
