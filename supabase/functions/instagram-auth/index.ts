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

  // ── One-tap connect (GET redirect from Facebook Login) ─────────────────────
  // Sam taps the OAuth link, presses Allow, Meta redirects here with ?code=.
  // We exchange it server-side, resolve his Page -> Instagram business account,
  // store the PAGE token (what IG messaging uses) where send-instagram-dm and
  // instagram-webhook already look. No frontend, no paste.
  if (req.method === "GET") {
    const url  = new URL(req.url);
    const code = url.searchParams.get("code");
    const html = (msg: string, status = 200) =>
      new Response(`<!doctype html><meta name=viewport content="width=device-width"><body style="font-family:-apple-system,sans-serif;background:#0b0b0c;color:#e9c46a;padding:40px;text-align:center"><h2>${msg}</h2><p style="color:#aaa">You can close this.</p></body>`,
        { status, headers: { "Content-Type": "text/html" } });
    // ?link=1 -> the reconnect link itself, built from this function's own env so it
    // can never drift from the redirect URI Meta will accept. The weekly keepalive and
    // the 5-minute brain-health probe both put this in their page when the token dies
    // (2026-10-01: Meta invalidated the token after a password change; 305 DMs failed
    // over two days and nothing could say how to fix it). ?format=json for scripts.
    if (!code && url.searchParams.get("link") === "1") {
      const IG_ID = Deno.env.get("INSTAGRAM_APP_ID") ?? APP_ID;
      const scopes = "instagram_business_basic,instagram_business_manage_messages,instagram_business_manage_comments";
      const link = `https://www.instagram.com/oauth/authorize?client_id=${encodeURIComponent(IG_ID)}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=${scopes}&force_reauth=true`;
      if (url.searchParams.get("format") === "json") {
        return new Response(JSON.stringify({ ok: true, link, redirect_uri: REDIRECT_URI }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      return html(`<a href="${link}" style="color:#e9c46a;font-size:20px">Reconnect Instagram (@sell4daddy) — tap, then Allow</a>`);
    }
    if (!code) return html("Missing code — tap the link again.", 400);
    try {
      const SAM_UID = "71826bba-5577-4810-a226-1f6f2ad5288a";
      // Instagram-Login product: exchange with the INSTAGRAM app id/secret (not the
      // Facebook app's). No Facebook Page is involved; the token lives on
      // graph.instagram.com and messaging posts to /{ig_user_id}/messages.
      const IG_ID  = Deno.env.get("INSTAGRAM_APP_ID") ?? APP_ID;
      const IG_SEC = Deno.env.get("INSTAGRAM_APP_SECRET") ?? APP_SECRET;
      const ex = await fetch("https://api.instagram.com/oauth/access_token", {
        method: "POST",
        body: new URLSearchParams({ client_id: IG_ID, client_secret: IG_SEC, grant_type: "authorization_code", redirect_uri: REDIRECT_URI, code }),
      });
      const exJ = await ex.json();
      if (!ex.ok || !exJ.access_token) return html(`Exchange failed: ${JSON.stringify(exJ).slice(0, 220)}`, 500);
      const ll = await fetch(`https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=${IG_SEC}&access_token=${exJ.access_token}`);
      const llJ = await ll.json();
      const token = (llJ.access_token as string) ?? (exJ.access_token as string);
      const expiresIn = Number(llJ.expires_in ?? 5184000);
      const me = await fetch(`https://graph.instagram.com/v21.0/me?fields=id,user_id,username&access_token=${token}`).then(r => r.json());
      const igId   = String(me.user_id ?? me.id ?? exJ.user_id ?? "");
      const igUser = (me.username as string) ?? null;
      // Subscribe THIS account to the app's webhook fields right here, so nothing
      // depends on a later job for delivery to start.
      const sub = await fetch(`https://graph.instagram.com/v21.0/${igId}/subscribed_apps?subscribed_fields=messages,comments,messaging_postbacks&access_token=${token}`, { method: "POST" }).then(r => r.json()).catch(() => ({}));
      const sb = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", { auth: { persistSession: false } });
      await sb.from("instagram_connections").upsert({
        user_id: SAM_UID,
        instagram_user_id: igId || "pending",
        instagram_username: igUser,
        access_token: token,
        token_expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
        scopes: (exJ.permissions ?? ["instagram_business_basic", "instagram_business_manage_messages", "instagram_business_manage_comments"]) as string[],
        connected_at: new Date().toISOString(),
      }, { onConflict: "user_id,instagram_user_id" });
      await sb.from("system_settings").upsert([
        { key: "meta_instagram_token", value: token },
        { key: "meta_instagram_page_id", value: igId },   // sender posts to graph.instagram.com/{this}/messages
      ], { onConflict: "key" });
      return html(`Connected @${igUser ?? igId}. DMs and comments are live${sub?.success ? "" : " (webhook subscribe: " + JSON.stringify(sub).slice(0, 120) + ")"}.`);
    } catch (e) {
      return html(`Connect error: ${String(e).slice(0, 200)}`, 500);
    }
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
