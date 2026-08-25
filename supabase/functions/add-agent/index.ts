import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { emailPattern } from "../_shared/like-escape.ts";
import { resolveOne } from "../_shared/resolve-one.ts";
import { findAuthUserByEmail, type AuthUserLister } from "../_shared/find-auth-user.ts";
import { Resend } from "https://esm.sh/resend@2.0.0";

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
  licenseStatus?: "licensed" | "unlicensed" | "pending" | "in_progress";
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
  sourceApplicationId?: string;
  compPercentage?: number;
  samApprovalRequested?: boolean;
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
      sourceApplicationId,
      compPercentage = 60,
      samApprovalRequested = false,
    } = body;

    const normalizedComp = Number(compPercentage);
    if (!Number.isFinite(normalizedComp) || normalizedComp < 50 || normalizedComp > 200) {
      return new Response(
        JSON.stringify({ error: "Comp percentage must be between 50 and 200." }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } },
      );
    }
    if (normalizedComp > 100 && samApprovalRequested !== true) {
      return new Response(
        JSON.stringify({ error: "Comp above 100% requires a Sam approval request." }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } },
      );
    }

    const normalizedNpn = (niprNumber ?? "").replace(/\D+/g, "");
    const agentLicenseStatus = licenseStatus === "in_progress" ? "pending" : licenseStatus;
    if (!["licensed", "unlicensed", "pending"].includes(agentLicenseStatus)) {
      return new Response(
        JSON.stringify({ error: "Invalid license status." }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

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

    // Managers may add only to their own hierarchy. The old endpoint trusted a
    // caller-supplied managerId while using the service role, so any manager
    // could attach a recruit to another agency branch.
    if (!isAdmin) {
      const { data: actorAgent, error: actorAgentError } = await supabaseAdmin
        .from("agents")
        .select("id")
        .eq("user_id", requestingUserId)
        .eq("is_deactivated", false)
        .limit(1)
        .maybeSingle();
      if (actorAgentError || !actorAgent || actorAgent.id !== managerId) {
        return new Response(
          JSON.stringify({ error: "Managers can add agents only to their own team." }),
          { status: 403, headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      }
    }

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
    if (agentLicenseStatus === "licensed" && (normalizedNpn.length < 5 || normalizedNpn.length > 10)) {
      return new Response(
        JSON.stringify({ error: "NPN is required for a licensed agent. Look it up free at nipr.com." }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const normalizedEmail = email.toLowerCase().trim();
    console.log(`Adding new agent: ${firstName} ${lastName} (${normalizedEmail})`);

    let sourceApplication: {
      id: string;
      assigned_agent_id: string | null;
      referral_manager_id: string | null;
      recruiter_id: string | null;
      hiring_manager_user_id: string | null;
    } | null = null;
    let sourceAgent: { id: string; user_id: string | null } | null = null;
    if (sourceApplicationId) {
      const { data, error } = await supabaseAdmin
        .from("applications")
        .select("id, assigned_agent_id, referral_manager_id, recruiter_id, hiring_manager_user_id")
        .eq("id", sourceApplicationId)
        .maybeSingle();
      if (error || !data) {
        return new Response(
          JSON.stringify({ error: "Source application was not found." }),
          { status: 404, headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      }
      const managerOwnsApplication = isAdmin || data.hiring_manager_user_id === requestingUserId || [
        data.assigned_agent_id,
        data.referral_manager_id,
        data.recruiter_id,
      ].includes(managerId);
      if (!managerOwnsApplication) {
        return new Response(
          JSON.stringify({ error: "This application is outside your hiring scope." }),
          { status: 403, headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      }
      sourceApplication = data;

      const { data: linkedAgent, error: linkedAgentError } = await supabaseAdmin
        .from("agents")
        .select("id, user_id")
        .eq("source_application_id", sourceApplicationId)
        .limit(1)
        .maybeSingle();
      if (linkedAgentError) throw linkedAgentError;
      sourceAgent = linkedAgent;
    }

    if (sourceApplication && sourceAgent?.user_id) {
      const { error: receiptError } = await supabaseAdmin
        .from("applications")
        .update({ status: "onboarding", closed_at: new Date().toISOString(), assigned_agent_id: managerId })
        .eq("id", sourceApplication.id);
      if (receiptError) throw receiptError;
      return new Response(
        JSON.stringify({
          success: true,
          existing: true,
          agentId: sourceAgent.id,
          userId: sourceAgent.user_id,
          message: `${firstName} ${lastName} already has an active agent account`,
          partial: false,
        }),
        { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } },
      );
    }

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
    const authLookup = await findAuthUserByEmail(supabaseAdmin as unknown as AuthUserLister, normalizedEmail);
    if (!authLookup.exhaustive) {
      throw new Error("Account lookup could not be completed. No account was created; please retry.");
    }
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

    // Converge with the auth trigger instead of deleting everything it made.
    // The old cleanup also deleted an existing agent/role when an auth identity
    // predated its profile, turning a repair attempt into account loss.
    const { data: newProfile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .upsert({
        user_id: userId,
        email: normalizedEmail,
        full_name: `${firstName} ${lastName}`,
        phone: phone || null,
        city: city || null,
        state: state || null,
        instagram_handle: instagramHandle || null,
      }, { onConflict: "user_id" })
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
      .upsert({ user_id: userId, role: "agent" }, { onConflict: "user_id,role", ignoreDuplicates: true });

    if (roleError) {
      console.error("Error adding agent role:", roleError);
      return new Response(
        JSON.stringify({ error: `Failed to grant agent access: ${roleError.message ?? "unknown"}`, stage: "user_roles.upsert" }),
        { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Create agent record
    const agentInsert: Record<string, unknown> = {
      user_id: userId,
      profile_id: profileId,
      // Several roster and production surfaces intentionally fall back to the
      // agent row when a profile join is unavailable. Persist the name in both
      // canonical places so a successful add never looks blank elsewhere.
      display_name: `${firstName} ${lastName}`.trim(),
      manager_id: managerId,
      invited_by_manager_id: managerId,
      source_application_id: sourceApplication?.id ?? null,
      status: "active",
      license_status: agentLicenseStatus,
      onboarding_stage: agentLicenseStatus === "licensed"
        ? (hasTrainingCourse ? "training_online" : "onboarding")
        : "pre_licensed",
      has_training_course: hasTrainingCourse || false,
      start_date: startDate || null,
      builder_track: builderTrack,
      comp_percentage: normalizedComp,
      comp_approval_status: normalizedComp > 100 ? "pending_sam" : "approved",
      comp_approved_at: normalizedComp > 100 ? null : new Date().toISOString(),
      comp_approved_by: normalizedComp > 100 ? null : requestingUserId,
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

    let newAgent: { id: string } | null = null;
    let agentError: { message?: string } | null = null;
    if (sourceAgent) {
      const result = await supabaseAdmin
        .from("agents")
        .update(agentInsert)
        .eq("id", sourceAgent.id)
        .is("user_id", null)
        .select("id")
        .maybeSingle();
      newAgent = result.data;
      agentError = result.error;
      if (!agentError && !newAgent) agentError = { message: "Application was promoted by another request" };
    } else {
      const result = await supabaseAdmin
        .from("agents")
        .insert(agentInsert)
        .select("id")
        .single();
      newAgent = result.data;
      agentError = result.error;
    }

    if (agentError || !newAgent) {
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

    let applicationLinkStatus: { ok: boolean; skipped?: boolean; error?: string } = { ok: true, skipped: true };
    if (sourceApplication) {
      const applicationPromotionPatch: Record<string, unknown> = {
        status: "onboarding",
        closed_at: new Date().toISOString(),
        assigned_agent_id: managerId,
      };
      if (normalizedNpn) applicationPromotionPatch.nipr_number = normalizedNpn;
      const { error: applicationError } = await supabaseAdmin
        .from("applications")
        .update(applicationPromotionPatch)
        .eq("id", sourceApplication.id);
      applicationLinkStatus = applicationError
        ? { ok: false, error: applicationError.message ?? String(applicationError) }
        : { ok: true };
      if (applicationError) console.error("[add-agent] application promotion update failed:", applicationError);
    }

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

    // One contracting path only: APEX intake -> Ethos spreadsheet -> private
    // contracting Discord. Manager-specific AgentLink URLs are retired.
    const contractingLink = "https://apex-financial.org/start-contracting";

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

    let compApprovalEmailStatus: SideEffectStatus = { ok: true, skipped: true };
    if (normalizedComp > 100) {
      const resendKey = Deno.env.get("RESEND_API_KEY") ?? "";
      if (!resendKey) {
        compApprovalEmailStatus = { ok: false, error: "RESEND_API_KEY missing" };
      } else {
        try {
          const resend = new Resend(resendKey);
          const { data: approvalEmail, error: approvalEmailError } = await resend.emails.send({
            from: "APEX Hiring <notifications@apex-financial.org>",
            to: ["info@kingofsales.net"],
            subject: `Comp approval needed · ${firstName} ${lastName} · ${normalizedComp}%`,
            html: `<p><strong>${firstName} ${lastName}</strong> was added at <strong>${normalizedComp}% comp</strong>.</p><p>The account remains pending Sam approval because the requested comp is above 100%.</p><p><a href="https://apex-financial.org/dashboard/crm">Open the agent profile to approve or change comp</a></p>`,
          });
          compApprovalEmailStatus = approvalEmailError || !approvalEmail?.id
            ? { ok: false, error: approvalEmailError?.message ?? "email provider returned no id" }
            : { ok: true };
        } catch (error) {
          compApprovalEmailStatus = {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }
    }

    const transferStatus: SideEffectStatus = !transferNeeded
      ? { ok: true, skipped: true }
      : transferNoteError || transferStampError
        ? { ok: false, error: [transferNoteError, transferStampError].filter(Boolean).join("; ") }
        : { ok: true };

    // Licensed direct-adds already contain the exact five contracting fields.
    // Route them through the same idempotent intake used by the public page so
    // the real Ethos write and private Discord receipt stay one workflow.
    let contractingPostStatus: SideEffectStatus = { ok: true, skipped: true };
    if (agentLicenseStatus === "licensed") {
      const { data: intakeData, error: intakeError } = await supabaseAdmin.rpc("submit_contracting_intake", {
        p_first_name: firstName,
        p_last_name: lastName,
        p_email: normalizedEmail,
        p_phone: phone,
        p_npn: normalizedNpn,
        p_source: "add_agent",
        p_submitted_by: requestingUserId,
      });
      const intake = intakeData as { ok?: boolean; error?: string; intake_id?: string } | null;
      contractingPostStatus = intakeError || !intake?.ok
        ? { ok: false, error: intakeError?.message ?? intake?.error ?? "contracting intake failed" }
        : { ok: true };
    }

    const sideEffectFailures: string[] = [];
    if (!welcomeEmailStatus.ok) sideEffectFailures.push("welcome email");
    if (!courseEmailStatus.ok) sideEffectFailures.push("course enrollment email");
    if (!compApprovalEmailStatus.ok) sideEffectFailures.push("Sam comp approval email");
    if (!transferStatus.ok) sideEffectFailures.push("transfer note");
    if (!contractingPostStatus.ok) sideEffectFailures.push("contracting spreadsheet/Discord queue");
    if (!applicationLinkStatus.ok) sideEffectFailures.push("application promotion receipt");

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
          compApprovalEmail: compApprovalEmailStatus,
          transferBlock: transferStatus,
          contractingPost: contractingPostStatus,
          applicationPromotion: applicationLinkStatus,
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
