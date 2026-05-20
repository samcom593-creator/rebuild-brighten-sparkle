// notify-seminar-signup — PL-057
//
// Fires from the trg_auto_seminar_signup_on_course_paid trigger via pg_net
// whenever an applicant pays for the pre-license course. Sends the assigned
// hiring manager (or Sam if no manager) an email with the booked seminar
// date so they can follow up.
//
// Auth: x-apex-drain-secret header must match APEX_DRAIN_SHARED_SECRET env
// var (same secret used by telegram-drain).

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const SHARED_SECRET = Deno.env.get("APEX_DRAIN_SHARED_SECRET") ?? "";

const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-apex-drain-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function formatSeminarDate(dateStr: string): string {
  try {
    // seminar_date is DATE — compute day-of-week in CT
    const noonCT = new Date(`${dateStr}T17:00:00Z`);
    const dow = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Chicago",
      weekday: "long",
    }).format(noonCT);
    const clock = dow === "Wednesday" ? "7:00 PM CT" : "10:00 AM CT";
    const pretty = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Chicago",
      weekday: "long",
      month: "long",
      day: "numeric",
    }).format(noonCT);
    return `${pretty} · ${clock}`;
  } catch {
    return dateStr;
  }
}

async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  if (!RESEND_KEY) {
    console.warn("RESEND_API_KEY not set — skipping email");
    return false;
  }
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Apex Financial <noreply@apex-financial.org>",
        to: [to],
        subject,
        html,
        tags: [{ name: "category", value: "seminar_auto_signup" }],
      }),
    });
    if (!r.ok) {
      console.error("resend non-ok", r.status, await r.text());
      return false;
    }
    return true;
  } catch (e) {
    console.error("resend error", e);
    return false;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return new Response("method not allowed", { status: 405, headers: corsHeaders });

  // Auth gate
  const headerSecret = req.headers.get("x-apex-drain-secret") ?? "";
  const isService = (req.headers.get("authorization") ?? "").includes(SUPABASE_KEY.slice(0, 20));
  if (SHARED_SECRET && headerSecret !== SHARED_SECRET && !isService) {
    return new Response(JSON.stringify({ ok: false, error: "forbidden" }), {
      status: 403,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ ok: false, error: "bad json" }), {
      status: 400,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }

  const applicationId: string | undefined = body?.application_id;
  const seminarDate: string | undefined = body?.seminar_date;
  if (!applicationId || !seminarDate) {
    return new Response(JSON.stringify({ ok: false, error: "missing application_id or seminar_date" }), {
      status: 400,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }

  // Pull the application + assigned manager
  const { data: app, error: appErr } = await sb
    .from("applications")
    .select("id, first_name, last_name, email, phone, license_status, assigned_agent_id, recruiter_id, hiring_manager_user_id")
    .eq("id", applicationId)
    .maybeSingle();
  if (appErr || !app) {
    return new Response(JSON.stringify({ ok: false, error: appErr?.message ?? "application not found" }), {
      status: 404,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }

  // Resolve manager email: hiring_manager_user_id → profile, else assigned_agent_id → agent.profile
  let managerEmail: string | null = null;
  let managerName: string | null = null;
  if (app.hiring_manager_user_id) {
    const { data: p } = await sb.from("profiles").select("email, full_name").eq("id", app.hiring_manager_user_id).maybeSingle();
    if (p?.email) {
      managerEmail = p.email as string;
      managerName = (p.full_name as string) ?? null;
    }
  }
  if (!managerEmail && app.assigned_agent_id) {
    const { data: a } = await sb
      .from("agents")
      .select("display_name, profile:profiles(email, full_name)")
      .eq("id", app.assigned_agent_id)
      .maybeSingle();
    const p = (a as any)?.profile;
    if (p?.email) {
      managerEmail = p.email;
      managerName = p.full_name ?? (a as any)?.display_name ?? null;
    }
  }

  // Fallback: Sam's primary email if nothing else found
  if (!managerEmail) {
    managerEmail = "sam.com593@gmail.com";
    managerName = "Sam James";
  }

  const seminarPretty = formatSeminarDate(seminarDate);
  const applicantName = [app.first_name, app.last_name].filter(Boolean).join(" ");
  const subject = `${applicantName} paid for the course → auto-booked for seminar ${seminarPretty.split(" · ")[0]}`;
  const html = `
    <div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#111">
      <h2 style="margin:0 0 16px 0;color:#c8a445">Course paid → seminar booked</h2>
      <p>Hi ${managerName ?? "there"},</p>
      <p><strong>${applicantName}</strong> just paid for the pre-license course and was auto-registered for:</p>
      <p style="font-size:18px;font-weight:600;background:#f6f3ea;padding:12px 16px;border-radius:8px">${seminarPretty}</p>
      <p style="margin-top:16px"><strong>Contact:</strong></p>
      <ul style="margin:8px 0 16px 0;padding-left:20px">
        <li>Email: ${app.email}</li>
        ${app.phone ? `<li>Phone: ${app.phone}</li>` : ""}
        <li>License status: ${app.license_status ?? "unlicensed"}</li>
      </ul>
      <p>They'll get automated email + Telegram reminders T-24h and T-1h before the seminar. You should reach out within 24h to confirm they got the link.</p>
      <p style="margin-top:24px"><a href="https://apex-financial.org/dashboard/applicants?id=${app.id}" style="display:inline-block;padding:10px 18px;background:#c8a445;color:#fff;text-decoration:none;border-radius:6px;font-weight:600">Open application</a></p>
      <p style="margin-top:24px;font-size:11px;color:#888">Auto-sent by the apex-financial.org seminar-signup hook. Trigger: applications.course_purchased_at NULL → NOT NULL.</p>
    </div>`;

  const ok = await sendEmail(managerEmail, subject, html);

  return new Response(JSON.stringify({
    ok,
    application_id: applicationId,
    seminar_date: seminarDate,
    manager_email: managerEmail,
  }), { headers: { ...corsHeaders, "content-type": "application/json" } });
});
