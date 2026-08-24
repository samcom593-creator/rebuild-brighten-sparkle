/**
 * Demo mode — show the platform's functions without showing anyone real data.
 *
 * Sam demos APEX to recruits, prospective agents and partners. Every one of
 * those screens currently renders live production: real client names, real
 * premiums, real agent earnings. This replaces the *values* while leaving the
 * product identical, so a walkthrough shows how the system works without
 * disclosing the book.
 *
 * WHERE IT HOOKS
 * One seam, not 250 pages: the Supabase client already routes every request
 * through a custom fetch (boundedFetch), so demo masking wraps that. Every
 * page, view, chart and RPC that reads through the client is covered without
 * touching a single component.
 *
 * WHAT IS AND IS NOT MASKED — this is the whole design
 * Masking a value the app uses for LOGIC breaks the demo. So:
 *   - ids, uuids, foreign keys, slugs, enums, booleans, timestamps and dates
 *     pass through untouched. Filters, joins, routing, sorting by date and
 *     "is this row mine" all keep working.
 *   - money and counts are replaced with deterministic look-alikes that keep
 *     the ORDER OF MAGNITUDE of the original, so charts still look like
 *     charts, leaderboards still rank plausibly, and nothing renders as $0.
 *   - person-identifying strings (names, emails, phones) are replaced from a
 *     fixed fake roster, deterministically — the same real person always maps
 *     to the same fake person, so a name is consistent across every screen in
 *     the walkthrough instead of changing between pages.
 *
 * DETERMINISM
 * Everything derives from a hash of the original value, never from
 * Math.random(). Re-rendering, refetching or navigating back must not change
 * the numbers mid-demo — a leaderboard that reshuffles on every paint is worse
 * than no demo at all.
 *
 * WRITES ARE NOT MASKED AND NOT BLOCKED
 * Only GET responses are rewritten. A write performed during a demo still
 * writes real data to the real database — this is a display mask, not a
 * sandbox. Deliberate: Sam demos on the live system, and silently swallowing
 * his writes would be its own fake-success bug.
 */

const STORAGE_KEY = "apex.demoMode";

let enabled = false;

/** Deterministic 32-bit hash. Same input → same output, forever. */
function hash(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

/** Stable pseudo-random in [0,1) derived from a seed string. */
function rand(seed: string): number {
  return (hash(seed) % 100000) / 100000;
}

const FIRST_NAMES = [
  "Jordan", "Avery", "Casey", "Riley", "Morgan", "Quinn", "Reese", "Skyler",
  "Devon", "Emerson", "Harper", "Rowan", "Sage", "Tatum", "Blake", "Drew",
  "Elliot", "Finley", "Hayden", "Jaden", "Kendall", "Lennox", "Marlowe", "Nico",
];
const LAST_NAMES = [
  "Bennett", "Calloway", "Donovan", "Ellison", "Fairchild", "Grayson",
  "Hollis", "Ingram", "Jennings", "Kingsley", "Langford", "Merritt",
  "Northcott", "Oakley", "Prescott", "Quimby", "Ridgeway", "Sutherland",
  "Thorne", "Underwood", "Vance", "Whitaker", "Yates", "Ashford",
];

function fakeFirst(seed: string) { return FIRST_NAMES[hash(seed) % FIRST_NAMES.length]; }
function fakeLast(seed: string) { return LAST_NAMES[hash(seed + "l") % LAST_NAMES.length]; }
function fakeFull(seed: string) { return `${fakeFirst(seed)} ${fakeLast(seed)}`; }

/**
 * Columns whose numbers are safe and useful to fake. Matched on the KEY name,
 * not the value, so an `id: 12345` is never mistaken for money.
 */
const NUMERIC_KEY = /(premium|alp|aop|amount|revenue|earning|commission|payout|balance|total|volume|face|charge|deal|policy_count|policies|count|deals_closed|presentations|referrals|leads|hires|applications|sales|score|rank|streak|target|goal|quota|pace|value|price|cost|spend|net|gross)/i;

/** Never touch these, whatever else matches — the app runs on them. */
const PROTECTED_KEY = /(^id$|_id$|_at$|_date$|uuid|slug|key$|token|url|href|path|status|stage|role|type|kind|code$|is_|has_|enabled|active|passed|percent|order_index|version|sha|hash)/i;

const NAME_KEY = /(first_name|last_name|full_name|display_name|agent_name|client_name|manager_name|producer_name|recruiter_name|^name$|title_holder)/i;
const EMAIL_KEY = /email/i;
const PHONE_KEY = /phone|mobile|cell/i;

/**
 * Keep the magnitude, change the number. A $2,400 premium becomes another
 * plausible four-figure premium; a 3-deal week becomes another small integer.
 * Anything that would render as an obvious placeholder (0, 1234) is avoided.
 */
function maskNumber(value: number, seed: string): number {
  if (!Number.isFinite(value) || value === 0) return value;
  const negative = value < 0;
  const abs = Math.abs(value);
  const jitter = 0.6 + rand(seed) * 0.8;          // 0.6x – 1.4x
  let out = abs * jitter;
  // Integers stay integers, so counts never render as "3.7 deals".
  out = Number.isInteger(value) ? Math.max(1, Math.round(out)) : Math.round(out * 100) / 100;

  // A mask that returns the input is not a mask. Small integers are where this
  // bites — round(12 * jitter) lands back on 12 for a wide band of jitter, and
  // small integers (deals today, hires this week, agents on a leg) are exactly
  // the numbers a demo shows most. Caught by the test, not by reading the code.
  // Nudge deterministically so the value still never changes between renders.
  if (out === abs) {
    if (Number.isInteger(value)) {
      out = hash(seed) % 2 === 0 ? out + 1 : Math.max(1, out - 1);
      // abs === 1 makes `out - 1` clamp back to 1; go up instead.
      if (out === abs) out = abs + 1;
    } else {
      out = Math.round((abs * 1.07 + 0.01) * 100) / 100;
    }
  }

  return negative ? -out : out;
}

function maskString(key: string, value: string): string {
  if (!value) return value;
  if (EMAIL_KEY.test(key)) {
    const seed = value.toLowerCase();
    return `${fakeFirst(seed).toLowerCase()}.${fakeLast(seed).toLowerCase()}@example.com`;
  }
  if (PHONE_KEY.test(key)) {
    // 555-01xx is the reserved fictional range — it can never dial a real person.
    const n = hash(value) % 100;
    return `(555) 010-${String(n).padStart(2, "0")}${String(hash(value + "x") % 10)}`;
  }
  if (NAME_KEY.test(key)) {
    const seed = value.toLowerCase().trim();
    if (/first/i.test(key)) return fakeFirst(seed);
    if (/last/i.test(key)) return fakeLast(seed);
    return fakeFull(seed);
  }
  return value;
}

function maskValue(key: string, value: unknown): unknown {
  if (value === null || value === undefined) return value;

  if (Array.isArray(value)) return value.map((v) => maskValue(key, v));

  if (typeof value === "object") return maskRow(value as Record<string, unknown>);

  if (PROTECTED_KEY.test(key)) return value;

  if (typeof value === "number" && NUMERIC_KEY.test(key)) {
    return maskNumber(value, `${key}:${value}`);
  }

  if (typeof value === "string") {
    // Numeric-as-string (PostgREST returns numeric/bigint as strings).
    if (NUMERIC_KEY.test(key) && /^-?\d+(\.\d+)?$/.test(value)) {
      return String(maskNumber(Number(value), `${key}:${value}`));
    }
    return maskString(key, value);
  }

  return value;
}

function maskRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) out[k] = maskValue(k, v);
  return out;
}

export function maskPayload(payload: unknown): unknown {
  if (Array.isArray(payload)) return payload.map((r) => maskPayload(r));
  if (payload && typeof payload === "object") return maskRow(payload as Record<string, unknown>);
  return payload;
}

// ─── Flag ────────────────────────────────────────────────────────────────────

export function isDemoMode(): boolean {
  return enabled;
}

export function setDemoMode(on: boolean): void {
  enabled = on;
  try {
    if (on) localStorage.setItem(STORAGE_KEY, "1");
    else localStorage.removeItem(STORAGE_KEY);
    // empty-catch-allow:private-mode-storage; the in-memory flag is the source of truth
  } catch {
    /* Safari private mode throws on setItem — demo mode still works this session */
  }
}

/**
 * Read the flag before the first query goes out. `?demo=1` turns it on and
 * `?demo=0` turns it off, so Sam can hand someone a URL rather than talk them
 * through a settings toggle, and can leave demo mode from the address bar if a
 * page ever fails to render its own control.
 */
export function initDemoMode(): void {
  let fromUrl: boolean | null = null;
  try {
    const p = new URLSearchParams(window.location.search).get("demo");
    if (p === "1" || p === "true") fromUrl = true;
    if (p === "0" || p === "false") fromUrl = false;
    // empty-catch-allow:no-window-in-ssr; falls through to stored value
  } catch {
    /* no window (SSR/tests) — use the stored value */
  }

  if (fromUrl !== null) {
    setDemoMode(fromUrl);
    return;
  }
  try {
    enabled = localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    // empty-catch-allow:private-mode-storage; default off is the safe direction
    enabled = false;
  }
}
