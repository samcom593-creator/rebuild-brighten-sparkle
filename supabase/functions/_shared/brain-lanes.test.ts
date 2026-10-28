// Run: deno test supabase/functions/_shared/brain-lanes.test.ts
//
// The four messages the brain left unanswered on 2026-10-27 are the fixtures.
// Each lane is graded both ways: the message that must land in it, and the
// recruit / casual message that must NOT (a recruit asking "how much commission"
// must never be treated as an agent asking about their pay).
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { brainLane } from "./brain-lanes.ts";

Deno.test("the unanswered DMs of 2026-10-27 each land in a lane", () => {
  assertEquals(brainLane("How bro I'm 18 and I need help"), "need_help");
  assertEquals(brainLane("Hey brotha let me know when you can get jacks contract"), "agent_support");
  assertEquals(brainLane("was wondering if u were looking for a virtual assistant"), "vendor");
  assertEquals(brainLane("Bro got ai"), "bot_check");
  assertEquals(brainLane("Hey bro how do u this all"), "need_help");
  // 2026-10-28 06:05Z, the first YouTube pull after the reconnect: this landed in casual and got nothing.
  assertEquals(brainLane("How do you make a lot of money"), "need_help");
  assertEquals(brainLane("what do u do for a living"), "need_help");
});

Deno.test("a former agent asking to come back is win-back, and wins over support words", () => {
  assertEquals(brainLane("i used to be on the team, can i come back"), "winback");
  assertEquals(brainLane("yo i left the team last year, tryna get back on"), "winback");
  assertEquals(brainLane("i was an agent under you before, where's my check"), "winback");
  assertEquals(brainLane("got my license back, can i rejoin"), "winback");
});

Deno.test("an agent's own contracting, carrier and pay questions are support", () => {
  assertEquals(brainLane("when do i get my carrier appointment"), "agent_support");
  assertEquals(brainLane("my contract still hasn't gone through"), "agent_support");
  assertEquals(brainLane("i didn't get paid on that deal"), "agent_support");
  assertEquals(brainLane("can you send the contracting link"), "agent_support");
  assertEquals(brainLane("my portal login isn't working"), "agent_support");
});

Deno.test("recruit questions about money or licensing are NOT support", () => {
  assertEquals(brainLane("how much commission do you guys pay"), null);
  assertEquals(brainLane("how much money can i make doing this"), null);
  assertEquals(brainLane("do i need a license to start"), null);
  assertEquals(brainLane("im interested, tell me more"), null);
});

Deno.test("pitches are vendor; small talk is nothing", () => {
  assertEquals(brainLane("I'm a video editor, i can grow your page"), "vendor");
  assertEquals(brainLane("we offer appointment setting services"), "vendor");
  assertEquals(brainLane("yoo what's good"), null);
  assertEquals(brainLane("lol"), null);
  assertEquals(brainLane(""), null);
});

Deno.test("noticing the assistant is bot_check, not casual", () => {
  assertEquals(brainLane("is this ai or you"), "bot_check");
  assertEquals(brainLane("you using chatgpt lmao"), "bot_check");
  assertEquals(brainLane("are you a bot?"), "bot_check");
});
