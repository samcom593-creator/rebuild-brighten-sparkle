import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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

    const { email, password } = await req.json();

    if (!email || !password) {
      throw new Error("Email and password are required");
    }

    if (password.length < 6) {
      throw new Error("Password must be at least 6 characters");
    }

    const normalizedEmail = email.toLowerCase().trim();
    console.log(`Setting up password for CRM user: ${normalizedEmail}`);

    // 1. Verify email exists in profiles table
    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("id, user_id, full_name")
      .ilike("email", normalizedEmail)
      .maybeSingle();

    if (profileError || !profile) {
      console.error("Profile not found:", profileError);
      throw new Error("Email not found in CRM. Please create a new account instead.");
    }

    // 2. Check if auth user already exists for this email
    const { data: authUsers } = await supabaseAdmin.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    });
    
    const existingAuthUser = authUsers?.users?.find(
      (u) => u.email?.toLowerCase() === normalizedEmail
    );

    if (existingAuthUser) {
      throw new Error("An account with this email already exists. Please use the login form or reset your password.");
    }

    // 3. Create new auth user with email confirmed
    const { data: newAuthUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email: normalizedEmail,
      password: password,
      email_confirm: true,
      user_metadata: {
        full_name: profile.full_name,
      },
    });

    if (createError || !newAuthUser?.user) {
      console.error("Error creating auth user:", createError);
      throw new Error("Failed to create account. Please try again.");
    }

    const newUserId = newAuthUser.user.id;
    console.log(`Created auth user: ${newUserId}`);

    // 4. Delete the trigger-created profile (it has newUserId) to avoid unique constraint violation
    const { error: deleteProfileError } = await supabaseAdmin
      .from("profiles")
      .delete()
      .eq("user_id", newUserId);

    if (deleteProfileError) {
      console.log("No trigger-created profile to delete or error:", deleteProfileError.message);
    }

    // 5. Delete the trigger-created role to avoid duplicates
    const { error: deleteRoleError } = await supabaseAdmin
      .from("user_roles")
      .delete()
      .eq("user_id", newUserId);

    if (deleteRoleError) {
      console.log("No trigger-created role to delete or error:", deleteRoleError.message);
    }

    // 6. Now safely update the EXISTING profile to link to new auth user
    const { error: profileUpdateError } = await supabaseAdmin
      .from("profiles")
      .update({ user_id: newUserId })
      .eq("id", profile.id);

    if (profileUpdateError) {
      console.error("Error updating profile:", profileUpdateError);
      // Don't fail - the user can still log in
    }

    // 7. Find and update the agent record
    const { data: agent, error: agentError } = await supabaseAdmin
      .from("agents")
      .select("id")
      .eq("profile_id", profile.id)
      .maybeSingle();

    if (agent) {
      const { error: agentUpdateError } = await supabaseAdmin
        .from("agents")
        .update({ 
          user_id: newUserId,
          portal_password_set: true 
        })
        .eq("id", agent.id);

      if (agentUpdateError) {
        console.error("Error updating agent:", agentUpdateError);
      }
    } else {
      // Try to find agent by old user_id (placeholder UUID)
      if (profile.user_id) {
        const { error: agentUpdateError } = await supabaseAdmin
          .from("agents")
          .update({ 
            user_id: newUserId,
            portal_password_set: true 
          })
          .eq("user_id", profile.user_id);

        if (agentUpdateError) {
          console.error("Error updating agent by old user_id:", agentUpdateError);
        }
      }
    }

    // 8. Add agent role cleanly (we deleted the trigger-created one)
    const { error: roleError } = await supabaseAdmin
      .from("user_roles")
      .insert({ user_id: newUserId, role: "agent" });

    if (roleError) {
      console.error("Error adding agent role:", roleError);
    }

    console.log(`Password setup complete for: ${normalizedEmail}`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: "Password set successfully. You can now log in." 
      }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  } catch (error: any) {
    console.error("Error in setup-agent-password:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
};

serve(handler);
