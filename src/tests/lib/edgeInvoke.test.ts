/**
 * edgeInvoke.test.ts
 *
 * Tests for src/lib/edgeInvoke.ts
 * Different from safeInvoke: this one THROWS on failure and has channel-summary logic.
 *
 * Coverage targets:
 *   ✅ Happy path — returns { success: true, data }
 *   ✅ SDK error → throws with error.message
 *   ✅ data.success === false → throws with data.error message
 *   ✅ Channel summary — all channels succeed → summary string
 *   ✅ Channel summary — mixed success/failure → summary string, still succeeds
 *   ✅ Channel summary — ALL channels fail → throws
 *   ✅ No channels property → no channelSummary (undefined)
 *
 * LATENT BUG noted in source:
 *   invokeEdge throws Error objects — callers using `.then(null, handler)` patterns
 *   will lose the original message. Consider adding an error code field.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { invokeEdge } from "@/lib/edgeInvoke";
import { supabase } from "@/integrations/supabase/client";

const mockInvoke = vi.mocked(supabase.functions.invoke);

beforeEach(() => {
  mockInvoke.mockReset();
});

describe("invokeEdge — happy path", () => {
  it("returns { success: true, data } on clean response", async () => {
    mockInvoke.mockResolvedValue({ data: { agents: 5 }, error: null });
    const result = await invokeEdge("get-agents", {});
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ agents: 5 });
  });

  it("does not attach channelSummary when data has no channels", async () => {
    mockInvoke.mockResolvedValue({ data: { ok: true }, error: null });
    const result = await invokeEdge("fn", {});
    expect(result.channelSummary).toBeUndefined();
  });
});

describe("invokeEdge — SDK error", () => {
  it("throws Error with the SDK error message", async () => {
    mockInvoke.mockResolvedValue({ data: null, error: { message: "Not found" } });
    await expect(invokeEdge("fn", {})).rejects.toThrow("Not found");
  });

  it("throws generic message when SDK error message is falsy", async () => {
    mockInvoke.mockResolvedValue({ data: null, error: {} });
    await expect(invokeEdge("fn", {})).rejects.toThrow("fn failed");
  });
});

describe("invokeEdge — data.success === false", () => {
  it("throws with data.error message when success is false", async () => {
    mockInvoke.mockResolvedValue({
      data: { success: false, error: "Validation failed" },
      error: null,
    });
    await expect(invokeEdge("validate-fn", {})).rejects.toThrow("Validation failed");
  });

  it("throws generic failure message when data.error is absent", async () => {
    mockInvoke.mockResolvedValue({ data: { success: false }, error: null });
    await expect(invokeEdge("fn", {})).rejects.toThrow("fn reported failure");
  });
});

describe("invokeEdge — channel summary", () => {
  it("returns channel summary when all channels succeed", async () => {
    mockInvoke.mockResolvedValue({
      data: { channels: { push: true, sms: true, email: true } },
      error: null,
    });
    const result = await invokeEdge("notify-fn", {});
    expect(result.channelSummary).toBe("Push ✓, SMS ✓, Email ✓");
  });

  it("returns mixed summary when some channels fail (still resolves)", async () => {
    mockInvoke.mockResolvedValue({
      data: { channels: { push: true, sms: false, email: true } },
      error: null,
    });
    const result = await invokeEdge("notify-fn", {});
    expect(result.success).toBe(true);
    expect(result.channelSummary).toBe("Push ✓, SMS ✗, Email ✓");
  });

  it("throws when ALL channels fail", async () => {
    mockInvoke.mockResolvedValue({
      data: { channels: { push: false, sms: false, email: false } },
      error: null,
    });
    await expect(invokeEdge("notify-fn", {})).rejects.toThrow("All channels failed");
  });

  it("only includes channels that are present in the response", async () => {
    // Only push and email, no sms key
    mockInvoke.mockResolvedValue({
      data: { channels: { push: true, email: false } },
      error: null,
    });
    const result = await invokeEdge("notify-fn", {});
    expect(result.channelSummary).toContain("Push ✓");
    expect(result.channelSummary).toContain("Email ✗");
    expect(result.channelSummary).not.toContain("SMS");
  });
});
