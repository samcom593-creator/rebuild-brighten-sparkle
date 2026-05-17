// numbers-reminder
//
// Fires at 5pm Eastern, Monday–Friday (apex-numbers-reminder cron).
// Finds licensed/active agents who have NOT logged production for today
// and pings them with an SMS via the carrier-gateway pattern (cheap, no
// Twilio) + an email backup.
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

const CARRIER_GATEWAYS: Record<string, string> = {
  att: "txt.att.net", verizon: "vtext.com", tmobile: "tmomail.net",
  sprint: "messaging.sprintpcs.com", uscellular: "email.uscc.net",
  cricket: "sms.cricketwireless.net", metro: "mymetropcs.com", boost: "sms.myboostmobile.com",
};

function cleanPhone(p: string | null | undefined): string {
  return String(p ?? "").replace(/\D/g, "").slice(-10);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const sb = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );

  try {
    // Today in business-day terms — server runs UTC, agents are US.
    // For now use UTC date; if Sam wants Eastern, switch to Intl.DateTimeFormat.
    const today = new Date().toISOString().slice(0, 10);

    // ── 1. Agents who already logged today ──────────────────────────────
    const { data: logged } = await sb
      .from("daily_production")
      .select("agent_id")
      .eq("production_date", today);
    const loggedIds = new Set<string>((logged ?? []).map((r: { agent_id: string }) => r.agent_id));

    // Also count any deal posted today as activity
    const { data: dealsToday } = await sb
      .from("deals")
      .select("agent_id")
      .gte("posted_at", `${today}T00:00:00Z`)
      .lt("posted_at", `${today}T23:59:59Z`)
      .in("status", ["submitted", "active"]);
    for (const d of (dealsToday ?? []) as Array<{ agent_id: string | null }>) {
      if (d.agent_id) loggedIds.add(d.agent_id);
    }

    // ── 2. Active licensed agents (not deactivated/inactive) ────────────
    const { data: agents, error: agentsErr } = await sb
      .from("agents")
      .select(`
        id, user_id,
        profile:profiles(full_name, email, phone, carrier)
      `)
      .eq("is_deactivated", false)
      .eq("is_inactive", false)
      .eq("license_status", "licensed")
      .limit(500);
    if (agentsErr) throw agentsErr;

    const reminders: Array<{ agent_id: string; name: string; email: string | null; phone: string | null; carrier: string | null }> = [];
    for (const a of (agents ?? []) as any[]) {
      if (loggedIds.has(a.id)) continue;
      reminders.push({
        agent_id: a.id,
        name: a.profile?.full_name ?? "Agent",
        email: a.profile?.email ?? null,
        phone: a.profile?.phone ?? null,
        carrier: a.profile?.carrier ?? null,
      });
    }

    // ── 3. Send SMS + email ────────────────────────────────────────────
    const subject = "Apex · log your numbers";
    const body = `Quick reminder — log today's calls, presentations, and deals before close of business.\n\nhttps://apex-financial.org/numbers`;
    const html = `
      <p>Hey ${"{{first_name}}"} — quick reminder.</p>
      <p>Log today's calls, presentations, and deals before close of business so your stats stay accurate:</p>
      <p><a href="https://apex-financial.org/numbers" style="display:inline-block;padding:10px 18px;background:#22d3a5;color:#0a0f1a;text-decoration:none;border-radius:6px;font-weight:600;">Log my numbers</a></p>
      <p style="font-size:12px;color:#64748b">Sam — Apex Financial</p>
    `;

    let smsSent = 0, emailsSent = 0, errors = 0;
    for (const r of reminders) {
      // SMS via carrier gateway
      const digits = cleanPhone(r.phone);
      const carrierGateway = r.carrier ? CARRIER_GATEWAYS[r.carrier.toLowerCase()] : undefined;
      if (digits.length === 10 && carrierGateway) {
        try {
          const result = await sendEmail({
            to: `${digits}@${carrierGateway}`,
            subject: "",
            text: body,
            tagName: "numbers-reminder-sms",
          });
          if (result.ok) smsSent++; else errors++;
        } catch { errors++; }
      }
      // Email (always)
      if (r.email && !(await isUnsubscribed(r.email, sb))) {
        try {
          const personalizedHtml = html.replace("{{first_name}}", r.name.split(" ")[0]);
          const result = await sendEmail({
            to: r.email,
            subject,
            html: personalizedHtml,
            text: body,
            unsubscribe_token: r.agent_id,
            tagName: "numbers-reminder",
          });
          if (result.ok) emailsSent++; else errors++;
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
      message: `Reminded ${reminders.length} agents · ${smsSent} SMS · ${emailsSent} email · ${errors} errors`,
    });

    return new Response(JSON.stringify({
      ok: true,
      candidates: agents?.length ?? 0,
      already_logged: loggedIds.size,
      reminded: reminders.length,
      sms_sent: smsSent,
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
