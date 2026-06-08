// Move 2: Poke pusher — drains poke_queue rows that haven't been sent yet.
// Posts to Poke API if POKE_TOKEN env present; otherwise records the would-be
// outbound and exits successfully. Designed to run via pg_cron every 5 min.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const POKE_TOKEN = Deno.env.get("POKE_TOKEN") ?? "";
const POKE_ENDPOINT = Deno.env.get("POKE_ENDPOINT") ?? "https://api.poke.app/v1/messages";
const POKE_RECIPIENT = Deno.env.get("POKE_RECIPIENT") ?? "sam";

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

    if (!POKE_TOKEN) {
      // Credential gate — mark as deferred (set error, leave sent_at null) so
      // they're not retried in a tight loop. They'll go out the moment Sam
      // drops the token at ~/.config/apex-creds/poke.token (or POKE_TOKEN env).
      return new Response(JSON.stringify({
        drained: 0,
        queued: queue.length,
        note: "POKE_TOKEN absent — queue holds messages until token lands",
      }), { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } });
    }

    let sent = 0;
    let failed = 0;
    for (const row of queue) {
      const message = shortMessage(row);
      try {
        const resp = await fetch(POKE_ENDPOINT, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${POKE_TOKEN}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            recipient: POKE_RECIPIENT,
            message,
            metadata: { kind: row.kind, queue_id: row.id, ...row.payload },
          }),
        });
        if (!resp.ok) {
          const errText = await resp.text();
          await sb.from("poke_queue").update({
            error: `${resp.status}: ${errText.slice(0, 200)}`,
          }).eq("id", row.id);
          failed++;
          continue;
        }
        await sb.from("poke_queue").update({
          sent_at: new Date().toISOString(),
          error: null,
        }).eq("id", row.id);
        sent++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        await sb.from("poke_queue").update({
          error: msg.slice(0, 200),
        }).eq("id", row.id);
        failed++;
      }
    }

    return new Response(JSON.stringify({ drained: sent, failed, examined: queue.length }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return new Response(JSON.stringify({ error: msg }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } });
  }
};

serve(handler);
