import { completionOwner, confirmFieldTrainingStage } from "./contract.ts";

function equal(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
}
const identity = { user_id: "merged-login", agent_id: "canonical", agent_ids: ["canonical", "historical-alias"] };

Deno.test("verified merged login can complete its canonical course", () => {
  equal(completionOwner({ data: identity, error: null }, "merged-login", "canonical").ok, true);
});

Deno.test("foreign caller, alias target, missing family and denied identity cannot complete a course", () => {
  for (const [reply, user, agent] of [
    [{ data: identity, error: null }, "another-login", "canonical"],
    [{ data: identity, error: null }, "merged-login", "historical-alias"],
    [{ data: { ...identity, agent_ids: [] }, error: null }, "merged-login", "canonical"],
    [{ data: null, error: { message: "suspended" } }, "merged-login", "canonical"],
    [{ data: null, error: null }, "merged-login", "canonical"],
  ] as const) equal(completionOwner(reply, user, agent).ok, false);
});

function stageClient(reply: { data: unknown; error: unknown }, calls: unknown[]) {
  const chain = {
    update(value: unknown) { calls.push(["update", value]); return chain; },
    eq(key: string, value: string) { calls.push(["eq", key, value]); return chain; },
    select(value: string) { calls.push(["select", value]); return chain; },
    single() { return Promise.resolve(reply); },
  };
  return { from(name: string) { calls.push(["from", name]); return chain; } };
}

Deno.test("field training stage requires a matching saved row before continuation", async () => {
  const calls: unknown[] = [];
  await confirmFieldTrainingStage(stageClient({ data: { id: "canonical", onboarding_stage: "in_field_training" }, error: null }, calls), "canonical");
  equal(calls, [["from", "agents"], ["update", { onboarding_stage: "in_field_training" }], ["eq", "id", "canonical"], ["select", "id, onboarding_stage"]]);
});

Deno.test("write error, zero rows, wrong row or unconfirmed stage cannot produce success", async () => {
  for (const reply of [
    { data: null, error: { message: "write failed" } },
    { data: null, error: null },
    { data: { id: "another", onboarding_stage: "in_field_training" }, error: null },
    { data: { id: "canonical", onboarding_stage: "training_online" }, error: null },
  ]) {
    let continued = false;
    let refusal: unknown;
    try { await confirmFieldTrainingStage(stageClient(reply, []), "canonical"); continued = true; } catch (error) { refusal = error; }
    equal(refusal instanceof Error, true);
    equal(continued, false);
  }
});
