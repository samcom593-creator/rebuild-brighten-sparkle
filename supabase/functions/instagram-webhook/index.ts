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

  // Process every event: log it AND if it's a DM, fire the auto-reply.
  // Meta retries if we don't 200 within 5s, so the heavy lifting is
  // launched async without blocking the response.
  const entries = (payload?.entry ?? []) as Array<any>;
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "https://msydzhzolwourcdmqxvn.supabase.co";

  for (const entry of entries) {
    await sb.from("instagram_events").insert({
      event_type: payload?.object ?? "unknown",
      external_id: entry?.id ?? null,
      payload: entry,
    }).catch(() => {});

    // Pull DM events out — IG sends them as entry.messaging[].message.text
    const dms = (entry?.messaging ?? []).filter((m: any) =>
      m?.message?.text && !m?.message?.is_echo
    );
    for (const dm of dms) {
      const senderId = dm?.sender?.id;          // IGSID we reply to
      const messageText = dm?.message?.text;
      if (!senderId || !messageText) continue;

      // Idempotency: skip if we've already auto-replied to this sender
      // in the last 60 minutes (prevents loops + spam from rapid msgs).
      const { data: recent } = await sb.from("inbox_messages")
        .select("id")
        .eq("source", "instagram")
        .eq("external_id", senderId)
        .eq("direction", "outbound")
        .gte("created_at", new Date(Date.now() - 60 * 60 * 1000).toISOString())
        .limit(1);
      if (recent && recent.length) continue;

      // Forward to manychat-webhook for classification + reply selection.
      // Reusing that classifier so we have one source of truth for tone.
      try {
        const cls = await fetch(`${supabaseUrl}/functions/v1/manychat-webhook`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-manychat-secret": Deno.env.get("MANYCHAT_WEBHOOK_SECRET") ?? "",
          },
          body: JSON.stringify({
            source: "instagram",
            subscriber_id: senderId,
            sender_handle: senderId,  // IG webhook doesn't expose @handle directly
            body: messageText,
          }),
        });
        const clsResult = await cls.json().catch(() => ({}));
        const reply: string | null = clsResult?.auto_reply ?? null;
        const leadScore: number = Number(clsResult?.lead_score ?? 0);
        const intent: string = String(clsResult?.intent ?? "unknown");

        // Real-time Discord ping for hot leads (≥70). Sam wakes to a
        // mobile push — he can manually reply to the lead in seconds
        // even if our auto-send fails.
        if (leadScore >= 70) {
          const { data: setting } = await sb.from("system_settings")
            .select("value").eq("key", "discord_webhook_url").maybeSingle();
          const webhook = (setting as any)?.value;
          if (webhook) {
            fetch(webhook, {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                username: "APEX 🔥 HOT IG DM",
                content: `**${intent.toUpperCase()}** · score ${leadScore}\n\`\`\`\n${messageText.slice(0, 500)}\n\`\`\`\nFrom IGSID \`${senderId}\` — auto-reply queued / will fire if token configured.`,
              }),
            }).catch(() => {});
          }
        }

        if (!reply) continue;

        // Fire the actual IG send. Don't await — keep the webhook fast.
        fetch(`${supabaseUrl}/functions/v1/send-instagram-dm`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""}`,
          },
          body: JSON.stringify({ recipient_id: senderId, message: reply }),
        }).catch((e) => console.error("[instagram-webhook] send failed", e));
      } catch (e) {
        console.error("[instagram-webhook] auto-reply pipeline failed", e);
      }
    }
  }

  // Meta expects 200 within 5 seconds or it retries.
  return new Response(JSON.stringify({ ok: true }), {
    status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
