import { assert, assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { renderSlackEventText, SLACK_TEMPLATED_EVENT_TYPES } from "./slack-event-templates.ts";

const payload = {
  agentName: "GHOST_TEST Producer", carrier: "Ethos", policyNumber: "TEST-123",
  annualPremium: 1200, amount: 250, fromBucket: "active", toBucket: "lapsed",
  openUrl: "https://galaxyfinancial.org/dashboard/finances",
  client_name: "PRIVATE_CUSTOMER", clientName: "PRIVATE_CUSTOMER",
  reason: "PRIVATE_REASON", to_raw: "PRIVATE_RAW",
};

Deno.test("policy status render includes policy/AP and excludes customer PII", () => {
  assertEquals(renderSlackEventText("policy.status_changed", payload),
    ":rotating_light: LAPSED — *GHOST_TEST Producer* · Ethos · policy TEST-123 · $1,200 AP\n<https://galaxyfinancial.org/dashboard/finances|open your book>");
  for (const bucket of ["lapsed", "at_risk", "not_taken", "declined", "claim", "active"]) {
    const rendered = renderSlackEventText("policy.status_changed", { ...payload, toBucket: bucket })!;
    assert(!rendered.includes("PRIVATE_"));
    assert(!rendered.includes("PAID"), "active is not evidence of commission payment");
  }
  assert(SLACK_TEMPLATED_EVENT_TYPES.includes("policy.status_changed"));
});

Deno.test("policy chargeback render includes policy/amount and excludes customer PII", () => {
  assertEquals(renderSlackEventText("policy.chargeback", payload),
    ":money_with_wings: CHARGEBACK — *GHOST_TEST Producer* · Ethos · policy TEST-123 · $250\n<https://galaxyfinancial.org/dashboard/finances|open your book>");
  assert(SLACK_TEMPLATED_EVENT_TYPES.includes("policy.chargeback"));
});

Deno.test("policy templates escape Slack mentions and reject external book links", () => {
  for (const event of ["policy.status_changed", "policy.chargeback"]) {
    const rendered = renderSlackEventText(event, { ...payload,
      agentName: "<!channel>", policyNumber: "<@U123456789>", openUrl: "https://evil.test/",
    })!;
    assert(!rendered.includes("<!channel>") && !rendered.includes("<@U123456789>"));
    assert(rendered.includes("https://galaxyfinancial.org/dashboard/finances"));
    assert(!rendered.includes("evil.test") && !rendered.includes("PRIVATE_"));
  }
});
