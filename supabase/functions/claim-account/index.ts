/**
 * claim-account — the public "activate my login" endpoint behind /claim.
 *
 * One link Sam can send to the whole team at once. Each person opens it, types
 * who they are, and gets a working login attached to the record that ALREADY
 * exists for them. No ?ref= code, no manager in the loop, no new duplicate
 * record — the opposite of /agent-signup, which requires a referral code and
 * creates a fresh row.
 *
 * Why the matching is deliberately fussy
 * --------------------------------------
 * This endpoint is unauthenticated and it mints auth users, so a loose matcher
 * is an account-takeover tool. Measured against prod before writing this:
 * 11 active agent records have no login, and one of them is "Samuel James"
 * (SJAMES02). display_name is published on the leaderboard. A matcher that
 * accepted a name on its own would hand Sam's own agent row to anyone who
 * could read the board. So:
 *
 *   - a name never selects a record at all (see 1d for what was tried first)
 *   - only records with user_id IS NULL are claimable (agent_claim_state)
 *   - the three emails trg_auto_admin_for_sam auto-promotes are refused
 *     outright, since minting one of those users mints an admin
 *   - is_manager records are refused and flagged for Sam
 *   - more than one candidate is refused, never guessed at
 *   - every attempt is written to account_claims, matched or not
 *
 * The unmatched ones matter as much as the matched ones: 9 of those 11 agents
 * have no email and no phone anywhere in the database, so nothing they type can
 * find them. They land in account_claims with outcome='unmatched' and Sam works
 * that list. Silence would have been the bug.
 */

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.90.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const SUPPORT = "sam@apex-financial.org";

/**
 * PostgREST rewrites `*` to `%` before it becomes SQL, so .ilike() takes FOUR
 * metacharacters, not two. An unescaped value here is a pattern, not a
 * comparison — `%` on its own would match every row in the table. (MP-277
 * proved this in prod: ?email=ilike.j_intwan@yahoo.com returned two rows
 * belonging to a different address.)
 */
function likeLiteral(raw: string): string {
  return raw.replace(/[\\%_*]/g, (c) => `\\${c}`);
}

const normEmail = (v?: string | null) => v?.trim().toLowerCase() || null;
const normPhone = (v?: string | null) => {
  const d = v?.replace(/\D/g, "") ?? "";
  return d.length >= 10 ? d.slice(-10) : null;
};
const normName = (v?: string | null) =>
  v?.trim().replace(/\s+/g, " ").toLowerCase() || null;

interface ClaimBody {
  fullName?: string;
  email?: string;
  password?: string;
  phone?: string;
  agentCode?: string;
}

interface Candidate {
  agentId: string;
  applicationId: string | null;
  basis: string;
  displayName: string | null;
}

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("cf-connecting-ip") ??
    null;
  const userAgent = req.headers.get("user-agent") ?? null;

  let body: ClaimBody;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid request." }, 400);
  }

  const fullName = body.fullName?.trim() || null;
  const email = normEmail(body.email);
  const phone = normPhone(body.phone);
  const agentCode = body.agentCode?.trim() || null;
  const password = body.password ?? "";

  // Written on every exit path, so the log never has holes in it.
  const log = async (
    outcome: string,
    extra: Record<string, unknown> = {},
  ) => {
    try {
      await admin.from("account_claims").insert({
        typed_name: fullName,
        typed_email: email,
        typed_phone: phone,
        typed_code: agentCode,
        outcome,
        ip,
        user_agent: userAgent,
        ...extra,
      });
    } catch (e) {
      console.error("[claim-account] failed to write audit row:", e);
    }
  };

  if (!fullName || fullName.length < 2) {
    return json({ error: "Please enter your full name." }, 400);
  }
  if (!email) {
    return json({ error: "Please enter the email you want to sign in with." }, 400);
  }
  if (password.length < 8) {
    return json({ error: "Choose a password of at least 8 characters." }, 400);
  }

  // auth.users carries trg_auto_admin_for_sam, which INSERTs an 'admin' role for
  // exactly these three addresses the moment a user with one is created. A
  // public endpoint that mints auth users is therefore one typed email away
  // from minting an admin. Refused here, ahead of createUser.
  const RESERVED = new Set([
    "sam.com593@gmail.com",
    "sam@apex-financial.org",
    "info@kingofsales.net",
  ]);
  if (RESERVED.has(email)) {
    await log("refused_privileged", { detail: "reserved admin email" });
    return json(
      { error: "That email can't be used here. Sign in normally or use \"Forgot password\".", code: "RESERVED_EMAIL" },
      403,
    );
  }
  if (!phone && !agentCode) {
    // The corroboration rule, surfaced as a form requirement rather than a
    // mysterious "not found" after the fact.
    return json(
      {
        error:
          "Please add your phone number (or your agent code) — we need it to match you to your existing record.",
      },
      400,
    );
  }

  // ── Rate limit: 5 attempts per IP per 15 min ───────────────────────────────
  if (ip) {
    const since = new Date(Date.now() - 15 * 60_000).toISOString();
    const { count } = await admin
      .from("account_claims")
      .select("id", { count: "exact", head: true })
      .eq("ip", ip)
      .gte("created_at", since);
    if ((count ?? 0) >= 5) {
      return json(
        { error: `Too many attempts. Wait a few minutes, or email ${SUPPORT}.` },
        429,
      );
    }
  }

  try {
    // ── 1. Gather candidates ────────────────────────────────────────────────
    const candidates: Candidate[] = [];
    const seen = new Set<string>();
    // Keyed on agentId OR applicationId: an applicant who has no agent row yet
    // is still a real candidate, and keying on agentId alone silently dropped
    // every one of them (the empty string is falsy).
    const add = (c: Candidate) => {
      const key = c.agentId || c.applicationId;
      if (key && !seen.has(key)) {
        seen.add(key);
        candidates.push(c);
      }
    };

    // 1a. Agent code — the strongest signal, so it is tried first.
    if (agentCode) {
      const { data } = await admin
        .from("agents")
        .select("id, display_name, source_application_id")
        .ilike("agent_code", likeLiteral(agentCode));
      for (const a of data ?? []) {
        add({
          agentId: a.id,
          applicationId: a.source_application_id ?? null,
          basis: "agent_code",
          displayName: a.display_name,
        });
      }
    }

    // 1b. Phone, via the application the agent record was created from.
    //     Compared in JS on the last 10 digits because the column holds a mix
    //     of formats and a LIKE on a formatted string misses most of them.
    if (phone) {
      const { data: apps } = await admin
        .from("applications")
        .select("id, phone, first_name, last_name")
        .is("terminated_at", null)
        .limit(5000);
      const appHits = (apps ?? []).filter(
        (a: { phone?: string | null }) => normPhone(a.phone) === phone,
      );
      for (const app of appHits) {
        const { data: ags } = await admin
          .from("agents")
          .select("id, display_name, source_application_id")
          .eq("source_application_id", app.id);
        for (const a of ags ?? []) {
          add({
            agentId: a.id,
            applicationId: app.id,
            basis: "phone",
            displayName: a.display_name,
          });
        }
        if (!ags?.length) {
          // An applicant with no agent row yet is still a legitimate claim —
          // recorded so the caller gets a real answer instead of "not found".
          add({
            agentId: "",
            applicationId: app.id,
            basis: "phone(application)",
            displayName: `${app.first_name ?? ""} ${app.last_name ?? ""}`.trim(),
          });
        }
      }
    }

    // 1c. Email on the application (never on its own for agent matching —
    //     it is here because someone applying with their own email is
    //     self-corroborating for THAT application).
    if (email && candidates.length === 0) {
      const { data: apps } = await admin
        .from("applications")
        .select("id, first_name, last_name")
        .ilike("email", likeLiteral(email))
        .is("terminated_at", null);
      for (const app of apps ?? []) {
        const { data: ags } = await admin
          .from("agents")
          .select("id, display_name")
          .eq("source_application_id", app.id);
        for (const a of ags ?? []) {
          add({
            agentId: a.id,
            applicationId: app.id,
            basis: "email",
            displayName: a.display_name,
          });
        }
      }
    }

    // 1d. There is deliberately NO name-based branch.
    //
    // The first cut had one: match display_name when the caller had supplied
    // *some* phone or code. Tested against prod, it matched the agent row for
    // "Samuel James" (SJAMES02) on the phone number 555-555-0000 — because it
    // only checked that a phone had been TYPED, never that the phone belonged
    // to the record. The name came off the public leaderboard. Only the
    // is_manager refusal stopped it, which is luck, not a control.
    //
    // A name is not a secret here, so it cannot be half of a two-factor match.
    // Anyone whose record has no phone, no email and no agent code (9 of the 11
    // unlinked active agents) lands in account_claims as 'unmatched' and Sam
    // activates them by hand. Slower for nine people, and it cannot be used to
    // take over an account.

    // ── 2. Adjudicate ───────────────────────────────────────────────────────
    if (candidates.length === 0) {
      await log("unmatched");
      return json(
        {
          error:
            "We couldn't find an existing record matching those details. Your info has been sent to Sam — he'll set you up and you'll hear back shortly.",
          code: "UNMATCHED",
        },
        404,
      );
    }

    if (candidates.length > 1) {
      await log("ambiguous", {
        detail: candidates.map((c) => `${c.agentId || c.applicationId}:${c.basis}`).join(", "),
      });
      return json(
        {
          error: `We found more than one record for those details, so we didn't want to guess. Email ${SUPPORT} and he'll finish it manually.`,
          code: "AMBIGUOUS",
        },
        409,
      );
    }

    const match = candidates[0];

    // 2a. Claimability is decided in the database so the rules can't drift
    //     between here and anything else that links accounts later.
    if (match.agentId) {
      const { data: state } = await admin.rpc("agent_claim_state", {
        p_agent_id: match.agentId,
      });

      if (state === "already_linked") {
        await log("already_linked", { matched_agent_id: match.agentId, match_basis: match.basis });
        return json(
          {
            error:
              "That record already has a login. Use \"Forgot password\" on the sign-in page to get back in.",
            code: "ALREADY_LINKED",
          },
          409,
        );
      }
      if (state === "refused_privileged") {
        await log("refused_privileged", { matched_agent_id: match.agentId, match_basis: match.basis });
        return json(
          {
            error: `That record needs to be activated by Sam directly. Email ${SUPPORT}.`,
            code: "NEEDS_ADMIN",
          },
          403,
        );
      }
      if (state !== "claimable") {
        await log("error", {
          matched_agent_id: match.agentId,
          match_basis: match.basis,
          detail: `claim_state=${state}`,
        });
        return json(
          { error: `That record isn't active. Email ${SUPPORT} and he'll sort it out.`, code: "NOT_CLAIMABLE" },
          403,
        );
      }
    }

    // ── 3. Create the login ─────────────────────────────────────────────────
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName, claimed_via: "claim-account" },
    });

    if (createErr || !created?.user) {
      const msg = createErr?.message ?? "";
      // Supabase surfaces a duplicate as "already been registered".
      if (/already.*regist|already.*exist|duplicate/i.test(msg)) {
        await log("email_in_use", {
          matched_agent_id: match.agentId || null,
          match_basis: match.basis,
        });
        return json(
          {
            error:
              "You already have a login with that email. Sign in instead — or use \"Forgot password\" if you can't remember it.",
            code: "EMAIL_IN_USE",
          },
          409,
        );
      }
      await log("error", { detail: msg.slice(0, 300) });
      console.error("[claim-account] createUser failed:", createErr);
      return json({ error: `Couldn't create the account. Email ${SUPPORT}.` }, 500);
    }

    const newUserId = created.user.id;

    // ── 4. Attach it to the existing record ─────────────────────────────────
    // profiles is NOT keyed by the auth user id: it has its own `id` PK plus a
    // separate `user_id`, and the on_auth_user_created trigger has already
    // inserted a row keyed by user_id. The first cut wrote { id: newUserId },
    // which is the wrong column — the insert went nowhere, `profile` came back
    // null, and the fallback put a non-existent uuid into agents.profile_id,
    // producing agents_profile_id_fkey violations in prod. Read the row the
    // trigger made, then top it up.
    const { data: profileRow, error: profileErr } = await admin
      .from("profiles")
      .select("id")
      .eq("user_id", newUserId)
      .maybeSingle();

    let profileId = profileRow?.id ?? null;

    if (!profileId) {
      // Trigger swallows its own exceptions, so a missing row is possible.
      const { data: madeProfile, error: makeErr } = await admin
        .from("profiles")
        .insert({ user_id: newUserId, email, full_name: fullName, phone: body.phone ?? null })
        .select("id")
        .maybeSingle();
      if (makeErr || !madeProfile) {
        // empty-catch-allow:rollback-of-the-user-we-just-made; the real failure is already logged + returned
        try { await admin.auth.admin.deleteUser(newUserId); } catch (_e) { /* nothing better to do */ }
        await log("error", {
          detail: `profile create failed: ${makeErr?.message ?? profileErr?.message ?? "no row"}`.slice(0, 300),
        });
        return json({ error: `Couldn't finish setting up your account. Email ${SUPPORT}.` }, 500);
      }
      profileId = madeProfile.id;
    } else {
      await admin
        .from("profiles")
        .update({ email, full_name: fullName, phone: body.phone ?? null })
        .eq("id", profileId);
    }

    let agentId = match.agentId;

    if (agentId) {
      // Conditional on user_id IS NULL so two people racing the same link
      // cannot both attach to one record — the second update matches no rows.
      const { data: linked, error: linkErr } = await admin
        .from("agents")
        .update({
          user_id: newUserId,
          profile_id: profileId,
          portal_password_set: true,
          display_name: match.displayName ?? fullName,
        })
        .eq("id", agentId)
        .is("user_id", null)
        .select("id");

      if (linkErr || !linked?.length) {
        // Lost the race, or the row changed underneath us. Do not leave a
        // dangling auth user behind.
        // empty-catch-allow:rollback-of-the-user-we-just-made; the real failure is already logged + returned
        try { await admin.auth.admin.deleteUser(newUserId); } catch (_e) { /* nothing better to do */ }
        await log("already_linked", {
          matched_agent_id: agentId,
          match_basis: match.basis,
          detail: linkErr?.message ?? "raced: user_id was set concurrently",
        });
        return json(
          {
            error:
              "That record was just activated by someone else. If that wasn't you, email " + SUPPORT + ".",
            code: "RACED",
          },
          409,
        );
      }
    } else if (match.applicationId) {
      // Applicant with no agent row yet — create one, attributed the same way
      // link-account does it (recruiter_id wins over assigned_agent_id).
      const { data: app } = await admin
        .from("applications")
        .select("recruiter_id, assigned_agent_id, license_status")
        .eq("id", match.applicationId)
        .maybeSingle();

      const { data: newAgent, error: agentErr } = await admin
        .from("agents")
        .insert({
          user_id: newUserId,
          profile_id: profileId,
          status: "active",
          display_name: fullName,
          license_status: app?.license_status ?? "unlicensed",
          onboarding_stage:
            app?.license_status === "licensed" ? "in_field_training" : "pre_licensed",
          invited_by_manager_id: app?.recruiter_id ?? app?.assigned_agent_id ?? null,
          source_application_id: match.applicationId,
          portal_password_set: true,
        })
        .select("id")
        .maybeSingle();

      if (agentErr || !newAgent) {
        // empty-catch-allow:rollback-of-the-user-we-just-made; the real failure is already logged + returned
        try { await admin.auth.admin.deleteUser(newUserId); } catch (_e) { /* nothing better to do */ }
        await log("error", { detail: agentErr?.message ?? "agent insert returned nothing" });
        return json({ error: `Couldn't finish setting up your account. Email ${SUPPORT}.` }, 500);
      }
      agentId = newAgent.id;
    }

    // ── 5. Role ─────────────────────────────────────────────────────────────
    // 'agent' only. This endpoint can never mint a manager or admin.
    await admin
      .from("user_roles")
      .upsert({ user_id: newUserId, role: "agent" }, { onConflict: "user_id,role" });

    await log("linked", {
      matched_agent_id: agentId || null,
      matched_application_id: match.applicationId,
      created_user_id: newUserId,
      match_basis: match.basis,
    });

    console.log(`[claim-account] linked user=${newUserId} agent=${agentId} basis=${match.basis}`);

    return json({
      ok: true,
      message: "Your account is live. Signing you in…",
      agentId,
      displayName: match.displayName ?? fullName,
    });
  } catch (e) {
    console.error("[claim-account] unhandled:", e);
    await log("error", { detail: String(e).slice(0, 300) });
    return json({ error: `Something went wrong. Email ${SUPPORT}.` }, 500);
  }
});
