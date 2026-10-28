// Proves schedule-auto-populate never hands a schedule item (a calendar_events row
// and the summary email) to a departed agent.
//
// No remote imports on purpose: this file must run where deno.land is unreachable,
// so the assertions are plain throws.
//
// Run: deno test --no-check --allow-read supabase/functions/schedule-auto-populate/manager-resolve.test.ts

import {
  type AgentRow,
  type Manager,
  managerForAgent,
  managerForApplication,
  type ProfileRow,
} from "./manager-resolve.ts";

function expect(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function agent(id: string, over: Partial<AgentRow> = {}): AgentRow {
  return {
    id,
    user_id: `u-${id}`,
    invited_by_manager_id: null,
    manager_id: null,
    display_name: id,
    agent_code: null,
    is_deactivated: false,
    status: "active",
    ...over,
  };
}

const fallback: Manager = { userId: "u-admin", email: "admin@example.test", name: "Admin" };

function world(rows: AgentRow[]) {
  const agents = new Map(rows.map((r) => [r.id, r]));
  const profiles = new Map<string, ProfileRow>();
  for (const r of rows) {
    if (r.user_id) profiles.set(r.user_id, { user_id: r.user_id, email: `${r.id}@example.test`, full_name: r.id });
  }
  return { agents, profiles };
}

Deno.test("a live inviting manager owns the item", () => {
  const { agents, profiles } = world([agent("mgr"), agent("rep", { invited_by_manager_id: "mgr" })]);
  const m = managerForAgent("rep", agents, profiles, fallback);
  expect(m.userId === "u-mgr" && m.email === "mgr@example.test", `the inviting manager should own it, got ${m.userId}`);
});

Deno.test("a departed inviting manager yields to the operational manager", () => {
  const { agents, profiles } = world([
    agent("kj", { status: "terminated", is_deactivated: true }),
    agent("sam"),
    agent("rep", { invited_by_manager_id: "kj", manager_id: "sam" }),
  ]);
  const m = managerForAgent("rep", agents, profiles, fallback);
  expect(m.userId === "u-sam", `the operational manager should own it, got ${m.userId}`);
});

Deno.test("with no live manager the agent owns their own item; a departed agent never does", () => {
  const { agents, profiles } = world([agent("kj", { status: "terminated" }), agent("solo", { invited_by_manager_id: "kj" })]);
  expect(managerForAgent("solo", agents, profiles, fallback).userId === "u-solo", "the live agent should own it");

  const dead = world([agent("kj", { status: "terminated", is_deactivated: true })]);
  const m = managerForAgent("kj", dead.agents, dead.profiles, fallback);
  expect(m.userId === fallback.userId, `a departed agent's item goes to the fallback admin, got ${m.userId}`);
});

Deno.test("an unknown agent id or a missing manager row falls through", () => {
  const { agents, profiles } = world([agent("rep", { invited_by_manager_id: "ghost" })]);
  expect(managerForAgent("rep", agents, profiles, fallback).userId === "u-rep", "missing manager row: the agent owns it");
  expect(managerForAgent("nobody", agents, profiles, fallback).userId === fallback.userId, "unknown agent: fallback");
  expect(managerForAgent(null, agents, profiles, fallback) === fallback, "no agent: fallback");
});

Deno.test("a departed or banned hiring manager yields to the assigned agent's chain", () => {
  const { agents, profiles } = world([agent("mgr"), agent("rep", { invited_by_manager_id: "mgr" })]);
  profiles.set("u-kj", { user_id: "u-kj", email: "kj@example.test", full_name: "KJ" });
  const app = { hiring_manager_user_id: "u-kj", assigned_agent_id: "rep", recruiter_id: null };

  expect(managerForApplication(app, agents, profiles, fallback).userId === "u-kj", "a hiring manager not known to be departed is kept");
  const m = managerForApplication(app, agents, profiles, fallback, new Set(["u-kj"]));
  expect(m.userId === "u-mgr", `a departed hiring manager must yield to the assigned agent's manager, got ${m.userId}`);
});
