// Native APEX recruiting interview pipeline.
// Reads and writes the proven hh_* tables without leaving the APEX product.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.90.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};
const url = Deno.env.get("SUPABASE_URL");
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
if (!url || !serviceKey) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...corsHeaders },
});

type ActorRole = "executive" | "recruiter" | "va";
type InterviewAction =
  | "confirm" | "qualified" | "follow_up" | "hire" | "not_hired"
  | "unqualified" | "no_show" | "reschedule" | "cancel" | "reopen";
type ApplicantRow = {
  id: string; name: string; phone: string | null; email: string | null;
  instagram: string | null; company: string | null; appointment_at: string | null;
  stage: string; interview_result: string; unqualified_reason: string | null;
  notes: string | null; va_id: string | null; recruiter_id: string | null;
  version: number; archived: boolean; reschedule_count: number;
  created_at: string; updated_at: string;
};
type Actor = {
  authUserId: string; email: string; role: ActorRole;
  hhUser: { id: string; name: string; role: string } | null;
};

const ACTIONS = new Set<InterviewAction>([
  "confirm", "qualified", "follow_up", "hire", "not_hired",
  "unqualified", "no_show", "reschedule", "cancel", "reopen",
]);
const LEGAL_BY_STAGE: Record<string, InterviewAction[]> = {
  appointment_set: ["confirm", "no_show", "reschedule", "cancel"],
  confirmed: ["qualified", "follow_up", "hire", "not_hired", "unqualified", "no_show", "reschedule"],
  rescheduled: ["confirm", "qualified", "follow_up", "hire", "not_hired", "unqualified", "no_show", "cancel"],
  interview_complete: ["hire", "not_hired", "follow_up", "unqualified"],
  no_show: ["reschedule", "unqualified", "cancel"],
  canceled: ["reschedule"],
  hired: ["reopen"],
  not_hired: ["reopen"],
  unqualified: ["reopen"],
};
const VA_ACTIONS = new Set<InterviewAction>(["confirm", "no_show", "reschedule", "cancel"]);

function normalizedPhone(value: string | null | undefined) {
  const digits = (value ?? "").replace(/\D/g, "");
  return digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
}
function normalizedInstagram(value: string | null | undefined) {
  const handle = (value ?? "")
    .trim()
    .replace(/^(?:https?:\/\/)?(?:www\.)?instagram\.com\//i, "")
    .replace(/^@+/, "")
    .split(/[/?#]/, 1)[0]
    .trim()
    .toLowerCase();
  return /^[a-z0-9._]{1,30}$/i.test(handle) ? handle : "";
}
function actorRole(roles: Set<string>): ActorRole | null {
  if (roles.has("admin")) return "executive";
  if (roles.has("manager")) return "recruiter";
  if (roles.has("va_manager") || roles.has("va")) return "va";
  return null;
}

async function authenticate(req: Request): Promise<Actor | Response> {
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);
  const { data, error } = await admin.auth.getUser(authHeader.slice(7));
  const authUser = data.user;
  const email = authUser?.email?.trim().toLowerCase();
  if (error || !authUser?.id || !email) return json({ error: "invalid token" }, 401);

  const [{ data: roleRows, error: roleError }, { data: hhUser, error: hhError }] = await Promise.all([
    admin.from("user_roles").select("role").eq("user_id", authUser.id),
    admin.from("hh_users").select("id,name,role").eq("email", email).eq("active", true).maybeSingle(),
  ]);
  if (roleError) throw roleError;
  if (hhError) throw hhError;
  const role = actorRole(new Set((roleRows ?? []).map((row) => row.role as string)));
  if (!role) return json({ error: "forbidden" }, 403);
  if (role === "va" && !hhUser) {
    return json({ error: "Your APEX account is not linked to an active interview owner." }, 403);
  }
  return { authUserId: authUser.id, email, role, hhUser: hhUser ?? null };
}

function patchFor(action: InterviewAction, current: ApplicantRow, body: Record<string, unknown>) {
  const patch: Record<string, unknown> = {};
  switch (action) {
    case "confirm": Object.assign(patch, { stage: "confirmed", interview_result: "pending" }); break;
    case "qualified": Object.assign(patch, { stage: "interview_complete", interview_result: "qualified" }); break;
    case "follow_up": Object.assign(patch, { stage: "interview_complete", interview_result: "follow_up" }); break;
    case "hire": Object.assign(patch, { stage: "hired", interview_result: "hired" }); break;
    case "not_hired": Object.assign(patch, { stage: "not_hired", interview_result: "not_hired" }); break;
    case "unqualified": {
      const reason = typeof body.reason === "string" ? body.reason.trim() : "";
      if (!reason) throw new Error("Unqualified requires a reason");
      Object.assign(patch, { stage: "unqualified", interview_result: "unqualified", unqualified_reason: reason.slice(0, 200) });
      break;
    }
    case "no_show": Object.assign(patch, { stage: "no_show", interview_result: "pending" }); break;
    case "reschedule": {
      const raw = typeof body.appointmentAt === "string" ? body.appointmentAt : "";
      const appointment = new Date(raw);
      if (!raw || Number.isNaN(appointment.getTime())) throw new Error("Rescheduling requires a valid date");
      if (appointment.getTime() <= Date.now()) throw new Error("Rescheduling requires a future date");
      if (current.appointment_at && appointment.getTime() === new Date(current.appointment_at).getTime()) {
        throw new Error("Rescheduling requires a new date");
      }
      Object.assign(patch, {
        stage: "rescheduled", interview_result: "pending", appointment_at: appointment.toISOString(),
        reschedule_count: Math.max(0, current.reschedule_count + 1),
      });
      break;
    }
    case "cancel": Object.assign(patch, { stage: "canceled", interview_result: "pending" }); break;
    case "reopen": Object.assign(patch, { stage: "confirmed", interview_result: "pending", unqualified_reason: null }); break;
  }
  return patch;
}

const ACTION_LABELS: Record<InterviewAction, string> = {
  confirm: "Appointment confirmed", qualified: "Marked qualified", follow_up: "Follow-up required",
  hire: "Marked hired", not_hired: "Marked not hired", unqualified: "Marked unqualified",
  no_show: "Marked no show", reschedule: "Rescheduled", cancel: "Appointment canceled",
  reopen: "Interview reopened",
};

async function updateApplicant(req: Request, actor: Actor, body: Record<string, unknown>) {
  const id = typeof body.id === "string" ? body.id : "";
  const action = typeof body.action === "string" ? body.action as InterviewAction : null;
  const expectedVersion = Number(body.expectedVersion);
  if (!id || !action || !ACTIONS.has(action) || !Number.isInteger(expectedVersion) || expectedVersion < 1) {
    return json({ error: "Invalid interview action" }, 400);
  }
  const { data, error } = await admin.from("hh_applicants").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data || data.archived) return json({ error: "Interview not found" }, 404);
  const current = data as ApplicantRow;

  if (actor.role === "va") {
    if (!actor.hhUser || current.va_id !== actor.hhUser.id) return json({ error: "Interview not found" }, 404);
    if (!VA_ACTIONS.has(action)) return json({ error: "Interview outcomes are recruiter or admin actions" }, 403);
  }
  if (!(LEGAL_BY_STAGE[current.stage] ?? []).includes(action)) {
    return json({ error: `${action.replace(/_/g, " ")} is not available from ${current.stage.replace(/_/g, " ")}` }, 422);
  }
  if (action === "hire") {
    const identity = resolveApplicationIdentity(current, buildIdentityMaps(await fetchApplications()));
    if (!identity.applicationId) {
      return json({
        error: identity.identityConflict
          ? "Candidate identity conflicts across APEX applications. Resolve the email, phone, or Instagram match before hiring."
          : "Link an APEX application before hiring so the agent account and onboarding can be created.",
      }, 422);
    }
  }

  let patch: Record<string, unknown>;
  try { patch = patchFor(action, current, body); }
  catch (validationError) {
    return json({ error: validationError instanceof Error ? validationError.message : "Invalid action" }, 422);
  }

  const { data: updated, error: updateError } = await admin.from("hh_applicants")
    .update(patch).eq("id", id).eq("version", expectedVersion).select("*").maybeSingle();
  if (updateError) return json({ error: "Update failed", detail: updateError.message }, 422);
  if (!updated) {
    const { data: latest } = await admin.from("hh_applicants").select("*").eq("id", id).maybeSingle();
    return json({ error: "Someone else updated this interview", current: latest }, 409);
  }

  const changed = Object.entries(patch).filter(([field, value]) => {
    const before = (current as unknown as Record<string, unknown>)[field] ?? null;
    return String(before ?? "") !== String(value ?? "");
  });
  const { error: activityError } = await admin.from("hh_activity").insert(changed.map(([field, value]) => ({
    applicant_id: id,
    user_id: actor.hhUser?.id ?? null,
    user_name: actor.hhUser?.name ?? actor.email,
    action: ACTION_LABELS[action],
    field,
    old_value: String((current as unknown as Record<string, unknown>)[field] ?? ""),
    new_value: String(value ?? ""),
    reason: typeof body.reason === "string" ? body.reason.slice(0, 500) : null,
    ip: (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || null,
    device: (req.headers.get("user-agent") ?? "APEX").slice(0, 500),
  })));

  return json({ applicant: updated, receipt: {
    action, version: updated.version, persistedAt: updated.updated_at,
    activityLogged: !activityError,
    warning: activityError ? "The interview changed, but its activity receipt could not be written." : null,
  }});
}

type ApplicationRow = {
  id: string; email: string | null; phone: string | null; instagram_handle: string | null;
  status: string | null; closed_at: string | null; contracted_at: string | null;
  license_status: string | null; nipr_number: string | null; created_at: string;
};

type ActiveHire = {
  agent_id: string;
  display_name: string;
  email: string | null;
  phone: string | null;
  license_status: string;
  onboarding_stage: string | null;
  hired_at: string;
  contracted_at: string | null;
  first_deal_at: string | null;
  source_application_id: string | null;
};

function buildUniqueMap(rows: ApplicationRow[], key: "email" | "phone" | "instagram") {
  const map = new Map<string, string | null>();
  for (const row of rows) {
    const value = key === "email"
      ? (row.email ?? "").trim().toLowerCase()
      : key === "phone"
        ? normalizedPhone(row.phone)
        : normalizedInstagram(row.instagram_handle);
    if (!value) continue;
    map.set(value, map.has(value) ? null : row.id);
  }
  return map;
}

type IdentityMaps = {
  byEmail: Map<string, string | null>;
  byPhone: Map<string, string | null>;
  byInstagram: Map<string, string | null>;
};

function buildIdentityMaps(rows: ApplicationRow[]): IdentityMaps {
  return {
    byEmail: buildUniqueMap(rows, "email"),
    byPhone: buildUniqueMap(rows, "phone"),
    byInstagram: buildUniqueMap(rows, "instagram"),
  };
}

function resolveApplicationIdentity(row: ApplicantRow, maps: IdentityMaps) {
  const emailId = row.email ? maps.byEmail.get(row.email.trim().toLowerCase()) : undefined;
  const phoneId = row.phone ? maps.byPhone.get(normalizedPhone(row.phone)) : undefined;
  const instagramId = row.instagram ? maps.byInstagram.get(normalizedInstagram(row.instagram)) : undefined;
  const signalIds = Array.from(new Set([emailId, phoneId, instagramId].filter(Boolean) as string[]));
  return {
    applicationId: signalIds.length === 1 ? signalIds[0] : null,
    identityConflict: signalIds.length > 1,
  };
}

const PAGE_SIZE = 1000;

async function fetchApplicants(actor: Actor): Promise<ApplicantRow[]> {
  const rows: ApplicantRow[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    let query = admin.from("hh_applicants")
      .select("id,name,phone,email,instagram,company,appointment_at,stage,interview_result,unqualified_reason,notes,va_id,recruiter_id,version,reschedule_count,created_at,updated_at")
      .eq("archived", false)
      .order("appointment_at", { ascending: true, nullsFirst: false })
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (actor.role === "va" && actor.hhUser) query = query.eq("va_id", actor.hhUser.id);
    const { data, error } = await query;
    if (error) throw error;
    rows.push(...((data ?? []) as ApplicantRow[]));
    if ((data?.length ?? 0) < PAGE_SIZE) return rows;
  }
}

async function fetchApplications(): Promise<ApplicationRow[]> {
  const rows: ApplicationRow[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await admin.from("applications")
      .select("id,email,phone,instagram_handle,status,closed_at,contracted_at,license_status,nipr_number,created_at")
      .eq("record_type", "application")
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    rows.push(...((data ?? []) as ApplicationRow[]));
    if ((data?.length ?? 0) < PAGE_SIZE) return rows;
  }
}

function phoenixMonthStartIso(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Phoenix", year: "numeric", month: "2-digit",
  }).formatToParts(now);
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  // Phoenix is UTC-7 year-round. This is the exact UTC instant at local month start.
  return new Date(Date.UTC(year, month - 1, 1, 7)).toISOString();
}

async function fetchActiveHires(): Promise<ActiveHire[]> {
  const { data: agents, error } = await admin.from("agents")
    .select("id,display_name,profile_id,license_status,onboarding_stage,created_at,contracted_at,first_deal_at,source_application_id")
    .eq("status", "active")
    .is("canonical_agent_id", null)
    .or("is_deactivated.is.null,is_deactivated.eq.false")
    .or("is_inactive.is.null,is_inactive.eq.false")
    .gte("created_at", phoenixMonthStartIso())
    .order("created_at", { ascending: false })
    .limit(250);
  if (error) throw error;

  const profileIds = Array.from(new Set((agents ?? []).map((row) => row.profile_id).filter(Boolean) as string[]));
  const profiles = new Map<string, { full_name: string | null; email: string | null; phone: string | null }>();
  if (profileIds.length) {
    const { data, error: profileError } = await admin.from("profiles")
      .select("id,full_name,email,phone")
      .in("id", profileIds);
    if (profileError) throw profileError;
    for (const profile of data ?? []) profiles.set(profile.id as string, profile as { full_name: string | null; email: string | null; phone: string | null });
  }

  return (agents ?? []).map((row) => {
    const profile = row.profile_id ? profiles.get(row.profile_id as string) : null;
    return {
      agent_id: row.id as string,
      display_name: (row.display_name || profile?.full_name || "Name not on file") as string,
      email: profile?.email ?? null,
      phone: profile?.phone ?? null,
      license_status: String(row.license_status ?? "unlicensed"),
      onboarding_stage: row.onboarding_stage ? String(row.onboarding_stage) : null,
      hired_at: row.created_at as string,
      contracted_at: row.contracted_at as string | null,
      first_deal_at: row.first_deal_at as string | null,
      source_application_id: row.source_application_id as string | null,
    };
  });
}

async function listApplicants(actor: Actor) {
  const [rows, mainRows, activeHires] = await Promise.all([fetchApplicants(actor), fetchApplications(), fetchActiveHires()]);
  const counts: Record<string, number> = {};
  for (const row of rows) counts[row.stage] = (counts[row.stage] ?? 0) + 1;

  const ownerIds = Array.from(new Set(rows.flatMap((row) => [row.va_id, row.recruiter_id]).filter(Boolean) as string[]));
  const owners: Record<string, string> = {};
  if (ownerIds.length) {
    const { data: users } = await admin.from("hh_users").select("id,name,email").in("id", ownerIds);
    for (const user of users ?? []) owners[user.id as string] = (user.name || user.email || "") as string;
  }

  const identityMaps = buildIdentityMaps(mainRows);
  const mainById = new Map(mainRows.map((row) => [row.id, row]));
  const applicantsOut = rows.map((row) => {
    const { applicationId, identityConflict } = resolveApplicationIdentity(row, identityMaps);
    const application = applicationId ? mainById.get(applicationId) : null;
    const onboardingStatus = !application ? "application_link_needed"
      : application.contracted_at ? "contracted"
      : application.closed_at || application.status === "hired" ? "hired" : "ready_to_promote";
    return {
      ...row,
      va_name: row.va_id ? owners[row.va_id] ?? null : null,
      recruiter_name: row.recruiter_id ? owners[row.recruiter_id] ?? null : null,
      application_id: applicationId,
      onboarding_status: onboardingStatus,
      application_license_status: application?.license_status ?? null,
      application_npn: application?.nipr_number ?? null,
      identity_conflict: identityConflict,
    };
  });
  return json({
    applicants: applicantsOut,
    activeHires,
    counts,
    total: rows.length,
    role: actor.role,
    generatedAt: new Date().toISOString(),
  });
}

// Lane 3 (2026-08-26): onboarding calls are Calendly bookings on the
// "APEX Onboarding Call" event type, stored in interview_events with
// call_track = 'onboarding' (views in migration 20260826052000). Every staff
// role sees the calls; the backfill list (licensed hires with no call) is for
// executives and recruiters — it is a count plus a per-person action, never a
// mass send.
async function listOnboardingCalls(actor: Actor) {
  type Res = { data: unknown[] | null; error: { message: string } | null };
  const [calls, truth, gaps] = await Promise.all([
    admin.from("v_onboarding_calls").select("*").order("scheduled_at", { ascending: false }).limit(500) as unknown as Promise<Res>,
    admin.from("v_onboarding_call_truth").select("*").limit(1) as unknown as Promise<Res>,
    actor.role === "va"
      ? Promise.resolve<Res>({ data: [], error: null })
      : admin.from("v_onboarding_call_gaps").select("*").order("licensed_at", { ascending: false, nullsFirst: false }).limit(200) as unknown as Promise<Res>,
  ]);
  if (calls.error) throw new Error(`onboarding calls: ${calls.error.message}`);
  if (truth.error) throw new Error(`onboarding truth: ${truth.error.message}`);
  if (gaps.error) throw new Error(`onboarding gaps: ${gaps.error.message}`);
  return json({
    calls: calls.data ?? [],
    truth: (truth.data ?? [])[0] ?? null,
    gaps: gaps.data ?? [],
    role: actor.role,
    generatedAt: new Date().toISOString(),
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "GET" && req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "Allow": "GET, POST, OPTIONS", ...corsHeaders },
    });
  }
  try {
    const actor = await authenticate(req);
    if (actor instanceof Response) return actor;
    const body = req.method === "POST"
      ? await req.json().catch(() => ({} as Record<string, unknown>)) as Record<string, unknown>
      : {};
    if (body.action) return await updateApplicant(req, actor, body);
    if (body.list === "onboarding_calls") return await listOnboardingCalls(actor);
    return await listApplicants(actor);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "error" }, 500);
  }
});
