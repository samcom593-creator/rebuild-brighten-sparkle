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
// v9 wave-C: split sam/kj so the success page can name the host. Keep the legacy
// `unlicensed` + `licensed` keys for the dozen call sites that already read them.
// kjLicensed is a sentinel — the resolver below routes back to Sam and fires a
// one-time Telegram nag until Sam pastes KJ's actual URL here.
export const KJ_CALENDLY_PLACEHOLDER = "PASTE_KJ_CALENDLY_HERE";

export const SCHEDULING_LINKS = {
  unlicensed: "https://calendly.com/apexfinancialempire/licensed-prospect-call-clone",
  licensed: "https://calendly.com/apexfinancialempire/1on1-call-clone",
  samLicensed: "https://calendly.com/apexfinancialempire/1on1-call-clone",
  kjLicensed: KJ_CALENDLY_PLACEHOLDER,
  samUnlicensed: "https://calendly.com/apexfinancialempire/licensed-prospect-call-clone",
  kjUnlicensed: KJ_CALENDLY_PLACEHOLDER,
} as const;

const CALENDLY_HOST_NAMES: Record<string, string> = {
  samueljameshq: "Samuel James — King of Sales",
  apexfinancialempire: "Samuel James — King of Sales",
  kjvaughn: "KJ Vaughn",
};

export function getCalendlyHostName(url: string): string {
  try {
    const parsed = new URL(url);
    const slug = (parsed.pathname.split("/").filter(Boolean)[0] ?? "").toLowerCase();
    return CALENDLY_HOST_NAMES[slug] ?? "your APEX strategist";
  } catch {
    return "your APEX strategist";
  }
}

export interface ResolvedScheduling {
  url: string;
  hostName: string;
  fallback: boolean;
}

// Fire-and-forget: insert one poke_queue row when KJ's URL is still the
// placeholder. localStorage guards client-side; the db-side existence check
// guards across browsers. Wrapped in try/catch so a missing row policy or
// offline browser never breaks the booking flow.
let kjNagFiredThisTab = false;
async function fireKjPlaceholderNagOnce(): Promise<void> {
  if (typeof window === "undefined" || kjNagFiredThisTab) return;
  kjNagFiredThisTab = true;
  try {
    const key = "apex_kj_calendly_nag_v1";
    if (window.localStorage.getItem(key)) return;
    const { supabase } = await import("@/integrations/supabase/client");
    // poke_queue is a runtime ops table not in the generated Database type — cast.
    const sb = supabase as unknown as {
      from: (t: string) => {
        select: (
          c: string,
          o: { count: "exact"; head: true },
        ) => { eq: (c: string, v: string) => Promise<{ count: number | null }> };
        insert: (row: Record<string, unknown>) => Promise<unknown>;
      };
    };
    const { count } = await sb
      .from("poke_queue")
      .select("id", { count: "exact", head: true })
      .eq("kind", "kj_calendly_missing");
    if ((count ?? 0) === 0) {
      await sb.from("poke_queue").insert({
        kind: "kj_calendly_missing",
        payload: {
          message:
            "Using Sam's Calendly for KJ slots until KJ's URL lands in apexConfig.ts SCHEDULING_LINKS.kjLicensed (src/lib/apexConfig.ts).",
          action_required: "Paste KJ's Calendly URL into SCHEDULING_LINKS.kjLicensed",
          source: "apex-website",
        },
      });
    }
    window.localStorage.setItem(key, new Date().toISOString());
  } catch { // empty-catch-allow:localstorage-incognito
    /* never break the page on a notify failure */
  }
}

export function resolveLicensedScheduling(preferKj = false): ResolvedScheduling {
  const kjReal =
    SCHEDULING_LINKS.kjLicensed &&
    SCHEDULING_LINKS.kjLicensed !== KJ_CALENDLY_PLACEHOLDER;
  if (preferKj && kjReal) {
    return {
      url: SCHEDULING_LINKS.kjLicensed,
      hostName: getCalendlyHostName(SCHEDULING_LINKS.kjLicensed),
      fallback: false,
    };
  }
  if (preferKj && !kjReal) {
    void fireKjPlaceholderNagOnce();
  }
  return {
    url: SCHEDULING_LINKS.samLicensed,
    hostName: getCalendlyHostName(SCHEDULING_LINKS.samLicensed),
    fallback: preferKj,
  };
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
