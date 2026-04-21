/**
 * morning-brief — 6am CST daily
 *
 * Auto-generates today's huddle from live DB state and:
 *   1. Emails Sam the full dark-themed briefing
 *   2. Posts the leaderboard + target to Discord
 *
 * No dependency on external IM providers — WhatsApp is handled by
 * the /today page's copy/share button since we don't have Twilio.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { Resend } from "https://esm.sh/resend@2.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function fmt$(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}k`;
  return `$${Math.round(n).toLocaleString()}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const sb = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );

  try {
    const now = new Date();
    const day = now.getDay();
    const dow = (day + 6) % 7; // Mon=0 … Sun=6
    const monday = new Date(now); monday.setDate(now.getDate() - dow);
    const mondayStr = monday.toISOString().slice(0, 10);
    const sundayStr = new Date(monday.getTime() + 6 * 86_400_000).toISOString().slice(0, 10);
    const weekAgo   = new Date(Date.now() - 7 * 86_400_000).toISOString();

    const [
      { data: prod },
      { data: agents },
      { count: pipeline },
      { count: uncontacted },
      { count: contractedWeek },
    ] = await Promise.all([
      sb.from("daily_production").select("agent_id, aop")
        .gte("production_date", mondayStr).lte("production_date", sundayStr),
      sb.from("agents").select("id, profile:profiles(full_name)")
        .eq("is_deactivated", false).eq("is_inactive", false).eq("status", "active"),
      sb.from("applications").select("id", { count: "exact", head: true })
        .is("terminated_at", null).is("contracted_at", null),
      sb.from("applications").select("id", { count: "exact", head: true })
        .is("terminated_at", null).is("contacted_at", null),
      sb.from("applications").select("id", { count: "exact", head: true })
        .gte("contracted_at", weekAgo).is("terminated_at", null),
    ]);

    const nameMap: Record<string, string> = {};
    for (const a of (agents ?? []) as any[]) nameMap[a.id] = a.profile?.full_name ?? "Agent";

    const totals: Record<string, number> = {};
    let weekAlp = 0;
    for (const r of (prod ?? []) as any[]) {
      const n = Number(r.aop ?? 0); weekAlp += n;
      totals[r.agent_id] = (totals[r.agent_id] ?? 0) + n;
    }
    const top5 = Object.entries(totals).map(([id, alp]) => ({ name: nameMap[id] ?? "Agent", alp }))
      .sort((a, b) => b.alp - a.alp).slice(0, 5);

    const recruitTargetToday = Math.min(5, Math.max(1, Math.ceil(((pipeline as any) ?? 0) / 15)));
    const prodTargetToday    = Math.max(500, Math.round((weekAlp / 7) * 1.2));

    // ── 1. Discord leaderboard post ──
    const webhookUrl = Deno.env.get("DISCORD_WEBHOOK_URL");
    if (webhookUrl && top5.length > 0) {
      const medals = ["🥇", "🥈", "🥉"];
      const desc = top5.map((e, i) => `${i < 3 ? medals[i] : `${i + 1}.`} **${e.name}** — ${fmt$(e.alp)}`).join("\n");
      await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          embeds: [{
            title: `☀️ APEX Morning Huddle — ${now.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}`,
            description:
`**Today's target:** Close **${recruitTargetToday}** recruit${recruitTargetToday > 1 ? "s" : ""} · Hit **${fmt$(prodTargetToday)}** team ALP.

🏆 Top 5 This Week:
${desc}

Pipeline: ${(pipeline as any) ?? 0} live · ${(uncontacted as any) ?? 0} uncontacted · ${(contractedWeek as any) ?? 0} new contracts last 7 days.

Let's go. 💥`,
            color: 0x22d3a5,
            footer: { text: "APEX Financial · Morning Brief" },
            timestamp: now.toISOString(),
          }],
        }),
      }).catch(() => {});
    }

    // ── 2. Email Sam ──
    const adminEmail = Deno.env.get("ADMIN_EMAIL") ?? "info@kingofsales.net";
    const resendKey  = Deno.env.get("RESEND_API_KEY");
    if (resendKey) {
      const resend = new Resend(resendKey);
      const topRows = top5.map((e, i) => `<tr><td style="padding:6px 10px;color:#64748b">${i + 1}.</td><td style="padding:6px 10px;color:#f8fafc;font-weight:600">${e.name}</td><td style="padding:6px 10px;color:#22d3a5;text-align:right;font-weight:700">${fmt$(e.alp)}</td></tr>`).join("");
      await resend.emails.send({
        from: "APEX Brief <notifications@apex-financial.org>",
        to: [adminEmail],
        subject: `☀️ APEX morning brief — close ${recruitTargetToday} · hit ${fmt$(prodTargetToday)}`,
        html: `<div style="font-family:'DM Sans',Arial;background:#030712;color:#e2e8f0;padding:32px 16px;">
<div style="max-width:600px;margin:0 auto;background:#0d1526;border:1px solid #22d3a540;border-radius:16px;padding:32px;">
  <h1 style="font-family:Syne,sans-serif;color:#22d3a5;margin:0 0 4px 0;font-size:26px;">☀️ Morning Brief</h1>
  <p style="color:#94a3b8;font-size:13px;margin:0 0 24px 0;">${now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}</p>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:16px 0;">
    <div style="background:rgba(244,113,113,0.15);border:1px solid rgba(244,113,113,0.4);border-radius:12px;padding:16px;">
      <div style="color:#fda4af;font-size:10px;letter-spacing:2px;text-transform:uppercase;">Recruit Target</div>
      <div style="color:#fecaca;font-size:32px;font-weight:800;">${recruitTargetToday}</div>
    </div>
    <div style="background:rgba(245,158,11,0.15);border:1px solid rgba(245,158,11,0.4);border-radius:12px;padding:16px;">
      <div style="color:#fcd34d;font-size:10px;letter-spacing:2px;text-transform:uppercase;">ALP Target</div>
      <div style="color:#fef3c7;font-size:32px;font-weight:800;">${fmt$(prodTargetToday)}</div>
    </div>
  </div>
  <h2 style="color:#f8fafc;font-size:16px;margin:28px 0 8px 0;">🏆 Top 5 This Week</h2>
  <table style="width:100%;border-collapse:collapse;background:rgba(15,23,42,0.5);border-radius:10px;overflow:hidden;">${topRows || `<tr><td style="padding:12px;color:#94a3b8">No production logged yet</td></tr>`}</table>
  <h2 style="color:#f8fafc;font-size:16px;margin:28px 0 8px 0;">📋 Quick Stats</h2>
  <ul style="color:#e2e8f0;font-size:14px;line-height:1.8;padding-left:18px;">
    <li>Pipeline live: <strong>${(pipeline as any) ?? 0}</strong> · Uncontacted: <strong>${(uncontacted as any) ?? 0}</strong></li>
    <li>New contracts last 7 days: <strong>${(contractedWeek as any) ?? 0}</strong></li>
    <li>Week ALP so far: <strong>${fmt$(weekAlp)}</strong></li>
    <li>Active producers this week: <strong>${Object.keys(totals).length}</strong></li>
  </ul>
  <div style="text-align:center;margin:28px 0 8px 0;">
    <a href="https://apexfinaincial.vercel.app/dashboard/today" style="display:inline-block;background:#22d3a5;color:#030712;font-family:Syne,sans-serif;font-weight:700;padding:14px 28px;border-radius:10px;text-decoration:none;letter-spacing:0.5px;">OPEN TODAY PAGE →</a>
  </div>
  <p style="color:#64748b;font-size:11px;text-align:center;margin-top:28px;letter-spacing:2px;">APEX FINANCIAL · BUILDING EMPIRES</p>
</div>
</div>`,
      }).catch(() => {});
    }

    // Log
    await sb.from("automation_runs").insert({
      automation_name: "morning-brief",
      status: "success",
      metadata: { recruit_target: recruitTargetToday, prod_target: prodTargetToday, top5 },
    }).catch(() => {});

    return new Response(JSON.stringify({
      ok: true, recruit_target: recruitTargetToday, prod_target: prodTargetToday,
      top5, pipeline: (pipeline as any) ?? 0,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
