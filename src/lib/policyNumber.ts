// Paste artifacts, not data errors.
//
// A policy number copied out of a carrier portal or a spreadsheet arrives with
// a trailing TAB. Postgres `btrim()` strips spaces only, so the server's old
// `~ '[[:cntrl:]]'` guard rejected it with "Application or policy number is
// required and must be valid" -- a message about a number that looks perfectly
// correct on screen. On 2026-08-28 that cost a real post: deal_drafts
// a7ad69bd (Wendell Funderburg / Michelle Cole / "3002725\t") never became a
// deal, and "3002725" was on no deal anywhere, so nothing was being caught.
//
// This mirrors public.fn_normalize_policy_number(text) so the browser's
// pre-flight duplicate check asks about the same string the insert will store.
// Change one, change the other.

// Control characters plus the invisibles a browser copy drags along:
// U+00A0 no-break space, U+200B/C/D zero-width, U+FEFF byte-order mark.
const INVISIBLE = /[\u0000-\u001f\u007f\u00a0\u200b\u200c\u200d\ufeff ]+/g;

/** Keystroke-safe pass: kills invisibles but never trims, so a user can still
 *  type a space in the middle of a number that has one. */
export function sanitizePolicyInput(raw: string): string {
  return raw.replace(INVISIBLE, " ").replace(/ {2,}/g, " ");
}

/** Submit-time pass: exactly what the server will store. */
export function normalizePolicyNumber(raw: string | null | undefined): string {
  return sanitizePolicyInput(raw ?? "").trim();
}

/** Inclusive deadline: a sale dated 30 days ago may still be posted without a number. */
export function isWithinPolicyNumberGrace(applicationDate: string, today = new Date().toISOString().slice(0, 10)): boolean {
  const parseDay = (value: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return NaN;
    const time = Date.parse(`${value}T00:00:00Z`);
    return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value ? time : NaN;
  };
  const days = (parseDay(today) - parseDay(applicationDate)) / 86_400_000;
  return days >= 0 && days <= 30;
}
