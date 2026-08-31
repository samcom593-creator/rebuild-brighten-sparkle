// onboarding-call-invites — Lane 3 (2026-08-26)
//
// Drains public.onboarding_call_invites: for every onboarding-call booking in
// interview_events (call_track = 'onboarding'), the onboarding team (Milver —
// named by Sam 2026-08-26, list lives in system_settings
// 'onboarding_call_invite_recipients') receives a real calendar invite by email:
// an .ics with METHOD:REQUEST (or METHOD:CANCEL when the booking is canceled),
// the hire's name, the call location, Phoenix + Central time, organizer Sam.
//
// WHY EMAIL + .ICS AND NOT A CALENDLY CO-HOST
//   The Calendly organization has exactly one member (Sam, owner — measured via
//   /organization_memberships). A co-host must be an org member, and an org seat
//   is a purchase. Hard limit: not bought. The invite path works regardless of
//   Calendly's plan and is idempotent per (booking, recipient, kind).
//
// Per the APEX Operating Contract: NO fake success. A Resend 200 with a non-JSON
// body or no `id` is a FAILURE — the row keeps status='queued', attempt_count
// increments, and the error is recorded. Only a Resend message id marks 'sent'.
//
// Cron: pg_cron 'apex-onboarding-call-invites-5min' (see migration
// 20260826052000_onboarding_calls_live.sql). verify_jwt is false because cron
// presents the private APEX bot token rather than a user JWT; the handler still
// authenticates every POST. Diagnostics require the service-role bearer.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.90.1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const APEX_BOT_TOKEN = (Deno.env.get("APEX_BOT_TOKEN") ?? "").trim();
const CALENDLY_TOKEN = (Deno.env.get("CALENDLY_API_TOKEN") ?? "").trim();

const ORGANIZER_NAME = "Sam James";
const ORGANIZER_EMAIL = "info@kingofsales.net";
const PHOENIX = "America/Phoenix";
const CENTRAL = "America/Chicago";
const MAX_ATTEMPTS = 5;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

interface InviteRow {
  id: string;
  booking_id: string;
  recipient: string;
  kind: "request" | "cancel";
  ics_uid: string;
  sequence: number;
  status: string;
  attempt_count: number;
}

interface BookingRow {
  id: string;
  invitee_name: string | null;
  invitee_email: string | null;
  invitee_phone: string | null;
  scheduled_at: string;
  ended_at: string | null;
  canceled_at: string | null;
  cancel_reason: string | null;
  reschedule_url: string | null;
  cancel_url: string | null;
  prep_notes: string | null;
  agent_id: string | null;
  event_type_name: string | null;
  raw_payload: { payload?: { scheduled_event?: { location?: { join_url?: string; location?: string; type?: string } } } } | null;
}

async function resendApiKey(): Promise<string | null> {
  const env = (Deno.env.get("RESEND_API_KEY") ?? "").trim();
  if (env.length > 8) return env;
  const { data } = await sb.from("system_settings").select("value").eq("key", "resend_api_key").maybeSingle();
  const v = ((data as { value?: string } | null)?.value ?? "").trim();
  return v.length > 8 ? v : null;
}

async function fromAddress(): Promise<string> {
  const { data } = await sb.from("system_settings").select("value").eq("key", "onboarding_email_from_address").maybeSingle();
  const v = ((data as { value?: string } | null)?.value ?? "").trim();
  return v || `${ORGANIZER_NAME} <${ORGANIZER_EMAIL}>`;
}

// ---------- formatting ----------

function fmtIn(tz: string, iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz, weekday: "short", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit", timeZoneName: "short",
  }).format(new Date(iso));
}

function icsTs(iso: string): string {
  // 2026-08-26T18:30:00.000Z -> 20260826T183000Z
  return new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function icsEsc(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}

/** RFC 5545 §3.1: content lines longer than 75 octets are folded with CRLF + space. */
function foldIcs(lines: string[]): string {
  const enc = new TextEncoder();
  const out: string[] = [];
  for (const line of lines) {
    if (enc.encode(line).length <= 75) { out.push(line); continue; }
    let cur = "";
    let first = true;
    for (const ch of line) {
      const next = cur + ch;
      const limit = first ? 75 : 74;
      if (enc.encode(next).length > limit) {
        out.push(first ? cur : " " + cur);
        cur = ch;
        first = false;
      } else {
        cur = next;
      }
    }
    out.push(first ? cur : " " + cur);
  }
  return out.join("\r\n") + "\r\n";
}

/** btoa() throws on any code point above 0xFF (MP-274's lesson one encoder over). */
function base64Utf8(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function locationOf(b: BookingRow): string {
  const loc = b.raw_payload?.payload?.scheduled_event?.location;
  if (loc?.join_url) return loc.join_url;
  if (loc?.location) return loc.location;
  if (b.invitee_phone) return `Outbound call to ${b.invitee_phone}`;
  return "Outbound call (Sam calls the hire)";
}

// ---------- ics ----------

function buildIcs(row: InviteRow, b: BookingRow, name: string): { ics: string; summary: string } {
  const startIso = b.scheduled_at;
  const endIso = b.ended_at ?? new Date(new Date(startIso).getTime() + 30 * 60_000).toISOString();
  const summary = `APEX Onboarding Call · ${name}`;
  const location = locationOf(b);
  const description = [
    `APEX onboarding call for ${name}.`,
    `When: ${fmtIn(PHOENIX, startIso)} (${fmtIn(CENTRAL, startIso)})`,
    `Location: ${location}`,
    b.invitee_email ? `Hire email: ${b.invitee_email}` : null,
    b.invitee_phone ? `Hire phone: ${b.invitee_phone}` : null,
    b.prep_notes ? `Prep notes: ${b.prep_notes}` : null,
    b.reschedule_url ? `Reschedule: ${b.reschedule_url}` : null,
    b.cancel_url ? `Cancel: ${b.cancel_url}` : null,
    `Booked via Calendly (${b.event_type_name ?? "APEX Onboarding Call"}). Booking id ${b.id}.`,
  ].filter(Boolean).join("\n");

  const cancel = row.kind === "cancel";
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//APEX Financial//Onboarding Calls//EN",
    "CALSCALE:GREGORIAN",
    `METHOD:${cancel ? "CANCEL" : "REQUEST"}`,
    "BEGIN:VEVENT",
    `UID:${row.ics_uid}`,
    `SEQUENCE:${row.sequence}`,
    `DTSTAMP:${icsTs(new Date().toISOString())}`,
    `DTSTART:${icsTs(startIso)}`,
    `DTEND:${icsTs(endIso)}`,
    `SUMMARY:${icsEsc(cancel ? `CANCELED: ${summary}` : summary)}`,
    `DESCRIPTION:${icsEsc(description)}`,
    `LOCATION:${icsEsc(location)}`,
    `ORGANIZER;CN=${icsEsc(ORGANIZER_NAME)}:MAILTO:${ORGANIZER_EMAIL}`,
    `ATTENDEE;CN=${icsEsc(row.recipient)};ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:MAILTO:${row.recipient}`,
    `STATUS:${cancel ? "CANCELLED" : "CONFIRMED"}`,
    "TRANSP:OPAQUE",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return { ics: foldIcs(lines), summary };
}

function buildEmail(row: InviteRow, b: BookingRow, name: string, summary: string) {
  const cancel = row.kind === "cancel";
  const when = `${fmtIn(PHOENIX, b.scheduled_at)}  ·  ${fmtIn(CENTRAL, b.scheduled_at)}`;
  const location = locationOf(b);
  const subject = cancel
    ? `Canceled: onboarding call with ${name} · ${fmtIn(PHOENIX, b.scheduled_at)}`
    : `Onboarding call with ${name} · ${fmtIn(PHOENIX, b.scheduled_at)}`;
  const text = [
    cancel ? `The onboarding call below was canceled${b.cancel_reason ? ` (${b.cancel_reason})` : ""}.` : `A new APEX onboarding call is on the calendar. The attached invite adds it to yours.`,
    ``,
    `Who:      ${name}`,
    `When:     ${when}`,
    `Where:    ${location}`,
    b.invitee_email ? `Email:    ${b.invitee_email}` : null,
    b.invitee_phone ? `Phone:    ${b.invitee_phone}` : null,
    b.prep_notes ? `Prep:     ${b.prep_notes}` : null,
    b.reschedule_url ? `Reschedule: ${b.reschedule_url}` : null,
    ``,
    `Organizer: ${ORGANIZER_NAME} · booking ${b.id}`,
  ].filter((l) => l !== null).join("\n");

  const rows = [
    ["Who", name],
    ["When", when],
    ["Where", location],
    b.invitee_email ? ["Email", b.invitee_email] : null,
    b.invitee_phone ? ["Phone", b.invitee_phone] : null,
    b.prep_notes ? ["Prep", b.prep_notes] : null,
  ].filter(Boolean) as string[][];
  const html = `<!doctype html>
<html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#111;line-height:1.55;">
  <p style="margin:0 0 4px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#8a6d0b;">APEX Financial · Onboarding</p>
  <h2 style="margin:0 0 12px;font-size:18px;">${escapeHtml(cancel ? `Canceled: ${summary}` : summary)}</h2>
  <p>${cancel ? `This call was canceled${b.cancel_reason ? ` (${escapeHtml(b.cancel_reason)})` : ""}. The attached update removes it from your calendar.` : `A new onboarding call is on the calendar. Accept the attached invite to add it to yours.`}</p>
  <table style="border-collapse:collapse;width:100%;margin:12px 0;">
    ${rows.map(([k, v]) => `<tr><td style="padding:6px 8px;border-bottom:1px solid #eee;color:#666;width:90px;">${escapeHtml(k)}</td><td style="padding:6px 8px;border-bottom:1px solid #eee;">${escapeHtml(v)}</td></tr>`).join("")}
  </table>
  ${b.reschedule_url && !cancel ? `<p><a href="${escapeHtml(b.reschedule_url)}">Reschedule</a>${b.cancel_url ? ` · <a href="${escapeHtml(b.cancel_url)}">Cancel</a>` : ""}</p>` : ""}
  <p style="margin-top:24px;color:#666;font-size:12px;">Organizer: ${escapeHtml(ORGANIZER_NAME)} · booking ${escapeHtml(b.id)}</p>
</body></html>`;
  return { subject, text, html };
}

// ---------- resend ----------

interface SendResult { ok: boolean; id: string | null; error: string | null }

async function sendViaResend(apiKey: string, payload: Record<string, unknown>, idempotencyKey: string): Promise<SendResult> {
  let res: Response;
  try {
    res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    return { ok: false, id: null, error: `fetch failed: ${String(err)}` };
  }
  const bodyText = await res.text();
  const ct = (res.headers.get("content-type") ?? "").toLowerCase();
  if (!ct.includes("application/json")) {
    return { ok: false, id: null, error: `non-JSON response (status=${res.status}, content-type=${ct}, body=${bodyText.slice(0, 200)})` };
  }
  let parsed: unknown;
  try { parsed = JSON.parse(bodyText); } catch { return { ok: false, id: null, error: `JSON parse failed: ${bodyText.slice(0, 200)}` }; }
  if (!res.ok) {
    const msg = parsed && typeof parsed === "object" && "message" in parsed ? String((parsed as { message: unknown }).message) : `status ${res.status}`;
    return { ok: false, id: null, error: `resend error: ${msg}` };
  }
  const id = parsed && typeof parsed === "object" && typeof (parsed as { id?: unknown }).id === "string" ? (parsed as { id: string }).id : null;
  if (!id) return { ok: false, id: null, error: `resend 200 but no id (body=${bodyText.slice(0, 200)})` };
  return { ok: true, id, error: null };
}

// ---------- drain ----------

interface DrainResult {
  processed: number; sent: number; failed: number; skipped: number;
  receipts: Array<{ invite_id: string; booking_id: string; recipient: string; kind: string; resend_message_id: string }>;
  errors: Array<{ invite_id: string; error: string }>;
}

async function processRow(row: InviteRow, apiKey: string, from: string, result: DrainResult): Promise<void> {
  const { data: booking, error: bErr } = await sb
    .from("interview_events")
    .select("id, invitee_name, invitee_email, invitee_phone, scheduled_at, ended_at, canceled_at, cancel_reason, reschedule_url, cancel_url, prep_notes, agent_id, event_type_name, raw_payload")
    .eq("id", row.booking_id)
    .maybeSingle();
  if (bErr || !booking) {
    await sb.from("onboarding_call_invites").update({
      attempt_count: row.attempt_count + 1,
      status: row.attempt_count + 1 >= MAX_ATTEMPTS ? "failed" : "queued",
      last_error: `booking load failed: ${bErr?.message ?? "not found"}`,
      updated_at: new Date().toISOString(),
    }).eq("id", row.id);
    result.failed += 1;
    result.errors.push({ invite_id: row.id, error: bErr?.message ?? "booking not found" });
    return;
  }
  const b = booking as BookingRow;

  // A REQUEST for a booking that is already canceled or already past is not
  // worth a calendar entry — record why, never pretend it was sent.
  if (row.kind === "request") {
    const past = new Date(b.scheduled_at).getTime() < Date.now() - 60 * 60_000;
    if (b.canceled_at || past) {
      await sb.from("onboarding_call_invites").update({
        status: "skipped",
        last_error: b.canceled_at ? "booking canceled before invite was sent" : "booking already in the past",
        updated_at: new Date().toISOString(),
      }).eq("id", row.id);
      result.skipped += 1;
      return;
    }
  }

  let name = (b.invitee_name ?? "").trim();
  if (!name && b.agent_id) {
    const { data: agent } = await sb.from("agents").select("display_name").eq("id", b.agent_id).maybeSingle();
    name = ((agent as { display_name?: string } | null)?.display_name ?? "").trim();
  }
  if (!name) name = b.invitee_email ?? b.invitee_phone ?? "New hire";

  const { ics, summary } = buildIcs(row, b, name);
  const email = buildEmail(row, b, name, summary);
  const method = row.kind === "cancel" ? "CANCEL" : "REQUEST";

  const send = await sendViaResend(apiKey, {
    from,
    to: [row.recipient],
    subject: email.subject,
    html: email.html,
    text: email.text,
    reply_to: ORGANIZER_EMAIL,
    attachments: [{
      filename: row.kind === "cancel" ? "apex-onboarding-call-cancel.ics" : "apex-onboarding-call.ics",
      content: base64Utf8(ics),
      content_type: `text/calendar; charset=utf-8; method=${method}`,
    }],
  }, `onboarding-invite:${row.id}:${row.sequence}`);

  if (send.ok) {
    await sb.from("onboarding_call_invites").update({
      status: "sent",
      sent_at: new Date().toISOString(),
      resend_message_id: send.id,
      last_error: null,
      attempt_count: row.attempt_count + 1,
      updated_at: new Date().toISOString(),
    }).eq("id", row.id);
    result.sent += 1;
    result.receipts.push({ invite_id: row.id, booking_id: row.booking_id, recipient: row.recipient, kind: row.kind, resend_message_id: send.id! });
  } else {
    const attempts = row.attempt_count + 1;
    await sb.from("onboarding_call_invites").update({
      attempt_count: attempts,
      status: attempts >= MAX_ATTEMPTS ? "failed" : "queued",
      last_error: send.error,
      updated_at: new Date().toISOString(),
    }).eq("id", row.id);
    result.failed += 1;
    result.errors.push({ invite_id: row.id, error: send.error ?? "unknown" });
  }
}

async function drain(onlyInviteId: string | null): Promise<DrainResult> {
  const result: DrainResult = { processed: 0, sent: 0, failed: 0, skipped: 0, receipts: [], errors: [] };
  const apiKey = await resendApiKey();
  if (!apiKey) throw new Error("Missing RESEND_API_KEY (env or system_settings.resend_api_key)");
  const from = await fromAddress();

  let q = sb.from("onboarding_call_invites")
    .select("id, booking_id, recipient, kind, ics_uid, sequence, status, attempt_count")
    .eq("status", "queued")
    .lt("attempt_count", MAX_ATTEMPTS)
    .order("created_at", { ascending: true })
    .limit(50);
  if (onlyInviteId) q = q.eq("id", onlyInviteId);
  const { data, error } = await q;
  if (error) throw new Error(`queue fetch failed: ${error.message}`);
  const rows = (data ?? []) as InviteRow[];
  result.processed = rows.length;
  for (const row of rows) await processRow(row, apiKey, from, result);
  return result;
}

// ---------- calendly diagnostics (privileged) ----------

async function cal(path: string, init?: RequestInit): Promise<unknown> {
  const r = await fetch(`https://api.calendly.com${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${CALENDLY_TOKEN}`, "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`Calendly ${r.status} on ${path}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

async function diagWebhooks() {
  if (!CALENDLY_TOKEN) return { ok: false, error: "CALENDLY_API_TOKEN not set" };
  const me = await cal("/users/me") as { resource?: { uri?: string; current_organization?: string } };
  const org = me.resource?.current_organization;
  if (!org) throw new Error("could not resolve organization");
  const subs = await cal(`/webhook_subscriptions?organization=${encodeURIComponent(org)}&scope=organization&count=100`) as { collection?: Array<Record<string, unknown>> };
  return {
    ok: true,
    organization: org,
    subscriptions: (subs.collection ?? []).map((s) => ({
      uri: s.uri, callback_url: s.callback_url, state: s.state, events: s.events,
      scope: s.scope, created_at: s.created_at, retry_started_at: s.retry_started_at,
    })),
  };
}

async function ensureWebhook(callbackUrl: string) {
  if (!CALENDLY_TOKEN) return { ok: false, error: "CALENDLY_API_TOKEN not set" };
  const before = await diagWebhooks() as { organization?: string; subscriptions?: Array<{ callback_url?: unknown; state?: unknown; uri?: unknown }> };
  const existing = (before.subscriptions ?? []).find((s) => s.callback_url === callbackUrl && s.state === "active");
  if (existing) return { ok: true, action: "already_active", subscription: existing };
  const created = await cal("/webhook_subscriptions", {
    method: "POST",
    body: JSON.stringify({
      url: callbackUrl,
      events: ["invitee.created", "invitee.canceled"],
      organization: before.organization,
      scope: "organization",
    }),
  }) as { resource?: Record<string, unknown> };
  return { ok: true, action: "created", subscription: { uri: created.resource?.uri, callback_url: created.resource?.callback_url, state: created.resource?.state, events: created.resource?.events } };
}

// ---------- http ----------

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    if (req.method === "GET") {
      const { count } = await sb.from("onboarding_call_invites").select("id", { count: "exact", head: true }).eq("status", "queued");
      return json({ ok: true, fn: "onboarding-call-invites", queued: count ?? 0, timestamp: new Date().toISOString() });
    }

    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const action = typeof body.action === "string" ? body.action : "drain";
    const bearer = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();

    if (action === "drain") {
      if (!bearer || ![APEX_BOT_TOKEN, SERVICE_ROLE].filter(Boolean).includes(bearer)) {
        return json({ ok: false, error: "unauthorized" }, 401);
      }
    }

    if (action !== "drain") {
      if (!SERVICE_ROLE || bearer !== SERVICE_ROLE) return json({ ok: false, error: "forbidden" }, 403);
      if (action === "diag_webhooks") return json(await diagWebhooks());
      if (action === "ensure_webhook") {
        const url = typeof body.callback_url === "string" ? body.callback_url : "";
        if (!url.startsWith("https://")) return json({ ok: false, error: "callback_url required" }, 400);
        return json(await ensureWebhook(url));
      }
      if (action === "send_one") {
        const id = typeof body.invite_id === "string" ? body.invite_id : "";
        if (!id) return json({ ok: false, error: "invite_id required" }, 400);
        const r = await drain(id);
        return json({ ok: r.failed === 0, timestamp: new Date().toISOString(), ...r }, r.failed === 0 ? 200 : 500);
      }
      return json({ ok: false, error: `unknown action ${action}` }, 400);
    }

    const r = await drain(null);
    // Any failure is a non-2xx so the cron log surfaces it; the receipts are
    // still returned so a partial run is legible.
    return json({ ok: r.failed === 0, timestamp: new Date().toISOString(), ...r }, r.failed === 0 ? 200 : 500);
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err), timestamp: new Date().toISOString() }, 500);
  }
});
