/**
 * APEX Next Best Action — deterministic playbook per record.
 * Never invents data, never fakes counts. Signal absent = safe fallback.
 */

import type { PriorityInput, PriorityLabel } from './priority';

export interface NextBestAction {
  action: string;
  reason: string;
  cta: string;
  priority: PriorityLabel;
}

export interface NBAInput extends PriorityInput {
  days_stale?: number | null;
  last_contact?: string | null;
  cohort?: string | null;
  license_progress?: string | null;
  license_status?: string | null;
  score?: number | null;
  applicant_name?: string;
}

const FALLBACK: NextBestAction = {
  action: 'Review record',
  reason: 'No specific signal detected',
  cta: 'Open drawer',
  priority: 'low',
};

const SUPPRESSED: NextBestAction = {
  action: 'No action',
  reason: 'Rejected or suppressed',
  cta: '',
  priority: 'suppressed',
};

/** Applicant lane — order matters: strongest terminal signal wins. */
function applicantNBA(input: NBAInput): NextBestAction {
  if (input.rejected || input.suppressed) return SUPPRESSED;

  if (input.passed_test) {
    return {
      action: 'Move to License Push',
      reason: 'Applicant passed exam',
      cta: 'Advance to License Push',
      priority: 'critical',
    };
  }

  if (input.is_new_applicant && input.no_contact_logged) {
    return {
      action: 'Call new applicant',
      reason: 'New applicant with no logged contact',
      cta: 'Call now',
      priority: 'critical',
    };
  }

  if (input.is_new_applicant) {
    return {
      action: 'Call new applicant',
      reason: 'New applicant with no logged contact',
      cta: 'Call now',
      priority: 'critical',
    };
  }

  if (input.interview_scheduled) {
    return {
      action: 'Confirm interview',
      reason: 'Interview scheduled — reduce no-shows',
      cta: 'Confirm interview',
      priority: 'hot',
    };
  }

  if (input.finished_course) {
    return {
      action: 'Push exam scheduling',
      reason: 'Course complete but no exam scheduled',
      cta: 'Schedule exam',
      priority: 'hot',
    };
  }

  if (input.course_bought) {
    return {
      action: 'Push course start',
      reason: 'Course purchased but not started',
      cta: 'Push course start',
      priority: 'hot',
    };
  }

  if (input.duplicate_needs_review) {
    return {
      action: 'Review duplicate',
      reason: 'Possible duplicate record',
      cta: 'Review duplicate',
      priority: 'watch',
    };
  }

  // No-answer inferred from stale contact without stronger signals
  if (
    input.follow_up_due_today ||
    (typeof input.days_stale === 'number' && input.days_stale >= 2)
  ) {
    return {
      action: 'Text follow-up',
      reason: 'Last attempt was a no-answer',
      cta: 'Send text',
      priority: 'today',
    };
  }

  return FALLBACK;
}

/** Unlicensed lane — cohort code first, then boolean signals. */
function unlicensedNBA(input: NBAInput): NextBestAction {
  if (input.suppressed) return SUPPRESSED;

  const cohort = input.cohort ?? '';

  if (cohort === 'A_WAITING_ON_LICENSE' || input.waiting_on_license) {
    return {
      action: 'Confirm state issuance / license number',
      reason: 'Applicant is waiting on state license issuance',
      cta: 'Confirm license number',
      priority: 'critical',
    };
  }

  if (cohort === 'B_PASSED_TEST_NO_LIC_YET' || input.passed_test) {
    return {
      action: 'Confirm license progress',
      reason: 'Passed exam, license not yet issued',
      cta: 'Confirm license progress',
      priority: 'critical',
    };
  }

  if (cohort === 'C_TEST_SCHEDULED' || input.test_scheduled) {
    return {
      action: 'Confirm exam date and send reminder',
      reason: 'Exam scheduled — reduce no-shows',
      cta: 'Confirm exam date',
      priority: 'hot',
    };
  }

  if (cohort === 'D_FINISHED_COURSE_NO_EXAM' || input.finished_course) {
    return {
      action: 'Push exam scheduling',
      reason: 'Course complete but exam not scheduled',
      cta: 'Schedule exam',
      priority: 'hot',
    };
  }

  if (cohort === 'E_BOUGHT_NEVER_STARTED' || input.bought_never_started) {
    return {
      action: 'Restart course activation',
      reason: 'Course bought but never started',
      cta: 'Restart activation',
      priority: 'today',
    };
  }

  if (cohort === 'F_COURSE_IN_PROGRESS' || input.course_in_progress) {
    return {
      action: 'Push course completion',
      reason: 'Course in progress — keep momentum',
      cta: 'Push course completion',
      priority: 'today',
    };
  }

  if (
    cohort === 'G_UNLICENSED_STARTER' ||
    input.ghosted_30_plus ||
    input.unlicensed_stale
  ) {
    return {
      action: 'Recovery attempt or suppress',
      reason: 'Unlicensed starter, no forward motion',
      cta: 'Recover or suppress',
      priority: 'watch',
    };
  }

  return FALLBACK;
}

/** License Push lane — same signals as unlicensed but framed for advancement. */
function licensePushNBA(input: NBAInput): NextBestAction {
  if (input.suppressed) return SUPPRESSED;

  if (input.passed_test || input.waiting_on_license) {
    return {
      action: 'Confirm license progress',
      reason: 'Passed exam or awaiting license issuance',
      cta: 'Confirm license progress',
      priority: 'critical',
    };
  }

  if (input.test_scheduled) {
    return {
      action: 'Confirm exam date and send reminder',
      reason: 'Exam scheduled — reduce no-shows',
      cta: 'Confirm exam date',
      priority: 'hot',
    };
  }

  if (input.finished_course) {
    return {
      action: 'Push exam scheduling',
      reason: 'Course complete but exam not scheduled',
      cta: 'Schedule exam',
      priority: 'hot',
    };
  }

  if (input.course_in_progress) {
    return {
      action: 'Push course completion',
      reason: 'Course in progress — keep momentum',
      cta: 'Push course completion',
      priority: 'today',
    };
  }

  if (input.bought_never_started) {
    return {
      action: 'Restart course activation',
      reason: 'Course bought but never started',
      cta: 'Restart activation',
      priority: 'today',
    };
  }

  if (input.unlicensed_stale) {
    return {
      action: 'Recovery attempt or suppress',
      reason: 'Unlicensed stale — decide recovery vs suppress',
      cta: 'Recover or suppress',
      priority: 'watch',
    };
  }

  return FALLBACK;
}

/** Producer risk lane — highest-cost signals win. */
function producerRiskNBA(input: NBAInput): NextBestAction {
  if (input.recovered) {
    return {
      action: 'Mark stable / remove alert',
      reason: 'Producer recovered',
      cta: 'Mark stable',
      priority: 'low',
    };
  }

  if (input.dropped_3_weeks) {
    return {
      action: 'Schedule manager coaching call today',
      reason: 'Production dropped 3 weeks running',
      cta: 'Schedule coaching call',
      priority: 'critical',
    };
  }

  if (input.never_activated_60_days) {
    return {
      action: 'AgentLink check + first-deal push',
      reason: 'Licensed 60+ days with no activation',
      cta: 'AgentLink check',
      priority: 'critical',
    };
  }

  if (input.no_alp_30_days) {
    return {
      action: 'Reactivation call or archive decision',
      reason: 'No ALP for 30+ days',
      cta: 'Reactivate or archive',
      priority: 'hot',
    };
  }

  if (input.no_agentlink) {
    return {
      action: 'Fix AgentLink before production tracking breaks',
      reason: 'AgentLink missing — production invisible',
      cta: 'Fix AgentLink',
      priority: 'hot',
    };
  }

  if (input.down_this_week) {
    return {
      action: 'Reactivation call or archive decision',
      reason: 'Production down this week',
      cta: 'Call producer',
      priority: 'today',
    };
  }

  if (input.no_recent_contact) {
    return {
      action: 'Reactivation call or archive decision',
      reason: 'No recent contact logged',
      cta: 'Log contact',
      priority: 'watch',
    };
  }

  return FALLBACK;
}

/** Route to the correct lane. Never invents data. */
export function getNextBestAction(input: NBAInput): NextBestAction {
  switch (input.kind) {
    case 'applicant':
      return applicantNBA(input);
    case 'unlicensed':
      return unlicensedNBA(input);
    case 'license_push':
      return licensePushNBA(input);
    case 'producer_risk':
      return producerRiskNBA(input);
    default:
      return FALLBACK;
  }
}
