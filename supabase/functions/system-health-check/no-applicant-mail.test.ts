// MP-ONBOARD-ANCHOR-PKG1 (2026-11-12): system-health-check sends nothing to applicants.
//
// The "Still interested in Galaxy Financial?" block mailed any applicant 3+ days old with
// no logged contact through send-notification, every 15 minutes, with no license check,
// no booking check and no quiet hours (28 sends in 30 days, 0 clicks, some at 01:05 and
// 23:50 Phoenix). The next-step ladder is the one applicant sequence. This pins the
// removal so a revert or a copy-paste cannot bring a second applicant drip back.
//
// Run: deno test --no-check --allow-read supabase/functions/system-health-check/no-applicant-mail.test.ts
import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";

const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
// comments carry the history on purpose; grade code only
const code = src
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n")
  .map((l) => l.replace(/^\s*\/\/.*$/, ""))
  .join("\n");

Deno.test("no call to send-notification and no applicant query feeding a send", () => {
  assertEquals(code.includes("functions/v1/send-notification"), false);
  assertEquals(/Still interested/i.test(code), false);
  assertEquals(code.includes("last_automated_email_at"), false);
});

Deno.test("the only email left is the critical alert to Sam's inbox, with a live Reply-To", () => {
  const sends = code.match(/resend\.emails\.send\(/g) ?? [];
  assertEquals(sends.length, 1);
  assertStringIncludes(code, 'to: "info@kingofsales.net"');
  assertStringIncludes(code, "reply_to: RECRUIT_REPLY_TO");
});

Deno.test("the retirement note stays where a reader looks for the old check", () => {
  assertStringIncludes(src, "CHECK 4: retired (MP-ONBOARD-ANCHOR-PKG1");
});
