// phone-lookup.ts — find a profile by the phone number a person types on
// /agent-login, whatever punctuation the stored copy carries.
//
// THE BUG (PL-WIB-PHONE-LOOKUP-FORMAT, 2026-10-09)
// check-email-status matched `phone ILIKE '%<last 10 digits>%'`. The digits
// were stripped from the INPUT but not from the stored value, so a profile
// saved as "(713) 882-8503" could never contain "7138828503". Measured that
// day: 72 of 197 profile phones are stored with punctuation; 69 belong to
// agents. For 63 of those agents a phone login found nobody and the page said
// "We couldn't find you" to a person who is on file. (For the other 6 the
// lookup returned a DIFFERENT profile that happens to hold the same digits
// unformatted: an identity-duplicate problem, recorded, not decided here.)
//
// THE FIX
// PostgREST cannot strip punctuation inside a filter, so the query is a
// tolerant candidate pattern (%713%882%8503%) and the decision is made here,
// on exact equality of the last ten digits. The pattern is built from digits
// only, so no LIKE metacharacter from the caller can reach it (MP-277).
// Same oracle as before: it still takes all ten real digits to get a hit.

export function lastTenDigits(value: unknown): string {
  return String(value ?? "").replace(/\D/g, "").slice(-10);
}

/** ILIKE pattern that matches the ten digits through any punctuation. */
export function phoneCandidatePattern(last10: string): string | null {
  if (!/^\d{10}$/.test(last10)) return null;
  return `%${last10.slice(0, 3)}%${last10.slice(3, 6)}%${last10.slice(6)}%`;
}

/**
 * First row (callers pass them newest-first, as the old .limit(1) did) whose
 * stored phone has exactly these last ten digits. A loose pattern hit with
 * different digits is never returned.
 */
export function pickPhoneMatch<T extends { phone?: string | null }>(
  rows: readonly T[] | null | undefined,
  last10: string,
): T | null {
  if (!/^\d{10}$/.test(last10)) return null;
  for (const row of rows ?? []) {
    if (lastTenDigits(row.phone) === last10) return row;
  }
  return null;
}
