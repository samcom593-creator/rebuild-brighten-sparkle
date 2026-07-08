/**
 * APEX priority scoring — deterministic, signal-driven, never invents data.
 * Consumed by Applicants, Unlicensed, License Push, and Producer Risk lanes.
 */

import { tone, type ToneKind } from './apexTokens';

export type PriorityLabel =
  | 'critical'
  | 'hot'
  | 'today'
  | 'watch'
  | 'low'
  | 'suppressed';

export interface PriorityInput {
  kind: 'applicant' | 'unlicensed' | 'license_push' | 'producer_risk';

  // Applicant signals
  is_new_applicant?: boolean;
  is_hot_lead?: boolean;
  follow_up_due_today?: boolean;
  no_contact_logged?: boolean;
  course_bought?: boolean;
  interview_scheduled?: boolean;
  duplicate_needs_review?: boolean;
  referred_by_active_producer?: boolean;
  rejected?: boolean;
  suppressed?: boolean;

  // Unlicensed signals
  passed_test?: boolean;
  waiting_on_license?: boolean;
  ghosted_30_plus?: boolean;
  unassigned?: boolean;
  finished_course?: boolean;
  test_scheduled?: boolean;
  course_in_progress?: boolean;

  // Producer risk signals
  dropped_3_weeks?: boolean;
  never_activated_60_days?: boolean;
  no_alp_30_days?: boolean;
  down_this_week?: boolean;
  no_agentlink?: boolean;
  no_recent_contact?: boolean;
  reviewed_this_week?: boolean;
  recovered?: boolean;

  // License-push-only signals (some shared with unlicensed)
  bought_never_started?: boolean;
  unlicensed_stale?: boolean;
}

/**
 * Compute a priority score for a record. Clamped to 0 minimum.
 * Rubric weights are locked to Sam's brief — do not tweak without updating the tests.
 */
export function getPriorityScore(input: PriorityInput): number {
  let score = 0;

  switch (input.kind) {
    case 'applicant':
      if (input.is_new_applicant) score += 50;
      if (input.is_hot_lead) score += 40;
      if (input.follow_up_due_today) score += 35;
      if (input.no_contact_logged) score += 30;
      if (input.course_bought) score += 25;
      if (input.interview_scheduled) score += 20;
      if (input.duplicate_needs_review) score += 20;
      if (input.referred_by_active_producer) score += 15;
      if (input.rejected) score -= 40;
      if (input.suppressed) score -= 50;
      break;

    case 'unlicensed':
      if (input.passed_test) score += 60;
      if (input.waiting_on_license) score += 55;
      if (input.ghosted_30_plus) score += 50;
      if (input.unassigned) score += 45;
      if (input.finished_course) score += 35;
      if (input.test_scheduled) score += 30;
      if (input.course_in_progress) score += 25;
      if (input.bought_never_started) score += 20;
      if (input.suppressed) score -= 50;
      break;

    case 'producer_risk':
      if (input.dropped_3_weeks) score += 60;
      if (input.never_activated_60_days) score += 50;
      if (input.no_alp_30_days) score += 45;
      if (input.down_this_week) score += 35;
      if (input.no_agentlink) score += 30;
      if (input.no_recent_contact) score += 25;
      if (input.reviewed_this_week) score -= 30;
      if (input.recovered) score -= 40;
      break;

    case 'license_push':
      if (input.passed_test) score += 60;
      if (input.waiting_on_license) score += 55;
      if (input.test_scheduled) score += 45;
      if (input.finished_course) score += 40;
      if (input.course_in_progress) score += 30;
      if (input.bought_never_started) score += 25;
      if (input.unlicensed_stale) score += 20;
      if (input.suppressed) score -= 50;
      break;
  }

  return Math.max(0, score);
}

/** Map a numeric score (and optional suppressed flag) to a PriorityLabel. */
export function getPriorityLabel(
  score: number,
  suppressed?: boolean,
): PriorityLabel {
  if (suppressed) return 'suppressed';
  if (score >= 90) return 'critical';
  if (score >= 70) return 'hot';
  if (score >= 50) return 'today';
  if (score >= 30) return 'watch';
  return 'low';
}

/** Convert a PriorityLabel to Tailwind className + human-readable text. */
export function priorityBadgeClasses(label: PriorityLabel): {
  className: string;
  text: string;
} {
  const t = tone(label as ToneKind);
  const className = `${t.bg} ${t.text} ${t.border}`;
  const text =
    label === 'critical'
      ? 'Critical'
      : label === 'hot'
        ? 'Hot'
        : label === 'today'
          ? 'Today'
          : label === 'watch'
            ? 'Watch'
            : label === 'suppressed'
              ? 'Suppressed'
              : 'Low';
  return { className, text };
}
