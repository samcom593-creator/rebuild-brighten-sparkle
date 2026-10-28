import { describe, expect, it } from "vitest";
import { parseStatusGroup, policyStatusGroup, STATUS_GROUP_CHIPS, STATUS_GROUP_LITERALS, statusGroupFilter } from "@/lib/policyStatusGroup";

describe("policyStatusGroup", () => {
  it("groups carrier statuses the way v_book_flip_worklist.status_group does", () => {
    expect(policyStatusGroup("Active")).toBe("active");
    expect(policyStatusGroup("active")).toBe("active");
    expect(policyStatusGroup("Approved")).toBe("active");
    expect(policyStatusGroup("Issued, Not Paid")).toBe("pending");
    expect(policyStatusGroup("In Review")).toBe("pending");
    expect(policyStatusGroup("submitted")).toBe("pending");
    expect(policyStatusGroup("Lapse Pending")).toBe("lapsing");
    expect(policyStatusGroup("Lapsed")).toBe("lapsing");
    expect(policyStatusGroup("Not Taken")).toBe("inactive");
    expect(policyStatusGroup("Declined")).toBe("inactive");
    expect(policyStatusGroup("Withdrawn")).toBe("inactive");
    expect(policyStatusGroup("Cancelled")).toBe("inactive");
  });

  it("never invents a status: blanks, Unknown and source markers are unknown", () => {
    expect(policyStatusGroup("Unknown")).toBe("unknown");
    expect(policyStatusGroup(null)).toBe("unknown");
    expect(policyStatusGroup(undefined)).toBe("unknown");
    expect(policyStatusGroup("   ")).toBe("unknown");
    expect(policyStatusGroup("reported_external")).toBe("unknown");
  });

  it("offers one chip per group", () => {
    expect(STATUS_GROUP_CHIPS.map((c) => c.key)).toEqual(["active", "pending", "lapsing", "inactive", "unknown"]);
  });

  it("filters the server the way it labels the row: every literal in a group's filter maps back to that group", () => {
    for (const [group, literals] of Object.entries(STATUS_GROUP_LITERALS)) {
      for (const v of literals) expect({ v, group: policyStatusGroup(v) }).toEqual({ v, group });
    }
  });

  it("builds a PostgREST or-filter per group, and unknown means null or none of the claimed literals", () => {
    expect(statusGroupFilter("active")).toContain('status.ilike."Active"');
    expect(statusGroupFilter("pending")).toContain('status.ilike."Issued, Not Paid"');
    const unknown = statusGroupFilter("unknown");
    expect(unknown.startsWith("status.is.null,and(")).toBe(true);
    expect(unknown).toContain('status.not.ilike."Lapsed"');
  });

  it("reads a group from the URL and rejects anything else", () => {
    expect(parseStatusGroup("lapsing")).toBe("lapsing");
    expect(parseStatusGroup("everything")).toBeNull();
    expect(parseStatusGroup(null)).toBeNull();
  });
});
