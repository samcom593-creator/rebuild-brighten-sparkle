// MP-448 — semantics of the check-uncredentialed-pii-response guard.
//
// These assertions exist because the guard's FIRST TWO CUTS were green on the
// exact bug they were written for. check-email-status disclosed agentPhone,
// agentCity and agentState — camelCase keys — while the scan matched only a
// bare `phone:`. A mutation proof caught it, not a reading of the code, so the
// distinction is pinned here rather than left to the next author's judgement.
//
// The three rules being locked down:
//   1. segment equality, never substring — else "state" matches "realEstate"
//   2. boolean minimisation (`has_phone: !!e.phone`) is a FIX, not a violation
//   3. a property READ is the source; only an EMITTED KEY is a disclosure
import { describe, it, expect } from "vitest";
import {
  keyDiscloses,
  segments,
  emittedKeys,
  responseBodies,
} from "../../scripts/check-uncredentialed-pii-response.mjs";

describe("keyDiscloses", () => {
  it("catches the real bug's camelCase keys", () => {
    expect(keyDiscloses("agentPhone")).toBe("phone");
    expect(keyDiscloses("agentCity")).toBe("city");
    expect(keyDiscloses("agentState")).toBe("state");
  });

  it("catches a date of birth in either spelling", () => {
    // Found by writing this test: a FORBIDDEN token of "birthdate" matched no
    // segment of date_of_birth, so a DOB would have sailed through.
    expect(keyDiscloses("date_of_birth")).toBe("birth");
    expect(keyDiscloses("birthDate")).toBe("birth");
  });

  it("does not punish boolean minimisation", () => {
    expect(keyDiscloses("has_phone")).toBeNull();
    expect(keyDiscloses("isPhoneVerified")).toBeNull();
  });

  it("matches whole segments, not substrings", () => {
    expect(keyDiscloses("licenseStatus")).toBeNull();
    expect(keyDiscloses("realEstate")).toBeNull();
    expect(keyDiscloses("estate")).toBeNull();
    expect(keyDiscloses("stateMachine")).toBe("state");
  });

  it("leaves the fields the login flow genuinely needs alone", () => {
    // Named in the function header as a product decision, not silently guarded.
    expect(keyDiscloses("agentEmail")).toBeNull();
    expect(keyDiscloses("firstName")).toBeNull();
  });
});

describe("segments", () => {
  it("splits camel and snake alike", () => {
    expect(segments("agentPhone")).toEqual(["agent", "phone"]);
    expect(segments("date_of_birth")).toEqual(["date", "of", "birth"]);
  });
});

describe("responseBodies", () => {
  it("reads the reply and ignores an outbound payload", () => {
    // The operand that made three functions false positives: they serialize a
    // phone into an SMS request body, never into their answer to the caller.
    const src =
      'await fetch(u,{body:JSON.stringify({phone:p.phone})});' +
      'return new Response(JSON.stringify({ok:true}),{});';
    const bodies = responseBodies(src);
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).not.toContain("p.phone");
  });
});

describe("emittedKeys", () => {
  it("reads keys handed out, not properties read from", () => {
    expect(emittedKeys("{ has_phone: !!e.phone }")).toContain("has_phone");
    expect(emittedKeys("{ has_phone: !!e.phone }")).not.toContain("phone");
  });
});
