// telegram-drain — cloud-native nudge drainer.
//
// Drains pending rows from telegram_scheduled_messages by rendering each
// template and sending via the Telegram Bot API. Idempotent: each row's
// status is flipped to 'sent' (with sent_at) or 'failed' (with last_error)
// after attempted delivery. Runs on Supabase cron every 5 minutes via
// pg_cron + pg_net — no laptop dependency.
//
// The local launchd daemon (~/business-ops/telegram-bot/scripts/nudge-runner.py)
// keeps running as a backup/dev tool; it uses the same dedupe + ON CONFLICT
// guards so concurrent runs are safe.
//
// Env required:
//   APEX_TELEGRAM_BOT_TOKEN
//   APEX_DRAIN_SHARED_SECRET — verifies pg_cron is the caller (defense)
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BOT_TOKEN = Deno.env.get("APEX_TELEGRAM_BOT_TOKEN") ?? "";
const SHARED_SECRET = Deno.env.get("APEX_DRAIN_SHARED_SECRET") ?? "";

const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-apex-drain-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

async function render(key: string, ctx: Record<string, unknown>) {
  const { data } = await sb.from("telegram_templates")
    .select("body, parse_mode, buttons")
    .eq("key", key)
    .eq("active", true)
    .maybeSingle();
  if (!data) return null;
  let body = data.body as string;
  for (const [k, v] of Object.entries(ctx ?? {})) {
    body = body.replaceAll(`{${k}}`, String(v ?? ""));
  }
  body = body.replace(/\{[a-zA-Z0-9_]+\}/g, "");
  return { body, parse_mode: (data.parse_mode as string) ?? "HTML", buttons: data.buttons };
}

async function tgSend(chat_id: number, text: string, parse_mode: string, reply_markup: any) {
  const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id, text, parse_mode,
      reply_markup,
      disable_web_page_preview: true,
    }),
  });
  if (!r.ok) {
    const errText = await r.text();
    throw new Error(`tg ${r.status}: ${errText.slice(0, 300)}`);
  }
  return true;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Authn: shared secret OR service_role JWT (pg_cron's net.http_post uses the latter)
  const headerSecret = req.headers.get("x-apex-drain-secret") ?? "";
  const authzOk = SHARED_SECRET === "" || headerSecret === SHARED_SECRET ||
    (req.headers.get("authorization") ?? "").includes(SUPABASE_KEY.slice(0, 20));
  if (!authzOk) {
    return new Response(JSON.stringify({ ok: false, error: "forbidden" }), {
      status: 403,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }

  if (!BOT_TOKEN) {
    return new Response(JSON.stringify({ ok: true, skipped: "no_bot_token" }), {
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }

  // First, advance stages based on applications/agents state (idempotent fn).
  // Errors here shouldn't block the drain — they get logged and we proceed.
  try {
    await sb.rpc("telegram_sync_stages");
  } catch (e) {
    console.error("telegram_sync_stages error", e);
  }

  // Pull due rows (up to 50 per tick to stay under fn timeout).
  const { data: due, error } = await sb.rpc("telegram_due_nudges", { now_ts: new Date().toISOString(), limit_n: 50 });
  if (error) {
    console.error("telegram_due_nudges error", error);
    return new Response(JSON.stringify({ ok: false, error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }

  let sent = 0;
  let failed = 0;
  let skipped = 0;
  for (const row of (due as any[]) ?? []) {
    const tpl = await render(row.template_key, row.context ?? {});
    if (!tpl) {
      await sb.from("telegram_scheduled_messages")
        .update({ status: "failed", last_error: "template_missing", attempt_count: (row.attempt_count ?? 0) + 1 })
        .eq("id", row.id);
      skipped += 1;
      continue;
    }
    try {
      await tgSend(row.chat_id, tpl.body, tpl.parse_mode, tpl.buttons);
      await sb.from("telegram_scheduled_messages")
        .update({ status: "sent", sent_at: new Date().toISOString(), attempt_count: (row.attempt_count ?? 0) + 1 })
        .eq("id", row.id);
      await sb.from("telegram_messages").insert({
        chat_id: row.chat_id,
        direction: "outbound",
        message_type: "scheduled",
        text: tpl.body,
        template_key: row.template_key,
        context: row.context ?? {},
      });
      const isNudge = String(row.template_key).startsWith("nudge.");
      await sb.from("telegram_users")
        .update({
          last_nudge_at: new Date().toISOString(),
          ...(isNudge ? { inactivity_nudge_sent_at: new Date().toISOString() } : {}),
        })
        .eq("chat_id", row.chat_id);
      sent += 1;
    } catch (e: any) {
      const errMsg = String(e?.message ?? e).slice(0, 500);
      const nextAttempt = (row.attempt_count ?? 0) + 1;
      await sb.from("telegram_scheduled_messages")
        .update({
          status: nextAttempt >= 3 ? "failed" : "pending",
          attempt_count: nextAttempt,
          last_error: errMsg,
        })
        .eq("id", row.id);
      failed += 1;
    }
  }

  return new Response(JSON.stringify({
    ok: true,
    checked: (due as any[])?.length ?? 0,
    sent, failed, skipped,
    at: new Date().toISOString(),
  }), { headers: { ...corsHeaders, "content-type": "application/json" } });
});
