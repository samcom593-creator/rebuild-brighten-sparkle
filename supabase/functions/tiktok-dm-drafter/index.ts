// tiktok-dm-drafter — TikTok's API is closed for personal/creator-account
// DMs (Business API for messages is whitelisted; almost no agencies have
// access). Workaround: Sam pastes the TikTok DM text in here, we run the
// SAME classifier the IG auto-replier uses, return a copy-pasteable reply
// in Sam's voice. He taps copy → switches to TikTok → pastes → done.
//
// Body: { message: "<dm text>", sender_name?: "<handle or first name>" }
// Returns: { intent, lead_score, draft_reply, classification_reason }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const APPLY_URL = "https://apex-financial.org/apply";
const CALENDLY_LICENSED = "https://calendly.com/sam-com593/1on1-call-clone";
const GET_LICENSED_URL = "https://apex-financial.org/get-licensed";

// Same classifier as manychat-webhook — keep them in sync. Duplicated
// rather than imported because edge functions can't share runtime
// modules unless they're in _shared/, and these regexes are small.
const LICENSED   = [/\b(i'?m licensed|have my license|got my license|life license|2-?15|2-?14|221[0-9])\b/i, /\b(nipr|resident license|non[- ]?resident)\b/i];
const NOT_INT    = [/\b(not interested|no thanks|stop|unsubscribe|leave me alone|never mind)\b/i];
const SPAM       = [/\bcrypto\b/i, /\bnft\b/i, /\bonly\s?fans\b/i, /t\.me\//i, /\bgift card\b/i];
const SCAM_SKEP  = [/\b(is this (a )?scam|too good to be true|legit|fake|catch|red flag)\b/i, /\b(mlm|pyramid|multi[- ]?level)\b/i];
const PRICING    = [/\b(how much|salary|pay|earn|income|commission|comp(ensation)?|make money)\b/i, /\$\d+|\d+k|\bsix figures?\b/i];
const STATE_ASK  = [/\b(what state|which state|do you hire in|available in|hire in)\b/i];
const TIME_PROD  = [/\b(how long|how soon|when can i start|time(line)? to|days to|weeks to)\b/i];
const INTEREST   = [/\b(interested|info|tell me more|sign me up|count me in|how (do|can) i (join|apply))\b/i, /\b(insurance|agent|sell|selling|hiring|opportunity|recruiting)\b/i, /\b(apply|application)\b/i];
const GREETING   = [/^(hey|hi|hello|yo|sup|whats up|wsg|hola|gm|good (morning|evening|afternoon))[\s!.?]*$/i];

function classify(t: string) {
  const x = t.trim();
  if (SPAM.some(r => r.test(x)))      return { path: "spam",       intent: "spam",            score: 0  };
  if (NOT_INT.some(r => r.test(x)))   return { path: "not",        intent: "not_interested",  score: 0  };
  if (LICENSED.some(r => r.test(x)))  return { path: "licensed",   intent: "licensed",        score: 95 };
  if (SCAM_SKEP.some(r => r.test(x))) return { path: "scam_skeptic", intent: "scam_skeptic",  score: 50 };
  if (PRICING.some(r => r.test(x)))   return { path: "pricing",    intent: "pricing",         score: 70 };
  if (STATE_ASK.some(r => r.test(x))) return { path: "state_ask",  intent: "state_ask",       score: 65 };
  if (TIME_PROD.some(r => r.test(x))) return { path: "time_to_produce", intent: "time_to_produce", score: 70 };
  if (GREETING.some(r => r.test(x)))  return { path: "greeting",   intent: "greeting",        score: 35 };
  if (INTEREST.some(r => r.test(x)))  return { path: "unlicensed", intent: "interested",      score: 60 };
  return { path: "generic", intent: "unknown", score: 20 };
}

function reply(path: string, name: string): string {
  const n = name.trim().split(" ")[0] || "yo";
  switch (path) {
    case "licensed":        return `${n} — licensed? we fast-track contracted producers in 24-48h. grab 15min with me: ${CALENDLY_LICENSED}`;
    case "unlicensed":      return `${n} — appreciate the dm 🙏 we cover your licensing course and get you producing in ~2 weeks. apply when you're ready: ${GET_LICENSED_URL}`;
    case "scam_skeptic":    return `${n} — fair question. no MLM, no upfront fees. you contract direct with the carriers, we train + send leads. apply and we'll show you everything: ${APPLY_URL}`;
    case "pricing":         return `${n} — 100% commission, paid 9-month advance. average rookie writes $20k+ ALP their first month after license. apply: ${APPLY_URL}`;
    case "state_ask":       return `${n} — we hire across all 50 states. what state are you in? then apply here: ${APPLY_URL}`;
    case "time_to_produce": return `${n} — licensed agents are contracted in 48h. unlicensed → ~2 weeks to your license, then producing same week. start here: ${APPLY_URL}`;
    case "greeting":        return `${n} 👋 sam from APEX. we hire + train life insurance agents. covered course, paid leads. you looking to get into the business? ${APPLY_URL}`;
    case "spam":            return "(spam — recommend not replying)";
    case "not":             return `${n} — appreciate it, all the best 🙏`;
    default:                return `${n} — APEX Financial. we hire life insurance agents (licensed or not). curious? ${APPLY_URL}`;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  let body: any = {};
  try { body = await req.json(); } catch { /* */ }

  const message = (body?.message ?? body?.text ?? "").trim();
  const senderName = (body?.sender_name ?? body?.handle ?? "").toString();
  if (!message) {
    return new Response(JSON.stringify({ error: "message required" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const c = classify(message);
  const draft = reply(c.path, senderName);

  // Log for the inbox + the morning digest
  try {
    const sb = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } });
    await sb.from("inbox_messages").insert({
      source: "tiktok",
      sender_handle: senderName || null,
      sender_name: senderName || null,
      body: message,
      direction: "inbound",
      intent: c.intent,
      lead_score: c.score,
      auto_replied: false,  // user must manually copy + paste
      raw_payload: { drafted_reply: draft },
    });
  } catch (_) { /* don't block on logging */ }

  return new Response(JSON.stringify({
    ok: true,
    intent: c.intent,
    lead_score: c.score,
    reply_path: c.path,
    draft_reply: draft,
    note: c.path === "spam"
      ? "Don't reply — flagged as spam."
      : "Copy + paste this reply into the TikTok thread.",
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
