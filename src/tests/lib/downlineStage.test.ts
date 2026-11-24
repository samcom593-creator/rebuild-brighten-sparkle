import { describe, expect, test } from "vitest";
import { downlineStage, STAGE_ORDER } from "@/lib/contractingDownlines";

const row = (o: Record<string, unknown>) => ({ agent_status: "active", npn: "21000001", on_sheet: false, ethos_state: null, ethos_note: null, ...o }) as never;

describe("Grow my team · one plain stage per person (MP-304)", () => {
  test("a current delivery hold stays visible even when an older sheet row exists", () => expect(downlineStage(row({ on_sheet: true, ethos_state: "manual_review" })).key).toBe("held"));
  test("a sheet receipt is pending carrier confirmation, never an approval", () => {
    const stage = downlineStage(row({ on_sheet: true, ethos_state: "delivered" }));
    expect(stage.key).toBe("on_sheet");
    expect(stage.tone).toBe("pending");
    expect(stage.hint).toContain("Carrier approval still needs its own confirmation");
  });
  test("failed and unconfigured submissions cannot appear ready for a duplicate retry", () => {
    expect(downlineStage(row({ ethos_state: "failed" })).key).toBe("held");
    expect(downlineStage(row({ ethos_state: "not_configured" })).key).toBe("held");
  });
  test("no NPN = getting licensed", () => expect(downlineStage(row({ npn: null })).key).toBe("licensing"));
  test("queued or in flight = being added", () => {
    expect(downlineStage(row({ ethos_state: "queued" })).key).toBe("adding");
    expect(downlineStage(row({ ethos_state: "attempting" })).key).toBe("adding");
  });
  test("held carries the reason", () => expect(downlineStage(row({ ethos_state: "manual_review", ethos_note: "email on another NPN" })).hint).toBe("email on another NPN"));
  test("an NPN alone requests a license review instead of claiming verified eligibility", () => {
    expect(downlineStage(row({})).key).toBe("ready");
    expect(downlineStage(row({})).hint).toContain("An NPN alone does not verify eligibility");
  });
  test("details saved, no login = login pending", () => expect(downlineStage(row({ agent_status: "intake_only" })).key).toBe("login_pending"));
  test("what needs the manager sorts first", () => expect(STAGE_ORDER.held).toBeLessThan(STAGE_ORDER.on_sheet));
});
