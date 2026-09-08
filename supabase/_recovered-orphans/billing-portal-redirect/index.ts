// ============================================================================
// RECOVERED MIRROR — NOT THE ORIGINAL SOURCE, AND NOT DEPLOYABLE AS-IS.
//
// slug        : billing-portal-redirect
// prod version: v145   verify_jwt=false
// entrypoint  : source/index.ts
// recovered   : 2026-09-08 via scripts/recover-edge-function-source.py
// sha256      : b5b35191f7b716563232459400ae773c986f736e920c4d42d115fac8b20ad57e   (of the recovered bytes below this banner)
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

// billing-portal-redirect — takes ?t=<uuid>, looks up customer in
// customer_portal_tokens, generates a fresh Stripe billing portal session,
// and 302-redirects. Stable URL for rescue emails.
// Owner: CFO Bot. v2 2026-06-01.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.0";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const RETURN_URL = Deno.env.get("PORTAL_RETURN_URL") ?? "https://apex-financial.org/dashboard";
const sb = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: {
    persistSession: false
  }
});
function errorHTML(msg, status = 410) {
  return new Response(`<!doctype html><meta charset="utf-8"><title>Link expired</title>` + `<body style="font-family:system-ui;max-width:560px;margin:64px auto;padding:24px;color:#111;">` + `<h2 style="margin-bottom:8px;">This payment link is no longer valid.</h2>` + `<p style="color:#444;">${msg}</p>` + `<p>Reply to the email you got and we'll send a new one.</p>` + `<p style="margin-top:32px;color:#888;font-size:13px;">— APEX Financial</p>` + `</body>`, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8"
    }
  });
}
async function getStripeKey() {
  const envKey = Deno.env.get("STRIPE_SECRET_KEY");
  if (envKey) return envKey;
  const { data, error } = await sb.from("system_settings").select("value").eq("key", "stripe_secret_key").maybeSingle();
  if (error) throw new Error(`settings_read_failed:${error.message}`);
  if (!data?.value) throw new Error("no_stripe_key");
  return data.value;
}
Deno.serve(async (req)=>{
  try {
    const url = new URL(req.url);
    const token = url.searchParams.get("t");
    if (!token) return errorHTML("Missing token.", 400);
    const { data: row, error: rowErr } = await sb.from("customer_portal_tokens").select("customer_id, expires_at, revoked, use_count").eq("token", token).maybeSingle();
    if (rowErr) {
      console.error("token_lookup_failed", rowErr);
      return new Response("Server error.", {
        status: 500
      });
    }
    if (!row) return errorHTML("Unknown link.");
    if (row.revoked) return errorHTML("This link was revoked.");
    if (row.expires_at && new Date(row.expires_at) < new Date()) return errorHTML("This link expired.");
    const stripeKey = await getStripeKey();
    const body = new URLSearchParams({
      customer: row.customer_id,
      return_url: RETURN_URL
    });
    const stripeResp = await fetch("https://api.stripe.com/v1/billing_portal/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${stripeKey}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body
    });
    const stripeJson = await stripeResp.json();
    if (!stripeResp.ok || !stripeJson.url) {
      console.error("stripe_portal_session_failed", stripeJson);
      return new Response("Stripe error.", {
        status: 502
      });
    }
    // Best-effort usage log. Never block the redirect.
    sb.from("customer_portal_tokens").update({
      last_used_at: new Date().toISOString(),
      use_count: (row.use_count ?? 0) + 1
    }).eq("token", token).then(({ error })=>{
      if (error) console.error("usage_log_failed", error);
    });
    return Response.redirect(stripeJson.url, 302);
  } catch (err) {
    console.error("billing_portal_redirect_fatal", err);
    return new Response("Server error.", {
      status: 500
    });
  }
});
