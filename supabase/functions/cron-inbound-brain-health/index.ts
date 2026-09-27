// cron-inbound-brain-health
// -----------------------------------------------------------------------------
// Always-on watchdog for the inbound DM routing brain (manychat-webhook). Sam:
// "this has to be running at all times, not just when tokens are down."
//
// The brain is serverless, so it does not depend on any Claude session or token
// to run — but a bad deploy or a broken dependency could take it dark silently.
// This pings the brain's authenticated health no-op every few minutes and pages
// Sam's phone ONLY if the responder itself is unreachable or errors. It does NOT
// page on quiet traffic (no "no DMs in an hour" cry-wolf) — traffic silence is
// normal; a dead responder is not.
//
// Gate: x-cron-secret == INBOUND_HEALTH_SECRET (pg_cron passes it from Vault).
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "https://xrzweoneiieddzxogewk.supabase.co";
const NTFY_TOPIC = "https://ntfy.sh/sams-agent-yrkv9kbqp9e987nb";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const gate = Deno.env.get("INBOUND_HEALTH_SECRET") ?? "";
  const provided = (req.headers.get("x-cron-secret") ?? "").trim();
  if (!gate || provided !== gate) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const brainSecret = Deno.env.get("MANYCHAT_WEBHOOK_SECRET") ?? "";
  let healthy = false;
  let detail = "";
  try {
    const r = await fetch(`${SUPABASE_URL}/functions/v1/manychat-webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-manychat-secret": brainSecret },
      body: JSON.stringify({ health_check: true }),
      signal: AbortSignal.timeout(15000),
    });
    const txt = await r.text();
    let j: Record<string, unknown> = {};
    try { j = JSON.parse(txt); } catch (_e) { j = {}; }
    healthy = r.status === 200 && j?.ok === true && j?.health === "ok";
    detail = healthy ? "ok" : `status=${r.status} body=${txt.slice(0, 160)}`;
  } catch (e) {
    healthy = false;
    detail = e instanceof Error ? e.message : String(e);
  }

  if (!healthy) {
    // Page Sam. The responder — the thing that answers his DMs and funnels
    // leads — is down. This is the one alert this watchdog ever sends.
    try {
      await fetch(NTFY_TOPIC, {
        method: "POST",
        headers: { "Title": "APEX DM responder is DOWN", "Priority": "5", "Tags": "warning" },
        body: `The inbound DM routing brain failed its health check: ${detail}. New DMs may not be getting answered or routed.`,
      });
    } catch (_e) { /* if ntfy itself is unreachable, the return still reports unhealthy */ }
  }

  return new Response(JSON.stringify({ ok: true, healthy, detail, ts: new Date().toISOString() }), {
    status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
