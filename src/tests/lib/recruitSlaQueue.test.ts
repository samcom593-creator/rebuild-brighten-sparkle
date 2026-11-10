import { describe, expect, it } from "vitest";

import {
  SLA_STATES,
  SLA_STATE_META,
  countByState,
  isSlaState,
  licenseLabel,
  personHref,
  sortQueue,
  waitingFor,
} from "@/lib/recruitSlaQueue";

describe("recruit SLA queue", () => {
  it("has a label and tone for every state the view can emit", () => {
    // Mirrors the CASE in public.v_recruit_sla_queue (migration 20261111100200).
    expect([...SLA_STATES].sort()).toEqual(
      ["CALLBACK", "CALL_NO_OUTCOME", "FOLLOWUP_DUE", "LICENSED_UNBOOKED", "NEW_UNTOUCHED"],
    );
    for (const s of SLA_STATES) {
      expect(SLA_STATE_META[s].label.length).toBeGreaterThan(0);
      expect(SLA_STATE_META[s].tone).toBeTruthy();
    }
  });

  it("counts every state, zero included, and ignores unknown values", () => {
    const counts = countByState([
      { sla_state: "NEW_UNTOUCHED" },
      { sla_state: "NEW_UNTOUCHED" },
      { sla_state: "CALLBACK" },
      { sla_state: "SOMETHING_ELSE" as never },
    ]);
    expect(counts).toEqual({
      CALL_NO_OUTCOME: 0,
      NEW_UNTOUCHED: 2,
      CALLBACK: 1,
      FOLLOWUP_DUE: 0,
      LICENSED_UNBOOKED: 0,
    });
    expect(isSlaState("SOMETHING_ELSE")).toBe(false);
  });

  it("orders licensed first, then the longest-waiting", () => {
    const rows = sortQueue([
      { id: "u-new", sort_rank: 2, created_at: "2026-11-10T20:00:00Z" },
      { id: "l-new", sort_rank: 0, created_at: "2026-11-10T21:00:00Z" },
      { id: "u-old", sort_rank: 2, created_at: "2026-11-01T20:00:00Z" },
      { id: "p", sort_rank: 1, created_at: "2026-11-09T20:00:00Z" },
    ]);
    expect(rows.map((r) => r.id)).toEqual(["l-new", "p", "u-old", "u-new"]);
  });

  it("formats waiting time and never invents one", () => {
    const now = Date.parse("2026-11-10T21:00:00Z");
    expect(waitingFor("2026-11-10T20:48:00Z", now)).toBe("12m");
    expect(waitingFor("2026-11-10T18:00:00Z", now)).toBe("3h");
    expect(waitingFor("2026-11-07T21:00:00Z", now)).toBe("3d");
    expect(waitingFor(null, now)).toBe("unknown");
    expect(waitingFor("not a date", now)).toBe("unknown");
  });

  it("labels license status and links to the worklist person panel", () => {
    expect(licenseLabel("licensed")).toBe("Licensed");
    expect(licenseLabel(null)).toBe("Unknown");
    expect(personHref("abc-123")).toBe("/dashboard/recruiting?person=abc-123");
  });
});
