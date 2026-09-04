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

/**
 * The 10-digit NANP national number, or null when the value is not a NANP
 * number. `+1 618 438 1249`, `16184381249` and `6184381249` all collapse to
 * `6184381249`; `+44...` / `+234...` return null because they have no national
 * 10-digit form.
 */
export function nationalDigits(value: string | null | undefined): string | null {
  const normalized = normalizePhoneForDial(value);
  if (!normalized) return null;
  const digits = normalized.slice(1);
  return digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : null;
}

/**
 * 2026-09-04 (MP-416): five page-level formatters had independently written
 * this same logic, and the sixth (WhaleRecruiting) drifted — it gated on
 * `digits.length >= 10` and then sliced positions 0-10, which is correct only
 * at exactly 10. Live prod holds 45 of 50 whale rows as `+1XXXXXXXXXX`, so the
 * page rendered `+16184381249` as "(161) 843-8124": every digit shifted left,
 * the last one dropped, and the result still LOOKS like a valid US number, so
 * nothing on screen said it was wrong. The `href` beside it went through
 * normalizePhoneForDial and was correct, so clicking worked and only the number
 * a human reads was wrong. Fixed-position slicing now lives here only.
 *
 * Anything that is not a NANP number is returned unchanged rather than sliced —
 * a formatter must never invent digits it cannot place.
 */
export function formatPhoneDisplay(
  value: string | null | undefined,
  style: "parens" | "dashes" = "parens",
): string {
  const raw = value?.trim();
  if (!raw) return "";
  const d = nationalDigits(raw);
  if (!d) return raw;
  return style === "dashes"
    ? `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`
    : `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
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

export function smsHref(value: string | null | undefined, body?: string): string | null {
  const normalized = normalizePhoneForDial(value);
  if (!normalized) return null;
  if (isTouchDevice()) {
    return body
      ? `sms:${normalized}?body=${encodeURIComponent(body)}`
      : `sms:${normalized}`;
  }
  // Google Voice's web composer has no documented body/prefill parameter, so a
  // desktop rep gets the right conversation opened but types the script
  // themselves. Stated rather than hidden: this is still strictly better than
  // the bare `sms:` it replaces, which was a dead click on a desktop with no
  // SMS app (see the 2026-08-16 note above) — a prefilled message nobody can
  // open is worth less than an empty thread they can.
  return googleVoiceSmsHref(normalized);
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

/**
 * Anchor props for a contact href produced by phoneHref/smsHref.
 *
 * 2026-09-02 (MP-392): phoneHref/smsHref return a Google Voice **https** URL on
 * desktop (see the 2026-08-16 note above). An https href in a bare <a> navigates
 * the CURRENT tab, so a recruiter who taps Call on the interview queue loses the
 * workspace — filters, scroll position, the open queue — and pays a full SPA cold
 * boot to get back. tel:/sms: hand off to a native app and must NOT be forced into
 * a new tab, which would leave a blank orphan tab behind on mobile.
 *
 * So the target is decided by the scheme, never hardcoded. Interviews.tsx carried
 * this logic as a private helper and four of its six call sites used it; the two
 * that did not were the highest-traffic buttons on the page. Shared here so a new
 * surface cannot get it half-right.
 */
export function contactLinkProps(href: string | null | undefined) {
  return href?.startsWith("https://")
    ? { target: "_blank" as const, rel: "noopener noreferrer" as const }
    : {};
}

/**
 * Imperative twin of contactLinkProps, for the Call/Text controls that navigate
 * from an onClick instead of rendering an <a href>.
 *
 * 2026-09-03 (MP-405): eight such controls still assigned
 * `window.location.href = \`tel:${phone}\`` directly — the AgentProfileDrawer
 * Call/SMS pair (twice over), CallModeInterface, RecruiterDashboard's outcome
 * menu and LicensedInbox's post-queue dial. Those are the same dead click the
 * 2026-08-16 note above describes, just reached through a handler instead of an
 * href, which is why the declarative sweep did not see them.
 *
 * The scheme decides the navigation, exactly as it decides target/rel: a native
 * `tel:`/`sms:` must stay in the current tab so the OS handoff works, and a
 * desktop Google Voice URL must open a NEW tab or the operator loses the queue
 * they were working. Returns false when the number cannot be normalised, so the
 * caller can say so instead of silently doing nothing.
 */
function navigateToContactHref(href: string | null): boolean {
  if (!href) return false;
  if (href.startsWith("https://")) {
    window.open(href, "_blank", "noopener");
  } else {
    window.location.href = href;
  }
  return true;
}

export function startPhoneCall(value: string | null | undefined): boolean {
  return navigateToContactHref(phoneHref(value));
}

export function startSmsThread(value: string | null | undefined, body?: string): boolean {
  return navigateToContactHref(smsHref(value, body));
}
