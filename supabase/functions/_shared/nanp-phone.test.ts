// MP-420. Two jobs, and the second is the load-bearing one.
//
// 1. nanpTenDigits refuses every non-NANP value instead of truncating it.
// 2. The Deno copy and the browser copy (src/lib/phone.ts, MP-416) agree on
//    every fixture. Both files independently implement the same rule; a guard
//    that only tests one of them is a guard that lets them drift, and the
//    drift is invisible because each half looks correct on its own.
//
// Every fixture in PROD_NON_NANP is a real applications.phone value read out of
// prod on 2026-09-04, with the number the OLD code would have texted instead.
//
// Run: deno test --no-check --allow-read supabase/functions/_shared/nanp-phone.test.ts
//
// --no-check is REQUIRED and is not laziness: this file imports the browser
// copy, and Deno's type-checker rejects src/lib/phone.ts on window.matchMedia /
// window.open, which are correct in a Vite build and absent from Deno's lib.
// Skipping the check here does not leave the Deno half unchecked -- the proof
// harness runs `deno check` on nanp-phone.ts itself, and src/ is covered by the
// repo's own tsc gate. What this test compares is RUNTIME behaviour, which is
// the only thing a drift between the two copies can show up in.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { legacySliceTen, nanpRefusalReason, nanpTenDigits, toE164 } from "./nanp-phone.ts";
import { nationalDigits, normalizePhoneForDial } from "../../../src/lib/phone.ts";

// [stored value, what slice(-10) would have addressed]
const PROD_NON_NANP: [string, string][] = [
  ["4407458992081", "7458992081"],
  ["2348061399263", "8061399263"],
  ["817018492118", "7018492118"],
  ["628211684958", "8211684958"],
  ["525513018374", "5513018374"],
  ["233553086402", "3553086402"],
  ["393500764101", "3500764101"],
  ["254797744561", "4797744561"],
  ["258861918593", "8861918593"],
  ["351923187645", "1923187645"],
  ["01141330024", "1141330024"],
  ["61400266198", "1400266198"],
  ["34685580335", "4685580335"],
  ["09078401144", "9078401144"],
  ["09075871276", "9075871276"],
  ["07700808776", "7700808776"],
  ["09158281963", "9158281963"],
  ["27631614655", "7631614655"],
  ["60088898110", "0088898110"],
  ["31133313111", "1133313111"],
  ["+258861918593", "8861918593"],
];

// Real NANP shapes that MUST keep working. 457 of the 463 distinct phones
// texted in the last 90 days are one of these shapes; refusing any of them
// would break a working channel to fix a leak.
const PROD_NANP: [string, string][] = [
  ["6184381249", "6184381249"],
  ["16184381249", "6184381249"],
  ["+16184381249", "6184381249"],
  ["+1 618 438 1249", "6184381249"],
  ["(618) 438-1249", "6184381249"],
  ["618-438-1249", "6184381249"],
  ["+1 (618) 438-1249", "6184381249"],
];

Deno.test("refuses every non-NANP value found in prod", () => {
  for (const [stored] of PROD_NON_NANP) {
    assertEquals(nanpTenDigits(stored), null, `should refuse ${stored}`);
  }
});

Deno.test("the primitive it replaced still addresses a stranger", () => {
  // The negative half. If slice(-10) ever stopped truncating, this file would
  // fail loudly instead of quietly protecting nothing.
  for (const [stored, strangersNumber] of PROD_NON_NANP) {
    assertEquals(
      legacySliceTen(stored),
      strangersNumber,
      `legacy primitive changed behaviour on ${stored}`,
    );
    assertEquals(legacySliceTen(stored).length, 10);
    // ...and this is why the old length gate could not catch it.
    assert(
      legacySliceTen(stored).length === 10,
      "the `cleaned.length !== 10` gate can never see an 11th digit",
    );
  }
});

Deno.test("keeps every NANP shape working", () => {
  for (const [stored, expected] of PROD_NANP) {
    assertEquals(nanpTenDigits(stored), expected, `should accept ${stored}`);
  }
});

Deno.test("Deno copy and browser copy agree on every fixture", () => {
  for (const [stored] of [...PROD_NON_NANP, ...PROD_NANP]) {
    assertEquals(
      nanpTenDigits(stored),
      nationalDigits(stored),
      `nanp-phone.ts and src/lib/phone.ts disagree on ${stored}`,
    );
    assertEquals(
      toE164(stored),
      normalizePhoneForDial(stored),
      `E164 forms disagree on ${stored}`,
    );
  }
});

Deno.test("edge inputs refuse rather than throw", () => {
  for (const v of [null, undefined, "", "   ", "abc", "0000000000", "+", "12345"]) {
    assertEquals(nanpTenDigits(v as string | null | undefined), null, `should refuse ${String(v)}`);
  }
});

Deno.test("refusal reason is specific, and never claims a country it cannot read", () => {
  // With a + on the record, the country code is real and gets named.
  assert(nanpRefusalReason("+258861918593").includes("+258"));
  // Without one -- which is how all 21 prod rows are actually stored -- there
  // is no country code to read, so it reports the digit count instead of
  // inventing one. Guessing the country here would be the same error as
  // guessing the last ten digits.
  const bare = nanpRefusalReason("2348061399263");
  assert(bare.includes("13 digits"), bare);
  assert(!bare.includes("+234"), "must not invent a country code that is not on the record");
  assertEquals(nanpRefusalReason(null), "no phone on file");
  assert(nanpRefusalReason("abc").includes("0 digits"));
});
