/**
 * The contracting profile link and the one email that asks for it.
 *
 * Carrier contracting now happens by hand in each carrier's own portal. The only thing the website asks an agent for is
 * five profile fields, on a signed-in page where their details are already filled in. There is no spreadsheet, no
 * private channel and no desk behind it, and nothing here claims a carrier has been contacted.
 *
 * Keep the wording in this file the single source: the welcome email, the licensing email and any later message import
 * it, so the instruction cannot drift between them.
 */
export const CONTRACTING_PROFILE_URL = "https://apex-financial.org/dashboard/contracting-profile";

/** The sign-off the existing welcome emails already use. */
export const CONTRACTING_TEAM_NAME = "The Galaxy Team";

export const CONTRACTING_PROFILE_SUBJECT = "Complete your contracting profile";

/** One sentence the screen and every email repeat, so nobody reads "submitted" as "contracted". */
export const NOT_CONTRACTED_YET = "Submitting your information does not mean carrier contracting is complete.";

export function contractingProfileEmailText(firstName: string, link: string = CONTRACTING_PROFILE_URL): string {
  const name = firstName.trim() || "there";
  return [
    `Hi ${name},`,
    "",
    "Please complete your contracting profile with your NPN number, first name, last name, email address, and resident state.",
    "",
    `Complete contracting profile: ${link}`,
    "",
    "Our team will use this information to coordinate the carrier portal steps and track Combine, AFLAC, GTO, and Ethos on your profile.",
    "",
    NOT_CONTRACTED_YET,
    "",
    "Thank you,",
    CONTRACTING_TEAM_NAME,
  ].join("\n");
}

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function contractingProfileEmailHtml(firstName: string, link: string = CONTRACTING_PROFILE_URL): string {
  const name = esc(firstName.trim() || "there");
  return `<p>Hi ${name},</p>
<p>Please complete your contracting profile with your NPN number, first name, last name, email address, and resident state.</p>
<p><a href="${esc(link)}">Complete contracting profile</a></p>
<p>Our team will use this information to coordinate the carrier portal steps and track Combine, AFLAC, GTO, and Ethos on your profile.</p>
<p>${NOT_CONTRACTED_YET}</p>
<p>Thank you,<br>${CONTRACTING_TEAM_NAME}</p>`;
}
