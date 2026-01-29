import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
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

    const { email, password, fullName, phone } = await req.json();

    if (!email || !password || !fullName) {
      throw new Error("Email, password, and full name are required");
    }

    if (password.length < 6) {
      throw new Error("Password must be at least 6 characters");
    }

    const normalizedEmail = email.toLowerCase().trim();
    console.log(`Creating new agent account for: ${normalizedEmail}`);

    // 1. Check if email already exists in profiles
    const { data: existingProfile } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .ilike("email", normalizedEmail)
      .maybeSingle();

    if (existingProfile) {
      throw new Error("This email is already registered. Please use the login form or set up your password.");
    }

    // 2. Check if auth user already exists
    const { data: authUsers } = await supabaseAdmin.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    });
    
    const existingAuthUser = authUsers?.users?.find(
      (u) => u.email?.toLowerCase() === normalizedEmail
    );
    
    if (existingAuthUser) {
      throw new Error("An account with this email already exists. Please log in instead.");
    }

    // 3. Create auth user with email confirmed
    const { data: newAuthUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email: normalizedEmail,
      password: password,
      email_confirm: true,
      user_metadata: {
        full_name: fullName,
      },
    });

    if (createError || !newAuthUser?.user) {
      console.error("Error creating auth user:", createError);
      throw new Error("Failed to create account. Please try again.");
    }

    const userId = newAuthUser.user.id;
    console.log(`Created auth user: ${userId}`);

    // 4. Delete the trigger-created profile (it has userId) to avoid unique constraint violation
    const { error: deleteProfileError } = await supabaseAdmin
      .from("profiles")
      .delete()
      .eq("user_id", userId);

    if (deleteProfileError) {
      console.log("No trigger-created profile to delete or error:", deleteProfileError.message);
    }

    // 5. Delete the trigger-created role to avoid duplicates
    const { error: deleteRoleError } = await supabaseAdmin
      .from("user_roles")
      .delete()
      .eq("user_id", userId);

    if (deleteRoleError) {
      console.log("No trigger-created role to delete or error:", deleteRoleError.message);
    }

    // 6. Create profile record fresh
    const { data: newProfile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .insert({
        user_id: userId,
        email: normalizedEmail,
        full_name: fullName,
        phone: phone || null,
      })
      .select("id")
      .single();

    if (profileError) {
      console.error("Error creating profile:", profileError);
      // Try to clean up the auth user
      await supabaseAdmin.auth.admin.deleteUser(userId);
      throw new Error("Failed to create profile. Please try again.");
    }

    console.log(`Created profile: ${newProfile.id} for user: ${userId}`);

    // 7. Create agent record
    const { data: newAgent, error: agentError } = await supabaseAdmin
      .from("agents")
      .insert({
        user_id: userId,
        profile_id: newProfile.id,
        status: "active",
        onboarding_stage: "evaluated",
        license_status: "unlicensed",
        portal_password_set: true,
      })
      .select("id")
      .single();

    if (agentError) {
      console.error("Error creating agent:", agentError);
      // Don't fail - user can still log in
    } else {
      console.log(`Created agent: ${newAgent?.id} with profile_id: ${newProfile.id} for user: ${userId}`);
    }

    // 8. Add agent role (we deleted the trigger-created one)
    const { error: roleError } = await supabaseAdmin
      .from("user_roles")
      .insert({ user_id: userId, role: "agent" });

    if (roleError) {
      console.error("Error adding agent role:", roleError);
    }

    console.log(`Account created successfully for: ${normalizedEmail}`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: "Account created successfully. You can now log in." 
      }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  } catch (error: any) {
    console.error("Error in create-new-agent-account:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
};

serve(handler);
