// calendly-webhook — PL-058, rebuilt under MP-264 (2026-07-24)
//
// ---------------------------------------------------------------------------
// WHAT WAS BROKEN (and why 105 bookings vanished)
// ---------------------------------------------------------------------------
// classifyEvent() previously matched only seminar / exam / test / interview /
// 1on1 / prospect / manager. Sam's live Calendly event types are:
//
//     "Licensed Call"   (53 bookings)
//     "Leader Call "    (47 bookings — note the real trailing space)
//
// Neither matched anything, so every booking fell to "unknown" and the handler
// returned HTTP 200 with action:"ignored_unknown_event_type" having written
// nothing. Calendly saw success and never retried. Between 2026-06-15 and
// 2026-08-10 that silently discarded 105 VA-booked recruiting calls.
//
// Same failure class as the 465 fake-success InsuraCloud rows and the 198
// AgentLink zombie rows: a 200 that wrote nothing.
//
// ---------------------------------------------------------------------------
// THE RULES NOW
// ---------------------------------------------------------------------------
// 1. STORE FIRST, ROUTE SECOND. Every invitee.created lands in
//    interview_events before any classification branch runs. Classification
//    decides how an event routes, never whether it is kept.
// 2. NO SILENT DROPS. If the store fails we return 5xx so Calendly retries.
//    There is no success path that writes nothing.
// 3. IDENTITY IS INSTAGRAM, NOT EMAIL. The high-volume VA booking form puts
//    the literal placeholder `name@noname.com` in the email field on every
//    booking. Every booking does collect an Instagram handle, and
//    applications.instagram_handle already stores one. Match order is
//    instagram -> phone -> real email, and placeholder emails are rejected.
// 4. UNMATCHED IS STILL STORED. A booking with no matching application is a
//    real recruit — it lands with match_method='none' and surfaces in the
//    Unmatched tab rather than disappearing.
//
// Subscribe at https://calendly.com/integrations/api_webhooks for
// `invitee.created` and `invitee.canceled`. Webhook URL:
//   https://xrzweoneiieddzxogewk.supabase.co/functions/v1/calendly-webhook?secret=<APEX_CALENDLY_WEBHOOK_SECRET>

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SHARED_SECRET = Deno.env.get("APEX_CALENDLY_WEBHOOK_SECRET") ?? "";
const SIGNING_KEY = Deno.env.get("CALENDLY_SIGNING_KEY") ?? "";

const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, calendly-webhook-signature",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function ok(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

/**
 * Route classification. Returns a track for every event — "other" is a real,
 * storable track, never a reason to drop the booking.
 */
function classifyEvent(name: string | null, slug: string | null): string {
  const txt = `${name ?? ""} ${slug ?? ""}`.toLowerCase().trim();
  if (txt.includes("seminar")) return "seminar";
  if (txt.includes("exam") || txt.includes("test")) return "exam";
  if (txt.includes("licensed")) return "licensed";
  if (txt.includes("leader")) return "leader";
  if (txt.includes("interview") || txt.includes("1on1") || txt.includes("prospect") || txt.includes("manager")) {
    return "leader";
  }
  return "other";
}

/** Emails the VA booking form injects as filler. These must never match. */
const PLACEHOLDER_EMAILS = new Set([
  "name@noname.com",
  "noname@noname.com",
  "test@test.com",
  "none@none.com",
]);

function cleanEmail(raw: string | null | undefined): string | null {
  const e = (raw ?? "").trim().toLowerCase();
  if (!e || PLACEHOLDER_EMAILS.has(e)) return null;
  return e;
}

/**
 * Pull the Instagram handle out of the Q&A block. Two live form versions ask
 * it differently: "instagram" (lowercase, newline-terminated answer) on the
 * Leader Call form, "Instagram Handle" (@-prefixed) on the Licensed Call form.
 */
function extractInstagram(qa: any[]): string | null {
  if (!Array.isArray(qa)) return null;
  for (const item of qa) {
    const q = String(item?.question ?? "").toLowerCase();
    if (q.includes("instagram") || q.includes("ig handle")) {
      const a = String(item?.answer ?? "").trim().replace(/^@+/, "");
      if (a) return a;
    }
  }
  return null;
}

/** The Licensed Call form asks a "Status" question ("Just Licensed", etc). */
function extractAnswer(qa: any[], needle: string): string | null {
  if (!Array.isArray(qa)) return null;
  for (const item of qa) {
    if (String(item?.question ?? "").toLowerCase().includes(needle)) {
      const a = String(item?.answer ?? "").trim();
      if (a) return a;
    }
  }
  return null;
}

/** Free-text prep answer, if the invitee wrote one. */
function extractPrepNotes(qa: any[]): string | null {
  if (!Array.isArray(qa)) return null;
  for (const item of qa) {
    const q = String(item?.question ?? "").toLowerCase();
    if (q.includes("prepare") || q.includes("anything else") || q.includes("share anything")) {
      const a = String(item?.answer ?? "").trim();
      if (a) return a;
    }
  }
  return null;
}

async function verifySignature(req: Request, rawBody: string): Promise<boolean> {
  if (!SIGNING_KEY) return true; // not enabled → fall through to shared-secret guard
  const sig = req.headers.get("calendly-webhook-signature") ?? "";
  if (!sig) return false;
  // Calendly signature header format: "t=<timestamp>,v1=<hash>"
  const parts = Object.fromEntries(sig.split(",").map((p) => p.split("=") as [string, string]));
  const timestamp = parts.t;
  const expected = parts.v1;
  if (!timestamp || !expected) return false;
  const payload = `${timestamp}.${rawBody}`;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(SIGNING_KEY),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
  const hex = Array.from(new Uint8Array(mac)).map((b) => b.toString(16).padStart(2, "0")).join("");
  return hex === expected;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return ok({ ok: false, error: "method not allowed" }, 405);

  // Shared-secret check via ?secret=
  if (SHARED_SECRET) {
    const url = new URL(req.url);
    if (url.searchParams.get("secret") !== SHARED_SECRET) {
      return ok({ ok: false, error: "forbidden" }, 403);
    }
  }

  const rawBody = await req.text();

  // Signature check (best-effort; gated on SIGNING_KEY env)
  if (SIGNING_KEY && !(await verifySignature(req, rawBody))) {
    return ok({ ok: false, error: "bad signature" }, 403);
  }

  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return ok({ ok: false, error: "bad json" }, 400);
  }

  const eventKind: string = payload?.event ?? "";
  const inv = payload?.payload ?? {};
  const scheduled = inv?.scheduled_event ?? {};

  const eventName: string | null = scheduled?.name ?? null;
  const eventSlug: string | null = scheduled?.event_type?.slug ?? inv?.event_type?.slug ?? null;
  const eventUri: string | null = scheduled?.uri ?? null;
  const inviteeUri: string | null = inv?.uri ?? null;
  const startTimeIso: string | null = scheduled?.start_time ?? null;
  const endTimeIso: string | null = scheduled?.end_time ?? null;

  const qa: any[] = inv?.questions_and_answers ?? [];
  const instagram = extractInstagram(qa);
  const inviteeStatus = extractAnswer(qa, "status");
  const prepNotes = extractPrepNotes(qa);

  const inviteeEmail = cleanEmail(inv?.email);
  const inviteeName: string | null =
    (inv?.name ?? "").trim() ||
    [inv?.first_name, inv?.last_name].filter(Boolean).join(" ").trim() ||
    null;

  // Phone: the reminder number when present, else the outbound-call location.
  // Every Apex booking is an outbound_call, so the location almost always
  // carries the number even when the invitee left the reminder field blank.
  const locationPhone: string | null = scheduled?.location?.location ?? null;
  const inviteePhone: string | null = inv?.text_reminder_number ?? inv?.phone ?? locationPhone ?? null;

  const track = classifyEvent(eventName, eventSlug);

  // A booking with no start time is unusable. 422 (not 200) so the failure is
  // visible in Calendly's delivery log instead of looking like a success.
  if (!startTimeIso) {
    return ok({ ok: false, error: "missing start_time", event_name: eventName }, 422);
  }

  const startTs = new Date(startTimeIso);
  const startDate = startTs.toISOString().slice(0, 10);

  // ---- resolve identity: instagram -> phone -> real email ----
  let applicationId: string | null = null;
  let matchMethod = "none";
  {
    const { data: match, error: matchErr } = await sb.rpc("resolve_application_for_invitee", {
      p_email: inviteeEmail,
      p_phone: inviteePhone,
      p_instagram: instagram,
    });
    if (matchErr) {
      // Log and continue unmatched — a resolver outage must not lose the booking.
      console.error("resolve_application_for_invitee failed", matchErr);
    } else if (Array.isArray(match) && match.length) {
      applicationId = match[0]?.application_id ?? null;
      matchMethod = match[0]?.match_method ?? "none";
    }
  }

  const app = applicationId
    ? (await sb.from("applications")
        .select("id, first_name, last_name, phone, license_status")
        .eq("id", applicationId).maybeSingle()).data
    : null;

  // -------------------------------------------------------------------------
  // invitee.canceled — mark the row, never delete it. A cancellation is a
  // recruiting signal worth keeping.
  // -------------------------------------------------------------------------
  if (eventKind === "invitee.canceled") {
    if (eventUri) {
      const { error: cancelErr } = await sb.from("interview_events")
        .update({
          canceled_at: new Date().toISOString(),
          cancel_reason: inv?.cancellation?.reason ?? inv?.cancellation?.canceled_by ?? "canceled via Calendly",
        })
        .eq("calendly_event_uri", eventUri);
      if (cancelErr) {
        console.error("cancel update failed", cancelErr);
        return ok({ ok: false, error: "cancel store failed", detail: cancelErr.message }, 500);
      }
    }

    if (track === "seminar" && app?.id) {
      await sb.from("applications").update({ seminar_date: null, seminar_registered_at: null }).eq("id", app.id);
      if (inviteeEmail) {
        await sb.from("seminar_registrations")
          .update({ notes: `canceled via Calendly @ ${new Date().toISOString()}`.slice(0, 240) })
          .match({ email: inviteeEmail, seminar_date: startDate });
      }
    }
    if (track === "exam" && app?.id) {
      await sb.from("applications").update({ exam_scheduled_at: null }).eq("id", app.id);
    }

    return ok({ ok: true, track, action: "canceled", application_id: app?.id ?? null });
  }

  // -------------------------------------------------------------------------
  // invitee.created — STORE FIRST. This runs for every track including "other".
  // -------------------------------------------------------------------------
  if (eventKind === "invitee.created") {
    const row = {
      source: "calendly",
      calendly_event_uri: eventUri,
      calendly_invitee_uri: inviteeUri,
      event_type_name: eventName,
      call_track: track,
      application_id: applicationId,
      invitee_name: inviteeName,
      invitee_email: inviteeEmail,
      invitee_phone: inviteePhone,
      instagram_handle: instagram,
      invitee_status: inviteeStatus,
      prep_notes: prepNotes,
      match_method: matchMethod,
      scheduled_at: startTs.toISOString(),
      ended_at: endTimeIso ? new Date(endTimeIso).toISOString() : null,
      reschedule_url: inv?.reschedule_url ?? null,
      cancel_url: inv?.cancel_url ?? null,
      was_rescheduled: Boolean(inv?.old_invitee),
      raw_payload: payload,
    };

    // Upsert on the event URI so Calendly's at-least-once delivery is safe.
    const { error: storeErr } = await sb
      .from("interview_events")
      .upsert(row, { onConflict: "calendly_event_uri" });

    if (storeErr) {
      // 5xx on purpose: Calendly retries, and we never report a success that
      // wrote nothing. This is the guard that would have saved all 105.
      console.error("interview_events store failed", storeErr);
      return ok({ ok: false, error: "store failed", detail: storeErr.message }, 500);
    }

    // ---- secondary routing, best-effort, never gates the store ----
    if (track === "seminar") {
      if (inviteeEmail) {
        const { data: existing } = await sb.from("seminar_registrations")
          .select("id")
          .eq("email", inviteeEmail)
          .eq("seminar_date", startDate)
          .maybeSingle();
        if (!existing?.id) {
          await sb.from("seminar_registrations").insert({
            first_name: inv?.first_name ?? app?.first_name ?? inviteeName ?? "Unnamed",
            last_name: inv?.last_name ?? app?.last_name ?? "",
            email: inviteeEmail,
            phone: inviteePhone ?? app?.phone ?? null,
            license_status: app?.license_status ?? "unknown",
            source: "calendly",
            seminar_date: startDate,
            application_id: app?.id ?? null,
          });
        }
      }
      if (app?.id) {
        await sb.from("applications").update({
          seminar_date: startDate,
          seminar_registered_at: new Date().toISOString(),
        }).eq("id", app.id);
      }
    } else if (track === "exam") {
      if (app?.id) {
        await sb.from("applications").update({ exam_scheduled_at: startTs.toISOString() }).eq("id", app.id);
      }
    } else if (app?.id) {
      // Recruiting call against a known application — keep the legacy column in
      // step for surfaces that still read it, but interview_events is the truth.
      await sb.from("applications").update({ test_scheduled_date: startTs.toISOString() }).eq("id", app.id);
    }

    return ok({
      ok: true,
      track,
      action: "stored",
      event_name: eventName,
      application_id: applicationId,
      match_method: matchMethod,
      instagram,
    });
  }

  // Any other Calendly event kind: acknowledged, nothing to store.
  return ok({ ok: true, event_kind: eventKind, action: "no_op" });
});
