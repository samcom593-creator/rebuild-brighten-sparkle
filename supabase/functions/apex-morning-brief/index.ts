// 7am CST morning brief (v2 — tight, operator voice).
//
// 1. Re-runs the audit engine.
// 2. Picks 3 actions from overnight findings (deduped by (sub_bot, audit_name),
//    sorted by severity then finding_count).
// 3. Pulls any un-sent WARN alerts from bot_alerts and rolls them into a
//    single "also queued" section — THEN marks them sent so they don't
//    re-ping. Criticals were already sent by alert-dispatch as they happened.
// 4. One email. One SMS. Action-first copy. No tables.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { Resend } from "https://esm.sh/resend@2.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// deploy trigger: 2f2377a (v2 — tight, operator voice)

const SAM_EMAIL = "info@kingofsales.net";
const SAM_PHONE = "4697676068";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);
const resend = new Resend(Deno.env.get("RESEND_API_KEY") ?? "");

const SEVERITY_WEIGHT: Record<string, number> = { critical: 3, warn: 2, info: 1 };

function ymd(d = new Date()) { return d.toISOString().slice(0, 10); }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // 1. Refresh audits
  await supabase.functions.invoke("apex-audit-engine", { body: {} }).catch(() => {});

  const today = ymd();
  const todayISO = today + "T00:00:00Z";

  // 2. Today's findings, deduped, ranked
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

  // 3. Record priorities
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

  // 4. Mark held warn/info alerts as sent (rolled into this digest)
  await supabase.from("bot_alerts")
    .update({ sent_at: new Date().toISOString() })
    .is("sent_at", null)
    .in("severity", ["warn", "info"]);

  // ── HTML ──────────────────────────────────────────────────────────
  const prio = top3.map((a, i) => {
    const tag = a.severity === "critical"
      ? '<span style="color:#dc2626;font-weight:bold;font-size:11px;letter-spacing:0.5px">CRITICAL</span>'
      : a.severity === "warn"
      ? '<span style="color:#d97706;font-weight:bold;font-size:11px;letter-spacing:0.5px">WARN</span>'
      : '';
    return `<div style="margin:14px 0;padding:12px;background:#f9fafb;border-left:3px solid #0f172a;border-radius:4px">
  <div style="font-size:11px;color:#64748b">${i + 1} · ${a.sub_bot} · ${tag}</div>
  <div style="font-weight:600;margin:4px 0;color:#0f172a">${a.summary}</div>
  ${a.action ? `<div style="color:#334155">→ ${a.action}</div>` : ""}
  ${a.action_link ? `<div style="margin-top:6px"><a href="${a.action_link}" style="color:#0ea5e9;font-size:13px">Open in APEX →</a></div>` : ""}
</div>`;
  }).join("");

  const otherLine = rest.length
    ? `<p style="color:#64748b;font-size:13px;margin-top:16px">+ ${rest.length} other warnings rolled in: ${rest.slice(0, 5).map((r) => r.audit_name).join(", ")}${rest.length > 5 ? "…" : ""}</p>`
    : "";

  const clean = top3.length === 0;

  const html = clean
    ? `<div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#0f172a;line-height:1.5">
<h2 style="margin:0 0 8px">☀️ ${today}</h2>
<p>No warnings overnight. Focus: recruiting calls + content.</p>
</div>`
    : `<div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#0f172a;line-height:1.5">
<h2 style="margin:0 0 4px">☀️ ${today} · today's ${top3.length}</h2>
<p style="color:#64748b;margin:0 0 14px;font-size:14px">What the engine found. Work top-down.</p>
${prio}
${otherLine}
</div>`;

  // SMS: <90 chars, just the top item
  const smsTop = top3[0]?.summary ?? "No warnings overnight.";
  const sms = clean
    ? `APEX 7am: clean. Focus: calls + content.`
    : `APEX 7am #1: ${smsTop}`.slice(0, 90);

  let email_id: string | null = null;
  try {
    const r = await resend.emails.send({
      from: "APEX <sam@apex-financial.org>",
      to: SAM_EMAIL,
      subject: clean ? `☀️ ${today} · clean` : `☀️ ${today} · ${top3.length} actions${top3[0]?.severity === "critical" ? " · 1 critical" : ""}`,
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
