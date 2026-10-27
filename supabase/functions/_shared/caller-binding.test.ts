// PL-LEAK-GATE-CENSUS (2026-10-27). The pure half of the "whose agent is it"
// verdict. Run: deno test --no-check --allow-read supabase/functions/_shared/caller-binding.test.ts
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { bodyAgentAllowed, callerUid, resolveCallerScope } from "./caller-binding.ts";

Deno.test("callerUid: user callers resolve, the service key and junk do not", () => {
  assertEquals(callerUid("user:3f2a"), "3f2a");
  assertEquals(callerUid("service"), null);
  assertEquals(callerUid("user:"), null);
  assertEquals(callerUid("user:   "), null);
  assertEquals(callerUid(undefined), null);
  assertEquals(callerUid(null), null);
  assertEquals(callerUid("anon"), null);
});

Deno.test("bodyAgentAllowed: staff may name anyone, everyone else only themselves", () => {
  const own = ["a1", "a2"]; // MP-275: one login can own two agents rows
  assert(bodyAgentAllowed("a1", own, false));
  assert(bodyAgentAllowed("a2", own, false));
  assert(!bodyAgentAllowed("victim", own, false));
  assert(!bodyAgentAllowed("", own, false));
  assert(!bodyAgentAllowed(undefined, own, false));
  assert(!bodyAgentAllowed(null, own, false));
  assert(!bodyAgentAllowed(42, own, false));
  // A stranger: valid JWT, no agents row, nothing to be allowed about.
  assert(!bodyAgentAllowed("victim", [], false));
  assert(!bodyAgentAllowed("a1", [], false));
  // Staff enter for team members.
  assert(bodyAgentAllowed("victim", [], true));
});

function fakeClient(tables: Record<string, { data?: unknown; error?: unknown }>) {
  const calls: string[] = [];
  const client = {
    from(table: string) {
      calls.push(table);
      const result = tables[table] ?? { data: [], error: null };
      const chain = {
        select: () => chain,
        eq: () => Promise.resolve(result),
      };
      return chain;
    },
  };
  return { client, calls };
}

Deno.test("resolveCallerScope: reads both tables, keeps every own row, grades staff by STAFF_ROLES", async () => {
  const { client, calls } = fakeClient({
    user_roles: { data: [{ role: "agent" }, { role: "va" }], error: null },
    agents: { data: [{ id: "a1" }, { id: "a2" }], error: null },
  });
  const scope = await resolveCallerScope(client, "u1");
  assertEquals(scope, { ownAgentIds: ["a1", "a2"], isStaff: true });
  assertEquals(calls.sort(), ["agents", "user_roles"]);
});

Deno.test("resolveCallerScope: the 'agent' role alone is not staff (every signup holds it)", async () => {
  const { client } = fakeClient({
    user_roles: { data: [{ role: "agent" }], error: null },
    agents: { data: [], error: null },
  });
  assertEquals(await resolveCallerScope(client, "u1"), { ownAgentIds: [], isStaff: false });
});

Deno.test("resolveCallerScope: a failed read is null, never an empty-but-ok scope", async () => {
  const rolesDown = fakeClient({ user_roles: { data: null, error: { message: "down" } }, agents: { data: [{ id: "a1" }], error: null } });
  assertEquals(await resolveCallerScope(rolesDown.client, "u1"), null);
  const agentsDown = fakeClient({ user_roles: { data: [], error: null }, agents: { data: null, error: { message: "down" } } });
  assertEquals(await resolveCallerScope(agentsDown.client, "u1"), null);
});
