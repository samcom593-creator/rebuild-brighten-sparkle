import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";

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

    console.log(`Verifying magic token: ${token.substring(0, 8)}...`);

    const supabaseAdmin = createClient(
      SUPABASE_URL,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Find and validate token - DO NOT mark as used yet
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

    // Check if already used — allow re-verification within 5-minute grace window
    if (tokenRecord.used_at) {
      const usedAt = new Date(tokenRecord.used_at).getTime();
      const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
      if (usedAt < fiveMinutesAgo) {
        console.log(`Token already used (beyond grace window): ${token.substring(0, 8)}...`);
        return new Response(
          JSON.stringify({ error: "This link has already been used", code: "ALREADY_USED" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      console.log(`Token re-use within grace window: ${token.substring(0, 8)}...`);
    }

    // Check if expired
    if (new Date(tokenRecord.expires_at) < new Date()) {
      console.log(`Token expired: ${token.substring(0, 8)}...`);
      return new Response(
        JSON.stringify({ error: "This link has expired", code: "EXPIRED" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

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

    // Generate a magic link to get the OTP token hash
    const { data: otpData, error: otpError } = await supabaseAdmin.auth.admin.generateLink({
      type: "magiclink",
      email: userData.user.email!,
    });

    if (otpError || !otpData) {
      console.error("Failed to generate OTP link:", otpError);
      return new Response(
        JSON.stringify({ error: "Failed to create login session", code: "OTP_ERROR" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Extract the token hash from properties
    const tokenHash = otpData.properties?.hashed_token;
    
    if (!tokenHash) {
      console.error("No hashed_token in OTP response:", JSON.stringify(otpData.properties));
      return new Response(
        JSON.stringify({ error: "Authentication token generation failed", code: "NO_HASH" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // NOW mark token as used - after successful OTP generation
    await supabaseAdmin
      .from("magic_login_tokens")
      .update({ used_at: new Date().toISOString() })
      .eq("id", tokenRecord.id);

    console.log(`Magic link verified for ${tokenRecord.email}, destination: ${tokenRecord.destination}, tokenHash present: true`);

    // Return the data needed for frontend verifyOtp
    return new Response(
      JSON.stringify({ 
        success: true,
        email: userData.user.email,
        destination: tokenRecord.destination,
        tokenHash: tokenHash,
        type: "magiclink",
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
