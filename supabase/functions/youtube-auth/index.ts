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
// Required secrets: YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET (a Google Cloud
// OAuth 2.0 "Web application" client whose authorized redirect URI is this
// function's URL, with the YouTube Data API v3 enabled on that project).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SCOPES = "https://www.googleapis.com/auth/youtube.force-ssl";

function html(body: string, status = 200) {
  return new Response(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font-family:-apple-system,system-ui;padding:32px;max-width:520px;margin:auto;line-height:1.5">${body}</body>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const clientId = Deno.env.get("YOUTUBE_CLIENT_ID");
  const clientSecret = Deno.env.get("YOUTUBE_CLIENT_SECRET");
  // The edge runtime sees the request as http:// with /functions/v1 stripped from
  // the path; Google only accepts the exact URI registered on the client.
  const redirectUri = `https://${url.host}/functions/v1/youtube-auth`;
  if (!clientId || !clientSecret) return html("<h2>YouTube connect isn't configured yet</h2><p>YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET are not set.</p>", 503);

  const code = url.searchParams.get("code");
  const err = url.searchParams.get("error");
  if (err) return html(`<h2>Google said no</h2><p>${err}</p>`, 400);

  if (!code) {
    const consent = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    consent.searchParams.set("client_id", clientId);
    consent.searchParams.set("redirect_uri", redirectUri);
    consent.searchParams.set("response_type", "code");
    consent.searchParams.set("scope", SCOPES);
    consent.searchParams.set("access_type", "offline");
    consent.searchParams.set("prompt", "consent");
    consent.searchParams.set("include_granted_scopes", "true");
    return Response.redirect(consent.toString(), 302);
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
