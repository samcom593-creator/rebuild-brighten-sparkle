// Regression test for PL-WIB-SEND-NOTIFICATION-RECIPIENT (2026-10-09).
//
// send-notification's any_authenticated floor let any self-signed-up account
// mail any address with raw HTML and a link (signup is open). This file drives
// the REAL policy module, then reads the handler source and asserts it is wired
// to that module, because a policy nobody calls protects nothing.
//
// Run: deno test --no-check --allow-read supabase/functions/_shared/notify-caller-policy.test.ts
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  classifyCaller,
  escapeHtml,
  isStaffInbox,
  memberRefusal,
  PRIVILEGED_ROLES,
} from "./notify-caller-policy.ts";

Deno.test("classifyCaller: service, privileged, member, and undecidable", () => {
  assertEquals(classifyCaller("service", null), "service");
  assertEquals(classifyCaller("user:abc", ["admin"]), "privileged");
  assertEquals(classifyCaller("user:abc", ["agent", "manager"]), "privileged");
  assertEquals(classifyCaller("user:abc", ["agent"]), "member");
  assertEquals(classifyCaller("user:abc", ["va", "va_manager"]), "member");
  assertEquals(classifyCaller("user:abc", []), "member");
  // A role read that failed must never resolve to the unrestricted path.
  assertEquals(classifyCaller("user:abc", null), null);
  assertEquals(classifyCaller(undefined, ["admin"]), null);
  assertEquals(classifyCaller("user:", ["admin"]), null);
  assertEquals(classifyCaller("anon", ["admin"]), null);
});

Deno.test("only admin and manager are privileged", () => {
  assertEquals([...PRIVILEGED_ROLES].sort(), ["admin", "manager"]);
});

Deno.test("memberRefusal: userId and url are staff-only, email is required", () => {
  assertEquals(memberRefusal({ userId: "u1", email: "a@b.co" })?.status, 403);
  assertEquals(memberRefusal({ email: "a@b.co", url: "https://evil.example" })?.status, 403);
  assertEquals(memberRefusal({})?.status, 400);
  assertEquals(memberRefusal({ email: "   " })?.status, 400);
  assertEquals(memberRefusal({ email: 42 })?.status, 400);
  // The two real member callers' shapes pass.
  assertEquals(memberRefusal({ email: "sam@apex-financial.org", title: "t", message: "m" }), null);
  assertEquals(memberRefusal({ email: "lead@x.co", title: "t", message: "m", userId: "", url: null }), null);
});

Deno.test("isStaffInbox: Sam's two inboxes only, case and space tolerant", () => {
  assert(isStaffInbox("sam@apex-financial.org"));
  assert(isStaffInbox(" Info@KingOfSales.net "));
  assert(!isStaffInbox("sam@apex-financial.org.evil.example"));
  assert(!isStaffInbox("someone@apex-financial.org"));
});

Deno.test("escapeHtml neutralises markup and attribute breakouts", () => {
  assertEquals(
    escapeHtml(`<a href="https://evil.example">Log in</a> & 'x'`),
    "&lt;a href=&quot;https://evil.example&quot;&gt;Log in&lt;/a&gt; &amp; &#39;x&#39;",
  );
  assertEquals(escapeHtml(undefined), "");
  assertEquals(escapeHtml(null), "");
  assert(!escapeHtml("<img src=x onerror=alert(1)>").includes("<"));
});

Deno.test("send-notification is wired to the policy (source contract)", async () => {
  const src = await Deno.readTextFile(
    new URL("../send-notification/index.ts", import.meta.url),
  );
  assert(src.includes(`from "../_shared/notify-caller-policy.ts"`), "handler does not import the policy");
  assert(/classifyCaller\(\s*auth\.caller\s*,\s*roles\s*\)/.test(src), "caller is not classified");
  assert(/callerClass\s*===\s*null\)\s*\{\s*return json\(503/.test(src), "undecidable caller does not refuse");
  assert(/memberRefusal\(/.test(src), "member shape is not checked");
  assert(/recipientVisibleToCaller\(token, email\)/.test(src), "member recipient is not checked against RLS");
  assert(/if \(!visible\)\s*\{\s*return json\(403/.test(src), "invisible recipient is not refused");
  // The HTML body must interpolate the escaped values, never the raw ones.
  assert(src.includes("${htmlTitle}") && src.includes("${htmlMessage}"), "HTML does not use the escaped values");
  assert(!/<p>\$\{message\}<\/p>/.test(src), "raw message is interpolated into HTML");
  assert(!/<h2[^>]*>\$\{title/.test(src), "raw title is interpolated into HTML");
  // The visibility read must run as the caller, not as the service role.
  const fn = src.slice(src.indexOf("async function recipientVisibleToCaller"));
  const body = fn.slice(0, fn.indexOf("\n}\n"));
  assert(body.includes("anonKey") && body.includes("Bearer ${token}"), "visibility read is not caller-scoped");
  assert(!body.includes("serviceRoleKey"), "visibility read uses the service role and bypasses RLS");
});

// Signup is open, so floor "any_authenticated" admits strangers. Each function
// on that floor must be named here with the reason a stranger cannot choose the
// recipient. A new entry, or send-aged-lead-email drifting back down, fails
// this until someone writes the reason.
const ANY_AUTHENTICATED_FLOOR: Record<string, string> = {
  "send-notification": "member callers held to notify-caller-policy (Sam's inboxes or an RLS-visible person)",
};

Deno.test("any_authenticated sender floor census", async () => {
  const root = new URL("../", import.meta.url);
  const found: string[] = [];
  for await (const entry of Deno.readDir(root)) {
    if (!entry.isDirectory || entry.name.startsWith("_")) continue;
    let src: string;
    try {
      src = await Deno.readTextFile(new URL(`${entry.name}/index.ts`, root));
    } catch {
      continue; // empty-catch-allow:no-index
    }
    if (/floor\s*:\s*["']any_authenticated["']/.test(src)) found.push(entry.name);
  }
  assertEquals(found.sort(), Object.keys(ANY_AUTHENTICATED_FLOOR).sort());
});

// PL-WIB-COURSE-ENROLL-FLOOR. Its recipient came off a row, but any signup can
// read every agents.id, so a stranger could still aim it at every agent.
Deno.test("send-course-enrollment-email is on staff_or_agent, not any_authenticated", async () => {
  const src = await Deno.readTextFile(
    new URL("../send-course-enrollment-email/index.ts", import.meta.url),
  );
  assert(/requireSendAuth\(req, \{ floor: "staff_or_agent" \}\)/.test(src), "course email floor drifted");
});

Deno.test("send-aged-lead-email: admin/manager floor and an escaped name", async () => {
  const src = await Deno.readTextFile(
    new URL("../send-aged-lead-email/index.ts", import.meta.url),
  );
  assert(/requireSendAuth\(req\)/.test(src), "send-aged-lead-email no longer uses the default admin_or_manager floor");
  assert(/const name = escapeHtml\(rawName\)/.test(src), "firstName reaches the HTML unescaped");
  assert(/getEmailHtml\(name,/.test(src), "template is not fed the escaped name");
});
