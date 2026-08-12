// like-escape.ts — make .ilike() mean "equals, case-insensitively".
//
// WHY THIS EXISTS
// Seven call sites in this repo reach for .ilike() when what they mean is
// "the same email / the same code, ignoring case". .ilike() is not that. It is a
// LIKE pattern match, so every metacharacter in the *caller's own input* is
// interpreted instead of compared.
//
// This is the sharper half of the ambiguity-reads-as-absence disease (MP-275,
// MP-276), because here the unique index gives the author false confidence:
// email_unsubscribes.email and agents.agent_code ARE uniquely indexed, and a
// pattern match sails straight past that index anyway.
//
// PROVEN AGAINST LIVE PROD, 2026-08-12, not reasoned about:
//   ?email=ilike.j_intwan@yahoo.com   -> 2 rows: j.intwan@yahoo.com, J.intwan@yahoo.com
//   ?email=ilike.\_...                 -> 0 rows (the literal address does not exist)
//   ?email=ilike.%                     -> 593 rows — the entire profiles table
//   ?email=ilike.\%                    -> 0 rows
// The first line is the bug reproducing: a lookup for one address returned rows
// belonging to a different one. Two matches then collapse to null through
// .maybeSingle(), and the caller reads that as "no such person."
//
// FOUR METACHARACTERS, NOT TWO
// Postgres LIKE interprets % and _. PostgREST additionally rewrites * to % before
// the pattern ever reaches SQL — verified above: a bare * returned all 593 rows.
// So * must be escaped too, even though it is not a SQL wildcard. A backslash in
// the input has to be escaped first or it would corrupt the escapes that follow;
// the single-pass replace below handles that by construction.
//
// WHAT THIS DOES NOT DO
// It does not decide what to do when two rows genuinely share a key. Escaping
// removes the *false* matches; real duplicates still need resolveOne() from
// ./resolve-one.ts so ambiguity is reported instead of rendered as absence.
// The two are used together at every site converted in MP-277.

/** Characters that alter matching if they survive into an ILIKE pattern. */
const LIKE_METACHARACTERS = /[\\%_*]/g;

/**
 * Escape a value so PostgREST's `.ilike()` matches it literally, making the
 * comparison a case-insensitive equality test.
 *
 * Single-pass on purpose: a naive sequence of .replace() calls that escapes the
 * backslash first and the wildcards afterwards would re-escape its own output.
 */
export function escapeLikePattern(value: string): string {
  return value.replace(LIKE_METACHARACTERS, (ch) => `\\${ch}`);
}

/**
 * Normalize and escape an email for a case-insensitive exact lookup.
 * Callers were already lowercasing and trimming ad hoc; this keeps the two steps
 * together so one can never be applied without the other.
 */
export function emailPattern(email: string): string {
  return escapeLikePattern(email.trim().toLowerCase());
}
