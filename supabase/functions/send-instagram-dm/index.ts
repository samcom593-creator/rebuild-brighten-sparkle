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
//
// PL-WIB-SEND-INSTAGRAM-DM-AUTH (2026-10-08). verify_jwt = false and, until
// this commit, no credential read: a bare POST {} with no Authorization header
// reached the body validation (400, nothing sent). The caller chose the text,
// the comment_id and `public`, so anyone could post a public reply under a
// comment on Sam's media, or DM a commenter, as his account. With no token
// configured, the same caller text went to Sam's Discord instead.
//
// Callers inventoried before gating, all presenting the service key:
// instagram-webhook, instagram-comments-backfill, instagram-dm-replay (24h of
// function_edge_logs: 6 POSTs, all sb_secret_, all from the edge runtime).
// dm_send_retry, the only pg caller, sent the anon key; it was switched to
// system_settings.service_role_key first (migration 20261008062000). No src/
// invoke, no business-ops script.
//
// Gate = requireSendAuth, the send-email gate: service key or an
// admin/manager JWT. The anon key is refused explicitly.

import { isTokenDeadError, pageTokenDead } from "../_shared/instagram-token-dead.ts";
import { requireSendAuth } from "../_shared/require-send-auth.ts";
import { raiseApexAlert } from "../_shared/alert-raise.ts";
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
async function resolveSecrets(sb: any) {
  let token  = Deno.env.get("META_INSTAGRAM_TOKEN")   ?? null;
  let pageId = Deno.env.get("META_INSTAGRAM_PAGE_ID") ?? null;

  if (!token || !pageId) {
    const { data } = await sb.from("system_settings").select("key,value")
      .in("key", ["meta_instagram_token", "meta_instagram_page_id"]);
    for (const r of data ?? []) {
      if (r.key === "meta_instagram_token" && !token && r.value) token = String(r.value);
      if (r.key === "meta_instagram_page_id" && !pageId && r.value) pageId = String(r.value);
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

// ── MP-305 (2026-10-28): what a Meta refusal actually means ────────────────
// Measured 2026-09-28 → 10-27: every one of the 364 "Invalid message id" failures
// carried a URL and Meta's real verdict underneath was code 508 / subcode 2534122,
// "Link can't be shared ... your activity may not follow our Community Standards".
// The account is link-restricted. A link reply can never land; strip the link,
// say where it lives, and send again. "outside of allowed window" is just as
// permanent for that message. Neither is ever queued again: the queue + drain
// turned one failure into 173 attempts on one person.
type MetaKind = "link_blocked" | "window_closed" | "token_dead" | "retryable";
function classifyMetaError(err: any): MetaKind {
  const msg = String(err?.message ?? "").toLowerCase();
  const title = `${err?.error_user_title ?? ""} ${err?.error_user_msg ?? ""}`.toLowerCase();
  const code = Number(err?.code ?? 0), sub = Number(err?.error_subcode ?? 0);
  if (code === 508 || sub === 2534122 || /link can.?t be shared|share links/.test(title)) return "link_blocked";
  if (/outside of allowed window|allowed window|24.?hour/.test(msg) || sub === 2534022) return "window_closed";
  if (isTokenDeadError(err)) return "token_dead";
  return "retryable";
}
export function stripLinks(msg: string): string {
  return msg.replace(/https?:\/\/\S+/gi, (u) => {
    const l = u.toLowerCase();
    if (l.includes("/apply")) return "the apply link in my bio";
    if (l.includes("/fitness")) return "the fitness link in my bio";
    if (l.includes("/mentorship")) return "the mentorship link in my bio";
    if (l.includes("/rentals")) return "the rentals link in my bio";
    if (l.includes("calendly")) return "my calendar link in my bio";
    return "the link in my bio";
  }).replace(/:\s+(the |my )/g, ", $1").replace(/\s{2,}/g, " ").trim();
}
// Record the restriction so the brain stops writing links, and page Sam once per
// 12h with the only fix there is (Instagram app → Settings → Account Status).
async function noteLinkRestriction(sb: any, err: any): Promise<void> {
  const now = new Date().toISOString();
  try { await sb.from("system_settings").upsert({ key: "instagram_links_blocked_at", value: now }, { onConflict: "key" }); } catch (e) { console.error("[send-instagram-dm] links_blocked_at upsert failed", e); }
  try {
    const since = new Date(Date.now() - 12 * 3600_000).toISOString();
    const { data: recent } = await sb.from("bot_alerts").select("id").eq("event_type", "instagram_link_restricted").gte("created_at", since).limit(1);
    if (recent && recent.length) return;
    const r = await raiseApexAlert({
      source: "send-instagram-dm", eventType: "instagram_link_restricted", severity: "warn",
      subject: "Instagram is blocking links in your DMs",
      body: `Meta refused a DM because it had a link (code ${err?.code ?? "?"}: "${String(err?.error_user_msg ?? err?.message ?? "").slice(0, 200)}"). Replies are going out WITHOUT links ("the link's in my bio") until it clears. Fix: Instagram app > Settings > Account Status > request a review. First seen 2026-09-28.`,
      channels: ["ntfy", "email"],
    });
    console.log("[send-instagram-dm] link restriction alert", r.receipt);
  } catch (e) { console.error("[send-instagram-dm] link restriction alert failed", e); }
}
// The brain writes its outbound row BEFORE calling us and a success never wrote a
// receipt, so "delivered" could not be told from "silently refused". Attach the
// outcome (mid, or the refusal) to that row; if no caller row exists (nudges,
// drains), write one so the thread shows what was actually sent.
async function stampOutcome(sb: any, a: { externalId: string | null; message: string; patch: Record<string, unknown>; insertIfMissing?: boolean; tag?: string | null; commentId?: string | null }): Promise<void> {
  const since = new Date(Date.now() - 15 * 60_000).toISOString();
  const find = async (withExt: boolean) => {
    let q = sb.from("inbox_messages").select("id, raw_payload").eq("source", "instagram").eq("direction", "outbound").eq("body", a.message)
      .is("raw_payload->mid", null).gte("created_at", since).order("created_at", { ascending: false }).limit(1);
    if (withExt && a.externalId) q = q.eq("external_id", a.externalId);
    const { data } = await q;
    return (data ?? [])[0] as { id: string; raw_payload: Record<string, unknown> | null } | undefined;
  };
  try {
    const row = (await find(true)) ?? (await find(false));
    if (row) {
      const rp = { ...(row.raw_payload ?? {}), ...a.patch };
      if (a.tag) rp.tag = a.tag;
      await sb.from("inbox_messages").update({ raw_payload: rp }).eq("id", row.id);
      return;
    }
    if (a.insertIfMissing) {
      await sb.from("inbox_messages").insert({
        source: "instagram", external_id: a.externalId, sender_handle: a.externalId, body: a.message, direction: "outbound",
        auto_replied: true, intent: a.tag ? "nudge" : null,
        raw_payload: { ...a.patch, path: "sender", tag: a.tag ?? undefined, comment_id: a.commentId ?? undefined },
      });
    }
  } catch (e) { console.error("[send-instagram-dm] stampOutcome failed", e); }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const auth = await requireSendAuth(req);
  if (!auth.ok) {
    return new Response(JSON.stringify({ ok: false, error: auth.error }), {
      status: auth.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

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
          username: "Galaxy 📥 IG queued",
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
  const tag: string | null = typeof body.tag === "string" ? body.tag : null;
  const attempt = async (text: string) => {
    const p = isPublic ? { message: text } : commentId
      ? { recipient: { comment_id: commentId }, message: { text } }
      : { recipient: { id: recipientId }, messaging_type: "RESPONSE", message: { text } };
    const r = await fetch(url, { method: "POST", headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(p) });
    const j = await r.json().catch(() => ({}));
    return { r, j };
  };
  void payload;
  let { r: res, j: result } = await attempt(message);
  let sentBody = message;
  let linkStripped = false;
  if (!res.ok && !isPublic && classifyMetaError(result?.error) === "link_blocked" && /https?:\/\//i.test(message)) {
    await noteLinkRestriction(sb, result?.error);
    sentBody = stripLinks(message);
    linkStripped = true;
    ({ r: res, j: result } = await attempt(sentBody));
  }
  if (isPublic) {
    // Public replies are not thread messages: never queue them into inbox_messages.
    return new Response(JSON.stringify(res.ok ? { ok: true, id: result?.id ?? null, public: true } : { ok: false, error: result?.error?.message ?? `HTTP ${res.status}`, raw: result, public: true }),
      { status: res.ok ? 200 : res.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
  if (!res.ok) {
    const errText: string = result?.error?.message ?? `HTTP ${res.status}`;
    const kind = classifyMetaError(result?.error);
    if (kind === "link_blocked" || kind === "window_closed") {
      // Permanent for this message. Not queued, not retried: stamp the caller's row
      // so v_ig_dm_delivery_truth counts it as a miss, and tell the caller why.
      await stampOutcome(sb, { externalId, message, patch: { error: errText, send_failed_kind: kind, queued: "dead", settled_at: new Date().toISOString(), meta_code: result?.error?.code ?? null, meta_subcode: result?.error?.error_subcode ?? null }, tag, commentId });
      return new Response(JSON.stringify({ ok: false, error: errText, kind, retryable: false, raw: result }),
        { status: res.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
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
  const mid: string | null = result?.message_id ?? null;
  await stampOutcome(sb, {
    externalId, message, insertIfMissing: true, tag, commentId,
    patch: { mid, delivered_at: new Date().toISOString(), ...(linkStripped ? { sent_body: sentBody, link_stripped: true } : {}), ...(commentId ? { comment_id: commentId } : {}) },
  });
  return new Response(JSON.stringify({ ok: true, id: mid, link_stripped: linkStripped }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
