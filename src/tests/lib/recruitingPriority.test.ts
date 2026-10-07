import { describe, expect, it } from "vitest";
import { inQueue, sortForQueue, type WorklistRow } from "@/lib/recruitingQueues";

const NOW = new Date("2026-10-06T18:00:00Z");
const ctx = { now: NOW, userId: "me" };
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();
const row = (id: string, ageDays: number, extra: Partial<WorklistRow> = {}): WorklistRow =>
  ({ id, first_name: id, last_name: null, email: `${id}@x.com`, phone: "5551234567", state: "AZ", time_zone: null, time_zone_source: null,
     license_status: "unlicensed", license_progress: null, status: "new", next_step_stage_key: null, created_at: daysAgo(ageDays),
     assigned_agent_id: null, recruiting_owner_user_id: null, last_contacted_at: null, last_contact_outcome: null, last_contact_outcome_at: null,
     last_contact_channel: null, next_action: null, next_action_due_at: null, next_action_set_at: null, waiting_reason: null, next_review_at: null,
     next_step_due_at: null, phone_bad_at: null, email_bad_at: null, sms_consent_given: null, email_consent_given: null, do_not_contact_at: null,
     ...extra }) as WorklistRow;

describe("Likely to join / Older than 90 days (conversion-history priority)", () => {
  it("licensed or hot/warm within 47 days, or anyone within 14 days, is likely", () => {
    expect(inQueue(row("lic", 30, { license_status: "licensed" }), "likely", ctx)).toBe(true);
    expect(inQueue(row("warm", 40, { ai_score_tier: "warm" }), "likely", ctx)).toBe(true);
    expect(inQueue(row("fresh", 5), "likely", ctx)).toBe(true);
    expect(inQueue(row("cold20", 20), "likely", ctx)).toBe(false);
    expect(inQueue(row("lic60", 60, { license_status: "licensed" }), "likely", ctx)).toBe(false);
  });
  it("90+ days with no hand-set follow-up leaves every queue except old and mine", () => {
    const stale = row("stale", 120, { recruiting_owner_user_id: "me" });
    expect(inQueue(stale, "old", ctx)).toBe(true);
    expect(inQueue(stale, "all_open", ctx)).toBe(false);
    expect(inQueue(stale, "uncontacted", ctx)).toBe(false);
    expect(inQueue(stale, "mine", ctx)).toBe(true);
  });
  it("an old applicant with a follow-up someone set stays in the working queues", () => {
    const planned = row("planned", 120, { next_action: "Call", next_action_due_at: daysAgo(1) });
    expect(inQueue(planned, "old", ctx)).toBe(false);
    expect(inQueue(planned, "all_open", ctx)).toBe(true);
    expect(inQueue(planned, "overdue", ctx)).toBe(true);
  });
  it("likely is ranked licensed/hot/warm first, then newest", () => {
    const out = sortForQueue([row("new-unlic", 2), row("lic-old", 30, { license_status: "licensed" }), row("hot", 10, { ai_score_tier: "hot" })], "likely");
    expect(out.map((r) => r.id)).toEqual(["hot", "lic-old", "new-unlic"]);
  });
});
