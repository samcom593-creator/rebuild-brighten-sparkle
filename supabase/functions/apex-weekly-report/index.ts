// Sunday 6pm CST weekly report (v2 — strategy email, kept dense).
//
// This is the ONE depth email — week-over-week deltas, sub-bot pressure,
// top-5 criticals to act on. No daily pollution; this is where you plan.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { Resend } from "https://esm.sh/resend@2.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SAM_EMAIL = "info@kingofsales.net";
const SAM_PHONE = "4697676068";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);
const resend = new Resend(Deno.env.get("RESEND_API_KEY") ?? "");

function ymd(d: Date) { return d.toISOString().slice(0, 10); }
function fmt$(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}k`;
  return `$${Math.round(n)}`;
}

async function sumMetric(key: string, startDate: string, endDate: string): Promise<number> {
  const { data } = await supabase.from("bot_metrics_snapshots")
    .select("metric_value").eq("metric_key", key)
    .gte("snapshot_date", startDate).lte("snapshot_date", endDate);
  return (data ?? []).reduce((s: number, r: any) => s + Number(r.metric_value ?? 0), 0);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const today = new Date();
  const thisStart = new Date(today); thisStart.setDate(today.getDate() - 6);
  const lastStart = new Date(today); lastStart.setDate(today.getDate() - 13);
  const lastEnd = new Date(today); lastEnd.setDate(today.getDate() - 7);
  const tw = { start: ymd(thisStart), end: ymd(today) };
  const lw = { start: ymd(lastStart), end: ymd(lastEnd) };

  const KEYS = ["daily.aop", "daily.deals", "daily.apps", "daily.contacted", "daily.dm_inbound"];
  const HUMAN: Record<string, string> = {
    "daily.aop": "ALP",
    "daily.deals": "Deals closed",
    "daily.apps": "New applications",
    "daily.contacted": "Applicants contacted",
    "daily.dm_inbound": "DMs received",
  };
  const rows: Array<{ key: string; t: number; l: number }> = [];
  for (const k of KEYS) {
    const [t, l] = await Promise.all([sumMetric(k, tw.start, tw.end), sumMetric(k, lw.start, lw.end)]);
    rows.push({ key: k, t, l });
  }

  const { data: wkAudits } = await supabase.from("bot_audits")
    .select("sub_bot, severity").gte("created_at", tw.start + "T00:00:00Z");
  const subbotScore: Record<string, { warn: number; critical: number }> = {};
  for (const a of wkAudits ?? []) {
    const sb = (a as any).sub_bot; const sv = (a as any).severity;
    if (!subbotScore[sb]) subbotScore[sb] = { warn: 0, critical: 0 };
    if (sv === "warn") subbotScore[sb].warn++;
    if (sv === "critical") subbotScore[sb].critical++;
  }
  const subbotRanked = Object.entries(subbotScore)
    .sort((a, b) => (b[1].critical * 3 + b[1].warn) - (a[1].critical * 3 + a[1].warn));

  const { data: criticals } = await supabase.from("bot_audits")
    .select("sub_bot, audit_name, summary, action, action_link, finding_count, created_at")
    .gte("created_at", tw.start + "T00:00:00Z").eq("severity", "critical")
    .order("finding_count", { ascending: false }).limit(5);

  const metricLine = (r: typeof rows[number]) => {
    const delta = r.l > 0 ? ((r.t - r.l) / r.l) * 100 : (r.t > 0 ? 100 : 0);
    const arrow = r.t > r.l ? "▲" : r.t < r.l ? "▼" : "=";
    const color = r.t > r.l ? "#16a34a" : r.t < r.l ? "#dc2626" : "#64748b";
    const val = r.key === "daily.aop" ? fmt$(r.t) : String(Math.round(r.t));
    const prev = r.key === "daily.aop" ? fmt$(r.l) : String(Math.round(r.l));
    return `<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f1f5f9">
<div style="color:#334155">${HUMAN[r.key]}</div>
<div><strong>${val}</strong> <span style="color:#94a3b8;font-size:13px">was ${prev}</span> <span style="color:${color};font-weight:600">${arrow}${Math.abs(delta).toFixed(0)}%</span></div>
</div>`;
  };

  const aopT = rows.find(r => r.key === "daily.aop")?.t ?? 0;
  const aopL = rows.find(r => r.key === "daily.aop")?.l ?? 0;
  const wow = aopL > 0 ? ((aopT - aopL) / aopL) * 100 : (aopT > 0 ? 100 : 0);

  const html = `<div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;max-width:640px;margin:0 auto;padding:24px;color:#0f172a;line-height:1.5">
<h2 style="margin:0 0 4px">📊 Week · ${tw.start} → ${tw.end}</h2>
<p style="color:#64748b;margin:0 0 20px;font-size:14px">${fmt$(aopT)} ALP · ${wow >= 0 ? "+" : ""}${wow.toFixed(0)}% WoW</p>

<div style="margin-bottom:24px">${rows.map(metricLine).join("")}</div>

<h3 style="font-size:14px;margin:24px 0 8px;color:#0f172a">Where the pressure is</h3>
${subbotRanked.length
  ? subbotRanked.map(([sb, v]) => `<div style="padding:4px 0;color:#334155"><strong>${sb}</strong> · ${v.critical ? `<span style="color:#dc2626">${v.critical} critical</span> ·` : ""} ${v.warn} warnings</div>`).join("")
  : `<div style="color:#64748b">Zero flagged findings. Clean week.</div>`}

<h3 style="font-size:14px;margin:24px 0 8px;color:#0f172a">Recommended changes (top 5 criticals)</h3>
${(criticals ?? []).length
  ? `<ol style="padding-left:18px;margin:0">${(criticals ?? []).map((c: any) => `<li style="margin:8px 0"><strong>${c.summary}</strong>${c.action ? `<br><span style="color:#64748b">→ ${c.action}</span>` : ""}${c.action_link ? ` · <a href="${c.action_link}" style="color:#0ea5e9">open</a>` : ""}</li>`).join("")}</ol>`
  : `<div style="color:#64748b">No criticals this week.</div>`}
</div>`;

  const sms = `APEX wk: ${fmt$(aopT)} ALP ${wow >= 0 ? "+" : ""}${wow.toFixed(0)}% WoW · top: ${subbotRanked[0]?.[0] ?? "clean"}`.slice(0, 90);

  try {
    await resend.emails.send({
      from: "APEX <sam@apex-financial.org>",
      to: SAM_EMAIL,
      subject: `📊 Week · ${fmt$(aopT)} · ${wow >= 0 ? "+" : ""}${wow.toFixed(0)}% WoW`,
      html,
    });
  } catch (e) { console.error("[weekly] email", e); }
  try {
    await supabase.functions.invoke("send-sms-auto-detect", { body: { phone: SAM_PHONE, message: sms } });
  } catch (e) { console.error("[weekly] sms", e); }

  return new Response(JSON.stringify({ ok: true, this_week: tw, last_week: lw, metrics: rows, subbot_rank: subbotRanked }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
