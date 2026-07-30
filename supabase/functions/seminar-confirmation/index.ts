// PL-SEMINAR-FUNNEL: send the seminar Zoom invite + .ics calendar + Telegram
// bot deep-link confirmation email when an applicant submits the Apply form.
//
// Called fire-and-forget from submit-application after a successful insert,
// or directly with { application_id }. Idempotent — re-running for the same
// application_id overwrites seminar_zoom_link with the current live value
// but does NOT re-pick a new slot if one is already stamped (so reminder
// re-issues keep the original date the applicant got committed to).
//
// Voice rules: read /Users/samjames/business-ops/master-prompts/00-operating-contract.md.
// No em-dashes, no AI-tells, declarative APEX voice.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.90.1";
import { Resend } from "https://esm.sh/resend@2.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const resendApiKey = Deno.env.get("RESEND_API_KEY");

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
});

const resend = resendApiKey ? new Resend(resendApiKey) : null;

const uuidRegex =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sanitizeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatSlotForCt(iso: string): { dateLabel: string; timeLabel: string } {
  const d = new Date(iso);
  const dateLabel = d.toLocaleDateString("en-US", {
    timeZone: "America/Chicago",
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  const timeLabel = d.toLocaleTimeString("en-US", {
    timeZone: "America/Chicago",
    hour: "numeric",
    minute: "2-digit",
  });
  return { dateLabel, timeLabel };
}

function icsTs(iso: string): string {
  // RFC5545 UTC stamp: YYYYMMDDTHHMMSSZ
  return new Date(iso).toISOString().replace(/[-:]|\.\d{3}/g, "");
}

function buildIcs(opts: {
  uid: string;
  startIso: string;
  durationMinutes: number;
  summary: string;
  description: string;
  location: string;
  organizerName: string;
  organizerEmail: string;
  url: string;
}): string {
  const startUtc = new Date(opts.startIso);
  const endUtc = new Date(startUtc.getTime() + opts.durationMinutes * 60 * 1000);
  // Escape per RFC5545: backslash, comma, semicolon, newline
  const esc = (s: string) =>
    s
      .replace(/\\/g, "\\\\")
      .replace(/\n/g, "\\n")
      .replace(/,/g, "\\,")
      .replace(/;/g, "\\;");

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//APEX Financial//Seminar Funnel//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:REQUEST",
    "BEGIN:VEVENT",
    `UID:${opts.uid}`,
    `DTSTAMP:${icsTs(new Date().toISOString())}`,
    `DTSTART:${icsTs(startUtc.toISOString())}`,
    `DTEND:${icsTs(endUtc.toISOString())}`,
    `SUMMARY:${esc(opts.summary)}`,
    `DESCRIPTION:${esc(opts.description)}`,
    `LOCATION:${esc(opts.location)}`,
    `URL:${esc(opts.url)}`,
    `ORGANIZER;CN=${esc(opts.organizerName)}:MAILTO:${opts.organizerEmail}`,
    "STATUS:CONFIRMED",
    "TRANSP:OPAQUE",
    "END:VEVENT",
    "END:VCALENDAR",
  ];

  // RFC5545: lines >75 octets must be folded. Keep it simple by folding any
  // line longer than 75 ASCII chars at 73-char boundaries with CRLF + space.
  const folded = lines
    .map((l) => {
      if (l.length <= 75) return l;
      const out: string[] = [];
      let i = 0;
      while (i < l.length) {
        const chunk = i === 0 ? l.slice(0, 75) : " " + l.slice(i, i + 74);
        out.push(chunk);
        i += i === 0 ? 75 : 74;
      }
      return out.join("\r\n");
    })
    .join("\r\n");

  return folded + "\r\n";
}

function googleCalendarUrl(opts: {
  startIso: string;
  durationMinutes: number;
  title: string;
  details: string;
  location: string;
}): string {
  const start = new Date(opts.startIso);
  const end = new Date(start.getTime() + opts.durationMinutes * 60 * 1000);
  const fmt = (d: Date) => d.toISOString().replace(/[-:]|\.\d{3}/g, "");
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: opts.title,
    dates: `${fmt(start)}/${fmt(end)}`,
    details: opts.details,
    location: opts.location,
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

// ---------------------------------------------------------------------------
// Settings loader (one round-trip)
// ---------------------------------------------------------------------------

interface SeminarSettings {
  zoomUrl: string;
  zoomMeetingId: string;
  passcode: string;
  scheduleCron: string;
  hostName: string;
  fromEmail: string;
  telegramDmUrl: string | null;
  telegramBotUsername: string | null;
}

async function loadSettings(): Promise<SeminarSettings> {
  const keys = [
    "seminar_zoom_url",
    "seminar_zoom_meeting_id",
    "seminar_passcode",
    "seminar_schedule_cron",
    "seminar_host_name",
    "seminar_from_email",
    "telegram_bot_dm_url",
    "telegram_bot_username",
  ];
  const { data, error } = await supabase
    .from("system_settings")
    .select("key, value")
    .in("key", keys);
  if (error) {
    console.error("[seminar-confirmation] settings load failed:", error);
  }
  const map: Record<string, string> = {};
  (data ?? []).forEach((r: { key: string; value: string }) => {
    map[r.key] = r.value;
  });

  return {
    zoomUrl: map["seminar_zoom_url"] || "https://zoom.us/j/0000000000",
    zoomMeetingId: map["seminar_zoom_meeting_id"] || "0000000000",
    passcode: map["seminar_passcode"] || "apex2026",
    scheduleCron: map["seminar_schedule_cron"] || "Wed,Fri,Sun @ 19:00 America/Chicago",
    hostName: map["seminar_host_name"] || "Sam James's Apex team",
    fromEmail: map["seminar_from_email"] || "notifications@apex-financial.org",
    telegramDmUrl: map["telegram_bot_dm_url"] || null,
    telegramBotUsername: map["telegram_bot_username"] || null,
  };
}

// ---------------------------------------------------------------------------
// Failure receipt — every early-return failure path writes an email_delivery_log
// row BEFORE exiting. Without this the function could 404/422/500 and leave zero
// trace in the audit table: the same silent-failure class as the 465 InsuraCloud
// fake-success rows. Mirrors the column shape of the success-path insert at the
// bottom of the handler; sent_at stays null because no send was ever attempted.
// recipient_email is NOT NULL in the table, so unknown recipients get a labeled
// placeholder instead of a fabricated address.
// ---------------------------------------------------------------------------

async function logFailureReceipt(opts: {
  applicationId: string;
  recipientEmail: string | null;
  reason: string;
}): Promise<void> {
  try {
    await supabase.from("email_delivery_log").insert({
      template: "seminar-confirmation",
      recipient_email: opts.recipientEmail || "(unknown)",
      subject: null,
      provider: "resend",
      provider_message_id: null,
      status: "error",
      error: opts.reason,
      related_record_id: opts.applicationId,
      related_record_type: "application",
      sent_at: null,
    });
  } catch (e) {
    console.error("[seminar-confirmation] failure-receipt insert failed:", e);
  }
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "POST only" }), {
      status: 405,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }

  let body: { application_id?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid json" }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }

  const applicationId = (body.application_id || "").trim();
  if (!applicationId || !uuidRegex.test(applicationId)) {
    return new Response(JSON.stringify({ error: "application_id required (uuid)" }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }

  // 1) Load application
  const { data: app, error: appErr } = await supabase
    .from("applications")
    .select(
      "id, first_name, last_name, email, phone, license_status, seminar_slot_at, seminar_invited_at, seminar_ics_uid"
    )
    .eq("id", applicationId)
    .maybeSingle();

  if (appErr || !app) {
    console.error("[seminar-confirmation] application lookup failed:", appErr);
    await logFailureReceipt({
      applicationId,
      recipientEmail: null,
      reason: `application not found: ${appErr?.message ?? "no row for id"}`,
    });
    return new Response(JSON.stringify({ error: "application not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }

  if (!app.email) {
    await logFailureReceipt({
      applicationId,
      recipientEmail: null,
      reason: "application has no email address",
    });
    return new Response(JSON.stringify({ error: "application missing email" }), {
      status: 422,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }

  // 2) Pick (or re-use) the seminar slot
  let slotAt: string;
  if (app.seminar_slot_at) {
    slotAt = new Date(app.seminar_slot_at).toISOString();
  } else {
    const { data: slotRow, error: slotErr } = await supabase.rpc("fn_next_seminar_slot");
    if (slotErr || !slotRow) {
      console.error("[seminar-confirmation] fn_next_seminar_slot failed:", slotErr);
      await logFailureReceipt({
        applicationId,
        recipientEmail: app.email,
        reason: `fn_next_seminar_slot failed: ${slotErr?.message ?? "returned no slot"}`,
      });
      return new Response(JSON.stringify({ error: "could not pick seminar slot" }), {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }
    slotAt = new Date(slotRow as unknown as string).toISOString();
  }

  // 3) Load config
  const settings = await loadSettings();

  // 4) Build the .ics
  const icsUid =
    app.seminar_ics_uid || `apex-seminar-${applicationId}@apex-financial.org`;

  const { dateLabel, timeLabel } = formatSlotForCt(slotAt);
  const tgDeepLink =
    settings.telegramDmUrl
      ? `${settings.telegramDmUrl}?start=apply_${applicationId}`
      : settings.telegramBotUsername
      ? `https://t.me/${settings.telegramBotUsername}?start=apply_${applicationId}`
      : null;

  const eventTitle = "Apex Seminar — Welcome Zoom";
  const eventDescription = [
    "Welcome to Apex Financial. This is the live recruiting Zoom Sam James's team runs every Wed, Fri, and Sun at 7pm CT.",
    "",
    `Zoom link: ${settings.zoomUrl}`,
    `Meeting ID: ${settings.zoomMeetingId}`,
    `Passcode: ${settings.passcode}`,
    "",
    tgDeepLink
      ? `Open the Apex Telegram bot before the call: ${tgDeepLink}`
      : "Apex Telegram bot link arrives once the bot is fully provisioned.",
  ].join("\n");

  const icsBody = buildIcs({
    uid: icsUid,
    startIso: slotAt,
    durationMinutes: 60,
    summary: eventTitle,
    description: eventDescription,
    location: settings.zoomUrl,
    organizerName: settings.hostName,
    organizerEmail: settings.fromEmail,
    url: settings.zoomUrl,
  });

  const icsBase64 = btoa(icsBody);

  // 5) Send the email
  const firstName = (app.first_name || "there").trim();
  const safeFirst = sanitizeHtml(firstName);
  const subject = `You're in. Seminar Zoom is locked: ${dateLabel} ${timeLabel} CT`;

  const gcalUrl = googleCalendarUrl({
    startIso: slotAt,
    durationMinutes: 60,
    title: eventTitle,
    details: eventDescription,
    location: settings.zoomUrl,
  });

  const telegramLineHtml = tgDeepLink
    ? `
      <div style="background: #229ED9; padding: 18px 22px; border-radius: 10px; margin: 18px 0; text-align: center;">
        <p style="margin: 0 0 10px; color: white; font-weight: 600; font-size: 15px;">
          Open the Apex Telegram bot before the call
        </p>
        <a href="${tgDeepLink}" style="display: inline-block; background: white; color: #1683b3; padding: 12px 26px; border-radius: 8px; text-decoration: none; font-weight: 700; font-size: 15px;">
          Open Telegram bot
        </a>
        <p style="margin: 10px 0 0; color: rgba(255,255,255,0.85); font-size: 12px;">
          The bot links your file the moment you say hi.
        </p>
      </div>`
    : `
      <div style="background: #fef3c7; border-left: 4px solid #f59e0b; padding: 14px 18px; border-radius: 0 8px 8px 0; margin: 18px 0;">
        <p style="margin: 0; color: #92400e; font-size: 14px;">
          Telegram welcome link arrives once your bot is admin-added.
        </p>
      </div>`;

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #f9fafb;">
      <div style="background: linear-gradient(135deg, #059669, #047857); padding: 28px 24px; border-radius: 10px 10px 0 0; text-align: center;">
        <h1 style="color: white; margin: 0; font-size: 26px;">You're in.</h1>
        <p style="color: rgba(255,255,255,0.9); margin: 8px 0 0; font-size: 14px;">
          Hosted by ${sanitizeHtml(settings.hostName)}
        </p>
      </div>

      <div style="background: white; padding: 28px 24px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 10px 10px;">
        <p style="color: #111827; margin: 0 0 14px; font-size: 16px;">
          ${safeFirst}, the welcome seminar Zoom is locked.
        </p>
        <p style="color: #374151; margin: 0 0 18px; line-height: 1.55;">
          This is the room where you meet the team, hear the playbook, and decide if Apex is the right fit. Show up on time. Show up ready.
        </p>

        <div style="background: #ecfdf5; border: 2px solid #10b981; border-radius: 10px; padding: 18px 20px; margin: 18px 0; text-align: center;">
          <p style="margin: 0; color: #047857; font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">
            Your seminar slot
          </p>
          <p style="margin: 8px 0 0; color: #065f46; font-size: 20px; font-weight: 700;">
            ${sanitizeHtml(dateLabel)} ${sanitizeHtml(timeLabel)} CT
          </p>
          <p style="margin: 6px 0 0; color: #047857; font-size: 12px;">
            Cadence: ${sanitizeHtml(settings.scheduleCron)}
          </p>
        </div>

        <div style="background: #f3f4f6; border-radius: 10px; padding: 18px 20px; margin: 18px 0;">
          <p style="margin: 0 0 10px; color: #111827; font-weight: 600;">Zoom details</p>
          <p style="margin: 0 0 6px; color: #374151; font-size: 14px;">
            <a href="${settings.zoomUrl}" style="color: #2563eb; font-weight: 600; text-decoration: none;">${sanitizeHtml(settings.zoomUrl)}</a>
          </p>
          <p style="margin: 0 0 4px; color: #6b7280; font-size: 13px;">Meeting ID: <strong>${sanitizeHtml(settings.zoomMeetingId)}</strong></p>
          <p style="margin: 0; color: #6b7280; font-size: 13px;">Passcode: <strong>${sanitizeHtml(settings.passcode)}</strong></p>
        </div>

        <div style="text-align: center; margin: 22px 0;">
          <a href="${settings.zoomUrl}" style="display: inline-block; background: linear-gradient(135deg, #059669, #047857); color: white; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: 700; font-size: 16px;">
            Join the Zoom
          </a>
          <p style="margin: 12px 0 0; color: #6b7280; font-size: 12px;">
            <a href="${gcalUrl}" style="color: #059669; text-decoration: underline;">Add to Google Calendar</a>
            &nbsp;·&nbsp;
            The .ics file attached drops it into Apple Calendar, Outlook, or anything else.
          </p>
        </div>

        ${telegramLineHtml}

        <p style="color: #374151; margin: 22px 0 0; line-height: 1.55;">
          Check your spam folder if this is the first email you got from us. Mark Apex as not spam so the rest of the onboarding chain lands in your inbox.
        </p>

        <p style="color: #111827; margin: 24px 0 0;">
          See you on the call.<br/>
          <strong style="color: #059669;">${sanitizeHtml(settings.hostName)}</strong>
        </p>
      </div>

      <div style="text-align: center; padding: 16px; color: #9ca3af; font-size: 11px;">
        Apex Financial · apex-financial.org · Hold the Standard. Average is the disease.
      </div>
    </div>
  `;

  let providerMessageId: string | null = null;
  let sendError: string | null = null;

  if (resend) {
    try {
      const fromAddr = settings.fromEmail.includes("@apex-financial.org")
        ? `APEX Seminar <${settings.fromEmail}>`
        : "APEX Seminar <notifications@apex-financial.org>";
      const sendResp = await resend.emails.send({
        from: fromAddr,
        to: [app.email],
        subject,
        html,
        attachments: [
          {
            filename: "apex-seminar.ics",
            content: icsBase64,
            content_type: "text/calendar; charset=utf-8; method=REQUEST",
          },
        ],
      });
      const respAny = sendResp as { data?: { id?: string }; error?: { message?: string } };
      providerMessageId = respAny.data?.id ?? null;
      sendError = respAny.error?.message ?? null;
      if (sendError) {
        console.error("[seminar-confirmation] resend error:", sendError);
      } else {
        console.log("[seminar-confirmation] resend message id:", providerMessageId);
      }
    } catch (err) {
      console.error("[seminar-confirmation] resend throw:", err);
      sendError = (err as Error).message;
    }
  } else {
    sendError = "RESEND_API_KEY not configured";
    console.warn("[seminar-confirmation] resend client missing — skipping send");
  }

  // 6) Stamp the application row (truth lives on the DB, not the email queue)
  try {
    await supabase
      .from("applications")
      .update({
        seminar_invited_at: new Date().toISOString(),
        seminar_slot_at: slotAt,
        seminar_zoom_link: settings.zoomUrl,
        seminar_ics_uid: icsUid,
      })
      .eq("id", applicationId);
  } catch (e) {
    console.error("[seminar-confirmation] applications update failed:", e);
  }

  // 7) Insert seminar_registrations row (idempotent on email + date)
  try {
    const slotDate = slotAt.slice(0, 10); // YYYY-MM-DD UTC; seminar_date column is `date`
    const { data: existingReg } = await supabase
      .from("seminar_registrations")
      .select("id")
      .eq("email", app.email.toLowerCase())
      .eq("seminar_date", slotDate)
      .maybeSingle();
    if (!existingReg) {
      await supabase.from("seminar_registrations").insert({
        first_name: app.first_name,
        last_name: app.last_name,
        email: app.email.toLowerCase(),
        phone: app.phone,
        license_status: (app.license_status as string) || "unlicensed",
        source: "submit_application",
        seminar_date: slotDate,
        application_id: applicationId,
      });
    }
  } catch (e) {
    console.error("[seminar-confirmation] seminar_registrations insert failed:", e);
  }

  // 8) Log the email outcome (audit trail)
  try {
    await supabase.from("email_delivery_log").insert({
      template: "seminar-confirmation",
      recipient_email: app.email,
      subject,
      provider: "resend",
      provider_message_id: providerMessageId,
      status: sendError ? "error" : "sent",
      error: sendError,
      related_record_id: applicationId,
      related_record_type: "application",
      sent_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error("[seminar-confirmation] email_delivery_log insert failed:", e);
  }

  return new Response(
    JSON.stringify({
      ok: !sendError,
      slot_at: slotAt,
      zoom_url: settings.zoomUrl,
      telegram_dm_url: tgDeepLink,
      provider_message_id: providerMessageId,
      error: sendError,
    }),
    {
      status: sendError ? 502 : 200,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    }
  );
};

serve(handler);
