// Proves the departed / banned predicates every automated sender shares.
//
// No remote imports on purpose: this file must run where deno.land is unreachable
// (the cloud session that wrote it), so the assertions are plain throws.
//
// Run: deno test supabase/functions/_shared/departed.test.ts

import { isBannedUser, isDepartedAgent } from "./departed.ts";

function expect(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

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
