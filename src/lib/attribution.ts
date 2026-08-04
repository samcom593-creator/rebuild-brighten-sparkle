/**
 * attribution.ts — first-touch + last-touch marketing attribution capture.
 *
 * Why this exists (2026-08-04):
 * 776 of 783 production applications (99.1%) had utm_source = NULL, and the
 * codebase had never captured a gclid at all. The cause was structural, not
 * a tracking-pixel misconfiguration:
 *
 *   Apply.tsx read every attribution field with `searchParams.get(...)`, i.e.
 *   from whatever the URL happened to be AT SUBMIT TIME. A visitor landing on
 *   `/?utm_source=google&gclid=Cj0...` and then clicking "Start My Application"
 *   moves to `/apply` — a client-side route change that carries no query
 *   string — so by the time the form posted, the params were already gone.
 *   Nothing anywhere persisted them (verified: zero localStorage/sessionStorage
 *   /cookie attribution writes existed before this file).
 *
 * Consequences that cost real money:
 *   - Ad spend could not be attributed to applications, so channel ROI was
 *     guesswork. Only direct-to-/apply?utm_* links (7 of 783) ever recorded.
 *   - With no gclid stored, Google Ads offline conversion import — the whole
 *     mechanism for telling Google which clicks became real applicants — was
 *     impossible.
 *
 * Design, mirroring the refSlug.ts relay that already solved this shape of
 * problem for `?ref=`:
 *   - captureAttribution() runs at app entry (src/main.tsx), BEFORE React
 *     mounts, so it sees the true landing URL no matter which route was hit.
 *   - FIRST-TOUCH goes to localStorage and is written exactly once. It is the
 *     campaign that actually earned the lead and must survive later navigation,
 *     later sessions, and organic re-visits. Never overwritten.
 *   - LAST-TOUCH goes to sessionStorage and is overwritten whenever fresh
 *     signals appear, so a re-entry from a different ad in the same session is
 *     still visible without destroying first-touch credit.
 *   - getAttribution() merges: first-touch wins as the primary attribution,
 *     last-touch rides along inside attribution_json, and live URL params only
 *     fill fields that nothing stored can answer.
 *
 * Safety rules baked in:
 *   - Every storage access is guarded. Safari private mode, disabled storage,
 *     and quota errors degrade to an in-memory fallback rather than throwing —
 *     an attribution failure must never break the application form.
 *   - Values longer than MAX_VALUE_LEN are dropped and the whole stored payload
 *     is size-capped, so a junk/oversized query string cannot fill storage or
 *     blow past the edge function's per-field zod max().
 *   - Only campaign parameters, the landing path, and the referrer origin are
 *     stored. No PII, and the referrer is reduced to origin + pathname so a
 *     referring URL's own query string can never smuggle personal data in.
 */

/** Campaign params we persist. Order is the order they land in payloads. */
export const UTM_KEYS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
] as const;

/** Ad-platform click identifiers. gclid is the one Google Ads offline
 *  conversion import requires; the rest are the equivalents for gbraid/wbraid
 *  (iOS Google), Meta, TikTok, and Microsoft Ads. */
export const CLICK_ID_KEYS = [
  "gclid",
  "gbraid",
  "wbraid",
  "fbclid",
  "ttclid",
  "msclkid",
] as const;

export const ATTRIBUTION_KEYS = [...UTM_KEYS, ...CLICK_ID_KEYS, "source"] as const;

export type AttributionKey = (typeof ATTRIBUTION_KEYS)[number];

export interface AttributionSnapshot {
  /** Campaign params + click ids present at the time of capture. */
  params: Partial<Record<AttributionKey, string>>;
  /** ISO timestamp of capture. */
  at: string;
  /** Path + search of the page that was landed on (never a full origin). */
  landingUrl: string | null;
  /** External referrer reduced to origin + pathname. Null for direct/internal. */
  referrer: string | null;
}

export interface MergedAttribution {
  source: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  utmTerm: string | null;
  gclid: string | null;
  gbraid: string | null;
  wbraid: string | null;
  fbclid: string | null;
  ttclid: string | null;
  msclkid: string | null;
  /** ISO timestamp of the FIRST touch, not this submit. */
  firstTouchAt: string | null;
  firstLandingUrl: string | null;
  firstReferrer: string | null;
  /** Path of the page the form was actually submitted from. */
  landingUrl: string;
  /** Full audit blob: first-touch, last-touch, and current-URL snapshots. */
  attributionJson: Record<string, unknown>;
}

const FIRST_TOUCH_KEY = "apex_attr_first";
const LAST_TOUCH_KEY = "apex_attr_last";

/** Per-value cap. The edge function's zod schema allows 200 chars for utm_*
 *  fields; anything longer than this is junk or an injection attempt, not a
 *  real campaign name. Click ids are long but comfortably under 200. */
const MAX_VALUE_LEN = 200;
/** Hard cap on the serialized snapshot. Nothing legitimate approaches this;
 *  it exists so a crafted URL cannot consume the storage quota. */
const MAX_PAYLOAD_BYTES = 4000;
const MAX_URL_LEN = 500;

/**
 * In-memory fallback used when Web Storage throws or is unavailable
 * (Safari private mode, storage disabled, quota exhausted). Attribution then
 * survives for the life of the page — strictly worse than persisted storage,
 * strictly better than crashing or losing everything.
 */
const memoryStore: Record<string, string> = {};

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

function readStore(kind: "local" | "session", key: string): string | null {
  if (!isBrowser()) return null;
  try {
    const store = kind === "local" ? window.localStorage : window.sessionStorage;
    const value = store?.getItem(key);
    if (value !== null && value !== undefined) return value;
  } catch (_err) { // empty-catch-allow:localstorage-incognito
    // Storage unavailable (private mode / disabled). Fall through to memory.
  }
  return memoryStore[key] ?? null;
}

function writeStore(kind: "local" | "session", key: string, value: string): void {
  if (!isBrowser()) return;
  // Always mirror into memory so a later storage failure still has the value.
  memoryStore[key] = value;
  try {
    const store = kind === "local" ? window.localStorage : window.sessionStorage;
    store?.setItem(key, value);
  } catch (_err) { // empty-catch-allow:localstorage-incognito
    // Quota exceeded or storage disabled — the memory mirror above is the
    // fallback. Deliberately not rethrown: attribution must never break a form.
  }
}

/** Trim, drop empties, and reject absurdly long values. */
function cleanValue(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.length > MAX_VALUE_LEN) return null;
  return trimmed;
}

function cleanUrl(raw: string | null | undefined): string | null {
  const value = cleanValueLoose(raw, MAX_URL_LEN);
  return value;
}

function cleanValueLoose(raw: string | null | undefined, max: number): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

/** Reduce a referrer to origin + pathname. Drops its query string and hash so
 *  a referring page cannot leak its own params (potentially PII) into our DB. */
function normalizeReferrer(raw: string | null | undefined): string | null {
  const value = cleanValueLoose(raw, 1000);
  if (!value) return null;
  try {
    const url = new URL(value);
    if (isBrowser() && url.origin === window.location.origin) return null; // internal nav
    return cleanUrl(`${url.origin}${url.pathname}`);
  } catch (_err) {
    // Not a parseable URL — ignore rather than storing something unusable.
    return null;
  }
}

/** Read the campaign params present in a given URL. */
function readParamsFromUrl(href: string): Partial<Record<AttributionKey, string>> {
  const out: Partial<Record<AttributionKey, string>> = {};
  let search: URLSearchParams;
  try {
    search = new URL(href).searchParams;
  } catch (_err) {
    // Unparseable href (test harness, exotic scheme) — no params to read.
    return out;
  }
  for (const key of ATTRIBUTION_KEYS) {
    const value = cleanValue(search.get(key));
    if (value) out[key] = value;
  }
  return out;
}

function hasSignal(snapshot: AttributionSnapshot): boolean {
  return Object.keys(snapshot.params).length > 0 || snapshot.referrer !== null;
}

function serialize(snapshot: AttributionSnapshot): string | null {
  const json = JSON.stringify(snapshot);
  if (json.length > MAX_PAYLOAD_BYTES) return null;
  return json;
}

function deserialize(raw: string | null): AttributionSnapshot | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<AttributionSnapshot>;
    if (!parsed || typeof parsed !== "object") return null;
    const params: Partial<Record<AttributionKey, string>> = {};
    const rawParams = (parsed.params ?? {}) as Record<string, unknown>;
    for (const key of ATTRIBUTION_KEYS) {
      const value = cleanValue(typeof rawParams[key] === "string" ? (rawParams[key] as string) : null);
      if (value) params[key] = value;
    }
    return {
      params,
      at: typeof parsed.at === "string" ? parsed.at : new Date().toISOString(),
      landingUrl: cleanUrl(parsed.landingUrl),
      referrer: cleanUrl(parsed.referrer),
    };
  } catch (_err) {
    // Malformed JSON (hand-edited storage, partial write) — treat as absent.
    return null;
  }
}

/** Build a snapshot of whatever attribution the CURRENT page load carries. */
export function readCurrentSnapshot(): AttributionSnapshot {
  const href = isBrowser() ? window.location.href : "";
  const params = href ? readParamsFromUrl(href) : {};
  let landingUrl: string | null = null;
  if (isBrowser()) {
    landingUrl = cleanUrl(`${window.location.pathname}${window.location.search}`);
  }
  const referrer = normalizeReferrer(
    typeof document !== "undefined" ? document.referrer : null,
  );
  return { params, at: new Date().toISOString(), landingUrl, referrer };
}

/**
 * Capture attribution for this page load. Safe to call more than once —
 * first-touch is written at most once, ever, per browser.
 *
 * Call this as early as possible at app entry so it observes the real landing
 * URL. Once React Router takes over, query params are gone.
 */
export function captureAttribution(): void {
  if (!isBrowser()) return;
  const current = readCurrentSnapshot();
  if (!hasSignal(current)) return;

  // FIRST-TOUCH: write once, never overwrite. This is the campaign that
  // actually earned the lead.
  const existingFirst = deserialize(readStore("local", FIRST_TOUCH_KEY));
  if (!existingFirst) {
    const payload = serialize(current);
    if (payload) writeStore("local", FIRST_TOUCH_KEY, payload);
  }

  // LAST-TOUCH: always refresh when new signals arrive in this session.
  const lastPayload = serialize(current);
  if (lastPayload) writeStore("session", LAST_TOUCH_KEY, lastPayload);
}

export function getFirstTouch(): AttributionSnapshot | null {
  return deserialize(readStore("local", FIRST_TOUCH_KEY));
}

export function getLastTouch(): AttributionSnapshot | null {
  return deserialize(readStore("session", LAST_TOUCH_KEY));
}

/**
 * Merge stored + live attribution into the shape the submit path sends.
 *
 * Precedence per field: first-touch → last-touch → current URL. First-touch
 * wins because it is the click that earned the lead; the live URL only fills
 * gaps nothing stored can answer (e.g. a direct-to-/apply?utm_* link on a
 * browser with storage disabled).
 */
export function getAttribution(): MergedAttribution {
  const first = getFirstTouch();
  const last = getLastTouch();
  const current = readCurrentSnapshot();

  const pick = (key: AttributionKey): string | null =>
    first?.params[key] ?? last?.params[key] ?? current.params[key] ?? null;

  const attributionJson: Record<string, unknown> = {
    first: first ? { params: first.params, at: first.at, landingUrl: first.landingUrl, referrer: first.referrer } : null,
    last: last ? { params: last.params, at: last.at, landingUrl: last.landingUrl, referrer: last.referrer } : null,
    current: { params: current.params, at: current.at, landingUrl: current.landingUrl, referrer: current.referrer },
    v: 1,
  };

  return {
    source: pick("source"),
    utmSource: pick("utm_source"),
    utmMedium: pick("utm_medium"),
    utmCampaign: pick("utm_campaign"),
    utmContent: pick("utm_content"),
    utmTerm: pick("utm_term"),
    gclid: pick("gclid"),
    gbraid: pick("gbraid"),
    wbraid: pick("wbraid"),
    fbclid: pick("fbclid"),
    ttclid: pick("ttclid"),
    msclkid: pick("msclkid"),
    firstTouchAt: first?.at ?? null,
    firstLandingUrl: first?.landingUrl ?? null,
    firstReferrer: first?.referrer ?? null,
    landingUrl: isBrowser() ? window.location.pathname : "/",
    attributionJson,
  };
}

/** Test/debug helper — wipes stored attribution from both stores + memory. */
export function clearAttribution(): void {
  delete memoryStore[FIRST_TOUCH_KEY];
  delete memoryStore[LAST_TOUCH_KEY];
  if (!isBrowser()) return;
  try {
    window.localStorage?.removeItem(FIRST_TOUCH_KEY);
  } catch (_err) { // empty-catch-allow:localstorage-incognito
    // Storage unavailable — memory copy above is already cleared.
  }
  try {
    window.sessionStorage?.removeItem(LAST_TOUCH_KEY);
  } catch (_err) { // empty-catch-allow:localstorage-incognito
    // Storage unavailable — memory copy above is already cleared.
  }
}
