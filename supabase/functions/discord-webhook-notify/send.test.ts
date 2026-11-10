// WP7: a deleted (10015) or revoked (50027) Discord webhook is terminal after
// ONE call, while a transient 5xx still retries and a 404 without the 10015
// code (e.g. a proxy page) is not mistaken for a dead webhook.
//
// Run: deno test supabase/functions/discord-webhook-notify/send.test.ts

import { assert, assertEquals, assertRejects } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { sendToDiscord, WebhookDeadError } from "./send.ts";

// Same fixture shape as contractingDelivery.test.ts: no numeric webhook id, so
// check:metric-truth can never mistake it for a real credential.
const WEBHOOK = "https://discord.com/api/webhooks/fixture-not-a-real-webhook";
const noSleep = () => Promise.resolve();

function stub(responses: Array<() => Response>) {
  let calls = 0;
  const fetchImpl = ((_input: unknown, _init?: unknown) => {
    const next = responses[Math.min(calls, responses.length - 1)];
    calls += 1;
    return Promise.resolve(next());
  }) as typeof fetch;
  return { fetchImpl, calls: () => calls };
}

Deno.test("404 + code 10015 is terminal after exactly one call", async () => {
  const s = stub([() => new Response(JSON.stringify({ message: "Unknown Webhook", code: 10015 }), { status: 404 })]);
  const err = await assertRejects(
    () => sendToDiscord(WEBHOOK, { content: "x" }, { fetchImpl: s.fetchImpl, sleep: noSleep }),
    WebhookDeadError,
  );
  assertEquals(err.terminal, "webhook_dead");
  assertEquals(err.discordCode, 10015);
  assertEquals(s.calls(), 1);
});

Deno.test("401 + code 50027 is terminal after exactly one call", async () => {
  const s = stub([() => new Response(JSON.stringify({ message: "Invalid Webhook Token", code: 50027 }), { status: 401 })]);
  await assertRejects(
    () => sendToDiscord(WEBHOOK, { content: "x" }, { fetchImpl: s.fetchImpl, sleep: noSleep }),
    WebhookDeadError,
  );
  assertEquals(s.calls(), 1);
});

Deno.test("a 404 WITHOUT code 10015 is not called dead and still retries", async () => {
  const s = stub([() => new Response("<html>not found</html>", { status: 404 })]);
  const err = await assertRejects(
    () => sendToDiscord(WEBHOOK, { content: "x" }, { fetchImpl: s.fetchImpl, sleep: noSleep }),
    Error,
  );
  assert(!(err instanceof WebhookDeadError));
  assertEquals(s.calls(), 4);
});

Deno.test("a transient 500 then success returns the message id", async () => {
  const s = stub([
    () => new Response("upstream", { status: 500 }),
    () => new Response(JSON.stringify({ id: "1234567890" }), { status: 200 }),
  ]);
  const r = await sendToDiscord(WEBHOOK, { content: "x" }, { fetchImpl: s.fetchImpl, sleep: noSleep });
  assertEquals(r.messageId, "1234567890");
  assertEquals(s.calls(), 2);
});
