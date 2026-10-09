// Email a licensed hire gets the moment their onboarding is sent to Aflac.
// PURE: no network, no Deno globals. Shared by the edge function and the vitest suite.
//
// It states only what is true at send time: the hire's details were sent, and Aflac emails the
// hire directly. It does not name Aflac's sender address or promise a time, because neither is
// known here and a wrong specific is worse than none.
import { BRAND_NAME, BRAND_SIGNOFF } from "./brand.ts";

export interface AflacNoticeInput {
  firstName: string;
  email: string;
}

function esc(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function buildAflacNotice(input: AflacNoticeInput): { subject: string; html: string; text: string } {
  const first = esc(input.firstName.trim() || "there");
  const subject = "Watch your inbox: Aflac is emailing you now";
  const steps = [
    "Open the email from Aflac as soon as it lands. Check spam and promotions if you do not see it.",
    "Finish the steps in that email right away. Your contract is not active until you do.",
    "If nothing has arrived by tomorrow, reply to this email and we will chase it.",
  ];
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#0b0b0c;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#e5e7eb;">
<div style="max-width:560px;margin:0 auto;background:#141416;border:1px solid #2a2a2e;border-radius:12px;padding:28px;">
<h1 style="font-size:20px;margin:0 0 16px 0;color:#d4af37;">${first}, your Aflac onboarding was just sent.</h1>
<p style="font-size:15px;line-height:1.6;margin:0 0 16px 0;">${BRAND_NAME} has submitted your details to Aflac. Because you are licensed, Aflac will email you directly right away.</p>
<p style="font-size:15px;line-height:1.6;margin:0 0 8px 0;"><strong style="color:#ffffff;">What to do now:</strong></p>
<ol style="font-size:15px;line-height:1.7;margin:0 0 20px 18px;padding:0;">${steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>
<p style="font-size:15px;line-height:1.6;margin:0;">${esc(BRAND_SIGNOFF)}</p>
</div></body></html>`;
  const text = [
    `${input.firstName.trim() || "Hi"}, your Aflac onboarding was just sent.`,
    "",
    `${BRAND_NAME} has submitted your details to Aflac. Because you are licensed, Aflac will email you directly right away.`,
    "",
    "What to do now:",
    ...steps.map((s, n) => `${n + 1}. ${s}`),
    "",
    BRAND_SIGNOFF,
  ].join("\n");
  return { subject, html, text };
}
