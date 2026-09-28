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
  /\b(is this (really |actually |even )?(sam|you|him)|is (it|this) really you|am i talking to (sam|a bot|a real person|him)|who (is this|am i talking to)|real person|are you a bot|is this a bot|is this automated|automated|auto[- ]?reply|talk to sam|speak to sam|sam himself|the real sam|your number|can i call)\b/i,
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

type ReplyPath = "licensed" | "licensed_team" | "fitness" | "apply" | "partnership" | "assistant" | "rentals" | "mentorship" | "insurance_client" | "route" | "license_q" | "license_yes" | "license_no" | "llm";

interface Classification {
  intent: string;
  lead_score: number;
  reply_path: ReplyPath | null; // null = logged, no reply (spam / not-interested)
  urgent: boolean;              // true = fire the instant call-now alert
}

// CTA KEYWORDS — a message that IS just the keyword Sam's content tells people to
// send ("DM me APEX"). One word, no sentence. 2026-09-27: the first real inbound
// was exactly "apex" and fell to casual/silent.
const CTA_KEYWORD = /^\s*[\p{Emoji}\s]*(apex|team|info|link|start|join|ready|yes|money|insurance|license|licensed|fitness|mentor|mentorship|cars?|rental|partner|collab|interested)[\p{Emoji}\s!.?]*$/iu;
function ctaLane(t: string): Classification | null {
  const m = t.match(CTA_KEYWORD);
  if (!m) return null;
  const k = m[1].toLowerCase();
  if (k === "fitness")                          return { intent: "fitness", lead_score: 55, reply_path: "fitness", urgent: false };
  if (k === "mentor" || k === "mentorship")     return { intent: "mentorship", lead_score: 50, reply_path: "mentorship", urgent: false };
  if (k === "car" || k === "cars" || k === "rental") return { intent: "rentals", lead_score: 45, reply_path: "rentals", urgent: false };
  if (k === "partner" || k === "collab")        return { intent: "partnership", lead_score: 50, reply_path: "partnership", urgent: false };
  if (k === "licensed")                         return { intent: "licensed", lead_score: 95, reply_path: "licensed", urgent: true };
  if (k === "insurance")                        return { intent: "insurance_client", lead_score: 80, reply_path: "insurance_client", urgent: false };
  return { intent: "opportunity", lead_score: 65, reply_path: "apply", urgent: false };   // apex/team/info/link/start/join/ready/yes/money/license/interested
}

function classify(body: string): Classification {
  const t = (body || "").trim();
  if (SPAM_PATTERNS.some((r) => r.test(t)))           return { intent: "spam", lead_score: 0, reply_path: null, urgent: false };
  const cta = ctaLane(t); if (cta) return cta;
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
    // Sam 2026-09-27: a licensed prospect is told Sam will CALL them (urgent alert fires).
    licensed:         `${n} — you're licensed, that changes everything. sam's going to call you personally — drop your best number and he'll hit you today. want to lock a time now instead? ${LICENSED_CALL_URL}`,
    licensed_team:    `${n} — licensed AND you've got a team? that's exactly who we build with. sam's going to call you personally — drop your best number. or lock a time now: ${TEAM_CALL_URL}`,
    license_q:        `${n} — quick one first: do you have your life insurance license? (yes / no)`,
    license_yes:      `${n} — you're licensed, that changes everything. sam's going to call you personally — drop your best number and he'll hit you today. want to lock a time now instead? ${LICENSED_CALL_URL}`,
    license_no:       `${n} — no problem, that's exactly what we help with. start here and we get you licensed and routed by state: ${apply}`,
    llm:              "",
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

// ── Thread memory + license gate + model fallback (2026-09-27) ──────────────
// Sam: "you're my executive DM assistant." The one-shot keyword router could not
// (1) ask about the license before sending a link, (2) answer a follow-up, or
// (3) say anything to a question it didn't pattern-match. Every inbound now gets
// the thread's history from inbox_messages, a license state derived from it, and
// a model-written answer for anything the lanes don't cover — silent only when
// the thread has no business context at all (casual / social stays Sam's).
const LICENSE_Q_MARK = "do you have your life insurance license";
const YES_PATTERNS = [
  /^\s*(yes|yeah|yep|yea|ya|yup|yessir|i do|i am|already|correct|affirmative|100)\b/i,
  /\b(yes i (do|am)|i'?m licensed|i am licensed|have my licen[cs]e|got my licen[cs]e|already licensed|licensed already|i have (it|one|mine|my licen[cs]e))\b/i,
];
const NO_PATTERNS = [
  /^\s*(no|nope|nah|not yet|negative)\b/i,
  /\b(no i (don'?t|dont)|i (don'?t|dont) have|haven'?t|havent|not licensed|no licen[cs]e|working on it|studying|in progress|taking the (test|exam)|need to get)\b/i,
];
const BUSINESS_INTENTS = new Set(["opportunity", "licensed", "licensed_team", "fitness", "mentorship", "rentals", "insurance_client", "partnership", "assistant_ask", "followup"]);

type HistoryRow = { direction: string; body: string | null; intent: string | null; created_at: string };

async function fetchHistory(externalId: string | null, handle: string | null): Promise<HistoryRow[]> {
  // 24 rows ≈ 8 turns: send-instagram-dm logs its own outbound row next to the
  // brain's, so every reply occupies two rows.
  let q = supabase.from("inbox_messages").select("direction, body, intent, created_at").order("created_at", { ascending: false }).limit(24);
  if (externalId) q = q.eq("external_id", externalId);
  else if (handle) q = q.eq("sender_handle", handle);
  else return [];
  const { data } = await q;
  return ((data ?? []) as HistoryRow[]).reverse();
}

function threadState(history: HistoryRow[]) {
  let licenseAsked = false;
  let licenseAnswer: "yes" | "no" | null = null;
  let threadIntent: string | null = null;
  let lastLink: string | null = null;
  for (const h of history) {
    const b = h.body ?? "";
    if (h.direction === "outbound") {
      if (b.toLowerCase().includes(LICENSE_Q_MARK)) { licenseAsked = true; licenseAnswer = null; }
      const m = b.match(/https?:\/\/\S+/); if (m) lastLink = m[0];
    } else {
      if (licenseAsked && licenseAnswer === null) {
        if (YES_PATTERNS.some((r) => r.test(b))) licenseAnswer = "yes";
        else if (NO_PATTERNS.some((r) => r.test(b))) licenseAnswer = "no";
      }
      // "I'm licensed" volunteered up front answers the gate without it being asked.
      if (h.intent === "licensed" || h.intent === "licensed_team") { licenseAsked = true; licenseAnswer = "yes"; }
      if (h.intent && BUSINESS_INTENTS.has(h.intent)) threadIntent = h.intent;
    }
  }
  return { licenseAsked, licenseAnswer, threadIntent, lastLink, hasBusinessContext: !!threadIntent || licenseAsked };
}

async function llmReply(history: HistoryRow[], text: string, st: ReturnType<typeof threadState>, rawSource: string): Promise<string | null> {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) return null;
  const system = [
    "You are the Instagram DM assistant for Samuel James (@sell4daddy): managing partner of Apex Financial, a life-insurance agency that recruits, licenses and trains agents. He also offers fitness coaching, a mentorship program, and car rentals in Arizona.",
    "You answer on his behalf inside Instagram DMs. Style: lowercase, direct, warm, one or two short sentences, no hype. If asked whether this is Sam or a bot, say you are Sam's assistant. Never claim to be Sam.",
    "Never invent prices, commission numbers, dates, or guarantees. If you don't know, say Sam will follow up personally.",
    "When a link fits the question, include exactly one of these:",
    `- joining the team / getting licensed / applying: ${applyUrl(rawSource)}`,
    `- already licensed: tell them Sam will call them personally and offer ${LICENSED_CALL_URL}`,
    `- fitness coaching: ${FITNESS_URL}`,
    `- mentorship: ${MENTORSHIP_URL}`,
    `- car rentals in Arizona: ${RENTALS_URL}`,
    `- wants a life-insurance policy for themselves or family: ${INSURANCE_URL}`,
    `- brand partnership or collaboration: ${PARTNER_URL}`,
    "For anyone interested in joining the team, the first thing to establish is whether they already hold a life insurance license. If that is still unknown, ask exactly: do you have your life insurance license?",
    "If they ask what a link is or what happens next, explain it plainly. Answer the actual question they asked.",
    `Thread context — intent: ${st.threadIntent ?? "unknown"}; license: ${st.licenseAnswer ?? (st.licenseAsked ? "asked, not answered yet" : "unknown")}; last link sent: ${st.lastLink ?? "none"}.`,
  ].join("\n");
  const msgs: { role: "user" | "assistant"; content: string }[] = [];
  for (const h of history) {
    const role: "user" | "assistant" = h.direction === "outbound" ? "assistant" : "user";
    const content = (h.body ?? "").trim();
    if (!content) continue;
    if (msgs.length && msgs[msgs.length - 1].role === role) msgs[msgs.length - 1].content += "\n" + content;
    else msgs.push({ role, content });
  }
  if (!msgs.length || msgs[msgs.length - 1].role === "assistant") msgs.push({ role: "user", content: text });
  else msgs[msgs.length - 1].content += "\n" + text;
  while (msgs.length && msgs[0].role !== "user") msgs.shift();
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 220, system, messages: msgs }),
    });
    const j = await r.json();
    const out = (j?.content?.[0]?.text as string | undefined)?.trim();
    if (!out) console.error("[manychat-webhook] llm no text", r.status, JSON.stringify(j).slice(0, 400));
    return out || null;
  } catch (e) {
    console.error("[manychat-webhook] llm failed", e);
    return null;
  }
}

type Decision = Classification & {
  auto_reply: string | null;
  alert_text?: string;      // what Sam's urgent page says (defaults to the inbound text)
  notify?: string | null;   // non-urgent phone ping title (policy lead, partnership, phone number)
};

// Bare acknowledgements never get a reply — answering "ok" with a link is spam.
// Emoji, punctuation and a trailing "bro/man/sam" are stripped before the test.
const ACK_WORDS = /^(ok|okay|k|kk|bet|cool|got it|gotcha|thanks|thank you|thank u|thx|ty|sounds good|alright|aight|word|say less|copy|will do|on it|appreciate it|appreciate you|love it|perfect|awesome|nice|great|ok thanks|okay thanks|ok thank you|ok bet|ok cool|bet bet|cool cool|yessir|lets go|let's go)$/i;
function isAck(text: string): boolean {
  const bare = text.replace(/[\p{Extended_Pictographic}\p{Emoji_Modifier}️‍!.,]/gu, " ").replace(/\s+/g, " ").trim().toLowerCase()
    .replace(/\s+(bro|man|sam|brother|g|fam|boss|king)$/i, "");
  return bare === "" || ACK_WORDS.test(bare);
}
const PHONE_RE = /(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/;

type Lane = "opportunity" | "licensed" | "fitness" | "mentorship" | "rentals" | "insurance_client" | "partnership";
function laneOf(st: ReturnType<typeof threadState>): Lane {
  const l = st.lastLink ?? "";
  if (l.includes("calendly.com")) return "licensed";
  if (l.includes("/apply")) return "opportunity";
  if (l.includes("/fitness")) return "fitness";
  if (l.includes("/mentorship")) return "mentorship";
  if (l.includes("/rentals")) return "rentals";
  if (l.includes("policy-help-center")) return "insurance_client";
  if (l.includes("f-collab")) return "partnership";
  const i = st.threadIntent ?? "";
  if (i === "licensed_team") return "licensed";
  if (["licensed", "fitness", "mentorship", "rentals", "insurance_client", "partnership"].includes(i)) return i as Lane;
  return "opportunity";
}
function laneLink(lane: Lane, rawSource: string): string {
  return {
    opportunity: applyUrl(rawSource), licensed: LICENSED_CALL_URL, fitness: FITNESS_URL, mentorship: MENTORSHIP_URL,
    rentals: RENTALS_URL, insurance_client: INSURANCE_URL, partnership: PARTNER_URL,
  }[lane];
}

// Deterministic answers for the follow-ups a prospect actually sends after the
// first reply. Runs before the model so the common cases never depend on it.
function faqReply(text: string, st: ReturnType<typeof threadState>, rawSource: string, firstName?: string): string | null {
  const n = (firstName?.trim() && firstName.split(" ")[0]) || "yo";
  const t = text.toLowerCase();
  const lane = laneOf(st);
  const link = st.lastLink ?? laneLink(lane, rawSource);
  const apply = applyUrl(rawSource);
  const gateOpen = st.licenseAsked && st.licenseAnswer === null;
  const gate = gateOpen ? " quick one first: do you have your life insurance license? (yes / no)" : "";
  const teamLine = st.licenseAnswer === "yes" ? ` lock a time with sam here: ${LICENSED_CALL_URL}` : (gateOpen ? gate : ` start here: ${apply}`);

  if (gateOpen && /\b(what (do you|do u|u) mean|what license|which license|what kind of license|what'?s a license|what is a license|huh|license for what)\b/.test(t)) {
    return `${n} — a life insurance license is what lets you legally sell policies (state exam, we walk you through it). do you have one yet? yes or no`;
  }
  if (/\b(what('?s| is) (this|that|the link|it|that link|this link)|what am i looking at|what does (this|the link|it) do|whats this|wait what|what is this)\b/.test(t)) {
    const what: Record<Lane, string> = {
      opportunity:      `${n} — that's the application to join apex. takes 2 minutes: name, state, whether you're licensed yet. from there we route you and get you on a call with sam. ${link}`,
      licensed:         `${n} — that's sam's calendar. lock a time and he calls you then — or just drop your number here and he'll call you today.`,
      fitness:          `${n} — that's sam's fitness page. plans + 1-on-1 coaching, pick what fits and it comes straight to him. ${link}`,
      mentorship:       `${n} — that's the mentorship application. it's a soft launch, so you apply first and sam reaches out personally if it's a fit. ${link}`,
      rentals:          `${n} — that's the rental request page. dates + the car you want, and you get a quote back. ${link}`,
      insurance_client: `${n} — that's the quote form. the basics on you and who you're covering, and sam follows up with real options. ${link}`,
      partnership:      `${n} — that's the partnership form. brand + collab stuff runs through there so sam actually sees it. ${link}`,
    };
    return what[lane];
  }
  if (/\b(make|earn|income|commission|get paid|pay(s|ing)?|salary)\b/.test(t) && (lane === "opportunity" || lane === "licensed")) {
    return `${n} — it's commission, uncapped, and it scales with how much you write. sam shows you the real numbers on the call.${teamLine}`;
  }
  if (/\b(how much|cost|price|pricing|fee|expensive|cheap|afford|rate)\b/.test(t)) {
    const cost: Record<Lane, string> = {
      opportunity:      `${n} — joining is free. the only cost is the state licensing course if you're not licensed yet, and sam breaks that down on the call.${teamLine}`,
      licensed:         `${n} — nothing to join — you're licensed, so it's contracting + getting you writing. sam covers comp on the call: ${LICENSED_CALL_URL}`,
      fitness:          `${n} — plans start at $300, 1-on-1 coaching is priced separately. it's all laid out here: ${FITNESS_URL}`,
      mentorship:       `${n} — no public price on mentorship right now, it's a soft launch. apply and sam goes over it with you personally: ${MENTORSHIP_URL}`,
      rentals:          `${n} — cars are quote-based, no flat price. drop your dates + the car and you get a number back: ${RENTALS_URL}`,
      insurance_client: `${n} — depends on age, health and how much coverage. drop the basics here and sam sends you real numbers: ${INSURANCE_URL}`,
      partnership:      `${n} — rates depend on the scope. put the details in the form and sam replies with numbers: ${PARTNER_URL}`,
    };
    return cost[lane];
  }
  if (/\b(when (is|will|does|are|he|sam|you)|what time|how soon|call me when|when('?s| is) the call)\b/.test(t)) {
    if (lane === "licensed" || st.licenseAnswer === "yes") return `${n} — same day, usually within a few hours. if you haven't dropped your number yet, send it here and he'll call you at that.`;
    return `${n} — sam follows up personally once your application's in. get it started here: ${link}`;
  }
  if (/\b(how long|how many (days|weeks|months)|how fast|how quick|time does it take)\b/.test(t) && lane === "opportunity") {
    return `${n} — most people finish the pre-licensing course in 1-2 weeks and test right after. we walk you through it step by step.${teamLine}`;
  }
  if (/\b(experience|no background|never sold|beginner|new to this|qualifications|requirements|what do i need|do i need)\b/.test(t) && lane === "opportunity") {
    return `${n} — zero experience needed. you get licensed, then we train you from the ground up.${teamLine}`;
  }
  if (/\b(remote|from home|work from home|part[- ]?time|full[- ]?time|hours|schedule|flexible|9[- ]?5)\b/.test(t) && lane === "opportunity") {
    return `${n} — fully remote, part-time or full-time, you set the hours.${teamLine}`;
  }
  if (/\b(where (are you|r u|you|is this|is it) (located|based|at)|what state|which state|what city|location)\b/.test(t)) {
    if (lane === "rentals") return `${n} — cars are in arizona (phoenix / scottsdale). dates + car here: ${RENTALS_URL}`;
    if (lane === "opportunity" || lane === "licensed") return `${n} — we're based in arizona and licensed in most states, so you can do this from anywhere. what state are you in?${teamLine}`;
    return `${n} — everything's online, location doesn't matter. ${link}`;
  }
  if (/\b(what('?s| is) apex|what do you (guys )?do|what is (the )?(company|business|job|work)|what (kind of )?(work|job|business) is (it|this)|what is this about|what'?s this about)\b/.test(t)) {
    return `${n} — apex financial is sam's life insurance agency. we bring people on, get them licensed, train them, and they earn commission writing policies. you looking to join, or looking for a policy?`;
  }
  if (/\b(how does (it|this) work|what('?s| is) the process|next steps?|what happens (next|after)|then what|what now)\b/.test(t)) {
    if (lane === "opportunity" || lane === "licensed") return `${n} — simple: you apply, we get you licensed (or fast-track you if you already are), then sam gets you on a call and you start writing with the team.${teamLine}`;
    return faqReply("what is this", st, rawSource, firstName);
  }
  return null;
}

async function decide(text: string, rawSource: string, firstName: string | undefined, externalId: string | null, handle: string | null): Promise<Decision> {
  const base = classify(text);
  if (base.intent === "spam" || base.intent === "not_interested") return { ...base, auto_reply: null };
  const history = await fetchHistory(externalId, handle);
  const st = threadState(history);
  const firstInbound = history.find((h) => h.direction === "inbound")?.body?.slice(0, 120);
  const n = (firstName?.trim() && firstName.split(" ")[0]) || "yo";

  // 1) Explicit "I'm licensed" anywhere -> licensed path (urgent alert, Sam will call).
  if (base.intent === "licensed" || base.intent === "licensed_team") {
    return { ...base, auto_reply: replyFor(base.reply_path as ReplyPath, rawSource, firstName) };
  }
  // 2) They are answering the license question.
  if (st.licenseAsked && st.licenseAnswer === null) {
    if (YES_PATTERNS.some((r) => r.test(text))) {
      return { intent: "licensed", lead_score: 95, reply_path: "license_yes", urgent: true, auto_reply: replyFor("license_yes", rawSource, firstName),
        alert_text: `said YES to "do you have your life insurance license?" (first message: "${firstInbound ?? text}")` };
    }
    if (NO_PATTERNS.some((r) => r.test(text))) return { intent: "opportunity", lead_score: 60, reply_path: "license_no", urgent: false, auto_reply: replyFor("license_no", rawSource, firstName) };
  }
  // 2b) A phone number inside a business thread: confirm, and put it in Sam's hand.
  if (st.hasBusinessContext && PHONE_RE.test(text) && !base.reply_path) {
    const num = text.match(PHONE_RE)![0];
    const licensedThread = st.licenseAnswer === "yes" || st.threadIntent === "licensed" || st.threadIntent === "licensed_team";
    return { intent: licensedThread ? "licensed" : (st.threadIntent ?? "followup"), lead_score: licensedThread ? 99 : 70, reply_path: "llm", urgent: licensedThread,
      auto_reply: `${n} — got it, sam will hit you at that number.`,
      alert_text: `sent their number: ${num} — call now. (first message: "${firstInbound ?? text}")`,
      notify: licensedThread ? null : `Phone number from a ${laneOf(st)} prospect: ${num}` };
  }
  // 2c) "ok" / "thanks" / an emoji: never answered, never a link.
  if (!base.reply_path && isAck(text)) return { ...base, intent: st.hasBusinessContext ? "ack" : "casual", auto_reply: null };
  // 3) Any team interest -> the license question comes FIRST, before any link.
  if (base.intent === "opportunity" && !st.licenseAsked) {
    return { intent: "opportunity", lead_score: base.lead_score, reply_path: "license_q", urgent: false, auto_reply: replyFor("license_q", rawSource, firstName) };
  }
  // 4) A clear non-team lane -> that lane's one-link reply (+ a phone ping where it's money).
  if (base.reply_path && base.reply_path !== "apply") {
    const notify = base.intent === "insurance_client" ? "Policy lead in IG DMs" : base.intent === "partnership" ? "Partnership inquiry in IG DMs" : null;
    return { ...base, auto_reply: replyFor(base.reply_path, rawSource, firstName), notify };
  }
  // 5) Team interest after the license question: a real question gets its
  //    answer (FAQ) before the link is repeated; otherwise route by the answer.
  if (base.reply_path === "apply") {
    const faq = st.licenseAnswer !== null ? faqReply(text, st, rawSource, firstName) : null;
    if (faq) return { intent: st.licenseAnswer === "yes" ? "licensed" : "opportunity", lead_score: Math.max(60, base.lead_score), reply_path: "llm", urgent: false, auto_reply: faq };
    if (st.licenseAnswer === "yes") return { intent: "licensed", lead_score: 95, reply_path: "license_yes", urgent: true, auto_reply: replyFor("license_yes", rawSource, firstName), alert_text: `${text} (already said they're licensed)` };
    if (st.licenseAnswer === "no")  return { ...base, auto_reply: replyFor("license_no", rawSource, firstName) };
  }
  // 6) Anything else in a thread that already has business context -> answer it:
  //    FAQ first (deterministic), then the model, then a no-silence fallback.
  if (st.hasBusinessContext || base.reply_path === "apply") {
    const faq = faqReply(text, st, rawSource, firstName);
    if (faq) return { intent: st.threadIntent ?? base.intent, lead_score: Math.max(40, base.lead_score), reply_path: "llm", urgent: false, auto_reply: faq };
    const llm = await llmReply(history, text, st, rawSource);
    if (llm) return { intent: st.threadIntent ?? base.intent, lead_score: Math.max(40, base.lead_score), reply_path: "llm", urgent: false, auto_reply: llm };
    if (base.reply_path === "apply") return { intent: "opportunity", lead_score: base.lead_score, reply_path: "license_q", urgent: false, auto_reply: replyFor("license_q", rawSource, firstName) };
    // Model unavailable: a real question in a live business thread still gets
    // an answer, never silence — Sam picks it up, the link stays in front of them.
    const fallback = st.lastLink
      ? `${n} — good question, sam will answer that one personally. everything you need to get started is here: ${st.lastLink}`
      : `${n} — good question, sam will answer that one personally. what are you here for — team, insurance, fitness, cars, mentorship or partnership?`;
    return { intent: st.threadIntent ?? "followup", lead_score: Math.max(40, base.lead_score), reply_path: "llm", urgent: false, auto_reply: fallback };
  }
  // 7) No business context at all: casual / social — Sam's, not the bot's.
  return { ...base, auto_reply: null };
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

  const { intent, lead_score, reply_path, urgent, auto_reply, alert_text, notify } = await decide(text, rawSource, senderName?.split(" ")[0], subscriberId, senderHandle);
  const shouldTrackLead = intent !== "spam" && intent !== "not_interested" && lead_score >= 20;
  const sessionId = `${source}:${subscriberId ?? senderHandle ?? crypto.randomUUID()}`;
  let partialApplicationId: string | null = null;

  // URGENT licensed path — fire the call-now alert before anything else.
  if (urgent) {
    await fireUrgentLicensedAlert(supabase, senderHandle, senderName, alert_text ?? text, source, intent === "licensed_team");
  }
  // High-value non-urgent moments (policy buyer, partnership, a phone number) — ping Sam's phone.
  if (notify) {
    try {
      await fetch(NTFY_TOPIC, {
        method: "POST",
        headers: { "Title": notify.replace(/[^\x20-\x7e]/g, ""), "Priority": "4", "Tags": "moneybag" },
        body: `${[senderName, senderHandle].filter(Boolean).join(" ") || "someone"}: "${text.slice(0, 140)}"`,
      });
    } catch (e) { console.error("[manychat-webhook] ntfy lane alert failed", e); }
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
