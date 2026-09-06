import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
// 2026-08-17: bumped off supabase-js@2.50.0 — esm.sh resolves transitive deps at
// request time, so that pin pinned nothing underneath it and now fails to resolve
// ws's optional native deps (bufferutil / utf-8-validate). The function died at
// BOOT, before the handler, so every call 500d and nothing recorded a reason.
// Measured 2026-08-17: send-notification 903/903 failures in 24h, poke-pusher
// 164/164, metricool-sync 3/3 — zero 200s. 2.90.1 is the version proven booting.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.90.1";
import { corsHeaders } from "../_shared/cors.ts";
import { getBusinessDayKey } from "../_shared/apex.ts";

const LICENSE_PROGRESS_VALUES = new Set([
  "unlicensed",
  "course_purchased",
  "finished_course",
  "test_scheduled",
  "passed_test",
  "fingerprints_done",
  "waiting_on_license",
  "licensed",
]);

function normalizeProgress(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return LICENSE_PROGRESS_VALUES.has(normalized) ? normalized : null;
}

function cleanText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );

  try {
    const body = await req.json().catch(() => ({}));
    const action = body.action ?? "load";
    const applicationId = typeof body.applicationId === "string" ? body.applicationId : null;

    if (!applicationId) {
      return new Response(
        JSON.stringify({ error: "Missing applicationId" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { data: application, error: appError } = await supabase
      .from("applications")
      .select(`
        id,
        first_name,
        last_name,
        email,
        license_status,
        license_progress,
        test_scheduled_date,
        course_purchased_at,
        exam_scheduled_at,
        exam_passed_at,
        fingerprints_submitted_at,
        licensed_at,
        hiring_manager_user_id,
        closed_at,
        terminated_at
      `)
      .eq("id", applicationId)
      .maybeSingle();

    if (appError) throw appError;
    if (!application || application.closed_at || application.terminated_at) {
      return new Response(
        JSON.stringify({ error: "Application not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const todayKey = getBusinessDayKey();

    if (action === "load") {
      const { data: existingCheckin } = await supabase
        .from("applicant_checkins")
        .select("id, license_progress, study_hours, needs_help, blocker, notes, test_scheduled, test_date")
        .eq("application_id", applicationId)
        .eq("checkin_date", todayKey)
        .maybeSingle();

      return new Response(
        JSON.stringify({
          ok: true,
          application: {
            id: application.id,
            firstName: application.first_name,
            lastName: application.last_name,
            // MP-448: `state` removed. applications.state holds a US state (WI,
            // TX, FL...), this endpoint is verify_jwt=false and reads no
            // credential, and ApplicantCheckin.tsx declared the field but
            // rendered only firstName. Same defect as check-email-status: a
            // person's location handed to an uncredentialed caller with no
            // product asking for it.
            email: application.email,
            licenseStatus: application.license_status,
            licenseProgress: application.license_progress ?? "unlicensed",
            testScheduledDate: application.test_scheduled_date,
          },
          checkinDate: todayKey,
          existingCheckin,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (action !== "submit") {
      return new Response(
        JSON.stringify({ error: "Unsupported action" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const licenseProgress = normalizeProgress(body.licenseProgress) ?? application.license_progress ?? "unlicensed";
    const studyHours = Number.isFinite(Number(body.studyHours)) ? Math.max(0, Math.min(16, Number(body.studyHours))) : null;
    const needsHelp = Boolean(body.needsHelp);
    const blocker = cleanText(body.blocker, 280);
    const notes = cleanText(body.notes, 1000);
    const testScheduled = Boolean(body.testScheduled);
    const testDate = cleanText(body.testDate, 32);
    const nowIso = new Date().toISOString();

    const { data: existingCheckin } = await supabase
      .from("applicant_checkins")
      .select("id")
      .eq("application_id", applicationId)
      .eq("checkin_date", todayKey)
      .maybeSingle();

    const checkinPayload = {
      application_id: applicationId,
      checkin_date: todayKey,
      license_progress: licenseProgress,
      study_hours: studyHours,
      needs_help: needsHelp,
      blocker,
      notes,
      test_scheduled: testScheduled,
      test_date: testDate,
      help_notified_at: needsHelp ? nowIso : null,
    };

    if (existingCheckin?.id) {
      const { error } = await supabase
        .from("applicant_checkins")
        .update(checkinPayload)
        .eq("id", existingCheckin.id);
      if (error) throw error;
    } else {
      const { error } = await supabase
        .from("applicant_checkins")
        .insert(checkinPayload);
      if (error) throw error;
    }

    const applicationPatch: Record<string, unknown> = {
      license_progress: licenseProgress,
      updated_at: nowIso,
      last_contacted_at: nowIso,
      next_action_at: needsHelp ? nowIso : application.test_scheduled_date,
      next_action_type: needsHelp ? "licensing_help" : null,
    };

    if (licenseProgress === "course_purchased" && !application.course_purchased_at) {
      applicationPatch.course_purchased_at = nowIso;
    }
    if (licenseProgress === "test_scheduled" && !application.exam_scheduled_at) {
      applicationPatch.exam_scheduled_at = nowIso;
    }
    if (licenseProgress === "passed_test" && !application.exam_passed_at) {
      applicationPatch.exam_passed_at = nowIso;
    }
    if (licenseProgress === "fingerprints_done" && !application.fingerprints_submitted_at) {
      applicationPatch.fingerprints_submitted_at = nowIso;
      applicationPatch.fingerprint_done = true;
    }
    if (licenseProgress === "licensed") {
      applicationPatch.license_status = "licensed";
      applicationPatch.licensed_at = application.licensed_at || nowIso;
    }
    if (testScheduled && testDate) {
      applicationPatch.test_scheduled_date = testDate;
      applicationPatch.exam_scheduled_at = application.exam_scheduled_at || nowIso;
    }

    const { error: updateError } = await supabase
      .from("applications")
      .update(applicationPatch)
      .eq("id", applicationId);

    if (updateError) throw updateError;

    if (needsHelp && application.hiring_manager_user_id) {
      await supabase.from("agent_tasks").insert({
        agent_id: null,
        assigned_by: application.hiring_manager_user_id,
        title: `Licensing help needed: ${application.first_name} ${application.last_name}`,
        description: blocker
          ? `${application.first_name} requested help during their daily check-in. Blocker: ${blocker}`
          : `${application.first_name} requested help during their daily check-in.`,
        task_type: "licensing_followup",
        priority: "high",
        due_date: todayKey,
      }).catch((error) => {
        console.warn("[applicant-checkin] failed to create manager task:", error);
      });
    }

    return new Response(
      JSON.stringify({ ok: true, checkinDate: todayKey }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
