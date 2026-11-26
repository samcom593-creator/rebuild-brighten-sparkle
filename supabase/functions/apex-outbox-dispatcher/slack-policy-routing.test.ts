import { assertEquals, assertRejects } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { policySlackTarget } from "./slack-policy-routing.ts";
const p = { agentId: "agent", slackUserId: "U123456789", slackInstallationId: "workspace" };
function database(identity: unknown, error: unknown = null) {
  const filters: Record<string, unknown> = {};
  const chain = {
    select() { return chain; },
    eq(key: string, value: unknown) { filters[key] = value; return chain; },
    maybeSingle() { return Promise.resolve({ data: identity, error }); },
  };
  return { filters, from(table: string) { assertEquals(table, "messaging_identity_links"); return chain; } };
}
Deno.test("policy routing DMs only a verified active agent in the route workspace", async () => {
  for (const event of ["policy.status_changed", "policy.chargeback"]) {
    const db = database({ slack_user_id: "U123456789" });
    assertEquals(await policySlackTarget(db, event, p, "workspace", "manager_ops", "C_OPS"), "U123456789");
    assertEquals(db.filters, { installation_id: "workspace", agent_id: "agent",
      slack_user_id: "U123456789", verification_status: "verified", "agents.status": "active" });
  }
});
Deno.test("missing, revoked, malformed and wrong-workspace identities fall back to manager ops", async () => {
  for (const payload of [{}, p, { ...p, slackInstallationId: "other" }]) {
    assertEquals(await policySlackTarget(database(null), "policy.status_changed", payload,
      "workspace", "manager_ops", "C_OPS"), "C_OPS");
  }
  assertEquals(await policySlackTarget(database({ slack_user_id: "<!channel>" }), "policy.chargeback", p,
    "workspace", "manager_ops", "C_OPS"), "C_OPS");
});
Deno.test("policy events cannot fan out to sales channels; existing events keep their routes", async () => {
  assertEquals(await policySlackTarget(null, "policy.chargeback", p, "workspace", "sales_wins", "C_SALES"), null);
  assertEquals(await policySlackTarget(null, "deal.posted", p, "workspace", "sales_wins", "C_SALES"), "C_SALES");
});
Deno.test("identity query errors retry rather than guessing a recipient", async () => {
  await assertRejects(() => policySlackTarget(database(null, new Error("database down")),
    "policy.chargeback", p, "workspace", "manager_ops", "C_OPS"), Error, "database down");
});
