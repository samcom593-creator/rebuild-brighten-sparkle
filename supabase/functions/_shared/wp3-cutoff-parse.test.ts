// Proves the WP3 cutoff parser on the exact text Postgres stores. A naive
// Date.parse(value.replace(" ", "T")) returns NaN on "+00", which would have made
// both forward-only gates send nothing forever; the last case pins that.
// Run: deno test supabase/functions/_shared/wp3-cutoff-parse.test.ts

import { parseWp3Cutoff } from "./wp3-cutoff.ts";

function expect(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

Deno.test("Postgres timestamptz text parses to the right instant", () => {
  const ms = parseWp3Cutoff("2026-11-10 21:21:26.375973+00");
  expect(Number.isFinite(ms), "cutoff did not parse");
  expect(new Date(ms).toISOString() === "2026-11-10T21:21:26.375Z", `wrong instant ${new Date(ms).toISOString()}`);
});

Deno.test("full offsets and ISO forms still parse", () => {
  expect(new Date(parseWp3Cutoff("2026-11-10 14:21:26-07")).toISOString() === "2026-11-10T21:21:26.000Z", "-07 offset");
  expect(new Date(parseWp3Cutoff("2026-11-10T21:21:26+00:00")).toISOString() === "2026-11-10T21:21:26.000Z", "+00:00 offset");
});

Deno.test("missing or garbage is NaN (gates then send nothing)", () => {
  expect(!Number.isFinite(parseWp3Cutoff("not a date")), "garbage parsed");
  expect(!Number.isFinite(parseWp3Cutoff(null)), "null parsed");
  expect(!Number.isFinite(parseWp3Cutoff("")), "empty parsed");
});

Deno.test("the naive parse really does fail (why this helper exists)", () => {
  expect(!Number.isFinite(Date.parse("2026-11-10T21:21:26.375973+00")), "V8 now accepts +00; the helper may be simplified");
});
