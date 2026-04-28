/**
 * Autoposter / plaque / Discord canonical policy
 *
 * Mirrors `~/.claude/projects/-Users-samjames/memory/autoposter_policy.md`.
 * Edit BOTH this file and the memory file together when policy changes.
 *
 * Every IG/Discord/email autoposter MUST consult these constants before
 * deciding whether to (a) generate a plaque, (b) route to a destination,
 * (c) include a metric in the payload.
 */

// ────────────────────────────────────────────────────────────────────────
// 1. IG account hard-deny / hard-allow lists
// ────────────────────────────────────────────────────────────────────────

/** IG handles autoposters MUST NEVER target. Halt immediately if matched. */
export const IG_BLOCKED_HANDLES = [
  "theprincejamez",     // Sam's personal IG
  "the_prince_james",
  "the.prince.james",
  "theprincejames",
] as const;

/** Sole allowed IG destination for awards/plaques. */
export const IG_AWARDS_HANDLE = "apexfinancialempire";

/** Surface types attempted in order — first non-failing wins. */
export const IG_POST_PRIORITY = ["feed", "story"] as const;

/** Final fallback when every IG path fails. */
export const FALLBACK_EMAIL = "sam.com593@gmail.com";

// ────────────────────────────────────────────────────────────────────────
// 2. Plaque generation thresholds — only post for THESE
// ────────────────────────────────────────────────────────────────────────

export const PLAQUE_THRESHOLDS = {
  /** First-ever deal for an agent — always post (no $ floor). */
  firstEverDeal: { enabled: true },
  /** First deal of the day — only if ALP at least this. */
  firstDealOfDayMinAlp: 3000,
  /** Any single deal — only if ALP at least this. */
  bigPersonalDealMinAlp: 3000,
  /** Agent personal daily production — only if ALP at least this. */
  bigDailyPersonalProductionMinAlp: 5000,
  /** Whole team daily production — only if ALP at least this. */
  bigDailyTeamProductionMinAlp: 5000,
  /** Multi-hire celebration — N hires in one calendar day. */
  multiHireMinCount: 3,
  /** Always: top producer of yesterday / week / month. */
  topProducerYesterday: { enabled: true },
  topProducerWeek: { enabled: true },
  topProducerMonth: { enabled: true },
  /** Major rank/production milestones (caller decides what's "major"). */
  majorMilestoneRequiresExplicitFlag: true,
} as const;

// ────────────────────────────────────────────────────────────────────────
// 3. Discord channel routing — what's allowed where
// ────────────────────────────────────────────────────────────────────────

export const DISCORD_ALLOWED_TOPICS = [
  "individual_win",
  "first_deal",
  "licensing_progress",
  "contracting_progress",
  "big_personal_production",
  "big_team_win_no_totals",
  "recruiting_momentum",
  "motivation",
] as const;

/** Reject the post if any of these appear in the payload. */
export const DISCORD_BLOCKED_TOPICS = [
  "team_alp",
  "agency_total",
  "earnings",
  "commission",
  "carrier_mapping",
  "debug",
  "internal_error",
  "private_agent_info",
  "low_value_deal",
] as const;

/** Per-payload regexes that flag content as blocked. Run on full text. */
export const DISCORD_BLOCKED_PHRASES: RegExp[] = [
  /team\s+alp\b/i,
  /agency\s+(?:total|alp)\b/i,
  /total\s+team\s+production/i,
  /\bcommission\s+(?:total|paid|due)\b/i,
  /carrier\s+(?:mapping|mismatch)/i,
];

// ────────────────────────────────────────────────────────────────────────
// 4. Plaque delivery fan-out
// ────────────────────────────────────────────────────────────────────────

export const PLAQUE_DELIVERY_TARGETS = [
  "agent",          // direct to producing agent
  "manager_upline", // direct to that agent's manager
  "discord_safe",   // Discord IF passes §3 allowed/blocked
  "ig_apex_only",   // IG IF passes §1 + §2 thresholds, posts to Apex Financial Empire only
  "email_fallback", // Sam gets a copy if IG/WA fails
] as const;

// ────────────────────────────────────────────────────────────────────────
// 5. Content rules — every plaque must satisfy these
// ────────────────────────────────────────────────────────────────────────

export const CONTENT_RULES = {
  /** Photo fallback chain — first non-null wins. */
  photoFallbackOrder: ["custom_photo_url", "avatar_url", "photo_url"] as const,
  /** Block render if no photo can be resolved (true = render generic; false = skip post). */
  allowGenericAvatar: false,
  /** Always say ALP, never AOP. Banned in payload text. */
  bannedTermsInPayload: [/\baop\b/i, /annual operating premium/i],
  /** Required: pull numbers from deals truth (status submitted/active by effective_date). */
  requiredDataSource: "deals",
  /** Forbidden data sources for ALP/deal counts. */
  forbiddenDataSources: ["daily_production.aop", "agent_lifetime_production"],
} as const;

// ────────────────────────────────────────────────────────────────────────
// 6. Pre-enable checklist — autoposter cannot turn on without all 7 yes
// ────────────────────────────────────────────────────────────────────────

export interface AutoposterReadinessChecklist {
  /** Resolves to a known + correct destination (handle/channel/email)? */
  destinationCorrect: boolean;
  /** Cannot resolve to any IG_BLOCKED_HANDLES entry? */
  blocksPersonalIg: boolean;
  /** Payload cannot include team_alp / agency_total / earnings? */
  blocksTeamTotals: boolean;
  /** Has threshold filters from PLAQUE_THRESHOLDS or DISCORD_BLOCKED_TOPICS? */
  hasThresholdFilters: boolean;
  /** Has duplicate-post protection (idempotency on event_type+entity_id+day)? */
  hasIdempotency: boolean;
  /** Has email-Sam fallback path on failure? */
  hasEmailFallback: boolean;
  /** Logs every action to discord_event_log / instagram_events / email_delivery_log? */
  logsEveryAction: boolean;
}

export function autoposterIsReady(c: AutoposterReadinessChecklist): boolean {
  return (
    c.destinationCorrect &&
    c.blocksPersonalIg &&
    c.blocksTeamTotals &&
    c.hasThresholdFilters &&
    c.hasIdempotency &&
    c.hasEmailFallback &&
    c.logsEveryAction
  );
}

// ────────────────────────────────────────────────────────────────────────
// 7. Runtime guards — call these from edge functions / cron handlers
// ────────────────────────────────────────────────────────────────────────

/** Throw if a job is about to target a blocked IG handle. */
export function assertIgHandleAllowed(handle: string): void {
  const normalized = handle.replace(/^@/, "").toLowerCase();
  for (const blocked of IG_BLOCKED_HANDLES) {
    if (normalized === blocked) {
      throw new Error(`autoposterPolicy: BLOCKED IG handle "@${handle}" — see IG_BLOCKED_HANDLES`);
    }
  }
}

/** Throw if Discord payload contains a blocked phrase. */
export function assertDiscordPayloadAllowed(text: string): void {
  for (const re of DISCORD_BLOCKED_PHRASES) {
    if (re.test(text)) {
      throw new Error(`autoposterPolicy: BLOCKED Discord phrase matched ${re} in payload`);
    }
  }
  for (const re of CONTENT_RULES.bannedTermsInPayload) {
    if (re.test(text)) {
      throw new Error(`autoposterPolicy: banned term ${re} in payload — say ALP, never AOP`);
    }
  }
}

/** Decide whether a plaque is worth generating given event context. */
export function plaqueIsPostable(event: {
  type:
    | "first_ever_deal"
    | "first_deal_of_day"
    | "big_personal_deal"
    | "big_personal_daily"
    | "big_team_daily"
    | "multi_hire_day"
    | "top_yesterday"
    | "top_week"
    | "top_month"
    | "rank_milestone";
  alp?: number;
  hires?: number;
}): boolean {
  switch (event.type) {
    case "first_ever_deal":
      return true;
    case "first_deal_of_day":
      return (event.alp ?? 0) >= PLAQUE_THRESHOLDS.firstDealOfDayMinAlp;
    case "big_personal_deal":
      return (event.alp ?? 0) >= PLAQUE_THRESHOLDS.bigPersonalDealMinAlp;
    case "big_personal_daily":
      return (event.alp ?? 0) >= PLAQUE_THRESHOLDS.bigDailyPersonalProductionMinAlp;
    case "big_team_daily":
      return (event.alp ?? 0) >= PLAQUE_THRESHOLDS.bigDailyTeamProductionMinAlp;
    case "multi_hire_day":
      return (event.hires ?? 0) >= PLAQUE_THRESHOLDS.multiHireMinCount;
    case "top_yesterday":
    case "top_week":
    case "top_month":
      return true;
    case "rank_milestone":
      return false; // requires explicit flag from caller
  }
}
