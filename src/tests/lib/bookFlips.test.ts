import { describe, expect, it } from "vitest";
import {
  isCallbackDue, matchesBook, matchesFlip, matchesSearch, monthsInForceText, sortPolicies, splitName,
  type BookPolicy,
} from "@/lib/bookFlips";

const base = (o: Partial<BookPolicy>): BookPolicy => ({
  flip_key: "k", carrier: "Combined", policy_number: "P1", client_key: "a", product: null, book_status: "Unknown",
  is_dead: false, is_book_active: false, status_group: "unknown", client_name: "Ann Lee", client_first_name: null,
  client_last_name: null, phone: "(602) 555-0101", phone_source: "client_record", dob: null, age_years: null, state: null,
  city: null, do_not_call: false, best_time_to_call: null, face_amount: null, monthly_premium: null, annual_premium: null,
  effective_date: null, months_in_force: null, agent_name: null, agent_gone: false, clients_on_number: 1,
  flip_status: "to_call", attempts: 0, last_contact_at: null, callback_at: null, notes: null,
  resold_policy_number: null, resold_carrier: null, resold_annual_premium: null, ...o,
});
const now = new Date("2026-10-07T16:00:00Z");

describe("book flip rules", () => {
  it("workable hides only policies that are not in force", () => {
    expect(matchesBook(base({ status_group: "unknown" }), "workable")).toBe(true);
    expect(matchesBook(base({ status_group: "lapsing" }), "workable")).toBe(true);
    expect(matchesBook(base({ status_group: "dead" }), "workable")).toBe(false);
    expect(matchesBook(base({ status_group: "dead" }), "all")).toBe(true);
  });

  it("to call = open, no answer, or a callback that is due, never do-not-call", () => {
    expect(matchesFlip(base({ flip_status: "to_call" }), "to_call", now)).toBe(true);
    expect(matchesFlip(base({ flip_status: "no_answer" }), "to_call", now)).toBe(true);
    expect(matchesFlip(base({ flip_status: "callback", callback_at: "2026-10-07T15:00:00Z" }), "to_call", now)).toBe(true);
    expect(matchesFlip(base({ flip_status: "callback", callback_at: "2026-10-07T18:00:00Z" }), "to_call", now)).toBe(false);
    expect(matchesFlip(base({ flip_status: "to_call", do_not_call: true }), "to_call", now)).toBe(false);
    expect(matchesFlip(base({ flip_status: "bad_number" }), "closed", now)).toBe(true);
    expect(isCallbackDue(base({ flip_status: "callback", callback_at: null }), now)).toBe(false);
  });

  it("search finds name, policy number, and phone digits", () => {
    const p = base({});
    expect(matchesSearch(p, "ann")).toBe(true);
    expect(matchesSearch(p, "p1")).toBe(true);
    expect(matchesSearch(p, "555-01")).toBe(true);
    expect(matchesSearch(p, "12")).toBe(false);
  });

  it("sorts longest in force first with empty values last, and is stable by name", () => {
    const list = [
      base({ flip_key: "a", client_name: "Zed", months_in_force: 3 }),
      base({ flip_key: "b", client_name: "Amy", months_in_force: null }),
      base({ flip_key: "c", client_name: "Bob", months_in_force: 9 }),
      base({ flip_key: "d", client_name: "Al", months_in_force: 9 }),
    ];
    expect(sortPolicies(list, "oldest").map((p) => p.flip_key)).toEqual(["d", "c", "a", "b"]);
    expect(sortPolicies(list, "name").map((p) => p.client_name)).toEqual(["Al", "Amy", "Bob", "Zed"]);
  });

  it("months in force and name splitting", () => {
    expect(monthsInForceText(14)).toBe("1 yr 2 mo in force");
    expect(monthsInForceText(0)).toBe("under 1 mo in force");
    expect(splitName(base({ client_name: "Mary Ann Smith" }))).toEqual({ firstName: "Mary", lastName: "Ann Smith" });
  });
});

describe("display names", () => {
  it("capitalizes all-lowercase or all-caps names and leaves mixed case alone", async () => {
    const { displayName } = await import("@/lib/bookFlips");
    expect(displayName("dianna walker")).toBe("Dianna Walker");
    expect(displayName("JEFF  HEFTY")).toBe("Jeff Hefty");
    expect(displayName("mary-jo o'neil")).toBe("Mary-Jo O'Neil");
    expect(displayName("Samuel lugo puga")).toBe("Samuel lugo puga");
    expect(displayName(null)).toBe("");
  });
});
