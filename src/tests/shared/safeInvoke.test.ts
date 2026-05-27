/**
 * safeInvoke.test.ts
 *
 * Gaps covered:
 *   ✅ Happy path — data returned, error null
 *   ✅ Supabase SDK error (e.g. network-level)
 *   ✅ data.error payload (edge function returns { error: … })
 *   ✅ Thrown network exception
 *   ✅ idempotencyKey header forwarded
 *   ✅ requestId is unique per call
 *
 * Missing / not yet tested:
 *   ❌ opts.timeout — InvokeOptions has a timeout field but safeInvoke never
 *      actually enforces it (no AbortController, no setTimeout race). This is
 *      a LATENT BUG. When it is implemented, add:
 *        - "resolves normally when response arrives before timeout"
 *        - "returns { data:null, error:{message:'timeout'} } when timeout fires first"
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { safeInvoke } from "@/shared/api/safeInvoke";
import { supabase } from "@/integrations/supabase/client";

const mockInvoke = vi.mocked(supabase.functions.invoke);

beforeEach(() => {
  mockInvoke.mockReset();
});

describe("safeInvoke — happy path", () => {
  it("returns data and null error on success", async () => {
    mockInvoke.mockResolvedValue({ data: { agents: 42 }, error: null });
    const result = await safeInvoke<{ agents: number }>("get-stats", {});
    expect(result.data).toEqual({ agents: 42 });
    expect(result.error).toBeNull();
    expect(result.requestId).toBeTruthy();
  });

  it("always generates a requestId even on error", async () => {
    mockInvoke.mockResolvedValue({ data: null, error: { message: "boom" } });
    const result = await safeInvoke("get-stats");
    expect(result.requestId).toMatch(/.+/);
  });

  it("each call produces a unique requestId", async () => {
    mockInvoke.mockResolvedValue({ data: {}, error: null });
    const r1 = await safeInvoke("fn");
    const r2 = await safeInvoke("fn");
    expect(r1.requestId).not.toBe(r2.requestId);
  });
});

describe("safeInvoke — Supabase SDK error", () => {
  it("returns error.message from the SDK error object", async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: { message: "Unauthorized", status: 401 },
    });
    const result = await safeInvoke("protected-fn");
    expect(result.data).toBeNull();
    expect(result.error?.message).toBe("Unauthorized");
    expect(result.error?.status).toBe(401);
  });

  it("falls back to 'Unknown error' when message is missing", async () => {
    mockInvoke.mockResolvedValue({ data: null, error: {} });
    const result = await safeInvoke("fn");
    expect(result.error?.message).toBe("Unknown error");
  });
});

describe("safeInvoke — data.error payload", () => {
  it("surfaces structured error from the edge function response body", async () => {
    mockInvoke.mockResolvedValue({
      data: { error: { message: "Validation failed", code: "INVALID_BODY" } },
      error: null,
    });
    const result = await safeInvoke("validate-fn");
    expect(result.data).toBeNull();
    expect(result.error?.message).toBe("Validation failed");
    expect(result.error?.code).toBe("INVALID_BODY");
  });

  it("handles string-form data.error (legacy edge fns)", async () => {
    // Some edge fns return: { error: "Something went wrong" }
    mockInvoke.mockResolvedValue({
      data: { error: "Something went wrong" },
      error: null,
    });
    const result = await safeInvoke("legacy-fn");
    expect(result.data).toBeNull();
    // message comes from data.error.message ?? data.error
    expect(result.error?.message).toBe("Something went wrong");
  });
});

describe("safeInvoke — network throw", () => {
  it("catches thrown Error and returns structured error", async () => {
    mockInvoke.mockRejectedValue(new Error("Network unreachable"));
    const result = await safeInvoke("fn");
    expect(result.data).toBeNull();
    expect(result.error?.message).toBe("Network unreachable");
  });

  it("catches non-Error throw and returns 'Network error'", async () => {
    mockInvoke.mockRejectedValue("raw string throw");
    const result = await safeInvoke("fn");
    expect(result.error?.message).toBe("Network error");
  });
});

describe("safeInvoke — headers", () => {
  it("attaches idempotency-key when provided", async () => {
    mockInvoke.mockResolvedValue({ data: {}, error: null });
    await safeInvoke("fn", {}, { idempotencyKey: "order-123" });
    const callArgs = mockInvoke.mock.calls[0][1] as any;
    expect(callArgs.headers["idempotency-key"]).toBe("order-123");
  });

  it("always attaches x-request-id header", async () => {
    mockInvoke.mockResolvedValue({ data: {}, error: null });
    await safeInvoke("fn");
    const callArgs = mockInvoke.mock.calls[0][1] as any;
    expect(callArgs.headers["x-request-id"]).toBeTruthy();
  });

  it("does not attach idempotency-key when not provided", async () => {
    mockInvoke.mockResolvedValue({ data: {}, error: null });
    await safeInvoke("fn");
    const callArgs = mockInvoke.mock.calls[0][1] as any;
    expect(callArgs.headers["idempotency-key"]).toBeUndefined();
  });
});
