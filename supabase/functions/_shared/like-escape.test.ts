// Regression test for the .ilike()-is-not-equality outage (MP-277).
//
// Guards BOTH directions, following header-safe.test.ts: the interesting half is
// the negative one. These tests assert that the UNESCAPED pattern really does
// over-match, so if PostgREST or Postgres ever stopped treating _ % * as special,
// this file would fail loudly rather than quietly protecting nothing.
//
// The matcher below models Postgres LIKE (plus PostgREST's *->% rewrite) so the
// assertions can run offline. It is a model of the DATABASE, not a copy of the
// code under test — every test drives the REAL escapeLikePattern/emailPattern.
// The model itself is pinned to live prod behaviour measured on 2026-08-12:
//   ilike.j_intwan@yahoo.com -> 2 rows   ilike.% -> 593 rows (whole table)
//   ilike.\_...              -> 0 rows   ilike.\% -> 0 rows   ilike.* -> 593 rows
//
// Run: deno test supabase/functions/_shared/like-escape.test.ts
// (header-safe.test.ts documents --allow-none; that flag does not exist in this
//  Deno and the command as written errors out. Copy this invocation, not that one.)
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { emailPattern, escapeLikePattern } from "./like-escape.ts";

/**
 * Case-insensitive Postgres LIKE, including PostgREST's rewrite of * to %.
 * Backslash escapes the next character, exactly as Postgres does by default.
 */
function ilikeMatches(pattern: string, value: string): boolean {
  let re = "";
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === "\\") {
      const next = pattern[++i];
      if (next !== undefined) re += next.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      continue;
    }
    if (ch === "%" || ch === "*") re += "[\\s\\S]*"; // PostgREST rewrites * to %
    else if (ch === "_") re += "[\\s\\S]";
    else re += ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`, "i").test(value);
}

// The exact rows that were live in profiles when this was measured.
const STORED = ["j.intwan@yahoo.com", "J.intwan@yahoo.com", "alexwordu@gmail.com"];
const matches = (pattern: string) => STORED.filter((row) => ilikeMatches(pattern, row));

Deno.test("the model reproduces the measured production behaviour", () => {
  // If these drift, the model no longer describes the database and every other
  // assertion in this file is worthless.
  assertEquals(matches("j_intwan@yahoo.com").length, 2, "underscore must match the dot");
  assertEquals(matches("%").length, STORED.length, "% must match every row");
  assertEquals(matches("*").length, STORED.length, "PostgREST rewrites * to %");
});

Deno.test("the naive unescaped pattern still over-matches — the bug is real", () => {
  // A lookup for j_intwan@yahoo.com returning j.intwan@yahoo.com is a different
  // person's row. Two matches collapse to null through .maybeSingle().
  const hits = matches("j_intwan@yahoo.com");
  assertEquals(hits.length, 2);
  assert(
    !hits.includes("j_intwan@yahoo.com"),
    "every row returned belongs to a different address than the one asked for",
  );
});

Deno.test("escaping reduces each wildcard to a literal", () => {
  assertEquals(matches(escapeLikePattern("j_intwan@yahoo.com")).length, 0);
  assertEquals(matches(escapeLikePattern("%")).length, 0);
  assertEquals(matches(escapeLikePattern("*")).length, 0);
});

Deno.test("escaped patterns still match their own address, case-insensitively", () => {
  const hits = matches(emailPattern("  J.Intwan@Yahoo.com  "));
  assertEquals(hits.length, 2, "both stored case-variants are genuine duplicates");
  for (const hit of hits) assertEquals(hit.toLowerCase(), "j.intwan@yahoo.com");

  assertEquals(matches(emailPattern("ALEXWORDU@GMAIL.COM")), ["alexwordu@gmail.com"]);
});

Deno.test("a backslash in the input is escaped without corrupting later escapes", () => {
  // The failure mode of a two-pass .replace(): escaping \ first, then _, turns
  // "a\_b" into "a\\\_b" — the backslash escape eats the underscore's.
  assertEquals(escapeLikePattern("a\\_b"), "a\\\\\\_b");
  assert(ilikeMatches(escapeLikePattern("a\\_b"), "a\\_b"));
  assert(!ilikeMatches(escapeLikePattern("a\\_b"), "a\\xb"));
});

Deno.test("no metacharacter survives escaping unescaped", () => {
  for (const ch of ["%", "_", "*", "\\"]) {
    assertEquals(escapeLikePattern(ch), `\\${ch}`);
    assertEquals(escapeLikePattern(`x${ch}y`), `x\\${ch}y`);
  }
});
