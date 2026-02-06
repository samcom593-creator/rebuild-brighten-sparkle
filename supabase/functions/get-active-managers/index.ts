import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.90.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
}

const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
});

interface ManagerInfo {
  id: string;
  name: string;
  instagramHandle?: string;
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log("Fetching active managers for referral dropdown...");

    // Get all active agents who have the manager role
    const { data: agents, error: agentsError } = await supabaseAdmin
      .from("agents")
      .select("id, user_id")
      .eq("status", "active");

    if (agentsError) {
      console.error("Error fetching agents:", agentsError);
      return new Response(
        JSON.stringify({ error: "Failed to fetch agents", managers: [] }),
        { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    if (!agents || agents.length === 0) {
      console.log("No active agents found");
      return new Response(
        JSON.stringify({ managers: [] }),
        { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const managers: ManagerInfo[] = [];

    for (const agent of agents) {
      if (!agent.user_id) continue;

      // Check if this user has the manager role
      const { data: roleData, error: roleError } = await supabaseAdmin
        .from("user_roles")
        .select("role")
        .eq("user_id", agent.user_id)
        .eq("role", "manager")
        .maybeSingle();

      if (roleError) {
        console.error(`Error checking role for user ${agent.user_id}:`, roleError);
        continue;
      }

      if (roleData) {
        // Get their profile name and Instagram handle
        const { data: profile, error: profileError } = await supabaseAdmin
          .from("profiles")
          .select("full_name, instagram_handle")
          .eq("user_id", agent.user_id)
          .maybeSingle();

        if (profileError) {
          console.error(`Error fetching profile for user ${agent.user_id}:`, profileError);
          continue;
        }

        if (profile?.full_name) {
          managers.push({
            id: agent.id,
            name: profile.full_name,
            instagramHandle: profile.instagram_handle || undefined,
          });
          console.log(`Found manager: ${profile.full_name} (@${profile.instagram_handle || 'no handle'})`);
        }
      }
    }

    console.log(`Total managers found: ${managers.length}`);

    return new Response(
      JSON.stringify({ managers }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  } catch (error) {
    console.error("get-active-managers error:", error);
    return new Response(
      JSON.stringify({ error: "Server error", managers: [] }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
};

serve(handler);
