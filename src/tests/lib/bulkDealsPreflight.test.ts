/**
 * bulkDealsPreflight.test.ts: the Bulk Deal Import page must refuse, before any
 * request is sent, exactly the rows the database's deal coverage guard would
 * refuse after the click. Three things are pinned here:
 *
 *  1. The normalisers mirror public.deal_coverage_phone / deal_coverage_name.
 *  2. preflightDeal() blocks the two sentinels the page used to write
 *     (client_phone '' and client_dob 1900-01-01) and every other guard rule.
 *  3. The SQL fragments the mirror copies are still in the migration, and
 *     src/pages/BulkDeals.tsx no longer carries the sentinels and gates its
 *     insert on the preflight verdict.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  COVERAGE_PHONE_MIN_DIGITS,
  MAX_INSURED_AGE_YEARS,
  normalizeCoverageName,
  normalizeCoveragePhone,
  preflightDeal,
  splitClientName,
  type PreflightInput,
} from "@/lib/bulkDealsPreflight";

const root = path.resolve(__dirname, "../../..");
const read = (relative: string) => fs.readFileSync(path.join(root, relative), "utf8");
const squash = (s: string) => s.replace(/\s+/g, " ");

const TODAY = new Date(2026, 10, 27); // 2026-11-27 local

const complete: PreflightInput = {
  client: "Marisol Tovar",
  carrier: "Mutual of Omaha",
  agentName: "Xaviar Watts",
  agentId: "agent-1",
  carrierId: "carrier-1",
  dob: "1961-04-09",
  phone: "(602) 555-0142",
};

describe("normalizeCoveragePhone mirrors public.deal_coverage_phone", () => {
  it("keeps digits only", () => {
    expect(normalizeCoveragePhone("(602) 555-0142")).toBe("6025550142");
    expect(normalizeCoveragePhone("602.555.0142")).toBe("6025550142");
  });
  it("drops a leading country code 1 from an 11-digit number only", () => {
    expect(normalizeCoveragePhone("+1 602 555 0142")).toBe("6025550142");
    expect(normalizeCoveragePhone("26025550142")).toBe("26025550142");
    expect(normalizeCoveragePhone("1602555014")).toBe("1602555014");
  });
  it("treats blank, null and undefined as empty", () => {
    expect(normalizeCoveragePhone("")).toBe("");
    expect(normalizeCoveragePhone(null)).toBe("");
    expect(normalizeCoveragePhone(undefined)).toBe("");
  });
});

describe("normalizeCoverageName mirrors public.deal_coverage_name", () => {
  it("lower-cases, trims and collapses inner whitespace", () => {
    expect(normalizeCoverageName("  Jane ", " De  La Cruz ")).toBe("jane de la cruz");
    expect(normalizeCoverageName(null, "Doe")).toBe("doe");
  });
});

describe("splitClientName", () => {
  it("first word is the first name, the rest the last name", () => {
    expect(splitClientName("Jane De La Cruz")).toEqual({ first: "Jane", last: "De La Cruz" });
    expect(splitClientName("  Jane   Doe ")).toEqual({ first: "Jane", last: "Doe" });
  });
  it("a single word has no last name", () => {
    expect(splitClientName("Madonna")).toEqual({ first: "Madonna", last: "" });
  });
});

describe("preflightDeal grades a row the way the guard will", () => {
  it("passes a complete row and reports what will be stored", () => {
    const r = preflightDeal(complete, TODAY);
    expect(r.ok).toBe(true);
    expect(r.blockers).toEqual([]);
    expect(r.reasons).toEqual([]);
    expect(r).toMatchObject({ first: "Marisol", last: "Tovar", normalizedPhone: "6025550142" });
  });

  it("blocks the two sentinels the page used to write", () => {
    const r = preflightDeal({ ...complete, dob: "1900-01-01", phone: "" }, TODAY);
    expect(r.ok).toBe(false);
    expect(r.blockers).toEqual(["dob_placeholder", "phone_short"]);
    expect(r.reasons[0]).toContain(`${MAX_INSURED_AGE_YEARS} years`);
    expect(r.reasons[1]).toContain(`${COVERAGE_PHONE_MIN_DIGITS} digits`);
  });

  it("blocks a missing or unmatched agent and carrier up front", () => {
    expect(preflightDeal({ ...complete, agentId: null }, TODAY).blockers).toEqual(["agent_not_found"]);
    expect(preflightDeal({ ...complete, carrierId: null }, TODAY).blockers).toEqual(["carrier_not_found"]);
    const r = preflightDeal({ ...complete, carrierId: null }, TODAY);
    expect(r.reasons[0]).toContain("Mutual of Omaha");
  });

  it("blocks a one-word insured name (the guard needs first and last)", () => {
    const r = preflightDeal({ ...complete, client: "Madonna" }, TODAY);
    expect(r.blockers).toEqual(["last_name_missing"]);
  });

  it("blocks a missing, malformed, impossible, future or same-day DOB", () => {
    expect(preflightDeal({ ...complete, dob: "" }, TODAY).blockers).toEqual(["dob_missing"]);
    expect(preflightDeal({ ...complete, dob: "04/09/1961" }, TODAY).blockers).toEqual(["dob_invalid"]);
    expect(preflightDeal({ ...complete, dob: "1961-02-30" }, TODAY).blockers).toEqual(["dob_invalid"]);
    expect(preflightDeal({ ...complete, dob: "2026-11-27" }, TODAY).blockers).toEqual(["dob_not_before_today"]);
    expect(preflightDeal({ ...complete, dob: "2027-01-01" }, TODAY).blockers).toEqual(["dob_not_before_today"]);
    expect(preflightDeal({ ...complete, dob: "2026-11-26" }, TODAY).ok).toBe(true);
  });

  it("placeholder boundary sits at exactly MAX_INSURED_AGE_YEARS", () => {
    expect(preflightDeal({ ...complete, dob: "1901-11-27" }, TODAY).blockers).toEqual(["dob_placeholder"]);
    expect(preflightDeal({ ...complete, dob: "1901-11-28" }, TODAY).ok).toBe(true);
  });

  it("phone must normalise to 10 digits; a leading 1 does not count", () => {
    expect(preflightDeal({ ...complete, phone: "602-555-014" }, TODAY).blockers).toEqual(["phone_short"]);
    expect(preflightDeal({ ...complete, phone: "1602555014" }, TODAY).ok).toBe(true); // 10 digits, no leading-1 strip
    expect(preflightDeal({ ...complete, phone: "+1 (602) 555-0142" }, TODAY).normalizedPhone).toBe("6025550142");
  });

  it("reports every blocker in guard order, not just the first", () => {
    const r = preflightDeal({ client: "Cher", carrier: "Nope", agentName: "Nobody", agentId: null, carrierId: null, dob: "", phone: "" }, TODAY);
    expect(r.blockers).toEqual(["agent_not_found", "carrier_not_found", "last_name_missing", "dob_missing", "phone_short"]);
    expect(r.reasons).toHaveLength(5);
  });
});

describe("the mirror and the migration cannot drift silently", () => {
  const sql = squash(read("supabase/migrations/20261127050000_deal_coverage_review.sql"));

  it("deal_coverage_phone still strips non-digits and a leading 1 from 11 digits", () => {
    expect(sql).toContain("regexp_replace(coalesce(p_phone,''),'[^0-9]','','g')");
    expect(sql).toContain("length(d)=11 and left(d,1)='1'");
  });

  it("enforce_deal_coverage_review still tests the five fields this module mirrors", () => {
    expect(sql).toContain("new.carrier_id is null or new.client_dob is null or new.client_dob>=current_date");
    expect(sql).toContain("nullif(btrim(new.client_first_name),'') is null");
    expect(sql).toContain("nullif(btrim(new.client_last_name),'') is null");
    expect(sql).toContain(`length(public.deal_coverage_phone(new.client_phone))<${COVERAGE_PHONE_MIN_DIGITS}`);
  });
});

describe("src/pages/BulkDeals.tsx runs the preflight and no longer writes sentinels", () => {
  const page = read("src/pages/BulkDeals.tsx");
  // Code lines only. The page's own comments name the retired sentinels to
  // explain the fix, and a guard that matches its own footnote measures nothing
  // (the 2026-08-12 ratchet that counted ".maybeSingle()" inside comments).
  const code = page
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      return !(t.startsWith("//") || t.startsWith("*") || t.startsWith("/*"));
    })
    .join("\n");

  it("imports and calls preflightDeal", () => {
    expect(code).toContain('from "@/lib/bulkDealsPreflight"');
    expect(code).toContain("preflightDeal(");
  });

  it("carries no placeholder DOB or blank phone in code", () => {
    expect(code).not.toMatch(/1900-01-01/);
    expect(code).not.toMatch(/client_phone:\s*""/);
    // and the assertion is not vacuous: the sentinel IS still named in a comment
    expect(page).toMatch(/1900-01-01/);
  });

  it("only sends rows the preflight passed", () => {
    expect(code).toContain("rows.filter((r) => r.pre.ok)");
    expect(code).toContain("for (const r of ready)");
  });

  it("gives every row a date-of-birth and a phone field", () => {
    expect(code).toContain('type="date"');
    expect(code).toContain('type="tel"');
  });
});
