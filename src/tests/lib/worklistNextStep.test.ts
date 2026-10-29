import { describe, expect, it } from "vitest";

import type { WorklistRow } from "@/lib/recruitingQueues";
import { STATUS_TONE } from "@/components/recruiting/StatusPill";
import { hasPersonPlan, nextStepActionLabel, nextStepFor, nextStepLine } from "@/components/pipeline/worklist/worklistNextStep";
import { rowStatus } from "@/components/pipeline/worklist/worklistStatus";

// Synthetic fixtures only. 12:00 Phoenix (UTC-7) on 2026-10-06.
const NOW = new Date("2026-10-06T19:00:00.000Z").getTime();
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const iso = (ms: number) => new Date(ms).toISOString();

function row(patch: Partial<WorklistRow> = {}): WorklistRow {
  return {
    id: "app-1", first_name: "Mariah", last_name: "Lindqvist", email: "mariah@example.test", phone: "+16025550123",
    state: "AZ", time_zone: null, time_zone_source: null, license_status: "unlicensed", license_progress: "unlicensed",
    status: "new", next_step_stage_key: "applied", created_at: iso(NOW - 9 * DAY), assigned_agent_id: null,
    recruiting_owner_user_id: null, last_contacted_at: null, last_contact_outcome: null, last_contact_outcome_at: null,
    last_contact_channel: null, next_action: null, next_action_due_at: null, next_action_set_at: null, waiting_reason: null,
    next_review_at: null, next_step_due_at: null, phone_bad_at: null, email_bad_at: null, sms_consent_given: true,
    email_consent_given: true, do_not_contact_at: null, ...patch,
  };
}

/** The automation stamp every application gets: due 72 hours after applying, set by no person. */
const stamped = (patch: Partial<WorklistRow> = {}) =>
  row({ next_action: "MANAGER_CALL_72H_ESCALATION", next_action_due_at: iso(NOW - 6 * DAY), ...patch });

describe("nextStepFor: the one thing to do next, from the record", () => {
  it("never reached: the first call, with how long ago they applied, even under an automation stamp", () => {
    const step = nextStepFor(stamped(), NOW);
    expect(step).toMatchObject({ key: "first_call", title: "First call", channel: "call", planned: false });
    expect(step.detail).toBe("Applied 9 days ago. Nobody has reached them yet.");
    // The internal timer never reaches the words a caller reads.
    expect(`${step.title} ${step.detail}`).not.toMatch(/MANAGER|72H|escalation/i);
  });

  it("the step wears the person's status tone, so the pill, the bubble and the step agree", () => {
    for (const r of [stamped(), row({ created_at: iso(NOW - 2 * HOUR) }), row({ next_action: "Call back", next_action_due_at: iso(NOW + 2 * HOUR), next_action_set_at: iso(NOW - DAY), last_contacted_at: iso(NOW - DAY), last_contact_outcome: "callback", last_contact_outcome_at: iso(NOW - DAY) })]) {
      expect(nextStepFor(r, NOW).tone).toBe(STATUS_TONE[rowStatus(r, NOW).tone]);
    }
    // Late is "act now", new is "new", due today "needs a nudge".
    expect(nextStepFor(stamped(), NOW).tone).toBe("hot");
    expect(nextStepFor(row({ created_at: iso(NOW - 2 * HOUR) }), NOW).tone).toBe("cool");
  });

  it("a step a person set keeps their words and says when it is due: late, today or later", () => {
    const planned = (due: number) => row({
      next_action: "Send the licensing video", next_action_due_at: iso(due), next_action_set_at: iso(NOW - 3 * DAY),
      last_contacted_at: iso(NOW - 3 * DAY), last_contact_outcome: "interested", last_contact_outcome_at: iso(NOW - 3 * DAY),
    });
    const late = nextStepFor(planned(NOW - 26 * HOUR), NOW);
    expect(late).toMatchObject({ key: "planned_late", title: "Send the licensing video", planned: true, tone: "hot", channel: "call" });
    expect(late.detail).toBe("Was due yesterday.");
    const today = nextStepFor(planned(NOW + 3 * HOUR), NOW);
    expect(today).toMatchObject({ key: "planned_today", tone: "warm" });
    expect(today.detail).toMatch(/^Due today at \d{1,2}:\d{2}\s?(AM|PM) [A-Z]{2,5}\.$/);
    const later = nextStepFor(planned(NOW + 4 * DAY), NOW);
    expect(later).toMatchObject({ key: "planned_later", tone: "slate" });
    expect(later.detail).toMatch(/^Not due until /);
    expect(later.detail).not.toMatch(/until Tomorrow/);
  });

  it("a booked interview reads as scheduled", () => {
    const step = nextStepFor(row({
      next_action: "Interview", next_action_due_at: iso(NOW + 2 * DAY), next_action_set_at: iso(NOW - HOUR),
      last_contact_outcome: "appointment_booked", last_contact_outcome_at: iso(NOW - HOUR), last_contacted_at: iso(NOW - HOUR),
    }), NOW);
    expect(step).toMatchObject({ key: "booked", title: "Interview", tone: "cool" });
    expect(step.detail).toMatch(/^Booked for /);
  });

  it("an unreadable follow-up date says so and asks for a new one, never 'not due'", () => {
    const step = nextStepFor(row({ next_action: "Call back", next_action_due_at: "next tuesday", next_action_set_at: iso(NOW - DAY), last_contacted_at: iso(NOW - DAY) }), NOW);
    expect(step).toMatchObject({ key: "fix_date", title: "Set a new date", planned: true, tone: "hot" });
  });

  it("waiting on them: wait until the check-back date, then check in", () => {
    const waiting = (review: number) => row({ waiting_reason: "Sending their NPN", next_review_at: iso(review), next_action_set_at: iso(NOW - 4 * DAY), last_contacted_at: iso(NOW - 4 * DAY), last_contact_outcome: "interested", last_contact_outcome_at: iso(NOW - 4 * DAY) });
    const wait = nextStepFor(waiting(NOW + 3 * DAY), NOW);
    expect(wait).toMatchObject({ key: "waiting", title: "Wait for them", channel: null });
    expect(wait.detail).toMatch(/^Waiting for: Sending their NPN\. Check back /);
    const due = nextStepFor(waiting(NOW - 2 * DAY), NOW);
    expect(due).toMatchObject({ key: "check_in", title: "Check in with them", channel: "call" });
    expect(due.detail).toBe("Waiting for: Sending their NPN. The check-back date was 2 days ago.");
  });

  it("no usable phone: email for a working number, or say there is no way to reach them", () => {
    expect(nextStepFor(row({ phone_bad_at: iso(NOW - DAY) }), NOW)).toMatchObject({ key: "get_working_number", channel: "email", detail: "Their phone number is marked bad." });
    expect(nextStepFor(row({ phone: null }), NOW)).toMatchObject({ key: "get_working_number", detail: "There is no phone number on file." });
    // A number too short to dial builds no Call link, so it is not offered as a call.
    expect(nextStepFor(row({ phone: "555-12" }), NOW)).toMatchObject({ key: "get_working_number", detail: "The phone number on file can't be dialed." });
    const stuck = nextStepFor(row({ phone: null, email_consent_given: false }), NOW);
    expect(stuck).toMatchObject({ key: "no_way_to_reach", title: "No way to reach them", channel: null });
    // A bad phone outranks a planned call: the plan cannot be done by phone.
    expect(nextStepFor(row({ phone_bad_at: iso(NOW - DAY), next_action: "Call back", next_action_due_at: iso(NOW + HOUR), next_action_set_at: iso(NOW - DAY) }), NOW))
      .toMatchObject({ key: "get_working_number", planned: true });
  });

  it("reached before with nothing planned: follow up", () => {
    const step = nextStepFor(stamped({ last_contacted_at: iso(NOW - 21 * DAY) }), NOW);
    expect(step).toMatchObject({ key: "follow_up", title: "Follow up", planned: false });
    expect(step.detail).toBe("Last contact 3 weeks ago. No next step is set.");
  });

  it("closed people have nothing to do and say how it ended", () => {
    expect(nextStepFor(row({ do_not_contact_at: iso(NOW - DAY) }), NOW)).toMatchObject({ key: "do_not_contact", channel: null, tone: "hot" });
    expect(nextStepFor(row({ has_agent: true }), NOW)).toMatchObject({ key: "joined", title: "Already joined", tone: "good" });
    expect(nextStepFor(row({ status: "contracting" }), NOW)).toMatchObject({ key: "joined" });
    expect(nextStepFor(row({ last_contact_outcome: "not_interested", last_contact_outcome_at: iso(NOW - HOUR) }), NOW)).toMatchObject({ key: "said_no", title: "Said no" });
    expect(nextStepFor(row({ status: "rejected" }), NOW)).toMatchObject({ key: "closed", channel: null });
  });

  it("only a person's plan counts as planned: the RPCs stamp next_action_set_at, automation never does", () => {
    expect(hasPersonPlan(stamped())).toBe(false);
    expect(hasPersonPlan(row({ next_action: "Call back", next_action_set_at: iso(NOW) }))).toBe(true);
    expect(hasPersonPlan(row({ waiting_reason: "Reply", next_action_set_at: iso(NOW) }))).toBe(true);
    expect(hasPersonPlan(row({ next_action_set_at: iso(NOW) }))).toBe(false);
  });
});

describe("nextStepLine: what the list row says", () => {
  it("a person's plan keeps 'Next:' and their words; a suggestion never claims 'Next:'", () => {
    const planned = row({ next_action: "Call back", next_action_due_at: iso(NOW - DAY), next_action_set_at: iso(NOW - 2 * DAY), last_contacted_at: iso(NOW - 2 * DAY) });
    expect(nextStepLine(planned, nextStepFor(planned, NOW), NOW)).toBe("Next: Call back");
    const waiting = row({ waiting_reason: "Reply to text", next_review_at: iso(NOW + DAY), next_action_set_at: iso(NOW - DAY), last_contacted_at: iso(NOW - DAY) });
    expect(nextStepLine(waiting, nextStepFor(waiting, NOW), NOW)).toBe("Waiting for: Reply to text");
    const fresh = stamped();
    expect(nextStepLine(fresh, nextStepFor(fresh, NOW), NOW)).toBe("First call · applied 9 days ago");
    const noPhone = row({ phone: null });
    const line = nextStepLine(noPhone, nextStepFor(noPhone, NOW), NOW);
    expect(line).toBe("Email for a working number");
    expect(line).not.toMatch(/^Next:/);
  });

  it("a closed person has no next step on the row", () => {
    const closed = row({ do_not_contact_at: iso(NOW) });
    expect(nextStepLine(closed, nextStepFor(closed, NOW), NOW)).toBeNull();
  });
});

describe("nextStepActionLabel: the gold button's words", () => {
  it("names the verb for the channel and the person's first name", () => {
    expect(nextStepActionLabel(row(), nextStepFor(stamped(), NOW))).toBe("Call Mariah");
    expect(nextStepActionLabel(row(), nextStepFor(row({ phone: null }), NOW))).toBe("Email Mariah");
    const waiting = row({ waiting_reason: "Reply", next_review_at: iso(NOW + DAY), next_action_set_at: iso(NOW) });
    expect(nextStepActionLabel(waiting, nextStepFor(waiting, NOW))).toBe("Open Mariah");
    // No first name on file: the last name, or the verb alone, never "Call undefined".
    expect(nextStepActionLabel(row({ first_name: null }), nextStepFor(stamped(), NOW))).toBe("Call Lindqvist");
    expect(nextStepActionLabel(row({ first_name: "  ", last_name: null }), nextStepFor(stamped(), NOW))).toBe("Call");
  });
});
