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

// Deploy trigger: commit 3b07e4c — register manychat-webhook

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-manychat-secret",
};

const APPLY_URL = "https://apex-financial.org/apply";
const CALENDLY_LICENSED = "https://calendly.com/sam-com593/1on1-call-clone";
const GET_LICENSED_URL = "https://apex-financial.org/get-licensed";

// Order matters in classify() — first match wins. Most specific first.
const LICENSED_PATTERNS = [
  /\b(i'?m licensed|have my license|got my license|life license|2-?15|2-?14|221[0-9])\b/i,
  /\b(nipr|resident license|non[- ]?resident)\b/i,
];
const NOT_INTERESTED_PATTERNS = [
  /\b(not interested|no thanks|stop|unsubscribe|leave me alone|never mind)\b/i,
];
const SPAM_PATTERNS = [
  /\bcrypto\b/i, /\bnft\b/i, /\bbtc\b/i, /\bguaranteed (profit|return)/i,
  /\bonly\s?fans\b/i, /t\.me\//i, /\bbinary options\b/i, /forex signals/i,
  /click here to claim/i, /\bgift card\b/i, /\bsugar (daddy|momma)\b/i,
];
const SCAM_SKEPTIC_PATTERNS = [
  /\b(is this (a )?scam|too good to be true|sketchy|legit|real|fake|catch|red flag)\b/i,
  /\b(mlm|pyramid|multi[- ]?level)\b/i,
];
const PRICING_PATTERNS = [
  /\b(how much|salary|pay|earn|income|commission|comp(ensation)?|make money|how do (you|i) get paid)\b/i,
  /\$\d+|\d+k|\bsix figures?\b/i,
];
const STATE_ASK_PATTERNS = [
  /\b(what state|which state|do you hire in|available in|hire in|where are you)\b/i,
];
const TIME_TO_PRODUCE_PATTERNS = [
  /\b(how long|how soon|when can i start|time(line)? to|days to|weeks to)\b/i,
];
const INTEREST_PATTERNS = [
  /\b(interested|info|tell me more|sign me up|count me in|how (do|can) i (join|apply))\b/i,
  /\b(insurance|agent|sell|selling|hiring|opportunity|recruiting)\b/i,
  /\b(apply|application)\b/i,
];
const GREETING_ONLY_PATTERNS = [
  /^(hey|hi|hello|yo|sup|whats up|wsg|hola|gm|good (morning|evening|afternoon))[\s!.?]*$/i,
];

type ReplyPath =
  | "licensed" | "unlicensed" | "scam_skeptic" | "pricing"
  | "state_ask" | "time_to_produce" | "greeting" | "generic";

interface Classification {
  intent: string;
  lead_score: number;
  reply_path: ReplyPath | null;
}

function classify(body: string): Classification {
  const t = body.trim();
  if (SPAM_PATTERNS.some(r => r.test(t)))           return { intent: "spam", lead_score: 0, reply_path: null };
  if (NOT_INTERESTED_PATTERNS.some(r => r.test(t))) return { intent: "not_interested", lead_score: 0, reply_path: null };
  if (LICENSED_PATTERNS.some(r => r.test(t)))       return { intent: "licensed", lead_score: 95, reply_path: "licensed" };
  if (SCAM_SKEPTIC_PATTERNS.some(r => r.test(t)))   return { intent: "scam_skeptic", lead_score: 50, reply_path: "scam_skeptic" };
  if (PRICING_PATTERNS.some(r => r.test(t)))        return { intent: "pricing", lead_score: 70, reply_path: "pricing" };
  if (STATE_ASK_PATTERNS.some(r => r.test(t)))      return { intent: "state_ask", lead_score: 65, reply_path: "state_ask" };
  if (TIME_TO_PRODUCE_PATTERNS.some(r => r.test(t))) return { intent: "time_to_produce", lead_score: 70, reply_path: "time_to_produce" };
  if (GREETING_ONLY_PATTERNS.some(r => r.test(t)))  return { intent: "greeting", lead_score: 35, reply_path: "greeting" };
  if (INTEREST_PATTERNS.some(r => r.test(t)))       return { intent: "interested", lead_score: 60, reply_path: "unlicensed" };
  return { intent: "unknown", lead_score: 20, reply_path: "generic" };
}

// Sam-voice: short, direct, lowercase-friendly, ends with link or question.
function replyFor(path: ReplyPath, firstName?: string): string {
  const n = (firstName?.trim() && firstName.split(" ")[0]) || "yo";
  const replies: Record<ReplyPath, string> = {
    licensed:        `${n} — licensed? we fast-track contracted producers in 24-48h. grab 15min with me: ${CALENDLY_LICENSED}`,
    unlicensed:      `${n} — appreciate the dm 🙏 we cover your licensing course and get you producing in ~2 weeks. apply when you're ready: ${GET_LICENSED_URL}`,
    scam_skeptic:    `${n} — fair question. no MLM, no upfront fees. you contract direct with the carriers, we train + send leads. apply and we'll show you everything: ${APPLY_URL}`,
    pricing:         `${n} — 100% commission, paid 9-month advance. average rookie writes $20k+ ALP their first month after license. apply: ${APPLY_URL}`,
    state_ask:       `${n} — we hire across all 50 states. what state are you in? then apply here: ${APPLY_URL}`,
    time_to_produce: `${n} — licensed agents are contracted in 48h. unlicensed → ~2 weeks to your license, then producing same week. start here: ${APPLY_URL}`,
    greeting:        `${n} 👋 sam from APEX. we hire + train life insurance agents. covered course, paid leads. you looking to get into the business? ${APPLY_URL}`,
    generic:         `${n} — APEX Financial. we hire life insurance agents (licensed or not). curious? ${APPLY_URL}`,
  };
  return replies[path];
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
