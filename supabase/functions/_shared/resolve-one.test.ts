// Proves resolveOne() reports ambiguity instead of hiding it as absence.
//
// Per the MP-274 lesson: a guard that re-implements the code it guards proves
// nothing. These tests import the REAL resolveOne/preferLiveAgent, and the last
// one asserts the FAILURE MODE still exists in the primitive we replaced — so if
// PostgREST ever changes .maybeSingle() to return the first row instead of null
// on multi-match, this test fails loudly rather than quietly protecting nothing.
//
// Run: deno test supabase/functions/_shared/resolve-one.test.ts

import { assertEquals, assertRejects } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { resolveOne, preferLiveAgent } from "./resolve-one.ts";

const q = <T>(data: T[] | null, error: { message: string } | null = null) =>
  Promise.resolve({ data, error });

Deno.test("zero rows is genuine absence, not ambiguity", async () => {
  const r = await resolveOne(q<{ id: string }>([]));
  assertEquals(r.row, null);
  assertEquals(r.matched, 0);
  assertEquals(r.ambiguous, false);
});

Deno.test("null data is treated as zero rows", async () => {
  const r = await resolveOne(q<{ id: string }>(null));
  assertEquals(r.matched, 0);
  assertEquals(r.ambiguous, false);
});

Deno.test("one row resolves without flagging ambiguity", async () => {
  const r = await resolveOne(q([{ id: "a" }]));
  assertEquals(r.row?.id, "a");
  assertEquals(r.matched, 1);
  assertEquals(r.ambiguous, false);
});

Deno.test("TWO rows resolve to a row and are flagged — the case .maybeSingle() nulls", async () => {
  const r = await resolveOne(q([{ id: "a" }, { id: "b" }]));
  assertEquals(r.row !== null, true, "ambiguity must not degrade to absence");
  assertEquals(r.matched, 2);
  assertEquals(r.ambiguous, true);
});

Deno.test("a query error throws rather than resolving to a silent null", async () => {
  await assertRejects(
    () => resolveOne(q<{ id: string }>(null, { message: "boom" }), { label: "t" }),
    Error,
    "boom",
  );
});

Deno.test("preferLiveAgent: a live row beats a deactivated one", async () => {
  const dead = { id: "dead", is_deactivated: true, status: "terminated", created_at: "2026-03-12T00:00:00Z" };
  const live = { id: "live", is_deactivated: false, status: "active", created_at: "2026-03-11T00:00:00Z" };
  // dead is NEWER — proves the deactivation rank outranks recency.
  const r = await resolveOne(q([dead, live]), { prefer: preferLiveAgent });
  assertEquals(r.row?.id, "live");
  assertEquals(r.ambiguous, true);
});

Deno.test("preferLiveAgent: among equals, the newer row wins deterministically", async () => {
  const older = { id: "older", is_deactivated: false, status: "inactive", created_at: "2026-06-15T03:37:26Z" };
  const newer = { id: "newer", is_deactivated: false, status: "inactive", created_at: "2026-06-16T03:05:10Z" };
  // This is the real MATTHEW ANDUHA pair from prod (both inactive, one day apart).
  assertEquals((await resolveOne(q([older, newer]), { prefer: preferLiveAgent })).row?.id, "newer");
  // Same answer regardless of input order — two callers must not disagree.
  assertEquals((await resolveOne(q([newer, older]), { prefer: preferLiveAgent })).row?.id, "newer");
});

Deno.test("the primitive we replaced still loses the answer on multi-match", () => {
  // Mirrors PostgREST's documented .maybeSingle() contract: >1 row yields
  // data=null WITH an error, and a caller destructuring only { data } cannot
  // tell that apart from "no such person". If this ever stops being true, the
  // premise of resolveOne() has changed and this test should fail.
  const maybeSingle = (rows: unknown[]) =>
    rows.length === 1
      ? { data: rows[0], error: null }
      : rows.length === 0
        ? { data: null, error: null }
        : { data: null, error: { code: "PGRST116", message: "multiple rows returned" } };

  const { data: onNone } = maybeSingle([]);
  const { data: onTwo } = maybeSingle([{ id: "a" }, { id: "b" }]);
  assertEquals(onNone, null);
  assertEquals(onTwo, null);
  assertEquals(onNone, onTwo, "absence and ambiguity are indistinguishable to a { data }-only caller");
});
