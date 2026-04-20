// 9pm CST end-of-day performance report.
//
// Pulls today's production, recruiting, content, automation-health metrics
// and emails a snapshot. SMS gets a one-line headline.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { Resend } from "https://esm.sh/resend@2.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// deploy trigger: b985c2e

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
  return `$${n.toFixed(0)}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const today = ymd();
  const yesterday = ymd(new Date(Date.now() - 86_400_000));
  const todayStartISO = today + "T00:00:00Z";

  // Production today (daily_production)
  const { data: prodRows } = await supabase
    .from("daily_production")
    .select("aop, deals_closed, presentations, hours_called")
    .eq("production_date", today);
  const todayAOP = (prodRows ?? []).reduce((s: number, r: any) => s + Number(r.aop ?? 0), 0);
  const todayDeals = (prodRows ?? []).reduce((s: number, r: any) => s + Number(r.deals_closed ?? 0), 0);
  const todayPres = (prodRows ?? []).reduce((s: number, r: any) => s + Number(r.presentations ?? 0), 0);

  // Applications today
  const { count: appsToday } = await supabase
    .from("applications")
    .select("id", { count: "exact", head: true })
    .gte("created_at", todayStartISO);

  // Contacted today
  const { count: contactedToday } = await supabase
    .from("applications")
    .select("id", { count: "exact", head: true })
    .gte("last_contacted_at", todayStartISO);

  // Closed apps today
  const { count: noPickupToday } = await supabase
    .from("applications")
    .select("id", { count: "exact", head: true })
    .eq("status", "no_pickup")
    .gte("updated_at", todayStartISO);
  const { count: rejectedToday } = await supabase
    .from("applications")
    .select("id", { count: "exact", head: true })
    .eq("status", "rejected")
    .gte("updated_at", todayStartISO);

  // Terminations today
  const { count: termsToday } = await supabase
    .from("agents")
    .select("id", { count: "exact", head: true })
    .eq("status", "terminated")
    .gte("updated_at", todayStartISO);

  // Inbox activity
  const { count: dmInbound } = await supabase
    .from("inbox_messages")
    .select("id", { count: "exact", head: true })
    .eq("direction", "inbound")
    .gte("received_at", todayStartISO);
  const { count: dmAutoReplied } = await supabase
    .from("inbox_messages")
    .select("id", { count: "exact", head: true })
    .eq("direction", "outbound")
    .eq("auto_replied", true)
    .gte("received_at", todayStartISO);

  // Automation failures
  const { count: autoFailures } = await supabase
    .from("automation_run_log")
    .select("id", { count: "exact", head: true })
    .eq("status", "failed")
    .gte("triggered_at", todayStartISO);

  // Yesterday AOP for delta
  const { data: yProd } = await supabase
    .from("daily_production")
    .select("aop")
    .eq("production_date", yesterday);
  const yAOP = (yProd ?? []).reduce((s: number, r: any) => s + Number(r.aop ?? 0), 0);
  const delta = yAOP > 0 ? ((todayAOP - yAOP) / yAOP) * 100 : 0;
  const arrow = todayAOP > yAOP ? "▲" : todayAOP < yAOP ? "▼" : "=";

  const wins: string[] = [];
  const losses: string[] = [];
  if (todayAOP >= yAOP) wins.push(`Production ${fmt$(todayAOP)} ${arrow} vs yesterday ${fmt$(yAOP)} (${delta.toFixed(1)}%)`);
  else losses.push(`Production ${fmt$(todayAOP)} ${arrow} vs yesterday ${fmt$(yAOP)} (${delta.toFixed(1)}%)`);
  if ((appsToday ?? 0) > 0) wins.push(`${appsToday} new applications`);
  else losses.push(`0 new applications — top of funnel quiet`);
  if ((contactedToday ?? 0) > 0) wins.push(`${contactedToday} applicants contacted`);
  if ((termsToday ?? 0) > 0) wins.push(`${termsToday} zombie agents cleaned`);
  if ((autoFailures ?? 0) > 0) losses.push(`${autoFailures} automation failures today`);

  const tomorrowPrep = [
    (appsToday ?? 0) === 0 ? "Post content — 0 apps today means empty top-of-funnel." : null,
    (todayAOP < 10000) ? "Schedule 3-5 recruiting calls by 10am." : null,
    (autoFailures ?? 0) > 0 ? "Check automation-health for failure modes." : null,
  ].filter(Boolean) as string[];

  const html = `
<div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;max-width:640px;margin:0 auto;padding:24px;color:#0f172a">
  <h1 style="margin:0 0 8px">🌙 End-of-day report — ${today}</h1>
  <p style="color:#64748b;margin:0 0 20px">${fmt$(todayAOP)} team ALP · ${todayDeals} deals · ${todayPres} presentations</p>

  <h2 style="color:#16a34a;font-size:16px">Wins</h2>
  <ul>${wins.map(w => `<li>${w}</li>`).join("") || "<li style='color:#64748b'>Quiet day.</li>"}</ul>

  <h2 style="color:#dc2626;font-size:16px">Losses</h2>
  <ul>${losses.map(l => `<li>${l}</li>`).join("") || "<li style='color:#64748b'>None.</li>"}</ul>

  <h2 style="color:#0284c7;font-size:16px">Tomorrow prep</h2>
  <ul>${tomorrowPrep.map(t => `<li>${t}</li>`).join("") || "<li style='color:#64748b'>Standard cadence.</li>"}</ul>

  <h2 style="font-size:14px;color:#334155;margin-top:24px">By-numbers</h2>
  <table style="width:100%;border-collapse:collapse;font-size:13px">
    <tr><td style="border-bottom:1px solid #e5e7eb;padding:4px">Applications new today</td><td style="text-align:right;border-bottom:1px solid #e5e7eb">${appsToday ?? 0}</td></tr>
    <tr><td style="border-bottom:1px solid #e5e7eb;padding:4px">Applications contacted today</td><td style="text-align:right;border-bottom:1px solid #e5e7eb">${contactedToday ?? 0}</td></tr>
    <tr><td style="border-bottom:1px solid #e5e7eb;padding:4px">Applications auto-closed today</td><td style="text-align:right;border-bottom:1px solid #e5e7eb">${(noPickupToday ?? 0) + (rejectedToday ?? 0)}</td></tr>
    <tr><td style="border-bottom:1px solid #e5e7eb;padding:4px">Agents terminated today</td><td style="text-align:right;border-bottom:1px solid #e5e7eb">${termsToday ?? 0}</td></tr>
    <tr><td style="border-bottom:1px solid #e5e7eb;padding:4px">DMs received</td><td style="text-align:right;border-bottom:1px solid #e5e7eb">${dmInbound ?? 0}</td></tr>
    <tr><td style="border-bottom:1px solid #e5e7eb;padding:4px">Auto-replies sent</td><td style="text-align:right;border-bottom:1px solid #e5e7eb">${dmAutoReplied ?? 0}</td></tr>
  </table>
</div>`;

  const sms = `APEX 9pm: ${fmt$(todayAOP)} ALP · ${todayDeals} deals · ${appsToday ?? 0} apps · ${contactedToday ?? 0} contacted · ${autoFailures ?? 0} fails`.slice(0, 160);

  try {
    await resend.emails.send({
      from: "APEX Engine <sam@apex-financial.org>",
      to: SAM_EMAIL,
      subject: `APEX EOD · ${fmt$(todayAOP)} · ${todayDeals} deals · ${appsToday ?? 0} apps`,
      html,
    });
  } catch (e: any) { console.error("[evening-report] email", e); }
  try {
    await supabase.functions.invoke("send-sms-auto-detect", { body: { phone: SAM_PHONE, message: sms } });
  } catch (e: any) { console.error("[evening-report] sms", e); }

  // Snapshot today's top metrics for week-over-week
  const snap = async (k: string, v: number) => supabase.from("bot_metrics_snapshots").upsert({
    snapshot_date: today, metric_key: k, metric_value: v,
  }, { onConflict: "snapshot_date,metric_key" });
  await snap("daily.aop", todayAOP);
  await snap("daily.deals", todayDeals);
  await snap("daily.apps", appsToday ?? 0);
  await snap("daily.contacted", contactedToday ?? 0);
  await snap("daily.dm_inbound", dmInbound ?? 0);

  return new Response(JSON.stringify({
    ok: true, today_aop: todayAOP, today_deals: todayDeals, apps_today: appsToday ?? 0,
    contacted_today: contactedToday ?? 0, automation_failures: autoFailures ?? 0,
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});