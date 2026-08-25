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

function buildUniqueMap(rows: Array<{ id: string; email: string | null; phone: string | null }>, key: "email" | "phone") {
  const map = new Map<string, string | null>();
  for (const row of rows) {
    const value = key === "email" ? (row.email ?? "").trim().toLowerCase() : normalizedPhone(row.phone);
    if (!value) continue;
    map.set(value, map.has(value) ? null : row.id);
  }
  return map;
}

async function listApplicants(actor: Actor) {
  let query = admin.from("hh_applicants")
    .select("id,name,phone,email,instagram,company,appointment_at,stage,interview_result,unqualified_reason,notes,va_id,recruiter_id,version,reschedule_count,created_at,updated_at")
    .eq("archived", false).order("appointment_at", { ascending: true, nullsFirst: false }).limit(2000);
  if (actor.role === "va" && actor.hhUser) query = query.eq("va_id", actor.hhUser.id);

  const [{ data: applicants, error }, { data: applicationRows, error: applicationsError }] = await Promise.all([
    query,
    admin.from("applications").select("id,email,phone,status,closed_at,contracted_at,license_status,nipr_number").eq("record_type", "application").limit(2000),
  ]);
  if (error) throw error;
  if (applicationsError) throw applicationsError;
  const rows = (applicants ?? []) as ApplicantRow[];
  const counts: Record<string, number> = {};
  for (const row of rows) counts[row.stage] = (counts[row.stage] ?? 0) + 1;

  const ownerIds = Array.from(new Set(rows.flatMap((row) => [row.va_id, row.recruiter_id]).filter(Boolean) as string[]));
  const owners: Record<string, string> = {};
  if (ownerIds.length) {
    const { data: users } = await admin.from("hh_users").select("id,name,email").in("id", ownerIds);
    for (const user of users ?? []) owners[user.id as string] = (user.name || user.email || "") as string;
  }

  const mainRows = (applicationRows ?? []) as Array<{
    id: string; email: string | null; phone: string | null; status: string | null;
    closed_at: string | null; contracted_at: string | null;
    license_status: string | null; nipr_number: string | null;
  }>;
  const byEmail = buildUniqueMap(mainRows, "email");
  const byPhone = buildUniqueMap(mainRows, "phone");
  const mainById = new Map(mainRows.map((row) => [row.id, row]));
  const applicantsOut = rows.map((row) => {
    const emailId = row.email ? byEmail.get(row.email.trim().toLowerCase()) : undefined;
    const phoneId = row.phone ? byPhone.get(normalizedPhone(row.phone)) : undefined;
    const applicationId = emailId && phoneId && emailId !== phoneId ? null : (emailId || phoneId || null);
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
    };
  });
  return json({ applicants: applicantsOut, counts, total: rows.length, role: actor.role, generatedAt: new Date().toISOString() });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const actor = await authenticate(req);
    if (actor instanceof Response) return actor;
    const body = req.method === "POST"
      ? await req.json().catch(() => ({} as Record<string, unknown>)) as Record<string, unknown>
      : {};
    if (body.action) return await updateApplicant(req, actor, body);
    return await listApplicants(actor);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "error" }, 500);
  }
});
