import { describe, expect, it, vi } from "vitest";
import { recordInterviewDisposition, type InterviewDispositionDeps } from "@/lib/interviewDisposition";

function dependencies(overrides: Partial<InterviewDispositionDeps> = {}): InterviewDispositionDeps {
  return {
    load: vi.fn().mockResolvedValue({ id: "interview-1", application_id: "application-1", updated_at: "2026-11-24T12:00:00Z", outcome: null }),
    promote: vi.fn().mockResolvedValue({ agentId: "agent-1", partial: false, message: "Onboarding started" }),
    record: vi.fn().mockResolvedValue({ receipt_id: "receipt-1", can_undo: true }),
    ...overrides,
  };
}

describe("interview outcome and canonical hiring", () => {
  it("creates the canonical hire before recording Hired and never offers account Undo", async () => {
    const order: string[] = [];
    const deps = dependencies({
      promote: vi.fn(async () => { order.push("promote"); return { agentId: "agent-1", partial: false, message: "Onboarding started" }; }),
      record: vi.fn(async () => { order.push("record"); return { receipt_id: "receipt-1", can_undo: true }; }),
    });
    const receipt = await recordInterviewDisposition({ id: "interview-1", outcome: "hired" }, deps);
    expect(order).toEqual(["promote", "record"]);
    expect(receipt.can_undo).toBe(false);
    expect(deps.record).toHaveBeenCalledWith(expect.objectContaining({ p_expected_updated_at: "2026-11-24T12:00:00Z" }));
  });
  it("a failed hire never marks the interview hired", async () => {
    const deps = dependencies({ promote: vi.fn().mockRejectedValue(new Error("NPN required")) });
    await expect(recordInterviewDisposition({ id: "interview-1", outcome: "hired" }, deps)).rejects.toThrow("NPN required");
    expect(deps.record).not.toHaveBeenCalled();
  });
  it("an unlinked prospect cannot create an untracked hire", async () => {
    const deps = dependencies({ load: vi.fn().mockResolvedValue({ id: "interview-1", application_id: null, updated_at: "2026-11-24T12:00:00Z", outcome: null }) });
    await expect(recordInterviewDisposition({ id: "interview-1", outcome: "hired" }, deps)).rejects.toThrow("Link the applicant");
    expect(deps.promote).not.toHaveBeenCalled(); expect(deps.record).not.toHaveBeenCalled();
  });
  it("a concurrently recorded outcome is preserved", async () => {
    const deps = dependencies({ load: vi.fn().mockResolvedValue({ id: "interview-1", application_id: "application-1", updated_at: "2026-11-24T12:01:00Z", outcome: "completed" }) });
    await expect(recordInterviewDisposition({ id: "interview-1", outcome: "no_answer" }, deps)).rejects.toThrow("already has an outcome");
    expect(deps.record).not.toHaveBeenCalled();
  });
  it("callbacks require a future deadline and preserve it in the atomic write", async () => {
    const deps = dependencies();
    await expect(recordInterviewDisposition({ id: "interview-1", outcome: "callback" }, deps)).rejects.toThrow("future callback");
    expect(deps.load).not.toHaveBeenCalled();
    const due = new Date(Date.now() + 86_400_000).toISOString();
    await recordInterviewDisposition({ id: "interview-1", outcome: "callback", followupDueAt: due }, deps);
    expect(deps.record).toHaveBeenCalledWith(expect.objectContaining({ p_followup_due_at: due, p_outcome: "callback" }));
  });
  it("a receipt failure after provision reports the existing account instead of promising rollback", async () => {
    const deps = dependencies({ record: vi.fn().mockRejectedValue(new Error("Interview changed")) });
    await expect(recordInterviewDisposition({ id: "interview-1", outcome: "hired" }, deps)).rejects.toThrow("agent account exists");
    expect(deps.promote).toHaveBeenCalledTimes(1);
  });
});
