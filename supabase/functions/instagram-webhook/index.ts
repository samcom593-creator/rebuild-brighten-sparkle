/**
 * instagram-webhook — receives Meta webhook events (messages, mentions, etc).
 *
 * GET  = Meta verification challenge
 * POST = event delivery (signed with X-Hub-Signature-256)
 *
 * Required env: META_WEBHOOK_VERIFY_TOKEN, META_APP_SECRET
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-hub-signature-256",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

async function verifySignature(body: string, signature: string | null, secret: string): Promise<boolean> {
  if (!signature) return false;
  const expected = signature.replace(/^sha256=/, "");
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sigBytes = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  const hex = Array.from(new Uint8Array(sigBytes)).map(b => b.toString(16).padStart(2, "0")).join("");
  return hex === expected;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const url = new URL(req.url);

  // ── Meta verification challenge (GET) ──
  if (req.method === "GET") {
    const mode      = url.searchParams.get("hub.mode");
    const token     = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    const expected  = Deno.env.get("META_WEBHOOK_VERIFY_TOKEN");
    if (mode === "subscribe" && token === expected && challenge) {
      return new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
    }
    return new Response("forbidden", { status: 403 });
  }

  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });

  // ── Event delivery (POST) ──
  const rawBody = await req.text();
  const secret  = Deno.env.get("META_APP_SECRET");
  if (secret) {
    const sig = req.headers.get("x-hub-signature-256");
    const ok  = await verifySignature(rawBody, sig, secret);
    if (!ok) return new Response("invalid signature", { status: 401 });
  }

  let payload: any;
  try { payload = JSON.parse(rawBody); }
  catch { return new Response("bad json", { status: 400 }); }

  const sb = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );

  // Log every event for audit / later routing
  const entries = (payload?.entry ?? []) as Array<any>;
  for (const entry of entries) {
    await sb.from("instagram_events").insert({
      event_type: payload?.object ?? "unknown",
      external_id: entry?.id ?? null,
      payload: entry,
    }).catch(() => {});
  }

  // Meta expects 200 within 5 seconds or it retries.
  return new Response(JSON.stringify({ ok: true }), {
    status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
