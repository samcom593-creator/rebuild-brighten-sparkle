// numbers-reminder (v2 — 2026-08-26, tri-channel)
//
// Fires once at 6pm America/Chicago every day (two pg_cron jobs cover CDT/CST;
// this function gates on the Chicago-local hour so a double fire is a no-op).
// Finds present licensed agents who have not logged progress or posted
// production and reminds each of them ONCE, on every channel that can reach
// them:
//   email    — Resend (existing path, unchanged)
//   sms      — send-sms-auto-detect (email-to-carrier gateway; "sent" means the
//              gateway accepted the message, never that the handset rang)
//   slack dm — chat.postMessage to the agent's verified slack_user_id from
//              messaging_identity_links (0 links exist on 2026-08-26, so this
//              leg records 'no_slack_link' honestly until agents are linked)
// Each leg writes its own status + receipt column on
// numbers_reminder_delivery_log. The row is written once ANY leg lands, which
// keeps the once-per-agent-per-business-day rule. A leg that cannot be tried
// says why ('no_phone', 'no_slack_link', 'no_token') rather than being absent.
//
// Body: { force?: boolean, dry_run?: boolean }
//   force   — ignore the 6pm window (proofs only)
//   dry_run — compute recipients + channel availability, SEND NOTHING, return
//             the plan. This is how the function is proven without paging 17
//             agents at 5am.
// Returns: { reminded, email_sent, sms_sent, slack_sent, errors, plan? }
//
// Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, APEX_BOT_TOKEN,
//               RESEND_API_KEY
// Optional env: SLACK_BOT_TOKEN (or the installation's bot_token_secret_ref)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.90.1";
import { sendEmail, isUnsubscribed } from "../_shared/email.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-request-id, idempotency-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function chicagoParts(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return { date: `${value("year")}-${value("month")}-${value("day")}`, hour: Number(value("hour")) };
}

type Leg = { status: string; receipt?: string | null; error?: string | null };
type Recipient = {
  agent_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  slack_user_id: string | null;
};

const SMS_TEXT = "Apex: log today's calls, presentations and deals before close of business. apex-financial.org/numbers";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const botToken = (Deno.env.get("APEX_BOT_TOKEN") ?? "").trim();
  if (!supabaseUrl || !serviceKey || !botToken) {
    return json({ ok: false, error: "server_not_configured" }, 503);
  }

  const authorization = req.headers.get("authorization")?.trim() ?? "";
  const bearer = authorization.replace(/^Bearer\s+/i, "").trim();
  if (!bearer || (bearer !== botToken && bearer !== serviceKey)) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }

  const sb = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const startedAt = new Date();

  try {
    const requestPayload = await req.json().catch(() => ({})) as { force?: boolean; dry_run?: boolean };
    const dryRun = requestPayload.dry_run === true;
    const chicago = chicagoParts();
    if (!requestPayload.force && !dryRun && chicago.hour !== 18) {
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

    // Also count any deal posted today (canonical, all origins) as activity.
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
      .select("user_id, full_name, email, phone")
      .in("user_id", userIds.length ? userIds : ["00000000-0000-0000-0000-000000000000"]);
    const profileByUser = new Map((profiles ?? []).map((p: any) => [p.user_id, p]));

    const { data: exclusions } = await sb.from("roster_exclusions").select("agent_id");
    const excludedIds = new Set((exclusions ?? []).map((row: { agent_id: string }) => row.agent_id));
    const { data: slackExclusions, error: slackExclusionsError } = await sb
      .from("messaging_audience_exclusions")
      .select("agent_id")
      .eq("provider", "slack")
      .eq("is_active", true);
    if (slackExclusionsError) throw slackExclusionsError;
    for (const row of (slackExclusions ?? []) as Array<{ agent_id: string }>) {
      excludedIds.add(row.agent_id);
    }

    const { data: delivered } = await sb
      .from("numbers_reminder_delivery_log")
      .select("agent_id")
      .eq("business_date", today);
    const alreadyReminded = new Set((delivered ?? []).map((row: { agent_id: string }) => row.agent_id));

    const agentIds = (agents ?? []).map((a: { id: string }) => a.id);
    const { data: links } = await sb
      .from("messaging_identity_links")
      .select("agent_id, slack_user_id, verification_status, revoked_at")
      .in("agent_id", agentIds.length ? agentIds : ["00000000-0000-0000-0000-000000000000"])
      .is("revoked_at", null);
    const slackByAgent = new Map<string, string>();
    for (const l of (links ?? []) as any[]) {
      if (l.slack_user_id && l.verification_status === "verified") slackByAgent.set(l.agent_id, l.slack_user_id);
    }

    const recipients: Recipient[] = [];
    for (const a of (agents ?? []) as any[]) {
      if (loggedIds.has(a.id) || alreadyReminded.has(a.id) || excludedIds.has(a.id)) continue;
      const profile = profileByUser.get(a.user_id) as any;
      recipients.push({
        agent_id: a.id,
        name: profile?.full_name ?? a.display_name ?? "Agent",
        email: profile?.email ?? null,
        phone: profile?.phone ?? null,
        slack_user_id: slackByAgent.get(a.id) ?? null,
      });
    }

    const slackToken = (Deno.env.get("SLACK_BOT_TOKEN") ?? "").trim();

    if (dryRun) {
      return json({
        ok: true,
        dry_run: true,
        business_date: today,
        candidates: agents?.length ?? 0,
        already_logged: loggedIds.size,
        already_reminded: alreadyReminded.size,
        reminded: recipients.length,
        excluded: excludedIds.size,
        slack_token_present: Boolean(slackToken),
        channel_availability: {
          email: recipients.filter((r) => Boolean(r.email)).length,
          sms: recipients.filter((r) => Boolean(r.phone)).length,
          slack: recipients.filter((r) => Boolean(r.slack_user_id && slackToken)).length,
        },
      });
    }

    // ── 3. Send exactly one reminder per agent/business day, on every leg ──
    const subject = "Apex · log your numbers";
    const messageBody = `Quick reminder — log today's calls, presentations, and deals before close of business.\n\nhttps://apex-financial.org/numbers`;
    const html = `
      <p>Hey ${"{{first_name}}"} — quick reminder.</p>
      <p>Log today's calls, presentations, and deals before close of business so your stats stay accurate:</p>
      <p><a href="https://apex-financial.org/numbers" style="display:inline-block;padding:10px 18px;background:#EDB81D;color:#0a0f1a;text-decoration:none;border-radius:6px;font-weight:600;">Log my numbers</a></p>
      <p style="font-size:12px;color:#64748b">Sam — Apex Financial</p>
    `;

    let emailsSent = 0, smsSent = 0, slackSent = 0, errors = 0, rowsWritten = 0;
    for (const r of recipients) {
      const first = r.name.split(" ")[0];
      const legs: Record<string, Leg> = {};

      // email
      if (!r.email) legs.email = { status: "no_email" };
      else if (await isUnsubscribed(sb, r.email)) legs.email = { status: "unsubscribed" };
      else {
        try {
          const result = await sendEmail({
            to: r.email,
            subject,
            html: html.replace("{{first_name}}", first),
            text: messageBody,
            unsubscribe_token: r.agent_id,
            tagName: "numbers-reminder",
          });
          legs.email = result.ok
            ? { status: "sent", receipt: (result as any).id ?? (result as any).messageId ?? null }
            : { status: "failed", error: String((result as any).error ?? "send failed").slice(0, 200) };
        } catch (err) {
          legs.email = { status: "failed", error: String((err as Error)?.message ?? err).slice(0, 200) };
        }
      }

      // sms — service-role call; the gateway resolves the carrier from the
      // profile on file and refuses to guess when it is unknown (MP-270).
      if (!r.phone) legs.sms = { status: "no_phone" };
      else {
        try {
          const resp = await fetch(`${supabaseUrl}/functions/v1/send-sms-auto-detect`, {
            method: "POST",
            headers: { Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({ phone: r.phone, message: `${first}: ${SMS_TEXT}`.slice(0, 160) }),
          });
          const body = await resp.json().catch(() => ({} as any));
          // MP-336: send-sms-auto-detect's contract (MP-270) is `outcome` in
          // {sent, skipped, failed}; "skipped" = no carrier on file, nothing sent.
          // This branch used to test a `skipped` field that does not exist and a
          // regex on an `error` string that is never set, so every honest
          // "skipped" came back as `failed HTTP 200` — 7 of 11 SMS attempts on
          // 2026-08-26 recorded as failures, errors=7 in automation_run_log,
          // while notification_log held the truth. Branch on the contract.
          const outcome = String(body?.outcome ?? "");
          if (resp.ok && (outcome === "sent" || body?.success === true)) {
            legs.sms = { status: "sent", receipt: body?.carrierSelected ? `gateway:${body.carrierSelected}` : "gateway" };
          } else if (outcome === "skipped" || body?.skipped || /carrier/i.test(String(body?.error ?? ""))) {
            legs.sms = { status: "skipped_unknown_carrier", error: String(body?.error ?? "no carrier on file").slice(0, 200) };
          } else {
            legs.sms = { status: "failed", error: `HTTP ${resp.status} ${String(body?.error ?? "").slice(0, 160)}` };
          }
        } catch (err) {
          legs.sms = { status: "failed", error: String((err as Error)?.message ?? err).slice(0, 200) };
        }
      }

      // slack dm
      if (!r.slack_user_id) legs.slack = { status: "no_slack_link" };
      else if (!slackToken) legs.slack = { status: "no_token" };
      else {
        try {
          const resp = await fetch("https://slack.com/api/chat.postMessage", {
            method: "POST",
            headers: { Authorization: `Bearer ${slackToken}`, "Content-Type": "application/json; charset=utf-8" },
            body: JSON.stringify({
              channel: r.slack_user_id,
              text: `Hey ${first} — log today's calls, presentations and deals before close of business: https://apex-financial.org/numbers`,
            }),
          });
          const body = await resp.json().catch(() => ({} as any));
          legs.slack = body?.ok
            ? { status: "sent", receipt: body?.ts ? `${body.channel}:${body.ts}` : null }
            : { status: "failed", error: String(body?.error ?? `HTTP ${resp.status}`).slice(0, 200) };
        } catch (err) {
          legs.slack = { status: "failed", error: String((err as Error)?.message ?? err).slice(0, 200) };
        }
      }

      if (legs.email?.status === "sent") emailsSent++;
      if (legs.sms?.status === "sent") smsSent++;
      if (legs.slack?.status === "sent") slackSent++;
      const anyLanded = Object.values(legs).some((l) => l.status === "sent");
      if (Object.values(legs).some((l) => l.status === "failed")) errors++;

      if (anyLanded) {
        const { error: logErr } = await sb.from("numbers_reminder_delivery_log").upsert({
          business_date: today,
          agent_id: r.agent_id,
          email: r.email,
          sent_at: new Date().toISOString(),
          email_status: legs.email?.status ?? null,
          email_receipt: legs.email?.receipt ?? null,
          sms_status: legs.sms?.status ?? null,
          sms_receipt: legs.sms?.receipt ?? null,
          slack_status: legs.slack?.status ?? null,
          slack_receipt: legs.slack?.receipt ?? null,
          channels: legs,
          updated_at: new Date().toISOString(),
        }, { onConflict: "business_date,agent_id" });
        if (logErr) { console.error("numbers-reminder log write failed:", logErr.message); errors++; }
        else rowsWritten++;
      }
    }

    // ── 4. Stamp the heartbeat ─────────────────────────────────────────
    await sb.from("system_settings").upsert({
      key: "last_numbers_reminder",
      value: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    const completedAt = new Date();
    const runSummary = {
      business_date: today,
      due: recipients.length,
      email_sent: emailsSent,
      sms_sent: smsSent,
      slack_sent: slackSent,
      rows_written: rowsWritten,
      errors,
    };
    const { error: heartbeatError } = await sb.from("automation_run_log").insert({
      job_name: "numbers-reminder",
      status: errors > 0 && rowsWritten === 0 && recipients.length > 0 ? "error" : "ok",
      triggered_at: startedAt.toISOString(),
      completed_at: completedAt.toISOString(),
      response_body: runSummary,
      error: errors > 0 ? `${errors} channel or receipt error(s)` : null,
      duration_ms: completedAt.getTime() - startedAt.getTime(),
    });
    if (heartbeatError) {
      console.error("numbers-reminder heartbeat write failed:", heartbeatError.message);
      errors++;
    }

    return json({
      ok: errors === 0,
      business_date: today,
      candidates: agents?.length ?? 0,
      already_logged: loggedIds.size,
      reminded: recipients.length,
      rows_written: rowsWritten,
      email_sent: emailsSent,
      sms_sent: smsSent,
      slack_sent: slackSent,
      errors,
      heartbeat_written: !heartbeatError,
    });
  } catch (err: any) {
    console.error("numbers-reminder error:", err);
    return json({ ok: false, error: String(err?.message ?? err) }, 500);
  }
});
