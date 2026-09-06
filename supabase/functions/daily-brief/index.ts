/**
 * daily-brief — 7am CT push to Sam's Telegram.
 *
 * 2026-06-17 — Sam directive: native daily flow. Pulls today's bookings,
 * open tasks, DM thread state, and silent producers, formats markdown
 * brief, sends to Telegram. INSERTs into daily_brief_log for archeology.
 *
 * Multi-user ready: ?owner_agent_id=<uuid> override; defaults to SJAMES01.
 * If Sam's chat_id is unknown, logs to /tmp/daily-brief-YYYYMMDD.log and
 * still returns 200 (the cron fire must not crash).
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

const TG_TOKEN =
  Deno.env.get("APEX_TELEGRAM_BOT_TOKEN") ?? Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";

// Hardcoded Sam chat-id fallback (same as poke-pusher / cfo-notify). Overridable
// by env APEX_TELEGRAM_CHAT_ID or by system_settings.sam_telegram_chat_id.
const SAM_CHAT_ID_FALLBACK = "6018839640";
const SAM_AGENT_ID = "7c3c5581-3544-437f-bfe2-91391afb217d";

function ymdShort(d = new Date()): string {
  return d.toLocaleDateString("en-US", { weekday: "short", month: "numeric", day: "numeric" });
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
}

function escMd(s: string): string {
  // Telegram MarkdownV2 reserved characters
  return s.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, "\\$1");
}

async function loadSamChatId(): Promise<string> {
  const envVal = Deno.env.get("APEX_TELEGRAM_CHAT_ID");
  if (envVal && envVal.trim()) return envVal.trim();
  const { data } = await supabase
    .from("system_settings")
    .select("value")
    .eq("key", "sam_telegram_chat_id")
    .maybeSingle();
  const v = (data as { value?: string } | null)?.value?.trim();
  return v || SAM_CHAT_ID_FALLBACK;
}

async function sendTelegram(chatId: string, text: string): Promise<{ ok: boolean; error?: string }> {
  if (!TG_TOKEN) return { ok: false, error: "TELEGRAM_BOT_TOKEN unset" };
  try {
    const resp = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "MarkdownV2",
        disable_web_page_preview: true,
      }),
    });
    if (!resp.ok) {
      const body = await resp.text();
      return { ok: false, error: `Telegram ${resp.status}: ${body}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String((e as Error).message ?? e) };
  }
}

interface BriefBuild {
  text: string;
  payload: Record<string, unknown>;
}

async function buildBrief(ownerAgentId: string): Promise<BriefBuild> {
  const now = new Date();
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0).toISOString();
  const dayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59).toISOString();

  // BOOKINGS today
  const callsResp = await supabase
    .from("apex_scheduled_calls")
    .select("id,prospect_name,start_at,status")
    .gte("start_at", dayStart)
    .lte("start_at", dayEnd)
    .neq("status", "cancelled")
    .order("start_at", { ascending: true });
  const calls = callsResp.data ?? [];
  const firstCall = calls[0];

  // OPEN TASKS for owner. Note: postgres orders text 'high' < 'low' < 'med'
  // alphabetically — wrong. We sort client-side via PRIORITY_RANK.
  const tasksResp = await supabase
    .from("today_tasks")
    .select("id,title,priority,due_at,created_at")
    .eq("owner_agent_id", ownerAgentId)
    .is("completed_at", null)
    .order("due_at", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true })
    .limit(50);
  const PRIORITY_RANK: Record<string, number> = { high: 3, med: 2, low: 1 };
  const tasks = (tasksResp.data ?? []).slice().sort((a, b) => {
    const pa = PRIORITY_RANK[(a as { priority: string }).priority] ?? 2;
    const pb = PRIORITY_RANK[(b as { priority: string }).priority] ?? 2;
    return pb - pa;
  });
  const top3 = tasks.slice(0, 3);

  // OPEN DMs — dead read removed (MP-443).
  // These two counts were read from `dm_threads_synced`, which exists in NO
  // schema, is created by no migration, and is referenced by no other code.
  // PostgREST 404s the relation and supabase-js resolves with {error}, so
  // dmResp.count stayed null and both counters were pinned at 0: the
  // "N DMs unanswered" line has never once rendered in Sam's brief. Deleting
  // the reads is behaviourally identical (0 either way, verified against live
  // prod) and removes the dead relation the repo guard flags.
  // NOT repointed on purpose: public.instagram_dm_threads is the plausible
  // target, but wiring it would start putting new numbers in front of Sam and
  // that is a product decision, not a side-effect of a security fix.
  const unansweredDms = 0;
  const hotKeyword = 0;

  // SILENT PRODUCERS in Sam's downline — agents with 0 deals in 14d
  // Approximation: agents where last_deal_at < now()-14d. Falls back to 0 if no such column.
  let silent: { display_name: string }[] = [];
  try {
    const cutoff = new Date(Date.now() - 14 * 86400_000).toISOString();
    const silentResp = await supabase
      .from("agents")
      .select("display_name,last_deal_at")
      .lt("last_deal_at", cutoff)
      .eq("status", "active")
      .limit(3);
    silent = ((silentResp.data ?? []) as { display_name: string }[]).filter((a) => a.display_name);
  // empty-catch-allow:last-deal-at-may-be-absent-line-omitted-not-faked
  } catch { /* skip */ }

  // ── format ──
  const date = ymdShort(now);
  const callsLine =
    calls.length === 0
      ? `• No calls today`
      : `• ${calls.length} ${calls.length === 1 ? "call" : "calls"} today${
          firstCall ? ` · first @ ${fmtTime(firstCall.start_at)} \\(${escMd(firstCall.prospect_name ?? "—")}\\)` : ""
        }`;

  const top3Line =
    top3.length === 0
      ? ""
      : ` · top ${top3.length}: ${top3.map((t, i) => `${i + 1}\\) ${escMd(t.title)}`).join(" ")}`;
  const tasksLine = `• ${tasks.length} open ${tasks.length === 1 ? "task" : "tasks"}${top3Line}`;

  const dmsLine =
    unansweredDms + hotKeyword === 0
      ? ""
      : `\n• ${unansweredDms} DMs unanswered${hotKeyword ? ` · ${hotKeyword} hot ${hotKeyword === 1 ? "keyword" : "keywords"}` : ""}`;

  const silentLine =
    silent.length === 0
      ? ""
      : `\n• ${silent.length} producers silent 14d\\+ · ${silent.map((a) => escMd(a.display_name)).join(" · ")}`;

  const missRisk = firstCall
    ? `\nTop miss\\-risk: ${escMd(firstCall.prospect_name ?? "—")} call ${fmtTime(firstCall.start_at)} \\(no confirmation sent\\)`
    : "";

  const header = `☀️ *Brief for ${escMd(date)}*`;
  const body = `${callsLine}\n${tasksLine}${dmsLine}${silentLine}${missRisk}`;
  const footer = `\n\n_Hold the Standard\\. Average is the disease\\._`;

  return {
    text: `${header}\n${body}${footer}`,
    payload: {
      date,
      calls_today: calls.length,
      first_call: firstCall
        ? { id: firstCall.id, at: firstCall.start_at, prospect: firstCall.prospect_name }
        : null,
      open_tasks: tasks.length,
      top3: top3.map((t) => ({ id: t.id, title: t.title, priority: t.priority })),
      unanswered_dms: unansweredDms,
      hot_keyword: hotKeyword,
      silent_producers: silent.map((a) => a.display_name),
    },
  };
}

/**
 * MP-443 — this function holds SUPABASE_SERVICE_ROLE_KEY and returns Sam's
 * private brief (task titles, booked prospect names, silent producers), and it
 * ran with verify_jwt=false and NO in-code check: a bare GET with no
 * Authorization header at all returned 200 and the whole payload. Without
 * dry_run it also pushes a Telegram to Sam's phone on demand.
 *
 * verify_jwt=true is NOT the fix and was refused twice over:
 *   1. The only caller is pg_cron job apex-daily-brief-7am-ct, which sends
 *      'Bearer ' || vault apex_bot_token. That token is 64-char hex, not a
 *      JWT, so the gateway would reject it and the 7am brief would die.
 *   2. Measured 2026-09-06: the gateway accepts the project ANON key, which
 *      ships inside apex-financial.org's public JS bundle. verify_jwt would
 *      move the bar from "no credential" to "a credential anyone can read off
 *      the website" — not a boundary.
 *
 * So the bearer is checked here, against the same stores bot-sql accepts.
 * Verified before shipping: vault.apex_bot_token and
 * system_settings.apex_bot_token are byte-identical, so the value the cron
 * actually sends is in the accepted set. If they are ever rotated apart, this
 * check fails CLOSED (401) and the brief stops — deliberately, because a
 * silent re-opening of the endpoint is the worse failure.
 */
function tokenMatches(presented: string, accepted: string[]): boolean {
  // Constant-time-ish: compare against every candidate, no early return.
  let hit = false;
  for (const c of accepted) {
    if (c.length !== presented.length) continue;
    let diff = 0;
    for (let i = 0; i < c.length; i++) diff |= c.charCodeAt(i) ^ presented.charCodeAt(i);
    if (diff === 0) hit = true;
  }
  return hit;
}

async function authorize(req: Request): Promise<boolean> {
  const hdr = req.headers.get("authorization") ?? "";
  const m = hdr.match(/^Bearer\s+(.+)$/i);
  if (!m) return false;
  const presented = m[1].trim();
  if (presented.length < 16) return false;

  const accepted: string[] = [];
  const env = Deno.env.get("APEX_BOT_TOKEN");
  if (env && env.length > 16) accepted.push(env);
  try {
    const { data } = await supabase
      .from("system_settings")
      .select("value")
      .eq("key", "apex_bot_token")
      .maybeSingle();
    const v = (data as { value?: string } | null)?.value;
    if (v && v.length > 16) accepted.push(v);
  // empty-catch-allow:MP-443-auth-read-failure-falls-through-to-deny-never-open
  } catch { /* fail closed below */ }

  if (accepted.length === 0) return false;
  return tokenMatches(presented, accepted);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  if (!(await authorize(req))) {
    return new Response(
      JSON.stringify({ ok: false, error: "unauthorized" }),
      { status: 401, headers: { ...corsHeaders, "content-type": "application/json" } },
    );
  }

  let ownerAgentId = SAM_AGENT_ID;
  let dryRun = false;
  try {
    const url = new URL(req.url);
    const override = url.searchParams.get("owner_agent_id");
    if (override) ownerAgentId = override;
    if (url.searchParams.get("dry_run") === "1") dryRun = true;
    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      if (body?.owner_agent_id) ownerAgentId = body.owner_agent_id;
      if (body?.dry_run) dryRun = true;
    }
  // empty-catch-allow:malformed-input-falls-back-to-default-owner-cron-must-not-crash
  } catch { /* fallthrough */ }

  const { text, payload } = await buildBrief(ownerAgentId);
  const chatId = await loadSamChatId();

  let tgResult: { ok: boolean; error?: string } = { ok: false, error: "skipped" };
  if (!dryRun) {
    tgResult = await sendTelegram(chatId, text);
  } else {
    tgResult = { ok: true };
  }

  // Fallback log file if telegram failed
  if (!tgResult.ok && !dryRun) {
    try {
      const fname = `/tmp/daily-brief-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}.log`;
      await Deno.writeTextFile(fname, `[${new Date().toISOString()}] ${tgResult.error}\n${text}\n\n`, { append: true });
    } catch { /* empty-catch-allow:tmp-not-writable-fallback-for-already-failed-telegram-send */ }
  }

  // Always log to DB
  try {
    await supabase.from("daily_brief_log").insert({
      recipient_agent_id: ownerAgentId,
      delivery: dryRun ? "dry_run" : "telegram",
      ok: tgResult.ok,
      payload: { ...payload, error: tgResult.error ?? null, text },
    });
  } catch (e) {
    // table not yet provisioned — skip
    console.error("daily_brief_log insert failed", String(e));
  }

  return new Response(
    JSON.stringify({
      ok: true,
      sent: tgResult.ok,
      error: tgResult.error ?? null,
      payload,
      preview: text,
    }),
    { headers: { ...corsHeaders, "content-type": "application/json" } },
  );
});
