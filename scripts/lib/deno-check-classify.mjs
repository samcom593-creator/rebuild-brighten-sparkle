/**
 * Classify one `deno check` run. Shared by scripts/check-deno-typecheck.mjs and
 * src/tests/scripts/denoCheckClassify.test.ts, so the gate and its test cannot
 * disagree about what a "type error" is.
 *
 * A non-zero exit is NOT evidence of a type error. `deno check` also exits 1
 * when it cannot fetch a remote import (deno.land, esm.sh), when deno.lock's
 * integrity hash no longer matches what the CDN serves, and when a local import
 * path is wrong. None of those print a single TSxxxx code. Measured locally
 * 2026-10-11 with deno.land unreachable:
 *
 *     error: Import 'https://deno.land/std@0.190.0/http/server.ts' failed.
 *         0: error sending request for url (...): client error (Connect)
 *
 * exit 1, zero TS codes. Before this file the gate called that "NEW type errors
 * in agent-signup ... they were introduced", and that is what Verify core said
 * on 573a63d7 (run 38107075760), a commit that never touched agent-signup.
 * agent-signup is the first of 115 entrypoints (sorted) to import
 * std@0.190.0/http/server.ts, so a deno.land blip at the start of the run lands
 * on it and nowhere else: the next importer refetches and passes.
 */

const ANSI = /\x1b\[[0-9;]*m/g;

/**
 * deno prints type errors as `TS2304 [ERROR]: ...`, but colour-wrapped:
 * `\x1b[1mTS2304 \x1b[0m[ERROR]`. The `m` before `T` is a word character, so
 * a bare `\bTS\d+` never matches real output. Strip colour first. (The first
 * cut of this file did not, and selfTest() refused a verdict on its first run.)
 */
export const HAS_TS_DIAGNOSTIC = (out) => /\bTS\d{4,5}\b/.test((out || "").replace(ANSI, ""));

/**
 * PASS        exit 0
 * FAIL        non-zero exit WITH a TS diagnostic: a real type error
 * UNRESOLVED  non-zero exit with NO TS diagnostic: deno never reached the type
 *             checker (fetch, lock integrity, or a wrong import path)
 * UNKNOWN     spawn error, timeout, or killed by a signal
 */
export function classify({ error, status, out }) {
  if (error) return "UNKNOWN";
  if (status === null || status === undefined) return "UNKNOWN";
  if (status === 0) return "PASS";
  return HAS_TS_DIAGNOSTIC(out) ? "FAIL" : "UNRESOLVED";
}

/** Only UNRESOLVED is retried: a fetch can succeed on the next try, a type error cannot. */
export const RETRY_DELAYS_MS = [2_000, 6_000];

/** First `max` non-blank lines of deno's output, colour codes stripped, for the CI log. */
export function excerpt(out, max = 20) {
  const lines = (out || "").replace(ANSI, "").split("\n").map((l) => l.trimEnd()).filter((l) => l.trim());
  if (lines.length <= max) return lines;
  return [...lines.slice(0, max), `... ${lines.length - max} more line(s)`];
}
