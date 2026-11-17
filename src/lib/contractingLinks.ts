/**
 * The one place the contracting links live.
 *
 * Carrier contracting runs through the MGN Agent Hub (Sam, 2026-11-17: "we're no longer contracting out of the
 * Galaxy link, we're contracting out of the MGN link"). CONTRACTING_LINK_URL is the link the team copies, texts
 * and emails; it is MGN's, not ours.
 *
 * The signed-in contracting profile page stays as the five-field intake — contracting questions only (NPN, first
 * name, last name, email, resident state) — so the review board and call list keep their data. It is no longer the
 * link we hand out, and it never asks for documents (no driver's license, no E&O certificate, no voided check).
 * The old public intake at /start-contracting is retired; it only redirects to the profile page, so a bookmark or
 * an old email still lands on the right page.
 */
export const MGN_CONTRACTING_URL = "https://mgnagenthub.com/dashboard";
/** The contracting link the team sends. One link for everyone; copying it sends nothing. */
export const CONTRACTING_LINK_URL = MGN_CONTRACTING_URL;
export const CONTRACTING_PROFILE_PATH = "/dashboard/contracting-profile";
export const CONTRACTING_PROFILE_URL = `https://apex-financial.org${CONTRACTING_PROFILE_PATH}`;
export const RETIRED_CONTRACTING_INTAKE_PATH = "/start-contracting";
