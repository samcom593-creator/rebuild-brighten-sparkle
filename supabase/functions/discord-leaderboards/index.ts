/**
 * discord-leaderboards — scheduled leaderboard engine
 *
 * Called by pg_cron at 9pm EST (02:00 UTC):
 *   daily     — every day
 *   weekly    — Sundays only (cron filters)
 *   pipeline  — every day
 *
 * Body: { type: "daily" | "weekly" | "pipeline" }
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { resolveDiscordWebhook } from "../_shared/apex.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-request-id, idempotency-key",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const CLR = { blue: 0x3b82f6, purple: 0x8b5cf6, cyan: 0x06b6d4 };

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
const MEDALS = ["🥇", "🥈", "🥉"];
function rank(i: number): string { return i < 3 ? MEDALS[i] : `${i + 1}.`; }

function isoDate(d: Date): string { return d.toISOString().split("T")[0]; }

async function post(webhookUrl: string, payload: Record<string, unknown>): Promise<void> {
  const backoff = [0, 800, 2000, 5000];
  for (let i = 0; i < 4; i++) {
    if (i > 0) await new Promise(r => setTimeout(r, backoff[i]));
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.status === 429) {
      const body = await res.json().catch(() => ({}));
      await new Promise(r => setTimeout(r, ((body as { retry_after?: number }).retry_after ?? 2) * 1000));
      continue;
    }
    if (res.ok || res.status === 204) return;
    if (i === 3) throw new Error(`Discord ${res.status}`);
  }
}

// ─── Daily Leaderboard ───────────────────────────────────────────────────────
async function buildDaily(sb: ReturnType<typeof createClient>): Promise<Record<string, unknown>> {
  const today = isoDate(new Date());

  const { data: rows } = await sb.rpc("get_daily_leaderboard", { p_date: today });

  const entries = ((rows ?? []) as Array<{ full_name: string; instagram_handle: string | null; aop: number }>)
    .slice(0, 10)
    .map((r, i) => ({ rank: i + 1, name: r.full_name, aop: Number(r.aop), instagram: r.instagram_handle }));

  const date_label = new Date().toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
  const desc = entries.length
    ? entries.map((e, i) => `${rank(i)} **${e.name}${ig(e.instagram)}** — ${fmt$(e.aop)}`).join("\n")
    : "*No production logged today yet*";

  return {
    embeds: [{
      title:       `📊 Daily Leaderboard — ${date_label}`,
      description: desc,
      color:       CLR.blue,
      footer:      { text: "Top 10 producers by ALP · Posted 9pm CT" },
      timestamp:   new Date().toISOString(),
      url:         "https://apex-financial.org/dashboard/leaderboard",
    }],
    content: "[📊 View full leaderboard →](https://apex-financial.org/dashboard/leaderboard)",
  };
}

// ─── Weekly Leaderboard ──────────────────────────────────────────────────────
async function buildWeekly(sb: ReturnType<typeof createClient>): Promise<Record<string, unknown>> {
  const now   = new Date();
  // Week starts Monday
  const dayOfWeek = (now.getDay() + 6) % 7; // Mon=0 … Sun=6
  const monday = new Date(now);
  monday.setDate(now.getDate() - dayOfWeek);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);

  const { data: rows } = await sb.rpc("get_weekly_leaderboard", {
    p_start: isoDate(monday),
    p_end:   isoDate(sunday),
  });

  const entries = ((rows ?? []) as Array<{ full_name: string; instagram_handle: string | null; weekly_aop: number }>)
    .slice(0, 10)
    .map((r, i) => ({ rank: i + 1, name: r.full_name, weekly_alp: Number(r.weekly_aop), instagram: r.instagram_handle }));

  const monLabel = monday.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const sunLabel = sunday.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const week_range = `${monLabel}–${sunLabel}`;

  const desc = entries.length
    ? entries.map((e, i) => `${rank(i)} **${e.name}${ig(e.instagram)}** — ${fmt$(e.weekly_alp)}`).join("\n")
    : "*No production logged this week yet*";

  return {
    embeds: [{
      title:       `🏆 Weekly Leaderboard — ${week_range}`,
      description: desc,
      color:       CLR.purple,
      footer:      { text: "Top 10 weekly producers (Mon-Sun) · Posted Sundays 9pm CT" },
      timestamp:   new Date().toISOString(),
      url:         "https://apex-financial.org/dashboard/leaderboard?period=weekly",
    }],
    content: "[🏆 Open weekly leaderboard →](https://apex-financial.org/dashboard/leaderboard?period=weekly)",
  };
}

// ─── Pipeline Leaderboard ────────────────────────────────────────────────────
async function buildPipeline(sb: ReturnType<typeof createClient>): Promise<Record<string, unknown>> {
  const now = new Date();
  const monthStart = isoDate(new Date(now.getFullYear(), now.getMonth(), 1));
  const today      = isoDate(now);

  // Stage counts
  const { data: stageCounts } = await sb
    .from("applications")
    .select("license_progress, license_status")
    .is("closed_at", null)
    .is("terminated_at", null);

  const counts: Record<string, number> = {
    new_applicant:       0,
    unlicensed:          0,
    course_purchased:    0,
    finished_course:     0,
    test_scheduled:      0,
    passed_test:         0,
    fingerprints_done:   0,
    waiting_on_license:  0,
    licensed:            0,
  };
  for (const row of (stageCounts ?? []) as Array<{ license_progress: string | null; license_status: string }>) {
    const stage = row.license_status === "licensed" ? "licensed" : (row.license_progress ?? "new_applicant");
    if (stage in counts) counts[stage]++;
  }

  const STAGE_EMOJI: Record<string, string> = {
    new_applicant:      "📥 New",
    unlicensed:         "📣 Needs Outreach",
    course_purchased:   "📚 In Course",
    finished_course:    "✅ Course Done",
    test_scheduled:     "📝 Test Phase",
    passed_test:        "🎯 Test Passed",
    fingerprints_done:  "🔍 Fingerprints",
    waiting_on_license: "⏳ Waiting on License",
    licensed:           "🏆 Licensed",
  };

  const stageSummary = Object.entries(counts)
    .filter(([, n]) => n > 0)
    .map(([s, n]) => `${STAGE_EMOJI[s] ?? s}: **${n}**`)
    .join("  ·  ");

  // Fastest to license this month
  const { data: fastRows } = await sb
    .from("applications")
    .select("first_name, last_name, instagram_handle, created_at, licensed_at")
    .eq("license_status", "licensed")
    .gte("licensed_at", monthStart)
    .lte("licensed_at", today)
    .not("licensed_at", "is", null)
    .order("licensed_at", { ascending: true })
    .limit(5);

  const fastest = ((fastRows ?? []) as Array<{
    first_name: string; last_name: string;
    instagram_handle: string | null;
    created_at: string; licensed_at: string;
  }>).map(r => {
    const days = Math.round(
      (new Date(r.licensed_at).getTime() - new Date(r.created_at).getTime()) / 86_400_000
    );
    return { name: `${r.first_name} ${r.last_name}`, days, instagram: r.instagram_handle };
  });

  // Manager completion rates (this month)
  const { data: managerRows } = await sb
    .from("applications")
    .select("hiring_manager_user_id, license_status")
    .gte("created_at", monthStart)
    .not("hiring_manager_user_id", "is", null);

  const mgMap: Record<string, { total: number; licensed: number }> = {};
  for (const r of (managerRows ?? []) as Array<{ hiring_manager_user_id: string; license_status: string }>) {
    if (!mgMap[r.hiring_manager_user_id]) mgMap[r.hiring_manager_user_id] = { total: 0, licensed: 0 };
    mgMap[r.hiring_manager_user_id].total++;
    if (r.license_status === "licensed") mgMap[r.hiring_manager_user_id].licensed++;
  }

  // Resolve manager names
  const managerIds = Object.keys(mgMap);
  const { data: profiles } = managerIds.length
    ? await sb.from("profiles").select("user_id, full_name").in("user_id", managerIds)
    : { data: [] };

  const nameMap: Record<string, string> = {};
  for (const p of (profiles ?? []) as Array<{ user_id: string; full_name: string | null }>) {
    nameMap[p.user_id] = p.full_name ?? "Manager";
  }

  const completionRates = Object.entries(mgMap)
    .filter(([, v]) => v.total >= 3)
    .map(([id, v]) => ({
      manager:  nameMap[id] ?? "Manager",
      rate:     Math.round((v.licensed / v.total) * 100),
      licensed: v.licensed,
      total:    v.total,
    }))
    .sort((a, b) => b.rate - a.rate)
    .slice(0, 5);

  const fastLines = fastest.length
    ? fastest.map((e, i) => `${rank(i)} ${e.name}${ig(e.instagram)} — ${e.days}d`).join("\n")
    : "*No licenses issued this month yet*";

  const rateLines = completionRates.length
    ? completionRates.map((e, i) => `${rank(i)} ${e.manager} — ${e.rate}% (${e.licensed}/${e.total})`).join("\n")
    : "*Not enough data yet*";

  const dateLabel = now.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });

  return {
    embeds: [{
      title:       `📋 New Hire Pipeline — ${dateLabel}`,
      description: stageSummary || "*Pipeline is empty*",
      color:       CLR.cyan,
      fields: [
        { name: "⚡ Fastest to License (MTD)", value: fastLines, inline: false },
        { name: "📈 Manager Completion Rate",  value: rateLines, inline: false },
      ],
      footer:    { text: "Ranked by activation speed and licensing completion rate · Posted 9pm CT" },
      timestamp: new Date().toISOString(),
    }],
  };
}

// ─── Main ─────────────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const sb = createClient(
      Deno.env.get("SUPABASE_URL")              ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } }
    );

    const { type } = await req.json();
    if (!type) throw new Error("Missing type: daily | weekly | pipeline");

    const webhookUrl = await resolveDiscordWebhook(sb, type === "pipeline" ? "recruiting" : "production");

    let payload: Record<string, unknown>;
    if      (type === "daily")    payload = await buildDaily(sb);
    else if (type === "weekly")   payload = await buildWeekly(sb);
    else if (type === "pipeline") payload = await buildPipeline(sb);
    else throw new Error(`Unknown type: ${type}`);

    await post(webhookUrl, payload);

    return new Response(
      JSON.stringify({ ok: true, type }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// redeploy-bump: 1776703450
