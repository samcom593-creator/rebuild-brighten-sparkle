// WP7: the #unlicensed greeting is cohort-neutral and never asks for a receipt
// in the channel; the run-log dedupe compares jsonb-reordered rows correctly.
//
// Run: deno test supabase/functions/slack-unlicensed-welcome/text.test.ts

import { assert, assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { stableJson, welcomeText } from "./text.ts";

Deno.test("greeting serves both cohorts and sends receipts to the portal, not the channel", () => {
  const t = welcomeText("U012ABCDEF");
  assert(t.includes("<@U012ABCDEF>"));
  assert(t.includes("Not licensed yet? This is your room"));
  assert(t.includes("Already licensed?") && t.includes("#general"));
  assert(t.includes("Upload your course receipt in your Galaxy portal"));
  assert(t.includes("don't post receipts here"));
  assert(!/post a screenshot[^.]*right here in this channel/i.test(t), "old 'post it here' instruction is back");
});

Deno.test("stableJson treats a jsonb-reordered row as unchanged", () => {
  const fresh = { members: 6, humans: 6, greeted: 0, failures: 0 };
  const stored = { humans: 6, greeted: 0, members: 6, failures: 0 }; // jsonb key order
  assert(JSON.stringify(fresh) !== JSON.stringify(stored), "fixture must actually differ in key order");
  assertEquals(stableJson(fresh), stableJson(stored));
  assert(stableJson({ ...fresh, greeted: 1 }) !== stableJson(stored));
  assertEquals(stableJson({ missing: ["users:read", "channels:manage"] }), '{"missing":["users:read","channels:manage"]}');
});
