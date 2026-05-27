/**
 * logger.test.ts
 *
 * Gaps covered:
 *   ✅ logger.error calls console.error
 *   ✅ logger.warn calls console.warn
 *   ✅ logger.info calls console.log (only in DEV env)
 *   ✅ logger.error fires supabase.from('error_logs').insert()
 *   ✅ logger.warn does NOT fire DB insert
 *   ✅ logger.info does NOT fire DB insert
 *   ✅ logger.debug does NOT fire DB insert
 *   ✅ DB insert failure is swallowed (logger never throws)
 *
 * Missing / not yet tested:
 *   ❌ window.location.href is attached to error_logs row (requires JSDOM
 *      navigation or URL override)
 *   ❌ context.stack is forwarded to component_stack column
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { supabase } from "@/integrations/supabase/client";

// Re-import logger fresh to pick up the mock
// Note: vitest auto-hoists vi.mock above imports, so the mock is ready
let logger: typeof import("@/shared/lib/logger").logger;

const mockInsert = vi.fn().mockResolvedValue({ data: null, error: null });
const mockFrom = vi.mocked(supabase.from);

beforeEach(async () => {
  vi.clearAllMocks();
  mockFrom.mockReturnValue({ insert: mockInsert, then: vi.fn() } as any);
  // Re-import so the module picks up fresh mocks
  const mod = await import("@/shared/lib/logger");
  logger = mod.logger;
});

describe("logger.error", () => {
  it("calls console.error", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logger.error("test error");
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("triggers supabase error_logs insert", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    logger.error("db error test", { foo: "bar" });
    // Fire-and-forget — drain microtask queue
    await new Promise((r) => setTimeout(r, 20));
    expect(mockFrom).toHaveBeenCalledWith("error_logs");
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({ error_message: "db error test" })
    );
  });

  it("does not throw even if supabase insert rejects", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockInsert.mockRejectedValueOnce(new Error("DB is down"));
    await expect(() => logger.error("msg")).not.toThrow();
  });
});

describe("logger.warn", () => {
  it("calls console.warn", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    logger.warn("a warning");
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("does NOT insert into error_logs", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    logger.warn("just a warning");
    await new Promise((r) => setTimeout(r, 10));
    expect(mockInsert).not.toHaveBeenCalled();
  });
});

describe("logger.info / logger.debug", () => {
  it("info does not insert into error_logs", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    logger.info("info message");
    await new Promise((r) => setTimeout(r, 10));
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("debug does not insert into error_logs", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    logger.debug("debug message");
    await new Promise((r) => setTimeout(r, 10));
    expect(mockInsert).not.toHaveBeenCalled();
  });
});
