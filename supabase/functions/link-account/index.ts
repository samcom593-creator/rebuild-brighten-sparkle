import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface LinkAccountRequest {
  email?: string;
  agentCode?: string;
  phone?: string;
}

const HUMAN_NOT_FOUND =
  "We couldn't find an application matching your email or phone. Make sure you're using the same details you applied with — or contact sam@apex-financial.org for help.";
const HUMAN_GENERIC =
  "Something went wrong linking your account. Please contact sam@apex-financial.org and we'll get you set up.";

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Please sign in first, then try linking your account." }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(token);

    if (userError || !userData?.user) {
      console.error("[link-account] Invalid token:", userError);
      return new Response(JSON.stringify({ error: "Your session expired. Please sign in again." }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userId = userData.user.id;
    const userEmail = userData.user.email;

    const { email, agentCode, phone }: LinkAccountRequest = await req.json();

    if (!email && !agentCode && !phone) {
      return new Response(
        JSON.stringify({ error: "Please enter your email, phone, or agent code." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const normalizedEmail = email?.toLowerCase().trim() || null;
    const normalizedPhone = phone?.replace(/\D/g, "").slice(-10) || null;

    console.log(`[link-account] User=${userId} email=${normalizedEmail} phone=${normalizedPhone} code=${agentCode}`);

    // If already linked, succeed silently
    const { data: existingAgent } = await supabaseAdmin
      .from("agents")
      .select("id")
      .eq("user_id", userId)
      .maybeSingle();

    if (existingAgent) {
      return new Response(
        JSON.stringify({
          error: "Your account is already linked. Try refreshing the page.",
          alreadyLinked: true,
          agentId: existingAgent.id,
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ----- STEP 1: Find application by email OR phone -----
    let application: any = null;

    if (normalizedEmail) {
      const { data, error } = await supabaseAdmin
        .from("applications")
        .select("*")
        .ilike("email", normalizedEmail)
        .is("terminated_at", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) console.error("[link-account] Email lookup error:", error);
      application = data;
    }

    if (!application && normalizedPhone && normalizedPhone.length === 10) {
      const { data: allApps, error } = await supabaseAdmin
        .from("applications")
        .select("*")
        .is("terminated_at", null)
        .order("created_at", { ascending: false })
        .limit(2000);
      if (error) console.error("[link-account] Phone lookup error:", error);
      application =
        allApps?.find(
          (a: any) => a.phone?.replace(/\D/g, "").slice(-10) === normalizedPhone
        ) || null;
    }

    // ----- STEP 2: Find agent records (handle duplicates) -----
    let agentRecords: any[] | null = null;

    if (application) {
      // Look up via profile linked to this application's email
      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("id")
        .ilike("email", application.email)
        .order("created_at", { ascending: false });

      const profileIds = (profile || []).map((p: any) => p.id);
      if (profileIds.length > 0) {
        const { data } = await supabaseAdmin
          .from("agents")
          .select("*")
          .in("profile_id", profileIds)
          .order("created_at", { ascending: false });
        agentRecords = data || [];
      }
    } else if (agentCode) {
      const { data } = await supabaseAdmin
        .from("agents")
        .select("*")
        .ilike("agent_code", agentCode.trim())
        .order("created_at", { ascending: false });
      agentRecords = data || [];
    }

    if (!application && (!agentRecords || agentRecords.length === 0)) {
      console.warn(`[link-account] No application/agent found for ${normalizedEmail || normalizedPhone || agentCode}`);
      return new Response(
        JSON.stringify({ error: HUMAN_NOT_FOUND, code: "APPLICATION_NOT_FOUND" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let agent: any = null;

    if (agentRecords && agentRecords.length > 1) {
      // Multiple agents — pick most recent active one, flag others
      agent = agentRecords.find((a: any) => !a.is_deactivated) || agentRecords[0];
      console.warn(
        `[link-account] DUPLICATE agents for ${normalizedEmail}: ${agentRecords.map((a: any) => a.id).join(", ")} — keeping ${agent.id}`
      );
      await supabaseAdmin.from("duplicate_agent_flags").insert({
        agent_ids: agentRecords.map((a: any) => a.id),
        email: normalizedEmail,
        phone: normalizedPhone,
        reason: "Multiple agent records found during account linking",
      });
    } else if (agentRecords && agentRecords.length === 1) {
      agent = agentRecords[0];
    }

    // ----- STEP 3: Create agent record if none exists -----
    if (!agent && application) {
      console.log(`[link-account] Creating new agent for application ${application.id}`);
      const { data: newAgent, error: createErr } = await supabaseAdmin
        .from("agents")
        .insert({
          user_id: userId,
          profile_id: null, // linked below
          status: "active",
          license_status: application.license_status || "unlicensed",
          onboarding_stage:
            application.license_status === "licensed" ? "in_field_training" : "pre_licensed",
          invited_by_manager_id: application.assigned_agent_id,
        })
        .select()
        .single();
      if (createErr) {
        console.error("[link-account] Create agent failed:", createErr);
        return new Response(JSON.stringify({ error: HUMAN_GENERIC }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      agent = newAgent;
    }

    if (!agent) {
      return new Response(
        JSON.stringify({ error: HUMAN_NOT_FOUND, code: "APPLICATION_NOT_FOUND" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ----- STEP 4: Link agent to current user -----
    const { error: updateError } = await supabaseAdmin
      .from("agents")
      .update({
        user_id: userId,
        status: "active",
        portal_password_set: true,
        is_deactivated: false,
      })
      .eq("id", agent.id);

    if (updateError) {
      console.error("[link-account] Update agent failed:", updateError);
      return new Response(JSON.stringify({ error: HUMAN_GENERIC }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Ensure profile linked to this user
    const { data: existingProfile } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("user_id", userId)
      .maybeSingle();

    if (!existingProfile && agent.profile_id) {
      await supabaseAdmin
        .from("profiles")
        .update({ user_id: userId })
        .eq("id", agent.profile_id);
    } else if (!existingProfile) {
      const fallbackName =
        agent.display_name ||
        (application ? `${application.first_name} ${application.last_name}`.trim() : "Agent");
      await supabaseAdmin.from("profiles").insert({
        user_id: userId,
        email: userEmail || normalizedEmail || application?.email || "",
        full_name: fallbackName,
      });
    }

    // Ensure agent role
    const { data: roleCheck } = await supabaseAdmin
      .from("user_roles")
      .select("id")
      .eq("user_id", userId)
      .eq("role", "agent")
      .maybeSingle();
    if (!roleCheck) {
      await supabaseAdmin.from("user_roles").insert({ user_id: userId, role: "agent" });
    }

    console.log(`[link-account] ✅ Linked user ${userId} -> agent ${agent.id}`);

    return new Response(
      JSON.stringify({ success: true, message: "Account linked successfully", agentId: agent.id }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("[link-account] Unhandled error:", error);
    return new Response(JSON.stringify({ error: HUMAN_GENERIC }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
};

serve(handler);
