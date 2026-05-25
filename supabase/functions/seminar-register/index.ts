// seminar-register -- PL-086
//
// Public write path for /seminar. Validates the form payload, calls the
// SECURITY DEFINER register_for_seminar RPC, then sends the assigned manager
// a real email alert through Resend. Registration must succeed even if the
// manager alert provider is temporarily unavailable.

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_KEY = Deno.env.get("RESEND_API_KEY") ?? "";

const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false },
});

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type SeminarPayload = {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  licenseStatus?: string;
  seminarDate?: string;
  seminarSlot?: string;
  reminderOptIn?: boolean;
  utm?: {
    utm_source?: string;
    utm_medium?: string;
    utm_campaign?: string;
  };
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
};

type ManagerTarget = {
  email: string;
  name: string;
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

function clean(value: unknown): string {
  return String(value ?? "").trim();
}

function html(value: unknown): string {
  return clean(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function normalizeEmail(value: unknown): string {
  return clean(value).toLowerCase();
}

function normalizeLicense(value: unknown): "licensed" | "unlicensed" | "unknown" {
  const v = clean(value).toLowerCase();
  if (v === "licensed") return "licensed";
  if (v === "unlicensed") return "unlicensed";
  return "unknown";
}

function assertDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("Pick a valid seminar date.");
  }

  const d = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) {
    throw new Error("Pick a valid seminar date.");
  }

  return value;
}

function formatSeminarDate(dateStr: string): string {
  try {
    const noonUtc = new Date(`${dateStr}T17:00:00Z`);
    const weekday = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Chicago",
      weekday: "long",
    }).format(noonUtc);
    const pretty = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Chicago",
      weekday: "long",
      month: "long",
      day: "numeric",
    }).format(noonUtc);
    const clock = weekday === "Saturday" ? "10:00 AM CT" : "7:00 PM CT";
    return `${pretty} at ${clock}`;
  } catch {
    return dateStr;
  }
}

async function profileById(id: string | null | undefined): Promise<ManagerTarget | null> {
  if (!id) return null;

  const { data } = await sb
    .from("profiles")
    .select("email, full_name")
    .eq("id", id)
    .maybeSingle();

  const email = clean((data as any)?.email);
  if (!email) return null;

  return {
    email,
    name: clean((data as any)?.full_name) || "there",
  };
}

async function managerFromAgent(agentId: string | null | undefined): Promise<ManagerTarget | null> {
  if (!agentId) return null;

  const { data: agent } = await sb
    .from("agents")
    .select("display_name, profile_id, user_id, manager_id")
    .eq("id", agentId)
    .maybeSingle();

  const profile = await profileById((agent as any)?.profile_id ?? (agent as any)?.user_id);
  if (profile) {
    return {
      email: profile.email,
      name: profile.name === "there" ? clean((agent as any)?.display_name) || profile.name : profile.name,
    };
  }

  const managerAgentId = (agent as any)?.manager_id as string | null | undefined;
  if (!managerAgentId || managerAgentId === agentId) return null;
  return managerFromAgent(managerAgentId);
}

async function resolveManager(applicationId: string): Promise<{
  manager: ManagerTarget;
  application: any;
}> {
  const { data: app, error } = await sb
    .from("applications")
    .select("id, first_name, last_name, email, phone, license_status, seminar_date, assigned_agent_id, recruiter_id, hiring_manager_user_id")
    .eq("id", applicationId)
    .maybeSingle();

  if (error || !app) {
    throw new Error(error?.message ?? "Application not found after seminar registration.");
  }

  const manager =
    await profileById((app as any).hiring_manager_user_id) ??
    await managerFromAgent((app as any).assigned_agent_id) ??
    await managerFromAgent((app as any).recruiter_id) ??
    { email: "sam.com593@gmail.com", name: "Sam James" };

  return { manager, application: app };
}

async function sendManagerAlert(
  manager: ManagerTarget,
  app: any,
  seminarDate: string,
  registrationId: string,
): Promise<{ ok: boolean; providerMessageId: string | null; error: string | null }> {
  const applicantName = `${clean(app.first_name)} ${clean(app.last_name)}`.trim();
  const seminarPretty = formatSeminarDate(seminarDate);
  const subject = `New seminar registration: ${applicantName} - ${seminarPretty}`;
  const appUrl = `https://apex-financial.org/dashboard/applicants?lead=${encodeURIComponent(clean(app.id))}`;

  const body = `
    <div style="font-family:Arial,sans-serif;max-width:620px;margin:0 auto;padding:24px;color:#111">
      <h1 style="margin:0 0 14px;color:#c8a445;font-size:22px">New APEX seminar registration</h1>
      <p>Hi ${html(manager.name)},</p>
      <p><strong>${html(applicantName)}</strong> just locked a seat for:</p>
      <p style="font-size:18px;font-weight:700;background:#f6f3ea;padding:12px 16px;border-radius:8px">${html(seminarPretty)}</p>
      <table style="width:100%;border-collapse:collapse;margin:18px 0">
        <tr><td style="padding:6px 0;color:#666;width:34%">Email</td><td style="padding:6px 0"><a href="mailto:${html(app.email)}">${html(app.email)}</a></td></tr>
        ${app.phone ? `<tr><td style="padding:6px 0;color:#666">Phone</td><td style="padding:6px 0"><a href="tel:${html(app.phone)}">${html(app.phone)}</a></td></tr>` : ""}
        <tr><td style="padding:6px 0;color:#666">License status</td><td style="padding:6px 0">${html(app.license_status ?? "unknown")}</td></tr>
      </table>
      <p>Follow up before the room opens so they do not come in cold.</p>
      <p style="margin-top:22px"><a href="${appUrl}" style="display:inline-block;background:#111827;color:#fff;text-decoration:none;padding:11px 18px;border-radius:8px;font-weight:700">Open application</a></p>
      <p style="margin-top:24px;font-size:11px;color:#777">Registration ${html(registrationId)} from apex-financial.org/seminar.</p>
    </div>`;

  if (!RESEND_KEY) {
    return { ok: false, providerMessageId: null, error: "RESEND_API_KEY not set" };
  }

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Apex Financial <notifications@apex-financial.org>",
        to: [manager.email],
        subject,
        html: body,
        tags: [{ name: "category", value: "seminar_manager_alert" }],
      }),
    });

    const text = await response.text();
    let parsed: any = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }

    if (!response.ok) {
      return {
        ok: false,
        providerMessageId: null,
        error: parsed?.message ?? parsed?.error ?? text ?? `Resend ${response.status}`,
      };
    }

    return {
      ok: true,
      providerMessageId: parsed?.id ?? null,
      error: null,
    };
  } catch (error) {
    return {
      ok: false,
      providerMessageId: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function logManagerAlert(
  manager: ManagerTarget,
  applicationId: string,
  registrationId: string,
  seminarDate: string,
  alert: { ok: boolean; providerMessageId: string | null; error: string | null },
) {
  const subject = `New seminar registration - ${formatSeminarDate(seminarDate)}`;
  await sb.from("email_delivery_log").insert({
    template: "seminar-manager-alert",
    recipient_email: manager.email,
    subject,
    provider: "resend",
    provider_message_id: alert.providerMessageId,
    status: alert.ok ? "sent" : "error",
    error: alert.error,
    related_record_id: applicationId,
    related_record_type: "application",
    sent_at: alert.ok ? new Date().toISOString() : null,
  });

  await sb
    .from("seminar_registrations")
    .update({ manager_alert_queued_at: new Date().toISOString() })
    .eq("id", registrationId);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ ok: false, error: "method not allowed" }, 405);

  let payload: SeminarPayload;
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ ok: false, error: "Invalid JSON." }, 400);
  }

  try {
    const firstName = clean(payload.firstName);
    const lastName = clean(payload.lastName);
    const email = normalizeEmail(payload.email);
    const phone = clean(payload.phone);
    const seminarDate = assertDate(clean(payload.seminarDate ?? payload.seminarSlot));

    if (firstName.length < 2) throw new Error("First name is required.");
    if (lastName.length < 2) throw new Error("Last name is required.");
    if (!email.includes("@")) throw new Error("Valid email is required.");
    if (phone.replace(/\D/g, "").length < 10) throw new Error("Valid phone number is required.");

    const utmSource = payload.utm?.utm_source ?? payload.utm_source ?? null;
    const utmMedium = payload.utm?.utm_medium ?? payload.utm_medium ?? null;
    const utmCampaign = payload.utm?.utm_campaign ?? payload.utm_campaign ?? null;

    const { data, error } = await sb.rpc("register_for_seminar", {
      p_first_name: firstName,
      p_last_name: lastName,
      p_email: email,
      p_phone: phone,
      p_seminar_date: seminarDate,
      p_license_status: normalizeLicense(payload.licenseStatus),
      p_source: "website-seminar-form",
      p_utm_source: utmSource,
      p_utm_medium: utmMedium,
      p_utm_campaign: utmCampaign,
      p_reminder_opt_in: payload.reminderOptIn === true,
    });

    if (error) throw new Error(error.message);

    const row = Array.isArray(data) ? data[0] : data;
    const registrationId = clean(row?.registration_id);
    const applicationId = clean(row?.application_id);
    if (!registrationId || !applicationId) {
      throw new Error("Seminar registration returned no application id.");
    }

    const { manager, application } = await resolveManager(applicationId);
    const alert = await sendManagerAlert(manager, application, seminarDate, registrationId);
    await logManagerAlert(manager, applicationId, registrationId, seminarDate, alert);

    return jsonResponse({
      ok: true,
      registration_id: registrationId,
      application_id: applicationId,
      is_new_application: Boolean(row?.is_new_application),
      manager_email: manager.email,
      manager_notified: alert.ok,
      manager_alert_error: alert.error,
    });
  } catch (error) {
    console.error("[seminar-register]", error);
    return jsonResponse({
      ok: false,
      error: error instanceof Error ? error.message : "Could not register for seminar.",
    }, 400);
  }
});
