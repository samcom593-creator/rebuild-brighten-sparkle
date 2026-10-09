// MP-233 / MP-234: consume-invite-token
//
// Public (verify_jwt = false). Token acts as the bearer credential.
// One-use, atomic, service-role write.
//
// Two kinds handled:
//   - kind='hire' — creates auth user + agents row (existing behavior).
//   - kind='join' — creates an APPLICATION (no auth user, no agent).
//                   Existing triggers on public.applications then fire:
//                     * license_status='unlicensed' → trg_calendly_for_unlicensed_ins
//                       enqueues the applicant onboarding email.
//                     * license_status='licensed'   → trg_bot_alert_licensed_app
//                       fires the manager/Sam critical alert.
//                   Optional `licensed: true` on the body flips the row licensed;
//                   otherwise defaults to 'unlicensed' (prospect capture flow).
//
// Anti-fake-success rule (Sam directive, 465 InsuraCloud memory):
//   Never return {ok:true} unless the underlying row (agents for hire,
//   applications for join) exists AND invite_tokens.used_at is set.
//
// §8 invitation lifecycle (20261006140000_invitation_lifecycle.sql):
//   * The token is CLAIMED atomically by invitation_claim() (row lock + a
//     3-minute lease). Status (pending/accepted/expired/revoked/superseded) and
//     the recipient restriction are decided there, server-side, from the row.
//     A second concurrent submit gets invite_in_progress, never a second person.
//   * Every refusal after the claim releases the lease (invitation_release) so
//     the recruit can retry immediately; a crash just lets the lease lapse.
//   * Offered terms come from the ROW, never from the URL or this body:
//     invitation_apply_terms() writes the offered comp to agents.comp_percentage
//     BEFORE the contracting intake so the intake snapshots the offer.
//     Carrier-confirmed comp (agent_contract_levels) is never touched here.
//   * invitation_complete() is the single-use stamp (used_at IS NULL + the
//     matching claim id) and records the accepted-terms snapshot.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { findAuthUserByEmail, type AuthUserLister } from "../_shared/find-auth-user.ts";
import { nanpTenDigits, nanpRefusalReason } from "../_shared/nanp-phone.ts";
import { postNtfyGraded } from "../_shared/ntfy-post.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const NTFY_TOPIC =
  Deno.env.get("APEX_NTFY_TOPIC") ??
  "sams-agent-yrkv9kbqp9e987nb";

interface ConsumeBody {
  token: string;
  full_name: string;
  phone: string;
  email: string;
  state?: string;
  licensed?: boolean;
  nipr_number?: string;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function digitsOnly(s: string) {
  return (s || "").replace(/\D+/g, "");
}

function ntfyPush(title: string, message: string) {
  // Fire-and-forget; do not block the response on this. But fire-and-forget is
  // not the same as outcome-blind: `.catch(() => {})` only ever sees a TRANSPORT
  // failure, so an HTTP 429 quota refusal resolved normally and vanished. The
  // push is still not awaited by the caller — the refusal is now logged.
  void postNtfyGraded(`https://ntfy.sh/${NTFY_TOPIC}`, {
    title,
    body: message,
    priority: "high",
  }).then((r) => {
    if (!r.ok) console.error(`[consume-invite-token] ntfy push refused: ${r.receipt}`);
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ ok: false, error: "method_not_allowed" }, 405);
  }

  let body: ConsumeBody;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }

  const token = (body.token || "").trim();
  const full_name = (body.full_name || "").trim();
  const phone_digits = digitsOnly(body.phone || "");
  const email = (body.email || "").trim().toLowerCase();
  let nipr_number = digitsOnly(body.nipr_number || "") || null;

  if (!token || token.length < 8) {
    return json({ ok: false, error: "invalid_token" }, 400);
  }
  if (full_name.split(/\s+/).filter(Boolean).length < 2) {
    return json({ ok: false, error: "name_too_short" }, 422);
  }
  if (phone_digits.length < 10) {
    return json({ ok: false, error: "phone_too_short" }, 422);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ ok: false, error: "invalid_email" }, 422);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // 1. Claim the invitation. Validation, recipient restriction and the
  //    single-flight lease all live in SQL so they hold under concurrency.
  type ClaimedInvitation = {
    id: string;
    kind: string;
    target_role: string | null;
    target_manager_id: string | null;
    created_by: string | null;
    prefill_json: Record<string, unknown> | null;
    offered_comp_pct: number | null;
  };
  const { data: claimData, error: claimErr } = await admin.rpc("invitation_claim", {
    p_token: token,
    p_email: email,
  });
  if (claimErr) {
    console.error("invitation_claim_failed", claimErr);
    return json({ ok: false, error: "lookup_failed" }, 500);
  }
  const claim = (claimData ?? {}) as {
    ok?: boolean;
    error?: string;
    email_hint?: string;
    claim_id?: string;
    invitation?: ClaimedInvitation;
  };
  if (claim.ok !== true || !claim.claim_id || !claim.invitation?.id) {
    const code = claim.error ?? "invite_invalid";
    return json(
      code === "recipient_mismatch"
        ? { ok: false, error: code, email_hint: claim.email_hint ?? null }
        : { ok: false, error: code },
      409,
    );
  }
  const tokenRow = claim.invitation as ClaimedInvitation;
  const claimId = claim.claim_id as string;

  // Every non-success response below releases the lease so a corrected retry
  // is not locked out for three minutes. The release is guarded by the claim
  // id, so it can never reopen an invitation that was completed.
  let response: Response;
  try {
    response = await acceptClaimed();
  } catch (e) {
    console.error("invite_accept_threw", e);
    response = json({ ok: false, error: "internal_error" }, 500);
  }
  if (response.status !== 200) {
    const { error: releaseErr } = await admin.rpc("invitation_release", {
      p_invitation_id: tokenRow.id,
      p_claim_id: claimId,
    });
    if (releaseErr) console.error("invitation_release_failed", releaseErr);
  }
  return response;

  async function acceptClaimed(): Promise<Response> {
  if (tokenRow.kind !== "hire" && tokenRow.kind !== "join") {
    return json(
      { ok: false, error: "unsupported_kind", detail: tokenRow.kind },
      400,
    );
  }

  // Resolve the upline once and fail closed when a manager-scoped token points
  // at a missing/deactivated row. Silently falling back to the default manager
  // makes the recruit disappear from the link creator's account.
  let targetManager: { id: string; user_id: string | null } | null = null;
  // A personal Add Agent link defaults to the creator when no explicit upline
  // was selected. Null must never mean “create an orphan recruit.”
  const resolvedManagerId = tokenRow.target_manager_id ?? tokenRow.created_by ?? null;
  if (resolvedManagerId) {
    const { data: managerRow, error: managerErr } = await admin
      .from("agents")
      .select("id, user_id, is_deactivated")
      .eq("id", resolvedManagerId)
      .maybeSingle();

    if (managerErr) {
      console.error("target_manager_lookup_failed", managerErr);
      return json({ ok: false, error: "target_manager_lookup_failed" }, 500);
    }
    if (!managerRow?.id || managerRow.is_deactivated === true) {
      return json({ ok: false, error: "target_manager_unavailable" }, 409);
    }
    targetManager = { id: managerRow.id, user_id: managerRow.user_id };
  }

  // ─── kind='join' branch ────────────────────────────────────────────────
  // Prospect capture: creates a public.applications row and lets the
  // existing DB triggers fan out (applicant onboarding email for
  // unlicensed; licensed_app_arrived alert for licensed).
  if (tokenRow.kind === "join") {
    const nameParts = full_name.split(/\s+/).filter(Boolean);
    const first_name = nameParts[0] ?? "";
    const last_name = nameParts.slice(1).join(" ") || nameParts[0] || "";
    const licensedJoin = body.licensed === true;
    const state = (body.state || "").trim().toUpperCase().slice(0, 2) || null;

    const { data: appRow, error: appErr } = await admin
      .from("applications")
      .insert({
        first_name,
        last_name,
        email,
        phone: phone_digits,
        state,
        license_status: licensedJoin ? "licensed" : "unlicensed",
        nipr_number,
        status: "new",
        assigned_agent_id: targetManager?.id ?? null,
        referral_manager_id: targetManager?.id ?? null,
        recruiter_id: targetManager?.id ?? null,
        hiring_manager_user_id: targetManager?.user_id ?? null,
        referral_source: `magic_join_link:${(tokenRow.created_by ?? "unknown").toString().slice(0, 8)}`,
      })
      .select("id")
      .single();

    if (appErr || !appRow?.id) {
      console.error("application_insert_failed", appErr);
      return json(
        { ok: false, error: "application_insert_failed", detail: appErr?.message },
        500,
      );
    }

    // Single-use stamp. Only a completed claim is a success.
    const { data: joinDone, error: joinDoneErr } = await admin.rpc("invitation_complete", {
      p_invitation_id: tokenRow.id,
      p_claim_id: claimId,
      p_email: email,
      p_application_id: appRow.id,
    });
    if (joinDoneErr) {
      console.error("token_mark_failed_join", joinDoneErr);
      return json({ ok: false, error: "token_mark_failed" }, 500);
    }
    if ((joinDone as { ok?: boolean } | null)?.ok !== true) {
      console.warn("token_race_lost_join", tokenRow.id);
      return json({ ok: false, error: (joinDone as { error?: string } | null)?.error ?? "invite_already_used" }, 409);
    }

    ntfyPush(
      licensedJoin ? "LICENSED prospect via join link" : "New prospect via join link",
      `${full_name} · ${email} · ${licensedJoin ? "licensed" : "unlicensed"} · token …${token.slice(-4)}`,
    );

    return json({
      ok: true,
      kind: "join",
      application_id: appRow.id,
      licensed: licensedJoin,
      redirect_url: `/status/${appRow.id}`,
    });
  }

  // ─── kind='hire' branch (existing) ─────────────────────────────────────
  const targetRole: string = tokenRow.target_role ?? "hired_unlicensed";
  const lockedLicenseStatus = tokenRow.prefill_json?.license_status_locked === true
    && ["licensed", "unlicensed"].includes(String(tokenRow.prefill_json?.license_status ?? ""))
    ? String(tokenRow.prefill_json?.license_status)
    : null;
  // Add Agent path links are intentionally locked. Older generic links remain
  // backward-compatible and still accept the recruit's explicit answer.
  let licensed = lockedLicenseStatus
    ? lockedLicenseStatus === "licensed"
    : typeof body.licensed === "boolean"
      ? body.licensed
      : targetRole === "hired_licensed";
  if (licensed && (!nipr_number || !/^\d{5,10}$/.test(nipr_number))) {
    return json({ ok: false, error: "npn_required_for_licensed_hire" }, 422);
  }

  // 2. Resolve identity before creating anything. A licensed hire may be the
  //    same person who joined while unlicensed; email, profile, auth user, and
  //    NPN are identity signals for an in-place upgrade, not permission to mint
  //    a second agent/account.
  //    listUsers has no server-side email filter, so this pages until it finds
  //    the address or reaches the end of the table. It used to read one page of
  //    200 under a comment saying "small-N lookup is fine while we're early" —
  //    accurate when written, false by 2026-08-12 when auth.users held 531 rows.
  //    Past row 200 the dedupe silently saw nothing and minted a second account.
  //    A comment cannot notice that it has expired; the pagination can't expire.
  let authUserId: string | null = null;
  try {
    // This function's newer supabase-js release types rpc() as a thenable
    // PostgREST builder; the shared helper intentionally stays SDK-agnostic.
    const authLookup = await findAuthUserByEmail(admin as unknown as AuthUserLister, email);
    if (!authLookup.exhaustive) {
      console.error("auth_lookup_incomplete", { email, pagesScanned: authLookup.pagesScanned });
      return json({ ok: false, error: "lookup_failed" }, 500);
    }
    if (authLookup.user) authUserId = authLookup.user.id;
  } catch (e) {
    // The old code logged the list failure and carried on with "not found",
    // which turns a transient auth outage into a duplicate account. A dedupe
    // check that cannot read is unknown, not negative.
    console.error("auth_list_failed", e);
    return json({ ok: false, error: "lookup_failed" }, 500);
  }

  type ExistingAgent = {
    id: string;
    user_id: string | null;
    profile_id: string | null;
    status: string | null;
    license_status: string | null;
    license_progress: string | null;
    onboarding_stage: string | null;
    canonical_agent_id: string | null;
    nipr_number: string | null;
  };
  // agents.license_progress is read and written below. MEASURED 2026-08-25:
  // the 041000 migration shipped the RPC that writes it but never added the
  // column, so every hire (licensed or not) died here with 42703 AFTER the
  // auth user and profile were created — an orphan account and an unused
  // invite. 20260826051000_unlicensed_no_npn_onboarding adds the column.
  const agentColumns = "id, user_id, profile_id, status, license_status, license_progress, onboarding_stage, canonical_agent_id, nipr_number";
  const candidates = new Map<string, ExistingAgent>();

  if (authUserId) {
    const { data, error } = await admin.from("agents").select(agentColumns).eq("user_id", authUserId).limit(5);
    if (error) {
      console.error("agent_auth_identity_lookup_failed", error);
      return json({ ok: false, error: "lookup_failed" }, 500);
    }
    for (const row of (data ?? []) as ExistingAgent[]) candidates.set(row.id, row);
  }

  // A legacy unlicensed row can be linked through profiles even when its auth
  // linkage was never copied onto agents.user_id.
  const { data: profileMatches, error: profileMatchError } = await admin
    .from("profiles")
    .select("id, user_id")
    .eq("email", email)
    .limit(5);
  if (profileMatchError) {
    console.error("profile_identity_lookup_failed", profileMatchError);
    return json({ ok: false, error: "lookup_failed" }, 500);
  }
  const profileIds = (profileMatches ?? []).map((row) => row.id).filter(Boolean);
  if (profileIds.length) {
    const { data, error } = await admin.from("agents").select(agentColumns).in("profile_id", profileIds).limit(5);
    if (error) {
      console.error("agent_profile_identity_lookup_failed", error);
      return json({ ok: false, error: "lookup_failed" }, 500);
    }
    for (const row of (data ?? []) as ExistingAgent[]) candidates.set(row.id, row);
  }

  if (nipr_number) {
    const { data, error } = await admin.from("agents").select(agentColumns).eq("nipr_number", nipr_number).limit(5);
    if (error) {
      console.error("agent_npn_identity_lookup_failed", error);
      return json({ ok: false, error: "lookup_failed" }, 500);
    }
    for (const row of (data ?? []) as ExistingAgent[]) candidates.set(row.id, row);
  }

  // Collapse historical duplicate aliases onto their canonical agent before
  // deciding whether the intake is ambiguous.
  const resolvedCandidates = new Map<string, ExistingAgent>();
  for (const candidate of candidates.values()) {
    let resolved = candidate;
    if (candidate.canonical_agent_id) {
      const { data: canonical, error } = await admin
        .from("agents")
        .select(agentColumns)
        .eq("id", candidate.canonical_agent_id)
        .maybeSingle();
      if (error) {
        console.error("canonical_agent_identity_lookup_failed", error);
        return json({ ok: false, error: "lookup_failed" }, 500);
      }
      if (canonical) resolved = canonical as ExistingAgent;
    }
    resolvedCandidates.set(resolved.id, resolved);
  }

  if (resolvedCandidates.size > 1) {
    return json({ ok: false, error: "identity_conflict" }, 409);
  }
  let existingAgent = resolvedCandidates.values().next().value as ExistingAgent | undefined;

  // Never regress a licensed producer because an old invite link defaulted to
  // unlicensed. The explicit licensed answer can only advance this state.
  licensed = licensed || existingAgent?.license_status === "licensed";
  nipr_number = nipr_number ?? existingAgent?.nipr_number ?? null;

  if (existingAgent?.user_id) {
    const { data: linkedAuth, error: linkedAuthError } = await admin.auth.admin.getUserById(existingAgent.user_id);
    if (!linkedAuthError && linkedAuth?.user) {
      const linkedEmail = (linkedAuth.user.email ?? "").trim().toLowerCase();
      if (linkedEmail && linkedEmail !== email) {
        // The person is already on file (matched by NPN/profile) under a
        // DIFFERENT email than the one typed. Cari Mullen 2026-09-04: Add
        // Agent created her account, she opened the hire link with another
        // address, and four 409s rendered as "non-2xx status code". Name it,
        // and hand back a masked hint so she can recognise the address on
        // file. Never rebind the auth email from a typed value — anyone
        // holding the link plus an NPN could hijack the account.
        const at = linkedEmail.indexOf("@");
        const emailHint = at > 1
          ? `${linkedEmail[0]}***${linkedEmail.slice(at)}`
          : "***";
        return json({ ok: false, error: "email_mismatch", email_hint: emailHint }, 409);
      }
      if (authUserId && authUserId !== existingAgent.user_id) {
        return json({ ok: false, error: "identity_conflict" }, 409);
      }
      authUserId = existingAgent.user_id;
    } else {
      // The agent points at an auth identity that no longer exists. Repair the
      // same agent below after creating the replacement auth user.
      existingAgent = { ...existingAgent, user_id: null };
    }
  }

  // 3. Create an auth user only when no existing identity can be reused.
  if (!authUserId) {
    // MP-421: auth.users.phone is written by this function and nothing else --
    // 9 of 9 rows carrying a phone came from `magic_hire_link`. It used to be
    // built as `+1${phone_digits.slice(-10)}`, which cannot fail: a Nigerian
    // hire on +234 806 139 9263 was restamped +1 806 139 9263, area code 806,
    // Amarillo, Texas, a real number owned by a stranger -- written into a
    // column carrying a UNIQUE index (auth.users_phone_key), so the stranger's
    // number is then permanently occupied and a later legitimate signup on it
    // fails this whole hire closed with auth_create_failed.
    //
    // The gate above (`phone_digits.length < 10`) is the same dead shape
    // MP-420 named on the send side: downstream of nothing, it can only reject
    // numbers that are too SHORT, never one digit too long.
    //
    // nanpTenDigits() REFUSES instead of truncating, and is given the RAW body
    // value rather than phone_digits so a typed `+` is still readable as a
    // country code. A refusal omits the phone rather than failing the hire:
    // auth.users.phone is optional, every other write in this function
    // (applications, profiles, submit_contracting_intake) already stores the
    // real digits unmodified, and phone sign-in is disabled on this project
    // (/auth/v1/settings reports "phone": false), so an absent auth phone
    // costs the new hire nothing. An invented one costs a stranger.
    const authPhone = nanpTenDigits(body.phone || "");
    if (!authPhone) {
      // Not silent: MP-311/MP-312 -- a refusal that leaves no trace is its own
      // defect. Edge logs are the trace; there is no durable row for it here.
      console.warn("auth_phone_refused", {
        reason: nanpRefusalReason(body.phone || ""),
        digits: phone_digits.length,
      });
    }
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
      ...(authPhone ? { phone: `+1${authPhone}` } : {}),
      user_metadata: { full_name, source: "magic_hire_link" },
    });
    if (createErr || !created?.user) {
      console.error("auth_create_failed", createErr);
      return json(
        { ok: false, error: "auth_create_failed", detail: createErr?.message },
        500,
      );
    }
    authUserId = created.user.id;
  }

  // 4. The profile and agent must agree on the same auth identity. A partial
  //    profile update is not a successful hire, so fail closed here.
  const { data: profileRow, error: profileError } = await admin
    .from("profiles")
    .upsert(
      {
        user_id: authUserId,
        email,
        phone: phone_digits,
        full_name,
      },
      { onConflict: "user_id" },
    )
    .select("id")
    .single();
  if (profileError || !profileRow?.id) {
    console.error("profile_sync_failed", profileError);
    return json({ ok: false, error: "profile_sync_failed" }, 500);
  }

  // A concurrent request may have created the row after our first lookup.
  if (!existingAgent) {
    const { data: byUser, error } = await admin
      .from("agents")
      .select(agentColumns)
      .eq("user_id", authUserId)
      .maybeSingle();
    if (error) {
      console.error("agent_recheck_failed", error);
      return json({ ok: false, error: "lookup_failed" }, 500);
    }
    existingAgent = (byUser as ExistingAgent | null) ?? undefined;
  }

  let agentId: string;
  if (existingAgent?.id) {
    agentId = existingAgent.id;
    const nextOnboardingStage = licensed
      ? (existingAgent.onboarding_stage && !["pre_licensed", "applied"].includes(existingAgent.onboarding_stage)
        ? existingAgent.onboarding_stage
        : "onboarding")
      : (existingAgent.onboarding_stage ?? "pre_licensed");
    // Upgrade the canonical row in place. Do not reset tenure or advanced
    // onboarding stages, and do not erase an existing upline with a null token.
    const { error: updErr } = await admin
      .from("agents")
      .update({
        user_id: authUserId,
        profile_id: profileRow.id,
        status: "active",
        license_status: licensed ? "licensed" : "unlicensed",
        license_progress: licensed ? "licensed" : (existingAgent.license_progress ?? "unlicensed"),
        onboarding_stage: nextOnboardingStage,
        display_name: full_name,
        ...(targetManager ? {
          manager_id: targetManager.id,
          invited_by_manager_id: targetManager.id,
        } : {}),
        ...(nipr_number ? { nipr_number } : {}),
      })
      .eq("id", agentId);
    if (updErr) {
      console.error("agent_update_failed", updErr);
      return json(
        { ok: false, error: "agent_update_failed", detail: updErr.message },
        500,
      );
    }
  } else {
    // Fresh insert.
    const { data: inserted, error: insErr } = await admin
      .from("agents")
      .insert({
        user_id: authUserId,
        profile_id: profileRow.id,
        status: "active",
        license_status: licensed ? "licensed" : "unlicensed",
        license_progress: licensed ? "licensed" : "unlicensed",
        onboarding_stage: licensed ? "onboarding" : "pre_licensed",
        display_name: full_name,
        manager_id: targetManager?.id ?? null,
        invited_by_manager_id: targetManager?.id ?? null,
        start_date: new Date().toISOString().slice(0, 10),
        ...(nipr_number ? { nipr_number } : {}),
      })
      .select("id")
      .single();
    if (insErr || !inserted?.id) {
      console.error("agent_insert_failed", insErr);
      return json(
        { ok: false, error: "agent_insert_failed", detail: insErr?.message },
        500,
      );
    }
    agentId = inserted.id;
  }

  // Offered terms from the invitation row (never from the URL or the body).
  // Applied before the contracting intake so the intake snapshots the offer.
  const { data: termsData, error: termsErr } = await admin.rpc("invitation_apply_terms", {
    p_invitation_id: tokenRow.id,
    p_claim_id: claimId,
    p_agent_id: agentId,
  });
  const terms = (termsData ?? {}) as { ok?: boolean; error?: string; prior_comp_pct?: number | null; offered_comp_pct?: number | null };
  if (termsErr || terms.ok !== true) {
    console.error("invitation_terms_failed", termsErr ?? terms);
    return json({ ok: false, error: "invitation_terms_failed" }, 500);
  }

  // No contracting intake is queued any more. A licensed hire's NPN is already on their agent profile; the hire then
  // completes the five-field contracting profile themselves (signed in, prefilled) and the team tracks the four
  // carriers by hand. Nothing is queued anywhere outside the website, so this step can no longer fail the
  // invite: a hire who has activated an account is never asked to retry because a downstream queue was down.
  const contracting: Record<string, unknown> = {
    skipped: true,
    reason: "manual_portal_review",
    detail: "Contracting is tracked by hand on the agent's profile; the agent completes their contracting profile after signing in.",
  };

  // Slack access is hired-only and provider-exclusion aware. The dispatcher
  // repeats this check immediately before sending, so a stale/manual outbox row
  // cannot bypass the roster policy.
  const { data: slackEligibility, error: slackEligibilityError } = await admin
    .from("v_slack_invite_eligibility")
    .select("is_eligible, eligibility_status")
    .eq("agent_id", agentId)
    .maybeSingle();
  if (slackEligibilityError) {
    console.error("slack_invite_eligibility_failed", slackEligibilityError);
    return json({ ok: false, error: "slack_invite_eligibility_failed" }, 500);
  }
  if (slackEligibility?.is_eligible === true) {
    const { error: slackInviteError } = await admin.from("outbox_events").insert({
      aggregate_type: "agent",
      aggregate_id: agentId,
      event_type: "recruiting.slack_invite_requested",
      destination: "application_slack_invite",
      payload: { agentId },
      idempotency_key: `recruiting.slack_invite:hired-v2:${agentId}`,
    });
    if (slackInviteError && slackInviteError.code !== "23505") {
      console.error("slack_invite_enqueue_failed", slackInviteError);
      return json({ ok: false, error: "slack_invite_enqueue_failed" }, 500);
    }
  } else {
    console.info("slack_invite_skipped", { agentId, reason: slackEligibility?.eligibility_status ?? "not_found" });
  }

  // 6. Single-use stamp + accepted-terms snapshot. invitation_complete only
  //    succeeds for the claim this request holds and an unused row.
  const { data: doneData, error: markErr } = await admin.rpc("invitation_complete", {
    p_invitation_id: tokenRow.id,
    p_claim_id: claimId,
    p_email: email,
    p_agent_id: agentId,
    p_intake_id: (contracting as { intake_id?: string | null }).intake_id ?? null,
    p_prior_comp_pct: terms.prior_comp_pct ?? null,
  });

  if (markErr) {
    console.error("token_mark_failed", markErr);
    return json({ ok: false, error: "token_mark_failed" }, 500);
  }
  if ((doneData as { ok?: boolean } | null)?.ok !== true) {
    // The agent row is settled (identity dedupe makes a retry upgrade it in
    // place), but the invitation was not stamped, so this is not a success.
    console.warn("token_race_lost", tokenRow.id, doneData);
    return json({ ok: false, error: (doneData as { error?: string } | null)?.error ?? "invite_already_used" }, 409);
  }

  // 7. Mint a magic login token so they land straight in the agent portal.
  let magicToken: string | null = null;
  try {
    const raw =
      crypto.randomUUID().replace(/-/g, "") +
      crypto.randomUUID().replace(/-/g, "");
    const { error: magicErr } = await admin
      .from("magic_login_tokens")
      .insert({
        agent_id: agentId,
        email,
        token: raw,
        destination: "portal",
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      });
    if (!magicErr) magicToken = raw;
  } catch (e) {
    console.warn("magic_token_skip", e);
  }

  const redirect_url = magicToken
    ? `/magic-login?token=${magicToken}`
    // /agent-hub is not a route; /agent-portal is the agent home in App.tsx
    // (ProtectedRoute sends a signed-out hire to log in first).
    : `/agent-portal?welcome=1`;

  // 8. Push Sam a ntfy receipt (fire-and-forget).
  ntfyPush(
    "HIRED via magic link",
    `${full_name} · ${email} · ${licensed ? "licensed" : "unlicensed"} · token …${token.slice(-4)}`,
  );

  return json({
    ok: true,
    kind: "hire",
    agent_id: agentId,
    license_path: licensed ? "licensed" : "pre_license",
    offered_terms: {
      comp_pct: terms.offered_comp_pct ?? null,
    },
    contracting,
    redirect_url,
  });
  }
});
