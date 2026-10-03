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

// IGSID -> { name, username } via the Instagram-Login user profile endpoint,
// with the same token send-instagram-dm uses. Best-effort: any failure returns
// nulls and the pipeline carries on with the numeric id.
async function resolveSender(sb: any, igsid: string): Promise<{ name: string | null; username: string | null }> {
  const none = { name: null, username: null };
  try {
    const { data } = await sb.from("system_settings").select("value").eq("key", "meta_instagram_token").limit(1);
    const raw = data?.[0]?.value;
    const token = typeof raw === "string" ? raw.trim().replace(/^"|"$/g, "") : null;
    if (!token) return none;
    const r = await fetch(
      `https://graph.instagram.com/v21.0/${encodeURIComponent(igsid)}?fields=name,username&access_token=${encodeURIComponent(token)}`,
      { signal: AbortSignal.timeout(4000) },
    );
    const j = await r.json();
    if (!r.ok || j?.error) { console.warn("[instagram-webhook] profile lookup failed", JSON.stringify(j).slice(0, 200)); return none; }
    return { name: typeof j?.name === "string" ? j.name : null, username: typeof j?.username === "string" ? j.username : null };
  } catch (e) {
    console.warn("[instagram-webhook] profile lookup threw", e);
    return none;
  }
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
  // Instagram-Login product webhooks are signed with the INSTAGRAM app secret;
  // Facebook-product webhooks with the Facebook app secret. Accept either —
  // checking only META_APP_SECRET silently 401'd every real Instagram delivery
  // (2026-09-27: Jesu DM'd, zero rows landed).
  const secrets = [Deno.env.get("INSTAGRAM_APP_SECRET"), Deno.env.get("META_APP_SECRET")].filter((s): s is string => !!s);
  if (secrets.length) {
    const sig = req.headers.get("x-hub-signature-256");
    let ok = false;
    for (const s of secrets) { if (await verifySignature(rawBody, sig, s)) { ok = true; break; } }
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

  // Process every event: log it AND if it's a DM, fire the auto-reply.
  // Meta retries if we don't 200 within 5s, so the heavy lifting is
  // launched async without blocking the response.
  const entries = (payload?.entry ?? []) as Array<any>;
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "https://xrzweoneiieddzxogewk.supabase.co";
  const pending: Promise<void>[] = [];

  for (const entry of entries) {
    // supabase-js QueryBuilder has no .catch — await + try/catch
    try {
      await sb.from("instagram_events").insert({
        event_type: payload?.object ?? "unknown",
        external_id: entry?.id ?? null,
        payload: entry,
      });
    } catch (_logErr) { /* event log is best-effort; Meta still gets a 200 */ }

    // Sam's own typed messages arrive as echoes. If the text isn't something the bot
    // sent to that person in the last 10 minutes, Sam wrote it: mark the thread as his
    // so the brain stays out of it (hand-off, 14 days).
    for (const ev of (entry?.messaging ?? []) as any[]) {
      if (!ev?.message?.is_echo || !ev?.message?.text) continue;
      const them = ev?.recipient?.id; const text = String(ev.message.text).trim();
      if (!them) continue;
      try {
        const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
        const { data: botSent } = await sb.from("inbox_messages").select("id, body").eq("external_id", them).eq("direction", "outbound").gte("created_at", since).limit(30);
        const mine = (botSent ?? []).some((r: { body: string | null }) => (r.body ?? "").trim() === text);
        if (!mine) {
          await sb.from("inbox_messages").insert({ source: "instagram", direction: "outbound", external_id: them, sender_handle: them, body: text, intent: "sam_manual", auto_replied: false, raw_payload: { echo: true, mid: ev.message.mid ?? null } });
        }
      } catch (e) { console.error("[instagram-webhook] echo hand-off failed", e); }
    }

    // Pull DM events out — IG sends them as entry.messaging[].message.text
    const dms = (entry?.messaging ?? []).filter((m: any) =>
      m?.message?.text && !m?.message?.is_echo
    );
    for (const dm of dms) {
      const senderId = dm?.sender?.id;          // IGSID we reply to
      const messageText = dm?.message?.text;
      if (!senderId || !messageText) continue;
      // A reply to one of Sam's stories arrives as a normal DM carrying
      // reply_to.story — same thread, same brain, tagged so the reply can say so.
      const channel: "dm" | "story" = dm?.message?.reply_to?.story ? "story" : "dm";

      // 2026-09-27: the old guard here skipped EVERY message from a sender for
      // 60 minutes after one reply. That is why Jesu's "fitness", "mentorship"
      // and "what is this link" got silence — they never reached the brain.
      // A conversation needs every turn answered. Duplicate protection is now
      // (a) Meta redeliveries: same message mid already logged -> skip, and
      // (b) a 10s storm guard per sender so a burst gets one reply.
      const mid: string | null = dm?.message?.mid ?? null;
      if (mid) {
        const { count } = await sb.from("instagram_events")
          .select("id", { count: "exact", head: true })
          .contains("payload", { messaging: [{ message: { mid } }] });
        if ((count ?? 0) > 1) continue;
      }
      const { data: burst } = await sb.from("inbox_messages")
        .select("id")
        .eq("source", "instagram")
        .eq("external_id", senderId)
        .eq("direction", "outbound")
        .gte("created_at", new Date(Date.now() - 5 * 1000).toISOString())
        .limit(1);
      if (burst && burst.length) continue;

      // Brain + send run AFTER the 200 goes back to Meta (5s deadline): the brain
      // now reads thread history and may call a model, so it is not awaited here.
      const pipeline = (async () => {
        try {
          // The webhook carries only the IG-scoped id; the profile endpoint turns it
          // into a name + @handle so replies greet a person and Sam's page names one.
          const who = await resolveSender(sb, senderId);
          const cls = await fetch(`${supabaseUrl}/functions/v1/manychat-webhook`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-manychat-secret": Deno.env.get("MANYCHAT_WEBHOOK_SECRET") ?? "",
            },
            body: JSON.stringify({
              source: "instagram",
              channel,
              subscriber_id: senderId,
              sender_handle: who.username ? `@${who.username}` : senderId,
              sender_name: who.name,
              body: messageText,
              message_id: mid,
            }),
          });
          const clsResult = await cls.json().catch(() => ({}));
          const reply: string | null = clsResult?.auto_reply ?? null;

          // Urgent hot-lead alerting (licensed = call now) is owned by the brain
          // (manychat-webhook), which fires ntfy + Discord for every transport so
          // there is a single source of truth and no double-push. Here we only
          // send the reply the brain selected.
          if (!reply) return;

          const sent = await fetch(`${supabaseUrl}/functions/v1/send-instagram-dm`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""}`,
            },
            body: JSON.stringify({ recipient_id: senderId, message: reply }),
          });
          const sentJson = await sent.json().catch(() => ({}));
          if (!sentJson?.ok) console.error("[instagram-webhook] send failed", JSON.stringify(sentJson).slice(0, 400));
        } catch (e) {
          console.error("[instagram-webhook] auto-reply pipeline failed", e);
        }
      })();
      pending.push(pipeline);
    }

    // ── Comments on Sam's own posts / reels ("comment APEX") ──
    // Delivered as entry.changes[] with field "comments". A comment that carries
    // intent gets a PRIVATE reply: Instagram delivers it as a DM to the commenter
    // (recipient.comment_id). Sam's own comments and empty/emoji-only ones are
    // ignored; the brain decides silence exactly as it does for DMs.
    const comments = (entry?.changes ?? []).filter((c: any) =>
      c?.field === "comments" && c?.value?.text && c?.value?.from?.id && c?.value?.id &&
      String(c.value.from.id) !== String(entry?.id)
    );
    for (const c of comments) {
      const v = c.value;
      const commentId: string = String(v.id);
      const senderId: string = String(v.from.id);
      const username: string | null = v.from?.username ?? null;
      const text: string = v.text;
      const mediaId: string | null = v.media?.id ?? null;

      // Redeliveries are handled by the ig_comment_events claim below (atomic, primary key).

      // One reply per comment, ever: claim it first (primary key), shared with the backfill job.
      const { data: claimed } = await sb.from("ig_comment_events").upsert({ comment_id: commentId, media_id: mediaId, username, text, intent: "claimed_live" }, { onConflict: "comment_id", ignoreDuplicates: true }).select("comment_id");
      if (!claimed?.length) continue;

      // The claim row is also the audit row: intent / public reply id / dm_sent land
      // on it when the pipeline settles, the same shape the backfill writes. Until
      // 2026-10-03 the live path only ever wrote "claimed_live" (142 rows, 0 updated),
      // so nothing could say which live comments were answered.
      const audit: Record<string, unknown> = {};
      const pipeline = (async () => {
        try {
          const who = username ? { name: null as string | null, username } : await resolveSender(sb, senderId);
          const cls = await fetch(`${supabaseUrl}/functions/v1/manychat-webhook`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-manychat-secret": Deno.env.get("MANYCHAT_WEBHOOK_SECRET") ?? "",
            },
            body: JSON.stringify({
              source: "instagram",
              channel: "comment",
              comment_id: commentId,
              media_id: mediaId,
              subscriber_id: senderId,
              sender_handle: who.username ? `@${who.username}` : senderId,
              sender_name: who.name,
              body: text,
            }),
          });
          const clsResult = await cls.json().catch(() => ({}));
          const reply: string | null = clsResult?.auto_reply ?? null;
          const publicReply: string | null = clsResult?.public_reply ?? null;
          audit.intent = clsResult?.intent ?? "unclassified"; audit.public_reply = publicReply; audit.dm_sent = false;
          const sendHeaders = {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""}`,
          };
          // Public reply under the comment (🔥 on props, "check your dms 📩" on intent).
          if (publicReply) {
            const pub = await fetch(`${supabaseUrl}/functions/v1/send-instagram-dm`, {
              method: "POST", headers: sendHeaders,
              body: JSON.stringify({ comment_id: commentId, external_id: senderId, public: true, message: publicReply }),
            });
            const pubJson = await pub.json().catch(() => ({}));
            if (pubJson?.ok) audit.reply_id = pubJson.id ?? null;
            else { audit.error = `public: ${String(pubJson?.error ?? "failed").slice(0, 160)}`; console.error("[instagram-webhook] comment public-reply failed", JSON.stringify(pubJson).slice(0, 400)); }
          }
          if (!reply) return;
          const sent = await fetch(`${supabaseUrl}/functions/v1/send-instagram-dm`, {
            method: "POST", headers: sendHeaders,
            body: JSON.stringify({ comment_id: commentId, external_id: senderId, message: reply }),
          });
          const sentJson = await sent.json().catch(() => ({}));
          if (sentJson?.ok) audit.dm_sent = true;
          else { audit.error = [audit.error, `dm: ${String(sentJson?.error ?? "failed").slice(0, 160)}`].filter(Boolean).join(" | "); console.error("[instagram-webhook] comment private-reply failed", JSON.stringify(sentJson).slice(0, 400)); }
        } catch (e) {
          audit.error = [audit.error, `pipeline: ${String(e).slice(0, 160)}`].filter(Boolean).join(" | ");
          console.error("[instagram-webhook] comment pipeline failed", e);
        } finally {
          try { await sb.from("ig_comment_events").update(audit).eq("comment_id", commentId); }
          catch (e) { console.error("[instagram-webhook] comment audit write failed", e); }
        }
      })();
      pending.push(pipeline);
    }
  }

  // Keep the isolate alive for the reply work without holding Meta's 5s clock.
  const all = Promise.allSettled(pending);
  const rt = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
  if (rt?.waitUntil) rt.waitUntil(all); else await all;

  // Meta expects 200 within 5 seconds or it retries.
  return new Response(JSON.stringify({ ok: true }), {
    status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
