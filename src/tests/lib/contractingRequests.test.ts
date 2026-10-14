import { describe, expect, it } from "vitest";
import { CONTRACTING_HEADERS, OUTCOMES, ago, callReason, cellText, followupText, inView, levelText, licenseText, smsBody, toCsv, toExportRow, type CallRow, type RequestRow } from "@/lib/contractingRequests";

const row = (o: Partial<RequestRow> = {}): RequestRow => ({
  agent_id: "a1", display_name: "Ann Lee", start_date: null, request_type: "contracting",
  first_name: "Ann", first_name_source: "agent", last_name: "Lee", last_name_source: "agent",
  npn: "0012345", npn_source: "agent record", email: "ann@example.test", email_source: "agent",
  agency_name: null, agency_tin: null, agency_npn: null, agency_applicability: "not_established",
  direct_upline: "Sam James", direct_upline_id: "m1", direct_upline_source: "agent record (manager)",
  commission_level_pct: 130, commission_level: "130%", commission_level_source: "agent_contract_levels",
  advance: "6 month", advance_source: "approved default", dob: "1990-02-03", residential_address: "1 Main St, Phoenix, AZ 85001", residential_state: "AZ",
  phone: "(602) 555-0100", phone_source: "profile", request_id: null, request_status: null, request_version: null, submitted_at: null,
  sheet_status: null, sheet_synced_at: null, sheet_error: null, sheet_row: null, snapshot: null,
  missing: [], status: "ready_to_submit", next_action: "Submit the request", owner: "admin", ...o,
});

describe("contracting request export", () => {
  it("has exactly the 14 template headers, in the template's order", () => {
    expect(CONTRACTING_HEADERS).toEqual([
      "Request Type", "Agent First Name (as appears on license)", "Agent Last Name (as appears on license)", "NPN", "Agent Email Address",
      "Agency Name (if applicable)", "Agency TIN (if applicable)", "Agency NPN (if applicable)", "Direct Upline", "Commission Level", "Advance?",
      "DOB", "Residential Address", "Agent Phone",
    ]);
  });

  it("maps a complete agent to one 14-value row: level in J, advance in K, NPN kept as text with its leading zeros", () => {
    const r = toExportRow(row());
    expect(r).toHaveLength(14);
    expect(r[0]).toBe("contracting");
    expect(r[3]).toBe("0012345");
    expect(r[9]).toBe("130%");
    expect(r[10]).toBe("6 month");
    expect(r[11]).toBe("1990-02-03");
    expect(r[5]).toBe(""); // agency fields stay blank when applicability is not established
  });

  it("'6 month' is never a commission level, and a level never becomes a fraction or a multiple", () => {
    expect(levelText(130)).toBe("130%");
    expect(levelText("130")).toBe("130%");
    expect(levelText(1.3)).toBe("1.3%");
    expect(levelText(null)).toBe("");
    const r = toExportRow(row({ advance: "6 month", commission_level: "130%" }));
    expect(r[9]).not.toContain("month");
    expect(r[10]).toBe("6 month");
  });

  it("exports the submitted snapshot, not the live record, once a request exists", () => {
    const r = toExportRow(row({ first_name: "Annie", snapshot: { first_name: "Ann", last_name: "Lee", npn: "0012345", commission_level: "130%", advance: "6 month" } }));
    expect(r[1]).toBe("Ann");
  });

  it("a value that starts like a formula is written as text", () => {
    expect(cellText("=HYPERLINK(\"x\")")).toBe("'=HYPERLINK(\"x\")");
    expect(cellText("+1 602")).toBe("'+1 602");
    expect(cellText("Ann")).toBe("Ann");
  });

  it("the CSV carries the headers once and quotes commas and quotes", () => {
    const csv = toCsv([row({ residential_address: '1 Main St, Apt "B", Phoenix, AZ 85001' })]);
    const lines = csv.trim().split("\r\n");
    expect(lines).toHaveLength(2);
    expect(lines[0].startsWith("Request Type,Agent First Name (as appears on license)")).toBe(true);
    expect(lines[1]).toContain('"1 Main St, Apt ""B"", Phoenix, AZ 85001"');
  });

  it("views: missing information needs attention, ready is ready, a failed sheet write needs attention even after submit", () => {
    expect(inView(row({ status: "missing_information", missing: ["dob"] }), "attention")).toBe(true);
    expect(inView(row(), "ready")).toBe(true);
    expect(inView(row(), "attention")).toBe(false);
    expect(inView(row({ status: "submitted", sheet_status: "failed" }), "attention")).toBe(true);
    expect(inView(row({ status: "submitted", sheet_status: "synced" }), "attention")).toBe(false);
    expect(inView(row({ status: "submitted", sheet_status: "synced" }), "submitted")).toBe(true);
  });
});

describe("contracting call list helpers", () => {
  const NOW = Date.parse("2026-10-14T20:00:00Z");
  const call = (o: Partial<CallRow> = {}): CallRow => ({
    agent_id: "a1", display_name: "Tyler Krejcha", phone: "6025550100", license_states: null, licensed_at: null, start_date: null,
    bucket: "to_call", reason: "never_opened", last_opened_at: null, opens: 0, marked_count: 0,
    profile_saved: false, details_saved: false, request_status: null, followup: null, ...o,
  });

  it("names the next step in plain words, with partial carrier progress when there is some", () => {
    expect(callReason(call(), NOW)).toBe("Never opened the link");
    expect(callReason(call({ reason: "opened_not_saved", last_opened_at: "2026-10-14T17:00:00Z", opens: 3 }), NOW)).toBe("Opened the link 3 h ago (3 times), saved nothing");
    expect(callReason(call({ reason: "missing_details", profile_saved: true }), NOW)).toBe("Saved their profile, still needs DOB + address");
    expect(callReason(call({ marked_count: 3 }), NOW)).toBe("Never opened the link · 3 of 4 carriers confirmed");
  });

  it("shows license state and date only when they are on file", () => {
    expect(licenseText(call())).toBe("Licensed");
    expect(licenseText(call({ licensed_at: "2026-08-25T00:00:00Z" }))).toMatch(/^Licensed since Aug 2[45]$/);
    expect(licenseText(call({ license_states: ["FL", "OH", "TX"], licensed_at: "2026-08-25T00:00:00Z" }))).toMatch(/^Licensed FL\/OH since Aug 2[45]$/);
  });

  it("describes the last touch with who, how and the outcome", () => {
    expect(followupText(call(), NOW)).toBe("");
    expect(followupText(call({ followup: { channel: "call", outcome: null, at: "2026-10-14T19:50:00Z", by: "Samuel James", mine: true } }), NOW)).toBe("You called 10 min ago");
    expect(followupText(call({ followup: { channel: "text", outcome: "will_finish", at: "2026-10-12T19:50:00Z", by: "Maria Lopez", mine: false } }), NOW)).toBe("Maria texted 2 d ago · will finish");
    expect(followupText(call({ followup: { channel: "note", outcome: "voicemail", at: "2026-10-14T19:59:40Z", by: null, mine: false } }), NOW)).toBe("Someone noted just now · voicemail");
  });

  it("never renders a negative age for a future stamp", () => {
    expect(ago("2026-10-15T00:00:00Z", NOW)).toBe("just now");
  });

  it("texts the first name and the link, and says 'there' to a record whose name is a raw email", () => {
    expect(smsBody("Tyler Krejcha", "https://x.test/c")).toBe("Hey Tyler, your contracting isn't finished yet. Finish it here so we can get you contracted: https://x.test/c");
    expect(smsBody("jadenselvaraj@gmail.com", "https://x.test/c")).toContain("Hey there,");
    expect(smsBody("   ", "https://x.test/c")).toContain("Hey there,");
  });

  it("offers every outcome the database accepts, once", () => {
    expect(OUTCOMES.map((o) => o.key)).toEqual(["reached", "will_finish", "voicemail", "no_answer", "not_interested"]);
  });
});
