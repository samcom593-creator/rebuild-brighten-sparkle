// outreach-sender edge function
// Drains pending email rows from outreach_queue and sends via Resend.
//
// Guards baked in (from APEX memory + 465-row InsuraCloud fake-success lesson):
//   - Resend HTML-body fake-success detection (response body starts with <html or <!doctype)
//   - Suppression: skip if do_not_contact = true
//   - Idempotency: skip if idempotency_key already sent
//   - Rate limit: ~1/sec to respect Resend
//   - Attempt cap: < 3
//
// POST body (optional): { batch_size?: number }   default 25, max 200
// Returns: { batch_size, sent, failed, skipped_suppressed, skipped_idempotent, took_ms }

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-request-id, idempotency-key",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

const DEFAULT_FROM = "APEX Financial <notifications@apex-financial.org>";
const DEFAULT_SUBJECT = "A quick note from APEX Financial";
const DEFAULT_BATCH = 25;
const MAX_BATCH = 200;
const RESEND_SEND_URL = "https://api.resend.com/emails";

type QueueRow = {
  id: string;
  lead_id: string | null;
  application_id: string | null;
  agent_id: string | null;
  channel: string;
  template_key: string;
  scheduled_for: string;
  status: string;
  source_run: string;
  error_message: string | null;
  sent_at: string | null;
  created_at: string;
  attempt_count: number;
  last_error: string | null;
  idempotency_key: string | null;
  do_not_contact: boolean;
  subject: string | null;
  html_body: string | null;
  to_email: string | null;
  from_email: string | null;
  provider_message_id: string | null;
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function looksLikeHtmlMasquerade(text: string): boolean {
  if (!text) return false;
  const head = text.trim().slice(0, 256).toLowerCase();
  return head.includes("<html") || head.includes("<!doctype");
}

async function resolveRecipient(
  supabase: any,
  row: QueueRow,
): Promise<{ email: string | null; firstName: string | null; dnc: boolean; reason?: string }> {
  // 1) Honor any explicit to_email already on the queue row.
  if (row.to_email && row.to_email.includes("@")) {
    return { email: row.to_email, firstName: null, dnc: row.do_not_contact };
  }

  // 2) aged_leads (lead_id) — has do_not_contact column.
  if (row.lead_id) {
    const { data, error } = await supabase
      .from("aged_leads")
      .select("email, first_name, do_not_contact")
      .eq("id", row.lead_id)
      .maybeSingle();
    if (error) {
      return { email: null, firstName: null, dnc: false, reason: `aged_leads lookup error: ${error.message}` };
    }
    if (data) {
      return {
        email: data.email ?? null,
        firstName: data.first_name ?? null,
        dnc: Boolean(data.do_not_contact) || row.do_not_contact,
      };
    }
  }

  // 3) applications (application_id).
  if (row.application_id) {
    const { data, error } = await supabase
      .from("applications")
      .select("email, first_name")
      .eq("id", row.application_id)
      .maybeSingle();
    if (error) {
      return { email: null, firstName: null, dnc: false, reason: `applications lookup error: ${error.message}` };
    }
    if (data) {
      return {
        email: data.email ?? null,
        firstName: data.first_name ?? null,
        dnc: row.do_not_contact,
      };
    }
  }

  return { email: null, firstName: null, dnc: row.do_not_contact, reason: "no recipient resolvable" };
}

function defaultHtml(firstName: string | null, templateKey: string): string {
  const greeting = firstName ? `Hey ${firstName}` : "Hey there";
  return `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;color:#0a0a0a;">
<p>${greeting},</p>
<p>This is APEX Financial. We're following up on your interest. Let's connect.</p>
<p><a href="https://calendly.com/apexfinancialempire/licensed-prospect-call-clone">Schedule a call</a></p>
<p>(template: ${templateKey})</p>
</body></html>`;
}

async function sendOne(
  supabase: any,
  resendApiKey: string,
  row: QueueRow,
): Promise<{ outcome: "sent" | "failed" | "skipped_suppressed" | "skipped_idempotent"; error?: string; providerId?: string }> {
  // Idempotency: have we already sent something with this key?
  if (row.idempotency_key) {
    const { data: dup, error: dupErr } = await supabase
      .from("outreach_queue")
      .select("id, sent_at")
      .eq("idempotency_key", row.idempotency_key)
      .not("sent_at", "is", null)
      .neq("id", row.id)
      .limit(1);
    if (!dupErr && dup && dup.length > 0) {
      await supabase
        .from("outreach_queue")
        .update({
          status: "skipped_idempotent",
          last_error: "duplicate idempotency_key already sent",
          attempt_count: row.attempt_count + 1,
        })
        .eq("id", row.id);
      return { outcome: "skipped_idempotent" };
    }
  }

  // Resolve recipient + suppression.
  const recipient = await resolveRecipient(supabase, row);
  if (recipient.dnc) {
    await supabase
      .from("outreach_queue")
      .update({
        status: "skipped_suppressed",
        last_error: "do_not_contact=true",
        attempt_count: row.attempt_count + 1,
      })
      .eq("id", row.id);
    return { outcome: "skipped_suppressed" };
  }

  // MP-232 Cohort guard: prospect-cohort sends must only fire when the
  // applicant is still unlicensed. If they became licensed between enqueue
  // and drain, they belong in the HIRED chain (agent_onboarding_queue), not here.
  if (
    (row.source_run === "prospect_whatsapp" || row.source_run === "calendly-invite") &&
    row.application_id
  ) {
    const { data: appRow } = await supabase
      .from("applications")
      .select("license_status")
      .eq("id", row.application_id)
      .maybeSingle();
    const licStr = (appRow?.license_status ?? "").toString().toLowerCase();
    const isProspect = licStr === "" || licStr === "null" || licStr === "unlicensed";
    if (!isProspect) {
      await supabase
        .from("outreach_queue")
        .update({
          status: "skipped_wrong_cohort",
          last_error: `skipped_wrong_cohort: license_status=${licStr || "null"} but source_run=${row.source_run} requires NULL or unlicensed`,
          attempt_count: row.attempt_count + 1,
        })
        .eq("id", row.id);
      return { outcome: "skipped_suppressed" };
    }
  }

  if (!recipient.email) {
    const err = recipient.reason ?? "no recipient email";
    await supabase
      .from("outreach_queue")
      .update({
        status: "failed",
        last_error: err,
        attempt_count: row.attempt_count + 1,
        error_message: err,
      })
      .eq("id", row.id);
    return { outcome: "failed", error: err };
  }

  const subject = row.subject ?? DEFAULT_SUBJECT;
  const html = row.html_body ?? defaultHtml(recipient.firstName, row.template_key);
  const from = row.from_email ?? DEFAULT_FROM;

  let resp: Response;
  let bodyText = "";
  try {
    resp = await fetch(RESEND_SEND_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
        ...(row.idempotency_key ? { "Idempotency-Key": row.idempotency_key } : {}),
      },
      body: JSON.stringify({
        from,
        to: [recipient.email],
        subject,
        html,
      }),
    });
    bodyText = await resp.text();
  } catch (e: any) {
    const err = `network error: ${e?.message ?? e}`;
    await supabase
      .from("outreach_queue")
      .update({
        status: "failed",
        last_error: err,
        attempt_count: row.attempt_count + 1,
        error_message: err,
      })
      .eq("id", row.id);
    return { outcome: "failed", error: err };
  }

  // FAKE-SUCCESS GUARD (from memory: 465 InsuraCloud rows + AgentLink incident).
  // If the body looks like an HTML page (Cloudflare challenge / login redirect / WAF block),
  // we MUST NOT treat 2xx as a real send.
  if (looksLikeHtmlMasquerade(bodyText)) {
    const err = "resend_html_body_fake_success";
    await supabase
      .from("outreach_queue")
      .update({
        status: "failed",
        last_error: err,
        attempt_count: row.attempt_count + 1,
        error_message: err,
      })
      .eq("id", row.id);
    return { outcome: "failed", error: err };
  }

  if (!resp.ok) {
    const err = `resend ${resp.status}: ${bodyText.slice(0, 500)}`;
    await supabase
      .from("outreach_queue")
      .update({
        status: "failed",
        last_error: err,
        attempt_count: row.attempt_count + 1,
        error_message: err,
      })
      .eq("id", row.id);
    return { outcome: "failed", error: err };
  }

  // Parse JSON and require an id.
  let parsed: any = null;
  try {
    parsed = JSON.parse(bodyText);
  } catch (_e) {
    const err = `resend non-json 2xx: ${bodyText.slice(0, 300)}`;
    await supabase
      .from("outreach_queue")
      .update({
        status: "failed",
        last_error: err,
        attempt_count: row.attempt_count + 1,
        error_message: err,
      })
      .eq("id", row.id);
    return { outcome: "failed", error: err };
  }

  if (!parsed || typeof parsed.id !== "string" || parsed.id.length < 6) {
    const err = `resend 2xx without id: ${bodyText.slice(0, 300)}`;
    await supabase
      .from("outreach_queue")
      .update({
        status: "failed",
        last_error: err,
        attempt_count: row.attempt_count + 1,
        error_message: err,
      })
      .eq("id", row.id);
    return { outcome: "failed", error: err };
  }

  // Real success.
  await supabase
    .from("outreach_queue")
    .update({
      status: "sent",
      sent_at: new Date().toISOString(),
      attempt_count: row.attempt_count + 1,
      provider_message_id: parsed.id,
      to_email: recipient.email,
      from_email: from,
      subject,
      last_error: null,
      error_message: null,
    })
    .eq("id", row.id);

  return { outcome: "sent", providerId: parsed.id };
}

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startedAt = Date.now();

  try {
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    if (!resendApiKey) {
      return new Response(
        JSON.stringify({ error: "RESEND_API_KEY not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    let batchSize = DEFAULT_BATCH;
    if (req.method === "POST") {
      try {
        const body = await req.json();
        if (body && typeof body.batch_size === "number" && body.batch_size > 0) {
          batchSize = Math.min(MAX_BATCH, Math.floor(body.batch_size));
        }
      } catch (_e) {
        // ignore — body is optional
      }
    }

    const { data: rows, error: fetchErr } = await supabase
      .from("outreach_queue")
      .select(
        "id, lead_id, application_id, agent_id, channel, template_key, scheduled_for, status, source_run, error_message, sent_at, created_at, attempt_count, last_error, idempotency_key, do_not_contact, subject, html_body, to_email, from_email, provider_message_id",
      )
      .eq("channel", "email")
      .is("sent_at", null)
      .lt("attempt_count", 3)
      .order("created_at", { ascending: true })
      .limit(batchSize);

    if (fetchErr) {
      return new Response(
        JSON.stringify({ error: `outreach_queue fetch failed: ${fetchErr.message}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let sent = 0;
    let failed = 0;
    let skippedSuppressed = 0;
    let skippedIdempotent = 0;

    const queue = (rows ?? []) as QueueRow[];

    for (let i = 0; i < queue.length; i++) {
      const row = queue[i];
      const result = await sendOne(supabase, resendApiKey, row);
      if (result.outcome === "sent") sent++;
      else if (result.outcome === "failed") failed++;
      else if (result.outcome === "skipped_suppressed") skippedSuppressed++;
      else if (result.outcome === "skipped_idempotent") skippedIdempotent++;

      // ~1/sec rate limit to respect Resend (skip the wait after the last row).
      if (i < queue.length - 1) {
        await sleep(1000);
      }
    }

    return new Response(
      JSON.stringify({
        batch_size: queue.length,
        sent,
        failed,
        skipped_suppressed: skippedSuppressed,
        skipped_idempotent: skippedIdempotent,
        took_ms: Date.now() - startedAt,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e: any) {
    return new Response(
      JSON.stringify({ error: e?.message ?? String(e), took_ms: Date.now() - startedAt }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
