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
//                       enqueues calendly-invite + prospect_whatsapp (MP-232).
//                     * license_status='licensed'   → trg_bot_alert_licensed_app
//                       fires the manager/Sam critical alert.
//                   Optional `licensed: true` on the body flips the row licensed;
//                   otherwise defaults to 'unlicensed' (prospect capture flow).
//
// Anti-fake-success rule (Sam directive, 465 InsuraCloud memory):
//   Never return {ok:true} unless the underlying row (agents for hire,
//   applications for join) exists AND invite_tokens.used_at is set.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { findAuthUserByEmail, type AuthUserLister } from "../_shared/find-auth-user.ts";

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
  // Fire-and-forget; do not block the response on this.
  fetch(`https://ntfy.sh/${NTFY_TOPIC}`, {
    method: "POST",
    headers: { Title: title, Priority: "high" },
    body: message,
  }).catch(() => {});
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
  const nipr_number = digitsOnly(body.nipr_number || "") || null;

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

  // 1. Look up token. Service-role read bypasses RLS.
  const { data: tokenRow, error: tokenErr } = await admin
    .from("invite_tokens")
    .select(
      "id, kind, is_active, used_at, expires_at, target_role, target_manager_id, created_by, prefill_json",
    )
    .eq("token", token)
    .maybeSingle();

  if (tokenErr) {
    console.error("token_lookup_failed", tokenErr);
    return json({ ok: false, error: "lookup_failed" }, 500);
  }
  if (!tokenRow) {
    return json({ ok: false, error: "invite_invalid" }, 409);
  }
  if (!tokenRow.is_active) {
    return json({ ok: false, error: "invite_revoked" }, 409);
  }
  if (tokenRow.used_at) {
    return json({ ok: false, error: "invite_already_used" }, 409);
  }
  if (new Date(tokenRow.expires_at).getTime() < Date.now()) {
    return json({ ok: false, error: "invite_expired" }, 409);
  }
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
  if (tokenRow.target_manager_id) {
    const { data: managerRow, error: managerErr } = await admin
      .from("agents")
      .select("id, user_id, is_deactivated")
      .eq("id", tokenRow.target_manager_id)
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
  // existing DB triggers fan out (calendly + prospect_whatsapp for
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

    // Mark token consumed (race-safe).
    const { data: markedJoin, error: markJoinErr } = await admin
      .from("invite_tokens")
      .update({
        used_at: new Date().toISOString(),
        used_by_application_id: appRow.id,
      })
      .eq("id", tokenRow.id)
      .is("used_at", null)
      .select("id")
      .maybeSingle();

    if (markJoinErr) {
      console.error("token_mark_failed_join", markJoinErr);
      return json({ ok: false, error: "token_mark_failed" }, 500);
    }
    if (!markedJoin) {
      console.warn("token_race_lost_join", tokenRow.id);
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
  // The recruit's explicit answer wins. target_role remains the compatibility
  // fallback for old links that predated the required license question.
  const licensed = typeof body.licensed === "boolean"
    ? body.licensed
    : targetRole === "hired_licensed";
  if (licensed && (!nipr_number || !/^\d{5,10}$/.test(nipr_number))) {
    return json({ ok: false, error: "npn_required_for_licensed_hire" }, 422);
  }

  // 2. Dedupe by email — if an active agent already owns this email, bail with a clear signal.
  //    We look up the auth user first (canonical), then agents.
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

  // 3. Create or reuse auth user.
  if (!authUserId) {
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
      phone: `+1${phone_digits.slice(-10)}`,
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

  // 4. Upsert profile row (best-effort; do not block hire on this).
  await admin
    .from("profiles")
    .upsert(
      {
        user_id: authUserId,
        email,
        phone: phone_digits,
        full_name,
      },
      { onConflict: "user_id" },
    );

  // 5. Look up existing agent by user_id.
  const { data: existingAgent } = await admin
    .from("agents")
    .select("id, status, license_status, onboarding_stage")
    .eq("user_id", authUserId)
    .maybeSingle();

  let agentId: string;
  if (existingAgent?.id) {
    agentId = existingAgent.id;
    // Update to activate + fire the enqueue trigger chain.
    const { error: updErr } = await admin
      .from("agents")
      .update({
        status: "active",
        license_status: licensed ? "licensed" : "unlicensed",
        onboarding_stage: licensed ? "onboarding" : "pre_licensed",
        display_name: full_name,
        manager_id: targetManager?.id ?? null,
        invited_by_manager_id: targetManager?.id ?? null,
        start_date: new Date().toISOString().slice(0, 10),
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
        status: "active",
        license_status: licensed ? "licensed" : "unlicensed",
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

  // A licensed hire is not "done" when the profile row exists. Queue the
  // canonical contracting intake in the same request so the Ethos spreadsheet
  // and private contracting Discord start automatically. The intake dedupes by
  // NPN, making browser retries safe; if this leg fails the invite remains
  // unused and the recruit can retry without creating a second agent.
  if (licensed) {
    const nameParts = full_name.split(/\s+/).filter(Boolean);
    const { data: contractingResult, error: contractingError } = await admin.rpc(
      "submit_contracting_intake",
      {
        p_first_name: nameParts[0],
        p_last_name: nameParts.slice(1).join(" "),
        p_email: email,
        p_phone: phone_digits,
        p_npn: nipr_number,
        p_source: "magic_hire_link",
        p_submitted_by: authUserId,
      },
    );
    if (contractingError || contractingResult?.ok !== true) {
      console.error("licensed_contracting_enqueue_failed", contractingError ?? contractingResult);
      return json({ ok: false, error: "contracting_enqueue_failed" }, 500);
    }
  }

  // 6. Mark invite consumed. Idempotency safety: only mark if still unused.
  const { data: updatedToken, error: markErr } = await admin
    .from("invite_tokens")
    .update({
      used_at: new Date().toISOString(),
      used_by_agent_id: agentId,
    })
    .eq("id", tokenRow.id)
    .is("used_at", null)
    .select("id")
    .maybeSingle();

  if (markErr) {
    console.error("token_mark_failed", markErr);
    return json({ ok: false, error: "token_mark_failed" }, 500);
  }
  if (!updatedToken) {
    // Someone raced us to it. Agent creation already succeeded — this is a soft loss.
    console.warn("token_race_lost", tokenRow.id);
  }

  // 7. Mint a magic login token so they land straight in /agent-hub.
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
    : `/agent-hub?welcome=1`;

  // 8. Push Sam a ntfy receipt (fire-and-forget).
  ntfyPush(
    "HIRED via magic link",
    `${full_name} · ${email} · ${licensed ? "licensed" : "unlicensed"} · token …${token.slice(-4)}`,
  );

  return json({
    ok: true,
    kind: "hire",
    agent_id: agentId,
    redirect_url,
  });
});
