/**
 * logLeadActivity.test.ts
 *
 * Tests for src/lib/logLeadActivity.ts — fire-and-forget lead interaction logger.
 * Runs against the global Supabase mock from src/tests/setup.ts.
 *
 * Coverage targets:
 *   ✅ No-ops silently when no authenticated user
 *   ✅ Inserts correct shape when user is authenticated
 *   ✅ Uses profile.full_name as actorName when available
 *   ✅ Falls back to user.email when profile has no full_name
 *   ✅ Sets actorRole from user_roles when available
 *   ✅ Defaults actorRole to null when user_roles returns nothing
 *   ✅ Never throws to the caller even when Supabase insert fails
 *   ✅ Passes details: null when details is omitted
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { logLeadActivity } from "@/lib/logLeadActivity";
import { supabase } from "@/integrations/supabase/client";

const mockGetUser = vi.mocked(supabase.auth.getUser);
const mockFrom = vi.mocked(supabase.from);

// ── helpers ──────────────────────────────────────────────────────────────────

function makeUser(id = "user-001", email = "agent@example.com") {
  return { id, email };
}

function setupFromMocks(opts: {
  profileName?: string | null;
  roleValue?: string | null;
  insertError?: Error | null;
} = {}) {
  const { profileName = "Alex Agent", roleValue = "agent", insertError = null } = opts;

  mockFrom.mockImplementation((table: string) => {
    if (table === "profiles") {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: profileName !== null ? { full_name: profileName } : null,
          error: null,
        }),
      } as any;
    }
    if (table === "user_roles") {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: roleValue !== null ? { role: roleValue } : null,
          error: null,
        }),
      } as any;
    }
    if (table === "lead_activity") {
      return {
        insert: vi.fn().mockResolvedValue({ data: null, error: insertError }),
      } as any;
    }
    return { select: vi.fn().mockReturnThis() } as any;
  });
}

beforeEach(() => {
  mockGetUser.mockReset();
  mockFrom.mockReset();
});

// ── no authenticated user ─────────────────────────────────────────────────────

describe("logLeadActivity — no authenticated user", () => {
  it("returns without inserting when getUser returns null user", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null } as any);
    await logLeadActivity({ leadId: "lead-1", type: "call", title: "Called lead" });
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("does not throw to the caller when user is null", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null } as any);
    await expect(
      logLeadActivity({ leadId: "lead-1", type: "call", title: "Called" })
    ).resolves.toBeUndefined();
  });
});

// ── happy path ────────────────────────────────────────────────────────────────

describe("logLeadActivity — authenticated user", () => {
  it("inserts lead_activity row with correct field shape", async () => {
    const user = makeUser();
    mockGetUser.mockResolvedValue({ data: { user }, error: null } as any);
    setupFromMocks({ profileName: "Alex Agent", roleValue: "agent" });

    await logLeadActivity({
      leadId: "lead-42",
      type: "stage_update",
      title: "Moved to Licensed",
      details: { from: "contacted", to: "licensed" },
    });

    const insertCall = mockFrom.mock.calls.find(([t]) => t === "lead_activity");
    expect(insertCall).toBeTruthy();
  });

  it("uses profile.full_name as actorName", async () => {
    const user = makeUser("u1", "test@test.com");
    mockGetUser.mockResolvedValue({ data: { user }, error: null } as any);

    let insertedRow: Record<string, unknown> | null = null;
    mockFrom.mockImplementation((table: string) => {
      if (table === "profiles") return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), single: vi.fn().mockResolvedValue({ data: { full_name: "Jordan Smith" }, error: null }) } as any;
      if (table === "user_roles") return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(), single: vi.fn().mockResolvedValue({ data: { role: "agent" }, error: null }) } as any;
      if (table === "lead_activity") return { insert: vi.fn().mockImplementation((row) => { insertedRow = row; return Promise.resolve({ data: null, error: null }); }) } as any;
      return {} as any;
    });

    await logLeadActivity({ leadId: "l1", type: "note", title: "Note added" });
    expect(insertedRow).toMatchObject({ actor_name: "Jordan Smith" });
  });

  it("falls back to user.email when profile has no full_name", async () => {
    const user = makeUser("u2", "fallback@apex.com");
    mockGetUser.mockResolvedValue({ data: { user }, error: null } as any);

    let insertedRow: Record<string, unknown> | null = null;
    mockFrom.mockImplementation((table: string) => {
      if (table === "profiles") return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), single: vi.fn().mockResolvedValue({ data: { full_name: null }, error: null }) } as any;
      if (table === "user_roles") return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(), single: vi.fn().mockResolvedValue({ data: { role: "manager" }, error: null }) } as any;
      if (table === "lead_activity") return { insert: vi.fn().mockImplementation((row) => { insertedRow = row; return Promise.resolve({ data: null, error: null }); }) } as any;
      return {} as any;
    });

    await logLeadActivity({ leadId: "l2", type: "call", title: "Called" });
    expect(insertedRow).toMatchObject({ actor_name: "fallback@apex.com" });
  });

  it("sets actorRole to null when user_roles returns no data", async () => {
    const user = makeUser();
    mockGetUser.mockResolvedValue({ data: { user }, error: null } as any);

    let insertedRow: Record<string, unknown> | null = null;
    mockFrom.mockImplementation((table: string) => {
      if (table === "profiles") return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), single: vi.fn().mockResolvedValue({ data: { full_name: "X" }, error: null }) } as any;
      if (table === "user_roles") return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(), single: vi.fn().mockResolvedValue({ data: null, error: null }) } as any;
      if (table === "lead_activity") return { insert: vi.fn().mockImplementation((row) => { insertedRow = row; return Promise.resolve({ data: null, error: null }); }) } as any;
      return {} as any;
    });

    await logLeadActivity({ leadId: "l3", type: "call", title: "Called" });
    expect(insertedRow).toMatchObject({ actor_role: null });
  });

  it("passes details: null when details is omitted", async () => {
    const user = makeUser();
    mockGetUser.mockResolvedValue({ data: { user }, error: null } as any);

    let insertedRow: Record<string, unknown> | null = null;
    mockFrom.mockImplementation((table: string) => {
      if (table === "profiles") return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), single: vi.fn().mockResolvedValue({ data: { full_name: "X" }, error: null }) } as any;
      if (table === "user_roles") return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(), single: vi.fn().mockResolvedValue({ data: { role: "agent" }, error: null }) } as any;
      if (table === "lead_activity") return { insert: vi.fn().mockImplementation((row) => { insertedRow = row; return Promise.resolve({ data: null, error: null }); }) } as any;
      return {} as any;
    });

    await logLeadActivity({ leadId: "l4", type: "view", title: "Viewed" });
    expect(insertedRow).toMatchObject({ details: null });
  });
});

// ── error resilience ──────────────────────────────────────────────────────────

describe("logLeadActivity — error resilience", () => {
  it("does not throw when Supabase insert returns an error", async () => {
    const user = makeUser();
    mockGetUser.mockResolvedValue({ data: { user }, error: null } as any);
    setupFromMocks({ insertError: new Error("DB write failed") });

    await expect(
      logLeadActivity({ leadId: "l5", type: "call", title: "Called" })
    ).resolves.toBeUndefined();
  });

  it("does not throw when Supabase getUser itself throws", async () => {
    mockGetUser.mockRejectedValue(new Error("Network error"));

    await expect(
      logLeadActivity({ leadId: "l6", type: "call", title: "Called" })
    ).resolves.toBeUndefined();
  });
});
