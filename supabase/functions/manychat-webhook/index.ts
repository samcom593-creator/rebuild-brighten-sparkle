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
  /\b(i'?m licensed|im licensed|i am licensed|have my licen[cs]e|got my licen[cs]e|already licensed|licensed (now|already|tho|though|too)|just got (my )?licens\w*|got licensed|i got my licen[cs]e)\b/i,
  /\b((have|got|hold|holding|with) (a |my |the )?(life|life insurance|insurance) licen[cs]e|licensed (in|for|with) [a-z]|2-?15 licen|2-?14 licen)\b/i,
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
  /\b(need (callers|setters|appointment setters|va'?s|virtual assistants|closers|leads)|we (offer|provide|do) (callers|leads|appointment|lead gen|marketing|ads|editing|video editing)|my (agency|team) (does|provides|offers)|lead gen(eration)?|appointment setting|book(ing)? (calls|appointments) for you|work for you|i can help you (scale|grow|get)|(lmk|let me know) if you need)\b/i,
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
// OPPORTUNITY — explicit recruiting signals (STRONG) + earning questions (MONEY).
// STRONG alone gates the insurance-client lane, so "how much does a policy cost"
// stays a sale while "how much money can I make" is a recruit.
const RECRUIT_STRONG_PATTERNS = [
  /\b(join|your team|the team|recruit\w*|hiring|become an agent|be an agent|sell insurance|selling insurance|career|opportunity|how does this work|get started|work with you|apply|sign up|licens(e|ing) (course|exam|class)|get licensed)\b/i,
];
// INTEREST — a yes to the pitch. Short replies like these in Sam's DMs are
// overwhelmingly prospects answering his recruiting content or outreach.
const INTEREST_PATTERNS = [
  /\b(i'?m interested|im interested|interested in (this|that|joining|the opportunity)|tell me more|more info|send me (the )?(info|details|link)|i'?m down|im down|let'?s do it|sign me up|count me in|how do i start|where do i start|i want in|i wanna join|put me on|plug me|let me in|get me in|how do i get in|need something better|i need this|tryna (join|get in|work|make money|do this)|i'?m in|im in|lets work|let'?s work|run it|i want to (do|start) this|teach me (how|the game)|how can i (join|start|get started)|tap in|tap me in|lock me in|link me|hook me up|put me in)\b/i,
];
const INSURANCE_MENTION = /\b(life insurance|insurance|policy|policies|final expense|iul|term life|whole life|coverage)\b/i;
const MONEY_PATTERNS = [
  /\bhow much (do |did |can |you |u )?(you|u|he|sam) ?(make|earn|made|pull|bring|clear)\b/i,
  /(\bstarting %|\bwhat'?s the %|\d+\s*%|\b(comp|percentage|percent|munyun|bag|bread|racks|get money|get some money|make some money|lets get it|let'?s get it)\b)/i,
  /\b(make money|money can (i|you|we) make|how much (money )?(can|do|could|would) (i|you|we|someone) (make|earn)|earn(ing)?s?\b|income|get paid|commission)\b/i,
];

type ReplyPath = "license_explain" | "trust" | "why_us" | "licensed" | "licensed_team" | "fitness" | "apply" | "partnership" | "assistant" | "rentals" | "mentorship" | "route" | "license_q" | "license_yes" | "license_no" | "llm" | "props";

interface Classification {
  intent: string;
  lead_score: number;
  reply_path: ReplyPath | null; // null = logged, no reply (spam / not-interested)
  urgent: boolean;              // true = fire the instant call-now alert
}

// CTA KEYWORDS — a message that IS just the keyword Sam's content tells people to
// send ("DM me APEX"). One word, no sentence. 2026-09-27: the first real inbound
// was exactly "apex" and fell to casual/silent.
const CTA_KEYWORD = /^\s*[\p{Emoji}\s]*(apex|team|info|link|start|join|ready|yes|money|insurance|policy|license|licensed|fitness|mentor|mentorship|cars?|rental|partner|collab|interested)[\p{Emoji}\s!.?]*$/iu;
function ctaLane(t: string): Classification | null {
  const m = t.match(CTA_KEYWORD);
  if (!m) return null;
  const k = m[1].toLowerCase();
  if (k === "fitness")                          return { intent: "fitness", lead_score: 55, reply_path: "fitness", urgent: false };
  if (k === "mentor" || k === "mentorship")     return { intent: "mentorship", lead_score: 50, reply_path: "mentorship", urgent: false };
  if (k === "car" || k === "cars" || k === "rental") return { intent: "rentals", lead_score: 45, reply_path: "rentals", urgent: false };
  if (k === "partner" || k === "collab")        return { intent: "partnership", lead_score: 50, reply_path: "partnership", urgent: false };
  if (k === "licensed")                         return { intent: "licensed", lead_score: 95, reply_path: "licensed", urgent: true };
  return { intent: "opportunity", lead_score: 65, reply_path: "apply", urgent: false };   // apex/team/info/link/start/join/ready/yes/money/license/interested
}

function classify(body: string): Classification {
  const t = (body || "").trim();
  if (SPAM_PATTERNS.some((r) => r.test(t)))           return { intent: "spam", lead_score: 0, reply_path: null, urgent: false };
  const cta = ctaLane(t); if (cta) return cta;
  if (NOT_INTERESTED_PATTERNS.some((r) => r.test(t))) return { intent: "not_interested", lead_score: 0, reply_path: null, urgent: false };
  if (LICENSE_QUESTION_RE.test(t) && /licen/i.test(t)) return { intent: "opportunity", lead_score: 60, reply_path: "license_explain", urgent: false };
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
  // Sam 2026-09-27: NOBODY buys a policy through his DMs. "life insurance",
  // "policy", "insurance" in any form = wants to join the team. There is no
  // policy-buyer lane and no Policy Help Center link in this brain. Ever.
  if (RECRUIT_STRONG_PATTERNS.some((r) => r.test(t)) || MONEY_PATTERNS.some((r) => r.test(t)) || INSURANCE_MENTION.test(t)) {
    return { intent: "opportunity", lead_score: 60, reply_path: "apply", urgent: false };
  }
  // Someone saying YES to the pitch ("interested", "tell me more", "I'm down") —
  // that is a prospect replying to Sam's recruiting, push them through.
  if (INTEREST_PATTERNS.some((r) => r.test(t)))        return { intent: "opportunity", lead_score: 65, reply_path: "apply", urgent: false };
  // Sam 2026-09-27: casual / social / flirty DMs are NOT the bot's — no reply,
  // just logged, so people can still reach him like a person. Only clear intent
  // gets pushed through a funnel.
  return { intent: "casual", lead_score: 10, reply_path: null, urgent: false };
}

// Sam's voice (2026-09-27, his words): "people should almost think they're
// talking to me but you're pushing them towards the links" and "when the fuck
// do you think I would ever actually say 'routed by state' to somebody".
// First person, SHORT, "bet, here's the link". No em-dashes, no names.
// "assistant" appears in exactly two places he asked for: a brand deal, and
// someone asking point-blank if this is a bot.
function replyFor(path: ReplyPath, rawSource: string, _firstName?: string): string {
  const apply = applyUrl(rawSource);
  const replies: Record<ReplyPath, string> = {
    licensed:      `say less, let's hop on a call. what's your number?`,
    licensed_team: `say less, you got a team too? let's hop on a call. what's your number?`,
    license_q:     `you got your life insurance license already or nah`,
    license_yes:   `say less, let's hop on a call. what's your number?`,
    license_no:    `all good, no stress. start here and i'll get you licensed: ${apply}`,
    license_explain: `it's the license you need to sell life insurance bro. don't have it yet? no stress, i get you licensed. start here and i'll walk you through it: ${apply}`,
    trust:         `lol nah, it's my own site. no card, no payment, just your info so i can reach you. look me up anywhere, apex financial. ${apply}`,
    why_us:        `i train you myself, we run real leads, and you're on a team that's actually writing. easiest way to see it is a quick call, start here: ${apply}`,
    llm:           "",
    props:         "🔥",
    fitness:       `gotchu, everything's on here, plans and 1 on 1: ${FITNESS_URL}`,
    apply:         `bet, here's the link: ${apply}`,
    mentorship:    `mentorship's a soft launch right now. it's me working with you directly on sales and building your income, all on here, apply and i'll personally reach out: ${MENTORSHIP_URL}`,
    rentals:       `gotchu, all the cars are on here, drop your dates and i'll get you a quote: ${RENTALS_URL}`,
    partnership:   `yo this is sam's assistant, brand stuff goes through here so he sees it: ${PARTNER_URL}`,
    assistant:     `it's my assistant running the dms with me, i see everything. what you here for?`,
    route:         `what you here for bro?`,
  };
  return replies[path];
}

// ── Thread memory + license gate + call booking (2026-09-27) ────────────────
// Every inbound gets the thread's history from inbox_messages. From it we know
// whether the license question was asked/answered, which lane the thread is
// in, the last link sent, and how far the licensed call-booking flow got.
const LICENSE_QUESTION_RE = /\b(what('?s| is| does) (a |the |that |this |it |your |my )?(life insurance |life |insurance )?licen[cs]e|what('?s| is) (that|this|it|a licence|a license)|what (do|does|u|you|that|it) mean|wdym|meaning|explain|come again|how (do|can|would) (i|you|u) get (a |my |the )?(life insurance |life |insurance )?licen[cs]e|how (do|can) i get licensed|do (i|you|u) need (a |the )?(life insurance |life |insurance )?licen[cs]e|is (a |the )?licen[cs]e (required|needed)|license for what|what license|which license|what kind of license|never heard|no idea what|idk what)\b/i;
const LICENSE_EXPLAINED_RE = /license you need to sell life insurance/i;
const LICENSE_Q_RE = /(do you have|you got|got|have) your (life insurance )?licen[cs]e|you got it or nah/i;
const YES_PATTERNS = [
  /^\s*(yes|yeah|yep|yea|ya|yup|yessir|i do|i am|already|correct|affirmative|100)\b/i,
  /\b(yes i (do|am)|i'?m licensed|i am licensed|have my licen[cs]e|got my licen[cs]e|already licensed|licensed already|licensed (now|tho|though)|i have (it|one|mine|my licen[cs]e))\b/i,
];
const NO_PATTERNS = [
  /^\s*(no|nope|nah|not yet|negative)\b/i,
  /\b(no i (don'?t|dont)|i (don'?t|dont) have|haven'?t|havent|not licensed|no licen[cs]e|working on it|studying|in progress|taking the (test|exam)|need to get)\b/i,
];
const BUSINESS_INTENTS = new Set(["opportunity", "licensed", "licensed_team", "fitness", "mentorship", "rentals", "partnership", "assistant_ask", "followup"]);
const PHONE_RE = /(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/;
const ASK_PHONE_RE = /what'?s your number/i;
const ASK_TIME_RE = /when'?s good|what time/i;
const ASK_EMAIL_RE = /what'?s your email/i;
const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/;
const BOOKED_RE = /^locked in/i;

// Emoji-only ("🔥🔥", "💯") and props ("this is fire", "love your content"):
// Sam: "the default emoji response should be a fire emoji back".
const EMOJI_ONLY_RE = /^[\s\p{Extended_Pictographic}\p{Emoji_Modifier}️‍!.]+$/u;
const PROPS_RE = /\b(fire|goat|facts|love (this|that|your|the|it|ur)|keep (going|it up|grinding|pushing)|inspir\w*|motivat\w*|big w|w video|respect|salute|legend|beast|hard work|well said|preach|real talk|congrats|proud of you|you the man|you got it|dope|go(es)? hard|crazy work|insane|killing it|killin it|need(ed)? this|gem|appreciate (you|this|it)|thank you for (this|sharing)|god bless|amen|blessed|w rizz|too real|so true|spitting|spittin|talk your shit)\b/i;
function propsReply(text: string): string | null {
  const t = text.trim();
  if (!t) return null;
  if (EMOJI_ONLY_RE.test(t)) return "🔥";
  if (PROPS_RE.test(t) && !/\b(fine|sexy|cute|hot|handsome|beautiful|marry|date me|single)\b/i.test(t)) return "appreciate you 🔥";
  return null;
}

// Bare acknowledgements never get a reply — answering "ok" with a link is spam.
const ACK_WORDS = /^(ok|okay|k|kk|bet|cool|got it|gotcha|thanks|thank you|thank u|thx|ty|sounds good|alright|aight|word|say less|copy|will do|on it|appreciate it|appreciate you|love it|perfect|awesome|nice|great|ok thanks|okay thanks|ok thank you|ok bet|ok cool|bet bet|cool cool|yessir|lets go|let's go|bet thanks|ok bet thanks|hm+|mm+|ok so|so|oh ok|ohh|oh)$/i;
function isAck(text: string): boolean {
  const bare = text.replace(/[\p{Extended_Pictographic}\p{Emoji_Modifier}️‍!.,]/gu, " ").replace(/\s+/g, " ").trim().toLowerCase()
    .replace(/\s+(bro|man|sam|brother|g|fam|boss|king)$/i, "");
  return bare === "" || ACK_WORDS.test(bare);
}

type HistoryRow = { direction: string; body: string | null; intent: string | null; created_at: string };

function normalizeText(t: string): string {
  // iPhones type ’ and “ ”; every pattern here is written with ' and ".
  // "I’m licensed" fell through to a generic link twice before this existed.
  return t.replace(/[‘’‛′]/g, "'").replace(/[“”″]/g, '"');
}

async function fetchHistory(externalId: string | null, handle: string | null): Promise<HistoryRow[]> {
  // 24 rows ≈ 8 turns: send-instagram-dm logs its own outbound row next to the
  // brain's, so every reply occupies two rows.
  let q = supabase.from("inbox_messages").select("direction, body, intent, created_at").order("created_at", { ascending: false }).limit(24);
  if (externalId) q = q.eq("external_id", externalId);
  else if (handle) q = q.eq("sender_handle", handle);
  else return [];
  const { data } = await q;
  return ((data ?? []) as HistoryRow[]).reverse().map((h) => ({ ...h, body: h.body ? normalizeText(h.body) : h.body }));
}

function threadState(history: HistoryRow[]) {
  let licenseAsked = false;
  let licenseAnswer: "yes" | "no" | null = null;
  let threadIntent: string | null = null;
  let lastLink: string | null = null;
  let phone: string | null = null;
  let whenText: string | null = null;
  let askedPhone = false, askedTime = false, askedEmail = false, booked = false, explainedLast = false;
  let lastOutbound: string | null = null, prevOutbound: string | null = null;
  let email: string | null = null;
  for (const h of history) {
    const b = h.body ?? "";
    if (h.direction === "outbound") {
      if (b !== lastOutbound) { prevOutbound = lastOutbound; lastOutbound = b; }
      explainedLast = LICENSE_EXPLAINED_RE.test(b);
      if (LICENSE_Q_RE.test(b)) { licenseAsked = true; licenseAnswer = null; }
      if (LICENSE_EXPLAINED_RE.test(b)) { licenseAsked = true; licenseAnswer = "no"; }
      const m = b.match(/https?:\/\/\S+/); if (m) lastLink = m[0];
      if (ASK_PHONE_RE.test(b)) askedPhone = true;
      if (ASK_TIME_RE.test(b)) askedTime = true;
      if (ASK_EMAIL_RE.test(b)) askedEmail = true;
      if (BOOKED_RE.test(b)) booked = true;
    } else {
      if (licenseAsked && licenseAnswer === null) {
        if (YES_PATTERNS.some((r) => r.test(b))) licenseAnswer = "yes";
        else if (NO_PATTERNS.some((r) => r.test(b))) licenseAnswer = "no";
      }
      // "I'm licensed" volunteered at any point answers the gate, and overrides an earlier "no".
      if (h.intent === "licensed" || h.intent === "licensed_team" || LICENSED_PATTERNS.some((r) => r.test(b))) { licenseAsked = true; licenseAnswer = "yes"; }
      if (h.intent && BUSINESS_INTENTS.has(h.intent)) threadIntent = h.intent;
      if (licenseAnswer === "yes") {
        const pm = b.match(PHONE_RE); if (pm) { phone = pm[0]; if (booked) { booked = false; } }
        const em = b.match(EMAIL_RE); if (em) email = em[0];
        if (!LICENSED_PATTERNS.some((r) => r.test(b)) && parseWhen(b)) { whenText = b; if (booked && pm) booked = false; }
      }
    }
  }
  return { licenseAsked, licenseAnswer, threadIntent, lastLink, hasBusinessContext: !!threadIntent || licenseAsked, phone, whenText, askedPhone, askedTime, askedEmail, email, booked, explainedLast, lastOutbound, prevOutbound };
}

// ── "tomorrow at 3" -> an instant Sam can be paged about ────────────────────
type When = { label: string; startAt: Date | null; needTime: boolean };
const TZ_HINTS: Array<[RegExp, string, string]> = [
  [/\b(est|edt|eastern|new york|florida|georgia|miami|atlanta|nyc)\b/i, "America/New_York", "est"],
  [/\b(cst|cdt|central|texas|chicago|houston|dallas)\b/i, "America/Chicago", "cst"],
  [/\b(mst|mdt|mountain|denver|colorado|utah)\b/i, "America/Denver", "mst"],
  [/\b(pst|pdt|pacific|california|la|los angeles|vegas|seattle)\b/i, "America/Los_Angeles", "pst"],
];
function tzOffsetMinutes(d: Date, tz: string): number {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(d);
  const g = (t: string) => Number(p.find((x) => x.type === t)?.value ?? "0");
  const asUtc = Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second"));
  return Math.round((asUtc - d.getTime()) / 60000);
}
function zonedToUtc(y: number, mo: number, d: number, h: number, mi: number, tz: string): Date {
  const guess = Date.UTC(y, mo, d, h, mi);
  return new Date(guess - tzOffsetMinutes(new Date(guess), tz) * 60000);
}
function parseWhen(raw: string, now: Date = new Date()): When | null {
  const t = raw.toLowerCase().replace(/\./g, "");
  let tz = "America/Phoenix", tzLabel = "";
  for (const [re, zone, lbl] of TZ_HINTS) if (re.test(t)) { tz = zone; tzLabel = ` ${lbl}`; break; }
  const p = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23", weekday: "short" }).formatToParts(now);
  const g = (k: string) => p.find((x) => x.type === k)?.value ?? "";
  let y = Number(g("year")), mo = Number(g("month")) - 1, d = Number(g("day"));
  const nowHour = Number(g("hour"));
  const todayDow = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"].indexOf(g("weekday").toLowerCase().slice(0, 3));

  if (/^\s*now\W*$/.test(t) || /\b(right now|rn|asap|whenever|anytime|any time|now works|now'?s good|now is good|call me now|free now|i'?m free|im free)\b/.test(t)) {
    return { label: "in a few", startAt: new Date(now.getTime() + 15 * 60000), needTime: false };
  }
  let dayLabel: string | null = null;
  let addDays = 0;
  if (/\b(tomorrow|tmrw|tmr|tomorow)\b/.test(t)) { addDays = 1; dayLabel = "tomorrow"; }
  else if (/\b(today|tonight|this (afternoon|evening|morning)|later)\b/.test(t)) { addDays = 0; dayLabel = "today"; }
  else {
    const days = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
    for (let i = 0; i < 7; i++) {
      if (new RegExp(`\\b(${days[i]}|${days[i].slice(0, 3)})\\b`).test(t)) { addDays = (i - todayDow + 7) % 7; dayLabel = days[i]; break; }
    }
  }
  let h: number | null = null, mi = 0;
  // A phone number in the same message ("480 555 0199 tomorrow at 2") must not eat the time.
  const tOnly = t.replace(/(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g, " ");
  const tm = tOnly.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm|a m|p m)?\b/);
  if (tm) {
    h = Number(tm[1]); mi = Number(tm[2] ?? 0);
    const ap = (tm[3] ?? "").replace(" ", "");
    if (h >= 1 && h <= 12) {
      if (ap === "pm" && h !== 12) h += 12;
      else if (ap === "am" && h === 12) h = 0;
      else if (!ap) { if (h <= 7 || h === 12) { if (h !== 12) h += 12; } }   // "at 5" = 5pm, "at 9" = 9am
    }
    if (h > 23) h = null;
  }
  if (h === null) {
    if (/\bnoon\b/.test(t)) h = 12;
    else if (/\bmorning\b/.test(t)) h = 10;
    else if (/\bafternoon\b/.test(t)) h = 14;
    else if (/\b(evening|tonight)\b/.test(t)) h = 18;
    else if (/\bnight\b/.test(t)) h = 19;
    else if (/\bafter work\b/.test(t)) h = 17;
    else if (/\blunch\b/.test(t)) h = 12;
  }
  if (dayLabel === null && h === null) return null;
  if (h === null) return { label: dayLabel!, startAt: null, needTime: true };
  if (dayLabel === null) { dayLabel = h <= nowHour ? "tomorrow" : "today"; addDays = dayLabel === "tomorrow" ? 1 : 0; }
  let startAt = zonedToUtc(y, mo, d + addDays, h, mi, tz);
  if (startAt.getTime() < now.getTime() - 5 * 60000) {
    if (addDays === 0) { addDays = 1; dayLabel = "tomorrow"; startAt = zonedToUtc(y, mo, d + 1, h, mi, tz); }
    else return { label: dayLabel, startAt: null, needTime: true };
  }
  const hh = ((h + 11) % 12) + 1, ap = h >= 12 ? "pm" : "am";
  return { label: `${dayLabel} ${hh}${mi ? ":" + String(mi).padStart(2, "0") : ""}${ap}${tzLabel}`, startAt, needTime: false };
}

// Book the call where Sam's phone already watches: interview_events is what
// apex-calendly-alerter polls, so an IG booking pages him like a Calendly one.
async function bookCall(name: string | null, handle: string | null, phone: string, when: When, rawText: string, igsid: string | null): Promise<string | null> {
  if (!when.startAt) return null;
  try {
    const { data, error } = await supabase.from("interview_events").insert({
      source: "manual",                 // CHECK: calendly | manual | application | readymode
      event_type_name: "IG Licensed Call",
      call_track: "licensed",
      invitee_name: name ?? handle ?? igsid ?? "IG prospect",
      invitee_phone: phone,
      instagram_handle: handle,
      match_method: "instagram",        // CHECK: instagram | email | phone | manual | none | booking_backfill
      scheduled_at: when.startAt.toISOString(),
      ended_at: new Date(when.startAt.getTime() + 30 * 60000).toISOString(),
      prep_notes: `Licensed prospect from IG DMs. They said: "${rawText.slice(0, 200)}" (${when.label}). Sam calls them at ${phone}.`,
      raw_payload: { igsid, handle, when_label: when.label, when_text: rawText, booked_by: "manychat-webhook" },
    }).select("id").limit(1);
    if (error) { console.error("[manychat-webhook] bookCall failed", error.message); return null; }
    return (data?.[0] as { id?: string } | undefined)?.id ?? null;
  } catch (e) { console.error("[manychat-webhook] bookCall threw", e); return null; }
}

const CALENDLY_LICENSED_EVENT_TYPE = "https://api.calendly.com/event_types/8c2e9805-4638-44b9-bdce-1fe969ad47d8";   // licensed-prospect-call-clone, 15 min, outbound_call
type CalendlyBooking = { event_uri: string; start_at: Date; label: string; exact: boolean };
// Books the licensed call on Calendly so it lands on Sam's calendar with
// confirmations + reminders, and flows into interview_events through the
// Calendly webhook like any other booking. Picks the open slot closest to
// the time they asked for (within 90 min); null if none is open.
async function bookOnCalendly(name: string, email: string, phone: string, handle: string | null, when: When, tz: string): Promise<CalendlyBooking | null> {
  const key = Deno.env.get("CALENDLY_API_TOKEN");
  if (!key || !when.startAt) return null;
  const H = { "Authorization": `Bearer ${key}`, "Content-Type": "application/json", "User-Agent": "APEX-DM-Bot/1.0 (+https://apex-financial.org)" };
  try {
    const lo = new Date(Math.max(when.startAt.getTime() - 90 * 60000, Date.now() + 10 * 60000));
    const hi = new Date(when.startAt.getTime() + 90 * 60000);
    if (hi.getTime() <= lo.getTime()) return null;
    const av = await fetch(`https://api.calendly.com/event_type_available_times?event_type=${encodeURIComponent(CALENDLY_LICENSED_EVENT_TYPE)}&start_time=${lo.toISOString()}&end_time=${hi.toISOString()}`, { headers: H });
    const avj = await av.json().catch(() => ({}));
    const slots: string[] = ((avj?.collection ?? []) as Array<{ start_time: string }>).map((x) => x.start_time);
    if (!slots.length) { console.warn("[manychat-webhook] calendly: no open slot near", when.startAt.toISOString(), av.status, JSON.stringify(avj).slice(0, 200)); return null; }
    const target = when.startAt.getTime();
    const best = slots.reduce((a, b) => Math.abs(new Date(b).getTime() - target) < Math.abs(new Date(a).getTime() - target) ? b : a);
    const digits = phone.replace(/\D/g, "");
    const e164 = digits.length === 10 ? `+1${digits}` : digits.length === 11 && digits.startsWith("1") ? `+${digits}` : `+${digits}`;
    const r = await fetch("https://api.calendly.com/invitees", {
      method: "POST", headers: H,
      body: JSON.stringify({
        event_type: CALENDLY_LICENSED_EVENT_TYPE, start_time: best,
        invitee: { email, name, timezone: tz, text_reminder_number: e164 },
        location: { kind: "outbound_call", location: e164 },
        questions_and_answers: handle ? [{ question: "instagram", answer: handle, position: 0 }] : [],
        tracking: { utm_source: "instagram", utm_medium: "dm", utm_campaign: "licensed_dm", utm_content: null, utm_term: null, salesforce_uuid: null },
      }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { console.error("[manychat-webhook] calendly booking failed", r.status, JSON.stringify(j).slice(0, 300)); return null; }
    const startAt = new Date(best);
    const exact = Math.abs(startAt.getTime() - target) < 5 * 60000;
    const f = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", hour: "numeric", minute: "2-digit" }).format(startAt).toLowerCase();
    const sameDay = new Intl.DateTimeFormat("en-US", { timeZone: tz, day: "2-digit" }).format(startAt) === new Intl.DateTimeFormat("en-US", { timeZone: tz, day: "2-digit" }).format(new Date());
    return { event_uri: j?.resource?.event ?? "", start_at: startAt, label: exact ? when.label : `${sameDay ? "today" : f.split(" ")[0]} ${f.split(" ").slice(1).join(" ")}`, exact };
  } catch (e) { console.error("[manychat-webhook] calendly threw", e); return null; }
}
function tzOf(text: string): string {
  for (const [re, zone] of TZ_HINTS) if (re.test(text)) return zone;
  return "America/Phoenix";
}

async function emailSam(subject: string, text: string): Promise<void> {
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) { console.error("[manychat-webhook] RESEND_API_KEY unset"); return; }
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: "APEX Alerts <alerts@apex-financial.org>", to: ["sam.com593@gmail.com", "info@kingofsales.net"], subject, text }),
    });
    if (!r.ok) console.error("[manychat-webhook] emailSam failed", r.status, (await r.text()).slice(0, 200));
  } catch (e) { console.error("[manychat-webhook] emailSam threw", e); }
}

async function llmReply(history: HistoryRow[], text: string, st: ReturnType<typeof threadState>, rawSource: string): Promise<string | null> {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) return null;
  const system = [
    "You write Instagram DM replies AS Samuel James (@sell4daddy): managing partner of Apex Financial, a life-insurance agency that recruits, licenses and trains agents. He also offers fitness coaching, a mentorship program, and car rentals in Arizona.",
    "Nobody buys a policy through his DMs. Anyone who mentions life insurance, a policy, or insurance in any form wants to JOIN THE TEAM. Never offer a quote, never mention buying coverage.",
    "Style: first person as Sam, lowercase, SHORT (under 20 words), casual ('yeah bro', 'say less', 'bet'), no dashes, no hype. Push them to the link: 'it's all on the link'. Only if asked point-blank whether this is a bot: say his assistant runs the DMs with him.",
    "Never invent prices, commission numbers, dates, or guarantees. If you don't know, say you'll go over it on the call.",
    "When a link fits the question, include exactly one of these:",
    `- joining the team / getting licensed / applying: ${applyUrl(rawSource)}`,
    "- already licensed: ask for their number so Sam can call them",
    `- fitness coaching: ${FITNESS_URL}`,
    `- mentorship: ${MENTORSHIP_URL}`,
    `- car rentals in Arizona: ${RENTALS_URL}`,
    `- brand partnership or collaboration: ${PARTNER_URL}`,
    "For anyone interested in joining the team, the first thing to establish is whether they already hold a life insurance license. If that is still unknown, ask exactly: you got your life insurance license already or nah",
    `Thread context: intent ${st.threadIntent ?? "unknown"}; license ${st.licenseAnswer ?? (st.licenseAsked ? "asked, not answered yet" : "unknown")}; last link sent ${st.lastLink ?? "none"}.`,
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
      body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 120, system, messages: msgs }),
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
  public_reply?: string | null;   // comment channel only: posted under the comment
  alert_text?: string;            // what Sam's urgent page says (defaults to the inbound text)
  notify?: string | null;         // non-urgent phone ping title
  email?: { subject: string; body: string } | null;
  booking?: { calendly_event: string | null; start_at: string; label: string } | null;
};

type Lane = "opportunity" | "licensed" | "fitness" | "mentorship" | "rentals" | "partnership";
function laneFromText(t: string): Lane | null {
  if (/\b(mentor\w*|inner circle)\b/i.test(t)) return "mentorship";
  if (/\b(fitness|gym|workout|work out|meal plan|diet|coaching|abs?|physique)\b/i.test(t)) return "fitness";
  if (/\b(rent\w*|car|cars|mclaren|lambo|lamborghini|ferrari|porsche|urus|g[- ]?wagon|corvette)\b/i.test(t)) return "rentals";
  if (/\b(brand|partner\w*|collab\w*|sponsor\w*)\b/i.test(t)) return "partnership";
  if (/\b(team|join|apex|agent|licen[cs]e|insurance|comp|commission|recruit\w*|training|policy|policies)\b/i.test(t)) return "opportunity";
  return null;
}
function laneOf(st: ReturnType<typeof threadState>, text = ""): Lane {
  const said = laneFromText(text);
  if (said && !(said === "opportunity" && st.licenseAnswer === "yes")) return said;
  const l = st.lastLink ?? "";
  if (l.includes("/fitness")) return "fitness";
  if (l.includes("/mentorship")) return "mentorship";
  if (l.includes("/rentals")) return "rentals";
  if (st.licenseAnswer === "yes") return "licensed";
  if (l.includes("calendly.com")) return "licensed";
  if (l.includes("/apply")) return "opportunity";
  if (l.includes("/fitness")) return "fitness";
  if (l.includes("/mentorship")) return "mentorship";
  if (l.includes("/rentals")) return "rentals";
  if (l.includes("f-collab")) return "partnership";
  const i = st.threadIntent ?? "";
  if (i === "licensed_team") return "licensed";
  if (["licensed", "fitness", "mentorship", "rentals", "partnership"].includes(i)) return i as Lane;
  return "opportunity";
}
function laneLink(lane: Lane, rawSource: string): string {
  return { opportunity: applyUrl(rawSource), licensed: LICENSED_CALL_URL, fitness: FITNESS_URL, mentorship: MENTORSHIP_URL, rentals: RENTALS_URL, partnership: PARTNER_URL }[lane];
}

// Short answers for the follow-ups people actually send, every one pointing
// back at the link (or, for a licensed prospect, at the call).
function faqReply(text: string, st: ReturnType<typeof threadState>, rawSource: string, firstName?: string): string | null {
  const t = text.toLowerCase();
  const lane = laneOf(st, text);
  const link = laneFromText(text) ? laneLink(lane, rawSource) : (st.lastLink ?? laneLink(lane, rawSource));
  const apply = applyUrl(rawSource);
  const gateOpen = st.licenseAsked && st.licenseAnswer === null;
  const teamLine = st.licenseAnswer === "yes" ? (st.phone ? "" : " what's your number?") : (gateOpen ? " you got your license already or nah" : ` here's the link: ${apply}`);

  if (gateOpen && /\b(what (do you|do u|u) mean|what license|which license|what kind of license|what'?s a license|what is a license|huh|license for what)\b/.test(t)) {
    return replyFor("license_explain", rawSource, firstName);
  }
  if (/\b(scam\w*|legit|hack\w*|virus|phish\w*|pyramid|mlm|ponzi|is this real|for real|fake|sketchy|sus\b|trust (you|this)|safe\b)/i.test(t)) {
    return replyFor("trust", rawSource, firstName).replace(apply, lane === "opportunity" || lane === "licensed" ? apply : link);
  }
  if (/\b(what makes (you|your team|yall|y'all) different|why (should i|would i|you) (pick|choose|join|go with)|over other|better than|why (you|your team|apex)|what('?s| is) different)\b/i.test(t)) {
    return replyFor("why_us", rawSource, firstName);
  }
  if (/\b(tell me (more )?about (it|that|this|the|your)|what('?s| is) (it|the mentorship|your mentorship|the program|your program) (like|about)|more (info|details) (on|about)|how do i get like you|what do you teach|what('?s| is) (it|this) like)\b/i.test(t)) {
    if (lane === "mentorship") return `it's me working with you directly on sales, mindset and building your income. everything's on here, apply and i'll personally reach out: ${MENTORSHIP_URL}`;
    if (lane === "fitness") return `plans and 1 on 1 coaching, i build it around you. everything's on here: ${FITNESS_URL}`;
    if (lane === "rentals") return `exotics in arizona, quote based. dates and the car you want here: ${RENTALS_URL}`;
    if (lane === "opportunity" || lane === "licensed") return `you get licensed, i train you myself, we run leads and you write policies on commission. best way to see it is the call.${teamLine}`;
  }
  if (/\b(what('?s| is) (this|that|the link|it|that link|this link)|what am i looking at|what does (this|the link|it) do|whats this|wait what|what is this)\b/.test(t)) {
    const what: Record<Lane, string> = {
      opportunity: `that's the application bro, takes 2 min: ${link}`,
      licensed:    `that's my calendar bro. or just send your number and i'll call you`,
      fitness:     `that's my fitness page bro, it's all on there: ${link}`,
      mentorship:  `that's the mentorship app bro, everything's on there: ${link}`,
      rentals:     `that's the rental page bro, dates and car on there: ${link}`,
      partnership: `that's the partnership form, everything goes through there: ${link}`,
    };
    return what[lane];
  }
  if (/\b(make|earn|income|commission|comp|get paid|pay(s|ing)?|salary|percentage|percent)\b/.test(t) && (lane === "opportunity" || lane === "licensed")) {
    return `it's all on the link bro, commission and uncapped. i'll break it down on the call.${teamLine}`;
  }
  if (/\b(how much|cost|price|pricing|fee|expensive|cheap|afford|rate)\b/.test(t)) {
    const cost: Record<Lane, string> = {
      opportunity: `free to join bro, only cost is the licensing course.${teamLine}`,
      licensed:    `nothing bro you're licensed, we just get you contracted.${teamLine || " i'll go over it on the call"}`,
      fitness:     `$300 bro, it's all on the link: ${FITNESS_URL}`,
      mentorship:  `no set price yet bro, apply on the link: ${MENTORSHIP_URL}`,
      rentals:     `depends on the car bro, drop your dates on the link: ${RENTALS_URL}`,
      partnership: `depends on the scope, put it in the form: ${PARTNER_URL}`,
    };
    return cost[lane];
  }
  if (/^\s*when\W*$/.test(t) || /\b(when (is|will|does|are|he|sam|you|u)|how soon|call me when|when('?s| is) the call|what day)\b/.test(t)) {
    if (lane === "licensed" || st.licenseAnswer === "yes") return st.booked ? `we're locked in bro, i'll call you then` : st.phone ? `you tell me, today or tomorrow? give me a time and i'll call you` : `today bro. what's your number?`;
    return `once you apply bro: ${link}`;
  }
  if (/\b(course|class|study|material|recommend)\b/.test(t) && lane === "opportunity") {
    return `yep, the pre licensing course is part of it, i set you up with it when you start here: ${apply}`;
  }
  if (/\b(how long|how many (days|weeks|months)|how fast|how quick|time does it take)\b/.test(t) && lane === "opportunity") {
    return `1 to 2 weeks bro for most people.${teamLine}`;
  }
  if (/\b(experience|no background|never sold|beginner|new to this|qualifications|requirements|what do i need|do i need)\b/.test(t) && lane === "opportunity") {
    return `nah bro no experience needed, i train you.${teamLine}`;
  }
  if (/\b(remote|from home|work from home|part[- ]?time|full[- ]?time|hours|schedule|flexible|9[- ]?5)\b/.test(t) && lane === "opportunity") {
    return `yeah bro fully remote, you set your hours.${teamLine}`;
  }
  if (/\b(not good|no good|bad at|not confident|scared|nervous|can'?t sell|never sold|what if i fail|what if i'?m not|introvert|shy|don'?t know how)\b/.test(t) && (lane === "opportunity" || lane === "licensed")) {
    return `nobody is at first bro, that's what the training's for.${teamLine}`;
  }
  if (/\b(what (will|do|would) i get|what('?s| is) included|what do you offer|what comes with|what do i get)\b/.test(t)) {
    if (lane === "mentorship") return `it's all on the link bro, apply and i'll go over it: ${link}`;
    if (lane === "fitness") return `plans and 1 on 1 bro, all on the link: ${link}`;
    if (lane === "opportunity" || lane === "licensed") return `licensing, training and a team bro.${teamLine}`;
    return `it's all on the link bro: ${link}`;
  }
  if (/\b(where (are you|r u|you|is this|is it) (located|based|at)|what state|which state|what city|location)\b/.test(t)) {
    if (lane === "rentals") return `arizona bro, phoenix and scottsdale: ${RENTALS_URL}`;
    if (lane === "opportunity" || lane === "licensed") return `i'm in arizona but you can do it from anywhere bro, what state you in?${teamLine}`;
    return `all online bro: ${link}`;
  }
  if (/\b(what('?s| is) apex|what do you (guys )?do|what is (the )?(company|business|job|work)|what (kind of )?(work|job|business) is (it|this)|what is this about|what'?s this about)\b/.test(t)) {
    return `my life insurance agency bro. you tryna join?`;
  }
  if (/\b(how does (it|this) work|what('?s| is) the process|next steps?|what happens (next|after)|then what|what now)\b/.test(t)) {
    if (lane === "opportunity" || lane === "licensed") return `you apply, get licensed, i train you, you start writing.${teamLine}`;
    return faqReply("what is this", st, rawSource, firstName);
  }
  return null;
}

// "what's your snap" is a two-second answer. Sam 2026-09-28: "90% of my
// messages I want this to respond to... I can't waste my time even opening a
// message like that." Handles come from system_settings.social_* (no redeploy
// to change one), with the known ones as fallbacks.
const SOCIAL_DEFAULTS: Record<string, string> = { instagram: "@sell4daddy", tiktok: "@sellfordaddy", youtube: "https://youtube.com/@sell4daddy", website: "https://sell4daddy.com", email: "info@kingofsales.net" };
async function socialsReply(text: string): Promise<string | null> {
  const t = text.toLowerCase();
  const asks = /\b(your|ur|u|you|got a|have a|whats|what's|what is|add|follow|send me)\b/.test(t) || /\?/.test(t) || /^\s*(snap(chat)?|tik\s?tok|youtube|yt|insta(gram)?|ig|email|website)\W*$/.test(t);
  if (!asks) return null;
  const which =
    /\bsnap(chat)?\b/.test(t) ? "snapchat" :
    /\btik\s?tok\b/.test(t) ? "tiktok" :
    /\b(youtube|yt|your channel)\b/.test(t) ? "youtube" :
    /\b(instagram|insta|\big\b)/.test(t) ? "instagram" :
    /\be-?mail\b/.test(t) ? "email" :
    /\b(website|your site|link in bio|linktree|your page|landing page)\b/.test(t) ? "website" :
    /\b(your (phone )?number|your cell|your phone)\b/.test(t) ? "phone" : null;
  if (!which) return null;
  if (which === "phone") return `drop yours and i'll hit you`;
  const { data } = await supabase.from("system_settings").select("key,value").like("key", "social_%");
  const map: Record<string, string> = { ...SOCIAL_DEFAULTS };
  for (const r of (data ?? []) as Array<{ key: string; value: string }>) { const v = String(r.value ?? "").trim().replace(/^"|"$/g, ""); if (v) map[r.key.replace("social_", "")] = v; }
  if (which === "snapchat") return map.snapchat ? `snap's ${map.snapchat} 👻` : `i'm barely on snap bro, hit me on ig, i'm on there all day: ${map.instagram}`;
  if (which === "tiktok") return `tiktok's ${map.tiktok}`;
  if (which === "youtube") return `youtube's ${map.youtube}`;
  if (which === "instagram") return `ig's ${map.instagram}`;
  if (which === "email") return `${map.email}`;
  return `everything's on here: ${map.website}`;
}

async function decide(text: string, rawSource: string, firstName: string | undefined, externalId: string | null, handle: string | null, channel: string, senderName: string | null): Promise<Decision> {
  const base = classify(text);
  if (base.intent === "spam" || base.intent === "not_interested") return { ...base, auto_reply: null };
  if (!PHONE_RE.test(text) && !EMAIL_RE.test(text)) {
    const social = await socialsReply(text);
    if (social) return { ...base, intent: "socials", reply_path: "llm", urgent: false, auto_reply: social };
  }
  const history = await fetchHistory(externalId, handle);
  const st = threadState(history);
  const firstInbound = history.find((h) => h.direction === "inbound")?.body?.slice(0, 120);
  const who = [senderName, handle].filter(Boolean).join(" ") || externalId || "someone";
  const silent = (intent: string): Decision => ({ ...base, intent, reply_path: null, auto_reply: null });

  // 0a) They asked what the license is (or, with the gate open, asked anything
  //     that isn't yes/no): explain it and start the licensing path. Tyler's
  //     "what's that" once got the fitness link because the last link decided.
  const gateOpenNow = st.licenseAsked && st.licenseAnswer === null && !YES_PATTERNS.some((r) => r.test(text)) && !NO_PATTERNS.some((r) => r.test(text));
  if (base.reply_path === "license_explain" || (gateOpenNow && (LICENSE_QUESTION_RE.test(text) || /^\s*(what|wat|huh|hm+|\?+|que|como)\W*$/i.test(text) || (/\?\s*$/.test(text) && !base.reply_path)))) {
    return { intent: "opportunity", lead_score: 60, reply_path: "license_explain", urgent: false, auto_reply: replyFor("license_explain", rawSource, firstName) };
  }
  // 0) Emoji / props: 🔥 back (a public 🔥 under a comment, a DM everywhere else).
  const props = base.reply_path ? null : propsReply(text);
  if (props) {
    if (channel === "comment" || channel === "youtube_comment" || channel === "tiktok_comment") return { ...base, intent: "props", reply_path: null, auto_reply: null, public_reply: props };
    return { ...base, intent: "props", reply_path: "props", auto_reply: props };
  }

  // 1) Licensed, at any point: page + email Sam, then run the call-booking flow.
  const licensedNow = base.intent === "licensed" || base.intent === "licensed_team";
  const answeringYes = st.licenseAsked && st.licenseAnswer === null && YES_PATTERNS.some((r) => r.test(text));
  if (licensedNow || answeringYes || st.licenseAnswer === "yes") {
    const justLicensed = licensedNow || answeringYes || st.licenseAnswer !== "yes";
    const phoneNow = text.match(PHONE_RE)?.[0] ?? null;
    const phone = phoneNow ?? st.phone;
    const whenNow = licensedNow ? null : parseWhen(text);
    const when = whenNow ?? (st.whenText ? parseWhen(st.whenText) : null);
    const team = base.intent === "licensed_team" || st.threadIntent === "licensed_team";
    const stage = `first message: "${firstInbound ?? text}"`;

    const emailNow = text.match(EMAIL_RE)?.[0] ?? null;
    const email = emailNow ?? st.email;
    if (phone && when && !when.needTime && (phoneNow || whenNow || emailNow || !st.booked)) {
      // Number + time in hand. Email known -> real Calendly booking (calendar +
      // confirmations). Not asked yet -> ask once. Asked and they moved on -> book
      // internally so the call still exists and Sam still gets paged.
      if (!email && !st.askedEmail) {
        return { intent: "licensed", lead_score: 98, reply_path: "llm", urgent: false, auto_reply: `bet, what's your email? sending you the invite` };
      }
      const whenText = whenNow ? text : (st.whenText ?? text);
      const tz = tzOf(whenText);
      const cal = email ? await bookOnCalendly(senderName ?? handle ?? "IG prospect", email, phone, handle, when, tz) : null;
      const bookedId = cal ? null : await bookCall(senderName, handle, phone, when, whenText, externalId);
      const label = cal?.label ?? when.label;
      const line = `CALL BOOKED ${label} with ${who} at ${phone}${cal ? " (on Calendly" + (cal.exact ? "" : ", nearest open slot") + ")" : bookedId ? " (internal, no email given)" : " (booking row failed, call anyway)"}`;
      const reply = cal
        ? (cal.exact ? `locked in, ${label}. invite's in your email, i'll call you at ${phone} 🤝` : `closest i got is ${label}, locked you in. invite's in your email, i'll call you at ${phone} 🤝`)
        : `locked in, ${label}. i'll call you at ${phone} 🤝`;
      return { intent: team ? "licensed_team" : "licensed", lead_score: 99, reply_path: "llm", urgent: true,
        auto_reply: reply,
        alert_text: `${line}. ${stage}`,
        booking: { calendly_event: cal?.event_uri ?? null, start_at: (cal?.start_at ?? when.startAt!).toISOString(), label },
        email: { subject: `CALL BOOKED ${label}: ${who} (licensed IG lead)`, body: `${line}\n\nThey said: "${text}"\n${stage}\n${email ? "Their email: " + email + "\n" : ""}Instagram DMs: https://www.instagram.com/direct/inbox/` } };
    }
    if (phone && when?.needTime) {
      return { intent: "licensed", lead_score: 98, reply_path: "llm", urgent: false, auto_reply: `bet, what time ${when.label}?` };
    }
    if (phoneNow && !when) {
      return { intent: "licensed", lead_score: 98, reply_path: "llm", urgent: true, auto_reply: `bet. when's good, today or tomorrow? give me a time`,
        alert_text: `sent their number: ${phoneNow}. asking for a time. ${stage}`,
        email: { subject: `Licensed IG lead ${who} sent their number: ${phoneNow}`, body: `${who} sent ${phoneNow}. Bot is asking for a call time.\n${stage}\nInstagram DMs: https://www.instagram.com/direct/inbox/` } };
    }
    if (!phone && whenNow) {
      return { intent: "licensed", lead_score: 98, reply_path: "llm", urgent: false, auto_reply: `bet, what's your number?` };
    }
    if (justLicensed) {
      return { intent: team ? "licensed_team" : "licensed", lead_score: 95, reply_path: team ? "licensed_team" : "licensed", urgent: true,
        auto_reply: replyFor(team ? "licensed_team" : "licensed", rawSource, firstName),
        alert_text: `${text} ${stage}`,
        email: { subject: `LICENSED lead in IG DMs: ${who}`, body: `${who} said: "${text}"\n${stage}\nBot asked for their number. Call the second it lands.\nInstagram DMs: https://www.instagram.com/direct/inbox/` } };
    }
    // Licensed thread, something else said: a question gets its answer, an ack nothing,
    // otherwise keep the flow moving (number, then time). Aisha asked about
    // mentorship three times and got "when's good" three times before this.
    if (isAck(text)) return silent("ack");
    const otherLane = base.reply_path && base.reply_path !== "apply" && base.reply_path !== "licensed" && base.reply_path !== "licensed_team" ? base.reply_path : null;
    const nudge = st.booked ? "" : (!phone ? " but first, what's your number? i'll call you" : " but first, when's good for a quick call, today or tomorrow?");
    if (otherLane) return { intent: "licensed", lead_score: 95, reply_path: "llm", urgent: false, auto_reply: `${replyFor(otherLane, rawSource, firstName)}${nudge}` };
    const faq = faqReply(text, st, rawSource, firstName);
    if (faq) return { intent: "licensed", lead_score: 95, reply_path: "llm", urgent: false, auto_reply: faq };
    if (!phone) return { intent: "licensed", lead_score: 95, reply_path: "llm", urgent: false, auto_reply: `what's your number? i'll call you` };
    if (!st.booked) return { intent: "licensed", lead_score: 95, reply_path: "llm", urgent: false, auto_reply: `when's good for you? give me a time` };
    return silent("ack");
  }
  // 2) Answering the license question with a no.
  if (st.licenseAsked && (st.licenseAnswer === null || st.explainedLast) && !base.reply_path && NO_PATTERNS.some((r) => r.test(text))) {
    const asked = /\?|\b(course|class|how (do|can) i|what|where|recommend)\b/i.test(text) ? faqReply(text, { ...st, licenseAnswer: "no" }, rawSource, firstName) : null;
    return { intent: "opportunity", lead_score: 60, reply_path: "license_no", urgent: false, auto_reply: asked ?? replyFor("license_no", rawSource, firstName) };
  }
  // 2b) A phone number in a non-licensed business thread: confirm, ping Sam.
  if (st.hasBusinessContext && PHONE_RE.test(text) && !base.reply_path) {
    const num = text.match(PHONE_RE)![0];
    return { intent: st.threadIntent ?? "followup", lead_score: 70, reply_path: "llm", urgent: false, auto_reply: `bet, i'll hit you up`, notify: `Phone number from a ${laneOf(st)} prospect: ${num}` };
  }
  // 2c) "ok" / "thanks": never answered, never a link.
  if (!base.reply_path && isAck(text)) return silent(st.hasBusinessContext ? "ack" : "casual");
  // 3) Any team interest: the license question comes FIRST, before any link.
  if (base.intent === "opportunity" && !st.licenseAsked) {
    return { intent: "opportunity", lead_score: base.lead_score, reply_path: "license_q", urgent: false, auto_reply: replyFor("license_q", rawSource, firstName) };
  }
  // 4) A clear non-team lane: that lane's one-link reply.
  if (base.reply_path && base.reply_path !== "apply") {
    const notify = base.intent === "partnership" ? "Partnership inquiry in IG DMs" : null;
    return { ...base, auto_reply: replyFor(base.reply_path, rawSource, firstName), notify };
  }
  // 5) Team interest after the gate was asked: a real question gets its answer, otherwise the link / the gate again.
  if (base.reply_path === "apply") {
    const faq = faqReply(text, st, rawSource, firstName);
    if (faq) return { intent: "opportunity", lead_score: Math.max(60, base.lead_score), reply_path: "llm", urgent: false, auto_reply: faq };
    if (st.licenseAnswer === "no") return { ...base, auto_reply: replyFor("license_no", rawSource, firstName) };
    return { intent: "opportunity", lead_score: base.lead_score, reply_path: "license_q", urgent: false, auto_reply: replyFor("license_q", rawSource, firstName) };
  }
  // 6) Anything else in a thread with business context: FAQ, then the model, then never silence.
  if (st.hasBusinessContext) {
    const faq = faqReply(text, st, rawSource, firstName);
    if (faq) return { intent: st.threadIntent ?? base.intent, lead_score: Math.max(40, base.lead_score), reply_path: "llm", urgent: false, auto_reply: faq };
    const llm = await llmReply(history, text, st, rawSource);
    if (llm) return { intent: st.threadIntent ?? base.intent, lead_score: Math.max(40, base.lead_score), reply_path: "llm", urgent: false, auto_reply: llm };
    const fallback = st.lastLink ? `bro it's all on the link: ${st.lastLink}` : `what you here for bro?`;
    return { intent: st.threadIntent ?? "followup", lead_score: Math.max(40, base.lead_score), reply_path: "llm", urgent: false, auto_reply: fallback };
  }
  // 7) No business context. Sam 2026-09-27: "every single message within 24 hours
  //    I want responded to" — a greeting gets pointed somewhere; only flirting /
  //    comments on his looks stay his to answer.
  if (/\b(fine|sexy|cute|hot|handsome|beautiful|marry|date me|single|boyfriend|girlfriend|crush|bae|daddy|zaddy)\b|😍|🥵|😘|❤️|💕/i.test(text)) {
    return { ...base, intent: "flirty", reply_path: "props", auto_reply: "😂🙏" };
  }
  // Sam 2026-09-28: it should never "choose not to respond". Anything else casual gets pointed somewhere.
  return { ...base, intent: base.intent === "casual" ? "greeting" : base.intent, reply_path: "route", auto_reply: `yo what's good bro, what you here for?` };
}

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
  const source = rawSource.startsWith("manychat") ? rawSource : (/^(instagram|youtube|tiktok|snapchat)$/.test(rawSource) ? rawSource : `manychat_${rawSource}`);
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
  const text = normalizeText(((body.body ?? body.message ?? body.text ?? "") as string).trim());

  if (!text) {
    return new Response(JSON.stringify({ ok: false, error: "empty body" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const channel = firstText(body.channel) ?? "dm";
  const decision = await decide(text, rawSource, senderName?.split(" ")[0], subscriberId, senderHandle, channel, senderName);
  // Same words twice in a row reads like a machine. Once: "like i said". Twice: nothing.
  if (decision.auto_reply && decision.reply_path !== "props") {
    const hist = await fetchHistory(subscriberId, senderHandle);
    const outs = hist.filter((h) => h.direction === "outbound").map((h) => (h.body ?? "").trim());
    const last = outs[outs.length - 1] ?? null;
    const secondLast = [...outs].reverse().find((o) => o !== last) ?? null;
    if (last === decision.auto_reply.trim()) {
      decision.auto_reply = secondLast === `like i said, ${decision.auto_reply}` || outs.filter((o) => o === last).length >= 2 ? null : `like i said, ${decision.auto_reply}`;
    }
  }
  // Where it came from changes the opener, not the routing: a comment or a story
  // reply gets a DM that says why it's arriving. A 🔥 needs no opener.
  if (decision.auto_reply && (channel === "comment" || channel === "story") && decision.reply_path !== "props" && decision.intent !== "socials") {
    const seen = channel === "comment" ? "saw your comment." : "saw your story reply.";
    decision.auto_reply = `${seen} ${decision.auto_reply}`;
  }
  // Intent under a comment: the DM goes out privately and the comment gets a public pointer.
  if ((channel === "comment" || channel === "youtube_comment" || channel === "tiktok_comment") && decision.intent === "socials" && decision.auto_reply) { decision.public_reply = decision.auto_reply; decision.auto_reply = null; }
  if (channel === "comment" && decision.auto_reply && !decision.public_reply) decision.public_reply = "check your dms 📩";
  if (channel === "comment" && !decision.public_reply && decision.intent !== "spam") { decision.public_reply = "🔥"; decision.auto_reply = null; }
  if (channel === "story" && !decision.auto_reply && decision.intent !== "spam") { decision.auto_reply = "🔥"; decision.reply_path = "props"; }
  // YouTube has no DM API: anything with intent gets a public pointer to the one
  // place the conversation can continue; props get the 🔥; nothing else is posted.
  if (channel === "youtube_comment" || channel === "tiktok_comment") {
    // Public replies are visible to everyone, so the pointer only goes to a real
    // ask: team/mentorship intent, or a lane keyword WITH an ask in it. A joke
    // that happens to say "renting" gets nothing ("either renting or leasing that
    // hoe 😂" got the pointer on the first live pass).
    const ask = /\?|\b(how|put me on|link|info|dm|apex|join|team|mentor\w*|coach\w*|sign me up|i want|i need|tryna|let me|plug|tap in|price|cost|how much)\b/i.test(text);
    const hater = /\b(stupid|idiot|dumb|dumbass|clown|loser|broke|fake|cap\b|scam|fraud|lame|trash|bum|corny|nobody cares|shut up|weird|cringe)\b/i.test(text);
    const strongIntent = !hater && ["opportunity", "licensed", "licensed_team", "mentorship", "partnership"].includes(decision.intent);
    if (decision.auto_reply && !decision.public_reply && (strongIntent || (ask && !hater))) decision.public_reply = channel === "tiktok_comment" ? "dm me 'apex' and i'll get you going 📩" : "dm me 'apex' on ig @sell4daddy and i'll get you going 📩";
    // Sam 2026-09-28: "YouTube is just about engagement. If it's a comment you
    // don't know what to say to, give it a fire emoji." Nothing goes unanswered.
    if (!decision.public_reply && decision.intent !== "spam") decision.public_reply = "🔥";
    decision.auto_reply = null;
    decision.urgent = false; decision.email = null; decision.notify = null;
  }
  const { intent, lead_score, reply_path, urgent, auto_reply, alert_text, notify } = decision;
  if (decision.email) await emailSam(decision.email.subject, decision.email.body);
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
    ok: true, intent, lead_score, urgent, auto_reply, reply_path, public_reply: decision.public_reply ?? null, booking: decision.booking ?? null,
    message_id: (inboundRow as { id?: string } | null)?.id,
    partial_application_id: partialApplicationId,
    lead_source: source,
    apply_url: reply_path === "fitness" ? FITNESS_URL : applyUrl(rawSource),
  }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
