// Day-0 welcome email (MP-ONBOARD-ANCHOR-PKG1, 2026-11-12). Pure: no env, no SDK, no
// remote imports, so welcome.test.ts runs offline and index.ts only sends what this builds.
//
// What it replaced (message_map_and_copy.md section 1.4 and 4d): a ~40-line page with seven
// links, income claims ("earning $5,000, $10,000, even $23,000 a month", "averaging $23,000
// per month in production", "Start training and earning immediately!", subject "You're
// Almost Ready to Earn"), and a manager call "within 24 hours" / "within 48 hours" that 0 of
// 29 applicants in 30 days received. Welcome click-through was 14.8%; every later email in
// the sequence was lower, so this one email has to carry the next step on its own.
//
// Rules this file holds (Sam's voice, DECISIONS.md "Day-0 email"):
//   - five short lines at most, signed "Sam";
//   - ONE primary button and at most ONE secondary line;
//   - no income or earnings claims, no unverifiable numbers, no promised call-back;
//   - unlicensed keeps peer e5's questions-call line (SCHEDULING_LINKS.questions);
//   - licensed keeps the licensed call with utm_content = application id;
//   - every variant keeps the status-page link (it also replaces the login email's job).

import { SCHEDULING_LINKS, buildBookingUrl, statusPageUrl } from "../_shared/scheduling-links.ts";

export type WelcomeVariant = "licensed" | "pending" | "unlicensed";

export interface WelcomeInput {
  applicationId: string;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  licenseStatus?: string | null;
}

export interface WelcomeEmail {
  variant: WelcomeVariant;
  subject: string;
  html: string;
  text: string;
  /** the one button */
  primaryUrl: string;
  /** the one secondary line's link, if any */
  secondaryUrl: string | null;
}

/** The line peer e5 shipped into the unlicensed welcome on 2026-11-11; kept verbatim. */
export const QUESTIONS_CALL_LINE = "Want to talk it through before you buy anything?";
export const QUESTIONS_CALL_LABEL = "Book a 10-minute questions call";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** A first name fit for a subject line: trimmed, single line, never blank. */
export function subjectName(firstName: string | null | undefined): string {
  const s = String(firstName ?? "").replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
  return s ? s.slice(0, 60) : "there";
}

export function welcomeVariant(licenseStatus: string | null | undefined): WelcomeVariant {
  const v = String(licenseStatus ?? "").trim().toLowerCase();
  if (v === "licensed") return "licensed";
  if (v === "pending") return "pending";
  return "unlicensed";
}

interface Parts {
  subject: string;
  lines: string[];
  primary: { label: string; url: string };
  secondary: { lead: string; label: string; url: string } | null;
}

function parts(input: WelcomeInput, variant: WelcomeVariant, name: string): Parts {
  const prefill = {
    applicationId: input.applicationId,
    firstName: input.firstName ?? null,
    lastName: input.lastName ?? null,
    email: input.email ?? null,
  };
  const statusUrl = statusPageUrl(input.applicationId);
  const questions = SCHEDULING_LINKS.questions
    ? { lead: QUESTIONS_CALL_LINE, label: QUESTIONS_CALL_LABEL, url: buildBookingUrl(SCHEDULING_LINKS.questions, prefill) }
    : null;

  if (variant === "licensed") {
    return {
      subject: `${name}, book your call with Sam`,
      lines: [
        `${name}, I got your application and saw you're already licensed.`,
        "The next step is a 15-minute call with me. Have your NPN and your resident state ready.",
      ],
      primary: { label: "Pick a time", url: buildBookingUrl(SCHEDULING_LINKS.licensed, prefill) },
      secondary: { lead: "Your application page is here if you need it:", label: "open my page", url: statusUrl },
    };
  }
  if (variant === "pending") {
    return {
      subject: `${name}, your Galaxy application is in`,
      lines: [
        `${name}, I got your application.`,
        "Your page shows what's left while your license is pending, and it's where you add your NPN the day it posts.",
      ],
      primary: { label: "Open my page", url: statusUrl },
      secondary: questions,
    };
  }
  return {
    subject: `${name}, your Galaxy application is in`,
    lines: [
      `${name}, I got your application.`,
      "Your next step is your state life insurance license, and your page walks you through it one step at a time.",
    ],
    primary: { label: "Start my licensing steps", url: statusUrl },
    secondary: questions,
  };
}

export function buildApplicantWelcome(input: WelcomeInput): WelcomeEmail {
  const variant = welcomeVariant(input.licenseStatus);
  const name = subjectName(input.firstName);
  const p = parts(input, variant, name);
  const lines = p.lines.map((l) => `<p style="margin:0 0 14px">${escapeHtml(l)}</p>`).join("\n    ");
  const secondaryHtml = p.secondary
    ? `<p style="margin:0 0 14px">${escapeHtml(p.secondary.lead)} <a href="${escapeHtml(p.secondary.url)}" style="color:#1d4ed8">${escapeHtml(p.secondary.label)}</a>.</p>`
    : "";
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#111827;max-width:560px">
    ${lines}
    <p style="margin:18px 0"><a href="${escapeHtml(p.primary.url)}" style="display:inline-block;background:#111827;color:#ffffff;padding:12px 22px;border-radius:6px;text-decoration:none;font-weight:600">${escapeHtml(p.primary.label)}</a></p>
    ${secondaryHtml}
    <p style="margin:0 0 14px">Sam</p>
    <p style="margin:24px 0 0;font-size:12px;color:#6b7280">Galaxy Financial · apex-financial.org</p>
  </div>`;
  const text = [
    ...p.lines,
    "",
    `${p.primary.label}: ${p.primary.url}`,
    ...(p.secondary ? ["", `${p.secondary.lead} ${p.secondary.label}: ${p.secondary.url}`] : []),
    "",
    "Sam",
    "",
    "Galaxy Financial · apex-financial.org",
  ].join("\n");
  return {
    variant,
    subject: p.subject,
    html,
    text,
    primaryUrl: p.primary.url,
    secondaryUrl: p.secondary?.url ?? null,
  };
}
