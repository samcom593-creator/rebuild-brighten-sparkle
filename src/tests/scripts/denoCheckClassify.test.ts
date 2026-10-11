import { describe, it, expect } from "vitest";
import {
  classify,
  excerpt,
  HAS_TS_DIAGNOSTIC,
  RETRY_DELAYS_MS,
} from "../../../scripts/lib/deno-check-classify.mjs";

// Real deno 2.9 output, captured 2026-10-11 by checking agent-signup with
// deno.land unreachable (cold DENO_DIR, dead proxy). Colour codes kept: that is
// what spawnSync hands the gate.
const FETCH_FAILED =
  "\x1b[0m\x1b[1m\x1b[31merror\x1b[0m: Import 'https://deno.land/std@0.190.0/http/server.ts' failed.\n" +
  "    0: error sending request for url (https://deno.land/std@0.190.0/http/server.ts): client error (Connect): tcp connect error: Connection refused (os error 61)\n" +
  "    1: client error (Connect)\n" +
  "    2: tcp connect error\n" +
  "    3: Connection refused (os error 61)\n" +
  "    at \x1b[0m\x1b[36mfile:///repo/supabase/functions/agent-signup/index.ts\x1b[0m:\x1b[0m\x1b[33m1\x1b[0m:\x1b[0m\x1b[33m23\x1b[0m\n";

// The diagnostic the gate exists for (MP-543, 438a9e2d^ apex-alert-dispatch),
// colour codes exactly as deno 2.9 emits them. A plain-text fixture passed here
// while the real output failed: the `m` of `\x1b[1m` defeats a bare \bTS.
const TYPE_ERROR =
  "\x1b[0m\x1b[1mTS2304 \x1b[0m[ERROR]: Cannot find name 'NTFY_DEFAULT_TOPIC'.\n" +
  "    url = (data as any)?.value || NTFY_DEFAULT_TOPIC;\n" +
  "                                  ~~~~~~~~~~~~~~~~~~\n" +
  "error: Type checking failed.\n";

const INTEGRITY =
  "error: Integrity check failed for remote specifier. The source code is invalid, as it does not match the expected hash in the lock file.\n" +
  "  Specifier: https://esm.sh/@supabase/supabase-js@2.106.0\n";

const LOCAL_MISSING =
  "error: Module not found \"file:///repo/supabase/functions/_shared/gone.ts\".\n" +
  "    at file:///repo/supabase/functions/x/index.ts:3:22\n";

describe("deno check classification", () => {
  it("a failed fetch is UNRESOLVED, never a type error", () => {
    // Before PL-WIB-DENO-FETCH-NOT-TYPE-ERROR this exact output was graded
    // FAIL and printed as "NEW type errors in agent-signup ... introduced".
    expect(HAS_TS_DIAGNOSTIC(FETCH_FAILED)).toBe(false);
    expect(classify({ error: undefined, status: 1, out: FETCH_FAILED })).toBe("UNRESOLVED");
  });

  it("a real type error is FAIL", () => {
    expect(HAS_TS_DIAGNOSTIC(TYPE_ERROR)).toBe(true);
    expect(classify({ error: undefined, status: 1, out: TYPE_ERROR })).toBe("FAIL");
  });

  it("lock-integrity and missing-local-module failures are UNRESOLVED (red, but not called type errors)", () => {
    expect(classify({ error: undefined, status: 1, out: INTEGRITY })).toBe("UNRESOLVED");
    expect(classify({ error: undefined, status: 1, out: LOCAL_MISSING })).toBe("UNRESOLVED");
  });

  it("exit 0 is PASS even if deno printed something", () => {
    expect(classify({ error: undefined, status: 0, out: "Download https://esm.sh/x\n" })).toBe("PASS");
  });

  it("spawn errors, timeouts and signals are UNKNOWN", () => {
    expect(classify({ error: Object.assign(new Error("t"), { code: "ETIMEDOUT" }), status: null, out: "" })).toBe("UNKNOWN");
    expect(classify({ error: undefined, status: null, out: "" })).toBe("UNKNOWN");
  });

  it("does not mistake a digit run inside a URL for a TS code", () => {
    expect(HAS_TS_DIAGNOSTIC("error: Import 'https://esm.sh/v135/fooTS2304bar/x.ts' failed.")).toBe(false);
    expect(HAS_TS_DIAGNOSTIC("error: Import 'https://esm.sh/v135/fooTS2304bar/x.ts' failed.".replace("foo", "foo "))).toBe(false);
  });

  it("retries exist, so a one-off blip cannot red the gate on its own", () => {
    expect(RETRY_DELAYS_MS.length).toBeGreaterThanOrEqual(1);
  });

  it("excerpt strips colour codes and caps the log", () => {
    const lines = excerpt(FETCH_FAILED);
    expect(lines[0]).toBe("error: Import 'https://deno.land/std@0.190.0/http/server.ts' failed.");
    expect(lines.join("\n")).not.toContain("\x1b");
    const long = excerpt(Array.from({ length: 50 }, (_, i) => `line ${i}`).join("\n"), 20);
    expect(long).toHaveLength(21);
    expect(long[20]).toBe("... 30 more line(s)");
  });
});
