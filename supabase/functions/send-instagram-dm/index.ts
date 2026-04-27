// send-instagram-dm — send a DM to an IG user via Meta Graph API.
//
// Reads token from META_INSTAGRAM_TOKEN env (preferred) or
// system_settings.meta_instagram_token (fallback so Sam can paste the
// value via bot-sql without dashboard access). Same dual-source pattern
// as send-whatsapp.
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

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

let cachedToken: string | null | undefined;
let cachedPageId: string | null | undefined;

async function resolveSecrets() {
  if (cachedToken !== undefined && cachedPageId !== undefined) {
    return { token: cachedToken, pageId: cachedPageId };
  }
  cachedToken  = Deno.env.get("META_INSTAGRAM_TOKEN")   ?? null;
  cachedPageId = Deno.env.get("META_INSTAGRAM_PAGE_ID") ?? null;
  if (!cachedToken || !cachedPageId) {
    try {
      const sb = createClient(
        Deno.env.get("SUPABASE_URL") ?? "",
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
        { auth: { persistSession: false } });
      const { data } = await sb.from("system_settings").select("key,value")
        .in("key", ["meta_instagram_token", "meta_instagram_page_id"]);
      for (const r of data ?? []) {
        if (r.key === "meta_instagram_token" && !cachedToken && r.value) cachedToken = r.value;
        if (r.key === "meta_instagram_page_id" && !cachedPageId && r.value) cachedPageId = r.value;
      }
    } catch (_) { /* fall through */ }
  }
  return { token: cachedToken, pageId: cachedPageId };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const { token, pageId } = await resolveSecrets();
  if (!token || !pageId) {
    return new Response(JSON.stringify({
      ok: false,
      error: "Instagram not configured. Set meta_instagram_token + meta_instagram_page_id (env or system_settings).",
    }), { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  let body: any;
  try { body = await req.json(); }
  catch { return new Response(JSON.stringify({ ok: false, error: "bad json" }), { status: 400, headers: corsHeaders }); }

  const recipientId = body.recipient_id ?? body.igsid ?? body.to;
  const message     = body.message ?? body.text;
  if (!recipientId || !message) {
    return new Response(JSON.stringify({ ok: false, error: "recipient_id + message required" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const url = `https://graph.facebook.com/v20.0/${encodeURIComponent(pageId)}/messages`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type":  "application/json",
    },
    body: JSON.stringify({
      recipient:        { id: recipientId },
      messaging_type:   "RESPONSE",   // 24h messaging window after user's last msg
      message:          { text: message },
    }),
  });

  const result = await res.json().catch(() => ({}));
  if (!res.ok) {
    return new Response(JSON.stringify({ ok: false, error: result?.error?.message ?? `HTTP ${res.status}`, raw: result }),
      { status: res.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
  return new Response(JSON.stringify({ ok: true, id: result?.message_id ?? null }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
