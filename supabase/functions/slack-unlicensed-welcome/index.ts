// slack-unlicensed-welcome — greet every new member of #unlicensed with the one
// instruction that moves them forward, record what the room actually looks
// like, and (once Sam grants the scopes) place new recruits in the right room.
//
// Sam, 2026-09-07 (on the phone with a stuck applicant): "every unlicensed
// application is put into the unlicensed chat, and when they're put in, the
// bot should automatically tell them to send a screenshot of confirmation once
// they purchase the course."
//
// WP7 (2026-11-10) changes, each measured before it was made:
//   1. The greeting is cohort-neutral. #unlicensed is about to become a default
//      channel (Sam action N3), so licensed hires land here too; they are told
//      to head to #general. Receipts are uploaded in the Galaxy portal, never
//      posted here: nothing ever read the channel, and a purchase receipt is
//      personal order data in a public room.
//   2. Every sweep's outcome {members, greeted, failures} is written to
//      automation_run_log job 'slack_unlicensed_welcome' on change or hourly.
//      Before this it lived only in net._http_response (~6h), so 46 days of
//      zero joins were invisible.
//   3. Scope-gated placement. auth.test's x-oauth-scopes header is persisted to
//      messaging_workspace_installations.granted_scopes. Until users:read,
//      users:read.email and channels:manage are granted (Sam action N4) this
//      logs 'blocked_scope' (job 'slack_community_scopes') and does nothing
//      else. After that, it looks up by email (40 per tick) people who ENTERED
//      the state after system_settings.slack_placement_cutoff_at (forward only:
//      nobody from the backlog is moved or greeted automatically) and invites
//      unlicensed applicants into #unlicensed, newly licensed agents into
//      #general / #apex-sales-wins / #apex-contracting-support, and links
//      verified agent identities (match_method 'email_lookup').
//
// The bot never DMs anyone and never posts to any channel but #unlicensed.

import { createClient } from "npm:@supabase/supabase-js@2.90.1";
import { stableJson, welcomeText } from "./text.ts";

const SLACK_BOT_TOKEN = (Deno.env.get("SLACK_BOT_TOKEN") ?? "").trim();
const APEX_BOT_TOKEN = (Deno.env.get("APEX_BOT_TOKEN") ?? "").trim();
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// #unlicensed in the Apex Financial workspace (verified live 2026-09-07; the
// older general-unlicensed C0BSUGBR62G is archived).
const UNLICENSED_CHANNEL_ID = "C0BUTAKNB38";
// Licensed handoff channels (messaging_destinations, verified 2026-08-26/27).
const LICENSED_CHANNEL_IDS = ["C0BSRRNVC2V", "C0BTJLBKC2C", "C0BSNBA5NES"]; // #general, #apex-sales-wins, #apex-contracting-support
const REQUIRED_PLACEMENT_SCOPES = ["users:read", "users:read.email", "channels:manage"];
const LOOKUPS_PER_TICK = 40;
const LOG_HEARTBEAT_MS = 60 * 60 * 1000;

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

// auth.test needs no extra scope; its x-oauth-scopes header is the only honest
// statement of what this token can do.
async function authTest(): Promise<{ body: Record<string, unknown>; scopes: string[] | null }> {
  const res = await fetch("https://slack.com/api/auth.test", {
    method: "POST",
    headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}` },
  });
  const header = res.headers.get("x-oauth-scopes");
  const body = (await res.json().catch(() => ({ ok: false, error: `non-json ${res.status}` }))) as Record<string, unknown>;
  const scopes = header === null ? null : header.split(",").map((s) => s.trim()).filter(Boolean).sort();
  return { body, scopes };
}

// Write a run-log row only when the outcome changed or an hour passed, so the
// table holds a history, not 288 identical rows a day.
// deno-lint-ignore no-explicit-any
async function logOnChange(db: any, jobName: string, status: string, summary: Record<string, unknown>): Promise<boolean> {
  const { data: last } = await db
    .from("automation_run_log")
    .select("status, response_body, created_at")
    .eq("job_name", jobName)
    .order("created_at", { ascending: false })
    .limit(1);
  const prev = Array.isArray(last) && last.length ? last[0] : null;
  const same = prev && prev.status === status && stableJson(prev.response_body ?? null) === stableJson(summary);
  const fresh = prev && Date.now() - new Date(prev.created_at).getTime() < LOG_HEARTBEAT_MS;
  if (same && fresh) return false;
  const now = new Date().toISOString();
  const { error } = await db.from("automation_run_log").insert({
    job_name: jobName,
    status,
    triggered_at: now,
    completed_at: now,
    response_body: summary,
  });
  if (error) console.error(`[slack-unlicensed-welcome] run-log insert failed (${jobName}): ${error.message}`);
  return !error;
}

type Candidate = { subject_kind: "application" | "agent"; subject_id: string; email: string; target: "unlicensed" | "licensed" };

// Candidates and ledger writes go through service-role RPCs
// (20261111100620_wp7_slack_placement_rpcs): the forward-only cutoff, the
// 120-day window and the 3-day not_found retry live in the database, and a
// missing cutoff RAISES instead of sweeping the backlog.
// deno-lint-ignore no-explicit-any
async function runPlacement(db: any, dryRun: boolean): Promise<Record<string, unknown>> {
  const { data, error } = await db.rpc("fn_slack_placement_candidates", { p_limit: LOOKUPS_PER_TICK });
  if (error) return { status: "error", error: String(error.message ?? error) };
  const candidates = (data ?? []) as Candidate[];
  if (dryRun) {
    return {
      status: "dry_run",
      candidates: candidates.length,
      by_target: candidates.reduce((m: Record<string, number>, c) => ({ ...m, [c.target]: (m[c.target] ?? 0) + 1 }), {}),
    };
  }
  let found = 0, notFound = 0, invited = 0, linked = 0, errors = 0;
  const record = (c: Candidate, state: string, userId: string | null, channels: string[], errs: Record<string, string>) =>
    db.rpc("fn_record_slack_placement", {
      p_subject_kind: c.subject_kind, p_subject_id: c.subject_id, p_target: c.target, p_lookup_state: state,
      p_slack_user_id: userId, p_invited_channels: channels, p_invite_errors: errs,
    });
  for (const c of candidates) {
    const lookup = await slack("users.lookupByEmail", { email: c.email });
    if (!lookup.ok) {
      const state = lookup.error === "users_not_found" ? "not_found" : "error";
      if (state === "not_found") notFound += 1; else errors += 1;
      await record(c, state, null, [], state === "error" ? { lookup: String(lookup.error ?? "unknown") } : {});
      continue;
    }
    found += 1;
    const userId = String((lookup.user as { id?: string } | undefined)?.id ?? "");
    const channels = c.target === "licensed" ? LICENSED_CHANNEL_IDS : [UNLICENSED_CHANNEL_ID];
    const ok: string[] = [];
    const inviteErrors: Record<string, string> = {};
    for (const channel of channels) {
      const inv = await slack("conversations.invite", { channel, users: userId }, true);
      if (inv.ok || inv.error === "already_in_channel") ok.push(channel);
      else inviteErrors[channel] = String(inv.error ?? "unknown");
    }
    if (ok.length) invited += 1;
    if (c.subject_kind === "agent") {
      const { error: linkError } = await db.rpc("fn_link_slack_identity_email_lookup", {
        p_agent_id: c.subject_id, p_slack_user_id: userId, p_slack_email: c.email,
      });
      if (linkError) inviteErrors.identity = String(linkError.code ?? linkError.message ?? "link_failed");
      else linked += 1;
    }
    await record(c, "found", userId, ok, inviteErrors);
  }
  return { status: "ok", candidates: candidates.length, found, not_found: notFound, invited, linked, errors };
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
    if (!r.ok) {
      if (!dry_run) await logOnChange(db, "slack_unlicensed_welcome", "error", { error: `conversations.members: ${String(r.error)}` });
      return json({ ok: false, error: `conversations.members: ${String(r.error)}` }, 502);
    }
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

  // 3. Skip the bot itself (auth.test names its own user id, no extra scope).
  const me = await authTest();
  const botUserId = String(me.body.user_id ?? "");
  const pending = memberIds.filter((id) => !done.has(id) && id !== botUserId);
  const humans = memberIds.filter((id) => id !== botUserId).length;

  // 4. Scopes: persist, and decide whether placement may run.
  const missing = me.scopes === null
    ? REQUIRED_PLACEMENT_SCOPES
    : REQUIRED_PLACEMENT_SCOPES.filter((s) => !me.scopes!.includes(s));

  if (dry_run) {
    return json({
      ok: true, dry_run: true, members: memberIds.length, humans, already_greeted: done.size,
      bot_user_known: Boolean(botUserId), bot_in_channel: Boolean(botUserId) && memberIds.includes(botUserId),
      would_greet: pending, granted_scopes: me.scopes, missing_scopes: missing,
      placement: missing.length ? { status: "blocked_scope" } : await runPlacement(db, true),
    });
  }

  if (me.scopes) {
    const { data: inst } = await db
      .from("messaging_workspace_installations")
      .select("id, granted_scopes")
      .eq("provider", "slack").eq("environment", "production").eq("status", "active")
      .order("installed_at", { ascending: false, nullsFirst: false })
      .limit(1);
    const row = Array.isArray(inst) && inst.length ? inst[0] as { id: string; granted_scopes: string[] | null } : null;
    if (row && JSON.stringify([...(row.granted_scopes ?? [])].sort()) !== JSON.stringify(me.scopes)) {
      await db.from("messaging_workspace_installations")
        .update({ granted_scopes: me.scopes, last_verified_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("id", row.id);
    }
  }

  // 5. Greet, then record. A failed post leaves no row so the next tick retries.
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

  await logOnChange(db, "slack_unlicensed_welcome", failures.length ? "error" : "ok", {
    members: memberIds.length,
    humans,
    greeted: greetedNow.length,
    failures: failures.length,
  });

  // 6. Placement (scope-gated, forward only).
  let placement: Record<string, unknown>;
  if (missing.length) {
    placement = { status: "blocked_scope", missing };
    await logOnChange(db, "slack_community_scopes", "blocked_scope", {
      missing,
      granted: me.scopes ?? [],
      action: "Sam N4: api.slack.com/apps -> apex_pulse -> OAuth & Permissions -> add users:read, users:read.email, channels:manage, channels:history -> Reinstall",
    });
  } else {
    placement = await runPlacement(db, false);
    await logOnChange(db, "slack_community_scopes", String(placement.status ?? "ok"), placement);
  }

  return json({ ok: failures.length === 0, members: memberIds.length, greeted: greetedNow, failures, placement });
});
