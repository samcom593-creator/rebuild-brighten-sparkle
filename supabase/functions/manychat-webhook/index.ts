// ManyChat webhook ingestion.
//
// ManyChat is the aggregator that covers Instagram + Messenger + WhatsApp
// natively. In ManyChat, set up a "New Subscriber" or "Default Reply" flow
// with an "External Request" action pointing at this function. Sam will
// paste the URL into ManyChat's External Request step.
//
// Expected shape from ManyChat External Request (configurable via ManyChat UI):
//   {
//     source: "instagram" | "messenger" | "whatsapp" | "tiktok",
//     subscriber_id: "<manychat_id>",
//     sender_handle: "@username_or_phone",
//     sender_name: "Display Name",
//     sender_avatar: "https://...",
//     body: "actual message text",
//     page_id: "..."   // optional
//   }
//
// We also accept a simple {secret} field and validate against
// MANYCHAT_WEBHOOK_SECRET env var to block random POSTs.
//
// Response shape (for ManyChat to dynamically respond):
//   {
//     ok: true,
//     auto_reply: "... optional canned reply text ..."
//   }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-manychat-secret",
};

const APPLY_URL = "https://apex-financial.org/apply";
const CALENDLY_LICENSED = "https://calendly.com/sam-com593/1on1-call-clone";
const GET_LICENSED_URL = "https://apex-financial.org/get-licensed";

const INTEREST_PATTERNS = [
  /\b(interested|info|tell me more|how|what|apply|application)\b/i,
  /\b(licensed|license|insurance|agent|sell|selling)\b/i,
  /\b(commission|income|money|opportunity|hiring)\b/i,
];

const LICENSED_PATTERNS = [
  /\b(licensed|have my license|life insurance license|got my license|life license|221[0-9]|2-?14|2-?15)\b/i,
  /\b(nipr|resident license|non[- ]?resident)\b/i,
];

const SPAM_PATTERNS = [
  /\bcrypto\b/i,
  /\bnft\b/i,
  /\bguaranteed (profit|return)/i,
  /\bonly fans\b/i,
  /t\.me\//i,
];

function classify(body: string): { intent: string; lead_score: number; reply_path: "licensed" | "unlicensed" | "generic" | "spam" | null } {
  if (SPAM_PATTERNS.some((r) => r.test(body))) {
    return { intent: "spam", lead_score: 0, reply_path: null };
  }
  const licensed = LICENSED_PATTERNS.some((r) => r.test(body));
  const interested = INTEREST_PATTERNS.some((r) => r.test(body));
  if (licensed) return { intent: "licensed", lead_score: 90, reply_path: "licensed" };
  if (interested) return { intent: "interested", lead_score: 60, reply_path: "unlicensed" };
  return { intent: "unknown", lead_score: 20, reply_path: "generic" };
}

function replyFor(path: "licensed" | "unlicensed" | "generic", firstName?: string): string {
  const name = firstName ? firstName : "there";
  if (path === "licensed") {
    return `Hey ${name}! Licensed? Perfect. We fast-track licensed producers (24–48h to contracted). Book a 15-min call with Sam: ${CALENDLY_LICENSED}`;
  }
  if (path === "unlicensed") {
    return `Hey ${name}! APEX covers your licensing costs and gets you producing in ~2 weeks. Start here: ${GET_LICENSED_URL}`;
  }
  return `Hey ${name}! This is APEX Financial. If you're curious about joining: ${APPLY_URL}`;
}

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Shared-secret check. Allows both header and body-field auth so it
  // works with ManyChat's External Request form (headers) or a stricter
  // Zapier proxy (body).
  const secret = Deno.env.get("MANYCHAT_WEBHOOK_SECRET");
  const headerSecret = req.headers.get("x-manychat-secret") ?? "";
  let body: any = {};
  try { body = await req.json(); } catch { /* empty */ }
  const bodySecret = body?.secret ?? "";
  if (secret && headerSecret !== secret && bodySecret !== secret) {
    return new Response(JSON.stringify({ error: "forbidden" }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const source = (body.source || "instagram").toLowerCase();
  const subscriberId = body.subscriber_id ?? body.external_id ?? null;
  const senderHandle = body.sender_handle ?? body.handle ?? body.phone ?? null;
  const senderName = body.sender_name ?? body.first_name ?? null;
  const senderAvatar = body.sender_avatar ?? null;
  const text = (body.body ?? body.message ?? body.text ?? "").trim();

  if (!text) {
    return new Response(JSON.stringify({ ok: false, error: "empty body" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { intent, lead_score, reply_path } = classify(text);
  const auto_reply = reply_path ? replyFor(reply_path, senderName?.split(" ")[0]) : null;

  // Persist the inbound message (and the outbound auto-reply as a second row
  // so the full conversation is visible in the inbox view).
  const inbound = {
    source,
    external_id: subscriberId,
    sender_handle: senderHandle,
    sender_name: senderName,
    sender_avatar: senderAvatar,
    body: text,
    direction: "inbound",
    intent,
    lead_score,
    auto_replied: !!auto_reply,
    raw_payload: body,
    replied_at: auto_reply ? new Date().toISOString() : null,
  };

  const { data: inboundRow, error: inboundErr } = await supabase
    .from("inbox_messages")
    .insert(inbound)
    .select("id")
    .single();
  if (inboundErr) {
    console.error("[manychat-webhook] inbound insert error", inboundErr);
    return new Response(JSON.stringify({ ok: false, error: inboundErr.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (auto_reply) {
    await supabase.from("inbox_messages").insert({
      source,
      external_id: subscriberId,
      sender_handle: senderHandle,
      sender_name: senderName,
      body: auto_reply,
      direction: "outbound",
      intent,
      auto_replied: true,
      raw_payload: { in_reply_to: (inboundRow as any)?.id, path: reply_path },
    });
  }

  return new Response(JSON.stringify({
    ok: true,
    intent,
    lead_score,
    auto_reply,
    message_id: (inboundRow as any)?.id,
  }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
