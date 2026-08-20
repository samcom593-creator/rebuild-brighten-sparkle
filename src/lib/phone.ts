const MIN_E164_DIGITS = 8;
const MAX_E164_DIGITS = 15;

export const GOOGLE_VOICE_HOME_HREF = "https://voice.google.com/";

/**
 * Opens Google's account chooser before Voice. This is the recovery path when
 * the currently selected Gmail account shows "Upgrade not available"; APEX
 * cannot change Google's eligibility decision, but it can avoid trapping a VA
 * on the wrong signed-in account.
 */
export function googleVoiceAccountChooserHref(destination = GOOGLE_VOICE_HOME_HREF): string {
  return `https://accounts.google.com/AccountChooser?continue=${encodeURIComponent(destination)}`;
}

/**
 * Converts a phone value into a dialable E.164-style number.
 * US numbers may omit +1. International numbers must include +, 00, or 011.
 */
export function normalizePhoneForDial(value: string | null | undefined): string | null {
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

export function isDialablePhone(value: string | null | undefined): boolean {
  return normalizePhoneForDial(value) !== null;
}

// 2026-08-16: these returned tel:/sms:, which are DEAD CLICKS on a desktop with
// no phone/SMS app — which is every APEX VA. Result: "the buttons just don't
// work at all for her." They now route through Google Voice's web app, which
// works in a browser, keeps caller-ID on the GV number, and needs no paid
// provider. The desktop URL goes through Google's account chooser so a VA is
// not pinned to an ineligible `/u/0` Gmail session. On a phone (coarse pointer)
// tel:/sms: still win, so mobile keeps native dialing — see phoneHref/smsHref.
function isTouchDevice(): boolean {
  return typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(pointer: coarse)").matches;
}

export function phoneHref(value: string | null | undefined): string | null {
  const normalized = normalizePhoneForDial(value);
  if (!normalized) return null;
  return isTouchDevice() ? `tel:${normalized}` : googleVoiceHref(normalized);
}

export function smsHref(value: string | null | undefined): string | null {
  const normalized = normalizePhoneForDial(value);
  if (!normalized) return null;
  return isTouchDevice() ? `sms:${normalized}` : googleVoiceSmsHref(normalized);
}

/**
 * Google Voice message deep link — chooses the eligible account, then opens the
 * GV conversation with this number staged so desktop reps can text.
 */
export function googleVoiceSmsHref(value: string | null | undefined): string | null {
  const normalized = normalizePhoneForDial(value);
  return normalized
    ? googleVoiceAccountChooserHref(`https://voice.google.com/messages?itemId=t.${encodeURIComponent(normalized)}`)
    : null;
}

/**
 * Google Voice click-to-call. Google's account chooser runs first because the
 * default Gmail session can be Voice-ineligible; the chosen account then opens
 * the browser dialer with the number staged. The `a=nc,<E.164>` param is GV's
 * "new call" deep link.
 */
export function googleVoiceHref(value: string | null | undefined): string | null {
  const normalized = normalizePhoneForDial(value);
  return normalized
    ? googleVoiceAccountChooserHref(`https://voice.google.com/calls?a=nc,${encodeURIComponent(normalized)}`)
    : null;
}

export function openGoogleVoice(value: string | null | undefined): boolean {
  const href = googleVoiceHref(value);
  if (!href) return false;
  window.open(href, "_blank", "noopener");
  return true;
}
