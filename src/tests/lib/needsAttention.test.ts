import { describe, expect, it } from "vitest";
import { attentionTotal, buildNeedsAttention } from "@/lib/needsAttention";
import { inQueue, type WorklistRow } from "@/lib/recruitingQueues";

const now = new Date("2026-11-12T18:00:00Z");
const ctx = { now, userId: "sam" };
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000).toISOString();

function row(over: Partial<WorklistRow>): WorklistRow {
  return {
    id: "x", first_name: "Jo", last_name: "Doe", email: "jo@x.com", phone: "6025550100", state: "AZ",
    time_zone: null, time_zone_source: null, license_status: "unlicensed", license_progress: null, status: "new",
    next_step_stage_key: "applied", created_at: daysAgo(3), assigned_agent_id: null, recruiting_owner_user_id: null,
    last_contacted_at: null, last_contact_outcome: null, last_contact_outcome_at: null, last_contact_channel: null,
    next_action: null, next_action_due_at: null, next_action_set_at: null, waiting_reason: null, next_review_at: null,
    next_step_due_at: null, phone_bad_at: null, email_bad_at: null, sms_consent_given: true, email_consent_given: true,
    do_not_contact_at: null, ...over,
  };
}

describe("buildNeedsAttention", () => {
  const rows: WorklistRow[] = [
    row({ id: "late-2d", recruiting_owner_user_id: "sam", last_contact_outcome_at: daysAgo(5), last_contact_outcome: "callback", next_action: "Call back", next_action_set_at: daysAgo(5), next_action_due_at: daysAgo(2) }),
    row({ id: "late-9d", recruiting_owner_user_id: "va", last_contact_outcome_at: daysAgo(10), last_contact_outcome: "callback", next_action: "Call back", next_action_set_at: daysAgo(10), next_action_due_at: daysAgo(9) }),
    row({ id: "fresh-licensed", license_status: "licensed", created_at: daysAgo(1) }),
    row({ id: "fresh-unlicensed", created_at: daysAgo(2) }),
    row({ id: "owned-fresh", recruiting_owner_user_id: "va", created_at: daysAgo(1), last_contact_outcome_at: daysAgo(0.5), last_contact_outcome: "no_answer" }),
    row({ id: "ancient", created_at: daysAgo(200) }),
  ];
  const groups = buildNeedsAttention(rows, ctx);
  const by = Object.fromEntries(groups.map((g) => [g.key, g]));

  it("every group's count is exactly its worklist queue", () => {
    expect(by.overdue.count).toBe(rows.filter((r) => inQueue(r, "overdue", ctx)).length);
    expect(by.new.count).toBe(rows.filter((r) => inQueue(r, "new", ctx)).length);
    expect(by.unassigned.count).toBe(rows.filter((r) => inQueue(r, "unassigned", ctx) && inQueue(r, "likely", ctx)).length);
  });

  it("overdue lists the longest-late first and keeps the step a person set", () => {
    expect(by.overdue.items.map((i) => i.id)).toEqual(["late-9d", "late-2d"]);
    expect(by.overdue.items[0].nextAction).toBe("Call back");
    expect(by.overdue.items[0].ownerUserId).toBe("va");
  });

  it("a new licensed applicant gets the licensed next action; a 200-day-old lead is not attention", () => {
    const licensed = by.new.items.find((i) => i.id === "fresh-licensed");
    expect(licensed?.nextAction).toMatch(/licensed interview/);
    expect(groups.flatMap((g) => g.items).some((i) => i.id === "ancient")).toBe(false);
  });

  it("links open the same queue with that person selected, and the total adds the groups", () => {
    expect(by.overdue.items[0].href).toBe("/dashboard/recruiting?queue=overdue&person=late-9d");
    expect(by.unassigned.href).toBe("/dashboard/recruiting?queue=likely");
    expect(attentionTotal(groups)).toBe(by.overdue.count + by.new.count + by.unassigned.count);
  });

  it("previews are capped; the count is not", () => {
    const many = Array.from({ length: 10 }, (_, i) => row({ id: `n${i}`, created_at: daysAgo(1) }));
    const g = buildNeedsAttention(many, ctx).find((x) => x.key === "new")!;
    expect(g.count).toBe(10);
    expect(g.items).toHaveLength(3);
  });
});
