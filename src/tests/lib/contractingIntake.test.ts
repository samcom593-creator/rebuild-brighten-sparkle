import { describe, it, expect } from "vitest";

import {
  normalizeEmail,
  normalizeNpn,
  normalizePhone,
  validateIntake,
  CONTRACTING_FIELDS,
  DELIVERY_COPY,
} from "@/lib/contractingIntake";

/**
 * These cases are the same ones proved against the live SQL functions in
 * supabase/migrations/20260812140000_apex_contracting_intake.sql. If the two
 * implementations ever disagree, a producer gets a form that accepts input the
 * server then rejects, so the agreement is the thing under test.
 */

describe("contracting intake · field contract", () => {
  it("accepts exactly five fields and never asks for the forbidden ones", () => {
    expect([...CONTRACTING_FIELDS]).toEqual(["first_name", "last_name", "email", "phone", "npn"]);

    // Sam's requirement, encoded: this intake must never grow a PA number, an
    // SSN, a date of birth, banking details, a password or medical questions.
    // If somebody adds one, this fails before it reaches a producer.
    for (const forbidden of ["pa_number", "paNumber", "ssn", "dob", "date_of_birth", "password", "routing_number", "account_number"]) {
      expect(CONTRACTING_FIELDS).not.toContain(forbidden);
    }
  });
});

describe("contracting intake · normalization", () => {
  it("lowercases and trims email", () => {
    expect(normalizeEmail("  JANE.Doe@Example.COM ")).toBe("jane.doe@example.com");
    expect(normalizeEmail("   ")).toBeNull();
  });

  it("reduces an NPN to digits so one producer cannot become three rows", () => {
    expect(normalizeNpn("NPN 21-346-999")).toBe("21346999");
    expect(normalizeNpn(" 21346999 ")).toBe("21346999");
    expect(normalizeNpn("21346999")).toBe("21346999");
    expect(normalizeNpn("abc")).toBeNull();
  });

  it("converts North American numbers to E.164", () => {
    expect(normalizePhone("(602) 555-0143")).toBe("+16025550143");
    expect(normalizePhone("602.555.0143")).toBe("+16025550143");
    expect(normalizePhone("16025550143")).toBe("+16025550143");
    expect(normalizePhone("+1 602 555 0143")).toBe("+16025550143");
  });

  it("returns null instead of guessing at an unreadable number", () => {
    expect(normalizePhone("123")).toBeNull();
    expect(normalizePhone("0025550143")).toBeNull(); // area code cannot start with 0
    expect(normalizePhone("1025550143")).toBeNull(); // or 1
    expect(normalizePhone("+44 20 7946 0958")).toBeNull(); // not NANP
    expect(normalizePhone("")).toBeNull();
  });
});

describe("contracting intake · validation matches the server", () => {
  const good = {
    first_name: "  Jane ",
    last_name: " Doe ",
    email: "  JANE.Doe@Example.COM ",
    phone: "(602) 555-0143",
    npn: "NPN 21-346-999",
  };

  it("normalizes a messy but valid submission the same way the RPC did", () => {
    const result = validateIntake(good);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({
      first_name: "Jane",
      last_name: "Doe",
      email: "jane.doe@example.com",
      phone_e164: "+16025550143",
      npn: "21346999",
    });
  });

  it("names the offending field, matching the RPC's field-specific errors", () => {
    const phone = validateIntake({ ...good, phone: "123" });
    expect(phone.ok).toBe(false);
    if (!phone.ok) expect(phone.errors.map((e) => e.field)).toEqual(["phone"]);

    const npn = validateIntake({ ...good, npn: "abc" });
    expect(npn.ok).toBe(false);
    if (!npn.ok) expect(npn.errors.map((e) => e.field)).toEqual(["npn"]);

    const email = validateIntake({ ...good, email: "not-an-email" });
    expect(email.ok).toBe(false);
    if (!email.ok) expect(email.errors.map((e) => e.field)).toEqual(["email"]);
  });

  it("rejects an NPN outside 5-10 digits, as the column CHECK does", () => {
    expect(validateIntake({ ...good, npn: "1234" }).ok).toBe(false);
    expect(validateIntake({ ...good, npn: "12345678901" }).ok).toBe(false);
    expect(validateIntake({ ...good, npn: "12345" }).ok).toBe(true);
    expect(validateIntake({ ...good, npn: "1234567890" }).ok).toBe(true);
  });

  it("reports every bad field at once rather than one per submit", () => {
    const result = validateIntake({ first_name: "", last_name: "", email: "x", phone: "1", npn: "z" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.map((e) => e.field).sort()).toEqual(
        ["email", "first_name", "last_name", "npn", "phone"].sort(),
      );
    }
  });
});

describe("contracting intake · delivery wording", () => {
  it("never describes a queued destination as sent", () => {
    // The whole point of the outbox is that acceptance is not delivery. If this
    // copy ever says "Sent" for a queued row, the UI is lying about a side
    // effect that has not happened yet.
    expect(DELIVERY_COPY.queued.label).toBe("Queued");
    expect(DELIVERY_COPY.queued.label.toLowerCase()).not.toContain("sent");
    expect(DELIVERY_COPY.queued.tone).not.toBe("ok");
  });

  it("keeps not_configured distinct from both success and failure", () => {
    expect(DELIVERY_COPY.not_configured.label).toBe("Not configured");
    expect(DELIVERY_COPY.not_configured.tone).toBe("muted");
    expect(DELIVERY_COPY.delivered.tone).toBe("ok");
    expect(DELIVERY_COPY.dead_letter.tone).toBe("warn");
  });
});
