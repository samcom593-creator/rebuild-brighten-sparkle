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

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log("Fetching active managers (batch mode)...");

    // 1. Get all active agents with user_ids in ONE query
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
      return new Response(
        JSON.stringify({ managers: [] }),
        { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const userIds = agents.filter(a => a.user_id).map(a => a.user_id!);

    // 2. Batch fetch ALL manager roles in ONE query
    const { data: managerRoles, error: rolesError } = await supabaseAdmin
      .from("user_roles")
      .select("user_id")
      .eq("role", "manager")
      .in("user_id", userIds);

    if (rolesError) {
      console.error("Error fetching roles:", rolesError);
      return new Response(
        JSON.stringify({ error: "Failed to fetch roles", managers: [] }),
        { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const managerUserIds = new Set((managerRoles || []).map(r => r.user_id));

    if (managerUserIds.size === 0) {
      return new Response(
        JSON.stringify({ managers: [] }),
        { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // 3. Batch fetch ALL profiles for managers in ONE query
    const { data: profiles, error: profilesError } = await supabaseAdmin
      .from("profiles")
      .select("user_id, full_name, instagram_handle")
      .in("user_id", Array.from(managerUserIds));

    if (profilesError) {
      console.error("Error fetching profiles:", profilesError);
      return new Response(
        JSON.stringify({ error: "Failed to fetch profiles", managers: [] }),
        { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Build lookup maps
    const profileMap = new Map(
      (profiles || []).map(p => [p.user_id, p])
    );

    // Assemble managers list
    const managers = agents
      .filter(a => a.user_id && managerUserIds.has(a.user_id))
      .map(a => {
        const profile = profileMap.get(a.user_id!);
        return {
          id: a.id,
          name: profile?.full_name || "Unknown",
          instagramHandle: profile?.instagram_handle || undefined,
        };
      })
      .filter(m => m.name !== "Unknown");

    console.log(`Total managers found: ${managers.length} (3 queries total)`);

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
