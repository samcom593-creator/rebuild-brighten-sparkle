// assistant-add-interview
//
// Sam directive 2026-06-15:
// Public, token-gated endpoint Sam's assistant uses via /assistant/interviews
// to drop a new interview into Sam's manual_interview_entries and get back a
// one-tap Google Calendar TEMPLATE URL plus an evidence-backed confirmation.
//
// Methods:
//   OPTIONS — CORS preflight (allow-all)
//   GET ?t=<token> — lightweight token-check; returns { ok, label } or 401
//   POST — submit an interview; body documented below
//
// POST body shape:
//   {
//     token: string,
//     request_id: string (UUID),       // required idempotency key
//     candidate_name: string,        // required
//     scheduled_at: string (ISO),    // required
//     duration_minutes?: number,     // default 15
//     interview_type?: string,       // default 'general'
//     phone?: string,
//     email?: string,
//     instagram_handle?: string,
//     notes?: string
//   }
//
// Returns: { ok: true, interview_id, calendar_template_url }
//
// Token is validated via service-role client; assistant_share_tokens.is_active
// must be true and last_used_at is bumped on every successful POST.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.90.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const ALLOWED_INTERVIEW_TYPES = new Set([
  "licensed_prospect",
  "licensed_call",
  "leader_call",
  "unlicensed_lead",
  "final_expense_review",
  "callback",
  "general",
]);
const REQUEST_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeInstagram(value: string): string | null {
  const handle = value
    .trim()
    .replace(/^(?:https?:\/\/)?(?:www\.)?instagram\.com\//i, "")
    .replace(/^@+/, "")
    .split(/[/?#]/, 1)[0]
    .trim();
  return /^[a-z0-9._]{1,30}$/i.test(handle) ? handle : null;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Build a Google Calendar TEMPLATE URL.
//  https://calendar.google.com/calendar/render?action=TEMPLATE&text=...&dates=START/END&details=...
// Google expects `dates` as YYYYMMDDTHHmmssZ/YYYYMMDDTHHmmssZ (UTC, no
// punctuation). Falsy lines are stripped from the description.
function googleCalendarTemplateUrl(
  title: string,
  startISO: string,
  durationMinutes: number,
  description: string,
): string {
  const start = new Date(startISO);
  const end = new Date(start.getTime() + durationMinutes * 60 * 1000);
  const fmt = (d: Date) =>
    d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: title,
    dates: `${fmt(start)}/${fmt(end)}`,
    details: description,
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return json({ ok: false, error: "Server misconfigured" }, 500);
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // ── GET = token-check ────────────────────────────────────────────────────
  if (req.method === "GET") {
    const url = new URL(req.url);
    const token = url.searchParams.get("t") ?? url.searchParams.get("token");
    if (!token) {
      return json({ ok: false, error: "Missing token" }, 400);
    }
    const { data, error } = await supabase
      .from("assistant_share_tokens")
      .select("id, label, is_active")
      .eq("token", token)
      .maybeSingle();
    if (error || !data || !data.is_active) {
      // Single uniform error — never leak whether the token exists.
      return json({ ok: false, error: "Link is not active" }, 401);
    }
    return json({ ok: true, label: data.label });
  }

  if (req.method !== "POST") {
    return json({ ok: false, error: "Method not allowed" }, 405);
  }

  // ── POST = submit interview ──────────────────────────────────────────────
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch (_e) {
    return json({ ok: false, error: "Invalid JSON" }, 400);
  }

  const token = typeof body.token === "string" ? body.token.trim() : "";
  const requestId = typeof body.request_id === "string" ? body.request_id.trim() : "";
  const candidateName =
    typeof body.candidate_name === "string" ? body.candidate_name.trim() : "";
  const scheduledAt =
    typeof body.scheduled_at === "string" ? body.scheduled_at.trim() : "";
  const durationRaw = body.duration_minutes;
  const durationMinutes = durationRaw === undefined
    ? 15
    : typeof durationRaw === "number" && durationRaw >= 5 && durationRaw <= 240
      ? Math.floor(durationRaw)
      : null;
  const interviewTypeRaw =
    typeof body.interview_type === "string" ? body.interview_type.trim() : "";
  const interviewType = ALLOWED_INTERVIEW_TYPES.has(interviewTypeRaw)
    ? interviewTypeRaw
    : "general";
  const phone = typeof body.phone === "string" ? body.phone.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const igRaw =
    typeof body.instagram_handle === "string"
      ? body.instagram_handle.trim()
      : "";
  const instagramHandle = igRaw ? normalizeInstagram(igRaw) : null;
  const notes = typeof body.notes === "string" ? body.notes.trim() : "";

  if (!token) return json({ ok: false, error: "Missing token" }, 400);
  if (!REQUEST_ID_RE.test(requestId)) return json({ ok: false, error: "Invalid request receipt" }, 400);
  if (!candidateName)
    return json({ ok: false, error: "Candidate name is required" }, 400);
  if (candidateName.length > 160) return json({ ok: false, error: "Candidate name is too long" }, 400);
  if (!scheduledAt)
    return json(
      { ok: false, error: "Scheduled time is required" },
      400,
    );
  if (durationMinutes === null) return json({ ok: false, error: "Duration must be 5–240 minutes" }, 400);
  if (phone && (phone.length > 32 || phone.replace(/\D/g, "").length < 7)) {
    return json({ ok: false, error: "Enter a valid phone number" }, 400);
  }
  if (email && (email.length > 254 || !EMAIL_RE.test(email))) {
    return json({ ok: false, error: "Enter a valid email address" }, 400);
  }
  if (igRaw && !instagramHandle) return json({ ok: false, error: "Enter a valid Instagram handle" }, 400);
  if (!phone && !email && !instagramHandle) {
    return json({ ok: false, error: "Add a phone, email, or Instagram handle so the candidate can be identified" }, 400);
  }
  if (notes.length > 4000) return json({ ok: false, error: "Notes are too long" }, 400);

  const startDate = new Date(scheduledAt);
  if (isNaN(startDate.getTime())) {
    return json({ ok: false, error: "Invalid scheduled time" }, 400);
  }
  if (startDate.getTime() <= Date.now()) {
    return json({ ok: false, error: "Scheduled time must be in the future" }, 400);
  }

  // Validate token
  const { data: tokenRow, error: tokenErr } = await supabase
    .from("assistant_share_tokens")
    .select("id, owner_user_id, is_active, label")
    .eq("token", token)
    .maybeSingle();
  if (tokenErr || !tokenRow || !tokenRow.is_active) {
    return json({ ok: false, error: "Link is not active" }, 401);
  }

  // Insert interview row under Sam's user_id
  const insertPayload = {
    candidate_name: candidateName,
    phone: phone || null,
    email: email || null,
    instagram_handle: instagramHandle || null,
    scheduled_at: startDate.toISOString(),
    interview_type: interviewType,
    notes: notes || null,
    created_by: tokenRow.owner_user_id,
    assistant_token_id: tokenRow.id,
    source_request_id: requestId,
  };

  type SavedInterview = {
    id: string; candidate_name: string; phone: string | null; email: string | null;
    instagram_handle: string | null; scheduled_at: string; interview_type: string;
    notes: string | null; confirmation_sent_at: string | null; created_at: string;
  };
  const { data: insertedData, error: insErr } = await supabase
    .from("manual_interview_entries")
    .insert(insertPayload)
    .select("id,candidate_name,phone,email,instagram_handle,scheduled_at,interview_type,notes,confirmation_sent_at,created_at")
    .single();
  let inserted = insertedData as SavedInterview | null;
  let replayed = false;
  if (insErr?.code === "23505") {
    const { data: existing, error: existingError } = await supabase
      .from("manual_interview_entries")
      .select("id,candidate_name,phone,email,instagram_handle,scheduled_at,interview_type,notes,confirmation_sent_at,created_at")
      .eq("assistant_token_id", tokenRow.id)
      .eq("source_request_id", requestId)
      .maybeSingle();
    if (existingError || !existing) {
      console.error("[assistant-add-interview] idempotency lookup failed", existingError);
      return json({ ok: false, error: "Could not recover the saved interview. Try again." }, 500);
    }
    const samePayload = existing.candidate_name === insertPayload.candidate_name
      && existing.phone === insertPayload.phone
      && existing.email === insertPayload.email
      && existing.instagram_handle === insertPayload.instagram_handle
      && new Date(existing.scheduled_at).getTime() === startDate.getTime()
      && existing.interview_type === insertPayload.interview_type
      && existing.notes === insertPayload.notes;
    if (!samePayload) return json({ ok: false, error: "This request receipt was already used for a different interview" }, 409);
    inserted = existing as SavedInterview;
    replayed = true;
  } else if (insErr) {
    console.error("[assistant-add-interview] insert failed", insErr);
    return json(
      { ok: false, error: "Could not save the interview. Try again." },
      500,
    );
  }
  if (!inserted) return json({ ok: false, error: "Interview receipt was not returned" }, 500);

  // The public intake used to stop at manual_interview_entries, while the live
  // Interviews page reads hh_applicants. Mirror by an immutable import key so a
  // retry cannot create a second candidate in the working queue.
  let pipelineWarning: string | null = null;
  const { data: ownerAuth } = await supabase.auth.admin.getUserById(tokenRow.owner_user_id);
  const ownerEmail = ownerAuth.user?.email?.trim().toLowerCase() ?? "";
  const { data: hhOwner } = ownerEmail
    ? await supabase.from("hh_users").select("id").eq("email", ownerEmail).eq("active", true).maybeSingle()
    : { data: null };
  const { error: pipelineError } = await supabase.from("hh_applicants").upsert({
    name: candidateName,
    phone: phone || null,
    email: email || null,
    instagram: instagramHandle || null,
    appointment_at: startDate.toISOString(),
    stage: "appointment_set",
    interview_result: "pending",
    notes: notes || null,
    recruiter_id: hhOwner?.id ?? null,
    created_by: hhOwner?.id ?? null,
    import_key: `assistant:${inserted.id}`,
  }, { onConflict: "import_key", ignoreDuplicates: true });
  if (pipelineError) {
    console.error("[assistant-add-interview] pipeline mirror failed", pipelineError.message);
    pipelineWarning = "Booked, but the hiring queue mirror needs staff review.";
  }

  // Confirmation is evidence-based: only a verified response from the existing
  // mail function is reported as sent. Booking remains durable if email fails.
  let confirmationSent = Boolean(inserted.confirmation_sent_at);
  let confirmationWarning: string | null = email ? null : "No email supplied; confirmation was not sent.";
  if (email && !confirmationSent) {
    try {
      const confirmationResponse = await fetch(`${SUPABASE_URL}/functions/v1/send-candidate-confirmation`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          "apikey": SUPABASE_SERVICE_ROLE_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          interview_id: inserted.id,
          candidate_email: email,
          candidate_name: candidateName,
          scheduled_at: startDate.toISOString(),
        }),
      });
      const confirmation = await confirmationResponse.json().catch(() => ({})) as { ok?: boolean; sent?: boolean; error?: string; warning?: string };
      confirmationSent = confirmationResponse.ok && confirmation.ok === true && confirmation.sent === true;
      if (!confirmationSent) confirmationWarning = "Booked, but email confirmation needs staff review.";
      else if (confirmation.warning) confirmationWarning = confirmation.warning;
    } catch (error) {
      console.error("[assistant-add-interview] confirmation failed", error);
      confirmationWarning = "Booked, but email confirmation needs staff review.";
    }
  }

  // Bump last_used_at; this usage stamp is non-critical after the booking is durable.
  await supabase
    .from("assistant_share_tokens")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", tokenRow.id);

  // Build Google Calendar TEMPLATE URL
  const title = `APEX Interview — ${candidateName}`;
  const descLines = [
    interviewType ? `Type: ${interviewType}` : null,
    notes ? `Notes: ${notes}` : null,
    phone ? `Phone: ${phone}` : null,
    email ? `Email: ${email}` : null,
    instagramHandle ? `IG: @${instagramHandle}` : null,
    "",
    "Booked via APEX assistant share link.",
  ].filter((s): s is string => s !== null);
  const description = descLines.join("\n");

  const calendarTemplateUrl = googleCalendarTemplateUrl(
    title,
    inserted.scheduled_at,
    durationMinutes,
    description,
  );

  return json({
    ok: true,
    interview_id: inserted.id,
    calendar_template_url: calendarTemplateUrl,
    pipeline_added: !pipelineWarning,
    confirmation_sent: confirmationSent,
    warning: [pipelineWarning, confirmationWarning].filter(Boolean).join(" ") || null,
    receipt: {
      request_id: requestId,
      persisted_at: inserted.created_at,
      replayed,
    },
  });
});
