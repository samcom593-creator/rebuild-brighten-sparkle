import { createClient } from "https://esm.sh/@supabase/supabase-js@2.90.1";
import { corsHeaders, errorResponse, jsonResponse } from "../_shared/cors.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
}

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
});

const hits = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 30;

function rateLimitOk(ip: string): boolean {
  const now = Date.now();
  const current = hits.get(ip);
  if (!current || now > current.resetAt) {
    hits.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  if (current.count >= MAX_PER_WINDOW) return false;
  current.count += 1;
  return true;
}

function normalizeName(value: string | null | undefined): string | null {
  const name = value?.trim();
  if (!name) return null;
  return /\bsam\s+james\b/i.test(name) ? "Samuel James" : name;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST" && req.method !== "GET") return errorResponse("Method not allowed", 405);

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || req.headers.get("cf-connecting-ip")
    || "unknown";
  if (!rateLimitOk(ip)) return errorResponse("Too many requests", 429);

  try {
    const { data: roleRows, error: roleError } = await admin
      .from("user_roles")
      .select("user_id")
      .in("role", ["manager", "admin"]);
    if (roleError) throw roleError;

    const userIds = [...new Set((roleRows ?? []).map((row) => row.user_id).filter(Boolean))];
    if (!userIds.length) return jsonResponse({ managers: [] });

    const { data: agents, error: agentError } = await admin
      .from("agents")
      .select("id, user_id, display_name")
      .in("user_id", userIds)
      .eq("status", "active")
      .or("is_deactivated.is.null,is_deactivated.eq.false")
      .limit(100);
    if (agentError) throw agentError;

    const activeUserIds = [...new Set((agents ?? []).map((agent) => agent.user_id).filter(Boolean))];
    const { data: profiles, error: profileError } = activeUserIds.length
      ? await admin
        .from("profiles")
        .select("user_id, full_name, instagram_handle, avatar_url, photo_url")
        .in("user_id", activeUserIds)
      : { data: [], error: null };
    if (profileError) throw profileError;

    const profilesByUser = new Map((profiles ?? []).map((profile) => [profile.user_id, profile]));
    const seen = new Set<string>();
    const managers = (agents ?? [])
      .map((agent) => {
        const profile = profilesByUser.get(agent.user_id);
        const name = normalizeName(agent.display_name || profile?.full_name);
        return name ? {
          id: agent.id,
          name,
          instagramHandle: profile?.instagram_handle || undefined,
          avatarUrl: profile?.avatar_url || profile?.photo_url || null,
        } : null;
      })
      .filter((manager): manager is NonNullable<typeof manager> => {
        if (!manager || seen.has(manager.name)) return false;
        seen.add(manager.name);
        return true;
      })
      .sort((a, b) => a.name === "Samuel James" ? -1 : b.name === "Samuel James" ? 1 : a.name.localeCompare(b.name));

    return jsonResponse({ managers });
  } catch (error) {
    console.error("get-public-recruiters error", error);
    return errorResponse("Recruiter directory unavailable", 500);
  }
});
