// PKG2 (2026-11-12): the numbers reminder's words follow Sam's rules.
//
// Run: deno test supabase/functions/numbers-reminder/copy.test.ts
import { assert, assertEquals, assertFalse, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { escapeHtml, numbersReminderEmail, numbersReminderSlack, reminderFirstName } from "./copy.ts";

const BANNED = [/—/, /–/, /·/, /\$\s?\d/, /income/i, /earn/i, /\bdelve\b/i, /it's not just/i, /Apex Financial/,
                /quick reminder/i, /\p{Extended_Pictographic}/u];

Deno.test("subject, text, html and Slack carry no em dash, no middle dot, no claim, no emoji", () => {
  const m = numbersReminderEmail("Nevin");
  for (const s of [m.subject, m.text, m.html, numbersReminderSlack("Nevin")]) {
    for (const b of BANNED) assertFalse(b.test(s), `"${s}" matched ${b}`);
  }
});

Deno.test("one short sentence, one link, signed Sam", () => {
  const m = numbersReminderEmail("Nevin");
  assertEquals(m.subject, "Nevin, log today's numbers");
  const body = m.text.split("\n\n")[0];
  assert(body.split(/(?<=\.)\s+/).filter(Boolean).length <= 2);
  assertEquals((m.html.match(/<a /g) ?? []).length, 1);
  assertEquals((m.text.match(/https:\/\//g) ?? []).length, 1);
  assertStringIncludes(m.text, "\n\nSam");
  assertStringIncludes(m.html, "https://apex-financial.org/numbers");
});

Deno.test("a name from a form is escaped before it reaches HTML", () => {
  assertStringIncludes(numbersReminderEmail("<b>x</b>").html, "&lt;b&gt;x&lt;/b&gt;");
  assertEquals(escapeHtml(`"a" & 'b'`), "&quot;a&quot; &amp; &#39;b&#39;");
});

Deno.test("first name: first word of the name, never an email address", () => {
  assertEquals(reminderFirstName("Luiza Silva"), "Luiza");
  assertEquals(reminderFirstName("  "), "there");
  assertEquals(reminderFirstName(null), "there");
  assertEquals(reminderFirstName("agent@example.com"), "there");
});
