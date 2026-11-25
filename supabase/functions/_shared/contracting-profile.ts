/**
 * The contracting links and the one email that asks for them.
 *
 * Carrier contracting runs through the MGN Agent Hub (Sam, 2026-11-17: "we're no longer contracting out of the
 * Galaxy link, we're contracting out of the MGN link"). The only thing the website itself asks an agent for is five
 * profile fields — contracting questions, never documents — on a signed-in page where their details are already
 * filled in. There is no spreadsheet, no private channel and no desk behind it, and nothing here claims a carrier
 * has been contacted.
 *
 * Keep the wording in this file the single source: the welcome email, the licensing email and any later message import
 * it, so the instruction cannot drift between them. MGN_CONTRACTING_URL must stay equal to CONTRACTING_LINK_URL in
 * src/lib/contractingLinks.ts (the vitest contract pins them together).
 */
export const MGN_CONTRACTING_URL = "https://mgnagenthub.com/dashboard";
export const CONTRACTING_PROFILE_URL = "https://galaxyfinancial.org/dashboard/contracting-profile";

/** The sign-off the existing welcome emails already use. */
export const CONTRACTING_TEAM_NAME = "The Galaxy Team";

export const CONTRACTING_PROFILE_SUBJECT = "Complete your contracting profile";

/** One sentence the screen and every email repeat, so nobody reads "submitted" as "contracted". */
export const NOT_CONTRACTED_YET = "Submitting your information does not mean carrier contracting is complete.";

export function contractingProfileEmailText(firstName: string, link: string = CONTRACTING_PROFILE_URL, mgnLink: string = MGN_CONTRACTING_URL): string {
  const name = firstName.trim() || "there";
  return [
    `Hi ${name},`,
    "",
    `Carrier contracting runs through the MGN Agent Hub. Start here: ${mgnLink}`,
    "",
    "Then complete your contracting profile with your NPN number, first name, last name, email address, and resident state.",
    "",
    `Complete contracting profile: ${link}`,
    "",
    "Our team will use this information to coordinate your contracting through the MGN Agent Hub and record verified contract receipts on your profile.",
    "",
    NOT_CONTRACTED_YET,
    "",
    "Thank you,",
    CONTRACTING_TEAM_NAME,
  ].join("\n");
}

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function contractingProfileEmailHtml(firstName: string, link: string = CONTRACTING_PROFILE_URL, mgnLink: string = MGN_CONTRACTING_URL): string {
  const name = esc(firstName.trim() || "there");
  return `<p>Hi ${name},</p>
<p>Carrier contracting runs through the MGN Agent Hub. <a href="${esc(mgnLink)}">Start contracting in the MGN Agent Hub</a></p>
<p>Then complete your contracting profile with your NPN number, first name, last name, email address, and resident state.</p>
<p><a href="${esc(link)}">Complete contracting profile</a></p>
<p>Our team will use this information to coordinate your contracting through the MGN Agent Hub and record verified contract receipts on your profile.</p>
<p>${NOT_CONTRACTED_YET}</p>
<p>Thank you,<br>${CONTRACTING_TEAM_NAME}</p>`;
}
