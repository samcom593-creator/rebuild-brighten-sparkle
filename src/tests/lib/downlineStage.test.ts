import { describe, expect, test } from "vitest";
import { downlineStage, STAGE_ORDER } from "@/lib/contractingDownlines";

const row = (o: Record<string, unknown>) => ({ agent_status: "active", npn: "21000001", on_sheet: false, ethos_state: null, ethos_note: null, ...o }) as never;

describe("Grow my team · one plain stage per person (MP-304)", () => {
  test("on the sheet wins over everything", () => expect(downlineStage(row({ on_sheet: true, ethos_state: "manual_review" })).key).toBe("on_sheet"));
  test("no NPN = getting licensed", () => expect(downlineStage(row({ npn: null })).key).toBe("licensing"));
  test("queued or in flight = being added", () => {
    expect(downlineStage(row({ ethos_state: "queued" })).key).toBe("adding");
    expect(downlineStage(row({ ethos_state: "attempting" })).key).toBe("adding");
  });
  test("held carries the reason", () => expect(downlineStage(row({ ethos_state: "manual_review", ethos_note: "email on another NPN" })).hint).toBe("email on another NPN"));
  test("licensed with an NPN and no leg = ready (the one-tap Add row)", () => expect(downlineStage(row({})).key).toBe("ready"));
  test("details saved, no login = login pending", () => expect(downlineStage(row({ agent_status: "intake_only" })).key).toBe("login_pending"));
  test("what needs the manager sorts first", () => expect(STAGE_ORDER.held).toBeLessThan(STAGE_ORDER.on_sheet));
});
