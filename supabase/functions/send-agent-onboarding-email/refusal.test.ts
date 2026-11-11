import { assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { refusalFor, type SuppressionLookup } from "./refusal.ts";

function lookupOf(result: Set<string> | null) {
  const calls: string[][] = [];
  const fn: SuppressionLookup = (emails) => {
    calls.push(emails);
    return Promise.resolve(result);
  };
  return { fn, calls };
}

Deno.test("a suppressed address is refused, matched case- and space-insensitively", async () => {
  const l = lookupOf(new Set(["hire@gmail.com"]));
  const r = await refusalFor("  Hire@Gmail.com ", l.fn);
  assertEquals(r?.name, "suppressed_recipient");
  assertEquals(l.calls, [["hire@gmail.com"]]);
});

Deno.test("a non-routable domain is refused without a lookup", async () => {
  for (const addr of ["agent@placeholder.apex", "x@example.com", "y@foo.invalid"]) {
    const l = lookupOf(new Set());
    const r = await refusalFor(addr, l.fn);
    assertEquals(r?.name, "non_routable_recipient", addr);
    assertEquals(l.calls.length, 0, addr);
  }
});

Deno.test("a failed lookup (null) sends anyway, like gateResend", async () => {
  assertEquals(await refusalFor("hire@gmail.com", lookupOf(null).fn), null);
});

Deno.test("an address that is not suppressed is not refused", async () => {
  assertEquals(await refusalFor("hire@gmail.com", lookupOf(new Set(["other@gmail.com"])).fn), null);
});

Deno.test("a blank address is left to the caller's own missing-email branch", async () => {
  const l = lookupOf(new Set(["hire@gmail.com"]));
  assertEquals(await refusalFor("   ", l.fn), null);
  assertEquals(l.calls.length, 0);
});
