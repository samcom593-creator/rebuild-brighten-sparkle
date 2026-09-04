// 2026-09-04 (MP-420): the SMS send paths truncated instead of refusing.
//
// Every one of them did `phone.replace(/\D/g, "").slice(-10)` and mailed the
// result to a US carrier email gateway. `slice(-10)` cannot fail: it returns
// the LAST ten digits of whatever it is given, so a Nigerian applicant on
// +234 806 139 9263 became 8061399263 -- area code 806, Amarillo, Texas -- and
// the message went to a stranger there. Measured in prod: 21 application rows
// hold a phone that is not a NANP number, 19 of them carry a carrier value, and
// notification_log records 205 rows as `sent` against them. The log stored the
// applicant's real international number while the gateway address carried the
// truncation, so nothing in the record could say a stranger had been texted.
//
// send-sms-auto-detect's own gate read `if (cleaned.length !== 10) -> 400
// "Invalid phone number - must be 10 digits"`. That gate was structurally dead
// in the direction that matters: cleanPhone had already truncated to ten, so
// the check could never observe an eleventh digit. It could only ever reject
// numbers that were too SHORT.
//
// There is no correct carrier-gateway address for +44 7458 992081. The only
// honest outcome is to refuse and let the caller pick a channel that can carry
// an international number, which is exactly what src/lib/phone.ts already
// decided one day earlier for the DISPLAY side (MP-416: "a formatter must never
// invent digits it cannot place"). The send side never got that rule. It has it
// now, and nanp-phone.parity.test.ts asserts the two implementations agree so
// the browser copy and the Deno copy cannot drift apart.

const MIN_E164_DIGITS = 8;
const MAX_E164_DIGITS = 15;

/**
 * The E.164 form of a phone value, or null when it does not have one.
 * Mirrors normalizePhoneForDial in src/lib/phone.ts.
 */
export function toE164(value: string | null | undefined): string | null {
  const raw = value?.trim();
  if (!raw) return null;

  const digits = raw.replace(/\D/g, "");
  let internationalDigits: string | null = null;

  if (raw.startsWith("+")) {
    internationalDigits = digits;
  } else if (digits.startsWith("011")) {
    internationalDigits = digits.slice(3);
  } else if (digits.startsWith("00")) {
    internationalDigits = digits.slice(2);
  } else if (digits.length === 10) {
    internationalDigits = `1${digits}`;
  } else if (digits.length === 11 && digits.startsWith("1")) {
    internationalDigits = digits;
  }

  if (
    !internationalDigits ||
    internationalDigits.length < MIN_E164_DIGITS ||
    internationalDigits.length > MAX_E164_DIGITS ||
    /^0+$/.test(internationalDigits)
  ) {
    return null;
  }

  return `+${internationalDigits}`;
}

/**
 * The 10-digit NANP national number, or null when the value is not a NANP
 * number. `+1 618 438 1249`, `16184381249` and `6184381249` all collapse to
 * `6184381249`; `+44...` / `+234...` / `081...` return null, because they have
 * no national 10-digit form and any ten digits taken from them address a
 * different, real person.
 *
 * Null is a REFUSAL, not an error. Callers must not send. Mirrors
 * nationalDigits in src/lib/phone.ts.
 */
export function nanpTenDigits(value: string | null | undefined): string | null {
  const normalized = toE164(value);
  if (!normalized) return null;
  const digits = normalized.slice(1);
  return digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : null;
}

/**
 * The primitive this replaced, kept ONLY so the tests can assert it still loses
 * the answer on the real prod values. Never call it to build an address.
 * (MP-275's pattern: a guard that cannot demonstrate the old behaviour was
 * broken is not evidence that the new one is better.)
 */
export function legacySliceTen(phone: string): string {
  return phone.replace(/\D/g, "").slice(-10);
}

/**
 * Why a phone cannot be texted through a US carrier email gateway.
 *
 * Note what this can and cannot say. Prod stores international numbers WITHOUT
 * a leading `+` (`2348061399263`, not `+234...`), and a bare digit string has
 * no country code to read -- 234 could be Nigeria or the first three digits of
 * something else entirely. So the reason names a country only when the stored
 * value actually carries one, and otherwise reports the digit count, which is
 * the fact a human repairing the record can act on. Guessing the country from
 * an unprefixed string would be the same move as guessing the last ten digits.
 */
export function nanpRefusalReason(value: string | null | undefined): string {
  const raw = value?.trim();
  if (!raw) return "no phone on file";
  const e164 = toE164(raw);
  if (e164) {
    return `phone is not a US/Canada number (${e164.slice(0, 4)}\u2026) \u2014 carrier SMS gateways cannot reach it`;
  }
  const digits = raw.replace(/\D/g, "");
  return `phone is not a dialable US/Canada number (${digits.length} digits, no country code) \u2014 carrier SMS gateways cannot reach it`;
}
