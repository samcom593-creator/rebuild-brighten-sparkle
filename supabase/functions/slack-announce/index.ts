// slack-announce — post one plain-text message to an enabled APEX Slack channel.
//
// MP-342. Every other Slack path here is templated: apex-outbox-dispatcher
// renders a fixed shape per event type, and numbers-reminder DMs individuals.
// There was no way to put an ad-hoc announcement in a channel, which is why a
// "the Discord link is here" post could not be made when new hires needed it.
//
// Deliberately narrow:
//   * caller must present the APEX bot token (same gate the other admin
//     functions use) — this can post to a room full of people,
//   * the channel must already exist in messaging_destinations AND be enabled,
//     so this cannot invent a destination or post somewhere disabled on purpose,
//   * Slack's own ok/ts is the receipt. A 200 from Slack with ok:false is a
//     FAILURE and is reported as one; that distinction is the whole reason this
//     returns the ts rather than a boolean.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.90.1";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json", ...cors } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  const auth = req.headers.get("Authorization") ?? "";
  const expected = (Deno.env.get("APEX_BOT_TOKEN") ?? "").trim();
  if (!expected || auth !== `Bearer ${expected}`) return json({ ok: false, error: "unauthorized" }, 401);

  const { channel, text } = await req.json().catch(() => ({})) as { channel?: string; text?: string };
  if (!channel || !text?.trim()) return json({ ok: false, error: "channel and text are required" }, 400);

  const sb = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );

  const { data: dest, error: destErr } = await sb
    .from("messaging_destinations")
    .select("channel_id, channel_name, is_enabled")
    .eq("channel_name", channel.replace(/^#/, ""))
    .limit(1);
  if (destErr) return json({ ok: false, error: destErr.message }, 500);
  const target = (dest ?? [])[0];
  if (!target) return json({ ok: false, error: `unknown channel: ${channel}` }, 404);
  if (!target.is_enabled) return json({ ok: false, error: `channel is disabled: ${channel}` }, 409);

  const token = (Deno.env.get("SLACK_BOT_TOKEN") ?? "").trim();
  if (!token) return json({ ok: false, error: "SLACK_BOT_TOKEN is not configured" }, 503);

  const res = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ channel: target.channel_id, text, unfurl_links: false }),
  });
  const body = await res.json().catch(() => ({}));
  // Slack answers 200 even when it refuses. ok:false is a failure, not a send.
  if (!body?.ok) {
    return json({ ok: false, error: body?.error ?? `slack_http_${res.status}`, channel: target.channel_name }, 502);
  }
  return json({ ok: true, channel: target.channel_name, ts: body.ts });
});
