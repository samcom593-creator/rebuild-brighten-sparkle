// Regression test for the double-escaped email validator (MP-553).
//
// v.email() rejected 11 of 11 valid addresses. It had ZERO callers, so no user
// was ever turned away — it was a landmine in the shared module every handler
// imports, not a live leak. This file is what makes adopting it safe.
//
// Following header-safe.test.ts and like-escape.test.ts: the interesting half is
// the NEGATIVE one. The tests below assert that the OLD, double-escaped pattern
// really did reject everything. If a future JS engine ever changed how `\\` is
// read inside a regex literal, this file fails loudly instead of quietly
// standing guard over a bug that no longer exists.
//
// Run: deno test supabase/functions/_shared/validate.email.test.ts
import { assert, assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { v, ValidationError } from "./validate.ts";

/**
 * The pattern EXACTLY as it was written at validate.ts:41 before MP-553.
 * Kept verbatim on purpose — this is the specimen, not a paraphrase of it.
 */
const OLD_BROKEN = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/;

const VALID = [
  "sam@apex.com",
  "sam.com593@gmail.com",
  "a@b.co",
  "kj@apexfinancial.org",
  "josh@x.io",
  "o'brien@x.co",
  "first.last+tag@sub.domain.org",
];

const INVALID = [
  "noat.com",        // no @
  "a@b",             // no dot in domain
  "a b@c.com",       // space in local part
  "a@b c.com",       // space in domain
  "",                // empty
  "@b.co",           // empty local part
  "a@.co",           // empty domain label -- rejected by [^\s@]+ before the dot
];

Deno.test("v.email() accepts ordinary addresses", () => {
  const email = v.email();
  for (const addr of VALID) {
    assertEquals(email(addr), addr.toLowerCase(), `should accept ${addr}`);
  }
});

Deno.test("v.email() rejects malformed addresses", () => {
  const email = v.email();
  for (const addr of INVALID) {
    assertThrows(() => email(addr), ValidationError, "email", `should reject ${JSON.stringify(addr)}`);
  }
});

Deno.test("v.email() normalizes case and surrounding whitespace", () => {
  const email = v.email();
  assertEquals(email("SAM@APEX.COM"), "sam@apex.com");
  // Trailing whitespace is trimmed AFTER the pattern runs, so it must not be
  // present for the match to succeed -- documented here so the ordering is a
  // tested fact rather than an assumption a caller has to reverse-engineer.
  assertThrows(() => email(" sam@apex.com "), ValidationError);
});

Deno.test("v.email() rejects non-strings", () => {
  const email = v.email();
  for (const bad of [undefined, null, 42, {}, ["a@b.co"]]) {
    assertThrows(() => email(bad), ValidationError);
  }
});

// ---------------------------------------------------------------------------
// The negative half: prove the specimen was really broken.
// ---------------------------------------------------------------------------

Deno.test("the pre-MP-553 pattern rejected every valid address", () => {
  for (const addr of VALID) {
    assert(!OLD_BROKEN.test(addr), `old pattern should have rejected ${addr}`);
  }
});

Deno.test("the pre-MP-553 pattern demanded a literal backslash", () => {
  // `\\.` outside a character class is backslash-then-any-char, so the only
  // strings it accepted contained a real backslash. This is the fault that took
  // the accept rate to zero.
  assert(OLD_BROKEN.test("a@b\\.c"), "old pattern accepted an address with a backslash");
  assert(OLD_BROKEN.test("ab@cd\\ef"), "old pattern accepted any char after the backslash");
});

Deno.test("the pre-MP-553 character class excluded the letter s", () => {
  // `[^\\s@]` is "not backslash, not the letter s, not @" -- NOT "not
  // whitespace". Fixing only the `\\.` half would have left this behind: a
  // validator that accepts bob@x.co and rejects sam@x.co. Asserting both sides
  // is what makes that distinction a tested fact.
  const CLASS_ONLY = /^[^\\s@]+$/;
  assert(CLASS_ONLY.test("bob"), "class admitted a word without 's'");
  assert(!CLASS_ONLY.test("sam"), "class excluded a word containing 's'");
  assert(!CLASS_ONLY.test("\\"), "class excluded a literal backslash");
  // and the corrected class treats both alike, because it means whitespace
  assert(/^[^\s@]+$/.test("sam") && /^[^\s@]+$/.test("bob"));
  assert(!/^[^\s@]+$/.test("a b"), "corrected class excludes real whitespace");
});
