// APEX contracting intake submission.
//
// The one public write path into public.contracting_intakes. It is public on
// purpose — Sam shares this link with producers who have no APEX login — so the
// controls that matter are in this file and in the RPC, not in a JWT check:
//
//   * exactly five accepted fields; every other key in the body is discarded
//     before the value reaches the database
//   * per-IP rate limiting
//   * a honeypot field that real humans never fill in
//   * all normalization, validation, dedupe and enqueue happen inside
//     submit_contracting_intake(), which is service-role only, so the shape of
//     the request cannot widen what actually gets written
//
// It answers with the intake id and durable status. It never reports that the
// contracting spreadsheet or private Discord delivery happened at enqueue
// time; the dispatcher owns those two receipts.

// Pinned to 2.90.1 to match apex-outbox-dispatcher, which is verified alive in
// production. NOT a cosmetic version bump: this function shipped on 2.50.0 and
// returned WORKER_ERROR on every request — dead at boot, before the handler ran.
// esm.sh resolves transitive dependencies at request time, so pinning
// supabase-js pins nothing underneath it, and the 2.50.0 dependency graph
// currently fails to boot on this project. Probed live: submit-application
// (2.90.1) answers 400, applicant-checkin (2.50.0) returns the identical
// WORKER_ERROR. 41 functions in this repo are still on 2.50.0 — a wider
// pre-existing outage, tracked separately, not fixed by this release.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.90.1";
import { corsHeaders, jsonResponse, errorResponse } from "../_shared/cors.ts";
import {
  honeypotResponseBody,
  isHoneypotTripped,
  pickAcceptedFields,
  rateLimitVerdict,
} from "../_shared/intake-guard.ts";
import { findAuthUserByEmail, type AuthUserLister } from "../_shared/find-auth-user.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const DEFAULT_MANAGER_ID = "7c3c5581-3544-437f-bfe2-91391afb217d";

async function provisionOnboarding(
  // supabase-js does not carry this project's generated database schema inside
  // edge functions, so an inferred generic collapses table writes to `never`.
  // Runtime validation remains in Postgres; keep this boundary SDK-agnostic.
  sb: any,
  payload: { first_name: string; last_name: string; email: string; phone: string; npn: string },
) {
  const email = payload.email.trim().toLowerCase();
  const fullName = `${payload.first_name.trim()} ${payload.last_name.trim()}`.trim();
  const authLookup = await findAuthUserByEmail(sb as unknown as AuthUserLister, email);
  if (!authLookup.exhaustive) throw new Error("account_lookup_incomplete");

  let userId = authLookup.user?.id ?? null;
  if (!userId) {
    const { data: created, error } = await sb.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { full_name: fullName, source: "contracting_one_link" },
    });
    if (error || !created.user) throw new Error(error?.message ?? "account_create_failed");
    userId = created.user.id;
  }

  const { data: profile, error: profileError } = await sb
    .from("profiles")
    .upsert({ user_id: userId, email, phone: payload.phone, full_name: fullName }, { onConflict: "user_id" })
    .select("id")
    .single();
  if (profileError || !profile?.id) throw new Error(profileError?.message ?? "profile_create_failed");

  const { error: roleError } = await sb
    .from("user_roles")
    .upsert({ user_id: userId, role: "agent" }, { onConflict: "user_id,role", ignoreDuplicates: true });
  if (roleError) throw new Error(roleError.message);

  const { data: existing, error: existingError } = await sb
    .from("agents")
    .select("id,manager_id,invited_by_manager_id")
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (existingError) throw new Error(existingError.message);

  let agentId = existing?.id ?? null;
  const agentPatch = {
    user_id: userId,
    profile_id: profile.id,
    display_name: fullName,
    status: "active",
    license_status: "licensed",
    onboarding_stage: "onboarding",
    has_training_course: true,
    nipr_number: payload.npn,
    manager_id: existing?.manager_id ?? DEFAULT_MANAGER_ID,
    invited_by_manager_id: existing?.invited_by_manager_id ?? DEFAULT_MANAGER_ID,
    start_date: new Date().toISOString().slice(0, 10),
  };

  if (agentId) {
    const { error } = await sb.from("agents").update(agentPatch).eq("id", agentId);
    if (error) throw new Error(error.message);
  } else {
    const { data: inserted, error } = await sb.from("agents").insert(agentPatch).select("id").single();
    if (error || !inserted?.id) throw new Error(error?.message ?? "agent_create_failed");
    agentId = inserted.id;
  }

  return { agentId };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return errorResponse("POST only", 405, "METHOD_NOT_ALLOWED");
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return errorResponse("Server configuration missing", 503, "NOT_CONFIGURED");
  }

  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return errorResponse("A JSON body is required", 400, "VALIDATION_ERROR");
  }
  if (!body || typeof body !== "object") {
    return errorResponse("A JSON body is required", 400, "VALIDATION_ERROR");
  }

  // Honeypot. Hidden in the form and never focusable, so anything in it came
  // from something automating the page.
  //
  // It must NOT answer `status: "accepted"`. Nothing was accepted — there is no
  // intake row, no id, and no queued work — and a client that believes the word
  // will show a producer a success screen for a
  // submission that does not exist. That is fake success aimed at ourselves. A
  // 202 with an explicit null id and no continuation is opaque to a bot (it
  // learns nothing from the status code) while remaining literally true.
  if (isHoneypotTripped(body)) {
    return jsonResponse(honeypotResponseBody(), 202);
  }

  const ip =
    req.headers.get("cf-connecting-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown";

  const { data: allowed, error: rateError } = await sb.rpc("check_rate_limit", {
    _bucket_key: `submit-contracting-intake:${ip}`,
    _max_requests: 8,
    _window_seconds: 300,
  });
  const verdict = rateLimitVerdict({ allowed, error: rateError });
  // FAIL CLOSED. This is an unauthenticated write endpoint, so the rate limiter
  // is the only thing standing between the open internet and unbounded inserts.
  // The shared _shared/rateLimit.ts helper logs and allows on error, which is a
  // defensible default for an authenticated endpoint and the wrong one here:
  // whatever broke the limiter is exactly when someone is hammering it, and
  // "allow everything while the brake is broken" is how a public form becomes a
  // spam sink. NPN dedupe does not save us either — an attacker picks a fresh
  // NPN per request. 503 is honest and retryable.
  if (verdict === "reject_unavailable") {
    console.error("[submit-contracting-intake] rate limiter unavailable:", rateError?.message);
    return errorResponse(
      "Submissions are temporarily unavailable. Try again shortly.",
      503,
      "RATE_LIMIT_UNAVAILABLE",
    );
  }
  if (verdict === "reject_rate_limited") {
    return errorResponse("Too many submissions. Try again in a few minutes.", 429, "RATE_LIMIT");
  }

  const payload = pickAcceptedFields(body);

  const { data, error } = await sb.rpc("submit_contracting_intake", {
    p_first_name: payload.first_name,
    p_last_name: payload.last_name,
    p_email: payload.email,
    p_phone: payload.phone,
    p_npn: payload.npn,
    p_source: "apex_contracting_page",
    p_submitted_by: null,
  });

  if (error) {
    console.error("[submit-contracting-intake] rpc failed:", error.message);
    return errorResponse("The submission could not be recorded. Try again.", 502, "INTAKE_FAILED");
  }

  const result = data as {
    ok: boolean;
    intake_id?: string;
    status?: string;
    review_reason?: string | null;
    replay?: boolean;
    error?: string;
    field?: string;
  };

  if (!result?.ok) {
    return errorResponse(result?.error ?? "validation_failed", 400, "VALIDATION_ERROR", {
      field: result?.field ?? null,
    });
  }

  // Submission is the activation event. Create/repair the licensed producer's
  // account and issue a one-click course login in this same request. Only an
  // identity collision is held; auto-login would otherwise expose one
  // producer's account to another.
  let onboarding: { agentId: string } | null = null;
  let onboardingEmailSent = false;
  if (result.status !== "needs_review") {
    try {
      onboarding = await provisionOnboarding(sb, payload);
      // The public intake proves possession of an NPN, not possession of the
      // email account. Send the one-click course login to that inbox instead
      // of returning an authentication bearer token to an unauthenticated
      // browser. The recruit still moves immediately; account access stays
      // protected by email ownership.
      const courseResponse = await fetch(`${SUPABASE_URL}/functions/v1/send-course-enrollment-email`, {
        method: "POST",
        headers: { authorization: `Bearer ${SERVICE_KEY}`, "content-type": "application/json" },
        body: JSON.stringify({ agentId: onboarding.agentId }),
      });
      let courseResult: Record<string, unknown> | null = null;
      try {
        courseResult = await courseResponse.json();
      } catch (courseParseError) {
        console.error("[submit-contracting-intake] course response was not JSON:", courseParseError);
      }
      if (!courseResponse.ok || courseResult?.success !== true) {
        throw new Error(String(courseResult?.message ?? `course email returned ${courseResponse.status}`));
      }
      onboardingEmailSent = true;
    } catch (provisionError) {
      console.error("[submit-contracting-intake] onboarding provisioning failed:", provisionError);
      return jsonResponse({ ok: false, error: "onboarding_provision_failed", intake_id: result.intake_id }, 502);
    }
  }

  // Deliver this intake immediately. The cron is recovery, not the normal
  // recruit experience. The filtered claim prevents unrelated work from being
  // drained by a public submission.
  let delivery: Record<string, unknown> | null = null;
  try {
    const dispatch = await fetch(`${SUPABASE_URL}/functions/v1/apex-outbox-dispatcher`, {
      method: "POST",
      headers: { authorization: `Bearer ${SERVICE_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ contractingIntakeId: result.intake_id }),
    });
    try {
      delivery = await dispatch.json();
    } catch (dispatchParseError) {
      console.error("[submit-contracting-intake] dispatcher response was not JSON:", dispatchParseError);
    }
    if (!dispatch.ok) console.error("[submit-contracting-intake] immediate dispatch failed", dispatch.status, delivery);
  } catch (dispatchError) {
    console.error("[submit-contracting-intake] immediate dispatch unavailable:", dispatchError);
  }

  return jsonResponse({
    ok: true,
    intake_id: result.intake_id,
    status: result.status,
    review_reason: result.review_reason ?? null,
    replay: result.replay ?? false,
    agent_id: onboarding?.agentId ?? null,
    onboarding_ready: Boolean(onboarding?.agentId && onboardingEmailSent),
    onboarding_email_sent: onboardingEmailSent,
    delivery,
  });
});
