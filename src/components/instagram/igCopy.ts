// Every string on the IG desk, in Sam's register: lowercase, under 14 words, one question, no
// hype. Handles, names as written and proper nouns (Instagram, Meta, Calendly) keep their case.
import type { IgLeverKey, IgStatusWord } from "./igTypes";

export const STATUS_WORD: Record<IgStatusWord, string> = {
  call: "call",
  today: "today",
  closing: "closing",
  reply: "reply",
  tag_it: "tag it",
  closed: "closed",
  casual: "casual",
  open: "open",
  snoozed: "snoozed",
  handled: "handled",
  booked: "booked",
  applied: "applied",
};

export const SECTION = {
  needsYou: "needs you",
  everyoneElse: (n: number) => `everyone else (${n}) · casual, props, hi`,
  later: (n: number) => `later (${n})`,
  funnel: "the funnel · 30 days",
  tapANumber: "tap a number",
  whatsWorking: "what's working",
  reels: "reels",
  lines: "lines",
  whoComes: "who comes",
  health: "health",
  followupsSent: "follow-ups sent",
  receiptGraded: "receipt-graded · 30 days",
};

export const HEADER = {
  eyebrow: "instagram",
  openInbox: "open inbox",
  checking: "checking…",
  checked: (ago: string) => `checked ${ago}`,
  refreshNow: "refresh now",
};

export const TABS = { do: "do", numbers: "numbers", people: "people" } as const;

export const BUTTON = {
  text: "text",
  send: "send",
  nudge: "nudge",
  openIg: "open ig",
  showed: "showed",
  noShow: "no-show",
  done: "done",
  more: "more",
  bringBack: "bring back",
  nMore: (n: number) => `+${n} more`,
  seeEveryoneElse: "see everyone else",
  tryAgain: "try again",
  reconnect: "reconnect",
  howToFix: "how to fix",
  seeThem: "see them",
  seeWhy: "see why",
  call: (display: string) => `call ${display}`,
};

export const MENU = {
  openIg: "open ig",
  history: "history",
  done: "done",
  later: "later",
  in4h: "in 4h",
  tomorrow9: "tomorrow 9am",
  notALead: "not a lead",
  itsMine: "it's mine",
  emailTheLink: "email the link",
  thatsALead: "that's a lead",
  wantsIn: "wants in",
  licensed: "licensed",
};

export const META = {
  windowClosed: "window closed",
  yourThread: "your thread",
  closes: (t: string) => `closes ${t}`,
  wasAgo: (ago: string) => `was ${ago} ago · did they show?`,
  till: (t: string) => `till ${t}`,
  // timeago-allow: the age comes from shortAge (igFormat.ts), which clamps the delta at 0
  handledAgo: (ago: string) => `handled ${ago} ago`,
  snoozedTill: (t: string) => `snoozed till ${t}`,
  az: (dayTime: string) => `${dayTime} AZ`,
  youPrefix: "you: ",
  someone: "someone on ig",
};

export const CANNED: string[] = [
  "yoo you still down?",
  "what's good, you still want in?",
  "say the word and i'll call you",
  "you got your life insurance license?",
  "what's your number? i'll call you",
];

export const SMS = {
  call: "yo it's sam from ig, you still down for the call?",
  today: (when: string) => `yo it's sam, we still on for ${when}?`,
  numberNotBooked: "yo it's sam from ig. you still want in or nah?",
  lockedIn: "we still on? what time works",
};

/** The text prefill the lever sheet uses, by the lever the server picked. */
export function leverSmsBody(key: IgLeverKey): string | null {
  if (key === "locked_in_gap") return SMS.lockedIn;
  if (key === "number_booked") return SMS.numberNotBooked;
  return null;
}

export const COMPOSE = {
  sendAsYou: "send as you",
  to: (handle: string) => `to ${handle}`,
  windowOpen: (closes: string) => `window open · closes ${closes}`,
  windowClosedTag: "window closed · trying the 7-day tag",
  linksBlocked: "links are blocked rn. this goes out without the link.",
  linksRefused: "links are blocked rn. take the link out.",
  words: (n: number) => `${n}/14 words`,
  longForYou: "long for you",
  placeholder: "say it like you'd say it",
};

export const SEND_RESULT = {
  delivered: "sent · delivered",
  deliveredNoLink: "sent · delivered · no link, links are blocked rn",
  noLink: "sent · no link, links are blocked rn",
  noReceipt: "sent · no receipt",
  windowClosed: "meta said no · window closed. text him or open ig",
  linkBlocked: "meta said no · link blocked",
  tokenDead: "token's dead. reconnect",
  tagNotPermitted: "meta said no · open ig",
};

export const EMAIL = {
  subject: "the link from sam",
  body: (first: string, url: string) => `yo ${first}, it's sam from ig.\n\nhere's the link: ${url}\n\nreply here if anything's unclear.\n\nsam`,
  confirm: (to: string) => `send the apply link to ${to}?`,
  from: "Sam James <alerts@apex-financial.org>",
  replyTo: "info@kingofsales.net",
  tag: "ig-command-center",
  applyUrl: (handle: string | null) =>
    `https://apex-financial.org/apply?utm_source=instagram&utm_medium=dm&utm_campaign=command_center${handle ? `&ig=${encodeURIComponent(handle)}` : ""}`,
  licensedUrl: "https://calendly.com/apexfinancialempire/licensed-prospect-call-clone",
};

export const CONFIRM = {
  noShow: (who: string) => `mark no-show for ${who}?`,
};

export const TOAST = {
  cleared: "cleared",
  undo: "undo",
  seeYouAt: (t: string) => `see you at ${t}`,
  markedShowed: "marked showed",
  markedNoShow: "marked no-show",
  notALead: "got it, not a lead",
  yours: "yours. bot's out for 14 days",
  thatsALead: "moved up. the bot follows the business path now",
  emailed: "emailed · resend id on file",
  suppressed: "resend has them suppressed. not sent.",
  didntSave: "didn't save. try again.",
  broughtBack: "back on the list",
  smsBodyCopied: "google voice can't prefill. here's the text:",
};

export const EMPTY = {
  nobodyWaiting: "nobody's waiting on you.",
  goPost: "go post something.",
  nothingBooked: "nothing booked. the call list is where that changes.",
  noOneIn: "no one came in yet.",
  engineQuiet: "engine's quiet. nothing to nudge.",
  couldntLoad: "couldn't load. try again.",
  hiredNobody: "nobody yet. the booked list is where that changes.",
  noReels: "no reel stats in 30 days. post one.",
  notEnoughSends: "not enough sends yet. 4+ needed.",
  nobodyHere: "nobody here.",
};

const STAGE_TITLE: Record<string, string> = {
  in: "in", business: "business", licensed: "said licensed", number: "gave a number", booked: "booked", showed: "showed", applied: "applied", hired: "hired", recovered: "recovered",
};

export const SHEET = {
  stageTitle: (key: string, count: number) => `${STAGE_TITLE[key] ?? key} · ${count}`,
  reachedThis: "reached this, not the next one",
  showing: (n: number, of: number) => `showing ${n} of ${of}`,
  byLink: "by link",
  byHandle: "by handle",
  orEmail: (n: number) => `or email ${n}`,
  historyTitle: (who: string) => `${who} · history`,
  bot: "bot",
  you: "you",
  refused: (why: string) => `refused · ${why}`,
  handed: "handed to manychat",
  delivered: "delivered",
  noReceipt: "no receipt",
};

export const ALERT = {
  tokenDead: (ago: string) => `token dead since ${ago}. bot can't reply.`,
  linksBlocked: (ago: string) => `meta blocked links ${ago}. replies go out without links.`,
  botSilent: (ago: string, waiting: number) => `bot hasn't delivered in ${ago}. ${waiting} people waiting.`,
  followupsDidntRun: (ago: string) => `follow-ups didn't run (last ${ago}).`,
  howToFixSteps: ["instagram app", "settings > account status", "request a review"],
};

export const NUMBERS = {
  ofPrev: (pct: string) => `of prev ${pct}`,
  prior30d: (n: string) => `prior 30d: ${n}`,
  tooFew: "too few to compare",
  byLinkByHandle: (a: number, b: number) => `by link ${a} · by handle ${b}`,
  noShowNotMarked: (a: number, b: number) => `no-show ${a} · not marked ${b}`,
  recoveredOf: (a: number, b: number) => `recovered ${a} of ${b}`,
  selfReported: "says licensed (self-reported)",
  lockedInGap: (g: number) => `${g} told "locked in", nothing on the calendar`,
  reelRow: (peopleIn: number, wantIn: number, pct: string) => `${peopleIn} came in · ${wantIn} want in · ${pct}`,
  views: (v: string) => `${v} views`,
  noCaption: "(no caption)",
  reelFooter: (ctaTitle: string, ctaWant: number, ctaIn: number, topTitle: string, topWant: number, topIn: number) =>
    `"${ctaTitle}": ${ctaWant} of ${ctaIn} want in. "${topTitle}": ${topWant} of ${topIn}. the ask in the caption is the difference.`,
  linesFooter: (samPct: string, botPct: string) => `your short no-link replies get answered ${samPct}. the bot's long link lines ${botPct}.`,
  health: {
    tokenAlive: (ago: string) => `token: alive · checked ${ago}`,
    tokenDead: (ago: string) => `token: dead since ${ago}`,
    tokenUnknown: "token: unchecked this hour",
    linksAllowed: (ago: string) => `links: allowed, proven ${ago}`,
    linksUnproven: (ago: string) => `links: allowed, unproven since the refusal ${ago}`,
    linksBlocked: (ago: string) => `links: blocked ${ago}, unproven since`,
    botReplies: (handed: string, receipts: string) => `bot replies 30d: ${handed} handed to manychat · ${receipts} receipts`,
    yourReplies: (delivered: string, gotReply: string) => `your replies 30d: ${delivered} delivered · ${gotReply} got a reply`,
    replied24h: (pct: string, n: string, of: string) => `replied in 24h: ${pct} (${n} of ${of})`,
    engine: (ago: string, sent: string) => `follow-up engine: ran ${ago} · ${sent} sent in 30d`,
    engineFailed: (ago: string, status: string) => `follow-up engine: ${status} ${ago}`,
    engineNote: "engine can't see manychat replies (needs a receipt it never gets)",
    commentRefused: (n: string) => `comment replies: ${n} refused this week (stale comments, auto-settled)`,
    nudgeLanded: "landed",
    nudgeRefused: "refused · window closed",
    nudgeReplied: "replied",
    recoveryFinished: "finished the app",
    recoveryEmailed: "emailed",
  },
};
