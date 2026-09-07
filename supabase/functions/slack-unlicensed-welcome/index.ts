// slack-unlicensed-welcome — greet every new member of #unlicensed with the one
// instruction that moves them forward.
//
// Sam, 2026-09-07 (on the phone with a stuck applicant): "every unlicensed
// application is put into the unlicensed chat, and when they're put in, the
// bot should automatically tell them to send a screenshot of confirmation once
// they purchase the course."
//
// The apex_pulse bot holds chat:write, chat:write.public, channels:read and
// groups:read — no Events API subscription and no channels:manage — so this is
// a sweep, not a webhook: every 5 minutes (pg_cron) list the channel's members,
// greet the ones we have not greeted, and record each greeting so nobody is
// welcomed twice. A failed post is not recorded and is retried next tick.
// Idempotent, fail-closed, and it never posts to any other channel.

import { createClient } from "npm:@supabase/supabase-js@2.90.1";

const SLACK_BOT_TOKEN = (Deno.env.get("SLACK_BOT_TOKEN") ?? "").trim();
const APEX_BOT_TOKEN = (Deno.env.get("APEX_BOT_TOKEN") ?? "").trim();
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// #unlicensed in the Apex Financial workspace (verified live 2026-09-07; the
// older general-unlicensed C0BSUGBR62G is archived).
const UNLICENSED_CHANNEL_ID = "C0BUTAKNB38";
const LICENSING_COURSE_URL = "https://partners.xcelsolutions.com/afe";
const GET_LICENSED_URL = "https://apex-financial.org/get-licensed#licensing-video";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

async function slack(method: string, params: Record<string, string>, post = false): Promise<Record<string, unknown>> {
  const url = post
    ? `https://slack.com/api/${method}`
    : `https://slack.com/api/${method}?${new URLSearchParams(params).toString()}`;
  const res = await fetch(url, {
    method: post ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
      ...(post ? { "content-type": "application/json; charset=utf-8" } : {}),
    },
    body: post ? JSON.stringify(params) : undefined,
  });
  return (await res.json().catch(() => ({ ok: false, error: `non-json ${res.status}` }))) as Record<string, unknown>;
}

function welcomeText(userId: string): string {
  return [
    `Welcome <@${userId}> — you're in the right room. This is where you live until you're licensed.`,
    "",
    `*1. Start the pre-licensing course:* ${LICENSING_COURSE_URL}`,
    `*2. Once you've purchased it, post a screenshot of the purchase confirmation right here in this channel.* That's how we verify it and move you to the next step — we can't advance you without it.`,
    `*3. Watch the six-minute walkthrough of the whole path (course → exam → license):* ${GET_LICENSED_URL}`,
    "",
    "Stuck on anything? Ask here. Someone from the team will answer.",
  ].join("\n");
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ ok: false, error: "POST only" }, 405);
  const auth = req.headers.get("Authorization") ?? "";
  const authorized = (APEX_BOT_TOKEN && auth === `Bearer ${APEX_BOT_TOKEN}`) || (SERVICE_ROLE && auth === `Bearer ${SERVICE_ROLE}`);
  if (!authorized) return json({ ok: false, error: "unauthorized" }, 401);
  if (!SLACK_BOT_TOKEN) return json({ ok: false, error: "SLACK_BOT_TOKEN not set" }, 500);

  const { dry_run } = (await req.json().catch(() => ({}))) as { dry_run?: boolean };
  const db = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  // 1. Who is in the channel right now (bots excluded — the bot itself is a member).
  const memberIds: string[] = [];
  let cursor = "";
  for (let page = 0; page < 20; page++) {
    const r = await slack("conversations.members", { channel: UNLICENSED_CHANNEL_ID, limit: "200", ...(cursor ? { cursor } : {}) });
    if (!r.ok) return json({ ok: false, error: `conversations.members: ${String(r.error)}` }, 502);
    memberIds.push(...((r.members as string[] | undefined) ?? []));
    cursor = String((r.response_metadata as { next_cursor?: string } | undefined)?.next_cursor ?? "");
    if (!cursor) break;
  }

  // 2. Who has already been greeted.
  const { data: greeted, error: readErr } = await db
    .from("slack_channel_welcomes")
    .select("slack_user_id")
    .eq("channel_id", UNLICENSED_CHANNEL_ID);
  if (readErr) return json({ ok: false, error: `read welcomes: ${readErr.message}` }, 500);
  const done = new Set((greeted ?? []).map((row) => row.slack_user_id as string));

  // 3. Skip the bot itself. The bot holds no users:read scope (probed live
  //    2026-09-07: chat:write, chat:write.public, channels:read, groups:read),
  //    so users.info is unavailable — the first cut skipped EVERY member on
  //    that failure and would have greeted nobody forever. auth.test needs no
  //    extra scope and names the bot's own user id; everyone else is a person.
  const me = await slack("auth.test", {}, true);
  const botUserId = String(me.user_id ?? "");
  const pending = memberIds.filter((id) => !done.has(id) && id !== botUserId);

  if (dry_run) return json({ ok: true, dry_run: true, members: memberIds.length, already_greeted: done.size, would_greet: pending });

  // 4. Greet, then record. A failed post leaves no row so the next tick retries.
  const greetedNow: string[] = [];
  const failures: Array<{ user: string; error: string }> = [];
  for (const id of pending) {
    const post = await slack("chat.postMessage", { channel: UNLICENSED_CHANNEL_ID, text: welcomeText(id), unfurl_links: "false" }, true);
    if (!post.ok) { failures.push({ user: id, error: String(post.error) }); continue; }
    const { error: insErr } = await db.from("slack_channel_welcomes").insert({
      channel_id: UNLICENSED_CHANNEL_ID,
      slack_user_id: id,
      message_ts: String(post.ts ?? ""),
    });
    if (insErr) failures.push({ user: id, error: `posted but not recorded: ${insErr.message}` });
    else greetedNow.push(id);
  }

  return json({ ok: failures.length === 0, members: memberIds.length, greeted: greetedNow, failures });
});
