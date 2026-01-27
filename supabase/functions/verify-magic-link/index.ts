import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const BASE_URL = "https://apex-financial.org";

interface VerifyMagicLinkRequest {
  token: string;
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { token }: VerifyMagicLinkRequest = await req.json();

    if (!token) {
      return new Response(
        JSON.stringify({ error: "Missing token", code: "MISSING_TOKEN" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseAdmin = createClient(
      SUPABASE_URL,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Find and validate token
    const { data: tokenRecord, error: fetchError } = await supabaseAdmin
      .from("magic_login_tokens")
      .select("*")
      .eq("token", token)
      .maybeSingle();

    if (fetchError) {
      console.error("Error fetching token:", fetchError);
      return new Response(
        JSON.stringify({ error: "Database error", code: "DB_ERROR" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!tokenRecord) {
      console.log(`Token not found: ${token.substring(0, 8)}...`);
      return new Response(
        JSON.stringify({ error: "Invalid or expired link", code: "INVALID_TOKEN" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check if already used
    if (tokenRecord.used_at) {
      console.log(`Token already used: ${token.substring(0, 8)}...`);
      return new Response(
        JSON.stringify({ error: "This link has already been used", code: "ALREADY_USED" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check if expired
    if (new Date(tokenRecord.expires_at) < new Date()) {
      console.log(`Token expired: ${token.substring(0, 8)}...`);
      return new Response(
        JSON.stringify({ error: "This link has expired", code: "EXPIRED" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Mark token as used immediately to prevent race conditions
    await supabaseAdmin
      .from("magic_login_tokens")
      .update({ used_at: new Date().toISOString() })
      .eq("id", tokenRecord.id);

    // Get the agent's user_id
    const { data: agent, error: agentError } = await supabaseAdmin
      .from("agents")
      .select("user_id")
      .eq("id", tokenRecord.agent_id)
      .single();

    if (agentError || !agent?.user_id) {
      console.error("Agent not found or no user_id:", agentError);
      return new Response(
        JSON.stringify({ error: "Account not found", code: "NO_ACCOUNT" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get the user's email from auth.users
    const { data: userData, error: userError } = await supabaseAdmin.auth.admin.getUserById(agent.user_id);
    
    if (userError || !userData?.user) {
      console.error("User not found:", userError);
      return new Response(
        JSON.stringify({ error: "User account not found", code: "NO_USER" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Generate a magic link that will work directly - use email OTP
    const { data: otpData, error: otpError } = await supabaseAdmin.auth.admin.generateLink({
      type: "magiclink",
      email: userData.user.email!,
      options: {
        redirectTo: `${BASE_URL}/${tokenRecord.destination === "numbers" ? "apex-daily-numbers" : "agent-portal"}`,
      },
    });

    if (otpError || !otpData) {
      console.error("Failed to generate OTP link:", otpError);
      return new Response(
        JSON.stringify({ error: "Failed to create login session", code: "OTP_ERROR" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Magic link verified for ${tokenRecord.email}, destination: ${tokenRecord.destination}`);

    // Return the properties needed for the frontend to complete the login
    return new Response(
      JSON.stringify({ 
        success: true,
        email: tokenRecord.email,
        destination: tokenRecord.destination,
        // The action_link is a Supabase auth URL that will sign in the user
        authLink: otpData.properties.action_link,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Error in verify-magic-link:", error);
    return new Response(
      JSON.stringify({ error: error.message, code: "UNKNOWN_ERROR" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
};

serve(handler);
