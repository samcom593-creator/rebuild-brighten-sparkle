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
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // Verify calling user
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } }
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } =
      await supabaseClient.auth.getClaims(token);

    if (claimsError || !claimsData?.claims?.sub) {
      console.error("Invalid token:", claimsError);
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userId = claimsData.claims.sub as string;
    const userEmail = claimsData.claims.email as string | undefined;

    const { email, agentCode }: LinkAccountRequest = await req.json();

    if (!email && !agentCode) {
      return new Response(
        JSON.stringify({ error: "Email or agent code required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Link request from user ${userId}: email=${email}, code=${agentCode}`);

    // Check if user already has an agent record
    const { data: existingAgent } = await supabaseAdmin
      .from("agents")
      .select("id")
      .eq("user_id", userId)
      .maybeSingle();

    if (existingAgent) {
      return new Response(
        JSON.stringify({ error: "Your account is already linked to an agent profile", alreadyLinked: true }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Find matching agent by email or code
    let agentQuery = supabaseAdmin
      .from("agents")
      .select("id, user_id, profile_id, status, display_name, profiles(id, email, full_name)")
      .is("user_id", null); // Only unlinked agents

    if (email) {
      // Look for agent with matching profile email
      const normalizedEmail = email.toLowerCase().trim();
      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("id")
        .ilike("email", normalizedEmail)
        .maybeSingle();

      if (profile) {
        agentQuery = agentQuery.eq("profile_id", profile.id);
      } else {
        // No profile with that email - try checking if there's an agent with matching display name or check applications
        const { data: application } = await supabaseAdmin
          .from("applications")
          .select("id, first_name, last_name, email, phone, status, contracted_at")
          .ilike("email", normalizedEmail)
          .maybeSingle();

        if (application && application.contracted_at) {
          // Find agent created from this application (via display_name match or other heuristic)
          const fullName = `${application.first_name} ${application.last_name}`.trim();
          agentQuery = agentQuery.ilike("display_name", fullName);
        } else {
          return new Response(
            JSON.stringify({ error: "No agent profile found with this email" }),
            { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }
    } else if (agentCode) {
      agentQuery = agentQuery.ilike("agent_code", agentCode.trim());
    }

    const { data: agents, error: agentError } = await agentQuery.limit(1);

    if (agentError) {
      console.error("Error finding agent:", agentError);
      return new Response(
        JSON.stringify({ error: "Database error" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!agents || agents.length === 0) {
      return new Response(
        JSON.stringify({ error: "No matching unlinked agent profile found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const agent = agents[0];
    console.log(`Found agent ${agent.id} to link with user ${userId}`);

    // Link the agent to this user
    const { error: updateError } = await supabaseAdmin
      .from("agents")
      .update({
        user_id: userId,
        status: "active",
        portal_password_set: true,
      })
      .eq("id", agent.id);

    if (updateError) {
      console.error("Error linking agent:", updateError);
      return new Response(
        JSON.stringify({ error: "Failed to link account" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Update or create profile for this user if needed
    const { data: existingProfile } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("user_id", userId)
      .maybeSingle();

    if (!existingProfile && agent.profile_id) {
      // Update the agent's profile to point to this user
      await supabaseAdmin
        .from("profiles")
        .update({ user_id: userId })
        .eq("id", agent.profile_id);
    } else if (!existingProfile) {
      // Create a new profile
      await supabaseAdmin.from("profiles").insert({
        user_id: userId,
        email: userEmail || email || "",
        full_name: agent.display_name || "Agent",
      });
    }

    // Ensure agent role exists
    const { data: roleCheck } = await supabaseAdmin
      .from("user_roles")
      .select("id")
      .eq("user_id", userId)
      .eq("role", "agent")
      .maybeSingle();

    if (!roleCheck) {
      await supabaseAdmin.from("user_roles").insert({
        user_id: userId,
        role: "agent",
      });
    }

    console.log(`Successfully linked user ${userId} to agent ${agent.id}`);

    return new Response(
      JSON.stringify({
        success: true,
        message: "Account linked successfully",
        agentId: agent.id,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Error in link-account:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
};

serve(handler);
