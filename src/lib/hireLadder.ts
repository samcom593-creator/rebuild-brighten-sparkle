// The new-hire ladder, in the order a real hire climbs it.
//
// It is written out here and in public.fn_hire_stage_rank because the enum's
// own sort order is NOT the ladder: pg_enum orders onboarding_stage as
// applied, meeting_attendance, pre_licensed, transfer, below_10k, live,
// need_followup, inactive, pending_review, onboarding, training_online,
// in_field_training, evaluated — 'live' sorts before 'onboarding' and
// 'evaluated' sorts last. Anything that reads the enum order reads nonsense.
//
// 'evaluated' is placed at the top rung on evidence, not on the name: of the
// active agents parked there, 8 of 8 have a first_deal_at AND rows in
// agentlink_book. The rail this replaces matched the stage string against
// /(training|onboard|contract)/ and /(field|active|production|ready)/, so
// 'evaluated' matched neither and every one of those producers rendered at
// step 1, "Licensed" — proven earners shown as people still waiting on a
// license. Change this file and fn_hire_stage_rank together.

export const HIRE_RUNGS = [
  { rank: 0, stage: "pre_licensed", label: "Hired", short: "Hired" },
  { rank: 1, stage: "onboarding", label: "Onboarding", short: "Onboarding" },
  { rank: 2, stage: "training_online", label: "In course", short: "Course" },
  { rank: 3, stage: "in_field_training", label: "Field training", short: "Field" },
  { rank: 4, stage: "live", label: "Producing", short: "Producing" },
] as const;

export type HireRung = (typeof HIRE_RUNGS)[number];

/** Stages that are status flags, not rungs. They must be surfaced as an
 *  exception rather than sorted quietly to the bottom of the board. */
export const OFF_LADDER_STAGES = new Set([
  "inactive", "need_followup", "pending_review", "transfer", "below_10k",
]);

export function stageRank(stage: string | null | undefined): number | null {
  const key = (stage ?? "").toLowerCase();
  if (key === "" || key === "applied" || key === "pre_licensed" || key === "meeting_attendance") return 0;
  if (key === "onboarding") return 1;
  if (key === "training_online") return 2;
  if (key === "in_field_training") return 3;
  if (key === "live" || key === "evaluated") return 4;
  return null;
}

export function stageLabel(stage: string | null | undefined): string {
  const key = (stage ?? "").toLowerCase();
  if (!key) return "No stage recorded";
  const named: Record<string, string> = {
    pre_licensed: "Pre-licensed",
    onboarding: "Onboarding",
    training_online: "In course",
    in_field_training: "Field training",
    live: "Live",
    evaluated: "Evaluated",
    need_followup: "Needs follow-up",
    pending_review: "Pending review",
    below_10k: "Below $10K",
    meeting_attendance: "Meeting attendance",
  };
  return named[key] ?? key.replace(/_/g, " ");
}

/** The stage to write when somebody clicks rung N. A hire already sitting at
 *  'evaluated' who is clicked back to rung 4 keeps 'evaluated' rather than
 *  being quietly demoted to 'live' — both are the same rung and overwriting
 *  the more specific one loses information nobody asked to lose. */
export function stageForRank(rank: number, currentStage: string | null | undefined): string | null {
  if (stageRank(currentStage) === rank && currentStage) return currentStage;
  return HIRE_RUNGS.find((rung) => rung.rank === rank)?.stage ?? null;
}
