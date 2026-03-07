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
    console.log("Fetching active managers only...");

    // 1. Get all users with manager or admin role
    const { data: managerRoles, error: rolesError } = await supabaseAdmin
      .from("user_roles")
      .select("user_id")
      .in("role", ["manager", "admin"]);

    if (rolesError) throw rolesError;

    const managerUserIds = (managerRoles || []).map(r => r.user_id);

    if (managerUserIds.length === 0) {
      return new Response(JSON.stringify({ managers: [] }), {
        status: 200, headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    // 2. Get active agents that belong to these manager/admin users
    const { data: agents, error: agentsError } = await supabaseAdmin
      .from("agents")
      .select("id, user_id")
      .eq("status", "active")
      .in("user_id", managerUserIds);

    if (agentsError) throw agentsError;
    if (!agents || agents.length === 0) {
      return new Response(JSON.stringify({ managers: [] }), {
        status: 200, headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    const userIds = agents.filter(a => a.user_id).map(a => a.user_id!);

    // 3. Batch fetch profiles
    const { data: profiles, error: profilesError } = await supabaseAdmin
      .from("profiles")
      .select("user_id, full_name, instagram_handle")
      .in("user_id", userIds);

    if (profilesError) throw profilesError;

    const profileMap = new Map((profiles || []).map(p => [p.user_id, p]));

    // Assemble list
    const result = agents
      .filter(a => a.user_id)
      .map(a => {
        const profile = profileMap.get(a.user_id!);
        return {
          id: a.id,
          name: profile?.full_name || "Unknown",
          instagramHandle: profile?.instagram_handle || undefined,
          role: "manager",
        };
      })
      .filter(m => m.name !== "Unknown")
      .sort((a, b) => a.name.localeCompare(b.name));

    console.log(`Found ${result.length} managers`);

    return new Response(
      JSON.stringify({ managers: result }),
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
