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
 * Numbers are masked by DEFAULT. This was an allowlist of money-ish column
 * names until MP-531 measured the admin surface: 62 numeric keys arrived under
 * the "every number on screen is fake" banner that the allowlist did not name,
 * against 20 it did. An allowlist makes the banner's claim true only for the
 * spellings someone remembered — every new column ships real and nothing goes
 * red. Inverted, the banner is true by construction and the only thing that
 * needs enumerating is what must STAY real, which is a short, stable list.
 *
 * These are the numbers the screen reads as structure rather than as business
 * data — a percent that must stay <=100, a year that must stay 2026, a page
 * size, a duration. Masking them renders visibly broken instead of plausibly
 * fake. PROTECTED_KEY (ids, timestamps, enums) applies first and still wins.
 */
const STRUCTURAL_NUMBER_KEY = /(^pct|_pct|percent|year|month|week|day|hour|minute|second|epoch|timestamp|index|page|limit|offset|size|width|height|lat|lon|zoom|duration|elapsed|_ms$|age$|order|sort|priority|level|step|threshold)/i;

/** Never touch these, whatever else matches — the app runs on them. */
// `is_`/`has_` are ANCHORED to a word boundary. Unanchored they matched inside
// any column containing the letters — `owed_this_cycle` was protected by the
// "is_" in "this", so a money column was silently exempt from masking. Found by
// the MP-531 test, not by reading the regex.
const PROTECTED_KEY = /(^id$|_id$|_at$|_date$|uuid|slug|key$|token|url|href|path|status|stage|role|type|kind|code$|(^|_)is_|(^|_)has_|enabled|active|passed|percent|order_index|version|sha|hash)/i;

// `^agent$` is here because landing_deal_highlights returns the producer's real
// first name under a bare `agent` key (DealsTicker renders it straight to the
// marquee) — `agent_name` alone did not reach it. Only STRING values are name-
// masked; an object under an `agent` key (CallLab metrics) recurses as before,
// and `agent_id` stays protected by PROTECTED_KEY.
// MP-531 added ^leg$/first_hop_name/agency_head_name/recruit_name: all four
// carried a real agent's full name on the authenticated admin surface
// (v_leg_production, apex_admin_operations_snapshot) and matched no rule.
// Deliberately NOT a blanket /_name$/ — agency_name and carrier_name hold
// "APEX Financial" and "Mutual of Omaha", and rewriting those to a person's
// name renders obviously broken rather than plausibly fake.
const NAME_KEY = /(first_name|last_name|full_name|display_name|agent_name|client_name|manager_name|producer_name|recruiter_name|^name$|^agent$|^leg$|first_hop_name|agency_head_name|recruit_name|title_holder)/i;

// Free text that SPEAKS a name and a dollar figure instead of carrying them in
// their own columns: "Aisha Kebbeh - $1,284 Deal Win". A key-based mask cannot
// see inside a sentence, which is why /dashboard/admin/sam rendered all three
// of its money values unmasked under the banner. Masked by substitution, never
// by replacement — replacing the whole string with a fake name would destroy
// the sentence the surface exists to show.
const PROSE_KEY = /(title|hook|headline|subtitle|message|body|summary|basis|detail|description|caption|blurb|note|reason)/i;
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

/**
 * Real name -> fake name for the payload currently being masked. Built in a
 * first pass so prose can be rewritten with the SAME fake identity the row's
 * own name column got: "Aisha Kebbeh - $1,284 Deal Win" and that row's
 * agent_name must not disagree, or the demo visibly contradicts itself.
 */
let activeNames: Map<string, string> = new Map();

/** Collect every real name a payload carries in a name column, plus its parts. */
function collectNames(node: unknown, into: Map<string, string>): void {
  if (node === null || node === undefined) return;
  if (Array.isArray(node)) { node.forEach((v) => collectNames(v, into)); return; }
  if (typeof node !== "object") return;
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if (v && typeof v === "object") { collectNames(v, into); continue; }
    if (typeof v !== "string" || !v.trim()) continue;
    if (PROTECTED_KEY.test(k) || !NAME_KEY.test(k)) continue;
    const real = v.trim();
    if (into.has(real)) continue;
    const fake = maskString(k, real);
    if (fake === real) continue;
    into.set(real, fake);
    // Map the parts too, so "Obiajulu just locked in" is covered by a row that
    // only ever spelled the full name. Two chars or fewer is not a name.
    const rp = real.split(/\s+/), fp = fake.split(/\s+/);
    if (rp.length === fp.length) {
      rp.forEach((tok, i) => { if (tok.length > 2 && !into.has(tok)) into.set(tok, fp[i]); });
    }
  }
}

function escapeRe(v: string): string { return v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

/**
 * Rewrite a sentence in place: every real name this payload knows becomes its
 * fake counterpart, and every $ figure becomes a masked one of the same
 * magnitude. Longest names first so "Obiajulu Ifediora" is consumed before the
 * bare "Obiajulu" can half-replace it.
 */
function maskProse(value: string): string {
  let out = value;
  for (const real of [...activeNames.keys()].sort((a, b) => b.length - a.length)) {
    out = out.replace(new RegExp(escapeRe(real), "g"), activeNames.get(real) as string);
  }
  out = out.replace(/\$\s?([\d,]+(?:\.\d+)?)/g, (whole, digits: string) => {
    const n = Number(String(digits).replace(/,/g, ""));
    if (!Number.isFinite(n) || n === 0) return whole;
    const masked = maskNumber(n, `prose:${digits}`);
    const grouped = String(digits).includes(",");
    return `$${grouped ? masked.toLocaleString("en-US") : masked}`;
  });
  return out;
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
  if (PROSE_KEY.test(key) && !NAME_KEY.test(key)) return maskProse(value);
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

  if (typeof value === "number" && !STRUCTURAL_NUMBER_KEY.test(key)) {
    return maskNumber(value, `${key}:${value}`);
  }

  if (typeof value === "string") {
    // Numeric-as-string (PostgREST returns numeric/bigint as strings).
    if (!STRUCTURAL_NUMBER_KEY.test(key) && /^-?\d+(\.\d+)?$/.test(value)) {
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

/**
 * maskPayload, but only when demo mode is on — for the handful of call sites
 * that fetch Supabase directly instead of through the client.
 *
 * demoFetch is installed as the supabase-js `global.fetch`, so anything that
 * deliberately skips the SDK (DealsTicker skips it to keep 170 kB off the
 * landing bundle) also skips the mask. Those sites call this by hand. Kept
 * beside maskPayload rather than in demoFetch so importing it does not drag
 * boundedFetch and the SDK back into a chunk that was built to avoid them.
 */
export function maskIfDemo(payload: unknown): unknown {
  return isDemoMode() ? maskPayload(payload) : payload;
}

export function maskPayload(payload: unknown): unknown {
  // Two passes: learn the payload's real identities, then mask. Prose needs the
  // map to exist before the row carrying it is rewritten, and nested calls must
  // not reset it mid-walk, so only the outermost call owns the map.
  const outermost = activeNames.size === 0;
  if (outermost) collectNames(payload, activeNames);
  try {
    if (Array.isArray(payload)) return payload.map((r) => maskOne(r));
    return maskOne(payload);
  } finally {
    if (outermost) activeNames = new Map();
  }
}

function maskOne(payload: unknown): unknown {
  if (Array.isArray(payload)) return payload.map((r) => maskOne(r));
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
