/**
 * samCanonical.test.ts
 *
 * Gaps covered:
 *   ✅ fetchCanonicalSamAgent — happy path with array response
 *   ✅ fetchCanonicalSamAgent — happy path with scalar response
 *   ✅ fetchCanonicalSamAgent — RPC error → returns null + warns
 *   ✅ fetchCanonicalSamAgent — empty array → returns null
 *   ✅ fetchCanonicalSamAgent — null data → returns null
 *   ✅ getSamExclusionIds — already covered in pureUtils.test.ts
 *
 * Note: getSamExclusionIds (pure function) is covered in pureUtils.test.ts.
 * This file focuses on the async fetchCanonicalSamAgent boundary.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { supabase } from "@/integrations/supabase/client";
import { fetchCanonicalSamAgent } from "@/lib/samCanonical";

const MOCK_SAM: import("@/lib/samCanonical").CanonicalSamAgent = {
  agent_id: "canonical-uuid-001",
  user_id: "user-uuid-001",
  profile_id: "profile-uuid-001",
  display_name: "Sam James",
  agent_code: "SJAMES01",
  auth_email: "sam@example.com",
  last_sign_in_at: "2026-06-01T00:00:00Z",
  legacy_agent_id: "legacy-uuid-002",
};

// The supabase mock from setup.ts doesn't include rpc by default.
// We attach it per-test here.
function mockRpc(data: unknown, error: unknown = null) {
  (supabase as any).rpc = vi.fn().mockResolvedValue({ data, error });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("fetchCanonicalSamAgent", () => {
  it("returns the first row when RPC returns an array", async () => {
    mockRpc([MOCK_SAM]);
    const result = await fetchCanonicalSamAgent();
    expect(result).toEqual(MOCK_SAM);
  });

  it("returns the row directly when RPC returns a scalar object", async () => {
    mockRpc(MOCK_SAM);
    const result = await fetchCanonicalSamAgent();
    expect(result).toEqual(MOCK_SAM);
  });

  it("returns null when RPC returns an empty array", async () => {
    mockRpc([]);
    const result = await fetchCanonicalSamAgent();
    expect(result).toBeNull();
  });

  it("returns null when RPC returns null data", async () => {
    mockRpc(null);
    const result = await fetchCanonicalSamAgent();
    expect(result).toBeNull();
  });

  it("returns null and warns when RPC returns an error", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockRpc(null, { message: "relation does not exist" });
    const result = await fetchCanonicalSamAgent();
    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[samCanonical]"),
      expect.objectContaining({ message: "relation does not exist" }),
    );
    warnSpy.mockRestore();
  });

  it("calls the correct RPC name", async () => {
    mockRpc([MOCK_SAM]);
    await fetchCanonicalSamAgent();
    expect((supabase as any).rpc).toHaveBeenCalledWith("get_canonical_sam_agent");
  });
});
