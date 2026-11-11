/**
 * Central configuration file for APEX Financial.
 * Single source of truth for all tunable thresholds.
 */

// ─── Follow-Up Timing ────────────────────────────────────────────────────────
export const FOLLOWUP_TIMING = {
  /** Minutes after lead creation before initial outreach is due */
  initialOutreachDelayMinutes: 10,
  /** Hours after last contact before a no-answer retry is suggested */
  noAnswerRetryHours: 24,
  /** Days between course check-in follow-ups */
  courseCheckInDays: 3,
  /** Days before test date to send reminder */
  testReminderLeadDays: 1,
  /** Hours before a lead is considered "needs contact" */
  needsContactHours: 48,
  /** Days with no activity before a lead is considered dormant */
  dormantDays: 14,
} as const;

// ─── Lead Scoring Weights ────────────────────────────────────────────────────
export const SCORING_WEIGHTS = {
  baseScore: 30,
  licensed: 25,
  testScheduled: 20,
  recentContact48h: 15,
  stalePenalty72h: -20,
  notesBonus: 10,
  newAndContacted7d: 15,
  referralBonus: 10,
} as const;

// ─── Score Thresholds ─────────────────────────────────────────────────────────
export const SCORE_THRESHOLDS = {
  low: 40,
  medium: 70,
} as const;

// ─── XP Rewards ───────────────────────────────────────────────────────────────
export const XP_REWARDS = {
  contact: 10,
  stage_update: 15,
  test_scheduled: 25,
  licensed: 100,
  note_added: 5,
} as const;

// ─── Rank Levels ──────────────────────────────────────────────────────────────
export const RANK_LEVELS = [
  { min: 0, label: "Rookie", color: "text-muted-foreground", emoji: "🌱" },
  { min: 100, label: "Rising Star", color: "text-blue-400", emoji: "⭐" },
  { min: 300, label: "Power Recruiter", color: "text-purple-400", emoji: "💜" },
  { min: 600, label: "Elite", color: "text-amber-400", emoji: "👑" },
  { min: 1000, label: "Legend", color: "text-rose-400", emoji: "🔥" },
] as const;

// ─── Stage / Column Definitions ───────────────────────────────────────────────
export const PROGRESS_COLUMNS = [
  {
    id: "needs_outreach",
    label: "Needs Outreach",
    emoji: "📣",
    values: ["unlicensed"],
    color: "border-rose-500/30 bg-rose-500/5",
    headerColor: "text-rose-400",
  },
  {
    id: "course",
    label: "In Course",
    emoji: "📚",
    values: ["course_purchased", "finished_course"],
    color: "border-blue-500/30 bg-blue-500/5",
    headerColor: "text-blue-400",
  },
  {
    id: "test_phase",
    label: "Test Phase",
    emoji: "✏️",
    values: ["test_scheduled", "passed_test"],
    color: "border-purple-500/30 bg-purple-500/5",
    headerColor: "text-purple-400",
  },
  {
    id: "final_steps",
    label: "Final Steps",
    emoji: "🏁",
    values: ["fingerprints_done", "waiting_on_license"],
    color: "border-amber-500/30 bg-amber-500/5",
    headerColor: "text-amber-400",
  },
  {
    id: "licensed",
    label: "Licensed! 🎉",
    emoji: "🏆",
    values: ["licensed"],
    color: "border-emerald-500/30 bg-emerald-500/5",
    headerColor: "text-emerald-400",
  },
] as const;

// ─── Scheduling Links ─────────────────────────────────────────────────────────
// One canonical owner for applicant scheduling. Personnel-specific placeholders
// are deliberately excluded so a departed team member cannot remain in routing.
// Sam, 2026-11-10 — one call per lifecycle stage:
//   unlicensed → get the course + upload the receipt → book the LICENSING call
//   licensed   → book the licensed-prospect call with Sam
//   hired      → book the onboarding call (contracts set-up)
//
// WP2 (2026-11-10): edge functions read the SAME values from
// supabase/functions/_shared/scheduling-links.ts. src/tests/config/schedulingLinksParity.test.ts
// holds the two equal, and scripts/check-scheduling-links.mjs refuses a new
// 'calendly.com/apexfinancialempire/' literal anywhere else. Change both files together.
export const SCHEDULING_LINKS = {
  /** Unlicensed: the licensing call, booked after the course receipt is uploaded. */
  licensing: "https://calendly.com/apexfinancialempire/licensing-call",
  /** Legacy alias of `licensing`. */
  unlicensed: "https://calendly.com/apexfinancialempire/licensing-call",
  /** Applied + licensed: the licensed-prospect call with Sam (Sam's 2026-11-10 choice; N2 may change it). */
  licensed: "https://calendly.com/apexfinancialempire/licensed-prospect-call-clone",
  /** Canonical post-hire contracting/onboarding call (invite recipients: system_settings.onboarding_call_invite_recipients). */
  onboarding: "https://calendly.com/apexfinancialempire/apex-onboarding-call",
  /**
   * "Not ready to buy? Ask us first" — a 10-minute questions call any unlicensed applicant can
   * book BEFORE buying the course (live 2026-11-11: 72 unlicensed applicants in 90 days, 4 bought
   * the course while the only call was locked behind a receipt). null hides the link and
   * surfaces fall back to the owner's direct contact.
   */
  questions: "https://calendly.com/apexfinancialempire/licensing-questions" as string | null,
  samLicensed: "https://calendly.com/apexfinancialempire/licensed-prospect-call-clone",
  samUnlicensed: "https://calendly.com/apexfinancialempire/licensing-call",
} as const;

export interface BookingPrefill {
  applicationId?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
}

/**
 * Calendly link with name/email prefill and utm_source=apply&utm_content=<application_id>
 * (the calendly-webhook matches utm_content first). Mirrors buildBookingUrl in
 * supabase/functions/_shared/scheduling-links.ts; the parity test compares outputs.
 */
export function buildBookingUrl(base: string, prefill: BookingPrefill = {}): string {
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    return base;
  }
  const name = [prefill.firstName, prefill.lastName].map((s) => (s ?? "").trim()).filter(Boolean).join(" ");
  if (name) url.searchParams.set("name", name);
  const email = (prefill.email ?? "").trim();
  if (email) url.searchParams.set("email", email);
  const appId = (prefill.applicationId ?? "").trim();
  if (appId) {
    url.searchParams.set("utm_source", "apply");
    url.searchParams.set("utm_content", appId);
  }
  return url.toString();
}

// ─── Licensing cost policy ────────────────────────────────────────────────────
// WP2 (2026-11-10): six surfaces disagreed about who pays for the course ("Galaxy pays it",
// "we reimburse", "buy the course"). Sam has not answered (AUDIT N1), so every surface renders
// this NEUTRAL copy and makes no claim about who pays. Mirrors
// supabase/functions/_shared/licensing-cost.ts (parity test). When Sam answers: set whoPays and
// seed public.licensing_state_requirements; the numbers render from v_licensing_cost_public.
export type LicensingCostPayer = "applicant" | "agency" | "reimbursed_after_contracting";
export const LICENSING_COST = {
  whoPays: null as LicensingCostPayer | null,
  title: "Costs explained up front",
  short: "We walk you through course and exam costs before you buy anything.",
  askFirst: "Questions about cost before you buy? Ask us first.",
} as const;

/**
 * Who a new hire contacts about onboarding. Name-free on purpose (2026-11-11): the
 * named manager went inactive in September and every surface kept naming her; the
 * inbox is the one live mailbox (the apex-financial.org addresses return 550).
 */
export const ONBOARDING_CONTACT = {
  name: "our onboarding team",
  role: "Onboarding",
  email: "info@kingofsales.net",
} as const;

export const TEAM_COMMUNITY_LINKS = {
  slack: "https://join.slack.com/t/apex-financial-co/shared_invite/zt-47rdeq1fr-ETmj8yGBgRcoYVkwfc3DBQ",
  discord: "https://discord.gg/JpUWA73UZX",
  /** #unlicensed — where every unlicensed applicant lives until they're licensed (Sam, 2026-09-07). */
  slackUnlicensedChannel: "https://apex-financial-co.slack.com/archives/C0BUTAKNB38",
} as const;

/** XCEL pre-licensing course — the same link the unlicensed roadmap email sends. */
export const LICENSING_COURSE_URL = "https://partners.xcelsolutions.com/afe";

const CALENDLY_HOST_NAMES: Record<string, string> = {
  samueljameshq: "Samuel James — King of Sales",
  apexfinancialempire: "Samuel James — King of Sales",
};

export function getCalendlyHostName(url: string): string {
  try {
    const parsed = new URL(url);
    const slug = (parsed.pathname.split("/").filter(Boolean)[0] ?? "").toLowerCase();
    return CALENDLY_HOST_NAMES[slug] ?? "your Galaxy strategist";
  } catch {
    return "your Galaxy strategist";
  }
}

// ─── Call Outcomes ────────────────────────────────────────────────────────────
export const CALL_OUTCOMES = [
  { key: "no_answer", label: "No Answer", activityType: "call_no_answer", color: "text-muted-foreground" },
  { key: "voicemail", label: "Left Voicemail", activityType: "call_voicemail", color: "text-amber-400" },
  { key: "interested", label: "Spoke – Interested", activityType: "call_connected", color: "text-emerald-400" },
  { key: "not_interested", label: "Spoke – Not Interested", activityType: "call_connected", color: "text-rose-400" },
  { key: "wrong_number", label: "Wrong Number", activityType: "call_wrong_number", color: "text-muted-foreground" },
] as const;

// ─── Animation / Performance ──────────────────────────────────────────────────
export const ANIMATION_THRESHOLDS = {
  /** Disable whileHover on cards when column has more than this many */
  disableHoverAboveCards: 15,
} as const;

// ─── Auto-Stage Suggestion Rules ──────────────────────────────────────────────
export const SUGGESTION_RULES = {
  /** Days without stage change before suggesting "Move to Final Steps" for passed_test */
  passedTestStaleDays: 3,
  /** Days without stage change before suggesting "Move to Licensed" for waiting_on_license */
  waitingOnLicenseStaleDays: 7,
  /** Days of inactivity + low score before suggesting "Mark as Cold" */
  coldInactivityDays: 7,
  coldScoreThreshold: 40,
} as const;

// ─── Overdue Thresholds ───────────────────────────────────────────────────────
export const OVERDUE_THRESHOLDS = {
  /** Hours before a lead is considered overdue */
  overdueHours: 48,
} as const;
