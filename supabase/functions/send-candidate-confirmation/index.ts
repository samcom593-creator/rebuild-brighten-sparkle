// send-candidate-confirmation
//
// Sends a confirmation email to a recruiting candidate after Sam adds an
// interview in /dashboard/interviews. Email tells them "I'm actually
// going there" and includes the Calendly link as a backup reschedule URL.
//
// Sam directive (voice transcript 2026-06-15):
//   "Make sure again I wanna re-click and add these [interviews], and
//   then I send them [the candidate] a link to show I'm actually going
//   there as well."
//
// Per APEX Operating Contract: NO fake success. A Resend 200 with
// non-JSON body or missing `data.id` is treated as FAILURE — we DO NOT
// flip confirmation_sent_at on a bad response.

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

interface RequestBody {
  interview_id?: string;
  candidate_email?: string;
  candidate_name?: string;
  scheduled_at?: string;
  calendly_url?: string;
}

interface Settings {
  resend_api_key: string | null;
  seminar_calendly_url: string;
  from_address: string;
}

function stripWrappedQuotes(raw: string | null | undefined): string {
  if (!raw) return "";
  const trimmed = raw.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

async function loadSettings(sb: ReturnType<typeof createClient>): Promise<Settings> {
  const { data } = await sb
    .from("system_settings")
    .select("key,value")
    .in("key", [
      "resend_api_key",
      "seminar_calendly_url",
      "onboarding_email_from_address",
    ]);

  const map = new Map<string, string | null>();
  for (const row of (data ?? []) as Array<{ key: string; value: string | null }>) {
    map.set(row.key, row.value);
  }

  const envResend = Deno.env.get("RESEND_API_KEY");
  const calendly = stripWrappedQuotes(map.get("seminar_calendly_url"))
    || "https://calendly.com/apexfinancialempire/interview";
  const fromRaw = stripWrappedQuotes(map.get("onboarding_email_from_address"))
    || "Sam James <sam@apex-financial.org>";

  return {
    resend_api_key: envResend && envResend.length > 8
      ? envResend
      : (map.get("resend_api_key") ?? null),
    seminar_calendly_url: calendly,
    from_address: fromRaw,
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

function formatScheduled(scheduledAt: string): { day: string; time: string; full: string } {
  // Format in US/Central since Sam runs on CT.
  // We do it manually because Deno doesn't ship Intl polyfills for arbitrary TZs
  // without options. Intl.DateTimeFormat with timeZone is supported.
  const d = new Date(scheduledAt);
  if (Number.isNaN(d.getTime())) {
    return { day: scheduledAt, time: "", full: scheduledAt };
  }
  const dayFmt = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "America/Chicago",
  });
  const timeFmt = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Chicago",
    timeZoneName: "short",
  });
  const day = dayFmt.format(d);
  const time = timeFmt.format(d);
  return { day, time, full: `${day} at ${time}` };
}

function buildConfirmationEmail(
  candidateName: string,
  scheduledAt: string,
  calendlyUrl: string,
): { subject: string; html: string; text: string } {
  const fn = firstName(candidateName);
  const fnHtml = escapeHtml(fn);
  const { day, time, full } = formatScheduled(scheduledAt);
  const fullHtml = escapeHtml(full);
  const dayHtml = escapeHtml(day);
  const timeHtml = escapeHtml(time);
  const urlHtml = escapeHtml(calendlyUrl);

  const subject = `Confirmed — our call on ${day} ${time} CT`;

  const text = [
    `Hey ${fn},`,
    ``,
    `Confirmed for ${full}. I'll be there. Bring questions.`,
    ``,
    `If anything changes, you can reschedule here: ${calendlyUrl}`,
    ``,
    `— Sam`,
    `APEX Financial`,
  ].join("\n");

  const html = `
<!doctype html>
<html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#111;line-height:1.55;">
  <p>Hey ${fnHtml},</p>
  <p>Confirmed for <strong>${dayHtml} at ${timeHtml}</strong>. I'll be there. Bring questions.</p>
  <p>If anything changes, you can reschedule here:</p>
  <p><a href="${urlHtml}" style="display:inline-block;padding:12px 20px;background:#0a0a0a;color:#fff;text-decoration:none;border-radius:6px;font-weight:600;">Reschedule on Calendly</a></p>
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
        reply_to: "info@kingofsales.net",
      }),
    });
  } catch (err) {
    return { ok: false, id: null, error: `fetch failed: ${String(err)}` };
  }

  const bodyText = await res.text();

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

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ ok: false, error: "POST only" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  let body: RequestBody;
  try {
    body = await req.json() as RequestBody;
  } catch {
    return new Response(
      JSON.stringify({ ok: false, error: "Invalid JSON body" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const interviewId = (body.interview_id ?? "").trim();
  const candidateEmail = (body.candidate_email ?? "").trim();
  const candidateName = (body.candidate_name ?? "").trim();
  const scheduledAt = (body.scheduled_at ?? "").trim();

  if (!interviewId) {
    return new Response(
      JSON.stringify({ ok: false, error: "interview_id required" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
  if (!candidateEmail) {
    return new Response(
      JSON.stringify({ ok: false, error: "candidate_email required" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
  if (!scheduledAt) {
    return new Response(
      JSON.stringify({ ok: false, error: "scheduled_at required" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  try {
    const sb = createClient(SUPABASE_URL, SERVICE_ROLE);
    const settings = await loadSettings(sb);

    if (!settings.resend_api_key) {
      throw new Error("Missing RESEND_API_KEY (env or system_settings.resend_api_key).");
    }

    const calendlyUrl = (body.calendly_url ?? "").trim() || settings.seminar_calendly_url;

    const built = buildConfirmationEmail(candidateName, scheduledAt, calendlyUrl);

    const sendResult = await sendViaResend(
      settings.resend_api_key,
      settings.from_address,
      candidateEmail,
      built.subject,
      built.html,
      built.text,
    );

    if (!sendResult.ok) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: sendResult.error,
          timestamp: new Date().toISOString(),
        }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Only mark confirmation_sent_at after a verified Resend data.id.
    const { error: updateErr } = await sb
      .from("manual_interview_entries")
      .update({
        confirmation_sent_at: new Date().toISOString(),
        resend_message_id: sendResult.id,
      })
      .eq("id", interviewId);

    if (updateErr) {
      // The email DID send (Resend gave us an id) but the DB write failed.
      // Surface this so Sam knows the email went out — do not silently fail.
      return new Response(
        JSON.stringify({
          ok: true,
          sent: true,
          resend_id: sendResult.id,
          warning: `Email sent but DB update failed: ${updateErr.message}`,
          timestamp: new Date().toISOString(),
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({
        ok: true,
        sent: true,
        resend_id: sendResult.id,
        from: settings.from_address,
        to: candidateEmail,
        calendly_url: calendlyUrl,
        timestamp: new Date().toISOString(),
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
