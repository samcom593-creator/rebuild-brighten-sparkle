// resolve-ref-slug — public endpoint that turns a ?ref=<slug> URL parameter
// into an agent id + display name so the /apply page can credit the right
// referrer. RLS on `agents` denies all anonymous reads, so the prior client-
// side direct query silently returned nothing.
//
// Public, unauthenticated, rate-limited.
// config.toml: verify_jwt = false

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders, errorResponse, jsonResponse } from "../_shared/cors.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

// Tight rate limit per IP — slug enumeration would be a privacy issue.
const hits = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 30;

function rateLimitOk(ip: string): boolean {
  const now = Date.now();
  const cur = hits.get(ip);
  if (!cur || now > cur.resetAt) {
    hits.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  if (cur.count >= MAX_PER_WINDOW) return false;
  cur.count++;
  return true;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST" && req.method !== "GET") return errorResponse("Method not allowed", 405);

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || req.headers.get("cf-connecting-ip")
    || "unknown";
  if (!rateLimitOk(ip)) return errorResponse("Too many requests", 429);

  let slug: string | null = null;
  if (req.method === "GET") {
    slug = new URL(req.url).searchParams.get("slug");
  } else {
    try {
      const body = await req.json();
      slug = String(body?.slug ?? "").trim();
    } catch {
      return errorResponse("Bad JSON", 400);
    }
  }

  if (!slug || slug.length < 2 || slug.length > 80 || !/^[a-zA-Z0-9_-]+$/.test(slug)) {
    return jsonResponse({ resolved: false });
  }

  // Match the slug. Treat NULL is_deactivated as "not deactivated" — older
  // agent rows can have NULL there, and .eq("is_deactivated", false) would
  // silently exclude them.
  const { data, error } = await supabase
    .from("agents")
    .select("id, user_id, display_name, agent_code, profile_id, is_deactivated, profiles:profile_id(full_name)")
    .eq("ref_slug", slug)
    .maybeSingle();

  if (data?.is_deactivated === true) {
    return jsonResponse({ resolved: false, reason: "deactivated" });
  }

  if (error) {
    console.error("resolve-ref-slug error", error);
    return errorResponse("Lookup failed", 500);
  }
  if (!data) return jsonResponse({ resolved: false });

  const name =
    data.display_name?.trim()
    || (data as any)?.profiles?.full_name
    || "your referring agent";

  return jsonResponse({
    resolved: true,
    agent_id: data.id,
    user_id: data.user_id,
    display_name: name,
    agent_code: data.agent_code,
  });
});
