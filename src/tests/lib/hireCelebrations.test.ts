import { describe, expect, it } from "vitest";
import {
  addHireToBatch, canViewHire, HIRE_BATCH_NAMES_SHOWN, HIRE_FRESHNESS_MS, hireHeadline, readHire, readRealtimeHire,
} from "@/lib/hireCelebrations";
import { DealCelebrationLedger } from "@/lib/dealCelebrations";

const now = Date.parse("2026-11-26T02:30:00Z");
const id = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const recruiter = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const manager = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
// Shape of a real hire row as realtime delivers it (measured: agent_code is null at INSERT).
const hire = {
  id, status: "active", onboarding_stage: "training_online", license_status: "licensed", agent_code: null,
  display_name: "Daniel Bridges", manager_id: manager, invited_by_manager_id: recruiter,
  user_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", is_deactivated: false, is_inactive: false,
  created_at: new Date(now).toISOString(), phone: "never shown", email: "never shown",
};

describe("what counts as a hire", () => {
  it("reads a fresh active INSERT: name, license, recruiter-first manager order", () => {
    expect(readHire(hire, now - 100, now)).toEqual({
      id, hiredAt: now, displayName: "Daniel Bridges", firstName: "Daniel", agentCode: null, licensed: true,
      onboardingStage: "training_online", managerIds: [recruiter, manager],
    });
  });

  it.each([
    { status: "pending" }, { status: "terminated" }, { is_deactivated: true }, { is_inactive: true },
    { agent_code: "GHOST_AYRO_123", user_id: null }, { agent_code: "GHOST_TEST" }, { agent_code: "ghost_x" },
    { display_name: "" }, { display_name: "   " }, { display_name: null },
    { id: "not-a-durable-id" }, { created_at: "invalid" }, { created_at: null },
    { created_at: new Date(now - HIRE_FRESHNESS_MS - 1).toISOString() }, { created_at: new Date(now + 10_000).toISOString() },
  ])("rejects non-hires, placeholders, nameless rows, stale and malformed rows: %j", (patch) => {
    expect(readHire({ ...hire, ...patch }, now - 100, now)).toBeNull();
  });

  it("rejects rows inserted before this session armed, so a page load never replays the roster", () => {
    expect(readHire(hire, now + 1, now)).toBeNull();
  });

  it("dedupes manager ids and tolerates a hire with no manager at all", () => {
    expect(readHire({ ...hire, manager_id: recruiter }, now, now)?.managerIds).toEqual([recruiter]);
    expect(readHire({ ...hire, manager_id: null, invited_by_manager_id: null }, now, now)?.managerIds).toEqual([]);
  });

  it("reads only INSERT realtime events; an UPDATE is a correction, not a second hire", () => {
    expect(readRealtimeHire({ eventType: "INSERT", new: hire }, now, now)?.id).toBe(id);
    expect(readRealtimeHire({ eventType: "UPDATE", new: hire }, now, now)).toBeNull();
    expect(readRealtimeHire({ eventType: "DELETE", new: hire }, now, now)).toBeNull();
  });
});

describe("who sees the screen", () => {
  const read = readHire(hire, now, now)!;
  it("admins and managers always; a plain agent only when they recruited the hire", () => {
    expect(canViewHire({ isAdmin: true, isManager: false, agentIds: new Set() }, read)).toBe(true);
    expect(canViewHire({ isAdmin: false, isManager: true, agentIds: new Set() }, read)).toBe(true);
    expect(canViewHire({ isAdmin: false, isManager: false, agentIds: new Set([recruiter]) }, read)).toBe(true);
    expect(canViewHire({ isAdmin: false, isManager: false, agentIds: new Set([manager]) }, read)).toBe(true);
    expect(canViewHire({ isAdmin: false, isManager: false, agentIds: new Set(["ffffffff-ffff-4fff-8fff-ffffffffffff"]) }, read)).toBe(false);
    expect(canViewHire({ isAdmin: false, isManager: false, agentIds: new Set() }, read)).toBe(false);
  });
});

describe("one screen per hire", () => {
  it("the shared per-login ledger accepts a hire once and refuses a replay", () => {
    const ledger = new DealCelebrationLedger(now - 1);
    const read = readHire(hire, now, now)!;
    expect(ledger.accept({ id: read.id, postedAt: read.hiredAt, annualPremium: null })).toBe(true);
    expect(ledger.accept({ id: read.id, postedAt: read.hiredAt, annualPremium: null })).toBe(false);
  });

  it("batches a burst of hires under the newest key and headlines them honestly", () => {
    const first = readHire(hire, now, now)!;
    const second = readHire({ ...hire, id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", display_name: "Brooke Lane" }, now, now)!;
    const one = addHireToBatch(null, first);
    expect(hireHeadline(one)).toBe("Welcome, Daniel");
    const two = addHireToBatch(one, second);
    expect(two.key).toBe(second.id);
    expect(two.hires.map((h) => h.displayName)).toEqual(["Daniel Bridges", "Brooke Lane"]);
    expect(hireHeadline(two)).toBe("2 new hires");
    expect(HIRE_BATCH_NAMES_SHOWN).toBeGreaterThan(0);
  });
});
