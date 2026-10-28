// Proves the departed / banned predicates every automated sender shares.
//
// No remote imports on purpose: this file must run where deno.land is unreachable
// (the cloud session that wrote it), so the assertions are plain throws.
//
// Run: deno test supabase/functions/_shared/departed.test.ts

import { isBannedUser, isDepartedAgent, walkToLiveUpline, type UplineRow } from "./departed.ts";

function expect(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const live = (id: string, manager_id: string | null = null): UplineRow => ({ id, manager_id, is_deactivated: false, status: "active" });
const gone = (id: string, manager_id: string | null = null, canonical_agent_id: string | null = null): UplineRow =>
  ({ id, manager_id, canonical_agent_id, is_deactivated: true, status: "terminated" });
const table = (rows: UplineRow[]) => async (id: string) => rows.find((r) => r.id === id) ?? null;

Deno.test("a live manager is their own upline; a departed one routes to the first live manager above", async () => {
  const rows = [live("sam"), live("lead", "sam"), gone("kj", "lead")];
  const self = await walkToLiveUpline("lead", table(rows));
  expect(self?.agent.id === "lead" && self.redirected === false, "a live row resolves to itself");
  const up = await walkToLiveUpline("kj", table(rows));
  expect(up?.agent.id === "lead" && up.redirected === true, "a departed row resolves to its live manager");
});

Deno.test("a duplicate's canonical row wins over its manager, and a dead chain refuses", async () => {
  const rows = [live("canon"), gone("dupe", "sam", "canon"), live("sam")];
  const viaCanonical = await walkToLiveUpline("dupe", table(rows));
  expect(viaCanonical?.agent.id === "canon", "canonical_agent_id is followed first");
  const dead = [gone("a", "b"), gone("b", null)];
  expect((await walkToLiveUpline("a", table(dead))) === null, "no live upline must refuse");
  expect((await walkToLiveUpline("missing", table(dead))) === null, "an unknown start must refuse");
});

Deno.test("the walk stops after maxHops and refuses a cycle", async () => {
  const chain = [gone("a", "b"), gone("b", "c"), gone("c", "d"), gone("d", "e"), gone("e", "f"), live("f")];
  expect((await walkToLiveUpline("a", table(chain), 4)) === null, "five hops exceed the cap of four");
  expect((await walkToLiveUpline("a", table(chain), 5))?.agent.id === "f", "a cap of five reaches the live row");
  const cycle = [gone("x", "y"), gone("y", "x")];
  expect((await walkToLiveUpline("x", table(cycle))) === null, "a cycle of departed rows must refuse");
});

Deno.test("a terminated or deactivated agent is departed; an active one is not", () => {
  expect(isDepartedAgent({ is_deactivated: true, status: "active" }), "deactivated must count as departed");
  expect(isDepartedAgent({ is_deactivated: false, status: "terminated" }), "terminated must count as departed");
  expect(!isDepartedAgent({ is_deactivated: false, status: "active" }), "an active agent is not departed");
  expect(!isDepartedAgent({ is_deactivated: null, status: "inactive" }), "inactive is paused, not departed");
});

Deno.test("a missing row is departed: never CC an unknown person", () => {
  expect(isDepartedAgent(null), "null row");
  expect(isDepartedAgent(undefined), "undefined row");
});

Deno.test("a ban in the future blocks; a lapsed ban or no ban does not", () => {
  const now = new Date("2026-10-28T05:00:00Z");
  expect(isBannedUser({ banned_until: "2099-01-01T00:00:00Z" }, now), "the 2099 ban must block");
  expect(!isBannedUser({ banned_until: "2026-01-01T00:00:00Z" }, now), "a lapsed ban does not block");
  expect(!isBannedUser({ banned_until: null }, now), "no ban");
  expect(!isBannedUser({}, now), "no banned_until field");
});

Deno.test("an unreadable ban date or a missing user reads as banned", () => {
  expect(isBannedUser({ banned_until: "not a date" }), "unreadable date must block");
  expect(isBannedUser(null), "missing user must block");
});
