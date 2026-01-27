import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface SimpleLoginRequest {
  identifier: string; // email or phone
  password?: string; // optional - only if password_required
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { identifier, password }: SimpleLoginRequest = await req.json();

    if (!identifier) {
      return new Response(
        JSON.stringify({ error: "Email or phone is required", code: "MISSING_IDENTIFIER" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const trimmedInput = identifier.trim();
    const digitsOnly = trimmedInput.replace(/\D/g, "");
    const isPhone = /^[\d\s\-\(\)\+]+$/.test(trimmedInput) && digitsOnly.length >= 10;

    console.log(`Simple login attempt for: ${trimmedInput} (isPhone: ${isPhone})`);

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Find profile in CRM
    let profile = null;
    
    if (isPhone) {
      const last10 = digitsOnly.slice(-10);
      const { data, error } = await supabaseAdmin
        .from("profiles")
        .select("id, user_id, full_name, email, phone")
        .or(`phone.ilike.%${last10}%`)
        .order("created_at", { ascending: false })
        .limit(1);
      
      if (!error && data?.[0]) {
        profile = data[0];
      }
    } else {
      const normalizedEmail = trimmedInput.toLowerCase();
      const { data, error } = await supabaseAdmin
        .from("profiles")
        .select("id, user_id, full_name, email, phone")
        .ilike("email", normalizedEmail)
        .order("created_at", { ascending: false })
        .limit(1);
      
      if (!error && data?.[0]) {
        profile = data[0];
      }
    }

    // Not in CRM - needs account creation
    if (!profile) {
      console.log(`No CRM match for: ${trimmedInput}`);
      return new Response(
        JSON.stringify({ 
          needsAccount: true,
          message: "No account found. Create one to continue."
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`CRM match found: ${profile.full_name} (${profile.email})`);

    // Check if user has a Supabase Auth account
    const { data: authUser, error: authError } = await supabaseAdmin.auth.admin.getUserById(profile.user_id);
    
    if (authError || !authUser?.user) {
      console.log(`No auth account for user_id: ${profile.user_id}`);
      return new Response(
        JSON.stringify({ 
          needsAccount: true,
          crmName: profile.full_name,
          crmEmail: profile.email,
          message: "Account found but needs password setup."
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check if password is required for this agent
    const { data: agent } = await supabaseAdmin
      .from("agents")
      .select("password_required")
      .eq("user_id", profile.user_id)
      .maybeSingle();

    const passwordRequired = agent?.password_required ?? false;

    // If password required but not provided, return that
    if (passwordRequired && !password) {
      return new Response(
        JSON.stringify({ 
          requiresPassword: true,
          email: authUser.user.email,
          name: profile.full_name
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // If password provided, verify it
    if (passwordRequired && password) {
      // Use signInWithPassword to verify
      const supabaseClient = createClient(
        Deno.env.get("SUPABASE_URL") ?? "",
        Deno.env.get("SUPABASE_ANON_KEY") ?? ""
      );
      
      const { data: signInData, error: signInError } = await supabaseClient.auth.signInWithPassword({
        email: authUser.user.email!,
        password: password,
      });

      if (signInError) {
        return new Response(
          JSON.stringify({ error: "Invalid password", code: "INVALID_PASSWORD" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Return the session from password login
      return new Response(
        JSON.stringify({ 
          success: true,
          session: signInData.session,
          user: signInData.user,
          name: profile.full_name
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // SIMPLE LOGIN (no password required) - generate OTP token
    const { data: otpData, error: otpError } = await supabaseAdmin.auth.admin.generateLink({
      type: "magiclink",
      email: authUser.user.email!,
    });

    if (otpError || !otpData) {
      console.error("Failed to generate OTP:", otpError);
      return new Response(
        JSON.stringify({ error: "Failed to create session", code: "OTP_ERROR" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const tokenHash = otpData.properties?.hashed_token;
    
    if (!tokenHash) {
      console.error("No hashed_token in OTP response");
      return new Response(
        JSON.stringify({ error: "Authentication failed", code: "NO_HASH" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Simple login successful for: ${profile.full_name}`);

    // Send login notification in background (don't await)
    const userAgent = req.headers.get("user-agent") || "";
    fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/notify-agent-login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
      },
      body: JSON.stringify({
        email: authUser.user.email,
        name: profile.full_name,
        userAgent,
      }),
    }).catch(err => console.error("Login notification failed:", err));

    return new Response(
      JSON.stringify({ 
        success: true,
        email: authUser.user.email,
        tokenHash: tokenHash,
        type: "magiclink",
        name: profile.full_name
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: any) {
    console.error("Error in simple-login:", error);
    return new Response(
      JSON.stringify({ error: error.message, code: "UNKNOWN_ERROR" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
};

serve(handler);
