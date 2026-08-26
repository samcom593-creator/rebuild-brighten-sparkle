import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

import { isUnsubscribed, sendEmail } from "../_shared/email.ts";

type FreeLeadsRow = {
  agent_id: string;
  qualifies: boolean;
  reason: string;
  l30_alp: number | string;
  tenure_days: number;
  days_left_in_ramp: number;
  needed_for_qual: number | string;
};

const json = (body: Record<string, unknown>, status = 200) => new Response(
  JSON.stringify(body),
  { status, headers: { "content-type": "application/json", "cache-control": "no-store" } },
);

function phoenixWeekStart(now = new Date()): string {
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Phoenix",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const value = new Date(`${date}T12:00:00-07:00`);
  const day = value.getUTCDay();
  value.setUTCDate(value.getUTCDate() - ((day + 6) % 7));
  return value.toISOString().slice(0, 10);
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok");
  if (request.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const expected = Deno.env.get("APEX_BOT_TOKEN")?.trim() ?? "";
  const presented = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ?? "";
  if (!supabaseUrl || !serviceRoleKey || !expected) {
    return json({ ok: false, error: "server_not_configured" }, 503);
  }
  if (!presented || presented !== expected) return json({ ok: false, error: "unauthorized" }, 401);

  const sb = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  const weekStart = phoenixWeekStart();

  try {
    const { data: statusData, error: statusError } = await sb.rpc("crm_agent_free_leads_status");
    if (statusError) throw statusError;
    const statuses = (statusData ?? []) as FreeLeadsRow[];
    const near = statuses.filter((row) =>
      !row.qualifies && Number(row.needed_for_qual) > 0 && Number(row.needed_for_qual) <= 5_000
    );
    const eligible = statuses.filter((row) => row.qualifies);
    const alertRows = [...eligible, ...near];
    const agentIds = alertRows.map((row) => row.agent_id);

    const { data: agents, error: agentError } = agentIds.length
      ? await sb.from("agents").select("id, user_id, display_name, profile_id").in("id", agentIds)
      : { data: [], error: null };
    if (agentError) throw agentError;
    const userIds = (agents ?? []).map((row: any) => row.user_id).filter(Boolean);
    const profileIds = (agents ?? []).map((row: any) => row.profile_id).filter(Boolean);
    const filters = [
      userIds.length ? `user_id.in.(${userIds.join(",")})` : "",
      profileIds.length ? `id.in.(${profileIds.join(",")})` : "",
    ].filter(Boolean).join(",");
    const { data: profiles, error: profileError } = filters
      ? await sb.from("profiles").select("id, user_id, full_name, email").or(filters)
      : { data: [], error: null };
    if (profileError) throw profileError;

    const profileByUser = new Map((profiles ?? []).map((row: any) => [row.user_id, row]));
    const profileById = new Map((profiles ?? []).map((row: any) => [row.id, row]));
    const agentById = new Map((agents ?? []).map((row: any) => [row.id, row]));
    const { data: deliveredRows } = await sb.from("free_leads_weekly_delivery_log")
      .select("agent_id").eq("week_start", weekStart).eq("channel", "email").eq("status", "delivered");
    const delivered = new Set((deliveredRows ?? []).map((row: any) => row.agent_id));

    let emailsSent = 0;
    let skipped = 0;
    let failed = 0;
    for (const row of alertRows) {
      if (delivered.has(row.agent_id)) {
        skipped += 1;
        continue;
      }
      const agent = agentById.get(row.agent_id) as any;
      const profile = profileByUser.get(agent?.user_id) ?? profileById.get(agent?.profile_id);
      const email = String((profile as any)?.email ?? "").trim().toLowerCase();
      const name = String((profile as any)?.full_name ?? agent?.display_name ?? "Agent").trim();
      if (!email || await isUnsubscribed(sb, email)) {
        skipped += 1;
        await sb.from("free_leads_weekly_delivery_log").upsert({
          week_start: weekStart, agent_id: row.agent_id, channel: "email", status: "skipped",
          error_redacted: email ? "unsubscribed" : "email_missing", updated_at: new Date().toISOString(),
        }, { onConflict: "week_start,agent_id,channel" });
        continue;
      }

      const l30 = Number(row.l30_alp).toLocaleString("en-US", { maximumFractionDigits: 0 });
      const gap = Number(row.needed_for_qual).toLocaleString("en-US", { maximumFractionDigits: 0 });
      const detail = row.qualifies
        ? `${row.reason}. Your trailing 30-day ALP is $${l30}.`
        : `Your trailing 30-day ALP is $${l30}. Write $${gap} more to unlock the $20K Free Leads tier.`;
      const result = await sendEmail({
        to: email,
        subject: row.qualifies ? "Your APEX Free Leads status is active" : `You're $${gap} from APEX Free Leads`,
        text: `Hey ${name.split(" ")[0]} — ${detail}\n\nTrack your live status: https://apex-financial.org/dashboard`,
        html: `<p>Hey ${name.split(" ")[0]} —</p><p>${detail}</p><p><a href="https://apex-financial.org/dashboard">Open my APEX dashboard</a></p>`,
        unsubscribe_token: row.agent_id,
        tagName: "free-leads-weekly",
      });
      await sb.from("free_leads_weekly_delivery_log").upsert({
        week_start: weekStart, agent_id: row.agent_id, channel: "email",
        status: result.ok ? "delivered" : "failed", provider_message_id: result.id,
        error_redacted: result.ok ? null : String(result.error ?? "delivery_failed").slice(0, 200),
        updated_at: new Date().toISOString(),
      }, { onConflict: "week_start,agent_id,channel" });
      if (result.ok) emailsSent += 1;
      else failed += 1;
    }

    const { error: summaryError } = await sb.from("outbox_events").insert({
      aggregate_type: "free_leads_weekly_summary",
      aggregate_id: crypto.randomUUID(),
      event_type: "free_leads.weekly_summary",
      destination: "slack",
      payload: {
        eligibleCount: eligible.length, nearCount: near.length, threshold: 20000,
        weekStart, openUrl: "https://apex-financial.org/dashboard/team",
      },
      idempotency_key: `free_leads.weekly.summary:${weekStart}:slack`,
      correlation_id: crypto.randomUUID(),
    });
    if (summaryError && summaryError.code !== "23505") throw summaryError;

    return json({
      ok: true, week_start: weekStart, eligible: eligible.length, near: near.length,
      emails_sent: emailsSent, skipped, failed, slack_summary_queued: true,
    });
  } catch (error) {
    console.error("free-leads-weekly-alerts", error);
    return json({ ok: false, error: String((error as Error)?.message ?? error).slice(0, 240) }, 500);
  }
});
