import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

import { verifySlackRequest, verifySlackSignature } from "./slack-verify.ts";

const signingSecret = "8f742231b10e8888abcd99yyyzzz85a5";
const timestamp = 1531420618;
const rawBody =
  "token=xyzz0WbapA4vBCDEFasx0q6G&team_id=T1DC2JH3J&team_domain=testteamnow&channel_id=G8PSS9T3V&channel_name=foobar&user_id=U2CERLKJA&user_name=roadrunner&command=%2Fwebhook-collect&text=&response_url=https%3A%2F%2Fhooks.slack.com%2Fcommands%2FT1DC2JH3J%2F397700885554%2F96rGlfmibIGlgcZRskXaIFfN&trigger_id=398738663015.47445629121.803a0bc887a14d10d2c447fce8b6703c";
const signature =
  "v0=a2114d57b48eac39b9ad189dd8316235a7b4a8d21a10bd27519666489c69b503";

function signedHeaders(overrides: Record<string, string> = {}): Headers {
  return new Headers({
    "x-slack-request-timestamp": String(timestamp),
    "x-slack-signature": signature,
    ...overrides,
  });
}

Deno.test("accepts Slack's documented signed-request fixture", async () => {
  const result = await verifySlackSignature(
    signedHeaders(),
    rawBody,
    signingSecret,
    {
      nowSeconds: timestamp,
    },
  );
  assertEquals(result, { ok: true, rawBody, timestamp });
});

Deno.test("rejects a changed raw body", async () => {
  const result = await verifySlackSignature(
    signedHeaders(),
    `${rawBody}&extra=1`,
    signingSecret,
    {
      nowSeconds: timestamp,
    },
  );
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.reason, "signature_mismatch");
});

Deno.test("rejects timestamps outside the five-minute replay window", async () => {
  const result = await verifySlackSignature(
    signedHeaders(),
    rawBody,
    signingSecret,
    {
      nowSeconds: timestamp + 301,
    },
  );
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.reason, "stale_timestamp");
});

Deno.test("reads and returns the exact request body once", async () => {
  const request = new Request("https://example.test/slack/events", {
    method: "POST",
    headers: signedHeaders(),
    body: rawBody,
  });
  const result = await verifySlackRequest(request, signingSecret, {
    nowSeconds: timestamp,
  });
  assertEquals(result.ok, true);
  assertEquals(result.rawBody, rawBody);
});
