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
    // This endpoint uses the service-role client below, so verify_jwt=false must
    // never mean anonymous access. Only roles that can actually open Add Agent
    // may enumerate the manager/upline picker.
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized", managers: [] }), {
        status: 401, headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }
    const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(authHeader.slice(7));
    if (authError || !authData.user) {
      return new Response(JSON.stringify({ error: "Unauthorized", managers: [] }), {
        status: 401, headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }
    const { data: callerRoles, error: callerRoleError } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", authData.user.id)
      .in("role", ["admin", "manager"]);
    if (callerRoleError) throw callerRoleError;
    if (!callerRoles?.length) {
      return new Response(JSON.stringify({ error: "Forbidden", managers: [] }), {
        status: 403, headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }
    const { data: callerAgent } = await supabaseAdmin
      .from("agents")
      .select("id")
      .eq("user_id", authData.user.id)
      .eq("status", "active")
      .eq("is_deactivated", false)
      .limit(1)
      .maybeSingle();

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
      .select("user_id, full_name, instagram_handle, avatar_url, photo_url")
      .in("user_id", userIds);

    if (profilesError) throw profilesError;

    // 3b. Batch fetch agent photos as a fallback for avatar.
    const { data: agentExtras } = await supabaseAdmin
      .from("agents")
      .select("id, display_name")
      .in("id", agents.map(a => a.id));

    const profileMap = new Map((profiles || []).map(p => [p.user_id, p]));
    const agentMap = new Map((agentExtras || []).map(a => [a.id, a]));

    // Normalize "Sam James" → "Samuel James" (PL-008): same person, two
    // labels were appearing on the applicant referral picker.
    const normalizeName = (raw: string | null | undefined): string => {
      const trimmed = (raw || "").trim();
      if (!trimmed) return "Unknown";
      if (/\bsam\s+james\b/i.test(trimmed)) return "Samuel James";
      return trimmed;
    };

    // Assemble list with avatar + normalized name.
    const rawList = agents
      .filter(a => a.user_id)
      .map(a => {
        const profile = profileMap.get(a.user_id!);
        const extras = agentMap.get(a.id);
        return {
          id: a.id,
          name: normalizeName(extras?.display_name || profile?.full_name),
          instagramHandle: profile?.instagram_handle || undefined,
          avatarUrl: (profile as any)?.avatar_url || (profile as any)?.photo_url || null,
          role: "manager",
        };
      })
      .filter(m => m.name !== "Unknown");

    // Dedupe by normalized name (Sam James + Samuel James → one Samuel James).
    // We prefer the agent row with more assigned applicants but we don't have
    // that here — just take the first occurrence, which after sort is alphabetic.
    const seen = new Map<string, typeof rawList[0]>();
    for (const m of rawList) {
      if (!seen.has(m.name)) seen.set(m.name, m);
    }
    const result = Array.from(seen.values())
      // Pin Samuel James to the top (PL-007); everyone else alphabetic.
      .sort((a, b) => {
        const aIsSam = a.name === "Samuel James";
        const bIsSam = b.name === "Samuel James";
        if (aIsSam && !bIsSam) return -1;
        if (!aIsSam && bIsSam) return 1;
        return a.name.localeCompare(b.name);
      });

    console.log(`Found ${result.length} managers`);

    return new Response(
      JSON.stringify({ managers: result, callerAgentId: callerAgent?.id ?? null }),
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
