/**
 * Recruiting links: the rules behind "Your link" and "Make a link" on Invite an agent and
 * Refer a recruit (OVERHAUL-1, 2026-10-29).
 *
 * Sam: "Give them an option: either put their first name, last name, email, NPN, phone
 * number... Or an option, just click attach a link, and they just tap it. And it should be
 * at the box of just licensed, not licensed yet, either or. And there should be an option to
 * make permanent link or make a temporary link."
 *
 * Three kinds of link, one vocabulary:
 *   - Your link: /r/<ref_slug> on the public site. Permanent, reusable, and everyone who
 *     applies through it is credited to you (MP-342: resolve-ref-slug -> submit-application
 *     writes recruiter_id, referral_manager_id and referral_recruiter_id -> add-agent places
 *     the hire under you). Nothing here can expire it.
 *   - A hire link (/hire/<token>, Invite an agent) and a prospect join link (/join/<token>,
 *     Refer a recruit): made by create_invitation(), single use, either Permanent (stored as
 *     expires_at 'infinity'; the RPCs send expires_at null with permanent true) or Temporary.
 *
 * Everything here is pure so the pages, the tests and the server agree on the words.
 */
import { normalizePhoneForDial } from "@/lib/phone";

export type LinkMode = "quick" | "details";
export type LicenseChoice = "licensed" | "unlicensed";
export type LinkLifetime = "permanent" | "temporary";
export type InviteLinkKind = "hire" | "join";

/** The public site every shared link points at, so a link copied on a preview build still works. */
export const PUBLIC_SITE = "https://apex-financial.org";

/** How long a temporary link can work. fn_invite_insert clamps to 1..720 hours. */
export const TEMPORARY_SPANS: ReadonlyArray<{ hours: number; label: string }> = [
  { hours: 24, label: "1 day" },
  { hours: 72, label: "3 days" },
  { hours: 168, label: "7 days" },
  { hours: 336, label: "14 days" },
  { hours: 720, label: "30 days" },
];

/** A week, as before this change: the span 81 of the 82 invitations on record used. */
export const DEFAULT_TEMPORARY_HOURS = 168;

export const LINK_MODE_LABEL: Record<LinkMode, string> = {
  quick: "Quick link",
  details: "With details",
};

export const LICENSE_CHOICE_LABEL: Record<LicenseChoice, string> = {
  licensed: "Licensed",
  unlicensed: "Not licensed yet",
};

export const LINK_LIFETIME_LABEL: Record<LinkLifetime, string> = {
  permanent: "Permanent",
  temporary: "Temporary",
};

/**
 * The viewer's own permanent link. my_recruiting_link() returns ref_slug; the short form on
 * the public site is what people text and put in a bio. Null when there is no slug: the page
 * says so instead of showing a link that resolves to nobody.
 */
export function ownLinkUrl(refSlug: string | null | undefined): string | null {
  const slug = (refSlug ?? "").trim();
  if (!slug) return null;
  return `${PUBLIC_SITE}/r/${encodeURIComponent(slug)}`;
}

/** The path an /r/ link carries, for the attribution round trip (/r/<slug> -> /apply?ref=<slug>). */
export function ownLinkPath(url: string): string {
  return url.startsWith(PUBLIC_SITE) ? url.slice(PUBLIC_SITE.length) : url;
}

/** When a temporary link made now stops working. Spans outside 1..720 hours are clamped like the server does. */
export function expiryFrom(hours: number, now: Date = new Date()): Date {
  const span = Math.max(1, Math.min(720, Math.round(Number.isFinite(hours) ? hours : DEFAULT_TEMPORARY_HOURS)));
  return new Date(now.getTime() + span * 3_600_000);
}

function toDate(value: Date | string | null | undefined): Date | null {
  if (value == null || value === "") return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * "Tue, Nov 4 at 9:15 PM", with the year only when it is not this year. Null for a value
 * that is missing or unreadable, so a caller can never print "Invalid Date".
 */
export function formatExpiry(
  value: Date | string | null | undefined,
  opts: { now?: Date; locale?: string; timeZone?: string } = {},
): string | null {
  const d = toDate(value);
  if (!d) return null;
  const now = opts.now ?? new Date();
  const yearOf = (x: Date) => new Intl.DateTimeFormat("en-US", { year: "numeric", timeZone: opts.timeZone }).format(x);
  const sameYear = yearOf(d) === yearOf(now);
  const day = new Intl.DateTimeFormat(opts.locale, {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
    timeZone: opts.timeZone,
  }).format(d);
  const time = new Intl.DateTimeFormat(opts.locale, { hour: "numeric", minute: "2-digit", timeZone: opts.timeZone }).format(d);
  return `${day} at ${time}`;
}

/**
 * The one line that says how long a link works. Permanent says so; a temporary link names the
 * moment it stops; an expiry nobody can read says that, and never claims the link is permanent
 * (unknown is never "fine").
 */
export function lifetimeLine(
  link: { permanent?: boolean | null; expiresAt?: string | Date | null },
  opts: { now?: Date; locale?: string; timeZone?: string } = {},
): string {
  if (link.permanent === true) return "Never expires";
  const when = formatExpiry(link.expiresAt ?? null, opts);
  return when ? `Stops working ${when}` : "Expiry date unknown";
}

export interface LinkDetailFields {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  npn: string;
}

export const EMPTY_DETAILS: LinkDetailFields = { firstName: "", lastName: "", email: "", phone: "", npn: "" };

/**
 * What a link carries for each mode. A Quick link carries nothing, even when details were
 * typed before switching to Quick: what is sent is what the screen says.
 */
export function detailsToSend(mode: LinkMode, fields: LinkDetailFields): LinkDetailFields {
  if (mode === "quick") return { ...EMPTY_DETAILS };
  return {
    firstName: fields.firstName.trim(),
    lastName: fields.lastName.trim(),
    email: fields.email.trim(),
    phone: fields.phone.trim(),
    npn: fields.npn.trim(),
  };
}

/** True when the details mode has at least one value; a "With details" link with none is a Quick link. */
export function hasAnyDetail(fields: LinkDetailFields): boolean {
  return Object.values(fields).some((v) => v.trim() !== "");
}

/** The server's role for a hire link, from the License choice (fn_invite_authorize's vocabulary). */
export function hireTargetRole(inviteAs: string, license: LicenseChoice | null): string {
  if (inviteAs !== "agent") return inviteAs;
  return license === "licensed" ? "hired_licensed" : "hired_unlicensed";
}

export interface LinkMessageInput {
  kind: InviteLinkKind | "own";
  url: string;
  orgName: string;
  firstName?: string | null;
}

/** The sentence that goes with a shared link, in plain words. The URL is not in it (see linkText). */
export function linkSentence(input: LinkMessageInput): string {
  const first = (input.firstName ?? "").trim().split(/\s+/)[0] ?? "";
  const hi = first ? `Hi ${first}, here` : "Here";
  if (input.kind === "own") return `Here is my link to join ${input.orgName}:`;
  if (input.kind === "join") return `${hi} is your link to apply to ${input.orgName}:`;
  return `${hi} is your personal link to join ${input.orgName}:`;
}

/** The whole text message: sentence, then the link on its own line so phones make it tappable. */
export function linkText(input: LinkMessageInput): string {
  return `${linkSentence(input)}\n${input.url}`;
}

/**
 * A text-message link with the message filled in. "sms:<number>?&body=" opens Messages on
 * iPhone and Android alike; with no number the person picks who to send it to.
 */
export function textHref(phone: string | null | undefined, body: string): string {
  const to = normalizePhoneForDial(phone) ?? "";
  return `sms:${to}?&body=${encodeURIComponent(body)}`;
}

/** An email draft in the person's own mail app. Opening it sends nothing. */
export function emailHref(input: {
  to?: string | null;
  kind: InviteLinkKind | "own";
  url: string;
  orgName: string;
  firstName?: string | null;
  permanent?: boolean | null;
  expiresAt?: string | Date | null;
  recipientLocked?: boolean;
}): string {
  const subject = input.kind === "join"
    ? `Your link to apply to ${input.orgName}`
    : input.kind === "own"
      ? `Join me at ${input.orgName}`
      : `Your invitation to ${input.orgName}`;
  const first = (input.firstName ?? "").trim().split(/\s+/)[0] ?? "";
  const rules: string[] = [];
  if (input.kind !== "own") {
    rules.push(input.recipientLocked ? "It works once, and only for this email address." : "It works once.");
    if (input.permanent !== true) {
      const when = formatExpiry(input.expiresAt ?? null);
      if (when) rules.push(`It stops working ${when}.`);
    }
  }
  // The greeting is its own line in an email, so the sentence is the unnamed "Here is ..." form.
  const sentence = linkSentence({ kind: input.kind, url: input.url, orgName: input.orgName });
  const body = `${first ? `Hi ${first},` : "Hi,"}\n\n${sentence}\n${input.url}${rules.length ? `\n\n${rules.join(" ")}` : ""}`;
  const to = (input.to ?? "").trim();
  return `mailto:${to ? encodeURIComponent(to) : ""}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export type ShareChannel = "copy" | "share" | "text" | "email_draft";

/** What a Share press did, so the caller can say it in words. */
export type ShareOutcome = "shared" | "cancelled" | "copied" | "failed";

/**
 * Native share sheet when the browser has one; otherwise the link is copied and the caller
 * says so. A cancelled sheet is not an error and plays nothing.
 */
export async function shareLink(
  data: { title: string; text: string; url: string },
  nav: Pick<Navigator, "clipboard"> & { share?: Navigator["share"] } = navigator,
): Promise<ShareOutcome> {
  if (typeof nav.share === "function") {
    try {
      await nav.share(data);
      return "shared";
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return "cancelled";
      if ((err as { name?: string } | null)?.name === "AbortError") return "cancelled";
      // A share sheet that refused (NotAllowedError, an unsupported payload) still leaves the copy path.
    }
  }
  try {
    await nav.clipboard.writeText(data.url);
    return "copied";
  } catch {
    return "failed";
  }
}

/** Whether this device texts from its own Messages app (a phone or tablet), rather than a desktop with none. */
export function canTextFromDevice(): boolean {
  return typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(pointer: coarse)").matches;
}
