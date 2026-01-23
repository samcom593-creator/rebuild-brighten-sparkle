import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface SignupRequest {
  refCode: string;
  email: string;
  password: string;
  fullName: string;
  managerAgentId: string;
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    const { refCode, email, password, fullName, managerAgentId }: SignupRequest = await req.json();

    // Validate required fields
    if (!refCode || !email || !password || !fullName || !managerAgentId) {
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return new Response(
        JSON.stringify({ error: "Invalid email format" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate password length
    if (password.length < 6) {
      return new Response(
        JSON.stringify({ error: "Password must be at least 6 characters" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verify the invite link exists and is active
    const { data: inviteLink, error: inviteError } = await supabaseAdmin
      .from("manager_invite_links")
      .select("id, manager_agent_id, is_active")
      .eq("invite_code", refCode)
      .eq("is_active", true)
      .single();

    if (inviteError || !inviteLink) {
      return new Response(
        JSON.stringify({ error: "Invalid or expired invite link" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verify the manager_agent_id matches
    if (inviteLink.manager_agent_id !== managerAgentId) {
      return new Response(
        JSON.stringify({ error: "Invalid invite link" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Create the auth user with service role (bypasses email confirmation)
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: fullName,
      },
    });

    if (authError) {
      console.error("Auth error:", authError);
      return new Response(
        JSON.stringify({ error: authError.message }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const userId = authData.user.id;

    // Create agent record linked to the inviting manager
    const { error: agentError } = await supabaseAdmin
      .from("agents")
      .insert({
        user_id: userId,
        invited_by_manager_id: managerAgentId,
        status: "active",
        license_status: "unlicensed",
        onboarding_stage: "onboarding",
      });

    if (agentError) {
      console.error("Agent creation error:", agentError);
      // Rollback: delete the auth user
      await supabaseAdmin.auth.admin.deleteUser(userId);
      return new Response(
        JSON.stringify({ error: "Failed to create agent profile" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // The user_roles table will be auto-populated by the handle_new_user trigger with 'agent' role

    // Log the activity
    await supabaseAdmin.from("activity_logs").insert({
      user_id: userId,
      action: "agent_signup",
      entity_type: "agent",
      details: {
        invited_by_manager_id: managerAgentId,
        ref_code: refCode,
      },
    });

    console.log(`Agent ${email} created successfully, linked to manager ${managerAgentId}`);

    return new Response(
      JSON.stringify({
        success: true,
        message: "Account created successfully",
        userId,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Agent signup error:", error);
    return new Response(
      JSON.stringify({ error: "An unexpected error occurred" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
