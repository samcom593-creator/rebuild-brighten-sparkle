// ============================================================================
// RECOVERED MIRROR — NOT THE ORIGINAL SOURCE, AND NOT DEPLOYABLE AS-IS.
//
// slug        : set-va-account
// prod version: v137   verify_jwt=true
// entrypoint  : source/index.ts
// recovered   : 2026-09-08 via scripts/recover-edge-function-source.py
// sha256      : 4b8ad1ad7746409695dfdc89c89a41915aba9a232f9cd22281192a5218996cfb   (of the recovered bytes below this banner)
//
// This is what the Supabase edge runtime hands back for a DEPLOYED function, which
// is the TRANSPILED module. Measured against check-stale-onboarding, whose real
// source IS in this repo (14032B repo vs 13682B recovered):
//   PRESERVED  comments, string literals, identifiers, control flow, logic
//   LOST       TypeScript types — `interface` blocks vanish, `!` assertions stripped
//   CHANGED    formatting normalised to Deno's emit
//
// So: behaviourally-equivalent JavaScript, NOT the file someone wrote. It lives
// OUTSIDE supabase/functions/ on purpose — deploy-supabase.yml deploys every
// directory under supabase/functions/ (both the deploy-all and deploy-changed
// paths), so putting it there would push this transpilation over live prod the
// moment a working Management PAT exists. For create-va-account / set-va-account
// that is a live auth-level ban/unban path.
//
// To make one of these authoritative: a human reads it, restores the types, moves
// it to supabase/functions/<slug>/index.ts, and pays the slug down in
// scripts/data/deployed-function-orphans.json.
// ============================================================================

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.90.1";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
};
serve(async (req)=>{
  if (req.method === "OPTIONS") return new Response(null, {
    headers: corsHeaders
  });
  const json = (b, s = 200)=>new Response(JSON.stringify(b), {
      status: s,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
    const jwt = (req.headers.get("Authorization") || "").replace("Bearer ", "");
    if (!jwt) return json({
      error: "Not authenticated"
    }, 401);
    const { data: { user: caller }, error: callerErr } = await admin.auth.getUser(jwt);
    if (callerErr || !caller) return json({
      error: "Not authenticated"
    }, 401);
    const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", caller.id);
    const rset = new Set((roles || []).map((r)=>r.role));
    const isAdmin = rset.has("admin");
    if (!rset.has("va_manager") && !isAdmin) return json({
      error: "Forbidden"
    }, 403);
    const { va_user_id, action } = await req.json();
    if (!va_user_id || action !== "disable" && action !== "enable") return json({
      error: "Bad request"
    }, 400);
    // Ownership guard: a va_manager may only toggle VAs it manages.
    if (!isAdmin) {
      const { data: child } = await admin.from("profiles").select("managed_by").eq("user_id", va_user_id).maybeSingle();
      if (!child || child.managed_by !== caller.id) return json({
        error: "Forbidden"
      }, 403);
    }
    const { error: banErr } = await admin.auth.admin.updateUserById(va_user_id, {
      ban_duration: action === "disable" ? "876000h" : "none"
    });
    if (banErr) return json({
      error: banErr.message || "Failed to update access"
    }, 500);
    return json({
      ok: true,
      disabled: action === "disable"
    });
  } catch (e) {
    console.error("set-va-account error", e);
    return json({
      error: "Unexpected error"
    }, 500);
  }
});
