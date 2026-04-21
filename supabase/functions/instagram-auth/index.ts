/**
 * instagram-auth — OAuth exchange for Instagram Graph API.
 *
 * Flow:
 *   1. Frontend redirects user to https://api.instagram.com/oauth/authorize?...
 *   2. Meta redirects back with ?code=...
 *   3. Frontend POSTs { code, user_id } here
 *   4. We exchange code → short-lived → long-lived token (60 days)
 *   5. Save to public.instagram_connections
 *
 * Required env secrets (set in Supabase Edge Functions → Secrets):
 *   META_APP_ID
 *   META_APP_SECRET
 *   META_REDIRECT_URI  (e.g. https://apexfinaincial.vercel.app/instagram/callback)
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const APP_ID       = Deno.env.get("META_APP_ID");
  const APP_SECRET   = Deno.env.get("META_APP_SECRET");
  const REDIRECT_URI = Deno.env.get("META_REDIRECT_URI");
  if (!APP_ID || !APP_SECRET || !REDIRECT_URI) {
    return new Response(JSON.stringify({
      error: "META_APP_ID / META_APP_SECRET / META_REDIRECT_URI not configured in Supabase Secrets",
    }), { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  try {
    const body = await req.json();
    const code    = String(body.code ?? "");
    const userId  = String(body.user_id ?? "");
    if (!code || !userId) {
      return new Response(JSON.stringify({ error: "code and user_id required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 1. Short-lived token exchange
    const short = await fetch("https://api.instagram.com/oauth/access_token", {
      method: "POST",
      body: new URLSearchParams({
        client_id: APP_ID,
        client_secret: APP_SECRET,
        grant_type: "authorization_code",
        redirect_uri: REDIRECT_URI,
        code,
      }),
    });
    const shortJson = await short.json();
    if (!short.ok) throw new Error(`short-lived: ${JSON.stringify(shortJson)}`);

    const shortToken = shortJson.access_token as string;
    const igUserId   = String(shortJson.user_id);

    // 2. Long-lived token (60 days)
    const long = await fetch(
      `https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=${APP_SECRET}&access_token=${shortToken}`
    );
    const longJson = await long.json();
    if (!long.ok) throw new Error(`long-lived: ${JSON.stringify(longJson)}`);

    const accessToken = longJson.access_token as string;
    const expiresIn   = Number(longJson.expires_in ?? 5184000); // 60 days
    const expiresAt   = new Date(Date.now() + expiresIn * 1000).toISOString();

    // 3. Resolve username
    const meRes = await fetch(
      `https://graph.instagram.com/me?fields=username&access_token=${accessToken}`
    );
    const meJson = await meRes.json();
    const username = meJson.username as string | undefined;

    // 4. Persist
    const sb = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } },
    );
    const { error } = await sb.from("instagram_connections").upsert({
      user_id: userId,
      instagram_user_id: igUserId,
      instagram_username: username ?? null,
      access_token: accessToken,
      token_expires_at: expiresAt,
      scopes: (shortJson.permissions ?? []) as string[],
      connected_at: new Date().toISOString(),
    }, { onConflict: "user_id,instagram_user_id" });
    if (error) throw error;

    return new Response(JSON.stringify({
      ok: true, username, instagram_user_id: igUserId, expires_at: expiresAt,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
