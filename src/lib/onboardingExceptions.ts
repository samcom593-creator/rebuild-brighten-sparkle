/**
 * Onboarding exception derivation ("No Hire Left Behind", APEX OS redesign §6).
 *
 * Input: one row per live hire from public.onboarding_exception_facts() — the
 * same receipts v_onboarding_sequence's rung booleans read (profile, NPN/comp,
 * intake, onboarding call, training, dialer, first deal), plus the records that
 * view never carried: login receipts, E&O/EFT, carrier authorization, required
 * training from v_training_required_completion, expected start + outcome, and
 * the last real outreach.
 *
 * Output: the open requirements for that hire, each with the exact gap, why it
 * matters, who owns it, how long it has waited (from a real timestamp, or null
 * = unknown), the next action and which resolution control resolves it.
 *
 * Rules this file enforces, each covered by src/tests/lib/onboardingExceptions.test.ts:
 *  - Parallel tracks. Contracting depends on the license only; it never waits on
 *    training, Slack, the onboarding call or the expected start. Training never
 *    waits on contracting. The single chain in v_onboarding_sequence that put
 *    "Join Slack" ahead of everything is not used.
 *  - A login is one requirement, not onboarding complete.
 *  - Training completion never satisfies carrier authorization.
 *  - An accepted intake is not a carrier appointment.
 *  - Unknown is never zero: a missing timestamp yields waitingSince null, a
 *    missing training catalog yields no training verdict at all.
 *  - A no-show is a start outcome, never a departure; nothing here offers one.
 *  - Slack is informational and never produces an exception.
 */

export type Track = "contracting" | "licensing" | "start" | "access" | "training" | "production";

export type RequirementKey =
  | "account_missing"
  | "never_signed_in"
  | "profile_missing"
  | "license_pending"
  | "npn_comp_missing"
  | "intake_missing"
  | "intake_review"
  | "documents_missing"
  | "carrier_pending"
  | "carrier_none"
  | "training_not_started"
  | "training_incomplete"
  | "dialer_missing"
  | "onboarding_call_unbooked"
  | "onboarding_call_outcome"
  | "onboarding_call_no_show"
  | "start_not_set"
  | "start_awaiting"
  | "start_unconfirmed"
  | "start_not_attending"
  | "start_outcome_missing"
  | "start_no_show"
  | "first_deal_missing";

export type ExpectedStartStatus = "confirmed" | "likely" | "awaiting_response" | "not_attending";
export type StartOutcome = "attended" | "no_show" | "rescheduled";

export const EXPECTED_START_STATUSES: readonly ExpectedStartStatus[] = ["confirmed", "likely", "awaiting_response", "not_attending"];
export const START_OUTCOMES: readonly StartOutcome[] = ["attended", "no_show", "rescheduled"];

export const EXPECTED_START_LABEL: Record<ExpectedStartStatus, string> = {
  confirmed: "Confirmed",
  likely: "Likely",
  awaiting_response: "Awaiting response",
  not_attending: "Not attending",
};
export const START_OUTCOME_LABEL: Record<StartOutcome, string> = {
  attended: "Attended",
  no_show: "No-show",
  rescheduled: "Rescheduled",
};

/** One row of public.onboarding_exception_facts(). Postgres numerics/ints may
 *  arrive as strings through PostgREST; every reader coerces. */
export interface OnboardingFacts {
  agent_id: string;
  agent_name: string | null;
  owner_agent_id: string | null;
  owner_name: string | null;
  agent_status: string | null;
  license_status: string | null;
  onboarding_stage: string | null;
  hired_at: string | null;
  start_date: string | null;
  licensed_at: string | null;
  has_account: boolean | null;
  last_sign_in_at: string | null;
  login_link_sent_at: string | null;
  login_link_used_at: string | null;
  has_profile: boolean | null;
  licensing_ready: boolean | null;
  intake_status: string | null;
  intake_at: string | null;
  contracting_started: boolean | null;
  eo_on_file: boolean | null;
  eft_on_file: boolean | null;
  carrier_active_count: number | string | null;
  carrier_pending_count: number | string | null;
  carrier_first_active_at: string | null;
  training_required_total: number | string | null;
  training_required_passed: number | string | null;
  training_started: boolean | null;
  training_last_activity_at: string | null;
  has_dialer_login: boolean | null;
  onboarding_call_event_id: string | null;
  onboarding_call_at: string | null;
  onboarding_call_outcome: string | null;
  first_deal_at: string | null;
  expected_start_on: string | null;
  expected_start_status: string | null;
  expected_start_set_at: string | null;
  start_outcome: string | null;
  start_outcome_on: string | null;
  start_outcome_at: string | null;
  last_outreach_at: string | null;
  last_outreach_kind: string | null;
}

export type Resolution =
  | { kind: "send_login" }
  | { kind: "open_profile" }
  | { kind: "open_contracting" }
  | { kind: "open_recruit_stages" }
  | { kind: "open_training" }
  | { kind: "request_booking" }
  | { kind: "call_outcome"; eventId: string }
  | { kind: "set_start" }
  | { kind: "start_outcome" };

export type OwnerKind = "manager" | "contracting" | "admin";

export interface OnboardingException {
  key: RequirementKey;
  track: Track;
  /** The exact missing requirement, as a sentence fragment. */
  label: string;
  /** One line: why it matters. */
  why: string;
  owner: string;
  ownerKind: OwnerKind;
  /** ISO timestamp the gap started, or null when no record says. */
  waitingSince: string | null;
  /** What waitingSince is measured from, e.g. "since hired". */
  waitingBasis: string;
  nextAction: string;
  resolution: Resolution;
  /** True when it blocks the hire from writing business. */
  blocking: boolean;
}

export interface RecruitExceptions {
  facts: OnboardingFacts;
  exceptions: OnboardingException[];
  primary: OnboardingException | null;
}

export const TRACK_LABEL: Record<Track, string> = {
  contracting: "Contracting",
  licensing: "Licensing",
  start: "Start",
  access: "Access",
  training: "Training",
  production: "Production",
};

/** Which track a requirement belongs to and the ONLY facts it waits on. Used by
 *  the derivation and asserted by the tests: contracting keys may depend on
 *  `licensed` (and the intake for carrier keys), never on training, Slack, the
 *  onboarding call or the expected start. */
export const REQUIREMENT_TRACK: Record<RequirementKey, Track> = {
  account_missing: "access",
  never_signed_in: "access",
  profile_missing: "access",
  license_pending: "licensing",
  npn_comp_missing: "licensing",
  intake_missing: "contracting",
  intake_review: "contracting",
  documents_missing: "contracting",
  carrier_pending: "contracting",
  carrier_none: "contracting",
  training_not_started: "training",
  training_incomplete: "training",
  dialer_missing: "access",
  onboarding_call_unbooked: "start",
  onboarding_call_outcome: "start",
  onboarding_call_no_show: "start",
  start_not_set: "start",
  start_awaiting: "start",
  start_unconfirmed: "start",
  start_not_attending: "start",
  start_outcome_missing: "start",
  start_no_show: "start",
  first_deal_missing: "production",
};

export type Prerequisite = "licensed" | "intake_accepted" | "carrier_active" | "account" | "training_catalog" | "onboarding_call_booked" | "not_producing";

export const REQUIREMENT_PREREQUISITES: Record<RequirementKey, readonly Prerequisite[]> = {
  account_missing: [],
  never_signed_in: ["account"],
  profile_missing: ["account"],
  license_pending: [],
  npn_comp_missing: ["licensed"],
  intake_missing: ["licensed", "not_producing"],
  intake_review: ["licensed", "not_producing"],
  documents_missing: ["licensed", "not_producing"],
  carrier_pending: ["licensed", "intake_accepted", "not_producing"],
  carrier_none: ["licensed", "intake_accepted", "not_producing"],
  training_not_started: ["training_catalog"],
  training_incomplete: ["training_catalog"],
  dialer_missing: ["licensed", "not_producing"],
  onboarding_call_unbooked: ["licensed", "not_producing"],
  onboarding_call_outcome: ["onboarding_call_booked"],
  onboarding_call_no_show: ["onboarding_call_booked", "not_producing"],
  start_not_set: ["not_producing"],
  start_awaiting: ["not_producing"],
  start_unconfirmed: ["not_producing"],
  start_not_attending: ["not_producing"],
  start_outcome_missing: ["not_producing"],
  start_no_show: ["not_producing"],
  first_deal_missing: ["carrier_active"],
};

/** Contracting runs first in the queue: it is where money is lost. */
const TRACK_PRIORITY: Record<Track, number> = {
  contracting: 0,
  licensing: 1,
  start: 2,
  access: 3,
  production: 4,
  training: 5,
};

/** A hire with no expected-start record is only asked about it while the hire is
 *  recent; an old hire's open items are the other requirements. */
export const START_QUESTION_WINDOW_DAYS = 60;

const DAY_MS = 86_400_000;

function num(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function ts(v: string | null | undefined): number | null {
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t;
}

/** The later of two ISO timestamps; null only when both are unknown. */
export function laterOf(a: string | null | undefined, b: string | null | undefined): string | null {
  const ta = ts(a);
  const tb = ts(b);
  if (ta === null) return tb === null ? null : (b as string);
  if (tb === null) return a as string;
  return ta >= tb ? (a as string) : (b as string);
}

/** Whole days since `since`; null when unknown (never 0). */
export function daysWaiting(since: string | null | undefined, now: Date = new Date()): number | null {
  const t = ts(since);
  if (t === null) return null;
  return Math.max(0, Math.floor((now.getTime() - t) / DAY_MS));
}

/** "Today" as a YYYY-MM-DD in America/Phoenix (business-day convention). */
export function phoenixToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Phoenix", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function isExpectedStartStatus(v: string | null | undefined): v is ExpectedStartStatus {
  return !!v && (EXPECTED_START_STATUSES as readonly string[]).includes(v);
}
export function isStartOutcome(v: string | null | undefined): v is StartOutcome {
  return !!v && (START_OUTCOMES as readonly string[]).includes(v);
}

/** The outcome recorded against the CURRENT expected date, if any. An outcome
 *  recorded against an earlier date (e.g. "rescheduled from Oct 3") is history. */
export function currentStartOutcome(f: OnboardingFacts): StartOutcome | null {
  if (!isStartOutcome(f.start_outcome)) return null;
  if (!f.expected_start_on || f.start_outcome_on !== f.expected_start_on) return null;
  return f.start_outcome;
}

function ownerFor(f: OnboardingFacts, kind: OwnerKind): string {
  if (kind === "contracting") return "Contracting team";
  if (kind === "admin") return "Admin (seats)";
  return f.owner_name?.trim() || "Unassigned";
}

function mk(
  f: OnboardingFacts,
  key: RequirementKey,
  parts: {
    label: string;
    why: string;
    ownerKind: OwnerKind;
    waitingSince: string | null;
    waitingBasis: string;
    nextAction: string;
    resolution: Resolution;
    blocking: boolean;
  },
): OnboardingException {
  return { key, track: REQUIREMENT_TRACK[key], owner: ownerFor(f, parts.ownerKind), ...parts };
}

/** Derive every open onboarding requirement for one hire. Pure. */
export function deriveExceptions(f: OnboardingFacts, now: Date = new Date()): OnboardingException[] {
  const out: OnboardingException[] = [];
  const hired = f.hired_at;
  const licensed = f.license_status === "licensed";
  const licensedSince = licensed ? laterOf(hired, f.licensed_at) : null;
  const producing = !!f.first_deal_at;
  const carrierActive = (num(f.carrier_active_count) ?? 0) > 0;
  const carrierPending = num(f.carrier_pending_count) ?? 0;

  // ---- access ------------------------------------------------------------
  if (f.has_account === false) {
    out.push(mk(f, "account_missing", {
      label: "No portal account yet",
      why: "Without a login they cannot see their steps, training or contracting.",
      ownerKind: "manager",
      waitingSince: hired,
      waitingBasis: "since hired",
      nextAction: "Send the portal login link.",
      resolution: { kind: "send_login" },
      blocking: true,
    }));
  } else if (f.has_account === true) {
    if (!f.last_sign_in_at && !f.login_link_used_at) {
      out.push(mk(f, "never_signed_in", {
        label: "Has an account but has never signed in",
        why: "A login that was never used is not access; they still cannot see their next step.",
        ownerKind: "manager",
        waitingSince: f.login_link_sent_at ?? hired,
        waitingBasis: f.login_link_sent_at ? "since the last login link" : "since hired",
        nextAction: "Resend the login link and confirm they can get in.",
        resolution: { kind: "send_login" },
        blocking: true,
      }));
    }
    if (f.has_profile === false) {
      out.push(mk(f, "profile_missing", {
        label: "No profile record",
        why: "Contact details, documents and contracting hang off the profile.",
        ownerKind: "manager",
        waitingSince: hired,
        waitingBasis: "since hired",
        nextAction: "Open their record and complete the profile.",
        resolution: { kind: "open_profile" },
        blocking: false,
      }));
    }
  }

  // ---- licensing ---------------------------------------------------------
  if (!licensed) {
    out.push(mk(f, "license_pending", {
      label: f.license_status === "pending" ? "License pending" : "Not licensed yet",
      why: "They cannot be contracted or write business until licensed.",
      ownerKind: "manager",
      waitingSince: hired,
      waitingBasis: "since hired",
      nextAction: "Confirm their exam date and update license progress.",
      resolution: { kind: "open_recruit_stages" },
      blocking: true,
    }));
  } else if (f.licensing_ready === false) {
    out.push(mk(f, "npn_comp_missing", {
      label: "NPN or comp level missing",
      why: "Carrier contracting cannot be submitted without the NPN and comp level on file.",
      ownerKind: "contracting",
      waitingSince: licensedSince,
      waitingBasis: "since licensed",
      nextAction: "Add the NPN and comp level.",
      resolution: { kind: "open_contracting" },
      blocking: true,
    }));
  }

  // ---- contracting (depends on the license only) --------------------------
  // A first deal is evidence a carrier already appointed them, so a producer's
  // missing intake / documents / carrier record is a records gap for the
  // contracting team, not a block, and is not queued here.
  if (licensed && !producing) {
    if (f.contracting_started !== true) {
      if (f.intake_status === "needs_review") {
        out.push(mk(f, "intake_review", {
          label: "Contracting intake needs review",
          why: "Carrier paperwork cannot start until the intake is accepted.",
          ownerKind: "contracting",
          waitingSince: f.intake_at,
          waitingBasis: "since the intake was submitted",
          nextAction: "Review the intake and accept it or send it back.",
          resolution: { kind: "open_contracting" },
          blocking: true,
        }));
      } else {
        out.push(mk(f, "intake_missing", {
          label: "No contracting intake submitted",
          why: "Carrier paperwork cannot start until the contracting intake is in.",
          ownerKind: "manager",
          waitingSince: licensedSince,
          waitingBasis: "since licensed",
          nextAction: "Get their contracting intake submitted.",
          resolution: { kind: "open_contracting" },
          blocking: true,
        }));
      }
    }
    const missingDocs = [f.eo_on_file === true ? null : "E&O certificate", f.eft_on_file === true ? null : "EFT (direct deposit)"].filter(Boolean);
    if (missingDocs.length > 0) {
      out.push(mk(f, "documents_missing", {
        label: `${missingDocs.join(" and ")} not on file`,
        why: "Carriers will not appoint without E&O and direct-deposit details.",
        ownerKind: "contracting",
        waitingSince: licensedSince,
        waitingBasis: "since licensed",
        nextAction: `Collect the ${missingDocs.join(" and ")}.`,
        resolution: { kind: "open_contracting" },
        blocking: true,
      }));
    }
    // Carrier authorization. Training never satisfies this; an accepted intake
    // never satisfies this. A first deal is evidence a carrier appointed them.
    if (f.contracting_started === true && !carrierActive) {
      if (carrierPending > 0) {
        out.push(mk(f, "carrier_pending", {
          label: `Carrier contracts pending (${carrierPending})`,
          why: "An accepted intake is not carrier approval; they cannot write until a carrier appoints them.",
          ownerKind: "contracting",
          waitingSince: f.intake_at,
          waitingBasis: "since the intake was submitted",
          nextAction: "Chase the pending carrier contracts.",
          resolution: { kind: "open_contracting" },
          blocking: true,
        }));
      } else {
        out.push(mk(f, "carrier_none", {
          label: "No carrier contract on record",
          why: "The intake is accepted, but nothing records a carrier appointment, so nobody can confirm they can write.",
          ownerKind: "contracting",
          waitingSince: f.intake_at,
          waitingBasis: "since the intake was submitted",
          nextAction: "Submit carrier contracts and record them.",
          resolution: { kind: "open_contracting" },
          blocking: true,
        }));
      }
    }
  }

  // ---- training (independent of contracting) -----------------------------
  const reqTotal = num(f.training_required_total);
  const reqPassed = num(f.training_required_passed) ?? 0;
  if (reqTotal !== null && reqTotal > 0 && reqPassed < reqTotal) {
    if (f.training_started !== true) {
      out.push(mk(f, "training_not_started", {
        label: "Required training not started",
        why: "Required training gates the scripts packet and launch.",
        ownerKind: "manager",
        waitingSince: hired,
        waitingBasis: "since hired",
        nextAction: "Get them into the course.",
        resolution: { kind: "open_training" },
        blocking: false,
      }));
    } else {
      out.push(mk(f, "training_incomplete", {
        label: `Required training ${reqPassed} of ${reqTotal} passed`,
        why: "Required training gates the scripts packet and launch.",
        ownerKind: "manager",
        waitingSince: f.training_last_activity_at ?? hired,
        waitingBasis: f.training_last_activity_at ? "since last course activity" : "since hired",
        nextAction: "Check in on the remaining modules.",
        resolution: { kind: "open_training" },
        blocking: false,
      }));
    }
  }

  // ---- dialer (licensed, not yet producing) -------------------------------
  if (licensed && !producing && f.has_dialer_login !== true) {
    out.push(mk(f, "dialer_missing", {
      label: "No dialer login",
      why: "No dialer seat means no calls and no appointments.",
      ownerKind: "admin",
      waitingSince: licensedSince,
      waitingBasis: "since licensed",
      nextAction: "Assign a dialer seat and mark the login on their record.",
      resolution: { kind: "open_profile" },
      blocking: false,
    }));
  }

  // ---- onboarding call -----------------------------------------------------
  if (f.onboarding_call_event_id) {
    const callAt = ts(f.onboarding_call_at);
    if (f.onboarding_call_outcome === "no_show" && !producing) {
      out.push(mk(f, "onboarding_call_no_show", {
        label: "Missed the onboarding call",
        why: "A missed call is not a departure; the call is where launch gets walked through.",
        ownerKind: "manager",
        waitingSince: f.onboarding_call_at,
        waitingBasis: "since the missed call",
        nextAction: "Call them and rebook the onboarding call.",
        resolution: { kind: "open_profile" },
        blocking: false,
      }));
    } else if (!f.onboarding_call_outcome && callAt !== null && callAt < now.getTime()) {
      out.push(mk(f, "onboarding_call_outcome", {
        label: "Onboarding call outcome not recorded",
        why: "Nobody can tell whether the call happened until someone records it.",
        ownerKind: "manager",
        waitingSince: f.onboarding_call_at,
        waitingBasis: "since the call time",
        nextAction: "Record whether they attended.",
        resolution: { kind: "call_outcome", eventId: f.onboarding_call_event_id },
        blocking: false,
      }));
    }
  } else if (licensed && !producing) {
    out.push(mk(f, "onboarding_call_unbooked", {
      label: "Onboarding call not booked",
      why: "The onboarding call is where launch gets walked through; it runs alongside contracting, not before it.",
      ownerKind: "manager",
      waitingSince: licensedSince,
      waitingBasis: "since licensed",
      nextAction: "Send the booking link.",
      resolution: { kind: "request_booking" },
      blocking: false,
    }));
  }

  // ---- expected start vs outcome -------------------------------------------
  if (!producing) {
    const status = isExpectedStartStatus(f.expected_start_status) ? f.expected_start_status : null;
    const outcome = currentStartOutcome(f);
    const hiredDays = daysWaiting(hired, now);
    const recent = hiredDays !== null && hiredDays <= START_QUESTION_WINDOW_DAYS;
    const today = phoenixToday(now);
    if (outcome === "no_show") {
      out.push(mk(f, "start_no_show", {
        label: `No-show on ${f.expected_start_on}`,
        why: "A no-show is not a departure; reach out before anyone marks them gone.",
        ownerKind: "manager",
        waitingSince: f.start_outcome_at,
        waitingBasis: "since the no-show was recorded",
        nextAction: "Call them and set a new expected start.",
        resolution: { kind: "set_start" },
        blocking: false,
      }));
    } else if (outcome === "attended") {
      // started; nothing to ask
    } else if (status === null) {
      if (recent) {
        out.push(mk(f, "start_not_set", {
          label: "No expected start recorded",
          why: "Nobody can plan the first week until there is a start date.",
          ownerKind: "manager",
          waitingSince: hired,
          waitingBasis: "since hired",
          nextAction: "Ask for their start date and record it.",
          resolution: { kind: "set_start" },
          blocking: false,
        }));
      }
    } else if (status === "awaiting_response") {
      out.push(mk(f, "start_awaiting", {
        label: "Waiting on their reply about a start date",
        why: "An unanswered start is the earliest sign a hire is slipping.",
        ownerKind: "manager",
        waitingSince: f.expected_start_set_at,
        waitingBasis: "since asked",
        nextAction: "Follow up and confirm a start date.",
        resolution: { kind: "set_start" },
        blocking: false,
      }));
    } else if (status === "not_attending") {
      out.push(mk(f, "start_not_attending", {
        label: "Says they are not attending",
        why: "Not attending is their answer, not a status change; decide whether to re-engage.",
        ownerKind: "manager",
        waitingSince: f.expected_start_set_at,
        waitingBasis: "since recorded",
        nextAction: "Talk to them, then re-engage or close them out deliberately.",
        resolution: { kind: "set_start" },
        blocking: false,
      }));
    } else if (f.expected_start_on && f.expected_start_on < today) {
      out.push(mk(f, "start_outcome_missing", {
        label: `Start date ${f.expected_start_on} passed with no outcome`,
        why: "Nobody can tell whether they started until someone records it.",
        ownerKind: "manager",
        waitingSince: `${f.expected_start_on}T12:00:00-07:00`,
        waitingBasis: "since the expected start",
        nextAction: "Record attended, no-show or rescheduled.",
        resolution: { kind: "start_outcome" },
        blocking: false,
      }));
    } else if (status === "likely") {
      out.push(mk(f, "start_unconfirmed", {
        label: f.expected_start_on ? `Start ${f.expected_start_on} not confirmed` : "Start not confirmed",
        why: "A likely start is a guess until they confirm it.",
        ownerKind: "manager",
        waitingSince: f.expected_start_set_at,
        waitingBasis: "since recorded",
        nextAction: "Confirm the start date with them.",
        resolution: { kind: "set_start" },
        blocking: false,
      }));
    }
  }

  // ---- first production (needs a carrier to have appointed them) -----------
  if (carrierActive && !producing) {
    out.push(mk(f, "first_deal_missing", {
      label: "Appointed but no first deal",
      why: "They can write business and have not; this is where hires quietly stall.",
      ownerKind: "manager",
      waitingSince: f.carrier_first_active_at,
      waitingBasis: "since first carrier appointment",
      nextAction: "Book a field-training session and a first appointment.",
      resolution: { kind: "open_profile" },
      blocking: false,
    }));
  }

  return sortExceptions(out, now);
}

export function sortExceptions(list: OnboardingException[], now: Date = new Date()): OnboardingException[] {
  return [...list].sort((a, b) => {
    if (a.blocking !== b.blocking) return a.blocking ? -1 : 1;
    const t = TRACK_PRIORITY[a.track] - TRACK_PRIORITY[b.track];
    if (t !== 0) return t;
    const da = daysWaiting(a.waitingSince, now);
    const db = daysWaiting(b.waitingSince, now);
    if (da === null && db === null) return 0;
    if (da === null) return 1;
    if (db === null) return -1;
    return db - da;
  });
}

/** One entry per hire with at least one open requirement, most urgent first. */
export function buildExceptionQueue(rows: OnboardingFacts[], now: Date = new Date()): RecruitExceptions[] {
  const seen = new Set<string>();
  const out: RecruitExceptions[] = [];
  for (const facts of rows) {
    if (!facts?.agent_id || seen.has(facts.agent_id)) continue;
    seen.add(facts.agent_id);
    const exceptions = deriveExceptions(facts, now);
    if (exceptions.length === 0) continue;
    out.push({ facts, exceptions, primary: exceptions[0] });
  }
  return out.sort((a, b) => {
    const pa = a.primary!;
    const pb = b.primary!;
    if (pa.blocking !== pb.blocking) return pa.blocking ? -1 : 1;
    const t = TRACK_PRIORITY[pa.track] - TRACK_PRIORITY[pb.track];
    if (t !== 0) return t;
    const da = daysWaiting(pa.waitingSince, now);
    const db = daysWaiting(pb.waitingSince, now);
    if (da === null && db === null) return 0;
    if (da === null) return 1;
    if (db === null) return -1;
    return db - da;
  });
}

/** Display text for an expected start: "Confirmed · 2026-10-07", or null. */
export function expectedStartText(f: Pick<OnboardingFacts, "expected_start_status" | "expected_start_on">): string | null {
  if (!isExpectedStartStatus(f.expected_start_status)) return null;
  const label = EXPECTED_START_LABEL[f.expected_start_status];
  return f.expected_start_on ? `${label} · ${f.expected_start_on}` : label;
}

/** Per-track counts over a queue (each hire counted once per track it is open on). */
export function trackCounts(queue: RecruitExceptions[]): Record<Track, number> {
  const counts: Record<Track, number> = { contracting: 0, licensing: 0, start: 0, access: 0, training: 0, production: 0 };
  for (const r of queue) {
    const tracks = new Set(r.exceptions.map((e) => e.track));
    for (const t of tracks) counts[t] += 1;
  }
  return counts;
}
