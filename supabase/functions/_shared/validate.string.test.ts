// Run: deno test supabase/functions/_shared/validate.string.test.ts
//
// MP-549. v.string() carries ONE cast: the implementation returns
// Validator<string | undefined> and is asserted to StringValidatorFactory,
// whose first call signature promises Validator<string> when required is true.
// That promise is only true because of the throw at validate.ts:15. These
// assertions are that throw, pinned — if someone makes `required` stop
// throwing, the cast becomes a lie and this file goes red.
//
// WHAT THIS FILE DOES NOT GUARD, stated rather than implied: check:deno-tests
// runs deno with --no-check (see its header — nanp-phone.test.ts imports
// browser code Deno's checker rejects), so type-level assertions written here
// would be executed by nothing. The TYPE half is guarded instead by
// check:deno-typecheck: notify-deal-alert, notify-notes-added and verify-nipr
// were removed from scripts/deno-typecheck-baseline.json in the same commit,
// so reverting the factory type makes all three fail as regressions. Both
// directions are mutation-proven in that commit's message.
import { assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { v, ValidationError } from "./validate.ts";

Deno.test("required: true throws on every empty form — this is what the cast stands on", () => {
  const required = v.string({ required: true });
  for (const empty of [undefined, null, ""]) {
    assertThrows(() => required(empty), ValidationError, "is required");
  }
});

Deno.test("required: true returns the string itself when present", () => {
  assertEquals(v.string({ required: true })("Sam James"), "Sam James");
});

Deno.test("without required, the same empty forms return undefined instead of throwing", () => {
  const optional = v.string({});
  for (const empty of [undefined, null, ""]) {
    assertEquals(optional(empty), undefined);
  }
});

Deno.test("the cast did not disturb the other options: min, max and type still enforce", () => {
  assertThrows(() => v.string({ required: true, min: 2 })("a"), ValidationError, "min length 2");
  assertThrows(() => v.string({ required: true, max: 3 })("abcd"), ValidationError, "max length 3");
  assertThrows(() => v.string({ required: true })(42), ValidationError, "must be a string");
});

Deno.test("v.object propagates the required throw under the field's own name", () => {
  const schema = v.object({ agentName: v.string({ required: true, max: 128 }) });
  assertThrows(() => schema({}), ValidationError, "agentName: is required");
  assertEquals(schema({ agentName: "Sam" }), { agentName: "Sam" });
});
