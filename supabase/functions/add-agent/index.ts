import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { emailPattern } from "../_shared/like-escape.ts";
import { resolveOne } from "../_shared/resolve-one.ts";
import { findAuthUserByEmail } from "../_shared/find-auth-user.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface AddAgentRequest {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  managerId: string;
  licenseStatus?: "licensed" | "unlicensed" | "in_progress";
  builderTrack?: "agent" | "manager_track" | "agency_owner_track";
  notes?: string;
  startDate?: string;
  city?: string;
  state?: string;
  instagramHandle?: string;
  crmSetupLink?: string;
  licenseProgress?: string;
  hasTrainingCourse?: boolean;
  // Sam 2026-08-06: NPN + license detail capture at add time. agents.nipr_number
  // existed since the original schema but nothing ever wrote to it (0 of 178
  // rows populated), so every "licensed" agent was an unprovable self-claim.
  niprNumber?: string;
  licenseNumber?: string;
  licenseStates?: string[];
  licenseExpiresAt?: string;
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // Verify the requesting user is authenticated and has permission
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: claims, error: claimsError } = await supabaseAdmin.auth.getUser(token);
    
    if (claimsError || !claims?.user) {
      return new Response(
        JSON.stringify({ error: "Invalid token" }),
        { status: 401, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const requestingUserId = claims.user.id;

    // Check if the requesting user is an admin or manager
    const { data: roles } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", requestingUserId);

    const isAdmin = roles?.some((r) => r.role === "admin");
    const isManager = roles?.some((r) => r.role === "manager");

    if (!isAdmin && !isManager) {
      return new Response(
        JSON.stringify({ error: "Permission denied. Only admins and managers can add agents." }),
        { status: 403, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const body: AddAgentRequest = await req.json();
    const {
      firstName,
      lastName,
      email,
      phone,
      managerId,
      licenseStatus = "unlicensed",
      builderTrack: requestedBuilderTrack = "agent",
      notes,
      startDate,
      city,
      state,
      instagramHandle,
      crmSetupLink,
      licenseProgress,
      hasTrainingCourse = false,
      niprNumber,
      licenseNumber,
      licenseStates,
      licenseExpiresAt,
    } = body;

    const normalizedNpn = (niprNumber ?? "").replace(/\D+/g, "");

    const allowedBuilderTracks = new Set(["agent", "manager_track", "agency_owner_track"]);
    if (!allowedBuilderTracks.has(requestedBuilderTrack)) {
      return new Response(
        JSON.stringify({ error: "Invalid builder track." }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    if (!isAdmin && requestedBuilderTrack !== "agent") {
      return new Response(
        JSON.stringify({ error: "Only admins can assign Manager Track or Agency Owner Track." }),
        { status: 403, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const builderTrack = isAdmin ? requestedBuilderTrack : "agent";

    // Validate required fields
    if (!firstName || !lastName || !email || !phone || !managerId) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: firstName, lastName, email, phone, managerId" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Server-side mirror of the modal's rule. The modal can be bypassed (this
    // fn is callable directly), so the "licensed needs an NPN" invariant has to
    // hold here too or the untrusted-license problem just moves one layer down.
    if (licenseStatus === "licensed" && normalizedNpn.length < 4) {
      return new Response(
        JSON.stringify({ error: "NPN is required for a licensed agent. Look it up free at nipr.com." }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const normalizedEmail = email.toLowerCase().trim();
    console.log(`Adding new agent: ${firstName} ${lastName} (${normalizedEmail})`);

    // Check if email already exists in profiles.
    //
    // The 409 below is the whole point of this read, and the old form could not
    // reach it in the one case that mattered. .ilike("email", normalizedEmail)
    // treats the caller's own email as a LIKE pattern, and .maybeSingle() nulls
    // out on a multi-row match — so for an email that ALREADY has two profile
    // rows, the duplicate check returned "no match" and this function went on to
    // add a third. profiles.email has no unique index and 8 colliding keys live.
    const existing = await resolveOne<{ id: string; user_id: string; email: string }>(
      supabaseAdmin
        .from("profiles")
        .select("id, user_id, email")
        .ilike("email", emailPattern(normalizedEmail)),
      { label: `profiles.email=${normalizedEmail}` },
    );

    if (existing.row) {
      console.log(
        `Profile already exists for ${normalizedEmail}` +
          (existing.ambiguous ? ` (${existing.matched} rows — needs a merge)` : ""),
      );
      return new Response(
        JSON.stringify({ error: `An agent with email ${normalizedEmail} already exists.` }),
        { status: 409, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Check if auth user already exists. Pages until found or the table ends;
    // a single page of 1000 was one growth spurt from reading "no account" for
    // somebody who has one, and then trying to create it again.
    const authLookup = await findAuthUserByEmail(supabaseAdmin, normalizedEmail);
    const existingAuthUser = authLookup.user;

    let userId: string;

    if (existingAuthUser) {
      console.log(`Auth user already exists for ${normalizedEmail}, using existing`);
      userId = existingAuthUser.id;
    } else {
      // Strong random password. The previous "123456" was rejected when the
      // Supabase project's password policy required longer / stronger passwords,
      // surfacing in the UI as a generic 'Edge Function returned a non-2xx
      // status code.' Agents reset on first login via magic link or reset flow.
      const bytes = new Uint8Array(18);
      crypto.getRandomValues(bytes);
      const randomPassword =
        Array.from(bytes, b => b.toString(36).padStart(2, "0")).join("") + "Aa1!";

      const { data: newAuthUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
        email: normalizedEmail,
        password: randomPassword,
        email_confirm: true,
        user_metadata: {
          full_name: `${firstName} ${lastName}`,
        },
      });

      if (createError || !newAuthUser?.user) {
        console.error("Error creating auth user:", createError);
        return new Response(
          JSON.stringify({
            error: `Failed to create user account: ${createError?.message ?? "unknown"}`,
            stage: "auth.admin.createUser",
            detail: createError ?? null,
          }),
          { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      }

      userId = newAuthUser.user.id;
      console.log(`Created auth user: ${userId}`);
    }

    // Delete any trigger-created records to avoid conflicts
    await supabaseAdmin.from("profiles").delete().eq("user_id", userId);
    await supabaseAdmin.from("user_roles").delete().eq("user_id", userId);
    await supabaseAdmin.from("agents").delete().eq("user_id", userId);

    // Create profile record and get its id for profile_id link
    const { data: newProfile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .insert({
        user_id: userId,
        email: normalizedEmail,
        full_name: `${firstName} ${lastName}`,
        phone: phone || null,
        city: city || null,
        state: state || null,
        instagram_handle: instagramHandle || null,
      })
      .select("id")
      .single();

    if (profileError || !newProfile) {
      console.error("Error creating profile:", profileError);
      return new Response(
        JSON.stringify({
          error: `Failed to create profile: ${profileError?.message ?? "unknown"}`,
          stage: "profiles.insert",
          detail: profileError ?? null,
        }),
        { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const profileId = newProfile.id;
    console.log(`Created profile ${profileId} for ${userId}`);

    // Add agent role
    const { error: roleError } = await supabaseAdmin
      .from("user_roles")
      .insert({ user_id: userId, role: "agent" });

    if (roleError) {
      console.error("Error adding agent role:", roleError);
    }

    // Create agent record
    const agentInsert: Record<string, unknown> = {
      user_id: userId,
      profile_id: profileId,
      invited_by_manager_id: managerId,
      status: "active",
      license_status: licenseStatus,
      onboarding_stage: hasTrainingCourse ? "training_online" : "onboarding",
      has_training_course: hasTrainingCourse || false,
      start_date: startDate || null,
      builder_track: builderTrack,
    };

    if (crmSetupLink) {
      agentInsert.crm_setup_link = crmSetupLink;
    }

    // License detail. nipr_verified is deliberately left at its false default —
    // an NPN typed into a form is self-reported, not verified. Only a real NIPR
    // lookup may flip it, otherwise the trust chip would claim proof we don't
    // have (the same lie as the 465 fake-success InsuraCloud sync rows).
    if (normalizedNpn) {
      agentInsert.nipr_number = normalizedNpn;
    }
    if (licenseNumber?.trim()) {
      agentInsert.license_number = licenseNumber.trim();
    }
    if (Array.isArray(licenseStates) && licenseStates.length) {
      agentInsert.license_states = licenseStates
        .map((s) => String(s).trim().toUpperCase())
        .filter(Boolean);
    }
    if (licenseExpiresAt) {
      agentInsert.license_expires_at = licenseExpiresAt;
    }

    const { data: newAgent, error: agentError } = await supabaseAdmin
      .from("agents")
      .insert(agentInsert)
      .select("id")
      .single();

    if (agentError) {
      console.error("Error creating agent:", agentError);
      return new Response(
        JSON.stringify({
          error: `Failed to create agent record: ${agentError?.message ?? "unknown"}`,
          stage: "agents.insert",
          detail: agentError ?? null,
        }),
        { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    console.log(`Created agent record: ${newAgent.id}`);

    // Add initial note if provided
    if (notes?.trim() && newAgent) {
      await supabaseAdmin.from("agent_notes").insert({
        agent_id: newAgent.id,
        note: notes,
        created_by: requestingUserId,
      });
      console.log(`Added initial note for agent ${newAgent.id}`);
    }

    // Sam-feedback 2026-06-03: Transfer block — stash carriers, writing
    // numbers, previous upline as a single structured agent_note so the
    // upline can see and act on the transfer in one place.
    const transferNeeded = (body as any).transferNeeded === true;
    const tCarriers = (body as any).transferCarriers as string | undefined;
    const tWriting = (body as any).transferWritingNumbers as string | undefined;
    const tUpline = (body as any).transferPreviousUpline as string | undefined;
    // 2026-08-06 audit: both writes below were bare `await` with no error
    // destructuring. The agents.notes stamp targeted a column that did not
    // exist, so PostgREST returned PGRST204 into a value nobody read and the
    // caller still saw "Agent added successfully" — the 465-fake-success-row
    // disease in miniature. Column added in 20260806143000_agents_notes_column;
    // both writes now report failure into the existing sideEffects contract.
    let transferNoteError: string | null = null;
    let transferStampError: string | null = null;
    if (transferNeeded && newAgent) {
      const nowIso = new Date().toISOString();
      const blockLines = [
        "TRANSFER REQUEST (from Add Agent form)",
        "",
        `Owner: ${managerId}`,
        `State: Needs Transfer`,
        `Created: ${nowIso}`,
        `Next action: Confirm carrier releases and writing-number transfer requirements`,
        "",
        `Carriers: ${tCarriers ?? "(not provided)"}`,
        `Writing numbers: ${tWriting ?? "(not provided)"}`,
        `Previous upline: ${tUpline ?? "(not provided)"}`,
      ].join("\n");
      const { error: transferNoteErr } = await supabaseAdmin.from("agent_notes").insert({
        agent_id: newAgent.id,
        note: blockLines,
        created_by: requestingUserId,
      });
      if (transferNoteErr) {
        transferNoteError = transferNoteErr.message ?? String(transferNoteErr);
        console.error("[add-agent] transfer agent_notes insert failed:", transferNoteErr);
      }
      // Stamp the agent row so rosters/drawers can flag transfer agents without
      // joining agent_notes. agent_notes above stays the system of record.
      const { error: transferStampErr } = await supabaseAdmin.from("agents").update({
        notes: `[NEEDS TRANSFER] owner=${managerId} created=${nowIso} next=Confirm carrier releases ${tCarriers ?? ""}`.slice(0, 500),
      }).eq("id", newAgent.id);
      if (transferStampErr) {
        transferStampError = transferStampErr.message ?? String(transferStampErr);
        console.error("[add-agent] transfer stamp on agents.notes failed:", transferStampErr);
      }
      if (!transferNoteError && !transferStampError) {
        console.log(`Added transfer block note for agent ${newAgent.id}`);
      }
    }

    // Fetch contracting link from manager's saved links
    let contractingLink: string | undefined;
    if (managerId) {
      const { data: links } = await supabaseAdmin
        .from("contracting_links")
        .select("url")
        .eq("manager_id", managerId)
        .limit(1);
      if (links?.length) {
        contractingLink = links[0].url;
      }
    }
    // Fall back to agent's own crm_setup_link
    if (!contractingLink && crmSetupLink) {
      contractingLink = crmSetupLink;
    }
    // 2026-08-19 Sam ("ensure the contract is working when I click add agent"):
    // contracting_links is empty and there is no crm_setup_link, so contractingLink
    // was undefined and welcome-new-agent SKIPPED its entire "Start Your Contracting"
    // step — every new agent got a welcome email with no way to begin contracting.
    // APEX owns a public, purpose-built contracting intake at /start-contracting; a
    // manager-specific saved link still wins, but no agent should ever be sent
    // without a working contracting destination. Anchored to the production origin
    // rather than a request header so a preview host can't leak into the email.
    if (!contractingLink) {
      contractingLink = "https://apex-financial.org/start-contracting";
    }

    // wave-p1j (audit L151): the previous fire-and-forget `.catch(console.log)`
    // pattern silently swallowed welcome + course email failures — the modal
    // then rendered a blanket "Agent added successfully" toast while the new
    // agent never got either email. Same disease as the 465 InsuraCloud
    // fake-success sync rows: side-effect failures buried, top-level lie.
    // Now: await both invocations, capture per-side-effect status, ship it in
    // the response so the modal can surface partial failure honestly.
    type SideEffectStatus = { ok: boolean; skipped?: boolean; error?: string };
    const invokeSideEffect = async (
      fnName: string,
      body: Record<string, unknown>,
    ): Promise<SideEffectStatus> => {
      try {
        const { error } = await supabaseAdmin.functions.invoke(fnName, { body });
        if (error) {
          console.error(`[add-agent] ${fnName} failed:`, error);
          return { ok: false, error: error.message ?? String(error) };
        }
        return { ok: true };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[add-agent] ${fnName} threw:`, msg);
        return { ok: false, error: msg };
      }
    };

    const welcomeEmailStatus = await invokeSideEffect("welcome-new-agent", {
      agentName: `${firstName} ${lastName}`,
      agentEmail: normalizedEmail,
      managerId,
      contractingLink,
    });

    const courseEmailStatus: SideEffectStatus = hasTrainingCourse
      ? await invokeSideEffect("send-course-enrollment-email", {
          agentName: `${firstName} ${lastName}`,
          agentEmail: normalizedEmail,
          agentId: newAgent.id,
        })
      : { ok: true, skipped: true };

    const transferStatus: SideEffectStatus = !transferNeeded
      ? { ok: true, skipped: true }
      : transferNoteError || transferStampError
        ? { ok: false, error: [transferNoteError, transferStampError].filter(Boolean).join("; ") }
        : { ok: true };

    // ── Contracting channel post (Discord) + Ethos paste-row ────────────────
    // 2026-08-14 Sam: added agents were reaching neither the team Discord nor
    // the Ethos contracting sheet. The Ethos sheet is a third party's private
    // Google Sheet (no service credential exists, export returns 401), so an
    // unattended API write is impossible today. What CAN run unattended: post
    // every new agent into the contracting channel with the EXACT tab-separated
    // row the Ethos sheet takes in columns A–I (format proven by the 2026-07-16
    // 188-agent fill: First, Last, NPN, agent# [unknown at add-time, blank],
    // Phone, Email, blank, "6 Month Advance", "Apex Financial Empire") so
    // placement is one paste with zero re-typing. Webhook key is
    // discord_webhook_url_contracting — RAW text, never JSON-quoted (that
    // exact bug killed Discord automation on 2026-07-31), and per the standing
    // rule this NEVER falls back to another channel: unset = honest
    // not_configured, not a post somewhere else.
    let contractingPostStatus: SideEffectStatus;
    try {
      const { data: whRow } = await supabaseAdmin
        .from("system_settings")
        .select("value")
        .eq("key", "discord_webhook_url_contracting")
        .maybeSingle();
      const webhook = (whRow?.value ?? "").toString().trim();
      if (!webhook.startsWith("https://discord.com/api/webhooks/")) {
        contractingPostStatus = { ok: false, error: "not_configured: system_settings.discord_webhook_url_contracting is empty — create a webhook in the contracting channel and store its URL (raw text)" };
      } else {
        const ethosRow = [firstName, lastName, normalizedNpn || "", "", phone ?? "", normalizedEmail, "", "6 Month Advance", "Apex Financial Empire"].join("\t");
        const res = await fetch(webhook, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            embeds: [{
              title: `🆕 New agent: ${firstName} ${lastName}`,
              description: [
                `NPN: **${normalizedNpn || "—"}**`,
                `Phone: ${phone ?? "—"} · Email: ${normalizedEmail}`,
                "",
                "**Ethos sheet — copy the line below, click the last row of the Agents tab, paste:**",
                "```", ethosRow, "```",
                "[Open Ethos sheet](https://docs.google.com/spreadsheets/d/1R5ZEjfDai0dFp1z8xbfpaFGbOAEiXzPc0F1KxnWPSMY/edit?gid=517020732#gid=517020732)",
              ].join("\n"),
              color: 0xf5a623,
              footer: { text: "APEX · add-agent → contracting" },
              timestamp: new Date().toISOString(),
            }],
          }),
        });
        contractingPostStatus = (res.status === 204 || res.ok)
          ? { ok: true }
          : { ok: false, error: `discord webhook HTTP ${res.status}` };
      }
    } catch (e) {
      contractingPostStatus = { ok: false, error: `contracting post: ${e instanceof Error ? e.message : String(e)}` };
    }

    const sideEffectFailures: string[] = [];
    if (!welcomeEmailStatus.ok) sideEffectFailures.push("welcome email");
    if (!courseEmailStatus.ok) sideEffectFailures.push("course enrollment email");
    if (!transferStatus.ok) sideEffectFailures.push("transfer note");
    if (!contractingPostStatus.ok) sideEffectFailures.push("contracting channel post");

    const message = sideEffectFailures.length
      ? `Agent ${firstName} ${lastName} added, but ${sideEffectFailures.join(" and ")} failed — resend manually.`
      : `Agent ${firstName} ${lastName} added successfully`;

    return new Response(
      JSON.stringify({
        success: true,
        agentId: newAgent.id,
        userId: userId,
        builderTrack,
        message,
        sideEffects: {
          welcomeEmail: welcomeEmailStatus,
          courseEmail: courseEmailStatus,
          transferBlock: transferStatus,
          contractingPost: contractingPostStatus,
        },
        partial: sideEffectFailures.length > 0,
      }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  } catch (error: unknown) {
    console.error("Error in add-agent:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
};

serve(handler);
