// youtube-auth — one-tap Google OAuth connect for the YouTube comment assistant.
//
// GET without ?code  -> redirects to Google's consent screen (offline access,
//                       youtube.force-ssl so we can read + reply to comments).
// GET with ?code     -> exchanges the code, resolves the channel, stores the
//                       refresh token in youtube_connections, and shows "connected".
//
// Same shape as instagram-auth: Sam opens the link once, everything after is
// automated (youtube-comments polls on pg_cron and refreshes access tokens itself).
//
// MP-412 — WHY THIS ENDPOINT IS GATED, when an OAuth callback normally is not.
// This function shipped verify_jwt=false with no `state` and no initiation
// secret, and it was live (probed 302 on prod 2026-09-30). The callback writes
// youtube_connections with the SERVICE ROLE key, and youtube-comments selects
// that table with NO filter and loops every row, so a row is a standing
// instruction to this account's automation. Anyone who opened the bare URL
// could therefore walk Google's consent screen with their OWN account and
// enlist Sam's comment assistant onto their channel: their refresh token stored
// in Sam's database, their videos answered every 20 minutes, on Sam's model
// spend. No credential of Sam's leaked and the table held exactly one row (his)
// when this was written, so the exposure was LATENT, never exploited — the fix
// is prevention, and no dollar figure is claimed for it.
//
// Two gates, because they stop different things:
//   1. INITIATION — ?k must equal CONNECT_KEY (below). Stops a stranger from
//      ever reaching the consent screen through this client.
//   2. STATE — the callback must present a `state` this function signed and
//      issued within STATE_TTL_SECONDS. Stops a stranger who skips step 1 and
//      calls the redirect URI directly with a code minted elsewhere. Gate 1
//      alone does NOT imply gate 2; the redirect URI is public by necessity.
//
// CONNECT_KEY is HMAC-SHA256(APEX_BOT_TOKEN, "youtube-auth-connect-v1") in hex,
// NOT the token itself, so the link Sam opens can sit in a browser history, a
// server log, or a Referer header without carrying the credential that gates
// youtube-comments. Derive it with:
//   printf 'youtube-auth-connect-v1' | openssl dgst -sha256 -hmac "$APEX_BOT_TOKEN" -hex
//
// Required secrets: YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET (a Google Cloud
// OAuth 2.0 "Web application" client whose authorized redirect URI is this
// function's URL, with the YouTube Data API v3 enabled on that project), and
// APEX_BOT_TOKEN (already required by youtube-comments).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SCOPES = "https://www.googleapis.com/auth/youtube.force-ssl";
const CONNECT_KEY_CONTEXT = "youtube-auth-connect-v1";
const STATE_TTL_SECONDS = 15 * 60;
const encoder = new TextEncoder();

function html(body: string, status = 200) {
  return new Response(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font-family:-apple-system,system-ui;padding:32px;max-width:520px;margin:auto;line-height:1.5">${body}</body>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

async function hmacKey(secret: string, usage: "sign" | "verify") {
  return await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [usage]);
}

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex: string): ArrayBuffer | null {
  if (!/^[0-9a-f]{64}$/i.test(hex)) return null;
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i += 1) bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes.buffer as ArrayBuffer;
}

async function signHex(secret: string, message: string): Promise<string> {
  return toHex(await crypto.subtle.sign("HMAC", await hmacKey(secret, "sign"), encoder.encode(message)));
}

// Web Crypto performs the MAC comparison. Do not replace this with a normal
// string equality check, which can leak timing information.
async function verifyHex(secret: string, message: string, providedHex: string): Promise<boolean> {
  const digest = hexToBytes(providedHex);
  if (!digest) return false;
  return await crypto.subtle.verify("HMAC", await hmacKey(secret, "verify"), digest, encoder.encode(message));
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const clientId = Deno.env.get("YOUTUBE_CLIENT_ID");
  const clientSecret = Deno.env.get("YOUTUBE_CLIENT_SECRET");
  const botToken = Deno.env.get("APEX_BOT_TOKEN") ?? "";
  // The edge runtime sees the request as http:// with /functions/v1 stripped from
  // the path; Google only accepts the exact URI registered on the client.
  const redirectUri = `https://${url.host}/functions/v1/youtube-auth`;
  if (!clientId || !clientSecret) return html("<h2>YouTube connect isn't configured yet</h2><p>YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET are not set.</p>", 503);
  // An absent gate secret must CLOSE the endpoint, never open it. If this read
  // empty and we fell through, the fix would silently revert to the hole.
  if (!botToken) return html("<h2>YouTube connect isn't configured yet</h2><p>APEX_BOT_TOKEN is not set, so the connect link cannot be verified.</p>", 503);

  const code = url.searchParams.get("code");
  const err = url.searchParams.get("error");
  if (err) return html(`<h2>Google said no</h2><p>${err}</p>`, 400);

  if (!code) {
    const provided = (url.searchParams.get("k") ?? "").trim();
    if (!provided || !(await verifyHex(botToken, CONNECT_KEY_CONTEXT, provided))) {
      return html("<h2>Not your link</h2><p>This connect link needs its key. Ask the Galaxy operator for the current one.</p>", 401);
    }
    const issued = Math.floor(Date.now() / 1000).toString();
    const state = `${issued}.${await signHex(botToken, `state:${issued}`)}`;
    const consent = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    consent.searchParams.set("client_id", clientId);
    consent.searchParams.set("redirect_uri", redirectUri);
    consent.searchParams.set("response_type", "code");
    consent.searchParams.set("scope", SCOPES);
    consent.searchParams.set("access_type", "offline");
    consent.searchParams.set("prompt", "consent");
    consent.searchParams.set("include_granted_scopes", "true");
    consent.searchParams.set("state", state);
    return Response.redirect(consent.toString(), 302);
  }

  // A code without a state we signed is a callback we never started. Refuse it
  // BEFORE the token exchange, so an unsigned caller cannot even make us spend
  // a request against Google's endpoint with our client secret.
  const state = url.searchParams.get("state") ?? "";
  const dot = state.indexOf(".");
  const issued = dot > 0 ? state.slice(0, dot) : "";
  const mac = dot > 0 ? state.slice(dot + 1) : "";
  if (!/^\d{1,12}$/.test(issued) || !(await verifyHex(botToken, `state:${issued}`, mac))) {
    return html("<h2>That connect link didn't come from here</h2><p>Start again from the Galaxy connect link.</p>", 401);
  }
  const ageSeconds = Math.floor(Date.now() / 1000) - Number(issued);
  if (!Number.isFinite(ageSeconds) || ageSeconds < -60 || ageSeconds > STATE_TTL_SECONDS) {
    return html("<h2>That connect link expired</h2><p>Open the Galaxy connect link again — it is good for 15 minutes.</p>", 401);
  }

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code" }),
  });
  const tok = await tokenRes.json().catch(() => ({}));
  if (!tokenRes.ok || !tok.access_token) return html(`<h2>Token exchange failed</h2><pre>${JSON.stringify(tok).slice(0, 400)}</pre>`, 400);
  if (!tok.refresh_token) return html("<h2>No refresh token came back</h2><p>Remove the app's access at myaccount.google.com/permissions and open the connect link again.</p>", 400);

  const chRes = await fetch("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", { headers: { Authorization: `Bearer ${tok.access_token}` } });
  const ch = await chRes.json().catch(() => ({}));
  const channel = ch?.items?.[0];
  if (!channel?.id) return html(`<h2>Could not read the channel</h2><pre>${JSON.stringify(ch).slice(0, 400)}</pre>`, 400);

  const sb = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", { auth: { persistSession: false } });
  const row = {
    channel_id: channel.id, channel_title: channel.snippet?.title ?? null,
    refresh_token: tok.refresh_token, access_token: tok.access_token,
    token_expires_at: new Date(Date.now() + Number(tok.expires_in ?? 3600) * 1000).toISOString(),
    scopes: tok.scope ?? SCOPES, updated_at: new Date().toISOString(),
  };
  const { error } = await sb.from("youtube_connections").upsert(row, { onConflict: "channel_id" });
  if (error) return html(`<h2>Could not store the connection</h2><pre>${error.message}</pre>`, 500);
  return html(`<h2>Connected: ${channel.snippet?.title ?? channel.id}</h2><p>Comments on your videos will be answered from here on. You can close this tab.</p>`);
});
