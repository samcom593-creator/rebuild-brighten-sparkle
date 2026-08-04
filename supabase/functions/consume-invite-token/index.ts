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
  const nipr_number = (body.nipr_number || "").trim() || null;

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
  const licensed = targetRole === "hired_licensed" || body.licensed === true;

  // 2. Dedupe by email — if an active agent already owns this email, bail with a clear signal.
  //    We look up the auth user first (canonical), then agents.
  const { data: existingUsers, error: userListErr } = await admin
    .auth
    .admin
    .listUsers({ page: 1, perPage: 200 });
  // NOTE: listUsers has no email filter server-side in supabase-js v2 admin; small-N
  // lookup is fine while we're early. We scan the small page for the email.
  if (userListErr) {
    console.error("auth_list_failed", userListErr);
  }
  let authUserId: string | null = null;
  const existing = (existingUsers?.users ?? []).find(
    (u: { email?: string | null; id: string }) =>
      (u.email ?? "").toLowerCase() === email,
  );
  if (existing) authUserId = existing.id;

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
        onboarding_stage: licensed ? "live" : "pre_licensed",
        display_name: full_name,
        manager_id: tokenRow.target_manager_id ?? null,
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
        onboarding_stage: licensed ? "live" : "pre_licensed",
        display_name: full_name,
        manager_id: tokenRow.target_manager_id ?? null,
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
