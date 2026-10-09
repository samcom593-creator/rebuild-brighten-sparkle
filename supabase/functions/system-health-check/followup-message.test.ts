// PL-WIB-SHC-FIRSTNAME-ESCAPE. system-health-check put the applicant's own
// first_name into send-notification's HTML body unescaped. Latent on the day
// it shipped (0 of 857 applications carry < > & or "), so this pins the
// contract rather than recording a leak.
//
// Run: deno test --no-check --allow-read supabase/functions/system-health-check/followup-message.test.ts
// Wired: npm run check:deno-tests (verify:core).
import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { stalledFollowUpMessage } from "./followup-message.ts";

Deno.test("markup in first_name reaches the email as text, not HTML", () => {
  const m = stalledFollowUpMessage('<a href="https://x.test">Claim</a>');
  assertEquals(m.includes("<a"), false);
  assertStringIncludes(m, "Hey &lt;a href=&quot;https://x.test&quot;&gt;Claim&lt;/a&gt;,");
});

Deno.test("a real name is unchanged apart from entity-encoding", () => {
  assertStringIncludes(stalledFollowUpMessage("  Jordan "), "Hey Jordan, we noticed");
  assertStringIncludes(stalledFollowUpMessage("O'Brien"), "Hey O&#39;Brien, we noticed");
});

Deno.test("a blank or missing name never renders 'Hey null,'", () => {
  for (const v of [null, undefined, "", "   ", 42]) {
    assertStringIncludes(stalledFollowUpMessage(v), "Hey there, we noticed");
  }
});

Deno.test("index.ts builds its message through the helper, not inline", async () => {
  const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  assertStringIncludes(src, "message: stalledFollowUpMessage(app.first_name)");
  assertEquals(/Hey \$\{app\.first_name\}/.test(src), false);
});
