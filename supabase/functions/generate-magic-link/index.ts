import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const BASE_URL = "https://rebuild-brighten-sparkle.lovable.app";

interface GenerateMagicLinkRequest {
  agentId: string;
  email: string;
  destination?: "portal" | "numbers";
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { agentId, email, destination = "portal" }: GenerateMagicLinkRequest = await req.json();

    if (!agentId || !email) {
      return new Response(
        JSON.stringify({ error: "Missing agentId or email" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseClient = createClient(
      SUPABASE_URL,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Generate cryptographically secure token (64 chars)
    const token = crypto.randomUUID().replace(/-/g, '') + 
                  crypto.randomUUID().replace(/-/g, '');

    // Store token in database
    const { error: insertError } = await supabaseClient
      .from("magic_login_tokens")
      .insert({
        agent_id: agentId,
        email: email.toLowerCase().trim(),
        token,
        destination,
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // 24 hours
      });

    if (insertError) {
      console.error("Failed to create magic token:", insertError);
      return new Response(
        JSON.stringify({ error: "Failed to create login link" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Build magic link URL
    const magicLink = `${BASE_URL}/magic-login?token=${token}`;

    console.log(`Generated magic link for ${email} (agent: ${agentId}, dest: ${destination})`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        magicLink,
        token,
        expiresIn: "24 hours"
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Error in generate-magic-link:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
};

serve(handler);
