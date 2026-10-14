import { describe, expect, it } from "vitest";
import { CONTRACTING_HEADERS, cellText, inView, levelText, toCsv, toExportRow, type RequestRow } from "@/lib/contractingRequests";

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
