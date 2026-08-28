// send-agent-onboarding-email
//
// Drains agent_onboarding_queue: sends licensed online-training, primary
// team-community, and onboarding-call emails at 9:30 AM US/Central.
//
// Triggered by pg_cron at:
//   - 14:30 UTC daily (9:30 AM Central during CDT)
//   - 15:30 UTC daily (9:30 AM Central during CST)
// Plus on-demand POST during testing.
//
// Per APEX Operating Contract: NO fake success. A Resend 200 with non-JSON
// body or missing `data.id` is treated as FAILURE and we increment the
// attempt counter instead of marking sent.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

function tokenMatches(presented: string, expected: string): boolean {
  if (!presented || !expected || presented.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) {
    difference |= presented.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return difference === 0;
}

interface QueueRow {
  id: string;
  agent_id: string;
  email_kind: "course" | "discord" | "hired_whatsapp" | "onboarding_call";
  attempt_count: number;
  meta: Record<string, unknown> | null;
}

interface Settings {
  resend_api_key: string | null;
  community_invite_url: string | null;
  discord_invite_url: string | null;
  from_address: string;
  // Lane 3 (2026-08-26): onboarding-call booking link.
  onboarding_call_event_type_uri: string | null;
  onboarding_call_scheduling_url: string | null;
  calendly_api_token: string | null;
}

// This worker intentionally queries migrations newer than the checked-in
// generated Database type. Keep the service-role client schema-loose here so
// Deno validates the real runtime contract instead of inferring every row as
// `never` until types are regenerated after deployment.
async function loadSettings(sb: any): Promise<Settings> {
  const { data } = await sb
    .from("system_settings")
    .select("key,value")
    .in("key", [
      "resend_api_key",
      "discord_invite_url",
      "slack_community_invite_url",
      "onboarding_email_from_address",
      "onboarding_call_event_type_uri",
      "onboarding_call_scheduling_url",
    ]);

  const map = new Map<string, string | null>();
  for (const row of (data ?? []) as Array<{ key: string; value: string | null }>) {
    map.set(row.key, row.value);
  }

  // Env can override system_settings (preferred for secrets).
  const envResend = Deno.env.get("RESEND_API_KEY");

  // Slack is the primary team app. Keep the legacy Discord setting only as a
  // fallback so an operator cannot strand a hire while settings are migrated.
  const slackRaw = map.get("slack_community_invite_url");
  const discordRaw = map.get("discord_invite_url");
  const communityRaw = slackRaw && slackRaw.trim().length > 0 ? slackRaw : discordRaw;
  const communityUrl = communityRaw && communityRaw.trim().length > 0 ? communityRaw.trim() : null;
  const fromRaw = map.get("onboarding_email_from_address");
  const fromAddr = fromRaw && fromRaw.trim().length > 0
    ? fromRaw.trim()
    : "Sam James <sam@apex-financial.org>";

  const eventTypeRaw = map.get("onboarding_call_event_type_uri");
  const schedulingRaw = map.get("onboarding_call_scheduling_url");
  const calendlyTok = (Deno.env.get("CALENDLY_API_TOKEN") ?? "").trim();

  return {
    resend_api_key: envResend && envResend.length > 8 ? envResend : (map.get("resend_api_key") ?? null),
    community_invite_url: communityUrl,
    discord_invite_url: discordRaw && discordRaw.trim().length > 0 ? discordRaw.trim() : null,
    from_address: fromAddr,
    onboarding_call_event_type_uri: eventTypeRaw && eventTypeRaw.trim().length > 0 ? eventTypeRaw.trim() : null,
    onboarding_call_scheduling_url: schedulingRaw && schedulingRaw.trim().length > 0 ? schedulingRaw.trim() : null,
    calendly_api_token: calendlyTok.length > 8 ? calendlyTok : null,
  };
}

/**
 * Lane 3 (2026-08-26): the booking link for the onboarding-call email.
 * Preferred: a single-use Calendly scheduling link minted server-side (one
 * booking, dies after use, cannot be forwarded). Needs CALENDLY_API_TOKEN (the
 * same secret calendly-backfill reconciles with) + the event type URI. Falls
 * back to the event type's public scheduling URL and records WHY, so the queue
 * row never claims a single-use link it did not get.
 */
async function resolveOnboardingBookingLink(
  settings: Settings,
): Promise<{ url: string; kind: "single_use" | "event_type"; error: string | null } | null> {
  const fallback = (reason: string) => {
    const url = settings.onboarding_call_scheduling_url;
    return url ? { url, kind: "event_type" as const, error: reason } : null;
  };
  if (!settings.calendly_api_token) return fallback("CALENDLY_API_TOKEN not set");
  if (!settings.onboarding_call_event_type_uri) return fallback("onboarding_call_event_type_uri not set");
  try {
    const r = await fetch("https://api.calendly.com/scheduling_links", {
      method: "POST",
      headers: { Authorization: `Bearer ${settings.calendly_api_token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        max_event_count: 1,
        owner: settings.onboarding_call_event_type_uri,
        owner_type: "EventType",
      }),
    });
    const text = await r.text();
    if (!r.ok) return fallback(`Calendly ${r.status}: ${text.slice(0, 160)}`);
    const parsed = JSON.parse(text) as { resource?: { booking_url?: string } };
    const url = parsed.resource?.booking_url;
    if (url && url.startsWith("https://")) return { url, kind: "single_use", error: null };
    return fallback(`single-use link response had no booking_url: ${text.slice(0, 160)}`);
  } catch (err) {
    return fallback(`single-use link fetch failed: ${String(err)}`);
  }
}

function firstName(fullName: string | null | undefined): string {
  if (!fullName) return "there";
  const cleaned = fullName.trim();
  if (!cleaned) return "there";
  return cleaned.split(/\s+/)[0];
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildCourseEmail(name: string): { subject: string; html: string; text: string } {
  const fn = escapeHtml(firstName(name));
  const trainingUrl = "https://apex-financial.org/dashboard/recruiting/training/library";
  const roadmapUrl = "https://apex-financial.org/agent-portal";
  const url = escapeHtml(trainingUrl);
  const roadmap = escapeHtml(roadmapUrl);
  const subject = "Your APEX online training is ready";
  const text = [
    `Hey ${fn},`,
    ``,
    `You're licensed. Your APEX online training is ready: ${trainingUrl}`,
    ``,
    `Step 1 — Sign in and confirm your APEX account and profile.`,
    `Step 2 — Complete onboarding, scripts, objections, ReadyMode, pipeline, deal-posting, and underwriting modules in order.`,
    `Step 3 — Open your live roadmap for the next unlocked action: ${roadmapUrl}`,
    `Step 4 — Use Slack for training questions and team support.`,
    ``,
    `If you hit a snag, reply here. We move fast.`,
    ``,
    `— Sam`,
    `APEX Financial`,
  ].join("\n");

  const html = `
<!doctype html>
<html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#111;line-height:1.55;">
  <p>Hey ${fn},</p>
  <p>You're licensed. Your APEX online training is ready:</p>
  <p><a href="${url}" style="display:inline-block;padding:12px 20px;background:#0a0a0a;color:#fff;text-decoration:none;border-radius:6px;font-weight:600;">Start online training</a></p>
  <p style="margin-top:24px;"><strong>Step 1.</strong> Sign in and confirm your APEX account and profile.<br/>
  <strong>Step 2.</strong> Complete onboarding, scripts, objections, ReadyMode, pipeline, deal-posting, and underwriting modules in order.<br/>
  <strong>Step 3.</strong> <a href="${roadmap}">Open your live roadmap</a> for the next unlocked action.<br/>
  <strong>Step 4.</strong> Use Slack for training questions and team support.</p>
  <p>If you hit a snag, reply here. We move fast.</p>
  <p style="margin-top:24px;">— Sam<br/>APEX Financial</p>
</body></html>`.trim();

  return { subject, html, text };
}

function buildCommunityEmail(name: string, communityUrl: string | null, discordUrl: string | null): { subject: string; html: string; text: string } {
  const fn = escapeHtml(firstName(name));
  const url = communityUrl ? escapeHtml(communityUrl) : null;
  const discord = discordUrl ? escapeHtml(discordUrl) : null;
  const subject = "Join APEX Slack + Discord — your team access";

  const linkLine = url
    ? `Join here: ${communityUrl}`
    : `Reply to this email and I'll send you the invite link directly.`;

  const text = [
    `Hey ${fn},`,
    ``,
    linkLine,
    discordUrl ? `Join Discord: ${discordUrl}` : `Reply to this email if you still need the Discord invite.`,
    ``,
    `Slack is your primary team hub for next steps, contracting support, training, and sales wins.`,
    `Join now so your onboarding team can keep you moving.`,
    `Then open your APEX account roadmap: https://apex-financial.org/agent-portal`,
    ``,
    `See you there.`,
    ``,
    `— Sam`,
    `APEX Financial`,
  ].join("\n");

  const ctaHtml = url
    ? `<p><a href="${url}" style="display:inline-block;padding:12px 20px;background:#4A154B;color:#fff;text-decoration:none;border-radius:6px;font-weight:600;">Join the APEX Slack</a></p>`
    : `<p>Reply to this email and I'll send you the invite link directly.</p>`;
  const discordHtml = discord
    ? `<p><a href="${discord}" style="display:inline-block;padding:12px 20px;background:#5865F2;color:#fff;text-decoration:none;border-radius:6px;font-weight:600;">Join the APEX Discord</a></p>`
    : `<p>Reply to this email if you still need the Discord invite.</p>`;

  const html = `
<!doctype html>
<html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#111;line-height:1.55;">
  <p>Hey ${fn},</p>
  ${ctaHtml}
  ${discordHtml}
  <p>Slack is your <strong>primary team hub</strong> for next steps, contracting support, training, and sales wins. Join now so your onboarding team can keep you moving.</p>
  <p><strong>Next:</strong> <a href="https://apex-financial.org/agent-portal">open your APEX account roadmap</a>, confirm your profile, and complete the action shown as current.</p>
  <p>See you there.</p>
  <p style="margin-top:24px;">— Sam<br/>APEX Financial</p>
</body></html>`.trim();

  return { subject, html, text };
}

function buildOnboardingCallEmail(name: string, bookingUrl: string): { subject: string; html: string; text: string } {
  const fn = escapeHtml(firstName(name));
  const url = escapeHtml(bookingUrl);
  const subject = "Book your APEX onboarding call";

  const text = [
    `Hey ${fn},`,
    ``,
    `You're licensed and you're in. Next step is your 30-minute onboarding call with Milver, your Onboarding Manager, and me.`,
    ``,
    `Pick a time here: ${bookingUrl}`,
    ``,
    `Come with your NPN and your contracting login. We set up your systems, walk your first-week plan, and get you into the 9:30 AM Central huddle.`,
    ``,
    `— Sam`,
    `APEX Financial`,
  ].join("\n");

  const html = `
<!doctype html>
<html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#111;line-height:1.55;">
  <p>Hey ${fn},</p>
  <p>You're licensed and you're in. Next step is your <strong>30-minute onboarding call</strong> with Milver, your Onboarding Manager, and me.</p>
  <p><a href="${url}" style="display:inline-block;padding:12px 20px;background:#0a0a0a;color:#EDB81D;text-decoration:none;border-radius:6px;font-weight:600;">Book your onboarding call</a></p>
  <p>Come with your NPN and your contracting login. We set up your systems, walk your first-week plan, and get you into the 9:30 AM Central huddle.</p>
  <p style="margin-top:24px;">— Sam<br/>APEX Financial</p>
</body></html>`.trim();

  return { subject, html, text };
}

interface ResendResult {
  ok: boolean;
  id: string | null;
  error: string | null;
}

async function sendViaResend(
  apiKey: string,
  from: string,
  to: string,
  subject: string,
  html: string,
  text: string,
): Promise<ResendResult> {
  let res: Response;
  try {
    res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject,
        html,
        text,
        reply_to: "sam@apex-financial.org",
      }),
    });
  } catch (err) {
    return { ok: false, id: null, error: `fetch failed: ${String(err)}` };
  }

  const bodyText = await res.text();

  // No fake success — reject HTML masquerade.
  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return {
      ok: false,
      id: null,
      error: `non-JSON response (status=${res.status}, content-type=${contentType}, body_snippet=${bodyText.slice(0, 200)})`,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    return { ok: false, id: null, error: `JSON parse failed: ${bodyText.slice(0, 200)}` };
  }

  if (!res.ok) {
    const msg = (parsed && typeof parsed === "object" && "message" in parsed)
      ? String((parsed as { message: unknown }).message)
      : `status ${res.status}`;
    return { ok: false, id: null, error: `resend error: ${msg}` };
  }

  const id =
    (parsed && typeof parsed === "object" && "id" in parsed && typeof (parsed as { id: unknown }).id === "string")
      ? (parsed as { id: string }).id
      : null;

  if (!id) {
    return { ok: false, id: null, error: `resend 200 but no data.id (body=${bodyText.slice(0, 200)})` };
  }

  return { ok: true, id, error: null };
}

interface ProcessResult {
  processed: number;
  sent: number;
  failed: number;
  skipped_no_email: number;
  skipped_wrong_cohort: number;
  skipped_booking_exists: number;
  skipped_retired_channel: number;
  errors: Array<{ queue_id: string; agent_id: string; kind: string; error: string }>;
}

async function drainQueue(sb: any, settings: Settings): Promise<ProcessResult> {
  const result: ProcessResult = { processed: 0, sent: 0, failed: 0, skipped_no_email: 0, skipped_wrong_cohort: 0, skipped_booking_exists: 0, skipped_retired_channel: 0, errors: [] };

  if (!settings.resend_api_key) {
    throw new Error("Missing RESEND_API_KEY (env or system_settings.resend_api_key).");
  }

  const { data: queueData, error: queueErr } = await sb
    .from("agent_onboarding_queue")
    .select("id, agent_id, email_kind, attempt_count, meta")
    .is("sent_at", null)
    .lt("attempt_count", 5)
    .lte("target_send_at", new Date().toISOString())
    .order("target_send_at", { ascending: true })
    .limit(50);

  if (queueErr) {
    throw new Error(`queue fetch failed: ${queueErr.message}`);
  }

  const rows = (queueData ?? []) as QueueRow[];
  result.processed = rows.length;

  for (const row of rows) {
    // Preserve old delivery receipts, but make the retired messaging-channel
    // kind terminal and unsendable. sent_at remains null: nothing is claimed.
    if (row.email_kind === "hired_whatsapp") {
      await sb
        .from("agent_onboarding_queue")
        .update({ attempt_count: 5, last_error: "retired_channel: use Slack onboarding" })
        .eq("id", row.id);
      result.skipped_retired_channel += 1;
      continue;
    }

    // Fetch agent + contact for each row (small N, simpler than batch join).
    // Agent creation has three legitimate shapes in production:
    //   1) profile_id points directly at profiles.id,
    //   2) user_id resolves through profiles.user_id,
    //   3) a pre-account hire only has source_application_id.
    // Requiring user_id dropped valid new hires from onboarding.
    const { data: agentRow } = await sb
      .from("agents")
      .select("id, user_id, profile_id, source_application_id, display_name, agent_code, license_status, status, is_deactivated, is_inactive")
      .eq("id", row.agent_id)
      .maybeSingle();

    if (!agentRow) {
      await sb
        .from("agent_onboarding_queue")
        .update({
          attempt_count: row.attempt_count + 1,
          last_error: "agent missing",
        })
        .eq("id", row.id);
      result.failed += 1;
      result.errors.push({ queue_id: row.id, agent_id: row.agent_id, kind: row.email_kind, error: "agent missing" });
      continue;
    }

    if (agentRow.status !== "active" || agentRow.is_deactivated || agentRow.is_inactive) {
      await sb
        .from("agent_onboarding_queue")
        .update({
          attempt_count: 5,
          last_error: `terminal_inactive_agent: status=${agentRow.status ?? "null"}`,
        })
        .eq("id", row.id);
      result.skipped_wrong_cohort += 1;
      continue;
    }

    let profile: { email?: string | null; full_name?: string | null } | null = null;
    if (agentRow.profile_id) {
      const { data } = await sb.from("profiles").select("email, full_name").eq("id", agentRow.profile_id).maybeSingle();
      profile = data;
    }
    if (!profile?.email && agentRow.user_id) {
      const { data } = await sb.from("profiles").select("email, full_name").eq("user_id", agentRow.user_id).maybeSingle();
      profile = data ?? profile;
    }

    let application: { email?: string | null; first_name?: string | null; last_name?: string | null } | null = null;
    if (!profile?.email && agentRow.source_application_id) {
      const { data } = await sb
        .from("applications")
        .select("email, first_name, last_name")
        .eq("id", agentRow.source_application_id)
        .maybeSingle();
      application = data;
    }

    let authEmail: string | null = null;
    if (!profile?.email && !application?.email && agentRow.user_id) {
      const { data } = await sb.auth.admin.getUserById(agentRow.user_id);
      authEmail = data?.user?.email ?? null;
    }

    const email = (profile?.email ?? application?.email ?? authEmail ?? "").trim();
    if (!email) {
      await sb
        .from("agent_onboarding_queue")
        .update({
          attempt_count: row.attempt_count + 1,
          last_error: "profile email missing",
        })
        .eq("id", row.id);
      result.skipped_no_email += 1;
      continue;
    }

    const applicationName = [application?.first_name, application?.last_name].filter(Boolean).join(" ").trim();
    const name = profile?.full_name || applicationName || agentRow.display_name || null;

    // Cohort guard: course / community / onboarding-call are HIRED-cohort emails.
    // They must only fire for agents whose license_status = 'licensed'.
    // Anything else (NULL / 'unlicensed' / etc.) means the agent shouldn't
    // be in the hired chain yet — skip and record. Prospect cohort is
    // handled by the applicant onboarding path, not this queue.
    const licenseStatus = (agentRow?.license_status ?? "").toString().toLowerCase();
    const isLicensed = licenseStatus === "licensed";

    if (
      (row.email_kind === "course" ||
        row.email_kind === "discord" ||
        row.email_kind === "onboarding_call") &&
      !isLicensed
    ) {
      await sb
        .from("agent_onboarding_queue")
        .update({
          attempt_count: row.attempt_count + 1,
          last_error: `skipped_wrong_cohort: license_status=${licenseStatus || "null"} but email_kind=${row.email_kind} requires licensed`,
        })
        .eq("id", row.id);
      result.skipped_wrong_cohort += 1;
      continue;
    }

    let built: { subject: string; html: string; text: string };
    let meta: Record<string, unknown> | null = null;
    if (row.email_kind === "course") {
      built = buildCourseEmail(name ?? "");
    } else if (row.email_kind === "onboarding_call") {
      // Lane 3 (2026-08-26): ONE booking link per licensed hire. Re-check the
      // calendar at send time — a hire who booked between enqueue and drain must
      // not be asked to book again. A terminal skip is recorded as what it is.
      const { data: existingBooking, error: bookingErr } = await sb.rpc("fn_agent_onboarding_call_booking", { p_agent_id: row.agent_id });
      if (bookingErr) {
        await sb
          .from("agent_onboarding_queue")
          .update({ attempt_count: row.attempt_count + 1, last_error: `booking lookup failed: ${bookingErr.message}` })
          .eq("id", row.id);
        result.failed += 1;
        result.errors.push({ queue_id: row.id, agent_id: row.agent_id, kind: row.email_kind, error: `booking lookup failed: ${bookingErr.message}` });
        continue;
      }
      if (existingBooking) {
        await sb
          .from("agent_onboarding_queue")
          .update({ attempt_count: 5, last_error: `skipped_booking_exists: interview_events ${String(existingBooking)}` })
          .eq("id", row.id);
        result.skipped_booking_exists += 1;
        continue;
      }
      const link = await resolveOnboardingBookingLink(settings);
      if (!link) {
        await sb
          .from("agent_onboarding_queue")
          .update({ attempt_count: row.attempt_count + 1, last_error: "no onboarding booking link: set system_settings.onboarding_call_scheduling_url" })
          .eq("id", row.id);
        result.failed += 1;
        result.errors.push({ queue_id: row.id, agent_id: row.agent_id, kind: row.email_kind, error: "no onboarding booking link configured" });
        continue;
      }
      built = buildOnboardingCallEmail(name ?? "", link.url);
      meta = { booking_url: link.url, link_kind: link.kind, link_error: link.error };
    } else {
      built = buildCommunityEmail(name ?? "", settings.community_invite_url, settings.discord_invite_url);
    }

    // The legacy `discord` queue kind now delivers the primary Slack invite.
    // An email without an invite link is still useful (asks them to
    // reply for the link), so we still send. If we ever want to gate it,
    // flip this comment to an early skip.
    const sendResult = await sendViaResend(
      settings.resend_api_key,
      settings.from_address,
      email,
      built.subject,
      built.html,
      built.text,
    );

    if (sendResult.ok) {
      await sb
        .from("agent_onboarding_queue")
        .update({
          sent_at: new Date().toISOString(),
          resend_message_id: sendResult.id,
          last_error: null,
          ...(meta ? { meta: { ...(row.meta ?? {}), ...meta } } : {}),
        })
        .eq("id", row.id);
      result.sent += 1;
    } else {
      await sb
        .from("agent_onboarding_queue")
        .update({
          attempt_count: row.attempt_count + 1,
          last_error: sendResult.error,
        })
        .eq("id", row.id);
      result.failed += 1;
      result.errors.push({
        queue_id: row.id,
        agent_id: row.agent_id,
        kind: row.email_kind,
        error: sendResult.error ?? "unknown",
      });
    }
  }

  return result;
}

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const presented = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  const botToken = (Deno.env.get("APEX_BOT_TOKEN") ?? "").trim();
  const authorized = tokenMatches(presented, SERVICE_ROLE) || tokenMatches(presented, botToken);
  if (!authorized) {
    return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const sb = createClient(SUPABASE_URL, SERVICE_ROLE);
    const settings = await loadSettings(sb);
    const result = await drainQueue(sb, settings);

    return new Response(
      JSON.stringify({
        ok: true,
        timestamp: new Date().toISOString(),
        ...result,
        config: {
          community_invite_url_present: Boolean(settings.community_invite_url),
          discord_invite_url_present: Boolean(settings.discord_invite_url),
          from_address: settings.from_address,
        },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        timestamp: new Date().toISOString(),
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
