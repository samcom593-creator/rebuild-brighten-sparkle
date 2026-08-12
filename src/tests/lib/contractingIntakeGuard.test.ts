import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

// The same module the public edge function runs.
import {
  ACCEPTED_FIELDS,
  FORBIDDEN_FIELDS,
  pickAcceptedFields,
  honeypotResponseBody,
  isHoneypotTripped,
  rateLimitVerdict,
} from "../../../supabase/functions/_shared/intake-guard.ts";

const REPO = path.resolve(__dirname, "../../..");

describe("public intake · field allowlist", () => {
  it("copies only the five accepted fields", () => {
    const picked = pickAcceptedFields({
      first_name: "Jane", last_name: "Doe", email: "j@d.co", phone: "6025550143", npn: "12345",
      ssn: "123-45-6789", pa_number: "PA1", password: "hunter2", dob: "1990-01-01",
    });
    expect(Object.keys(picked).sort()).toEqual([...ACCEPTED_FIELDS].sort());
    expect(JSON.stringify(picked)).not.toContain("123-45-6789");
    expect(JSON.stringify(picked)).not.toContain("hunter2");
  });

  it("is an allowlist, so an unanticipated field name cannot get through", () => {
    // A denylist has to predict every name an attacker might send, and it only
    // takes one it did not predict.
    const picked = pickAcceptedFields({ totally_novel_field: "x", first_name: "Jane" } as never);
    expect(Object.keys(picked)).toEqual([...ACCEPTED_FIELDS]);
  });

  it("coerces non-strings to empty rather than passing objects to the RPC", () => {
    const picked = pickAcceptedFields({ first_name: { $ne: null }, npn: 12345 } as never);
    expect(picked.first_name).toBe("");
    expect(picked.npn).toBe("");
  });

  it("truncates absurd input instead of forwarding it", () => {
    const picked = pickAcceptedFields({ first_name: "a".repeat(10_000) });
    expect(picked.first_name).toHaveLength(300);
  });

  it("never accepts a field this intake must not collect", () => {
    for (const forbidden of FORBIDDEN_FIELDS) {
      expect(ACCEPTED_FIELDS as readonly string[]).not.toContain(forbidden);
    }
  });
});

describe("public intake · honeypot", () => {
  it("trips on any content in the hidden field", () => {
    expect(isHoneypotTripped({ company_website: "http://spam" })).toBe(true);
    expect(isHoneypotTripped({ company_website: "   x  " })).toBe(true);
  });

  it("does not trip on an untouched or absent field", () => {
    expect(isHoneypotTripped({ company_website: "" })).toBe(false);
    expect(isHoneypotTripped({ company_website: "   " })).toBe(false);
    expect(isHoneypotTripped({})).toBe(false);
  });

  it("does not claim an intake was accepted", () => {
    // Behavioural, not a source grep: this is the exact body the edge function
    // returns. Saying "accepted" would make the client show a success screen
    // and an AgentLink continuation for a row that does not exist.
    const body = honeypotResponseBody();
    expect(body.status).toBe("discarded");
    expect(body.status).not.toBe("accepted");
    expect(body.intake_id).toBeNull();
    expect(body.delivery).toBe("none");
  });

  it("offers nothing a client could mistake for a continuation", () => {
    expect(honeypotResponseBody()).not.toHaveProperty("continue_url");
  });
});

describe("public intake · rate limiting fails closed", () => {
  it("allows a request the limiter approved", () => {
    expect(rateLimitVerdict({ allowed: true, error: null })).toBe("allow");
  });

  it("rejects a request the limiter denied", () => {
    expect(rateLimitVerdict({ allowed: false, error: null })).toBe("reject_rate_limited");
  });

  it("REJECTS when the limiter itself is broken", () => {
    // The whole point. Whatever breaks the limiter is precisely when someone is
    // hammering it. "Allow everything while the brake is broken" turns a public
    // unauthenticated write endpoint into a spam sink, and NPN dedupe does not
    // save us because an attacker picks a fresh NPN per request.
    expect(rateLimitVerdict({ allowed: true, error: new Error("db down") })).toBe("reject_unavailable");
    expect(rateLimitVerdict({ allowed: undefined, error: { message: "timeout" } })).toBe("reject_unavailable");
  });

  it("treats an error as decisive even when allowed says true", () => {
    expect(rateLimitVerdict({ allowed: true, error: { message: "x" } })).not.toBe("allow");
  });
});

describe("public intake · edge configuration", () => {
  const config = fs.readFileSync(path.join(REPO, "supabase/config.toml"), "utf8");

  it("is registered in config.toml, or the deploy pipeline never ships it", () => {
    // A function missing its stanza silently 404s forever.
    expect(config).toMatch(/\[functions\.submit-contracting-intake\]/);
  });

  it("is declared public, because producers have no APEX login", () => {
    const block = config.slice(config.indexOf("[functions.submit-contracting-intake]"));
    expect(block.slice(0, 200)).toMatch(/verify_jwt\s*=\s*false/);
  });

  // NOTE: the edge-function contract ratchet (scripts/check-function-contracts.mjs)
  // belongs to a separate in-flight change and is deliberately NOT part of this
  // release, so nothing here asserts against it. Asserting on a file this commit
  // does not ship would pass locally and fail on a clean checkout.
});
