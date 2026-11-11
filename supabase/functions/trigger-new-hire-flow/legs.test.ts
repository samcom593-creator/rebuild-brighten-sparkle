// PKG2 (2026-11-12): the retry rules, receipts and copy of trigger-new-hire-flow.
//
// Run: deno test supabase/functions/trigger-new-hire-flow/legs.test.ts
import { assert, assertEquals, assertFalse, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  escapeHtml,
  firstNameOf,
  isSettled,
  legFromSend,
  managerEligible,
  runIsDone,
  staffNotice,
  welcomeEmail,
} from "./legs.ts";

Deno.test("a provider id is the only thing that makes a send 'sent'", () => {
  assertEquals(legFromSend({ ok: true, id: "re_1" }), "sent:re_1");
  assertEquals(legFromSend({ ok: true, id: null }), "failed:no provider id");
  assertEquals(legFromSend({ ok: true, id: "  " }), "failed:no provider id");
  assertEquals(legFromSend({ ok: false, id: null, error: "rate limited" }), "failed:rate limited");
  assertEquals(legFromSend({ ok: false, id: null, error: "x", refused: "suppressed" }), "refused:suppressed");
});

Deno.test("a failed welcome email keeps the run open for the retry sweep", () => {
  assertFalse(runIsDone({ welcome_email: "failed:timeout", sam_notice: "sent:re_2" }));
  assertFalse(runIsDone({}));
  assert(runIsDone({ welcome_email: "sent:re_3" }));
  assert(runIsDone({ welcome_email: "refused:suppressed" }));
  assert(runIsDone({ welcome_email: "skipped:no_email" }));
});

Deno.test("a retry only repeats legs that did not land", () => {
  assert(isSettled("sent:re_1"));
  assert(isSettled("ok"));
  assert(isSettled("skipped:manager_suspended"));
  assert(isSettled("refused:non_routable"));
  assertFalse(isSettled("failed:boom"));
  assertFalse(isSettled(undefined));
});

Deno.test("a suspended, departed or deactivated manager is never emailed", () => {
  const base = { status: "active", is_deactivated: false, is_inactive: false, suspended: false, email: "m@example.com" };
  assert(managerEligible(base).ok);
  assertEquals(managerEligible({ ...base, suspended: true }).reason, "manager_suspended");
  assertEquals(managerEligible({ ...base, status: "terminated" }).reason, "manager_not_active");
  assertEquals(managerEligible({ ...base, is_deactivated: true }).reason, "manager_not_active");
  assertEquals(managerEligible({ ...base, email: null }).reason, "manager_no_email");
  assertEquals(managerEligible(null).reason, "no_manager");
});

Deno.test("the hire's email is short, plain, linked once and makes no income claim", () => {
  const m = welcomeEmail("Nevin");
  assertEquals(m.subject, "Nevin, your Galaxy dashboard is live");
  const sentences = m.text.split("\n\n")[0].split(/(?<=\.)\s+/).filter(Boolean);
  assert(sentences.length <= 3, `expected at most 3 sentences, got ${sentences.length}`);
  assertEquals((m.html.match(/<a /g) ?? []).length, 1);
  for (const banned of [/\$\s?\d/, /income/i, /earn/i, /🚀|🎉|💰/u, /Apex Financial/]) {
    assertFalse(banned.test(m.text), `copy matched ${banned}`);
  }
  assertStringIncludes(m.text, "reply to this email");
});

Deno.test("names from a form are escaped before they reach HTML", () => {
  assertEquals(escapeHtml(`<b>"Al" & 'Bo'</b>`), "&lt;b&gt;&quot;Al&quot; &amp; &#39;Bo&#39;&lt;/b&gt;");
  assertStringIncludes(welcomeEmail("<script>").html, "&lt;script&gt;");
  assertStringIncludes(staffNotice("<i>x</i>").html, "&lt;i&gt;x&lt;/i&gt;");
});

Deno.test("first name: the profile name unless it is an email address, then the display name", () => {
  assertEquals(firstNameOf("Nevin Smith", "N S"), "Nevin");
  assertEquals(firstNameOf("nevin@example.com", "Nevin Smith"), "Nevin");
  assertEquals(firstNameOf(null, null), "there");
});
