// 9pm CST evening report (v2 — five lines, no tables).
//
// Pulls today's core metrics + vs yesterday, emits one tight summary.
// Snapshots the headline numbers for week-over-week.

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

function ymd(d = new Date()) { return d.toISOString().slice(0, 10); }
function fmt$(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}k`;
  return `$${Math.round(n)}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const today = ymd();
  const yesterday = ymd(new Date(Date.now() - 86_400_000));
  const todayStart = today + "T00:00:00Z";

  // Today's numbers
  const [prodT, prodY, appsT, contactedT, termsT, dmInT, failT] = await Promise.all([
    supabase.from("daily_production").select("aop, deals_closed").eq("production_date", today),
    supabase.from("daily_production").select("aop").eq("production_date", yesterday),
    supabase.from("applications").select("id", { count: "exact", head: true }).gte("created_at", todayStart),
    supabase.from("applications").select("id", { count: "exact", head: true }).gte("last_contacted_at", todayStart),
    supabase.from("agents").select("id", { count: "exact", head: true }).eq("status", "terminated").gte("updated_at", todayStart),
    supabase.from("inbox_messages").select("id", { count: "exact", head: true }).eq("direction", "inbound").gte("received_at", todayStart),
    supabase.from("automation_run_log").select("id", { count: "exact", head: true }).eq("status", "failed").gte("triggered_at", todayStart),
  ]);

  const aopToday = (prodT.data ?? []).reduce((s: number, r: any) => s + Number(r.aop ?? 0), 0);
  const aopYest  = (prodY.data ?? []).reduce((s: number, r: any) => s + Number(r.aop ?? 0), 0);
  const dealsToday = (prodT.data ?? []).reduce((s: number, r: any) => s + Number(r.deals_closed ?? 0), 0);
  const delta = aopYest > 0 ? ((aopToday - aopYest) / aopYest) * 100 : (aopToday > 0 ? 100 : 0);
  const arrow = aopToday > aopYest ? "▲" : aopToday < aopYest ? "▼" : "=";

  // Build 5-line summary
  const lines: Array<{ icon: string; text: string }> = [];
  lines.push({
    icon: aopToday >= aopYest ? "✅" : "❌",
    text: `${fmt$(aopToday)} team ALP · ${dealsToday} deals · ${arrow}${Math.abs(delta).toFixed(0)}% vs yesterday`,
  });
  lines.push({
    icon: (appsT.count ?? 0) > 0 ? "✅" : "⚠️",
    text: `${appsT.count ?? 0} new applications · ${contactedT.count ?? 0} contacted today`,
  });
  if ((termsT.count ?? 0) > 0) lines.push({ icon: "🧹", text: `${termsT.count} agent${termsT.count === 1 ? "" : "s"} terminated (auto-cleanup)` });
  if ((dmInT.count ?? 0) > 0) lines.push({ icon: "📥", text: `${dmInT.count} DM${dmInT.count === 1 ? "" : "s"} received` });
  if ((failT.count ?? 0) > 0) lines.push({ icon: "🔴", text: `${failT.count} automation failure${failT.count === 1 ? "" : "s"} — check automation-health` });

  // Tomorrow prep — 1-2 prescriptive items
  const prep: string[] = [];
  if ((appsT.count ?? 0) === 0) prep.push("Post content tomorrow morning — top of funnel was empty.");
  if (aopToday < 10_000) prep.push("Schedule 3-5 recruiting calls by 10am.");
  if ((failT.count ?? 0) > 0) prep.push("Skim automation_run_log for root cause.");

  const html = `<div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#0f172a;line-height:1.5">
<h2 style="margin:0 0 4px">🌙 ${today} · ${fmt$(aopToday)} ALP</h2>
<p style="color:#64748b;margin:0 0 16px;font-size:14px">End of day.</p>
${lines.map(l => `<div style="margin:8px 0"><span style="margin-right:8px">${l.icon}</span>${l.text}</div>`).join("")}
${prep.length ? `<div style="margin-top:20px;padding:12px;background:#f9fafb;border-radius:4px"><div style="font-size:12px;color:#64748b;margin-bottom:4px">TOMORROW</div>${prep.map(p => `<div style="margin:4px 0">• ${p}</div>`).join("")}</div>` : ""}
</div>`;

  const sms = `APEX 9pm: ${fmt$(aopToday)}·${dealsToday}d·${appsT.count ?? 0}apps·${contactedT.count ?? 0}ctc${(failT.count ?? 0) > 0 ? `·${failT.count}fails` : ""}`.slice(0, 90);

  try {
    await resend.emails.send({
      from: "APEX <sam@apex-financial.org>",
      to: SAM_EMAIL,
      subject: `🌙 ${today} · ${fmt$(aopToday)} · ${dealsToday} deals`,
      html,
    });
  } catch (e) { console.error("[evening] email", e); }
  try {
    await supabase.functions.invoke("send-sms-auto-detect", { body: { phone: SAM_PHONE, message: sms } });
  } catch (e) { console.error("[evening] sms", e); }

  // Snapshot for weekly
  const snap = (k: string, v: number) => supabase.from("bot_metrics_snapshots").upsert({
    snapshot_date: today, metric_key: k, metric_value: v,
  }, { onConflict: "snapshot_date,metric_key" });
  await snap("daily.aop", aopToday);
  await snap("daily.deals", dealsToday);
  await snap("daily.apps", appsT.count ?? 0);
  await snap("daily.contacted", contactedT.count ?? 0);
  await snap("daily.dm_inbound", dmInT.count ?? 0);

  return new Response(JSON.stringify({
    ok: true, aop: aopToday, deals: dealsToday,
    apps: appsT.count ?? 0, contacted: contactedT.count ?? 0,
    failures: failT.count ?? 0,
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
