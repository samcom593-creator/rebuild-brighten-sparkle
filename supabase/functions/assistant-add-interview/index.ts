// assistant-add-interview
//
// Sam directive 2026-06-15:
// Public, token-gated endpoint Sam's assistant uses via /assistant/interviews
// to drop a new interview into Sam's manual_interview_entries and get back a
// one-tap Google Calendar TEMPLATE URL. No OAuth, no Resend — MVP only.
//
// Methods:
//   OPTIONS — CORS preflight (allow-all)
//   GET ?t=<token> — lightweight token-check; returns { ok, label } or 401
//   POST — submit an interview; body documented below
//
// POST body shape:
//   {
//     token: string,
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

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
  const candidateName =
    typeof body.candidate_name === "string" ? body.candidate_name.trim() : "";
  const scheduledAt =
    typeof body.scheduled_at === "string" ? body.scheduled_at.trim() : "";
  const durationRaw = body.duration_minutes;
  const durationMinutes =
    typeof durationRaw === "number" && durationRaw > 0 && durationRaw <= 240
      ? Math.floor(durationRaw)
      : 15;
  const interviewTypeRaw =
    typeof body.interview_type === "string" ? body.interview_type.trim() : "";
  const interviewType = ALLOWED_INTERVIEW_TYPES.has(interviewTypeRaw)
    ? interviewTypeRaw
    : "general";
  const phone = typeof body.phone === "string" ? body.phone.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const igRaw =
    typeof body.instagram_handle === "string"
      ? body.instagram_handle.trim()
      : "";
  const instagramHandle = igRaw.replace(/^@/, "");
  const notes = typeof body.notes === "string" ? body.notes.trim() : "";

  if (!token) return json({ ok: false, error: "Missing token" }, 400);
  if (!candidateName)
    return json({ ok: false, error: "Candidate name is required" }, 400);
  if (!scheduledAt)
    return json(
      { ok: false, error: "Scheduled time is required" },
      400,
    );

  const startDate = new Date(scheduledAt);
  if (isNaN(startDate.getTime())) {
    return json({ ok: false, error: "Invalid scheduled time" }, 400);
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
  };

  const { data: inserted, error: insErr } = await supabase
    .from("manual_interview_entries")
    .insert(insertPayload)
    .select("id, scheduled_at")
    .single();
  if (insErr || !inserted) {
    console.error("[assistant-add-interview] insert failed", insErr);
    return json(
      { ok: false, error: "Could not save the interview. Try again." },
      500,
    );
  }

  // Bump last_used_at — fire-and-forget; failure here does not fail the request
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
  });
});
