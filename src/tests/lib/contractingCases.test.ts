import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AGENTLINK_STATUS_MAP,
  BLOCKERS,
  CASE_QUEUES,
  LIFECYCLES,
  WAITING_ON,
  daysInStateLabel,
  isAccessRefusal,
  mapAgentLinkStatus,
  readyToWriteSummary,
  summarizeQueues,
  verificationLabel,
  type CarrierCaseRow,
} from "@/lib/contractingCases";

const MIGRATION = resolve(__dirname, "../../../supabase/migrations/20261006100000_contracting_carrier_cases.sql");
const sql = readFileSync(MIGRATION, "utf8");

type SqlMapRow = { status: string; lifecycle: string; blocker: string | null; waitingOn: string | null };

function parseSqlLifecycleMap(text: string): SqlMapRow[] {
  const start = text.indexOf("-- lifecycle-map:start");
  const end = text.indexOf("-- lifecycle-map:end");
  if (start < 0 || end < 0 || end < start) throw new Error("lifecycle-map markers not found in the migration");
  const block = text.slice(start, end);
  const lit = String.raw`(null|'[a-z_]+')`;
  const re = new RegExp(String.raw`\(\s*'([a-z_]+)'\s*,\s*'([a-z_]+)'\s*,\s*${lit}\s*,\s*${lit}\s*\)`, "g");
  const unq = (v: string) => (v === "null" ? null : v.slice(1, -1));
  const rows: SqlMapRow[] = [];
  for (const m of block.matchAll(re)) {
    rows.push({ status: m[1], lifecycle: m[2], blocker: unq(m[3]), waitingOn: unq(m[4]) });
  }
  return rows;
}

function row(partial: Partial<CarrierCaseRow>): CarrierCaseRow {
  return {
    agent_id: "a1", agent_name: "Test Agent", agent_user_id: null, manager_id: null, manager_name: null,
    license_status: "licensed", npn: "1234567", al_user_id: 1, match_basis: "agentlink_id", agency_approval: "approved",
    upline_al_id: 2, upline_name: "Up Line", carrier_name: "Carrier A", carrier_level: "1", al_status: "submitted",
    al_synced_at: "2026-10-05T12:00:00Z", al_lifecycle: "submitted", lifecycle: "submitted", blocker: null,
    blocker_source: null, waiting_on: "carrier", waiting_on_override: null, blocker_override: null, owner_user_id: null,
    owner_name: null, owner_source: "unassigned", next_action: null, follow_up_on: null, note: null, carrier_stage: null,
    carrier_stage_at: null, closed_at: null, closed_reason: null, verified_at: null, verification_source: null,
    verified_by: null, evidence_ref: null, manual_verification_conflict: false, state_since: null,
    state_since_is_lower_bound: null, days_in_state: null, presubmit_missing: [], tracking_updated_at: null,
    q_agent_action: false, q_staff_action: false, q_support: false, q_carrier_review: true, q_follow_up_due: false,
    q_ready_to_submit: false, q_verified: false,
    ...partial,
  };
}

describe("lifecycle map: SQL view and TypeScript agree", () => {
  const sqlRows = parseSqlLifecycleMap(sql);

  it("parses a non-empty map from the migration", () => {
    expect(sqlRows.length).toBeGreaterThanOrEqual(9);
  });

  it("maps every SQL status to the same lifecycle, blocker and waiting-on party", () => {
    for (const r of sqlRows) {
      expect(AGENTLINK_STATUS_MAP[r.status], `TS map is missing ${r.status}`).toBeDefined();
      expect(AGENTLINK_STATUS_MAP[r.status]).toEqual({ lifecycle: r.lifecycle, blocker: r.blocker, waitingOn: r.waitingOn });
    }
  });

  it("has no TS status the SQL view does not know", () => {
    expect(Object.keys(AGENTLINK_STATUS_MAP).sort()).toEqual(sqlRows.map((r) => r.status).sort());
  });

  it("covers every AgentLink status measured live on 2026-10-06", () => {
    for (const s of ["active", "submitted", "requested", "ready_to_contract", "incomplete_profile",
      "pending_upline_assignment", "issue", "rejected", "jail"]) {
      expect(sqlRows.map((r) => r.status)).toContain(s);
    }
  });

  it("only uses vocabulary the tracking table's CHECK constraints and the UI know", () => {
    const checkBlock = sql.slice(sql.indexOf("contracting_case_tracking_blocker_check"), sql.indexOf("contracting_case_tracking_carrier_stage_check"));
    for (const r of sqlRows) {
      expect(LIFECYCLES as readonly string[]).toContain(r.lifecycle);
      if (r.blocker) {
        expect(BLOCKERS as readonly string[]).toContain(r.blocker);
        expect(checkBlock).toContain(`'${r.blocker}'`);
      }
      if (r.waitingOn) expect(WAITING_ON as readonly string[]).toContain(r.waitingOn);
    }
    for (const b of BLOCKERS) expect(checkBlock).toContain(`'${b}'`);
  });

  it("names exactly one upstream status as verified ready to write", () => {
    expect(sqlRows.filter((r) => r.lifecycle === "verified_ready_to_write").map((r) => r.status)).toEqual(["active"]);
  });

  it("labels the AgentLink-active verification with its source in the view", () => {
    expect(sql).toMatch(/when s\.al_status = 'active' then 'AgentLink sync'/);
  });
});

describe("mapAgentLinkStatus", () => {
  it("never turns an unknown, blank or near-miss status into approval", () => {
    for (const s of [null, undefined, "", "  ", "approved", "Activated", "pending", "contracted", "complete"]) {
      const m = mapAgentLinkStatus(s);
      expect(m.lifecycle).toBe("unknown");
      expect(m.waitingOn).toBe("staff");
    }
  });

  it("is case and whitespace tolerant for known statuses", () => {
    expect(mapAgentLinkStatus(" Active ").lifecycle).toBe("verified_ready_to_write");
    expect(mapAgentLinkStatus("INCOMPLETE_PROFILE")).toEqual({ lifecycle: "setup_documents", blocker: "missing_documents", waitingOn: "agent" });
  });

  it("does not read submitted as approved", () => {
    expect(mapAgentLinkStatus("submitted").lifecycle).toBe("submitted");
  });

  it("does not resolve prototype keys as statuses", () => {
    expect(mapAgentLinkStatus("constructor").lifecycle).toBe("unknown");
    expect(mapAgentLinkStatus("__proto__").lifecycle).toBe("unknown");
  });
});

describe("queue and card summaries", () => {
  it("counts cases and distinct people separately, per queue, without adding queues", () => {
    const rows = [
      row({ agent_id: "a1", carrier_name: "A", q_carrier_review: true, q_staff_action: true }),
      row({ agent_id: "a1", carrier_name: "B", q_carrier_review: true }),
      row({ agent_id: "a2", carrier_name: "A", q_carrier_review: false, q_verified: true, lifecycle: "verified_ready_to_write" }),
    ];
    const s = summarizeQueues(rows);
    expect(s.carrier_review).toEqual({ cases: 2, people: 1 });
    expect(s.staff_action).toEqual({ cases: 1, people: 1 });
    expect(s.verified).toEqual({ cases: 1, people: 1 });
    expect(Object.keys(s).sort()).toEqual(CASE_QUEUES.map((q) => q.key).sort());
  });

  it("shows a verified carrier only with its source", () => {
    expect(verificationLabel(row({ lifecycle: "verified_ready_to_write", al_status: "active", verified_at: "2026-10-05T12:00:00Z", verification_source: "AgentLink sync" })))
      .toMatch(/^AgentLink sync · synced /);
    expect(verificationLabel(row({ lifecycle: "verified_ready_to_write", al_status: "submitted", verified_at: "2026-10-05T12:00:00Z", verification_source: "Carrier portal" })))
      .toMatch(/^Verified by staff · Carrier portal/);
    expect(verificationLabel(row({ lifecycle: "verified_ready_to_write", al_status: "submitted", verification_source: null }))).toBeNull();
    expect(verificationLabel(row({ lifecycle: "approved" }))).toBeNull();
  });

  it("never folds other lifecycles into the verified list", () => {
    const s = readyToWriteSummary([
      row({ carrier_name: "Z", lifecycle: "verified_ready_to_write", al_status: "active" }),
      row({ carrier_name: "B", lifecycle: "submitted" }),
      row({ carrier_name: "C", lifecycle: "submitted" }),
      row({ carrier_name: "D", lifecycle: "approved" }),
      row({ carrier_name: "E", lifecycle: "something_new" }),
    ]);
    expect(s.verified.map((r) => r.carrier_name)).toEqual(["Z"]);
    expect(s.others).toEqual([
      { lifecycle: "submitted", label: "Submitted", count: 2 },
      { lifecycle: "approved", label: "Approved", count: 1 },
      { lifecycle: "unknown", label: "Unknown (needs review)", count: 1 },
    ]);
  });

  it("has an honest empty state", () => {
    expect(readyToWriteSummary([])).toEqual({ verified: [], others: [] });
  });

  it("labels a seeded state age as a lower bound and an absent one as unknown", () => {
    expect(daysInStateLabel({ days_in_state: 4, state_since_is_lower_bound: true })).toBe("≥ 4d");
    expect(daysInStateLabel({ days_in_state: 4, state_since_is_lower_bound: false })).toBe("4d");
    expect(daysInStateLabel({ days_in_state: null, state_since_is_lower_bound: null })).toBeNull();
  });
});

describe("isAccessRefusal", () => {
  it("recognises only the authorization refusal code", () => {
    expect(isAccessRefusal({ code: "42501", message: "not allowed to view this agent" })).toBe(true);
    expect(isAccessRefusal({ code: "PGRST301" })).toBe(false);
    expect(isAccessRefusal(new Error("network"))).toBe(false);
    expect(isAccessRefusal(null)).toBe(false);
  });
});
