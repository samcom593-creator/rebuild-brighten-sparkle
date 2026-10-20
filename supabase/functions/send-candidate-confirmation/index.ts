// send-candidate-confirmation
//
// Sends a confirmation email to a recruiting candidate after Sam adds an
// interview in /dashboard/interviews. Email tells them "I'm actually
// going there". A reschedule link is included only when one is configured and
// is an absolute https URL; otherwise the email says to reply (see
// email.ts for why there is no fallback).
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
import { requireSendAuth } from "../_shared/require-send-auth.ts";
import {
  buildConfirmationEmail,
  resolveRescheduleUrl,
  stripWrappedQuotes,
} from "./email.ts";

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
  reschedule_url: string | null;
  from_address: string;
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
  // No hardcoded fallback: the old one was the deleted Calendly event, so an
  // empty setting re-emitted the same dead link.
  const reschedule = resolveRescheduleUrl(map.get("seminar_calendly_url"));
  const fromRaw = stripWrappedQuotes(map.get("onboarding_email_from_address"))
    || "Sam James <sam@apex-financial.org>";

  return {
    resend_api_key: envResend && envResend.length > 8
      ? envResend
      : (map.get("resend_api_key") ?? null),
    reschedule_url: reschedule,
    from_address: fromRaw,
  };
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

  // The only caller is assistant-add-interview, which presents the service key
  // (PL-WIB-CANDIDATE-CONFIRM-RELAY, 2026-10-14). No src page invokes this any
  // more (/dashboard/interviews redirects to the calendar), and no cron row or
  // pg_proc body does. Before this gate verify_jwt = false let a bare POST pick
  // candidate_email, candidate_name AND calendly_url, so anyone could send a
  // "Confirmed, reschedule here" email from Apex's sender with a link of their
  // choosing. interview_id is only written AFTER the send, so it never gated it.
  // Service key or a signed-in admin/manager only.
  const sendAuth = await requireSendAuth(req);
  if (!sendAuth.ok) {
    return new Response(
      JSON.stringify({ ok: false, error: sendAuth.error }),
      { status: sendAuth.status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
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

    const rescheduleUrl = resolveRescheduleUrl(body.calendly_url) ?? settings.reschedule_url;

    const built = buildConfirmationEmail(candidateName, scheduledAt, rescheduleUrl);

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
        reschedule_url: rescheduleUrl,
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
