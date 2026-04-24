// 9pm CST evening report (v3 — branded, one hero stat, 5-line body).
// email redesign: 9a3134b
// redeploy marker: v2 email rewrite live refresh

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { Resend } from "https://esm.sh/resend@2.0.0";
import { humanize } from "../_shared/humanize.ts";

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

function ymd(d = new Date()) { return d.toISOString().slice(0, 10); }
function fmt$(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}k`;
  return `$${Math.round(n)}`;
}

function shell(opts: { subject: string; heroTag: string; heroTitle: string; heroSub: string; heroColor?: string; body: string }) {
  const heroColor = opts.heroColor ?? "#10b981";
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${opts.subject}</title></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Arial,sans-serif;color:#0f172a">
<div style="max-width:600px;margin:0 auto;padding:24px 16px">
<div style="padding:4px 0 16px"><table cellpadding="0" cellspacing="0" border="0"><tr><td style="width:32px"><div style="width:28px;height:28px;background:#0f172a;color:#fff;border-radius:6px;text-align:center;line-height:28px;font-weight:800;font-size:13px;letter-spacing:1px">A</div></td><td style="padding-left:10px"><div style="font-weight:700;letter-spacing:0.5px;font-size:13px">APEX</div><div style="font-size:11px;color:#64748b;margin-top:-2px">Autonomous Engine</div></td></tr></table></div>
<div style="background:#0f172a;color:#fff;padding:20px 22px;border-radius:12px;margin-bottom:18px">
<div style="font-size:11px;font-weight:700;letter-spacing:1.5px;opacity:0.6;text-transform:uppercase">${opts.heroTag}</div>
<div style="font-size:28px;font-weight:800;margin-top:4px;color:${heroColor}">${opts.heroTitle}</div>
<div style="font-size:14px;opacity:0.82;margin-top:4px">${opts.heroSub}</div>
</div>
<div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:22px">${opts.body}</div>
<div style="text-align:center;padding:20px 0 10px;font-size:11px;color:#64748b"><a href="${BRAND_URL}" style="color:#64748b;text-decoration:none">${BRAND_URL}</a> &middot; autonomous engine</div>
</div></body></html>`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const today = ymd();
  const yesterday = ymd(new Date(Date.now() - 86_400_000));
  const todayStart = today + "T00:00:00Z";

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
  const aopYest = (prodY.data ?? []).reduce((s: number, r: any) => s + Number(r.aop ?? 0), 0);
  const dealsToday = (prodT.data ?? []).reduce((s: number, r: any) => s + Number(r.deals_closed ?? 0), 0);
  const delta = aopYest > 0 ? ((aopToday - aopYest) / aopYest) * 100 : (aopToday > 0 ? 100 : 0);
  const arrow = aopToday > aopYest ? "▲" : aopToday < aopYest ? "▼" : "=";
  const heroColor = aopToday >= aopYest ? "#10b981" : "#f87171";

  const lines: Array<{ icon: string; text: string; link?: string }> = [];
  lines.push({
    icon: (appsT.count ?? 0) > 0 ? "✅" : "⚠️",
    text: `<strong>${appsT.count ?? 0}</strong> new application${appsT.count === 1 ? "" : "s"} · <strong>${contactedT.count ?? 0}</strong> contacted today`,
    link: `${BRAND_URL}/dashboard/applicants`,
  });
  if ((termsT.count ?? 0) > 0) lines.push({ icon: "🧹", text: `<strong>${termsT.count}</strong> agent${termsT.count === 1 ? "" : "s"} auto-terminated`, link: `${BRAND_URL}/dashboard/inactive-agents` });
  if ((dmInT.count ?? 0) > 0) lines.push({ icon: "📥", text: `<strong>${dmInT.count}</strong> DM${dmInT.count === 1 ? "" : "s"} received`, link: `${BRAND_URL}/dashboard/inbox` });
  if ((failT.count ?? 0) > 0) lines.push({ icon: "🔴", text: `<strong>${failT.count}</strong> automation failure${failT.count === 1 ? "" : "s"}`, link: `${BRAND_URL}/dashboard/automation-health` });

  const prep: string[] = [];
  if ((appsT.count ?? 0) === 0) prep.push("Post content tomorrow morning — top of funnel was empty.");
  if (aopToday < 10_000) prep.push("Schedule 3-5 recruiting calls by 10am.");
  if ((failT.count ?? 0) > 0) prep.push("Skim automation-health for the failure modes.");

  const bodyHtml = `<div style="margin-bottom:14px">
${lines.map(l => `<div style="padding:8px 0;border-bottom:1px solid #f1f5f9;color:#334155">
<span style="margin-right:10px;font-size:16px">${l.icon}</span>${l.text}
${l.link ? ` &middot; <a href="${l.link}" style="color:#0ea5e9;text-decoration:none;font-size:13px">open</a>` : ""}
</div>`).join("")}
</div>
${prep.length ? `<div style="margin-top:18px;padding:14px 16px;background:#f0f9ff;border-left:4px solid #0284c7;border-radius:6px">
<div style="font-size:11px;font-weight:700;letter-spacing:1px;color:#0369a1">TOMORROW</div>
<ul style="margin:6px 0 0;padding-left:18px;color:#0c4a6e;font-size:14px;line-height:1.7">${prep.map(p => `<li>${p}</li>`).join("")}</ul>
</div>` : ""}`;

  const html = shell({
    subject: `APEX EOD · ${today}`,
    heroTag: `END OF DAY · ${today}`,
    heroTitle: `${fmt$(aopToday)}`,
    heroSub: `${dealsToday} deal${dealsToday === 1 ? "" : "s"} · ${arrow} ${Math.abs(delta).toFixed(0)}% vs yesterday (${fmt$(aopYest)})`,
    heroColor,
    body: bodyHtml,
  });

  const sms = `APEX 🌙 ${fmt$(aopToday)}${aopToday >= aopYest ? " ▲" : " ▼"} · ${dealsToday} deals · ${appsT.count ?? 0} apps · ${contactedT.count ?? 0} touched${(failT.count ?? 0) > 0 ? ` · ${failT.count} fail` : ""}`.slice(0, 120);

  try {
    await resend.emails.send({
      from: "APEX Engine <sam@apex-financial.org>",
      to: SAM_EMAIL,
      subject: humanize(`🌙 ${today} · ${fmt$(aopToday)} · ${dealsToday} deals`),
      html: humanize(html),
    });
  } catch (e) { console.error("[evening] email", e); }
  try {
    await supabase.functions.invoke("send-sms-auto-detect", { body: { phone: SAM_PHONE, message: sms } });
  } catch (e) { console.error("[evening] sms", e); }

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
