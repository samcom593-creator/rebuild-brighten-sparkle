// brain-lanes.ts — the lanes Sam's 2026-10-28 directive added to the DM brain
// ("hire as many people as possible, bring back as many agents as possible,
// train as many agents as fast as possible, take the stress of responding to
// DMs off me"). Pure: no Deno, no Supabase, so brain-lanes.test.ts can grade
// them without booting manychat-webhook. index.ts owns the replies and the
// side effects; this file only answers "what is this message".
//
// Measured before writing (inbox_messages, 48h to 2026-10-28 04:00Z): the DMs
// the brain left unanswered were "How bro I'm 18 and I need help" (a recruit),
// "Hey brotha let me know when you can get jacks contract" (an agent asking Sam
// for contracting), "was wondering if u were looking for a virtual assistant"
// (a vendor pitch) and "Bro got ai" (someone noticing the bot). None of those
// matched a lane, so each fell to casual and to silence.

// Someone noticing the assistant. The existing ASSISTANT_ASK list has "are you a
// bot"; real DMs say "got ai", "this ai", "chatgpt". Disclose, never deny.
export const BOT_CHECK_RE =
  /\b(got ai|this (is )?ai|is this ai|it'?s ai|using ai|ai (bot|generated|reply|replies|answer|answers)|chat ?bot|chat ?gpt|u a bot|you'?re a bot|your a bot|a bot\b|bot\?|automated (reply|message|response)|robot)\b/i;

// A prospect who wants in but has no vocabulary for it yet ("i need help",
// "how do u this all"). Recruit lane, not casual.
export const NEED_HELP_RE =
  /\b(i need help|need help (with|getting|making)|help me (out|make|get)|how (do|did|does|can) (u|you|he|sam) (do|get|make) (all )?(this|that|it|dis)|how (u|you) (do|doing) (all )?(this|dis|that)|how do u this|put me on|how do i get (on|in|started)|how (do|did|does|can|are|is) (u|you|he|sam|y'?all) (make|making|get|getting|pull|pulling) (a lot of |so much |that much |all that |this much |your |the |that |yo )?(money|bread|bag|bank|cash|racks|a bag)|(what|how) (do|did) (u|you) do for (money|work|a living)|teach me how to make money)\b/i;

// A former agent asking to come back. "licensed" still wins when they say so
// (classify checks LICENSED first); this catches the ones who only say "come back".
export const WINBACK_RE =
  /\b((i )?(used to|use to) (be|work|sell|write) (on|with|for|at|in|under) (the team|your team|apex|galaxy|y'?all|you guys|you|sam)|was (on|with|under) (the|your|yo) team|(i )?left (the|your) team|(can i |could i |wanna |want to |tryna |let me )?(come|get) back (on|in|with)|rejoin|re-?join|back on the team|back with (you|y'?all|the team)|i was an agent|former agent|got my license back|my license (is )?back|reinstat\w*|reactivat\w*)\b/i;

// An agent on the team asking about contracting, carriers, pay, portal, training.
// Ownership words ("my contract") or a named colleague ("jack's contract") keep a
// recruit's "how much commission" out of this lane.
export const AGENT_SUPPORT_RE =
  /\b(my (contract|contracting|carrier|carriers|appointment|appointments|commission|commissions|payout|paycheck|check|license|npn|upline|portal|login|log in|account|training|onboarding|discord|writing number|agent (number|code)|release|deals?|policies|policy)|(jack|jr|kj|chudi|aisha|jack'?s|jr'?s|kj'?s) (contract|contracts|release|agents|downline|team)|get (my|me) (appointed|contracted|released|paid|set up)|where('?s| is) my (money|check|commission|commissions|pay|payout)|release (letter|form)|contracting (link|form|portal|packet)|appointed with|carrier (appointment|contracting|appointments)|(didn'?t|did not|not|haven'?t|havent) (get|got|been|getting) paid|wasn'?t paid|(my|the) (deal|policy|policies) (didn'?t|did not|not|isn'?t|aint|ain'?t) (show|count|post|go through)|writing number|npn number|agent portal|portal (login|password)|reset my password)\b/i;

// A pitch for services. The partnership lane already owns clippers and lead
// vendors; this adds assistants, setters and "grow your page" shops.
export const VENDOR_RE =
  /\b(virtual assistant|looking for (a|an) (va|virtual assistant|editor|setter|appointment setter|closer)|i'?m (a|an) (va|virtual assistant|video editor|editor|appointment setter|setter|closer|freelancer|ghostwriter)|(i|we) can (help|grow|manage|run|edit|book|scale) (you|your)|lead gen(eration)?|appointment setting services|grow your (page|account|ig|instagram|brand|business)|book (you|your) (calendar|calls)|do you need (a|an) (va|editor|setter|assistant)|offering (my|our) services|my services)\b/i;

export type BrainLane = "winback" | "agent_support" | "vendor" | "bot_check" | "need_help" | null;

/**
 * Which new lane a message belongs to, most specific first. null means none of
 * these: the caller falls through to the existing classifier. A message can match
 * several (e.g. "i used to be on the team, where's my check"): the first wins.
 */
export function brainLane(text: string): BrainLane {
  const t = (text || "").trim();
  if (!t) return null;
  if (WINBACK_RE.test(t)) return "winback";
  if (AGENT_SUPPORT_RE.test(t)) return "agent_support";
  if (VENDOR_RE.test(t)) return "vendor";
  if (BOT_CHECK_RE.test(t)) return "bot_check";
  if (NEED_HELP_RE.test(t)) return "need_help";
  return null;
}

/** The canned lines index.ts sends for the two lanes that are Sam's voice, not a link. */
export const LANE_REPLIES = {
  winback: "say less, let's get you back on. what's your number?",
  agent_support: "gotchu, let me check and get right back to you",
  casual_fallback: "gotchu 🙏 you here for the team or just saying wassup?",
  casual_close: "i'm around, hit me if you want in 🙏",
} as const;
