/**
 * refSlug.ts — referral slug relay between landing and /apply.
 *
 * Why this exists (verify-workflow S11, 2026-06-15):
 * A visitor hits apex-financial.org/?ref=<slug> and then clicks "Start My
 * Application" from the landing page. /apply already wires `?ref=` correctly
 * (resolve-ref-slug edge fn + e2353437), but the landing CTA links go to a
 * bare "/apply" — so the slug evaporates on click and the referring agent
 * loses credit.
 *
 * Fix: capture the slug on landing mount, persist to localStorage with a 24h
 * TTL, fall back to it on /apply when the URL ?ref= is absent, clear after a
 * successful submit. CTAs ALSO get the slug appended to their href so the
 * URL is still the primary source of truth — localStorage is the safety net
 * for the missed-href path or future CTAs that forget the wiring.
 *
 * Slug format intentionally narrow: `[a-zA-Z0-9-_]{1,64}` matches the same
 * surface the agents table seeds (see AgentReferralLinkCard.tsx). Anything
 * outside that gets dropped — no XSS / no injection / no oversized writes.
 */

const STORAGE_KEY = "apex.ref_slug";
const TTL_MS = 24 * 60 * 60 * 1000; // 24h — matches "session" intuition for
                                    // someone who saw the link today.
const SLUG_PATTERN = /^[a-zA-Z0-9-_]{1,64}$/;

interface StoredSlug {
  slug: string;
  expiresAt: number;
}

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function isValidSlug(slug: string | null | undefined): slug is string {
  return typeof slug === "string" && SLUG_PATTERN.test(slug);
}

/**
 * Persist a slug to localStorage with a 24h TTL. No-op if invalid format or
 * non-browser env (SSR safety). Silent on quota / disabled-storage errors —
 * we never want a referral-relay failure to break the landing page.
 */
export function setRefSlug(slug: string): void {
  if (!isBrowser() || !isValidSlug(slug)) return;
  try {
    const payload: StoredSlug = {
      slug,
      expiresAt: Date.now() + TTL_MS,
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch (_err) { // empty-catch-allow:localstorage-incognito
    // Storage may be disabled (Safari private mode, quota exceeded). Falling
    // back to "no relay" is correct behavior — better than throwing.
  }
}

/**
 * Read slug, preferring URL params, falling back to localStorage. Returns
 * null if neither source is present or stored value is expired / malformed.
 *
 * Callers pass the URL value explicitly so this stays SSR-safe and doesn't
 * pull react-router-dom into the helper.
 */
export function getRefSlug(urlSlug?: string | null): string | null {
  if (isValidSlug(urlSlug)) return urlSlug;
  if (!isBrowser()) return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredSlug>;
    if (typeof parsed?.expiresAt !== "number" || parsed.expiresAt < Date.now()) {
      // Expired — clean up so future reads short-circuit.
      window.localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return isValidSlug(parsed.slug) ? parsed.slug : null;
  } catch (_err) {
    // Malformed JSON / storage error — treat as "no slug stored".
    return null;
  }
}

/**
 * Clear the stored slug. Call after the application is submitted so the
 * relay doesn't bleed into a second submission from the same browser.
 */
export function clearRefSlug(): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch (_err) { // empty-catch-allow:localstorage-incognito
    // Same rationale as setRefSlug — never throw from this helper.
  }
}

/**
 * Build an /apply href with the slug appended when present. Used by landing
 * CTAs so the URL stays the primary referral signal — localStorage is the
 * safety net, not the only source.
 */
export function applyHrefWithRef(slug: string | null | undefined): string {
  if (!isValidSlug(slug)) return "/apply";
  return `/apply?ref=${encodeURIComponent(slug)}`;
}
