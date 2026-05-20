// calendly-webhook — PL-058
//
// Receives Calendly webhook events for the APEX scheduling links and
// auto-syncs them into applications + seminar_registrations.
//
// Subscribe at https://calendly.com/integrations/api_webhooks for the
// `invitee.created` and `invitee.canceled` events (organization or user
// scope). Set the webhook URL to:
//
//   https://xrzweoneiieddzxogewk.supabase.co/functions/v1/calendly-webhook?secret=<APEX_CALENDLY_WEBHOOK_SECRET>
//
// Auth: query-param shared secret (set via APEX_CALENDLY_WEBHOOK_SECRET
// env var). Optionally upgrades to HMAC-SHA256 signature verification
// once CALENDLY_SIGNING_KEY is set.
//
// Event routing:
//   - Event name contains "seminar" → write to seminar_registrations +
//     applications.seminar_registered_at / seminar_date.
//   - Event name contains "1on1" / "interview" / "licensed-prospect" /
//     "manager-call" → write to applications.test_scheduled_date or
//     applications.exam_scheduled_at depending on the slug.
//
// Email + SMS confirmations from APEX side are NOT sent here — Calendly
// sends its own confirmation email to the invitee, and the existing
// seminar-reminder-tick cron handles T-24h / T-1h reminders (email +
// telegram). Twilio SMS path is not yet plumbed; see
// supabase/functions/seminar-reminder-tick/index.ts TODO block.

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

// Classify a Calendly event by its slug. Apex Calendly URLs:
//   apexfinancialempire/1on1-call-clone (licensed) → manager interview
//   apexfinancialempire/licensed-prospect-call-clone (unlicensed) → manager call
//   apexfinancialempire/seminar* → seminar registration
function classifyEvent(name: string | null, slug: string | null): "seminar" | "manager_call" | "interview" | "exam" | "unknown" {
  const txt = `${name ?? ""} ${slug ?? ""}`.toLowerCase();
  if (txt.includes("seminar")) return "seminar";
  if (txt.includes("exam") || txt.includes("test")) return "exam";
  if (txt.includes("interview")) return "interview";
  if (txt.includes("1on1") || txt.includes("prospect") || txt.includes("manager")) return "manager_call";
  return "unknown";
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
  const eventName: string | null = inv?.scheduled_event?.name ?? null;
  const inviteeEmail: string | null = (inv?.email ?? "").toLowerCase() || null;
  const inviteeFirstName: string | null = inv?.first_name ?? null;
  const inviteeLastName: string | null = inv?.last_name ?? null;
  const inviteePhone: string | null = inv?.text_reminder_number ?? inv?.phone ?? null;
  const startTimeIso: string | null = inv?.scheduled_event?.start_time ?? null;
  const eventSlug: string | null = inv?.scheduled_event?.event_type?.slug ?? inv?.event_type?.slug ?? null;

  if (!inviteeEmail || !startTimeIso) {
    return ok({ ok: true, skipped: "missing email or start_time" });
  }

  const kind = classifyEvent(eventName, eventSlug);
  const startTs = new Date(startTimeIso);
  const startDate = startTs.toISOString().slice(0, 10);

  // Find the matching application by email (most recent if multiple)
  const { data: app } = await sb
    .from("applications")
    .select("id, first_name, last_name, phone, license_status, recruiter_id, assigned_agent_id")
    .ilike("email", inviteeEmail)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // ---- invitee.canceled ----
  if (eventKind === "invitee.canceled") {
    if (kind === "seminar" && app?.id) {
      // Clear seminar registration on the application; keep seminar_registrations
      // row for audit but mark a cancellation note.
      await sb.from("applications").update({
        seminar_date: null,
        seminar_registered_at: null,
      }).eq("id", app.id);
      await sb.from("seminar_registrations").update({
        notes: (`canceled via Calendly @ ${new Date().toISOString()}`).slice(0, 240),
      }).match({ email: inviteeEmail, seminar_date: startDate });
    }
    if (kind === "manager_call" || kind === "interview") {
      if (app?.id) {
        await sb.from("applications").update({ test_scheduled_date: null }).eq("id", app.id);
      }
    }
    if (kind === "exam" && app?.id) {
      await sb.from("applications").update({ exam_scheduled_at: null }).eq("id", app.id);
    }
    return ok({ ok: true, kind, action: "canceled", application_id: app?.id ?? null });
  }

  // ---- invitee.created ----
  if (eventKind === "invitee.created") {
    if (kind === "seminar") {
      // Upsert seminar_registrations (dedupe by email + seminar_date)
      const { data: existing } = await sb
        .from("seminar_registrations")
        .select("id")
        .eq("email", inviteeEmail)
        .eq("seminar_date", startDate)
        .maybeSingle();
      if (!existing?.id) {
        await sb.from("seminar_registrations").insert({
          first_name: inviteeFirstName ?? app?.first_name ?? "Unknown",
          last_name: inviteeLastName ?? app?.last_name ?? "Unknown",
          email: inviteeEmail,
          phone: inviteePhone ?? app?.phone ?? null,
          license_status: app?.license_status ?? "unknown",
          source: "calendly",
          seminar_date: startDate,
          application_id: app?.id ?? null,
        });
      }
      if (app?.id) {
        await sb.from("applications").update({
          seminar_date: startDate,
          seminar_registered_at: new Date().toISOString(),
        }).eq("id", app.id);
      }
      return ok({
        ok: true, kind, action: "registered",
        application_id: app?.id ?? null, seminar_date: startDate,
      });
    }

    if (kind === "manager_call" || kind === "interview") {
      // Store the scheduled time on applications.test_scheduled_date (closest
      // existing column for the recruiting call). If apps doesn't match, we
      // still 200 — Calendly retries on 5xx.
      if (app?.id) {
        await sb.from("applications").update({
          test_scheduled_date: startTs.toISOString(),
        }).eq("id", app.id);
      }
      return ok({ ok: true, kind, action: "manager_call_booked", application_id: app?.id ?? null });
    }

    if (kind === "exam") {
      if (app?.id) {
        await sb.from("applications").update({
          exam_scheduled_at: startTs.toISOString(),
        }).eq("id", app.id);
      }
      return ok({ ok: true, kind, action: "exam_booked", application_id: app?.id ?? null });
    }

    return ok({ ok: true, kind, action: "ignored_unknown_event_type", event_name: eventName });
  }

  // Unknown event kind — accept but no-op
  return ok({ ok: true, event_kind: eventKind, action: "no_op" });
});
