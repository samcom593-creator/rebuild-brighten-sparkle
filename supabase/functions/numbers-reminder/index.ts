// numbers-reminder
//
// Fires once at 6pm America/Chicago every day. Finds present licensed agents
// who have not logged progress or posted production and sends one email.
//
// Body: {} — payload optional.
// Returns: { reminded: N, skipped: M, errors: K }
//
// Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { sendEmail, isUnsubscribed } from "../_shared/email.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-request-id, idempotency-key",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function chicagoParts(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return { date: `${value("year")}-${value("month")}-${value("day")}`, hour: Number(value("hour")) };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const sb = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );

  try {
    const requestPayload = await req.json().catch(() => ({})) as { force?: boolean };
    const chicago = chicagoParts();
    if (!requestPayload.force && chicago.hour !== 18) {
      return new Response(JSON.stringify({ ok: true, skipped: "outside_6pm_chicago_window" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const today = chicago.date;

    // ── 1. Agents who already logged today ──────────────────────────────
    const { data: logged } = await sb
      .from("daily_production")
      .select("agent_id")
      .eq("production_date", today);
    const loggedIds = new Set<string>((logged ?? []).map((r: { agent_id: string }) => r.agent_id));

    // Also count any deal posted today as activity
    const { data: dealsToday } = await sb
      .from("v_production_unified")
      .select("agent_id")
      .eq("posted_date", today);
    for (const d of (dealsToday ?? []) as Array<{ agent_id: string | null }>) {
      if (d.agent_id) loggedIds.add(d.agent_id);
    }

    // ── 2. Active licensed agents (not deactivated/inactive) ────────────
    const { data: agents, error: agentsErr } = await sb
      .from("agents")
      .select("id, user_id, display_name")
      .eq("status", "active")
      .eq("is_deactivated", false)
      .eq("is_inactive", false)
      .eq("license_status", "licensed")
      .limit(500);
    if (agentsErr) throw agentsErr;

    const userIds = (agents ?? []).map((a: { user_id: string | null }) => a.user_id).filter(Boolean) as string[];
    const { data: profiles } = await sb
      .from("profiles")
      .select("user_id, full_name, email")
      .in("user_id", userIds.length ? userIds : ["00000000-0000-0000-0000-000000000000"]);
    const profileByUser = new Map((profiles ?? []).map((p: any) => [p.user_id, p]));

    const { data: exclusions } = await sb.from("roster_exclusions").select("agent_id");
    const excludedIds = new Set((exclusions ?? []).map((row: { agent_id: string }) => row.agent_id));

    const { data: delivered } = await sb
      .from("numbers_reminder_delivery_log")
      .select("agent_id")
      .eq("business_date", today);
    const alreadyReminded = new Set((delivered ?? []).map((row: { agent_id: string }) => row.agent_id));

    const reminders: Array<{ agent_id: string; name: string; email: string | null }> = [];
    for (const a of (agents ?? []) as any[]) {
      if (loggedIds.has(a.id) || alreadyReminded.has(a.id) || excludedIds.has(a.id)) continue;
      const profile = profileByUser.get(a.user_id) as any;
      reminders.push({
        agent_id: a.id,
        name: profile?.full_name ?? a.display_name ?? "Agent",
        email: profile?.email ?? null,
      });
    }

    // ── 3. Send exactly one email per agent/business day ───────────────
    const subject = "Apex · log your numbers";
    const messageBody = `Quick reminder — log today's calls, presentations, and deals before close of business.\n\nhttps://apex-financial.org/numbers`;
    const html = `
      <p>Hey ${"{{first_name}}"} — quick reminder.</p>
      <p>Log today's calls, presentations, and deals before close of business so your stats stay accurate:</p>
      <p><a href="https://apex-financial.org/numbers" style="display:inline-block;padding:10px 18px;background:#22d3a5;color:#0a0f1a;text-decoration:none;border-radius:6px;font-weight:600;">Log my numbers</a></p>
      <p style="font-size:12px;color:#64748b">Sam — Apex Financial</p>
    `;

    let emailsSent = 0, errors = 0;
    for (const r of reminders) {
      if (r.email && !(await isUnsubscribed(sb, r.email))) {
        try {
          const personalizedHtml = html.replace("{{first_name}}", r.name.split(" ")[0]);
          const result = await sendEmail({
            to: r.email,
            subject,
            html: personalizedHtml,
            text: messageBody,
            unsubscribe_token: r.agent_id,
            tagName: "numbers-reminder",
          });
          if (result.ok) {
            emailsSent++;
            await sb.from("numbers_reminder_delivery_log").upsert({
              business_date: today,
              agent_id: r.agent_id,
              email: r.email,
              sent_at: new Date().toISOString(),
            }, { onConflict: "business_date,agent_id" });
          } else errors++;
        } catch { errors++; }
      }
    }

    // ── 4. Stamp the heartbeat ─────────────────────────────────────────
    await sb.from("system_settings").upsert({
      key: "last_numbers_reminder",
      value: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    // Also log the run for the system_health refresher
    await sb.from("automation_run_log").insert({
      job_name: "numbers-reminder",
      status: "ok",
      message: `6pm CT: ${emailsSent} email · ${errors} errors`,
    });

    return new Response(JSON.stringify({
      ok: true,
      candidates: agents?.length ?? 0,
      already_logged: loggedIds.size,
      reminded: reminders.length,
      emails_sent: emailsSent,
      errors,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("numbers-reminder error:", err);
    return new Response(JSON.stringify({ ok: false, error: String(err?.message ?? err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
