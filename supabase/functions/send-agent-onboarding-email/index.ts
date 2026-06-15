// send-agent-onboarding-email
//
// Drains agent_onboarding_queue: sends the prelicensing course access
// email and the Discord invite email to every new agent at 9:30 AM US/Central.
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

interface QueueRow {
  id: string;
  agent_id: string;
  email_kind: "course" | "discord";
  attempt_count: number;
}

interface Settings {
  resend_api_key: string | null;
  discord_invite_url: string | null;
  training_course_url: string;
  from_address: string;
}

async function loadSettings(sb: ReturnType<typeof createClient>): Promise<Settings> {
  const { data } = await sb
    .from("system_settings")
    .select("key,value")
    .in("key", [
      "resend_api_key",
      "discord_invite_url",
      "training_course_url",
      "onboarding_email_from_address",
    ]);

  const map = new Map<string, string | null>();
  for (const row of (data ?? []) as Array<{ key: string; value: string | null }>) {
    map.set(row.key, row.value);
  }

  // Env can override system_settings (preferred for secrets).
  const envResend = Deno.env.get("RESEND_API_KEY");

  const discordRaw = map.get("discord_invite_url");
  const discordUrl = discordRaw && discordRaw.trim().length > 0 ? discordRaw.trim() : null;
  const courseRaw = map.get("training_course_url");
  const courseUrl = courseRaw && courseRaw.trim().length > 0
    ? courseRaw.trim()
    : "https://apex-financial.org/onboarding-course";
  const fromRaw = map.get("onboarding_email_from_address");
  const fromAddr = fromRaw && fromRaw.trim().length > 0
    ? fromRaw.trim()
    : "Sam James <sam@apex-financial.org>";

  return {
    resend_api_key: envResend && envResend.length > 8 ? envResend : (map.get("resend_api_key") ?? null),
    discord_invite_url: discordUrl,
    training_course_url: courseUrl,
    from_address: fromAddr,
  };
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

function buildCourseEmail(name: string, courseUrl: string): { subject: string; html: string; text: string } {
  const fn = escapeHtml(firstName(name));
  const url = escapeHtml(courseUrl);
  const subject = "Your APEX prelicensing course access is ready";
  const text = [
    `Hey ${fn},`,
    ``,
    `Your prelicensing course is ready. Log in here: ${courseUrl}`,
    ``,
    `Step 1 — Create your account and confirm your name matches the one on your ID.`,
    `Step 2 — Work the modules in order. Most agents finish in 4-6 focused sessions.`,
    `Step 3 — Once you pass the course, reply to this email and we schedule your state exam.`,
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
  <p>Your prelicensing course is ready. Log in here:</p>
  <p><a href="${url}" style="display:inline-block;padding:12px 20px;background:#0a0a0a;color:#fff;text-decoration:none;border-radius:6px;font-weight:600;">Open the course</a></p>
  <p style="margin-top:24px;"><strong>Step 1.</strong> Create your account and confirm your name matches the one on your ID.<br/>
  <strong>Step 2.</strong> Work the modules in order. Most agents finish in 4-6 focused sessions.<br/>
  <strong>Step 3.</strong> Once you pass the course, reply to this email and we schedule your state exam.</p>
  <p>If you hit a snag, reply here. We move fast.</p>
  <p style="margin-top:24px;">— Sam<br/>APEX Financial</p>
</body></html>`.trim();

  return { subject, html, text };
}

function buildDiscordEmail(name: string, discordUrl: string | null): { subject: string; html: string; text: string } {
  const fn = escapeHtml(firstName(name));
  const url = discordUrl ? escapeHtml(discordUrl) : null;
  const subject = "Join the APEX Discord — 9:30 AM Central daily";

  const linkLine = url
    ? `Jump in here: ${discordUrl}`
    : `Reply to this email and I'll send you the invite link directly.`;

  const text = [
    `Hey ${fn},`,
    ``,
    linkLine,
    ``,
    `We meet at 9:30 AM Central every weekday — that's when the engine fires.`,
    `Morning huddle, hot leads, scripts, role-plays, and live deal walks.`,
    ``,
    `See you there.`,
    ``,
    `— Sam`,
    `APEX Financial`,
  ].join("\n");

  const ctaHtml = url
    ? `<p><a href="${url}" style="display:inline-block;padding:12px 20px;background:#5865F2;color:#fff;text-decoration:none;border-radius:6px;font-weight:600;">Join the Discord</a></p>`
    : `<p>Reply to this email and I'll send you the invite link directly.</p>`;

  const html = `
<!doctype html>
<html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#111;line-height:1.55;">
  <p>Hey ${fn},</p>
  ${ctaHtml}
  <p>We meet at <strong>9:30 AM Central every weekday</strong> — that's when the engine fires. Morning huddle, hot leads, scripts, role-plays, and live deal walks.</p>
  <p>See you there.</p>
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
  errors: Array<{ queue_id: string; agent_id: string; kind: string; error: string }>;
}

async function drainQueue(sb: ReturnType<typeof createClient>, settings: Settings): Promise<ProcessResult> {
  const result: ProcessResult = { processed: 0, sent: 0, failed: 0, skipped_no_email: 0, errors: [] };

  if (!settings.resend_api_key) {
    throw new Error("Missing RESEND_API_KEY (env or system_settings.resend_api_key).");
  }

  const { data: queueData, error: queueErr } = await sb
    .from("agent_onboarding_queue")
    .select("id, agent_id, email_kind, attempt_count")
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
    // Fetch agent + profile for each row (small N, simpler than batch join).
    const { data: agentRow } = await sb
      .from("agents")
      .select("id, user_id, agent_code")
      .eq("id", row.agent_id)
      .maybeSingle();

    if (!agentRow?.user_id) {
      await sb
        .from("agent_onboarding_queue")
        .update({
          attempt_count: row.attempt_count + 1,
          last_error: "agent or user_id missing",
        })
        .eq("id", row.id);
      result.failed += 1;
      result.errors.push({ queue_id: row.id, agent_id: row.agent_id, kind: row.email_kind, error: "agent missing user_id" });
      continue;
    }

    const { data: profile } = await sb
      .from("profiles")
      .select("email, full_name")
      .eq("user_id", agentRow.user_id)
      .maybeSingle();

    const email = (profile?.email ?? "").trim();
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

    const name = profile?.full_name ?? null;

    const built = row.email_kind === "course"
      ? buildCourseEmail(name ?? "", settings.training_course_url)
      : buildDiscordEmail(name ?? "", settings.discord_invite_url);

    // Discord email without an invite link is still useful (asks them to
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
          discord_invite_url_present: Boolean(settings.discord_invite_url),
          training_course_url: settings.training_course_url,
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
