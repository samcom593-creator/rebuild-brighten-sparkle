/**
 * discord-webhook-notify — v3
 * Exactly 8 production-ready event types. No extras.
 *
 * Events:
 *  1. new_application   — first_name, last_name, state, @instagram?
 *  2. agent_activated   — agent_name, hired_by, referred_by?, @instagram?
 *  3. deal_closed       — agent_name, aop, product_type, @instagram? + milestone auto-check
 *  4. streak_7day       — agent_name, streak_days, @instagram?
 *  5. deal_milestone    — agent_name, tier (25K/40K/75K/100K), mtd_alp, @instagram?
 *  6. daily_leaderboard — entries[{rank,name,aop,instagram?}], date_label
 *  7. weekly_leaderboard— entries[{rank,name,weekly_alp,instagram?}], week_range
 *  8. pipeline_leaderboard — stage_counts, fastest[], completion_rates[]
 */

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "../_shared/cors.ts";
import {
  getBusinessMonthBounds,
  resolveDiscordWebhook,
  VALID_DEAL_STATUSES,
  type DiscordAudience,
} from "../_shared/apex.ts";

// ─── Discord embed colors ─────────────────────────────────────────────────────
const CLR = {
  blue:    0x3b82f6,
  green:   0x10b981,
  gold:    0xf59e0b,
  orange:  0xf97316,
  purple:  0x8b5cf6,
  cyan:    0x06b6d4,
  emerald: 0x059669,
  diamond: 0xa855f7,
} as const;

// ─── Milestone tiers ──────────────────────────────────────────────────────────
const MILESTONES = [25_000, 40_000, 75_000, 100_000] as const;
const MILESTONE_LABEL: Record<number, string> = {
  25_000:  "🥈 $25K Club",
  40_000:  "🥇 $40K Club",
  75_000:  "💎 $75K Elite",
  100_000: "👑 $100K Legend",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmt$(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(1)}k`;
  return `$${n.toLocaleString()}`;
}

function ig(handle: string | null | undefined): string {
  if (!handle) return "";
  const h = handle.replace(/^@/, "").trim();
  return h ? ` @${h}` : "";
}

function productLabel(raw: string | null | undefined): string {
  if (!raw) return "Life Insurance";
  const u = raw.toUpperCase();
  if (u.includes("IUL") || u.includes("INDEX")) return "IUL";
  if (u.includes("WHOLE") || u.includes(" WL"))  return "Whole Life";
  if (u.includes("TERM"))                         return "Term Life";
  return raw.length > 20 ? raw.slice(0, 20) + "…" : raw;
}

const RANK_MEDALS = ["🥇", "🥈", "🥉"];
function rankEmoji(i: number): string {
  return i < 3 ? RANK_MEDALS[i] : `${i + 1}.`;
}

const RECRUITING_EVENTS = new Set(["new_application", "agent_activated", "pipeline_leaderboard"]);

function getDiscordAudience(eventType: string): DiscordAudience {
  return RECRUITING_EVENTS.has(eventType) ? "recruiting" : "production";
}

// ─── Failure trace ────────────────────────────────────────────────────────────
// A swallowed announce failure is the same class of leak as the 465 fake-success
// InsuraCloud sync rows: Discord goes quiet and nothing anywhere says why. Write
// the miss to error_logs (same shape readymode-webhook uses) so it leaves a
// trace. Best-effort by design — the logging itself must never fail a request.
async function logAnnounceFailure(
  supabase: SupabaseClient<any, any, any>,
  message: string,
): Promise<void> {
  console.error(`[discord-webhook-notify] ${message}`);
  try {
    await supabase.from("error_logs").insert({
      url: "edge:discord-webhook-notify",
      error_message: message.slice(0, 2000),
    });
  } catch (logErr) {
    console.error(`[discord-webhook-notify] error_logs insert failed: ${String(logErr)}`);
  }
}

// ─── Auth ─────────────────────────────────────────────────────────────────────
// Tokens that identify a trusted internal caller. Verified caller inventory
// (2026-07-25) — every one of these keeps working under the gate below:
//   • DB triggers → public.run_automation_job → Bearer system_settings.service_role_key
//   • supabase/functions/post-deal → Bearer SUPABASE_SERVICE_ROLE_KEY (env)
//   • src/** supabase.functions.invoke → Bearer user session JWT (handled separately)
// The anon key is deliberately excluded: it ships inside the browser bundle, so
// accepting it would be the same as no gate at all.
async function resolveValidTokens(sb: SupabaseClient<any, any, any>): Promise<string[]> {
  const tokens: string[] = [];
  const anonKey = (Deno.env.get("SUPABASE_ANON_KEY") ?? "").trim();
  const push = (v: string | null | undefined) => {
    const t = (v ?? "").trim();
    if (t.length > 16 && t !== anonKey && !tokens.includes(t)) tokens.push(t);
  };
  push(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
  push(Deno.env.get("APEX_BOT_TOKEN"));
  try {
    const { data } = await sb
      .from("system_settings")
      .select("key, value")
      .in("key", ["service_role_key", "apex_bot_token"]);
    for (const row of (data ?? []) as { key: string; value: string | null }[]) push(row.value);
  } catch (err) {
    // Env tokens above still gate the request; log so a silent settings-read
    // failure can't be mistaken for "no trusted callers configured".
    console.error(`[discord-webhook-notify] system_settings token read failed: ${String(err)}`);
  }
  return tokens;
}

// ─── Embed builders ───────────────────────────────────────────────────────────

function embedNewApplication(d: Record<string, unknown>) {
  const name  = `${d.first_name ?? "?"} ${d.last_name ?? ""}`.trim();
  const state = (d.state as string) || "—";
  const insta = ig(d.instagram as string);
  return {
    embeds: [{
      title:       "📥 New Application",
      description: `**${name}${insta}** just applied from **${state}**`,
      color:       CLR.blue,
      footer:      { text: "No personal information shared" },
      timestamp:   new Date().toISOString(),
    }],
  };
}

function embedAgentActivated(d: Record<string, unknown>) {
  const name     = (d.agent_name as string) || "New Agent";
  const hiredBy  = (d.hired_by as string)   || "Sam";
  const referral = d.referred_by as string | null;
  const insta    = ig(d.instagram as string);

  const fields: {name:string;value:string;inline:boolean}[] = [
    { name: "Hired By",   value: hiredBy,               inline: true },
    { name: "Start Date", value: (d.start_date as string) || "Today", inline: true },
  ];
  if (referral) fields.push({ name: "Referred By", value: referral, inline: true });

  return {
    embeds: [{
      title:       "🚀 New Agent Activated",
      description: `**${name}${insta}** is officially on the team!`,
      color:       CLR.green,
      fields,
      timestamp:   new Date().toISOString(),
    }],
  };
}

function embedDealClosed(d: Record<string, unknown>) {
  const name    = (d.agent_name as string) || "Agent";
  const aop     = Number(d.aop) || 0;
  const product = productLabel(d.product_type as string);
  const insta   = ig(d.instagram as string);
  const photo   = (d.photo_url as string) || null;

  return {
    embeds: [{
      title:       "💰 Deal Closed!",
      description: `**${name}${insta}** closed a **${product}** deal`,
      color:       CLR.gold,
      // PL-AVATAR: Sam's complaint — "people post deals and don't get their picture inside their chat".
      // Discord embed now includes the agent thumbnail when agents.photo_url is set.
      ...(photo ? { thumbnail: { url: photo } } : {}),
      fields: [
        { name: "ALP", value: fmt$(aop), inline: true },
        { name: "Product",        value: product,     inline: true },
      ],
      timestamp: new Date().toISOString(),
    }],
  };
}

function embedStreak7Day(d: Record<string, unknown>) {
  const name  = (d.agent_name as string) || "Agent";
  const days  = Number(d.streak_days) || 7;
  const insta = ig(d.instagram as string);
  const photo = (d.photo_url as string) || null;
  const fires = "🔥".repeat(Math.min(days, 7));

  return {
    embeds: [{
      title:       `${fires} 7-Day Activity Streak!`,
      description: `**${name}${insta}** has logged production for **${days} consecutive days**`,
      color:       CLR.orange,
      ...(photo ? { thumbnail: { url: photo } } : {}),
      fields: [
        { name: "Streak", value: `${days} days`, inline: true },
      ],
      timestamp: new Date().toISOString(),
    }],
  };
}

function embedDealMilestone(d: Record<string, unknown>) {
  const name  = (d.agent_name as string) || "Agent";
  const tier  = Number(d.tier) || 25_000;
  const mtd   = Number(d.mtd_alp) || tier;
  const insta = ig(d.instagram as string);
  const photo = (d.photo_url as string) || null;
  const label = MILESTONE_LABEL[tier] ?? `$${(tier / 1000).toFixed(0)}K Milestone`;

  return {
    embeds: [{
      title:       `${label} — Monthly Milestone!`,
      description: `**${name}${insta}** just crossed **${fmt$(tier)}** in monthly production!`,
      color:       tier >= 100_000 ? CLR.diamond : tier >= 75_000 ? CLR.purple : CLR.gold,
      ...(photo ? { thumbnail: { url: photo } } : {}),
      fields: [
        { name: "MTD Production", value: fmt$(mtd), inline: true },
        { name: "Tier Unlocked",  value: label,     inline: true },
      ],
      timestamp: new Date().toISOString(),
    }],
  };
}

function embedDailyLeaderboard(d: Record<string, unknown>) {
  const entries = (d.entries as Array<{rank:number;name:string;aop:number;instagram?:string}>) || [];
  const date    = (d.date_label as string) || new Date().toLocaleDateString("en-US", { month:"short", day:"numeric" });

  const desc = entries.length === 0
    ? "*No production logged today yet*"
    : entries.map((e, i) =>
        `${rankEmoji(i)} **${e.name}${ig(e.instagram)}** — ${fmt$(e.aop)}`
      ).join("\n");

  return {
    embeds: [{
      title:       `📊 Daily Leaderboard — ${date}`,
      description: desc,
      color:       CLR.blue,
      footer:      { text: "Top 10 producers by ALP · Posted 9pm CT" },
      timestamp:   new Date().toISOString(),
    }],
  };
}

function embedWeeklyLeaderboard(d: Record<string, unknown>) {
  const entries   = (d.entries as Array<{rank:number;name:string;weekly_alp:number;instagram?:string}>) || [];
  const weekRange = (d.week_range as string) || "This Week";

  const desc = entries.length === 0
    ? "*No production logged this week yet*"
    : entries.map((e, i) =>
        `${rankEmoji(i)} **${e.name}${ig(e.instagram)}** — ${fmt$(e.weekly_alp)}`
      ).join("\n");

  return {
    embeds: [{
      title:       `🏆 Weekly Leaderboard — ${weekRange}`,
      description: desc,
      color:       CLR.purple,
      footer:      { text: "Top 10 weekly producers · Mon-Sun · Posted Sundays 9pm CT" },
      timestamp:   new Date().toISOString(),
    }],
  };
}

function embedPipelineLeaderboard(d: Record<string, unknown>) {
  type StageCount = { label: string; count: number };
  type FastEntry  = { name: string; days: number; instagram?: string };
  type RateEntry  = { manager: string; rate: number; licensed: number; total: number };

  const stages   = (d.stage_counts  as StageCount[]) || [];
  const fastest  = (d.fastest       as FastEntry[])  || [];
  const rates    = (d.completion_rates as RateEntry[]) || [];
  const date     = (d.date_label    as string) || new Date().toLocaleDateString("en-US", { month:"short", day:"numeric" });

  const stageLine = stages.map(s => `${s.label} **${s.count}**`).join("  ·  ");

  const fastLines = fastest.length
    ? fastest.map((e, i) => `${rankEmoji(i)} ${e.name}${ig(e.instagram)} — ${e.days}d`).join("\n")
    : "*No data*";

  const rateLines = rates.length
    ? rates.slice(0, 5).map((e, i) => `${rankEmoji(i)} ${e.manager} — ${e.rate}% (${e.licensed}/${e.total})`).join("\n")
    : "*No data*";

  const fields = [
    { name: "⚡ Fastest to License (MTD)", value: fastLines, inline: false },
    { name: "📈 Manager Completion Rate",  value: rateLines, inline: false },
  ];

  return {
    embeds: [{
      title:       `📋 New Hire Pipeline — ${date}`,
      description: stageLine || "*Pipeline is empty*",
      color:       CLR.cyan,
      fields,
      footer:      { text: "Ranked by activation speed & licensing completion rate · Posted 9pm EST" },
      timestamp:   new Date().toISOString(),
    }],
  };
}

// ─── Build payload ────────────────────────────────────────────────────────────
function buildPayload(event_type: string, details: Record<string, unknown>): Record<string, unknown> | null {
  switch (event_type) {
    case "new_application":      return embedNewApplication(details);
    case "agent_activated":      return embedAgentActivated(details);
    case "deal_closed":          return embedDealClosed(details);
    case "streak_7day":          return embedStreak7Day(details);
    case "deal_milestone":       return embedDealMilestone(details);
    case "daily_leaderboard":    return embedDailyLeaderboard(details);
    case "weekly_leaderboard":   return embedWeeklyLeaderboard(details);
    case "pipeline_leaderboard": return embedPipelineLeaderboard(details);
    default: return null;
  }
}

// ─── Send to Discord with retry ───────────────────────────────────────────────
async function sendToDiscord(webhookUrl: string, payload: Record<string, unknown>): Promise<void> {
  const backoff = [0, 800, 2000, 5000];
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, backoff[attempt]));
    const res = await fetch(webhookUrl, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(payload),
    });
    if (res.status === 429) {
      const body = await res.json().catch(() => ({}));
      const wait = ((body as any).retry_after ?? 2) * 1000;
      await new Promise(r => setTimeout(r, wait));
      continue;
    }
    if (res.ok || res.status === 204) return;
    if (attempt === 3) throw new Error(`Discord ${res.status}: ${await res.text().catch(() => "")}`);
  }
}

// ─── Resolve webhook URL ──────────────────────────────────────────────────────
// ─── Milestone auto-check (fires after deal_closed) ──────────────────────────
async function checkAndFireMilestone(
  supabase: ReturnType<typeof createClient>,
  webhookUrl: string,
  agentId: string,
  dealAop: number,
): Promise<void> {
  if (!agentId || !dealAop) return;

  const monthBounds = getBusinessMonthBounds();

  // MTD ALP from posted deals truth
  const { data: rows } = await supabase
    .from("deals")
    .select("annual_premium, status")
    .eq("agent_id", agentId)
    .in("status", [...VALID_DEAL_STATUSES])
    .gte("posted_at", monthBounds.startIso)
    .lt("posted_at", monthBounds.endIso);

  const mtd = (rows ?? []).reduce(
    (sum: number, row: { annual_premium: number | null }) => sum + (Number(row.annual_premium) || 0),
    0,
  );
  const prevMtd = mtd - dealAop;

  for (const t of MILESTONES) {
    if (prevMtd < t && mtd >= t) {
      // Crossed! Get agent info for instagram handle + avatar
      const { data: agent } = await supabase
        .from("agents")
        .select("profile:profiles!agents_profile_id_fkey(full_name, instagram_handle, avatar_url)")
        .eq("id", agentId)
        .maybeSingle();

      const profile = (agent as any)?.profile;
      const agentName = profile?.full_name ?? "Agent";
      const instagram = profile?.instagram_handle ?? null;
      // agents.photo_url does not exist; avatar lives on profiles via profile_id FK
      const photo_url = profile?.avatar_url ?? null;

      const milestonePayload = buildPayload("deal_milestone", {
        agent_name: agentName,
        tier:       t,
        mtd_alp:    mtd,
        instagram,
        photo_url,
      });
      if (milestonePayload) {
        await sendToDiscord(webhookUrl, milestonePayload).catch((err) =>
          logAnnounceFailure(
            supabase,
            `milestone announce failed tier=${t} agent_id=${agentId} mtd=${mtd}: ${String(err)}`,
          )
        );
      }
      break; // only fire the highest crossed threshold per deal
    }
  }
}

// ─── Main handler ─────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")  ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } }
    );

    // ─── Auth ──
    // This function shipped with verify_jwt=false and no in-code gate, so any
    // stranger could POST a fabricated deal_closed / new_application embed into
    // the live Discord. Gate on identity the same way insuracloud-sync does:
    // accept EITHER a trusted server token (DB triggers via run_automation_job,
    // post-deal, cron) OR a valid Supabase user session JWT (in-app callers via
    // supabase.functions.invoke). OPTIONS is answered above and stays open so
    // CORS preflight and the overseer-bot health probe are unaffected.
    const authHeader = req.headers.get("Authorization") ?? req.headers.get("authorization") ?? "";
    const presented = authHeader.replace(/^Bearer\s+/i, "").trim();
    const validTokens = await resolveValidTokens(supabase);
    let authedAs: "bot" | "user" | null = null;
    if (presented && validTokens.includes(presented)) {
      authedAs = "bot";
    } else if (presented) {
      const { data: userData } = await supabase.auth.getUser(presented);
      if (userData?.user) authedAs = "user";
    }
    if (!authedAs) {
      // readymode-ingest precedent: an unset secret is a 503 (misconfiguration),
      // not a 401 (bad caller), so a blank env never reads as an attacker.
      const misconfigured = validTokens.length === 0;
      if (misconfigured) {
        console.error("[discord-webhook-notify] no trusted server token configured — refusing to post");
      }
      return new Response(
        JSON.stringify({ ok: false, error: misconfigured ? "auth_not_configured" : "unauthorized" }),
        {
          status: misconfigured ? 503 : 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const body        = await req.json();
    const event_type  = body.event_type as string;
    const details     = (body.details ?? {}) as Record<string, unknown>;
    // Merge top-level agent_name into details for convenience
    if (body.agent_name && !details.agent_name) details.agent_name = body.agent_name;

    const payload = buildPayload(event_type, details);
    if (!payload) {
      return new Response(
        JSON.stringify({ error: `Unknown event_type: ${event_type}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // v26 NO-SPAM RULE · resolveDiscordWebhook throws "DISCORD_SUPPRESSED"
    // when the kill switch is on or rate limit is exceeded. Catch + return
    // ok=false silently — no error to the caller.
    let webhookUrl: string;
    try {
      webhookUrl = await resolveDiscordWebhook(supabase, getDiscordAudience(event_type));
    } catch (err: any) {
      if (err?.message === "DISCORD_SUPPRESSED") {
        console.log(`[discord-webhook-notify] suppressed event_type=${event_type}`);
        return new Response(
          JSON.stringify({ ok: true, suppressed: true, event_type }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      throw err;
    }
    await sendToDiscord(webhookUrl, payload);

    // After deal_closed: auto-check monthly milestones
    if (event_type === "deal_closed" && details.agent_id && details.aop) {
      checkAndFireMilestone(
        supabase,
        webhookUrl,
        details.agent_id as string,
        Number(details.aop),
      ).catch((err) =>
        logAnnounceFailure(
          supabase,
          `milestone check failed agent_id=${details.agent_id} aop=${details.aop}: ${String(err)}`,
        )
      );
    }

    return new Response(
      JSON.stringify({ ok: true, event_type }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
