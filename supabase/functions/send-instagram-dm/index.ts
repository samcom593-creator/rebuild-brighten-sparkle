// send-instagram-dm — send a DM to an IG user via Meta Graph API.
//
// Reads token from META_INSTAGRAM_TOKEN env (preferred) or
// system_settings.meta_instagram_token (fallback so Sam can paste the
// value via bot-sql without dashboard access). Same dual-source pattern
// (the retired send-whatsapp used the same shape).
//
// Required: META_INSTAGRAM_PAGE_ID (the IG-connected Facebook Page ID)
//   plus token with `instagram_manage_messages` permission.
//
// Body: { recipient_id: "<igsid>", message: "text" }
//   recipient_id is the IGSID we get from the inbound webhook event.
//
// Returns { ok, id } on success, or { ok: false, error } and bubbles
// the upstream Meta error (since the token / permissions / 24-hour
// messaging-window constraint are the most common failure modes).

import { isTokenDeadError, pageTokenDead } from "../_shared/instagram-token-dead.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Token resolution chain (first found wins):
//   1. META_INSTAGRAM_TOKEN   (env)
//   2. system_settings.meta_instagram_token
//   3. instagram_connections.access_token (latest unexpired) — uses
//      whatever token Sam captured via the existing OAuth flow at
//      /functions/v1/instagram-auth, no manual paste required.
async function resolveSecrets(sb: ReturnType<typeof createClient>) {
  let token  = Deno.env.get("META_INSTAGRAM_TOKEN")   ?? null;
  let pageId = Deno.env.get("META_INSTAGRAM_PAGE_ID") ?? null;

  if (!token || !pageId) {
    const { data } = await sb.from("system_settings").select("key,value")
      .in("key", ["meta_instagram_token", "meta_instagram_page_id"]);
    for (const r of data ?? []) {
      if (r.key === "meta_instagram_token" && !token && r.value) token = r.value;
      if (r.key === "meta_instagram_page_id" && !pageId && r.value) pageId = r.value;
    }
  }

  // Last resort: pull the latest unexpired token captured by the OAuth
  // exchange. If Sam ever connected his IG via the in-app flow, this
  // covers it without needing him to paste anything.
  if (!token) {
    const { data: conns } = await sb.from("instagram_connections")
      .select("access_token, instagram_user_id, token_expires_at")
      .gt("token_expires_at", new Date().toISOString())
      .order("connected_at", { ascending: false })
      .limit(1);
    if (conns && conns[0]?.access_token) {
      token = conns[0].access_token as string;
      // For Instagram-Direct OAuth, the IG user ID doubles as the page-id-equivalent
      if (!pageId && conns[0].instagram_user_id) pageId = conns[0].instagram_user_id as string;
    }
  }
  return { token, pageId };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const sb = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } });

  let body: any;
  try { body = await req.json(); }
  catch { return new Response(JSON.stringify({ ok: false, error: "bad json" }), { status: 400, headers: corsHeaders }); }

  // Two ways to address a send:
  //   recipient_id — an IGSID from an inbound DM (24h messaging window applies)
  //   comment_id   — a comment on our own media: Instagram delivers the text as
  //                  a private DM to the commenter ("private reply", 7-day window,
  //                  once per comment). This is the "comment APEX → get DM'd" lane.
  const commentId   = body.comment_id ?? null;
  const recipientId = body.recipient_id ?? body.igsid ?? body.to ?? null;
  const message     = body.message ?? body.text;
  // Row identity for the thread log: the commenter's IGSID when the caller
  // knows it, so a comment and a later DM from the same person share a thread.
  const externalId  = body.external_id ?? recipientId ?? commentId;
  if ((!recipientId && !commentId) || !message) {
    return new Response(JSON.stringify({ ok: false, error: "recipient_id or comment_id + message required" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const { token, pageId } = await resolveSecrets(sb);

  // No token? Queue the message in inbox_messages so it shows up in Sam's
  // inbox UI ready to send manually + ping Discord so he sees it on his
  // phone in real time. This is the offline-safe path: nothing is lost.
  if (!token || !pageId) {
    // supabase-js QueryBuilder has no .catch — await + try/catch
    try {
      await sb.from("inbox_messages").insert({
        source: "instagram",
        external_id: externalId,
        sender_handle: externalId,
        body: message,
        direction: "outbound",
        auto_replied: false,
        raw_payload: { queued: true, reason: "no_token", queued_at: new Date().toISOString(), comment_id: commentId },
      });
    } catch (_queueErr) { /* queue is best-effort; Discord ping below is the durable receipt */ }

    // Discord ping if the webhook is configured — Sam can act in seconds
    const { data: setting } = await sb.from("system_settings")
      .select("value").eq("key", "discord_webhook_url").maybeSingle();
    const webhook = (setting as any)?.value;
    if (webhook) {
      await fetch(webhook, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: "APEX 📥 IG queued",
          content: `Inbound IG DM needs your reply (no IG token configured yet)\n\`\`\`\n${message.slice(0, 500)}\n\`\`\`\nTap reply on IG when you can — token paste also unblocks this thread.`,
        }),
      }).catch(() => {});
    }

    return new Response(JSON.stringify({
      ok: false,
      queued: true,
      error: "Instagram token not configured — message queued in inbox + Discord pinged.",
    }), { status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  // Live send via Meta Graph API
  // Instagram-Login token: messaging lives on graph.instagram.com under the IG
  // professional account id (meta_instagram_page_id holds that id). No FB Page.
  // public: true + comment_id = a PUBLIC reply under the comment (🔥 back on
  // props, "check your dms 📩" on an Apex comment). Everything else is a DM.
  const isPublic = commentId && body.public === true;
  const url = isPublic
    ? `https://graph.instagram.com/v21.0/${encodeURIComponent(commentId)}/replies`
    : `https://graph.instagram.com/v21.0/${encodeURIComponent(pageId)}/messages`;
  const payload = isPublic
    ? { message }
    : commentId
      ? { recipient: { comment_id: commentId }, message: { text: message } }
      : { recipient: { id: recipientId }, messaging_type: "RESPONSE", message: { text: message } };   // 24h window after user's last msg
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type":  "application/json",
    },
    body: JSON.stringify(payload),
  });

  const result = await res.json().catch(() => ({}));
  if (isPublic) {
    // Public replies are not thread messages: never queue them into inbox_messages.
    return new Response(JSON.stringify(res.ok ? { ok: true, id: result?.id ?? null, public: true } : { ok: false, error: result?.error?.message ?? `HTTP ${res.status}`, raw: result, public: true }),
      { status: res.ok ? 200 : res.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
  if (!res.ok) {
    const errText: string = result?.error?.message ?? `HTTP ${res.status}`;
    // A dead token (OAuthException 190) is not a per-message failure: nothing sent
    // through it can succeed until Sam reconnects. 2026-10-01: the drain
    // (dm_send_retry) re-sent every queued row every few hours, and this branch
    // re-queued a FRESH row on each failure, so one reply became 69 rows and the
    // inbox filled with noise while nobody was paged. Held rows (queued:"hold")
    // are invisible to the drain and replayed by instagram-dm-replay the moment a
    // new token lands (trigger on system_settings.meta_instagram_token).
    const tokenDead = isTokenDeadError(result?.error);
    try {
      await sb.from("inbox_messages").insert({
        source: "instagram",
        external_id: externalId,
        sender_handle: externalId,
        body: message,
        direction: "outbound",
        auto_replied: false,
        raw_payload: tokenDead
          ? { queued: "hold", reason: "token_dead", error: errText, comment_id: commentId, recipient_id: recipientId, held_at: new Date().toISOString() }
          : { queued: true, reason: "send_failed", error: errText, comment_id: commentId },
      });
    } catch (_queueErr) { /* queue is best-effort */ }
    let page_receipt: string | null = null;
    if (tokenDead) page_receipt = (await pageTokenDead(sb, "send-instagram-dm", errText)).receipt;
    return new Response(JSON.stringify({ ok: false, error: errText, raw: result, queued: !tokenDead, held: tokenDead, page_receipt }),
      { status: res.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
  return new Response(JSON.stringify({ ok: true, id: result?.message_id ?? null }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
