// MP-550. Pins the encoder that seminar-confirmation's .ics attachment stands on.
//
// This test imports the REAL base64Utf8 -- it does not re-implement it. A test
// that copies the code it guards proves only that the copy works (MP-274).
//
// It also asserts that the NAIVE construction still throws. That direction is
// load-bearing: if a future Deno stops throwing on non-Latin1 input to btoa, this
// file must fail loudly rather than quietly protect nothing.
import { assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { base64Utf8 } from "./base64-utf8.ts";

const decode = (b64: string) =>
  new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));

Deno.test("the exact live crash input: an em-dash in the .ics event title", () => {
  // Verbatim from the deployed template that threw on every applicant.
  const body = "BEGIN:VCALENDAR\r\nSUMMARY:Apex Seminar — Welcome Zoom\r\nEND:VCALENDAR\r\n";

  assertThrows(
    () => btoa(body),
    Error,
    "Latin1",
    "btoa must still reject non-Latin1 input -- if this stops throwing, the guard below is inert",
  );

  assertEquals(decode(base64Utf8(body)), body, "must round-trip byte-identically");
});

Deno.test("survives the character classes a human can put in system_settings", () => {
  // seminar_host_name and seminar_from_email are human-edited values that reach
  // the .ics as ORGANIZER;CN=. An accent or a curly apostrophe there must not
  // take the function down the way the em-dash did.
  for (const s of ["José", "Chloé", "Müller", "Sam’s team", "🎓 grad", "plain ascii"]) {
    assertEquals(decode(base64Utf8(s)), s, `round-trip failed for: ${s}`);
  }
});

Deno.test("pure ASCII encodes identically to btoa", () => {
  const s = "BEGIN:VCALENDAR\r\nUID:apex-seminar@apex-financial.org\r\nEND:VCALENDAR\r\n";
  assertEquals(base64Utf8(s), btoa(s));
});

Deno.test("a body large enough to blow the apply() argument limit", () => {
  // The chunked fromCharCode is not decoration: spreading a large Uint8Array
  // into apply() throws RangeError on a body that is merely big, not non-ASCII.
  const s = "x".repeat(300_000) + "—";
  assertEquals(decode(base64Utf8(s)), s);
});
