// Move 2: Poke pusher — drains poke_queue rows that haven't been sent yet.
// Posts to Poke API if POKE_TOKEN env present; otherwise records the would-be
// outbound and exits successfully. Designed to run via pg_cron every 5 min.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
// 2026-08-17: bumped off supabase-js@2.50.0 — esm.sh resolves transitive deps at
// request time, so that pin pinned nothing underneath it and now fails to resolve
// ws's optional native deps (bufferutil / utf-8-validate). The function died at
// BOOT, before the handler, so every call 500d and nothing recorded a reason.
// Measured 2026-08-17: send-notification 903/903 failures in 24h, poke-pusher
// 164/164, metricool-sync 3/3 — zero 200s. 2.90.1 is the version proven booting.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.90.1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const POKE_TOKEN = Deno.env.get("POKE_TOKEN") ?? "";
// 2026-06-09: Correct endpoint per poke.com/docs/api. Body shape:
// {"message": "..."} — entire payload becomes the agent context for the
// Poke conversation. v2 API keys required (legacy pk_* won't work).
const POKE_ENDPOINT = Deno.env.get("POKE_ENDPOINT") ?? "https://poke.com/api/v1/inbound/api-message";
const POKE_RECIPIENT = Deno.env.get("POKE_RECIPIENT") ?? "sam";
// Telegram fallback — used when POKE_TOKEN is absent OR Poke API returns 4xx/5xx.
// 2026-06-08: api.poke.app DNS doesn't resolve; Telegram is the actual delivery
// channel until Poke has a working public API.
const TG_TOKEN = Deno.env.get("APEX_TELEGRAM_BOT_TOKEN") ?? Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const TG_CHAT  = Deno.env.get("APEX_TELEGRAM_CHAT_ID") ?? "6018839640";

async function sendTelegram(text: string): Promise<{ ok: boolean; status?: number; error?: string }> {
  if (!TG_TOKEN) return { ok: false, error: "no TG_TOKEN" };
  try {
    const resp = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: TG_CHAT, text }),
    });
    if (!resp.ok) return { ok: false, status: resp.status, error: (await resp.text()).slice(0, 120) };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface QueueRow {
  id: number;
  kind: string;
  payload: Record<string, unknown>;
  created_at: string;
}

function shortMessage(row: QueueRow): string {
  const p = row.payload || {};
  switch (row.kind) {
    case "high_value_applicant":
      return `🚨 High-value applicant — ${p.name ?? "(name?)"}${p.qualified_role ? ` · ${p.qualified_role}` : ""}${p.previous_team_size ? ` · team size ${p.previous_team_size}` : ""} · ${p.state ?? ""}${p.phone ? ` · ${p.phone}` : ""}`;
    case "sync_gap":
      return `📉 ${p.system ?? "?"} sync gap — last seen ${p.last_seen ?? "?"}. Action: ${p.action_required ?? "investigate"}`;
    case "morning_brief":
      return `☀️ Morning brief: ${p.summary ?? p.top_action ?? "see dashboard"}`;
    case "manychat_review":
      return `📨 ManyChat dry-run ready: ${p.summary ?? "review queue"} · reply ack:manychat_review to greenlight`;
    case "hard_stop":
      return `⛔ HARD STOP at ${p.priority ?? "?"} — ${p.reason ?? ""}. Action: ${p.action_required ?? "review"}`;
    case "pause":
      return `⏸ Apex agent paused at ${p.priority ?? "?"}. Resume via CONTINUE.md`;
    default:
      return `[${row.kind}] ${JSON.stringify(p).slice(0, 200)}`;
  }
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  try {
    // Pull up to 25 oldest unsent items
    const { data: rows, error: fetchErr } = await sb
      .from("poke_queue")
      .select("id, kind, payload, created_at")
      .is("sent_at", null)
      .order("created_at", { ascending: true })
      .limit(25);
    if (fetchErr) throw fetchErr;

    const queue = (rows ?? []) as QueueRow[];
    if (queue.length === 0) {
      return new Response(JSON.stringify({ drained: 0, note: "queue empty" }),
        { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } });
    }

    let sent = 0;
    let failed = 0;
    let viaTelegram = 0;
    for (const row of queue) {
      const message = shortMessage(row);
      let delivered = false;
      let lastErr = "";
      // Try Poke first if token present
      if (POKE_TOKEN) {
        try {
          const resp = await fetch(POKE_ENDPOINT, {
            method: "POST",
            headers: { "Authorization": `Bearer ${POKE_TOKEN}`, "Content-Type": "application/json" },
            body: JSON.stringify({ message }),
          });
          if (resp.ok) delivered = true;
          else lastErr = `poke ${resp.status}: ${(await resp.text()).slice(0, 100)}`;
        } catch (err) {
          lastErr = `poke ${err instanceof Error ? err.message : String(err)}`;
        }
      }
      // Telegram fallback (or primary if POKE_TOKEN absent)
      if (!delivered) {
        const tg = await sendTelegram(message);
        if (tg.ok) { delivered = true; viaTelegram++; }
        else lastErr = `${lastErr} | tg ${tg.error ?? tg.status}`.trim();
      }
      if (delivered) {
        await sb.from("poke_queue").update({ sent_at: new Date().toISOString(), error: null }).eq("id", row.id);
        sent++;
      } else {
        await sb.from("poke_queue").update({ error: lastErr.slice(0, 200) }).eq("id", row.id);
        failed++;
      }
    }

    return new Response(JSON.stringify({ drained: sent, failed, via_telegram: viaTelegram, examined: queue.length }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return new Response(JSON.stringify({ error: msg }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } });
  }
};

serve(handler);
