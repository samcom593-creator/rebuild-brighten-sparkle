// instagram-token-keepalive — refreshes the 60-day Instagram (Instagram-Login
// product) long-lived token from the cloud, so the DM assistant does not depend
// on Sam's laptop being awake. Before this the only refresher was a launchd job
// (apex-ig-connect-complete.py); a laptop closed for a couple of months would
// have let the token die and every DM go unanswered.
//
// Scheduled weekly by pg_cron ('apex-instagram-token-keepalive-weekly'). A
// token refreshes only once it is 24h old; we refresh when <= 20 days remain,
// so a failed week still leaves two more tries before expiry. Under 10 days
// with a failed refresh -> priority-5 page to Sam.
//
// Auth: Authorization: Bearer <APEX_BOT_TOKEN> (the vault's apex_bot_token).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const NTFY_TOPIC = "https://ntfy.sh/sams-agent-yrkv9kbqp9e987nb";
const REFRESH_WHEN_DAYS_LEFT = 20;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  const expected = Deno.env.get("APEX_BOT_TOKEN") ?? "";
  const auth = req.headers.get("authorization") ?? "";
  if (!expected || auth !== `Bearer ${expected}`) return json({ ok: false, error: "unauthorized" }, 401);

  const url = new URL(req.url);
  const force = url.searchParams.get("force") === "1";
  const sb = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", { auth: { persistSession: false } });

  const { data: conns, error } = await sb.from("instagram_connections")
    .select("id, instagram_user_id, access_token, token_expires_at, connected_at")
    .order("connected_at", { ascending: false }).limit(1);
  if (error) return json({ ok: false, error: error.message }, 500);
  const conn = conns?.[0];
  if (!conn?.access_token) return json({ ok: false, error: "no_connection" }, 200);

  const daysLeft = (new Date(conn.token_expires_at).getTime() - Date.now()) / 86400000;
  if (daysLeft > REFRESH_WHEN_DAYS_LEFT && !force) {
    return json({ ok: true, action: "skip", days_left: Number(daysLeft.toFixed(1)), expires_at: conn.token_expires_at });
  }

  const r = await fetch(`https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(conn.access_token)}`);
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j?.access_token) {
    const msg = j?.error?.message ?? `HTTP ${r.status}`;
    console.error("[instagram-token-keepalive] refresh failed", msg);
    if (daysLeft < 10) {
      try {
        await fetch(NTFY_TOPIC, { method: "POST", headers: { "Title": "Instagram token refresh FAILED", "Priority": "5", "Tags": "rotating_light" },
          body: `IG DM assistant token dies in ${daysLeft.toFixed(1)} days and the refresh failed: ${msg}. Re-connect: ~/.config/apex-creds/ig-connect-link.txt` });
      } catch (e) { console.error("[instagram-token-keepalive] ntfy failed", e); }
    }
    return json({ ok: false, action: "refresh_failed", days_left: Number(daysLeft.toFixed(1)), error: msg }, 200);
  }

  const expiresAt = new Date(Date.now() + Number(j.expires_in ?? 5184000) * 1000).toISOString();
  const { error: upErr } = await sb.from("instagram_connections").update({ access_token: j.access_token, token_expires_at: expiresAt }).eq("id", conn.id);
  if (upErr) return json({ ok: false, action: "store_failed", error: upErr.message }, 500);
  const { data: existing } = await sb.from("system_settings").select("key").eq("key", "meta_instagram_token").limit(1);
  if (existing?.length) await sb.from("system_settings").update({ value: j.access_token }).eq("key", "meta_instagram_token");
  else await sb.from("system_settings").insert({ key: "meta_instagram_token", value: j.access_token });
  return json({ ok: true, action: "refreshed", expires_at: expiresAt, days_left_before: Number(daysLeft.toFixed(1)) });
});
