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
