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

  const { channel, text, probe_scopes } = await req.json().catch(() => ({})) as
    { channel?: string; text?: string; probe_scopes?: boolean };

  // MP-349: report which channel-management scopes this bot actually holds.
  // #general-unlicensed is ARCHIVED and unarchive returned missing_scope; before
  // concluding the room cannot be created either, ask Slack directly rather than
  // inferring one refusal from another. auth.test is read-only and creates
  // nothing, so this is safe to call.
  if (probe_scopes === true) {
    const t = (Deno.env.get("SLACK_BOT_TOKEN") ?? "").trim();
    if (!t) return json({ ok: false, error: "SLACK_BOT_TOKEN is not configured" }, 503);
    const r = await fetch("https://slack.com/api/auth.test", {
      method: "POST", headers: { Authorization: `Bearer ${t}` },
    });
    const b = await r.json().catch(() => ({}));
    // channels:read is granted, so list the rooms too — which are open and which
    // are archived decides where an automated post can actually land.
    const lr = await fetch(
      "https://slack.com/api/conversations.list?limit=200&exclude_archived=false&types=public_channel",
      { headers: { Authorization: `Bearer ${t}` } },
    );
    const lb = await lr.json().catch(() => ({}));
    const chans = (lb?.channels ?? []).map((c: Record<string, unknown>) => ({
      name: c.name, id: c.id, archived: c.is_archived, members: c.num_members,
    }));
    return json({
      ok: Boolean(b?.ok),
      team: b?.team ?? null,
      bot: b?.user ?? null,
      granted_scopes: r.headers.get("x-oauth-scopes") ?? "(not reported)",
      channels: chans,
      channels_error: lb?.ok ? null : (lb?.error ?? null),
      error: b?.ok ? null : (b?.error ?? "auth_test_failed"),
    });
  }

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

  const slack = async (method: string, payload: Record<string, unknown>) => {
    const r = await fetch(`https://slack.com/api/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8", Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    });
    return await r.json().catch(() => ({} as Record<string, unknown>));
  };

  const post = () => slack("chat.postMessage", { channel: target.channel_id, text, unfurl_links: false });

  let body = await post();

  // MP-347: two refusals are recoverable and were previously fatal. Enabling
  // #general-unlicensed for the pre-licensed cohort failed with is_archived —
  // the channel existed and was simply archived, which no amount of retrying
  // fixes. Slack answers HTTP 200 for both, so these only surface by reading
  // `error`. Each repair is attempted ONCE and the post retried once; a second
  // failure is reported with Slack's own error rather than looped.
  const repairs: string[] = [];
  if (body?.error === "is_archived") {
    const un = await slack("conversations.unarchive", { channel: target.channel_id });
    repairs.push(un?.ok ? "unarchived" : `unarchive_failed:${un?.error ?? "unknown"}`);
    if (un?.ok) body = await post();
  }
  if (body?.error === "not_in_channel") {
    const jn = await slack("conversations.join", { channel: target.channel_id });
    repairs.push(jn?.ok ? "joined" : `join_failed:${jn?.error ?? "unknown"}`);
    if (jn?.ok) body = await post();
  }

  // Slack answers 200 even when it refuses. ok:false is a failure, not a send.
  if (!body?.ok) {
    return json({
      ok: false,
      error: body?.error ?? `slack_http_unknown`,
      channel: target.channel_name,
      repairs_attempted: repairs,
    }, 502);
  }
  return json({ ok: true, channel: target.channel_name, ts: body.ts, repairs_attempted: repairs });
});
