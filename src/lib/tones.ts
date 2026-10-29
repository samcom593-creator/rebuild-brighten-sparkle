/**
 * Tones: the seven meaning-carrying colours of the operating surfaces (2026-10-28).
 *
 * A tone names a state. The word is always beside the colour (docs/DESIGN_SYSTEM.md,
 * "Status is never colour alone"), and the same state is the same tone on every page, so
 * someone who learned on the Call list that green means "going well" can trust it on the
 * Pipeline, New hires and Social Command. The HSL values live in src/styles/delight.css and
 * reach Tailwind through the `tone` colours in tailwind.config.ts.
 *
 * Class strings are written out in full so Tailwind can see them.
 */
export type Tone = "good" | "warm" | "hot" | "cool" | "royal" | "gold" | "slate";

export const TONES: readonly Tone[] = ["good", "warm", "hot", "cool", "royal", "gold", "slate"];

export interface ToneClasses {
  /** Text in the tone. */
  text: string;
  /** A soft tint for a pill, bubble or tile. */
  soft: string;
  /** A hairline in the tone. */
  border: string;
  /** A small solid dot. */
  dot: string;
  /** A selected tile: tinted with a solid underline. */
  activeTile: string;
}

export const TONE_CLASS: Record<Tone, ToneClasses> = {
  good: { text: "text-tone-good", soft: "bg-tone-good/12", border: "border-tone-good/35", dot: "bg-tone-good", activeTile: "border-b-tone-good bg-tone-good/8" },
  warm: { text: "text-tone-warm", soft: "bg-tone-warm/12", border: "border-tone-warm/35", dot: "bg-tone-warm", activeTile: "border-b-tone-warm bg-tone-warm/8" },
  hot: { text: "text-tone-hot", soft: "bg-tone-hot/12", border: "border-tone-hot/35", dot: "bg-tone-hot", activeTile: "border-b-tone-hot bg-tone-hot/8" },
  cool: { text: "text-tone-cool", soft: "bg-tone-cool/12", border: "border-tone-cool/35", dot: "bg-tone-cool", activeTile: "border-b-tone-cool bg-tone-cool/8" },
  royal: { text: "text-tone-royal", soft: "bg-tone-royal/12", border: "border-tone-royal/35", dot: "bg-tone-royal", activeTile: "border-b-tone-royal bg-tone-royal/8" },
  gold: { text: "text-tone-gold", soft: "bg-tone-gold/12", border: "border-tone-gold/35", dot: "bg-tone-gold", activeTile: "border-b-tone-gold bg-tone-gold/8" },
  slate: { text: "text-tone-slate", soft: "bg-tone-slate/12", border: "border-tone-slate/35", dot: "bg-tone-slate", activeTile: "border-b-tone-slate bg-tone-slate/8" },
};

/** Tint, text and hairline for a pill in one string. */
export const tonePill = (tone: Tone): string => `${TONE_CLASS[tone].soft} ${TONE_CLASS[tone].text} ${TONE_CLASS[tone].border}`;

const norm = (value: string | null | undefined): string => (value ?? "").trim().toLowerCase();

/** Stages of /dashboard/recruiting/pipeline (v_recruiting_pipeline.stage). */
export function pipelineStageTone(stage: string | null | undefined): Tone {
  switch (norm(stage)) {
    case "new lead":
    case "contacted":
      return "cool";
    case "call scheduled":
    case "interested":
      return "warm";
    case "confirmed":
    case "expected monday":
      return "gold";
    case "showed":
    case "ready for training":
    case "active agent":
      return "good";
    case "no show":
      return "hot";
    case "onboarding":
    case "contract sent":
    case "contracting in progress":
      return "royal";
    default:
      return "slate";
  }
}

/** Hot / warm / cold intent on a prospect. Cold is blue, as the word suggests. */
export function intentTone(level: string | null | undefined): Tone {
  switch (norm(level)) {
    case "hot": return "hot";
    case "warm": return "warm";
    case "cold": return "cool";
    default: return "slate";
  }
}

/** Monday status on a prospect (expected, confirmed, showed, no_show). */
export function mondayTone(status: string | null | undefined): Tone {
  switch (norm(status)) {
    case "expected": return "gold";
    case "confirmed": return "gold";
    case "showed": return "good";
    case "no_show": return "hot";
    default: return "slate";
  }
}

/** The new-hire ladder rungs from src/lib/hireLadder.ts (0 Hired .. 4 Producing). */
export function hireRungTone(rank: number | null | undefined): Tone {
  switch (rank) {
    case 0: return "gold";
    case 1: return "royal";
    case 2: return "cool";
    case 3: return "warm";
    case 4: return "good";
    default: return "slate";
  }
}

/** Training stage from src/lib/teamStage.ts. */
export function teamStageTone(key: string | null | undefined): Tone {
  switch (norm(key)) {
    case "online_training": return "cool";
    case "training": return "warm";
    case "released_in_field": return "good";
    default: return "slate";
  }
}

/** A Social Command lane verdict. */
export function laneTone(verdict: string | null | undefined): Tone {
  switch (norm(verdict)) {
    case "alive": return "good";
    case "dead": return "hot";
    default: return "warm";
  }
}

/** A Social Command inbox bucket. */
export function inboxBucketTone(bucket: string | null | undefined): Tone {
  switch (norm(bucket)) {
    case "hot": return "hot";
    case "human_lane": return "gold";
    case "waiting": return "warm";
    case "booked": return "cool";
    default: return "slate";
  }
}

/** Platform brand feel without brand colours: each platform keeps one tone everywhere. */
export function platformTone(platform: string | null | undefined): Tone {
  switch (norm(platform)) {
    case "instagram": return "royal";
    case "tiktok": return "cool";
    case "youtube": return "hot";
    case "snapchat": return "warm";
    case "bio_link": return "gold";
    default: return "slate";
  }
}

/**
 * A recruiting link's license path (src/lib/recruitLinks.ts, OVERHAUL-1): licensed is someone
 * ready to work, not licensed yet is someone starting out.
 */
export function licensePathTone(choice: string | null | undefined): Tone {
  switch (norm(choice)) {
    case "licensed": return "good";
    case "unlicensed": return "cool";
    default: return "slate";
  }
}

/** A recruiting link's lifetime: a permanent link is steady, a temporary one is on a clock. */
export function linkLifetimeTone(lifetime: string | null | undefined): Tone {
  switch (norm(lifetime)) {
    case "permanent": return "good";
    case "temporary": return "warm";
    default: return "slate";
  }
}

/**
 * The Instagram desk (OVERHAUL-instagram): a row's state and the facts beside it. Act now is hot
 * (a number to call, a window about to close, told "locked in" with nothing booked, a no-show);
 * waiting on us is warm; a booked call is cool, like Booked everywhere; done, showed, applied and
 * licensed are good; hired is the gold moment; your own thread is royal; small talk is slate.
 */
export function igDeskTone(state: string | null | undefined): Tone {
  switch (norm(state)) {
    case "call":
    case "closing":
    case "no_show":
    case "locked_in_gap":
    case "refused":
      return "hot";
    case "reply":
    case "tag_it":
    case "closed":
    case "did_they_show":
    case "wants_in":
    case "following_up":
    case "gave_number":
    case "queued":
      return "warm";
    case "booked":
    case "booked_before":
    case "gave_email":
      return "cool";
    case "handled":
    case "showed":
    case "applied":
    case "licensed":
    case "delivered":
      return "good";
    case "hired":
      return "gold";
    case "your_thread":
      return "royal";
    default:
      return "slate";
  }
}

/**
 * A recruit's step on the journey of src/lib/recruitJourney.ts (OVERHAUL-recruits, 2026-10-29).
 * One tone per step so the bar, the chip and the bubble say the same thing: an application on
 * its own is quiet, a first conversation is new, an interview needs a nudge to happen, licensing
 * is paperwork, licensed is going well, contracted is the hire moment, a first deal is going well.
 */
export function recruitStepTone(step: string | null | undefined): Tone {
  switch (norm(step)) {
    case "applied": return "slate";
    case "contacted": return "cool";
    case "interview": return "warm";
    case "licensing": return "royal";
    case "licensed": return "good";
    case "contracted": return "gold";
    case "first_deal": return "good";
    default: return "slate";
  }
}

/**
 * A person's license as their record states it: licensed is going well and not licensed yet is
 * someone starting out, the same two tones as a recruiting link's license path; pending needs a nudge.
 */
export function licenseStatusTone(status: string | null | undefined): Tone {
  switch (norm(status)) {
    case "licensed": return licensePathTone("licensed");
    case "unlicensed": return licensePathTone("unlicensed");
    case "pending": return "warm";
    default: return "slate";
  }
}

/** An Xcel pre-licensing purchase on a recruit's row: bought, a nudge to buy, or a possible match. */
export function xcelTone(kind: string | null | undefined): Tone {
  switch (norm(kind)) {
    case "bought": return "good";
    case "missing": return "warm";
    default: return "slate";
  }
}

/**
 * Where a policy stands on the Book of Business (src/lib/bookStanding.ts, OVERHAUL-book, 2026-10-29):
 * in force is going well, on its way is new, a missed payment needs a nudge, off the books is the dead
 * state (red, like a dead lane and Book Flips' "Not in force"), and no status from the carrier is quiet.
 */
export function bookStandingTone(standing: string | null | undefined): Tone {
  switch (norm(standing)) {
    case "active": return "good";
    case "pending": return "cool";
    case "lapsing": return "warm";
    case "gone": return "hot";
    default: return "slate";
  }
}

/**
 * Easy Resells (OVERHAUL-resells, 2026-10-29): what kind of resell a person is. Ready to finish is
 * going well (they already gave SSN and bank); lapsing needs a nudge and dropped is the dead state, the
 * same two tones as the Book of Business; a Vantage client is paperwork with another agency; an agent who
 * left is quiet; a warm call is a fresh conversation.
 */
export function resellBucketTone(bucket: string | null | undefined): Tone {
  switch (norm(bucket)) {
    case "ready_to_finish": return "good";
    case "lapsing": return bookStandingTone("lapsing");
    case "dropped": return bookStandingTone("gone");
    case "vantage": return "royal";
    case "warm_objection": return "cool";
    default: return "slate";
  }
}

/**
 * A Book Flips call outcome (book_flips.flip_status): resold is going well, a callback is scheduled,
 * an appointment is paperwork to come, no answer needs a nudge, do not call is a stop, and a policy
 * not called yet, not interested or a bad number is quiet.
 */
export function flipStatusTone(status: string | null | undefined): Tone {
  switch (norm(status)) {
    case "resold": return "good";
    case "callback": return "cool";
    case "appointment": return "royal";
    case "no_answer": return "warm";
    case "do_not_call": return "hot";
    default: return "slate";
  }
}

/**
 * The evidence a resell ranks on (src/lib/resellEvidence.ts): SSN and bank given is going well, a sale on
 * a call is the gold moment, a lapse needs a nudge (the Book of Business lapsing tone), a phone somebody
 * answered is a live line (cool), and a phone nobody answers is quiet.
 */
export function evidenceTone(key: string | null | undefined): Tone {
  switch (norm(key)) {
    case "ssn_bank": return "good";
    case "sold_call": return "gold";
    case "lapse": return bookStandingTone("lapsing");
    case "answered": return "cool";
    default: return "slate";
  }
}
