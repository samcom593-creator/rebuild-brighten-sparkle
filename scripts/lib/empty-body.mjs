/**
 * The emptiness predicate behind scripts/check-empty-catch.mjs (MP-480).
 *
 * WHY THIS IS ITS OWN FILE, AND WHY THE .trim() IS LOAD-BEARING:
 *
 * scripts/lib/strip-comments.mjs BLANKS comments in place — byte offsets are
 * preserved on purpose, so callers can slice the original text by the same
 * indices and reported line numbers stay true. It therefore returns a string of
 * SPACES where a comment was, never a shorter string.
 *
 * check-empty-catch decides "is this handler empty?" with `stripped === ""`.
 * Hand the raw output of the shared stripper to that test and every
 * comment-bodied handler — `} catch { /* ignore *\/ }` — reads as NON-empty and
 * silently stops being a violation. Measured on 2026-09-08 at HEAD: the
 * supabase/functions count falls 51 -> 22. All 29 of the lost sites are real
 * comment-bodied swallows, several of them wrapping DB or log writes
 * (agentlink-cookie-sync:544, agentlink-import:283/307, morning-brief:157,
 * notion-sync:184). Not one is a phantom. MP-474 recorded that swing as
 * "plausibly real over-counts"; it is the opposite — it is the guard going
 * blind, in the one direction scripts/lib/strip-comments.mjs's own header calls
 * "the dangerous one".
 *
 * A count-only ratchet CANNOT catch that regression, and in fact rewards it:
 * 22 is below the 51 floor, so check-empty-catch exits 0 and prints
 * "Lower the supabase/functions baseline ... to 22 in this commit." Following
 * the guard's own printed remedy is what would have locked the blindness in.
 * That is MP-356/MP-357's fungible-floor lesson with the sign flipped — so the
 * contract is pinned by a POSITIVE CONTROL (scripts/tests/empty-body.test.mjs),
 * not by a number.
 */
import { stripComments } from "./strip-comments.mjs";

/** Comment-masked, whitespace-trimmed handler body. See the .trim() note above. */
export function normalizeBody(body) {
  return stripComments(body).trim();
}

/**
 * True when a normalized `.catch(...)` argument body swallows the error:
 * an empty block, or an expression that discards it (null / undefined / void x).
 * The bare-block form is graded by callers with `normalizeBody(b) === ""`.
 */
export function isEmptyCatchExpression(stripped) {
  return (
    stripped === "" ||
    stripped === "null" ||
    stripped === "undefined" ||
    /^void\s+[A-Za-z0-9_$]+$/.test(stripped) ||
    /^void\s+0$/.test(stripped)
  );
}
