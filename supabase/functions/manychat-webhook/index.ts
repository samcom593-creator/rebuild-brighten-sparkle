// manychat-webhook — the INBOUND ROUTING BRAIN for every DM/comment transport.
//
// One classifier, one source of truth for tone, shared by every channel that
// forwards an inbound message here (instagram-webhook native Meta events, and
// ManyChat's External Request while it is still in the loop). It classifies the
// message, logs the lead, and returns the reply text the transport should send.
//
// ROUTING SPEC (Sam, 2026-09-26 — "fix everything, make it live"):
//   1. FITNESS intent  -> push straight to the King of Sales fitness funnel.
//   2. LICENSED (has a life licence) -> URGENT. Push the onboarding-call link
//      AND fire an instant ntfy + Discord alert so Sam can call them to get
//      contracted as fast as physically possible.
//   3. Everything else about the opportunity -> NO questions, NO qualifying.
//      Push directly to the Apex apply site. Friction kills the funnel.
//   4. Spam / not-interested -> logged, no reply.
//
// Expected inbound shape (configurable per transport):
//   { source, subscriber_id, sender_handle, sender_name, body, email?, phone?, state? }
// Auth: shared secret via x-manychat-secret header OR body.secret (MANYCHAT_WEBHOOK_SECRET).
// Response: { ok, intent, lead_score, auto_reply, apply_url, ... }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-manychat-secret",
};

// Funnel destinations — where each intent is driven.
const APPLY_URL = "https://apex-financial.org/apply";
// Licensed prospects book straight onto Sam's schedule.
const LICENSED_CALL_URL = "https://calendly.com/apexfinancialempire/licensed-prospect-call-clone";
// Licensed prospect who is bringing a team / runs an agency. Same link until
// Sam sends the team-specific one — swap this constant only, nothing else moves.
const TEAM_CALL_URL = "https://calendly.com/apexfinancialempire/licensed-prospect-call-clone";
const FITNESS_URL = "https://kingofsales-brand.vercel.app/fitness";
// Sam's four other lanes (2026-09-27): every DM gets ONE message + ONE link to
// the landing page that converts it. Nothing is answered in-thread.
const MENTORSHIP_URL = "https://kingofsales-brand.vercel.app/mentorship";
const RENTALS_URL    = "https://kingofsales-brand.vercel.app/rentals";
const PARTNER_URL    = "https://kingofsales-brand.vercel.app/#f-collab";
// Someone who wants a POLICY (a client, not a recruit) — the help-center intake
// is the no-lost-leads pipeline Sam works personally.
const INSURANCE_URL  = "https://policy-help-center-gamma.vercel.app";
const NTFY_TOPIC = "https://ntfy.sh/sams-agent-yrkv9kbqp9e987nb";

function applyUrl(rawSource: string): string {
  const src = (rawSource || "instagram").replace(/[^a-z0-9_]/gi, "").toLowerCase() || "instagram";
  return `${APPLY_URL}?utm_source=${src}&utm_medium=dm&utm_campaign=recruiting_dm`;
}

// Order matters in classify() — first match wins, most specific first.
const NOT_INTERESTED_PATTERNS = [
  /\b(not interested|no thanks|stop|unsubscribe|leave me alone|never mind)\b/i,
];
const SPAM_PATTERNS = [
  /\bcrypto\b/i, /\bnft\b/i, /\bbtc\b/i, /\bguaranteed (profit|return)/i,
  /\bonly\s?fans\b/i, /t\.me\//i, /\bbinary options\b/i, /forex signals/i,
  /click here to claim/i, /\bgift card\b/i, /\bsugar (daddy|momma)\b/i,
];
// LICENSED must be checked before FITNESS/APPLY — a licensed producer is the
// highest-value lead and gets the urgent path no matter what else they say.
const LICENSED_PATTERNS = [
  /\b(i'?m licensed|i am licensed|have my license|have my licence|got my license|got my licence|already licensed)\b/i,
  /\b(life license|life licence|life insurance license|2-?15|2-?14|221[0-9])\b/i,
  /\b(nipr|resident license|non[- ]?resident license)\b/i,
];
// TEAM signal — a licensed prospect who runs an agency / brings downline gets
// the team call. Checked only within the licensed branch.
const TEAM_PATTERNS = [
  /\b(my team|our team|bring my team|have a team|got a team|move my team)\b/i,
  /\b(my agency|agency owner|my downline|my agents|my producers|my group|my org)\b/i,
  /\b(we have \d+|team of \d+|\d+ agents|\d+ producers)\b/i,
];
// FITNESS intent — route to the fitness funnel instead of recruiting.
const FITNESS_PATTERNS = [
  /\b(fitness|gym|workout|work out|training plan|meal plan|diet|nutrition)\b/i,
  /\b(lose weight|weight loss|get in shape|shredded|build muscle|transformation)\b/i,
  /\b(personal train(er|ing)|coaching|body|physique|bulk|cut|fat loss)\b/i,
];

// PARTNERSHIP — brands / collabs / sponsors go to the form, never handled in-thread.
const PARTNER_PATTERNS = [
  /\b(partner|partnership|collab|collaborat\w*|sponsor\w*|brand deal|ambassador|affiliate|ugc|work together|feature (you|sam)|podcast|interview (you|sam)|paid promo|promo(te)? (my|our))\b/i,
];
// "Is this really Sam?" / pushback on talking to a bot — disclose the assistant.
const ASSISTANT_ASK_PATTERNS = [
  /\b(is this (really )?(sam|you)|real person|are you a bot|is this a bot|automated|auto[- ]?reply|talk to sam|speak to sam|sam himself|the real sam|your number|can i call)\b/i,
];
// CARS — Arizona rentals, quote-based.
const RENTALS_PATTERNS = [
  /\b(rent(al|ing)?|rent a car|car rental|exotic|lambo|lamborghini|ferrari|porsche|mclaren|corvette|g[- ]?wagon|urus|need a car|weekend car|scottsdale|phoenix car)\b/i,
];
// MENTORSHIP — the three-lane soft launch.
const MENTORSHIP_PATTERNS = [
  /\b(mentor\w*|inner circle|learn from you|teach me|show me how you|get into (car rentals|your business))\b/i,
];
// INSURANCE CLIENT — wants a policy, not a job. Checked AFTER licensed/opportunity signals.
const INSURANCE_CLIENT_PATTERNS = [
  /\b(life insurance|insurance policy|get (a )?policy|need (a )?policy|a policy|policy (cost|price|quote)|policies|premium|coverage|final expense|burial|term life|whole life|\biul\b|get covered|insure (me|my)|quote|how much (is|does|for|would) (a |the |my )?(policy|coverage|insurance))\b/i,
];
// OPPORTUNITY — explicit recruiting signals (STRONG) + earning questions (MONEY).
// STRONG alone gates the insurance-client lane, so "how much does a policy cost"
// stays a sale while "how much money can I make" is a recruit.
const RECRUIT_STRONG_PATTERNS = [
  /\b(join|your team|the team|recruit\w*|hiring|become an agent|be an agent|sell insurance|selling insurance|career|opportunity|how does this work|get started|work with you|apply|sign up|licens(e|ing) (course|exam|class)|get licensed)\b/i,
];
// INTEREST — a yes to the pitch. Short replies like these in Sam's DMs are
// overwhelmingly prospects answering his recruiting content or outreach.
const INTEREST_PATTERNS = [
  /\b(i'?m interested|im interested|interested in (this|that|joining|the opportunity)|tell me more|more info|send me (the )?(info|details|link)|i'?m down|im down|let'?s do it|sign me up|count me in|how do i start|where do i start|i want in|i wanna join)\b/i,
];
const MONEY_PATTERNS = [
  /\b(make money|money can (i|you|we) make|how much (money )?(can|do|could|would) (i|you|we|someone) (make|earn)|earn(ing)?s?\b|income|get paid|commission)\b/i,
];

type ReplyPath = "licensed" | "licensed_team" | "fitness" | "apply" | "partnership" | "assistant" | "rentals" | "mentorship" | "insurance_client" | "route";

interface Classification {
  intent: string;
  lead_score: number;
  reply_path: ReplyPath | null; // null = logged, no reply (spam / not-interested)
  urgent: boolean;              // true = fire the instant call-now alert
}

function classify(body: string): Classification {
  const t = (body || "").trim();
  if (SPAM_PATTERNS.some((r) => r.test(t)))           return { intent: "spam", lead_score: 0, reply_path: null, urgent: false };
  if (NOT_INTERESTED_PATTERNS.some((r) => r.test(t))) return { intent: "not_interested", lead_score: 0, reply_path: null, urgent: false };
  if (LICENSED_PATTERNS.some((r) => r.test(t))) {
    // Licensed AND bringing a team = highest value: the team call.
    if (TEAM_PATTERNS.some((r) => r.test(t)))         return { intent: "licensed_team", lead_score: 99, reply_path: "licensed_team", urgent: true };
    return { intent: "licensed", lead_score: 95, reply_path: "licensed", urgent: true };
  }
  if (PARTNER_PATTERNS.some((r) => r.test(t)))        return { intent: "partnership", lead_score: 50, reply_path: "partnership", urgent: false };
  if (ASSISTANT_ASK_PATTERNS.some((r) => r.test(t)))  return { intent: "assistant_ask", lead_score: 40, reply_path: "assistant", urgent: false };
  if (RENTALS_PATTERNS.some((r) => r.test(t)))        return { intent: "rentals", lead_score: 45, reply_path: "rentals", urgent: false };
  if (FITNESS_PATTERNS.some((r) => r.test(t)))        return { intent: "fitness", lead_score: 55, reply_path: "fitness", urgent: false };
  if (MENTORSHIP_PATTERNS.some((r) => r.test(t)))     return { intent: "mentorship", lead_score: 50, reply_path: "mentorship", urgent: false };
  const recruitStrong = RECRUIT_STRONG_PATTERNS.some((r) => r.test(t));
  // A policy buyer is a SALE — only a STRONG recruit signal overrides it.
  if (!recruitStrong && INSURANCE_CLIENT_PATTERNS.some((r) => r.test(t))) return { intent: "insurance_client", lead_score: 80, reply_path: "insurance_client", urgent: false };
  if (recruitStrong || MONEY_PATTERNS.some((r) => r.test(t))) return { intent: "opportunity", lead_score: 60, reply_path: "apply", urgent: false };
  // Someone saying YES to the pitch ("interested", "tell me more", "I'm down") —
  // that is a prospect replying to Sam's recruiting, push them through.
  if (INTEREST_PATTERNS.some((r) => r.test(t)))        return { intent: "opportunity", lead_score: 65, reply_path: "apply", urgent: false };
  // Sam 2026-09-27: casual / social / flirty DMs are NOT the bot's — no reply,
  // just logged, so people can still reach him like a person. Only clear intent
  // gets pushed through a funnel.
  return { intent: "casual", lead_score: 10, reply_path: null, urgent: false };
}

// Sam-voice: short, direct, ends with the link. No qualifying questions.
function replyFor(path: ReplyPath, rawSource: string, firstName?: string): string {
  const n = (firstName?.trim() && firstName.split(" ")[0]) || "yo";
  const apply = applyUrl(rawSource);
  const replies: Record<ReplyPath, string> = {
    licensed:         `${n} — you're licensed, that changes everything. we fast-track contracted producers. grab a call directly on my schedule and let's get you writing this week: ${LICENSED_CALL_URL}`,
    licensed_team:    `${n} — licensed AND you've got a team? that's exactly who we build with. book straight onto my calendar and let's map moving your whole team over: ${TEAM_CALL_URL}`,
    fitness:          `${n} — appreciate you reaching out. everything on the fitness side lives here, plans + 1-on-1 coaching: ${FITNESS_URL}`,
    apply:            `${n} — let's get you moving. start your application here and we'll route you by state and licence status: ${apply}`,
    mentorship:       `${n} — mentorship is a soft launch, no price on the page. pick your lane and apply, if you're a fit i reach out personally: ${MENTORSHIP_URL}`,
    rentals:          `${n} — cars are quote-based, no public pricing. drop your dates + the car you want here and i'll come back fast: ${RENTALS_URL}`,
    insurance_client: `${n} — i can get you covered. drop the basics here and i'll personally follow up with options that fit: ${INSURANCE_URL}`,
    partnership:      `${n} — quick heads up: this is sam's assistant, not sam. brand + partnership stuff runs through the form so it actually gets seen — fill it and it's in front of him same day: ${PARTNER_URL}`,
    assistant:        `${n} — straight up: this is sam's assistant handling his DMs so nothing slips. tell me what you're here for — team, insurance, fitness, cars, mentorship, or a partnership — and i'll send you to the exact spot. partnerships go here: ${PARTNER_URL}`,
    route:            `${n} — what are you here for? team / insurance / fitness / cars / mentorship / partnership. one word and i'll send you straight to the right spot.`,
  };
  return replies[path];
}

// URGENT driving force for licensed producers: instant phone push + Discord so
// Sam can call and onboard them as fast as physically possible. Direct POSTs
// (not the bot_alerts flush cron) so delivery does not depend on a scheduler.
async function fireUrgentLicensedAlert(
  sb: ReturnType<typeof createClient>,
  handle: string | null,
  name: string | null,
  text: string,
  source: string,
  isTeam: boolean,
): Promise<void> {
  const who = [name, handle].filter(Boolean).join(" ") || "unknown sender";
  const kind = isTeam ? "LICENSED + TEAM" : "LICENSED";
  const callUrl = isTeam ? TEAM_CALL_URL : LICENSED_CALL_URL;
  const line = `${kind} lead just DMd (${source}): ${who}. Call to onboard NOW. "${text.slice(0, 140)}"`;
  // ntfy: Sam's phone. Title header is ASCII-safe (RFC-2047 not needed here).
  try {
    await fetch(NTFY_TOPIC, {
      method: "POST",
      headers: { "Title": `APEX ${kind} lead - call now`, "Priority": "5", "Tags": "rotating_light" },
      body: line,
    });
  } catch (e) { console.error("[manychat-webhook] ntfy urgent failed", e); }
  // NO Discord. Lead alerts go to Sam's phone only (ntfy) — never the team
  // members chat. Sam: "there's nothing to do with my team at all."
  // Durable audit row (delivered to ntfy above; this is the record, not a pager).
  // channels is ntfy-only so the alert-flush cron can never route it to Discord.
  try {
    await sb.from("bot_alerts").insert({
      source: "inbound_dm",
      event_type: "licensed_lead_dm",
      severity: "celebrate",
      subject: `${kind} lead - call now`,
      body: line,
      sms_body: line.slice(0, 160),
      action_link: callUrl,
      channels: ["ntfy"],
      sent_at: new Date().toISOString(),
    });
  } catch (e) { console.error("[manychat-webhook] bot_alerts insert failed", e); }
}

function firstText(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
  }
  return null;
}

function normalizePhone(value: string | null) {
  if (!value) return null;
  const digits = value.replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : value;
}

function buildName(body: Record<string, unknown>) {
  const subscriber = (body.subscriber ?? body.contact ?? body.user ?? {}) as Record<string, unknown>;
  const first = firstText(body.first_name, subscriber.first_name, subscriber.firstName);
  const last = firstText(body.last_name, subscriber.last_name, subscriber.lastName);
  return firstText(body.sender_name, body.name, subscriber.name, [first, last].filter(Boolean).join(" "));
}

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Shared-secret check. Fail closed if the secret is unset.
  const secret = Deno.env.get("MANYCHAT_WEBHOOK_SECRET");
  if (!secret) {
    return new Response(JSON.stringify({ error: "webhook_secret_unset" }), {
      status: 503,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const headerSecret = req.headers.get("x-manychat-secret") ?? "";
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch (_e) { body = {}; }
  const bodySecret = (body?.secret as string) ?? "";
  if (headerSecret !== secret && bodySecret !== secret) {
    return new Response(JSON.stringify({ error: "forbidden" }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Health probe for the always-on watchdog: authenticated no-op. Logs nothing,
  // replies to nobody, pages no one — just proves the brain is reachable and
  // parsing, so the watchdog can tell "alive" from "dark" without side effects.
  if (body?.health_check === true) {
    return new Response(JSON.stringify({ ok: true, health: "ok", ts: new Date().toISOString() }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const subscriber = (body.subscriber ?? body.contact ?? body.user ?? {}) as Record<string, unknown>;
  const rawSource = firstText(body.source, body.channel, body.platform, body.network, "instagram")!.toLowerCase();
  const source = rawSource.startsWith("manychat") ? rawSource : (rawSource === "instagram" ? "instagram" : `manychat_${rawSource}`);
  const subscriberId = firstText(
    body.subscriber_id, body.external_id, body.contact_id, body.user_id,
    subscriber.id, subscriber.subscriber_id,
  );
  const senderHandle = firstText(
    body.sender_handle, body.handle, body.username, body.phone,
    subscriber.username, subscriber.handle, subscriber.phone,
  );
  const senderName = buildName(body);
  const senderAvatar = firstText(body.sender_avatar, body.avatar, subscriber.avatar, subscriber.profile_pic);
  const email = firstText(body.email, subscriber.email);
  const phone = normalizePhone(firstText(body.phone, subscriber.phone));
  const state = firstText(body.state, body.us_state, subscriber.state);
  const text = ((body.body ?? body.message ?? body.text ?? "") as string).trim();

  if (!text) {
    return new Response(JSON.stringify({ ok: false, error: "empty body" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { intent, lead_score, reply_path, urgent } = classify(text);
  const auto_reply = reply_path ? replyFor(reply_path, rawSource, senderName?.split(" ")[0]) : null;
  const shouldTrackLead = intent !== "spam" && intent !== "not_interested" && lead_score >= 20;
  const sessionId = `${source}:${subscriberId ?? senderHandle ?? crypto.randomUUID()}`;
  let partialApplicationId: string | null = null;

  // URGENT licensed path — fire the call-now alert before anything else.
  if (urgent) {
    await fireUrgentLicensedAlert(supabase, senderHandle, senderName, text, source, intent === "licensed_team");
  }

  if (shouldTrackLead) {
    const nameParts = (senderName ?? "").trim().split(/\s+/).filter(Boolean);
    const firstName = firstText(body.first_name, subscriber.first_name, nameParts[0]);
    const lastName = firstText(body.last_name, subscriber.last_name, nameParts.slice(1).join(" "));
    const formData = {
      source, raw_source: rawSource, subscriber_id: subscriberId, sender_handle: senderHandle,
      first_message: text, intent, lead_score, recommended_reply: auto_reply,
      apply_url: reply_path === "fitness" ? FITNESS_URL : applyUrl(rawSource),
      reply_path,
    };
    const { data: existingPartial } = await supabase
      .from("partial_applications")
      .select("id")
      .eq("session_id", sessionId)
      .maybeSingle();

    if (existingPartial?.id) {
      partialApplicationId = existingPartial.id as string;
      await supabase.from("partial_applications")
        .update({
          email, phone, first_name: firstName, last_name: lastName, state,
          step_completed: 1, step: "inbound_dm",
          abandoned_at: new Date().toISOString(), form_data: formData,
          updated_at: new Date().toISOString(),
        })
        .eq("id", partialApplicationId);
    } else {
      const { data: partial } = await supabase.from("partial_applications")
        .insert({
          session_id: sessionId, email, phone, first_name: firstName, last_name: lastName, state,
          step_completed: 1, step: "inbound_dm",
          abandoned_at: new Date().toISOString(), form_data: formData,
          user_agent: "inbound-dm-brain",
        })
        .select("id")
        .maybeSingle();
      partialApplicationId = (partial?.id as string | undefined) ?? null;
    }
  }

  // Persist inbound + the outbound auto-reply so the full thread is in the inbox.
  const inbound = {
    source, external_id: subscriberId, sender_handle: senderHandle, sender_name: senderName,
    sender_avatar: senderAvatar, body: text, direction: "inbound", intent, lead_score,
    auto_replied: !!auto_reply,
    raw_payload: { ...body, partial_application_id: partialApplicationId, session_id: sessionId, reply_path },
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
      source, external_id: subscriberId, sender_handle: senderHandle, sender_name: senderName,
      body: auto_reply, direction: "outbound", intent, auto_replied: true,
      raw_payload: { in_reply_to: (inboundRow as { id?: string } | null)?.id, path: reply_path, partial_application_id: partialApplicationId },
    });
  }

  return new Response(JSON.stringify({
    ok: true, intent, lead_score, urgent, auto_reply, reply_path,
    message_id: (inboundRow as { id?: string } | null)?.id,
    partial_application_id: partialApplicationId,
    lead_source: source,
    apply_url: reply_path === "fitness" ? FITNESS_URL : applyUrl(rawSource),
  }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
