// Sunday 6pm CST weekly performance report.
// Week-over-week comparison from bot_metrics_snapshots + sub-bot rankings.

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
  return `$${n.toFixed(0)}`;
}

async function sumMetric(key: string, startDate: string, endDate: string): Promise<number> {
  const { data } = await supabase
    .from("bot_metrics_snapshots")
    .select("metric_value")
    .eq("metric_key", key)
    .gte("snapshot_date", startDate)
    .lte("snapshot_date", endDate);
  return (data ?? []).reduce((s: number, r: any) => s + Number(r.metric_value ?? 0), 0);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const today = new Date();
  const startThis = new Date(today); startThis.setDate(today.getDate() - 6);
  const startLast = new Date(today); startLast.setDate(today.getDate() - 13);
  const endLast = new Date(today); endLast.setDate(today.getDate() - 7);

  const thisWeek = { start: ymd(startThis), end: ymd(today) };
  const lastWeek = { start: ymd(startLast), end: ymd(endLast) };

  // Core WoW metrics
  const KEYS = ["daily.aop", "daily.deals", "daily.apps", "daily.contacted", "daily.dm_inbound"];
  const rows: Array<{ key: string; thisW: number; lastW: number }> = [];
  for (const k of KEYS) {
    const [t, l] = await Promise.all([
      sumMetric(k, thisWeek.start, thisWeek.end),
      sumMetric(k, lastWeek.start, lastWeek.end),
    ]);
    rows.push({ key: k, thisW: t, lastW: l });
  }

  // Sub-bot ranking: count warn+critical findings per sub_bot this week
  const { data: wkAudits } = await supabase
    .from("bot_audits")
    .select("sub_bot, severity")
    .gte("created_at", thisWeek.start + "T00:00:00Z");
  const subbotScore: Record<string, { warn: number; critical: number }> = {};
  for (const a of wkAudits ?? []) {
    const sb = (a as any).sub_bot; const sv = (a as any).severity;
    if (!subbotScore[sb]) subbotScore[sb] = { warn: 0, critical: 0 };
    if (sv === "warn") subbotScore[sb].warn++;
    if (sv === "critical") subbotScore[sb].critical++;
  }
  const subbotRanked = Object.entries(subbotScore).sort((a, b) => {
    const aS = a[1].critical * 3 + a[1].warn;
    const bS = b[1].critical * 3 + b[1].warn;
    return bS - aS;
  });

  const fmtRow = (r: typeof rows[number]) => {
    const delta = r.lastW > 0 ? ((r.thisW - r.lastW) / r.lastW) * 100 : (r.thisW > 0 ? 100 : 0);
    const arrow = r.thisW > r.lastW ? "▲" : r.thisW < r.lastW ? "▼" : "=";
    const color = r.thisW > r.lastW ? "#16a34a" : r.thisW < r.lastW ? "#dc2626" : "#64748b";
    const val = r.key.startsWith("daily.aop") ? fmt$(r.thisW) : String(Math.round(r.thisW));
    const prev = r.key.startsWith("daily.aop") ? fmt$(r.lastW) : String(Math.round(r.lastW));
    return `<tr>
      <td style="padding:6px;border-bottom:1px solid #e5e7eb">${r.key}</td>
      <td style="padding:6px;text-align:right;border-bottom:1px solid #e5e7eb"><strong>${val}</strong></td>
      <td style="padding:6px;text-align:right;border-bottom:1px solid #e5e7eb;color:#64748b">${prev}</td>
      <td style="padding:6px;text-align:right;border-bottom:1px solid #e5e7eb;color:${color}">${arrow} ${delta.toFixed(0)}%</td>
    </tr>`;
  };

  // Recommended system changes = top-5 critical audits this week
  const { data: criticals } = await supabase
    .from("bot_audits")
    .select("sub_bot, audit_name, summary, action, action_link, finding_count, created_at")
    .gte("created_at", thisWeek.start + "T00:00:00Z")
    .eq("severity", "critical")
    .order("finding_count", { ascending: false })
    .limit(5);

  const html = `
<div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;max-width:720px;margin:0 auto;padding:24px;color:#0f172a">
  <h1 style="margin:0 0 4px">📊 APEX weekly report · ${thisWeek.start} → ${thisWeek.end}</h1>
  <p style="color:#64748b;margin:0 0 24px">Week-over-week deltas + sub-bot pressure map + recommended changes.</p>

  <h2 style="font-size:15px;margin-bottom:6px">Core metrics (WoW)</h2>
  <table style="width:100%;border-collapse:collapse;font-size:13px">
    <thead><tr style="background:#f9fafb">
      <th style="padding:6px;text-align:left;border-bottom:1px solid #e5e7eb">metric</th>
      <th style="padding:6px;text-align:right;border-bottom:1px solid #e5e7eb">this week</th>
      <th style="padding:6px;text-align:right;border-bottom:1px solid #e5e7eb">last week</th>
      <th style="padding:6px;text-align:right;border-bottom:1px solid #e5e7eb">Δ</th>
    </tr></thead>
    <tbody>${rows.map(fmtRow).join("")}</tbody>
  </table>

  <h2 style="font-size:15px;margin-top:24px;margin-bottom:6px">Sub-bot pressure (warn+critical findings this week)</h2>
  <table style="width:100%;border-collapse:collapse;font-size:13px">
    <thead><tr style="background:#f9fafb">
      <th style="padding:6px;text-align:left;border-bottom:1px solid #e5e7eb">sub-bot</th>
      <th style="padding:6px;text-align:right;border-bottom:1px solid #e5e7eb">critical</th>
      <th style="padding:6px;text-align:right;border-bottom:1px solid #e5e7eb">warn</th>
    </tr></thead>
    <tbody>${subbotRanked.map(([sb, v]) => `<tr>
      <td style="padding:6px;border-bottom:1px solid #e5e7eb">${sb}</td>
      <td style="padding:6px;text-align:right;border-bottom:1px solid #e5e7eb;color:#dc2626">${v.critical}</td>
      <td style="padding:6px;text-align:right;border-bottom:1px solid #e5e7eb;color:#d97706">${v.warn}</td>
    </tr>`).join("") || `<tr><td colspan="3" style="padding:6px;color:#64748b">No flagged findings this week.</td></tr>`}</tbody>
  </table>

  <h2 style="font-size:15px;margin-top:24px;margin-bottom:6px">Recommended system changes (top 5 criticals)</h2>
  <ol>${(criticals ?? []).map((c: any) => `<li><strong>${c.summary}</strong>${c.action ? `<br><span style="color:#64748b">→ ${c.action}</span>` : ""}${c.action_link ? ` · <a href="${c.action_link}">open</a>` : ""}</li>`).join("") || "<li style='color:#64748b'>Zero criticals. Good week.</li>"}</ol>

  <p style="color:#64748b;font-size:12px;margin-top:32px">Generated ${new Date().toISOString()} · APEX Autonomous Engine</p>
</div>`;

  const aopThis = rows.find(r => r.key === "daily.aop")?.thisW ?? 0;
  const aopLast = rows.find(r => r.key === "daily.aop")?.lastW ?? 0;
  const wowPct = aopLast > 0 ? ((aopThis - aopLast) / aopLast) * 100 : 0;
  const sms = `APEX week: ${fmt$(aopThis)} ALP (${wowPct >= 0 ? "+" : ""}${wowPct.toFixed(0)}% WoW) · ${subbotRanked[0]?.[0] ?? "-"} needs attention`.slice(0, 160);

  try {
    await resend.emails.send({
      from: "APEX Engine <sam@apex-financial.org>",
      to: SAM_EMAIL,
      subject: `APEX weekly · ${fmt$(aopThis)} ALP · ${wowPct >= 0 ? "+" : ""}${wowPct.toFixed(0)}% WoW`,
      html,
    });
  } catch (e: any) { console.error("[weekly] email", e); }
  try {
    await supabase.functions.invoke("send-sms-auto-detect", { body: { phone: SAM_PHONE, message: sms } });
  } catch (e: any) { console.error("[weekly] sms", e); }

  return new Response(JSON.stringify({ ok: true, this_week: thisWeek, last_week: lastWeek, metrics: rows, subbot_rank: subbotRanked }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
