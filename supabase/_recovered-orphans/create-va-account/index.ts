// ============================================================================
// RECOVERED MIRROR — NOT THE ORIGINAL SOURCE, AND NOT DEPLOYABLE AS-IS.
//
// slug        : create-va-account
// prod version: v137   verify_jwt=true
// entrypoint  : source/index.ts
// recovered   : 2026-09-08 via scripts/recover-edge-function-source.py
// sha256      : 7211b75c0db91d5e9234b0a96b06748d59692d2a70f551983aef3fbe9f865270   (of the recovered bytes below this banner)
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
    // Identify the caller from their JWT — never trust the body for identity.
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
    if (!rset.has("va_manager") && !rset.has("admin")) return json({
      error: "Forbidden"
    }, 403);
    const body = await req.json();
    const email = String(body.email || "").trim().toLowerCase();
    const fullName = String(body.full_name || body.fullName || "").trim();
    const password = body.password && String(body.password).length >= 6 ? String(body.password) : "123456";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({
      error: "Invalid email"
    }, 400);
    if (!fullName) return json({
      error: "Name required"
    }, 400);
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: fullName
      }
    });
    if (createErr) {
      if (createErr.message?.includes("already been registered")) return json({
        error: "That email is already registered."
      }, 400);
      return json({
        error: createErr.message || "Failed to create VA"
      }, 500);
    }
    const vaId = created.user.id;
    // Replace the trigger-default 'agent' role with 'va'; link the VA to its creating manager.
    await admin.from("user_roles").delete().eq("user_id", vaId).eq("role", "agent");
    const { error: roleErr } = await admin.from("user_roles").insert({
      user_id: vaId,
      role: "va"
    });
    if (roleErr) {
      await admin.auth.admin.deleteUser(vaId);
      return json({
        error: "Failed to assign VA role"
      }, 500);
    }
    await admin.from("profiles").update({
      full_name: fullName,
      email,
      managed_by: caller.id
    }).eq("user_id", vaId);
    return json({
      ok: true,
      user_id: vaId,
      email,
      password
    });
  } catch (e) {
    console.error("create-va-account error", e);
    return json({
      error: "Unexpected error"
    }, 500);
  }
});
