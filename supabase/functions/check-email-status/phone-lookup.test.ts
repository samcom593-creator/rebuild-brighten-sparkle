// PL-WIB-PHONE-LOOKUP-FORMAT. A phone login on /agent-login found nobody for
// 63 agents whose profile phone is stored with punctuation. See phone-lookup.ts.
//
// Run: deno test --no-check --allow-read supabase/functions/check-email-status/phone-lookup.test.ts
// Wired: npm run check:deno-tests (verify:core).
import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { phoneCandidatePattern, phoneTen, pickPhoneMatch } from "./phone-lookup.ts";

// Postgres ILIKE, case-sensitivity aside, for the patterns this module builds.
function likeMatches(value: string, pattern: string): boolean {
  const re = new RegExp(
    "^" + pattern.split("%").map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$",
  );
  return re.test(value);
}

// Every stored shape seen in profiles.phone on 2026-10-09.
const STORED = ["7138828503", "(713) 882-8503", "+17138828503", "17138828503", "713-882-8503", "+1 (713) 882-8503"];

Deno.test("the candidate pattern reaches every stored shape of the same number", () => {
  const p = phoneCandidatePattern("7138828503")!;
  for (const s of STORED) assertEquals(likeMatches(s, p), true, s);
});

Deno.test("the old pattern missed the punctuated shapes (the bug)", () => {
  const old = "%7138828503%";
  assertEquals(likeMatches("(713) 882-8503", old), false);
  assertEquals(likeMatches("713-882-8503", old), false);
});

Deno.test("a loose pattern hit with different digits is never picked", () => {
  const rows = [{ phone: "7130882285030" }, { phone: "(713) 882-8504" }, { phone: "(713) 882-8503", id: "self" }];
  assertEquals(pickPhoneMatch(rows, "7138828503"), rows[2]);
  assertEquals(pickPhoneMatch(rows.slice(0, 2), "7138828503"), null);
});

Deno.test("newest-first order is kept: the first exact match wins", () => {
  const rows = [{ phone: "713-882-8503", id: "newer" }, { phone: "7138828503", id: "older" }];
  assertEquals(pickPhoneMatch(rows, "7138828503"), rows[0]);
});

Deno.test("nothing that is not ten digits builds a pattern or matches", () => {
  for (const bad of ["", "713882850", "%", "71388285031", "713882850a"]) {
    assertEquals(phoneCandidatePattern(bad), null, bad);
    assertEquals(pickPhoneMatch([{ phone: bad }], bad), null, bad);
  }
  assertEquals(phoneTen("+1 (713) 882-8503"), "7138828503");
});

Deno.test("a non-US number sharing the last ten digits is never picked", () => {
  // slice(-10) read both of these as 7138828503 and returned the profile.
  const rows = [{ phone: "+44 713 882 8503", id: "uk" }, { phone: "0447138828503", id: "intl" }];
  assertEquals(pickPhoneMatch(rows, "7138828503"), null);
  assertEquals(phoneTen("+44 713 882 8503"), "");
});

Deno.test("index.ts decides on pickPhoneMatch, and a read error is not 'not on file'", async () => {
  const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  assertStringIncludes(src, "pickPhoneMatch(data, last10)");
  assertEquals(src.includes("phone.ilike.%${last10}%"), false);
  assertStringIncludes(src, "status: 503");
});
