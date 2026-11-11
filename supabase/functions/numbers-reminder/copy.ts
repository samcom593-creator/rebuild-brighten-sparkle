// The words of the nightly numbers reminder (MP-ONBOARD-ANCHOR-PKG2, 2026-11-12), split out so copy.test.ts pins
// them: Sam's voice, one or two short sentences, one link, no em-dash asides, no income claims, the name escaped
// before it reaches HTML.

export const NUMBERS_URL = "https://apex-financial.org/numbers";

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** First word of the name on file, or "there" when there is none (never an email address). */
export function reminderFirstName(name: string | null | undefined): string {
  const word = (name ?? "").trim().split(/\s+/)[0] ?? "";
  return word && !word.includes("@") ? word : "there";
}

export function numbersReminderEmail(first: string): { subject: string; text: string; html: string } {
  const sentence = "log today's calls, presentations and deals before close of business so your numbers stay accurate.";
  return {
    subject: `${first}, log today's numbers`,
    text: `${first}, ${sentence}\n\nLog my numbers: ${NUMBERS_URL}\n\nSam`,
    html:
      `<p>${escapeHtml(first)}, ${sentence}</p>` +
      `<p><a href="${NUMBERS_URL}" style="display:inline-block;padding:10px 18px;background:#EDB81D;color:#0a0f1a;` +
      `text-decoration:none;border-radius:6px;font-weight:600;">Log my numbers</a></p>` +
      `<p>Sam</p>`,
  };
}

export function numbersReminderSlack(first: string): string {
  return `${first}, log today's calls, presentations and deals before close of business: ${NUMBERS_URL}`;
}
