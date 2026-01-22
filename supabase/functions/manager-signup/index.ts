import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface SignupRequest {
  token: string;
  email: string;
  password: string;
  fullName: string;
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    
    // Use service role client for admin operations
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
    
    const { token, email, password, fullName }: SignupRequest = await req.json();

    // Validate required fields
    if (!token || !email || !password || !fullName) {
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

    // Validate token - server-side validation with service role
    const { data: tokenData, error: tokenError } = await supabaseAdmin
      .from("manager_signup_tokens")
      .select("id, manager_name, manager_email, is_used, expires_at, created_by")
      .eq("token", token)
      .single();

    if (tokenError || !tokenData) {
      console.error("Token validation error:", tokenError);
      return new Response(
        JSON.stringify({ error: "Invalid invite token" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (tokenData.is_used) {
      return new Response(
        JSON.stringify({ error: "This invite link has already been used" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (new Date(tokenData.expires_at) < new Date()) {
      return new Response(
        JSON.stringify({ error: "This invite link has expired" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Create the auth account using admin client
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // Auto-confirm since they have a valid token
      user_metadata: {
        full_name: fullName,
      },
    });

    if (authError) {
      console.error("Auth creation error:", authError);
      if (authError.message?.includes("already been registered")) {
        return new Response(
          JSON.stringify({ error: "This email is already registered. Please log in instead." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      return new Response(
        JSON.stringify({ error: authError.message || "Failed to create account" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const userId = authData.user.id;

    // Create agent record with active status (pre-approved via token)
    const { error: agentError } = await supabaseAdmin
      .from("agents")
      .insert({
        user_id: userId,
        status: "active",
        license_status: "unlicensed",
        verified_at: new Date().toISOString(),
        verified_by: tokenData.created_by,
      });

    if (agentError) {
      console.error("Agent creation error:", agentError);
      // Continue anyway - trigger may have created it
    }

    // Delete the default 'agent' role assigned by trigger and add 'manager' role
    // The trigger handle_new_user() assigns 'agent' by default
    await supabaseAdmin
      .from("user_roles")
      .delete()
      .eq("user_id", userId)
      .eq("role", "agent");

    const { error: roleError } = await supabaseAdmin
      .from("user_roles")
      .insert({
        user_id: userId,
        role: "manager",
      });

    if (roleError) {
      console.error("Role assignment error:", roleError);
      // This is critical - rollback by deleting the user
      await supabaseAdmin.auth.admin.deleteUser(userId);
      return new Response(
        JSON.stringify({ error: "Failed to assign manager role" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Mark token as used
    const { error: tokenUpdateError } = await supabaseAdmin
      .from("manager_signup_tokens")
      .update({
        is_used: true,
        used_at: new Date().toISOString(),
        used_by: userId,
      })
      .eq("id", tokenData.id);

    if (tokenUpdateError) {
      console.error("Token update error:", tokenUpdateError);
      // Non-critical, continue
    }

    // Log the activity
    await supabaseAdmin
      .from("activity_logs")
      .insert({
        user_id: userId,
        action: "manager_signup_completed",
        entity_type: "user",
        entity_id: userId,
        details: {
          email,
          full_name: fullName,
          token_id: tokenData.id,
          created_by: tokenData.created_by,
        },
      });

    console.log(`Manager account created successfully for ${email}`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: "Account created successfully",
        userId 
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Manager signup error:", error);
    return new Response(
      JSON.stringify({ error: "An unexpected error occurred" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
