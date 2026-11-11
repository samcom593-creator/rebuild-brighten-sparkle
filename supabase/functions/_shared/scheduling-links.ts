// One scheduling source for every edge function (WP2, onboarding audit 2026-11-10).
//
// This file MIRRORS src/lib/apexConfig.ts SCHEDULING_LINKS + buildBookingUrl. The SPA
// cannot import Deno files and Deno cannot import the SPA, so the two copies are held
// equal by src/tests/config/schedulingLinksParity.test.ts, and
// scripts/check-scheduling-links.mjs (pre-commit) refuses any new
// 'calendly.com/apexfinancialempire/' literal outside these two files.
//
// Before this file the same lifecycle step had three different links: the page embedded
// licensed-prospect-call-clone, the welcome email and seminar-confirmation sent
// 1on1-call-clone, and outreach templates sent the LICENSED call to unlicensed recruits
// (a licensed-track booking auto-flips license_status). Change a value here and in
// apexConfig.ts together; the parity test fails otherwise.
//
// No remote imports: this file must stay importable from vitest (Node) and every function.

export const SCHEDULING_LINKS = {
  /** Unlicensed: the licensing call, booked after the course receipt is uploaded. */
  licensing: "https://calendly.com/apexfinancialempire/licensing-call",
  /** Legacy alias of `licensing` (older importers read `.unlicensed`). */
  unlicensed: "https://calendly.com/apexfinancialempire/licensing-call",
  /** Applied + licensed: the licensed-prospect call with Sam (Sam's 2026-11-10 choice; N2 may change it). */
  licensed: "https://calendly.com/apexfinancialempire/licensed-prospect-call-clone",
  /** Post-hire contracting/onboarding call. */
  onboarding: "https://calendly.com/apexfinancialempire/apex-onboarding-call",
  /**
   * "Not ready to buy? Ask us first" — a 10-minute questions call any unlicensed applicant can
   * book BEFORE buying the course (live 2026-11-11: 72 unlicensed applicants in 90 days, 4 bought
   * the course while the only call was locked behind a receipt). null hides the link and
   * every surface falls back to the owner's direct contact.
   */
  questions: "https://calendly.com/apexfinancialempire/licensing-questions" as string | null,
} as const;

export const APP_ORIGIN = "https://apex-financial.org";

/** The applicant's own status page: course, receipt upload, licensing call, self-report. */
export function statusPageUrl(applicationId: string): string {
  return `${APP_ORIGIN}/status/${encodeURIComponent(applicationId)}`;
}

export interface BookingPrefill {
  applicationId?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
}

/**
 * Calendly link with name/email prefill and utm_source=apply&utm_content=<application_id>.
 * The calendly-webhook matches utm_content first, so a booking lands on its application
 * instead of the fuzzy name/email match (57% of 120d bookings matched nothing).
 */
export function buildBookingUrl(base: string, prefill: BookingPrefill = {}): string {
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    return base;
  }
  const name = [prefill.firstName, prefill.lastName].map((s) => (s ?? "").trim()).filter(Boolean).join(" ");
  if (name) url.searchParams.set("name", name);
  const email = (prefill.email ?? "").trim();
  if (email) url.searchParams.set("email", email);
  const appId = (prefill.applicationId ?? "").trim();
  if (appId) {
    url.searchParams.set("utm_source", "apply");
    url.searchParams.set("utm_content", appId);
  }
  return url.toString();
}
