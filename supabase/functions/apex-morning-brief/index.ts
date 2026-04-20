// 7am CST morning brief.
//
// 1. Invokes apex-audit-engine to refresh all sub-bot audits.
// 2. Picks the top 3 highest-severity / highest-count findings.
// 3. Writes them into bot_priorities (for today) and sends email + SMS.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { Resend } from "https://esm.sh/resend@2.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// deploy trigger: b985c2e
// dedup live: 024b716
// way-less-noise: 2f2377a

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

  // Step 1: refresh audits
  const { error: engineErr } = await supabase.functions.invoke("apex-audit-engine", { body: {} });
  if (engineErr) console.error("[morning-brief] engine error", engineErr);

  // Step 2: pick top 3 from audits run today. Dedupe by
  // (sub_bot, audit_name) — keep the most recent occurrence — then rank
  // by severity × finding_count so the morning brief doesn't show the
  // same finding three times.
  const today = ymd();
  const { data: todayAudits } = await supabase
    .from("bot_audits")
    .select("*")
    .gte("created_at", today + "T00:00:00Z")
    .order("created_at", { ascending: false });
  const seen = new Set<string>();
  const unique: any[] = [];
  for (const a of todayAudits ?? []) {
    const k = `${(a as any).sub_bot}.${(a as any).audit_name}`;
    if (seen.has(k)) continue;
    seen.add(k);
    unique.push(a);
  }
  const ranked = unique.sort((a: any, b: any) => {
    const sA = SEVERITY_WEIGHT[a.severity] ?? 0;
    const sB = SEVERITY_WEIGHT[b.severity] ?? 0;
    if (sB !== sA) return sB - sA;
    return (b.finding_count ?? 0) - (a.finding_count ?? 0);
  });
  const top3 = ranked.slice(0, 3);

  // Step 3: persist priorities (replace today's)
  await supabase.from("bot_priorities").delete().eq("for_date", today);
  for (let i = 0; i < top3.length; i++) {
    const a: any = top3[i];
    await supabase.from("bot_priorities").insert({
      for_date: today,
      rank: i + 1,
      title: a.summary,
      body: a.action ?? "",
      action_link: a.action_link ?? null,
      sub_bot: a.sub_bot,
      metric_key: `${a.sub_bot}.${a.audit_name}`,
      metric_value: a.finding_count,
    });
  }

  // Step 4: compose email + SMS
  const human = top3.map((a: any, i: number) => `<li><strong>${i + 1}. ${a.summary}</strong>${a.action ? `<br>→ ${a.action}` : ""}${a.action_link ? ` · <a href="${a.action_link}">open</a>` : ""}</li>`).join("");
  const overnight = (todayAudits ?? []).filter((a: any) => a.severity !== "info").length;

  const html = `
<div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;max-width:640px;margin:0 auto;padding:24px;color:#0f172a">
  <h1 style="margin:0 0 4px;color:#0f172a">🌅 Morning brief — ${today}</h1>
  <p style="color:#64748b;margin:0 0 20px">Overnight audit found ${overnight} action item${overnight === 1 ? "" : "s"}. Top 3:</p>
  <ol>${human || "<li>All clean, no warnings from overnight audit.</li>"}</ol>
  <p style="color:#64748b;font-size:13px;margin-top:32px">Full list in <code>bot_audits</code>. Engine runs every 30 min; evening report at 9pm CST.</p>
</div>`;

  const sms = `APEX 7am: ${overnight} action items. Top: ${(top3[0] as any)?.summary?.slice(0, 100) ?? "all clean"}`.slice(0, 160);

  // Send
  let email_id: string | null = null;
  try {
    const r = await resend.emails.send({
      from: "APEX Engine <sam@apex-financial.org>",
      to: SAM_EMAIL,
      subject: `APEX morning brief — ${top3.length} priorities`,
      html,
    });
    email_id = (r as any)?.data?.id ?? null;
  } catch (e: any) {
    console.error("[morning-brief] email error", e);
  }
  try {
    await supabase.functions.invoke("send-sms-auto-detect", { body: { phone: SAM_PHONE, message: sms } });
  } catch (e: any) {
    console.error("[morning-brief] sms error", e);
  }

  return new Response(JSON.stringify({ ok: true, top3_count: top3.length, email_id }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});