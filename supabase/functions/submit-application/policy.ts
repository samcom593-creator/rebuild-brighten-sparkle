// submit-application policy (WP2, onboarding audit 2026-11-10). Pure functions only, no
// remote imports, so policy.test.ts runs offline. index.ts cannot be imported by a test:
// it throws at module load without SUPABASE_URL and builds live clients.

/**
 * Typo domains refused with a suggestion. Exact matches only: an unknown domain always
 * passes (fails open), because a real address on an unusual domain must never be
 * refused. Measured 2026-11-10: 2 of the 6 dead day-0 welcome emails in 30 days were on
 * gmail.fom and icloud.con. Mirrors and extends src/lib/emailValidation.ts DOMAIN_FIXES.
 */
export const EMAIL_TYPO_DOMAINS: Readonly<Record<string, string>> = {
  "gmail.fom": "gmail.com", "gmail.con": "gmail.com", "gmail.co": "gmail.com", "gmail.cm": "gmail.com",
  "gmail.om": "gmail.com", "gmail.vom": "gmail.com", "gmail.xom": "gmail.com", "gmail.cmo": "gmail.com",
  "gmial.com": "gmail.com", "gmai.com": "gmail.com", "gamil.com": "gmail.com", "gmal.com": "gmail.com",
  "gnail.com": "gmail.com", "gmil.com": "gmail.com", "gmaill.com": "gmail.com", "gmali.com": "gmail.com",
  "icloud.con": "icloud.com", "icloud.co": "icloud.com", "iclould.com": "icloud.com", "icoud.com": "icloud.com",
  "yahoo.con": "yahoo.com", "yahoo.co": "yahoo.com", "yaho.com": "yahoo.com", "yahooo.com": "yahoo.com", "yhoo.com": "yahoo.com",
  "hotmial.com": "hotmail.com", "hotmal.com": "hotmail.com", "hotmail.co": "hotmail.com", "hotmail.con": "hotmail.com",
  "outlok.com": "outlook.com", "outloook.com": "outlook.com", "outlook.con": "outlook.com", "outlook.co": "outlook.com",
  "aol.con": "aol.com", "aol.co": "aol.com",
};

/** "name@gmail.fom" -> "name@gmail.com"; null when the domain is not a known typo. */
export function emailTypoSuggestion(email: string): string | null {
  const e = (email ?? "").trim().toLowerCase();
  const at = e.lastIndexOf("@");
  if (at < 1 || at === e.length - 1) return null;
  const fixed = EMAIL_TYPO_DOMAINS[e.slice(at + 1)];
  return fixed ? `${e.slice(0, at)}@${fixed}` : null;
}

/**
 * A licensed applicant must give a 5-10 digit NPN. The client has required a non-empty
 * NPN since 2026-08-22; the server accepted none, so any other client could claim
 * "licensed" with no proof (and licensed-track bookings auto-flip license_status).
 * Returns the issue message, or null when the payload is acceptable.
 */
export function licensedNpnIssue(licenseStatus: string, niprNumber: string | null | undefined): string | null {
  if (licenseStatus !== "licensed") return null;
  const digits = String(niprNumber ?? "").replace(/\D/g, "");
  if (/^\d{5,10}$/.test(digits)) return null;
  return "Your NPN (National Producer Number) is 5 to 10 digits and is required to confirm your license";
}

/**
 * MP-ONBOARD-ANCHOR-PKG1 (2026-11-12): a person who applies again this many days or more
 * after their latest application gets a NEW live record (it enters the ladder and the SLA
 * queue; the old row is superseded). A repeat inside the window stays on the existing row.
 * The database half of the rule lives in applications_flag_duplicates (migration
 * 20261112000150) and must use the same number.
 */
export const REAPPLY_LIVE_AFTER_DAYS = 30;

/** The welcome SMS goes only to an applicant who opted in to SMS on the form. */
export function shouldSendWelcomeSms(
  phone: string | null | undefined,
  consent: { smsConsentGiven?: boolean | null } | null | undefined,
): boolean {
  return Boolean(phone) && consent?.smsConsentGiven === true;
}
