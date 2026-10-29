// Every string on the Instagram desk. Screen words are plain sentence case, like the rest of the app
// (OVERHAUL-instagram, 2026-10-28): the old desk spoke in lowercase fragments ("do", "tag it",
// "of prev 238%") that read as notes to self. The words that leave the building are different: the
// canned replies, the text-message bodies and the email are sent AS Sam, so they stay in his
// register, lowercase and short. Handles, names as written and proper nouns keep their case.
import type { IgLeverKey } from "./igTypes";

/** A title in curly quotes, unless it already carries quotes of its own ("Comment “apex” to learn"). */
export function quoted(title: string): string {
  return /[“”"]/.test(title) ? title : `“${title}”`;
}

export const HEADER = {
  title: "Instagram",
  eyebrow: "Grow",
  subtitle: "Who needs you, and what to do next.",
  openInbox: "Open Instagram",
  checking: "Checking…",
  checked: (ago: string) => `Checked ${ago}`,
  refreshNow: "Check for new messages now",
  botOn: "Bot is answering",
  botDown: "Bot is down",
  botUnknown: "Bot not checked this hour",
  linksBlocked: "Links blocked",
};

export const TABS = { do: "Needs you", people: "People", numbers: "Numbers" } as const;

export const SCORE = {
  label: "Instagram numbers",
  needs: "Needs you",
  needsHint: "to answer or call now",
  number: "Gave a number",
  booked: "Booked a call",
  applied: "Applied",
  inWindow: "in 30 days",
  /** After the hint, against the 30 days before: "in 30 days · up from 2". */
  trend: { up: (n: string) => `up from ${n}`, down: (n: string) => `down from ${n}`, same: "same as before" },
  definitionNeeds: "Business conversations waiting on you: a number to call, a booked call, or a reply. Tap to see them.",
  definitionNumber: "People who wrote in during the last 30 days and gave a phone number in a DM or on an application.",
  definitionBooked: "Calls booked on Calendly from Instagram in the last 30 days.",
  definitionApplied: "Applications in the last 30 days from your Instagram link or a matching handle.",
  failed: "The desk did not load, so the numbers are hidden rather than shown as 0.",
};

export const SECTION = {
  upNext: "Up next",
  alsoWaiting: (n: number) => `Also waiting · ${n}`,
  chatting: (n: number) => `Just chatting · ${n}`,
  chattingHint: "Props, hellos and small talk from the last 7 days. The bot keeps these friendly.",
  later: (n: number) => `Snoozed · ${n}`,
  laterHint: "They come back on their own at the time you picked.",
  leak: "Biggest leak",
  funnel: "Last 30 days",
  funnelHint: "From a message to a hire. Tap a step to see the people in it.",
  whatsWorking: "What's working",
  reels: "Posts that bring people in",
  lines: "Bot lines that get answers",
  whoComes: "What people want",
  health: "Is it working?",
  followupsSent: "Follow-ups in the last 48 hours",
  recovery: "Unfinished applications we emailed",
};

export const BUTTON = {
  text: "Text",
  send: "Reply",
  nudge: "Follow up",
  openIg: "Open in Instagram",
  showed: "Showed",
  noShow: "No-show",
  done: "Done",
  more: "More",
  bringBack: "Bring back",
  showMore: (n: number) => `Show ${n} more`,
  seeChatting: (n: number) => `See who's chatting (${n})`,
  tryAgain: "Try again",
  reconnect: "Reconnect",
  howToFix: "How to fix",
  seeThem: "See them",
  seeWhy: "See why",
  call: (display: string) => `Call ${display}`,
  callShort: "Call",
  openIgShort: "Open IG",
  history: "Whole conversation",
};

export const MENU = {
  openIg: "Open in Instagram",
  history: "Whole conversation",
  done: "Done",
  later: "Later",
  in4h: "In 4 hours",
  tomorrow9: "Tomorrow 9am",
  notALead: "Not a lead",
  itsMine: "It's mine (bot off)",
  emailTheLink: "Email the link",
  thatsALead: "That's a lead",
  wantsIn: "Wants in",
  licensed: "Licensed",
};

/** The pill on each row: the state in words. */
export const PILL = {
  call: "Call them",
  booked: "Call booked",
  didTheyShow: "Did they show?",
  closing: "Window closing",
  reply: "Reply",
  tagIt: "Follow up",
  closed: "Window closed",
  casual: "Just chatting",
  open: "Waiting on them",
  snoozed: "Snoozed",
  handled: "Done",
  showed: "Showed",
  noShow: "No-show",
  applied: "Applied",
  hired: "Hired",
};

/** What a person wants, from the thread's intent. Small talk gets no chip: the pill says it. */
export const INTENT_WORD: Record<string, string> = {
  opportunity: "Wants in",
  licensed: "Licensed",
  licensed_team: "Licensed, with a team",
  mentorship: "Mentorship",
  fitness: "Fitness",
  rentals: "Car rentals",
  partnership: "Partnership",
  followup: "Following up",
  winback: "Wants back in",
  not_interested: "Not interested",
  spam: "Spam",
  troll: "Spam",
};

export const FACT = {
  gaveNumber: "Gave a number",
  gaveEmail: "Gave an email",
  applied: "Applied",
  appliedStatus: (status: string) => `Applied · ${status}`,
  lockedInGap: "Told “locked in”, nothing booked",
  bookedBefore: "Booked before",
  yourThread: "Your thread · bot off",
  hired: "Hired",
};

export const CAME_FROM = {
  comment: (title: string) => `Commented on “${title}”`,
  commentNoTitle: "Commented on a post",
  story: "Replied to your story",
  dm: "Sent you a DM",
  // timeago-allow: the age comes from shortAge (igFormat.ts), which clamps the delta at 0
  firstWrote: (ago: string) => `first wrote ${ago} ago`,
  messages: (n: number) => `${n} messages`,
};

export const SAID = {
  them: "They said",
  noWords: "They haven't written yet",
};

export const DID = {
  botReplied: "Bot said",
  youReplied: "You said",
  botTried: "Bot tried",
  youTried: "You tried",
  weReplied: "We said",
  nobody: "Nobody has answered yet",
  delivered: "delivered",
  handed: "no receipt",
  noReceipt: "no receipt",
  queued: "held, not sent yet",
  refused: (why: string) => `not delivered: ${why}`,
  refusedNoWhy: "not delivered",
  desk: {
    handled: "You marked it done",
    unhandled: "You brought it back",
    snoozed: (t: string) => (t ? `You snoozed it till ${t}` : "You snoozed it"),
    unsnoozed: "You brought it back",
    dismissed: "You marked it not a lead",
    relabeled: "You moved it up to a lead",
    mine: "You took the thread (bot off for 14 days)",
    emailed: "You emailed the link",
    sam_sent: "You sent a DM from here",
    tag_refused: "Meta refused the follow-up",
    called: "You called",
    followup_sent: "Follow-up sent",
  } as Record<string, string | ((t: string) => string)>,
};

export const REFUSAL_WORD: Record<string, string> = {
  window_closed: "window closed",
  link_blocked: "link blocked",
  token_dead: "token dead",
  tag_not_permitted: "follow-up tag not allowed",
};

export const NEXT = {
  call: (phone: string) => `Call ${phone}.`,
  callNoPhone: "Call them.",
  whyLockedIn: "They were told “locked in” and nothing is booked.",
  whyPassed: "They booked before and nothing is on the calendar now.",
  whyLicensed: "They say they're licensed.",
  whyNumber: "They gave you their number.",
  booked: (when: string) => `Call at ${when} AZ. It's booked.`,
  didTheyShow: "Their call time passed. Mark showed or no-show.",
  closing: (t: string) => (t ? `Reply before ${t}. Instagram closes the window then.` : "Reply now. The window is about to close."),
  reply: "Reply while the window is open.",
  tagIt: "Send a follow-up. The 24-hour window closed.",
  closedPhone: "Text them, or answer in the Instagram app.",
  closed: "Answer in the Instagram app. The 24-hour window closed.",
  casual: "Nothing to do unless you want to chat.",
  open: "Wait for their reply.",
  snoozed: (t: string) => (t ? `Comes back at ${t}.` : "Comes back on its own."),
  handled: "Done. It comes back if they write again.",
  showed: "The call went ahead.",
  noShow: "They didn't show. Text them to rebook.",
  bookedNoOutcome: "Call booked. Mark the outcome after.",
  appliedPhone: "Call them about their application.",
  applied: "Message them about their application.",
};

export const META = {
  az: (dayTime: string) => `${dayTime} AZ`,
  someone: "Someone on Instagram",
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
  sendAsYou: "Reply as you",
  to: (handle: string) => `To ${handle}`,
  windowOpen: (closes: string) => (closes ? `Window open · closes ${closes}` : "Window open"),
  windowClosedTag: "Window closed · trying the 7-day follow-up tag",
  linksBlocked: "Links are blocked right now. This goes out without the link.",
  linksRefused: "Links are blocked right now. Take the link out.",
  words: (n: number) => `${n} of 14 words`,
  longForYou: "Long for you. Short replies get answered more.",
  placeholder: "Say it like you'd say it",
  quick: "Quick replies",
  message: "Your message",
  sending: "Sending…",
};

export const SEND_RESULT = {
  delivered: "Sent · delivered",
  deliveredNoLink: "Sent · delivered · no link, links are blocked right now",
  noLink: "Sent · no link, links are blocked right now",
  noReceipt: "Sent · no receipt",
  windowClosed: "Meta said no · window closed. Text them or open Instagram",
  linkBlocked: "Meta said no · link blocked",
  tokenDead: "The token is dead. Reconnect",
  tagNotPermitted: "Meta said no · open Instagram",
};

export const EMAIL = {
  subject: "the link from sam",
  body: (first: string, url: string) => `yo ${first}, it's sam from ig.\n\nhere's the link: ${url}\n\nreply here if anything's unclear.\n\nsam`,
  confirm: (to: string) => `Send the apply link to ${to}?`,
  from: "Sam James <alerts@apex-financial.org>",
  replyTo: "info@kingofsales.net",
  tag: "ig-command-center",
  applyUrl: (handle: string | null) =>
    `https://apex-financial.org/apply?utm_source=instagram&utm_medium=dm&utm_campaign=command_center${handle ? `&ig=${encodeURIComponent(handle)}` : ""}`,
  licensedUrl: "https://calendly.com/apexfinancialempire/licensed-prospect-call-clone",
};

export const CONFIRM = {
  noShow: (who: string) => `Mark ${who} as a no-show?`,
  keep: "Keep it",
  sendIt: "Send it",
  notNow: "Not now",
};

export const TOAST = {
  cleared: "Cleared",
  undo: "Undo",
  seeYouAt: (t: string) => `See you at ${t}`,
  markedShowed: "Marked showed",
  markedNoShow: "Marked no-show",
  notALead: "Got it, not a lead",
  yours: "Yours. The bot is out for 14 days",
  thatsALead: "Moved up. The bot follows the business path now",
  emailed: "Emailed. Resend has the receipt",
  suppressed: "Resend has them suppressed. Not sent.",
  didntSave: "Didn't save. Try again.",
  broughtBack: "Back on the list",
  smsBodyCopied: "Google Voice can't prefill. Here's the text:",
};

export const EMPTY = {
  nobodyWaiting: "Nobody is waiting on you",
  goPost: "Go post something. New business messages land here.",
  nothingBooked: "Nothing booked yet. Calls booked from Instagram land here.",
  noOneIn: "Nobody wrote in during the last 30 days.",
  couldntLoad: "The Instagram desk didn't load",
  couldntLoadHint: "Nothing is lost. Try again in a moment.",
  hiredNobody: "Nobody hired from Instagram yet. Booked calls are where that starts.",
  noReels: "No post stats in the last 30 days.",
  notEnoughSends: "Not enough bot replies yet. A line needs 4 sends to count.",
  nobodyHere: "Nobody here.",
  noMatch: (q: string) => `Nobody matches “${q}”.`,
  loading: "Loading…",
};

/** Funnel step names, in the order they happen. */
export const STAGE_NAME: Record<string, string> = {
  in: "Wrote in",
  business: "Talked business",
  licensed: "Said they're licensed",
  number: "Gave a number",
  booked: "Booked a call",
  showed: "Showed up",
  applied: "Applied",
  hired: "Hired",
  recovered: "Finished an application after our email",
};

export const SHEET = {
  stageTitle: (key: string, count: number) => `${STAGE_NAME[key] ?? key} · ${count.toLocaleString("en-US")}`,
  showing: (n: number, of: number) => `Showing the newest ${n.toLocaleString("en-US")} of ${of.toLocaleString("en-US")}`,
  byLink: "By your link",
  byHandle: "By a matching handle",
  historyTitle: (who: string) => who,
  historySubtitle: "The last 24 messages, newest first",
  bot: "Bot",
  you: "You",
  them: "Them",
  refused: (why: string) => `not delivered · ${why}`,
  handed: "no receipt",
  delivered: "delivered",
  noReceipt: "no receipt",
  leverTitle: "The biggest leak",
};

export const ALERT = {
  tokenDead: (checked: string) => `The Instagram token is dead (checked ${checked}). The bot can't reply.`,
  linksBlocked: (ago: string) => `Meta blocked links ${ago}. Replies go out without links.`,
  botSilent: (ago: string, waiting: number) => `The bot hasn't sent anything in ${ago}. ${waiting} ${waiting === 1 ? "person is" : "people are"} waiting.`,
  followupsDidntRun: (ago: string) => `Follow-ups didn't run (last run ${ago}).`,
  howToFixTitle: "How to get links back",
  howToFixHint: "Meta is holding back links in your DMs. Only Instagram can lift it, and it takes a review.",
  howToFixSteps: ["Open the Instagram app", "Go to Settings, then Account status", "Request a review"],
};

export const PEOPLE = {
  search: "Name, handle, number or words",
  searchLabel: "Search people",
  lists: "Lists",
  everyone: "Everyone",
  shown: (n: number, of: number) => (n === of ? `${of.toLocaleString("en-US")} ${of === 1 ? "person" : "people"}` : `${n.toLocaleString("en-US")} of ${of.toLocaleString("en-US")} people`),
  newestFirst: "newest first",
  capped: (n: number, of: number) => `The list holds the newest ${n.toLocaleString("en-US")} of ${of.toLocaleString("en-US")}.`,
};

export const NUMBERS = {
  upFrom: (n: string) => `Up from ${n}`,
  downFrom: (n: string) => `Down from ${n}`,
  same: "Same as before",
  trendNote: "Each “up from” or “down from” compares with the 30 days before these 30.",
  shareOfIn: (pct: string) => `${pct} of everyone who wrote in`,
  shareOfBooked: (pct: string) => `${pct} of booked calls`,
  byLinkByHandle: (a: number, b: number) => `${a} by your link · ${b} by a matching handle`,
  noShowNotMarked: (a: number, b: number) => `${a} no-show · ${b} not marked yet`,
  recoveredOf: (a: number, b: number) => `${a} of ${b} emailed came back`,
  selfReported: "Their word, not a checked license",
  lockedInGap: (g: number) => `${g} told “locked in” with nothing on the calendar`,
  reelRow: (peopleIn: number) => `${peopleIn} came in`,
  wantInPct: (wantIn: number, pct: string) => `${wantIn} want in · ${pct}`,
  views: (v: string) => `${v} views`,
  noCaption: "(no caption)",
  reelFooter: (ctaTitle: string, ctaWant: number, ctaIn: number, topTitle: string, topWant: number, topIn: number) =>
    `${quoted(ctaTitle)}: ${ctaWant} of ${ctaIn} want in. ${quoted(topTitle)}, your most viewed: ${topWant} of ${topIn}. The ask in the caption is the difference.`,
  answered: (r: number, s: number) => `${r} of ${s} answered`,
  linesFooter: (samPct: string, botPct: string) => `Your short replies with no link get answered ${samPct} of the time. The bot's long lines with a link, ${botPct}.`,
  health: {
    tokenAlive: (ago: string) => `Token alive, checked ${ago}`,
    tokenDead: (ago: string) => `Token dead since ${ago}`,
    tokenUnknown: "Token not checked this hour",
    linksAllowed: (ago: string) => `Links allowed, last proven ${ago}`,
    linksUnproven: (ago: string) => `Links allowed, not proven since Meta refused one ${ago}`,
    linksBlocked: (ago: string) => `Links blocked ${ago}`,
    botReplies: (handed: string, receipts: string) => `Bot replies in 30 days: ${handed} sent through ManyChat with no receipt, ${receipts} with a receipt`,
    yourReplies: (delivered: string, gotReply: string) => `Your replies in 30 days: ${delivered} delivered, ${gotReply} got an answer`,
    replied24h: (pct: string, n: string, of: string) => `Answered within 24 hours: ${pct} (${n} of ${of} who wrote in)`,
    engine: (ago: string, sent: string) => `Follow-up engine ran ${ago}, ${sent} sent in 30 days`,
    engineFailed: (ago: string, status: string) => `Follow-up engine: ${status}, ${ago}`,
    engineNote: "It only follows up on sends with a receipt, and ManyChat sends carry none.",
    commentRefused: (n: string) => `Comment replies: ${n} refused this week (old comments, settled on their own)`,
    nudgeLanded: "Landed",
    nudgeRefused: "Refused, window closed",
    nudgeReplied: "They answered",
    nudgeNoReceipt: "No receipt",
    recoveryFinished: "Finished the application",
    recoveryEmailed: "Emailed",
    ok: "Working",
    broken: "Broken",
    unknown: "Not sure",
  },
};
