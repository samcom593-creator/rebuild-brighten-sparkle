// 7am CST morning brief (v3 — post-worthy, branded, real links).
// email redesign: 9a3134b
//
// One email. One SMS. Top 3 as branded action cards with working "Open in APEX"
// buttons. Clean-day path collapses to a single positive line. Warns get rolled
// into a footer line and marked sent so they don't re-ping tomorrow.

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

const SEVERITY_WEIGHT: Record<string, number> = { critical: 3, warn: 2, info: 1 };

function ymd(d = new Date()) { return d.toISOString().slice(0, 10); }

function actionCard(i: number, a: any): string {
  const tone =
    a.severity === "critical" ? { bar: "#dc2626", tag: "CRITICAL", bg: "#fee2e2", fg: "#991b1b" }
    : a.severity === "warn"   ? { bar: "#d97706", tag: "WARN",     bg: "#fef3c7", fg: "#92400e" }
    : { bar: "#0ea5e9", tag: "INFO", bg: "#e0f2fe", fg: "#075985" };
  return `<div style="border-left:4px solid ${tone.bar};background:#fafafa;border-radius:6px;padding:14px 16px;margin:10px 0">
<div style="font-size:11px;color:#64748b;font-weight:600;letter-spacing:0.5px">#${i} &middot; ${String(a.sub_bot).replace(/_/g," ").toUpperCase()} &middot; <span style="background:${tone.bg};color:${tone.fg};padding:2px 7px;border-radius:99px;font-size:10px;letter-spacing:1px">${tone.tag}</span></div>
<div style="font-size:15px;font-weight:600;margin:6px 0 2px;color:#0f172a">${a.summary}</div>
${a.action ? `<div style="color:#334155;font-size:14px;margin-top:4px">&rarr; ${a.action}</div>` : ""}
${a.action_link ? `<div style="margin-top:10px"><a href="${a.action_link}" style="display:inline-block;background:#0f172a;color:#fff;text-decoration:none;padding:7px 14px;border-radius:6px;font-size:13px;font-weight:600">Open in APEX &rarr;</a></div>` : ""}
</div>`;
}

function shell(opts: { subject: string; heroTag: string; heroTitle: string; heroSub: string; body: string }) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${opts.subject}</title></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Arial,sans-serif;color:#0f172a">
<div style="max-width:600px;margin:0 auto;padding:24px 16px">
<div style="padding:4px 0 16px"><table cellpadding="0" cellspacing="0" border="0"><tr><td style="width:32px"><div style="width:28px;height:28px;background:#0f172a;color:#fff;border-radius:6px;text-align:center;line-height:28px;font-weight:800;font-size:13px;letter-spacing:1px">A</div></td><td style="padding-left:10px"><div style="font-weight:700;letter-spacing:0.5px;font-size:13px">APEX</div><div style="font-size:11px;color:#64748b;margin-top:-2px">Autonomous Engine</div></td></tr></table></div>
<div style="background:#0f172a;color:#fff;padding:20px 22px;border-radius:12px;margin-bottom:18px">
<div style="font-size:11px;font-weight:700;letter-spacing:1.5px;opacity:0.6;text-transform:uppercase">${opts.heroTag}</div>
<div style="font-size:26px;font-weight:800;margin-top:4px;color:#10b981">${opts.heroTitle}</div>
<div style="font-size:14px;opacity:0.82;margin-top:4px">${opts.heroSub}</div>
</div>
<div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:22px">${opts.body}</div>
<div style="text-align:center;padding:20px 0 10px;font-size:11px;color:#64748b"><a href="${BRAND_URL}" style="color:#64748b;text-decoration:none">${BRAND_URL}</a> &middot; autonomous engine</div>
</div></body></html>`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  await supabase.functions.invoke("apex-audit-engine", { body: {} }).catch(() => {});

  const today = ymd();
  const todayISO = today + "T00:00:00Z";

  const { data: todayAudits } = await supabase
    .from("bot_audits")
    .select("sub_bot, audit_name, severity, finding_count, summary, action, action_link, created_at")
    .gte("created_at", todayISO)
    .order("created_at", { ascending: false });
  const seen = new Set<string>();
  const unique: any[] = [];
  for (const a of todayAudits ?? []) {
    const k = `${a.sub_bot}.${a.audit_name}`;
    if (seen.has(k)) continue;
    seen.add(k);
    unique.push(a);
  }
  unique.sort((a, b) => {
    const sA = SEVERITY_WEIGHT[a.severity] ?? 0;
    const sB = SEVERITY_WEIGHT[b.severity] ?? 0;
    if (sB !== sA) return sB - sA;
    return (b.finding_count ?? 0) - (a.finding_count ?? 0);
  });
  const top3 = unique.slice(0, 3);
  const rest = unique.slice(3).filter((a) => a.severity !== "info");

  // Persist today's priorities (replaces any earlier set for the date)
  await supabase.from("bot_priorities").delete().eq("for_date", today);
  for (let i = 0; i < top3.length; i++) {
    const a = top3[i];
    await supabase.from("bot_priorities").insert({
      for_date: today, rank: i + 1,
      title: a.summary, body: a.action ?? "",
      action_link: a.action_link ?? null, sub_bot: a.sub_bot,
      metric_key: `${a.sub_bot}.${a.audit_name}`, metric_value: a.finding_count,
    });
  }

  // Clear warn/info backlog — they've been rolled into this digest
  await supabase.from("bot_alerts")
    .update({ sent_at: new Date().toISOString() })
    .is("sent_at", null)
    .in("severity", ["warn", "info"]);

  const totalActions = top3.filter((a) => a.severity !== "info").length;
  const criticalCount = top3.filter((a) => a.severity === "critical").length;
  const clean = totalActions === 0;

  const heroTag = `MORNING · ${today}`;
  const heroTitle = clean
    ? "All clear."
    : `${totalActions} action${totalActions === 1 ? "" : "s"} today`;
  const heroSub = clean
    ? "Focus: recruiting calls + 4 content pieces."
    : criticalCount > 0
      ? `${criticalCount} critical · ${totalActions - criticalCount} warn${rest.length ? ` · +${rest.length} queued` : ""}`
      : `${totalActions} warn · work top-down`;

  const bodyHtml = clean
    ? `<p style="margin:0;color:#334155;font-size:15px">No warnings overnight. Your two tasks today:</p>
<ol style="color:#334155;font-size:15px;line-height:1.7;padding-left:18px;margin:10px 0 0"><li>30–50 recruiting calls</li><li>4 content pieces</li></ol>
<p style="color:#64748b;font-size:13px;margin-top:16px">Engine audits every 30 min and will page you if anything flips critical.</p>`
    : `<p style="margin:0 0 6px;color:#334155;font-size:14px">Work these in order — each has the one fix baked in.</p>
${top3.map((a, i) => actionCard(i + 1, a)).join("")}
${rest.length ? `<p style="color:#64748b;font-size:12px;margin-top:14px">+${rest.length} lower-priority warning${rest.length === 1 ? "" : "s"} (${rest.slice(0, 4).map((r) => r.audit_name.replace(/_/g, " ")).join(", ")}${rest.length > 4 ? "…" : ""}) — won't page you, just logged.</p>` : ""}`;

  const html = shell({
    subject: `APEX morning · ${today}`,
    heroTag, heroTitle, heroSub, body: bodyHtml,
  });

  const smsTop = top3[0]?.summary ?? "";
  const sms = clean
    ? `APEX ☀️ all clear. Today: 30+ calls, 4 videos.`
    : `APEX ☀️ ${totalActions} action${totalActions === 1 ? "" : "s"} · ${smsTop.slice(0, 72)}`.slice(0, 120);

  let email_id: string | null = null;
  try {
    const r = await resend.emails.send({
      from: "APEX Engine <sam@apex-financial.org>",
      to: SAM_EMAIL,
      subject: clean ? `☀️ ${today} · all clear` : `☀️ ${today} · ${totalActions} action${totalActions === 1 ? "" : "s"}${criticalCount ? ` · ${criticalCount} critical` : ""}`,
      html,
    });
    email_id = (r as any)?.data?.id ?? null;
  } catch (e: any) { console.error("[morning-brief] email", e); }
  try {
    await supabase.functions.invoke("send-sms-auto-detect", { body: { phone: SAM_PHONE, message: sms } });
  } catch (e: any) { console.error("[morning-brief] sms", e); }

  return new Response(JSON.stringify({ ok: true, top3: top3.length, warns_rolled_in: rest.length, clean, email_id }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
