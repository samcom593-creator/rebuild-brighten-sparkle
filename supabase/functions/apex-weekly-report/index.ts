// Sunday 6pm CST weekly report (v3 — branded strategy email).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { Resend } from "https://esm.sh/resend@2.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SAM_EMAIL = "info@kingofsales.net";
const SAM_PHONE = "4697676068";
const BRAND_URL = "https://apex-financial.org";

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

function shell(opts: { subject: string; heroTag: string; heroTitle: string; heroSub: string; heroColor?: string; body: string }) {
  const heroColor = opts.heroColor ?? "#10b981";
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${opts.subject}</title></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Arial,sans-serif;color:#0f172a">
<div style="max-width:640px;margin:0 auto;padding:24px 16px">
<div style="padding:4px 0 16px"><table cellpadding="0" cellspacing="0" border="0"><tr><td style="width:32px"><div style="width:28px;height:28px;background:#0f172a;color:#fff;border-radius:6px;text-align:center;line-height:28px;font-weight:800;font-size:13px;letter-spacing:1px">A</div></td><td style="padding-left:10px"><div style="font-weight:700;letter-spacing:0.5px;font-size:13px">APEX</div><div style="font-size:11px;color:#64748b;margin-top:-2px">Autonomous Engine · Weekly</div></td></tr></table></div>
<div style="background:#0f172a;color:#fff;padding:24px 22px;border-radius:12px;margin-bottom:18px">
<div style="font-size:11px;font-weight:700;letter-spacing:1.5px;opacity:0.6;text-transform:uppercase">${opts.heroTag}</div>
<div style="font-size:30px;font-weight:800;margin-top:4px;color:${heroColor}">${opts.heroTitle}</div>
<div style="font-size:14px;opacity:0.82;margin-top:4px">${opts.heroSub}</div>
</div>
<div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:24px">${opts.body}</div>
<div style="text-align:center;padding:20px 0 10px;font-size:11px;color:#64748b"><a href="${BRAND_URL}" style="color:#64748b;text-decoration:none">${BRAND_URL}</a> &middot; autonomous engine</div>
</div></body></html>`;
}

function statRow(label: string, value: string, prev: string, delta: number): string {
  const arrow = delta > 0 ? "▲" : delta < 0 ? "▼" : "=";
  const color = delta > 0 ? "#16a34a" : delta < 0 ? "#dc2626" : "#64748b";
  return `<div style="display:flex;justify-content:space-between;align-items:baseline;padding:10px 0;border-bottom:1px solid #e2e8f0">
<div style="color:#334155;font-size:14px">${label}</div>
<div>
<span style="font-weight:700;font-size:15px">${value}</span>
<span style="color:#94a3b8;font-size:12px;margin-left:8px">was ${prev}</span>
<span style="color:${color};font-weight:600;margin-left:8px;font-size:13px">${arrow} ${Math.abs(delta).toFixed(0)}%</span>
</div>
</div>`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const today = new Date();
  const thisStart = new Date(today); thisStart.setDate(today.getDate() - 6);
  const lastStart = new Date(today); lastStart.setDate(today.getDate() - 13);
  const lastEnd = new Date(today); lastEnd.setDate(today.getDate() - 7);
  const tw = { start: ymd(thisStart), end: ymd(today) };
  const lw = { start: ymd(lastStart), end: ymd(lastEnd) };

  const HUMAN: Record<string, string> = {
    "daily.aop": "Team ALP",
    "daily.deals": "Deals closed",
    "daily.apps": "New applications",
    "daily.contacted": "Applicants contacted",
    "daily.dm_inbound": "DMs received",
  };
  const KEYS = Object.keys(HUMAN);
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
    .select("sub_bot, audit_name, summary, action, action_link, finding_count")
    .gte("created_at", tw.start + "T00:00:00Z").eq("severity", "critical")
    .order("finding_count", { ascending: false }).limit(5);

  const aopT = rows.find(r => r.key === "daily.aop")?.t ?? 0;
  const aopL = rows.find(r => r.key === "daily.aop")?.l ?? 0;
  const wow = aopL > 0 ? ((aopT - aopL) / aopL) * 100 : (aopT > 0 ? 100 : 0);
  const heroColor = aopT >= aopL ? "#10b981" : "#f87171";

  const metricsBlock = rows.map(r => {
    const d = r.l > 0 ? ((r.t - r.l) / r.l) * 100 : (r.t > 0 ? 100 : 0);
    const val = r.key === "daily.aop" ? fmt$(r.t) : String(Math.round(r.t));
    const prev = r.key === "daily.aop" ? fmt$(r.l) : String(Math.round(r.l));
    return statRow(HUMAN[r.key], val, prev, d);
  }).join("");

  const pressureBlock = subbotRanked.length
    ? subbotRanked.map(([sb, v]) => `<div style="padding:7px 0;color:#334155;font-size:14px"><strong style="text-transform:capitalize">${sb.replace(/_/g, " ")}</strong> &middot; ${v.critical ? `<span style="color:#dc2626;font-weight:600">${v.critical} critical</span> &middot;` : ""} <span style="color:#d97706">${v.warn} warn</span></div>`).join("")
    : `<div style="color:#64748b;font-size:14px">Zero flagged findings. Clean week.</div>`;

  const criticalsBlock = (criticals ?? []).length
    ? `<ol style="padding-left:18px;margin:0">${(criticals ?? []).map((c: any) => `<li style="margin:10px 0;color:#0f172a"><strong>${c.summary}</strong>${c.action ? `<br><span style="color:#334155;font-size:14px">&rarr; ${c.action}</span>` : ""}${c.action_link ? `<br><a href="${c.action_link}" style="color:#0ea5e9;font-size:13px;text-decoration:none">Open in APEX &rarr;</a>` : ""}</li>`).join("")}</ol>`
    : `<div style="color:#64748b;font-size:14px">No criticals this week. Good signal.</div>`;

  const bodyHtml = `
<div style="margin-bottom:22px">${metricsBlock}</div>

<div style="margin-bottom:22px">
<div style="font-size:12px;font-weight:700;letter-spacing:1px;color:#64748b;text-transform:uppercase;margin-bottom:8px">Where the pressure is</div>
${pressureBlock}
</div>

<div>
<div style="font-size:12px;font-weight:700;letter-spacing:1px;color:#64748b;text-transform:uppercase;margin-bottom:8px">Top-5 critical recommendations</div>
${criticalsBlock}
</div>`;

  const html = shell({
    subject: `APEX weekly · ${tw.start} → ${tw.end}`,
    heroTag: `WEEK · ${tw.start} → ${tw.end}`,
    heroTitle: `${fmt$(aopT)}`,
    heroSub: `${wow >= 0 ? "+" : ""}${wow.toFixed(0)}% WoW · ${subbotRanked[0]?.[0]?.replace(/_/g, " ") ?? "clean"} ${subbotRanked[0] ? "needs attention" : "week"}`,
    heroColor,
    body: bodyHtml,
  });

  const sms = `APEX week: ${fmt$(aopT)} ALP · ${wow >= 0 ? "+" : ""}${wow.toFixed(0)}% WoW · focus: ${subbotRanked[0]?.[0]?.replace(/_/g, " ") ?? "clean"}`.slice(0, 90);

  try {
    await resend.emails.send({
      from: "APEX Engine <sam@apex-financial.org>",
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
