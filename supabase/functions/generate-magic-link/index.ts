/**
 * generate-magic-link — mints a 64-char bearer token into magic_login_tokens
 * and returns the /magic-login?token=<it> URL to the caller.
 *
 * MP-450 — WHY THIS ENDPOINT IS GATED THE WAY IT IS:
 * Until MP-450 it read NO credential. verify_jwt = false, CORS *, and it took
 * `agentId` straight off the request body. verify-magic-link then resolves the
 * account by tokenRecord.agent_id — the attacker's value — and never checks it
 * against the `email` in the same row, so a bare POST of any agent's UUID came
 * back with a working login link for that agent. Admins and managers included:
 * unlike applicant-magic-link and simple-login after MP-447, there was not even
 * a privilege refusal here.
 *
 * This is the third instance of the MP-447 class and it was found by a guard,
 * not by a probe — scripts/check-credential-minting.mjs, whose positive-control
 * floor refused to reconcile 3 detected returners against 4 measured ones and
 * so exposed Apex's SECOND mint shape (a custom magic_login_tokens row is a
 * credential exactly as a Supabase native link is).
 *
 * The gate is admin-only, matching the sibling that already does this right
 * (create-agent-from-leaderboard). All three real callers sit behind a bare
 * `requireAdmin` ProtectedRoute — /dashboard/admin, /dashboard/accounts, and
 * InviteTeamModal which only renders inside DashboardCommandCenter — and
 * supabase.functions.invoke attaches the caller's session JWT, so none of them
 * lose anything. verify_jwt cannot be the gate: the platform accepts the public
 * anon key that ships in the browser bundle (MP-443).
 */
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const BASE_URL = "https://apex-financial.org";

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
    const supabaseClient = createClient(
      SUPABASE_URL,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // Gate BEFORE the body is read and long before the token is minted.
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const { data: authData, error: authError } = await supabaseClient.auth.getUser(
      authHeader.slice(7)
    );
    if (authError || !authData?.user?.id) {
      // The anon key that ships in the browser bundle lands here: it is a valid
      // apikey but carries no user, so getUser returns none and this refuses.
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const { data: callerRoles, error: roleError } = await supabaseClient
      .from("user_roles")
      .select("role")
      .eq("user_id", authData.user.id);
    // Unknown coerces toward refusal — a failed role read must never read as
    // "is an admin" (MP-447).
    if (roleError || !(callerRoles ?? []).some((r: { role: unknown }) => String(r.role) === "admin")) {
      return new Response(
        JSON.stringify({ error: "Administrator access required" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { agentId, email, destination = "portal" }: GenerateMagicLinkRequest = await req.json();

    if (!agentId || !email) {
      return new Response(
        JSON.stringify({ error: "Missing agentId or email" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

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
