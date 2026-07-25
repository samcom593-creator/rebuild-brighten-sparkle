import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
    } = body;

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

    const normalizedEmail = email.toLowerCase().trim();
    console.log(`Adding new agent: ${firstName} ${lastName} (${normalizedEmail})`);

    // Check if email already exists in profiles
    const { data: existingProfile } = await supabaseAdmin
      .from("profiles")
      .select("id, user_id, email")
      .ilike("email", normalizedEmail)
      .maybeSingle();

    if (existingProfile) {
      console.log(`Profile already exists for ${normalizedEmail}`);
      return new Response(
        JSON.stringify({ error: `An agent with email ${normalizedEmail} already exists.` }),
        { status: 409, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Check if auth user already exists
    const { data: authUsers } = await supabaseAdmin.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    });

    const existingAuthUser = authUsers?.users?.find(
      (u) => u.email?.toLowerCase() === normalizedEmail
    );

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
      await supabaseAdmin.from("agent_notes").insert({
        agent_id: newAgent.id,
        note: blockLines,
        created_by: requestingUserId,
      });
      // Stamp the agent row so dashboards can flag transfer agents
      await supabaseAdmin.from("agents").update({
        notes: `[NEEDS TRANSFER] owner=${managerId} created=${nowIso} next=Confirm carrier releases ${tCarriers ?? ""}`.slice(0, 500),
      }).eq("id", newAgent.id);
      console.log(`Added transfer block note for agent ${newAgent.id}`);
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

    const sideEffectFailures: string[] = [];
    if (!welcomeEmailStatus.ok) sideEffectFailures.push("welcome email");
    if (!courseEmailStatus.ok) sideEffectFailures.push("course enrollment email");

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
