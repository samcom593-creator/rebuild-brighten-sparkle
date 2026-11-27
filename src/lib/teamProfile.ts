/**
 * My Team profile facts (MP-TEAM-PROFILE-FACTS, 2026-11-27). Sam, voice note: My Team "needs to be able to see
 * what contracts they have back ... if they have Ethos back already ... if there's an Instagram account ... any
 * production they've done in the past ... what carriers they have, what they sold, their last sign in, carrier
 * contracts active, a clear phone number ... and a filter to see which one of those guys I can filter by state."
 *
 * The facts come from crm_agent_profile_facts() (one read for the whole roster, authorised like the roster), read
 * by src/hooks/useTeamProfiles.ts. This module is pure: the shape, the parser that refuses a malformed read, and
 * the words each row and the person card print. Every fact names its source, because none of them lives in one
 * table: state is spelled "Az", "wi", "Texas" across four columns; Ethos comes from the Ethos hierarchy export,
 * the Ethos portal pull or a hand mark in the contracting review; carriers from AgentLink (retired 2026-10-17)
 * and the review. "No Ethos on file" means exactly that: nothing on file says so, not that they do not have it.
 */
import { usdOrNull } from "@/lib/teamRoster";

export type EthosSource = "ethos_hierarchy" | "ethos_portal" | "review_mark";

export interface TeamProfileCarrier {
  carrier: string;
  /** AgentLink's own status word (active, submitted, requested, ...), or "confirmed" for a hand mark. */
  status: string;
  source: "agentlink" | "review" | EthosSource | string;
  /** YYYY-MM-DD the contract was activated, confirmed or last seen; null when unknown. */
  as_of: string | null;
  active: boolean;
}

export interface TeamProfileSold {
  carrier: string;
  deals: number;
  alp: number;
  /** YYYY-MM-DD of their last posted sale with this carrier. */
  last_posted: string | null;
}

export interface TeamProfile {
  agent_id: string;
  /** Two-letter code, or null when no column holds a state for them. */
  home_state: string | null;
  home_state_source: string | null;
  license_states: string[];
  /** A bare handle (no @), or null. */
  instagram: string | null;
  instagram_source: string | null;
  has_login: boolean;
  last_sign_in_at: string | null;
  discord_joined: boolean;
  slack_joined: boolean;
  npn: string | null;
  ethos_back: boolean;
  ethos_source: EthosSource | null;
  /** The export, pull or mark date the Ethos fact was read from. */
  ethos_since: string | null;
  ethos_issued: number;
  ethos_inforce: number;
  ethos_chargeback: number;
  carriers: TeamProfileCarrier[];
  carriers_active: number;
  sold_carriers: TeamProfileSold[];
}

export type TeamProfiles = Record<string, TeamProfile>;

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const bool = (v: unknown): boolean => v === true;
const numOf = (v: unknown): number => { const n = Number(v ?? 0); return Number.isFinite(n) ? n : 0; };
const ETHOS_SOURCES: ReadonlySet<string> = new Set(["ethos_hierarchy", "ethos_portal", "review_mark"]);

/**
 * The RPC rows keyed by agent id. A read that is not a list, or a row without an agent id, throws: a failed or
 * garbled read is shown as "did not load", never as a roster where nobody has a state, a contract or a login.
 */
export function parseTeamProfiles(data: unknown): TeamProfiles {
  if (!Array.isArray(data)) throw new Error("Profile facts did not come back as a list.");
  const out: TeamProfiles = {};
  for (const raw of data) {
    if (!raw || typeof raw !== "object") throw new Error("A profile facts row was not an object.");
    const r = raw as Record<string, unknown>;
    const agentId = str(r.agent_id);
    if (!agentId) throw new Error("A profile facts row had no agent id.");
    const source = str(r.ethos_source);
    out[agentId] = {
      agent_id: agentId,
      home_state: str(r.home_state)?.toUpperCase() ?? null,
      home_state_source: str(r.home_state_source),
      license_states: Array.isArray(r.license_states) ? r.license_states.filter((s): s is string => typeof s === "string").map((s) => s.toUpperCase()) : [],
      instagram: str(r.instagram),
      instagram_source: str(r.instagram_source),
      has_login: bool(r.has_login),
      last_sign_in_at: str(r.last_sign_in_at),
      discord_joined: bool(r.discord_joined),
      slack_joined: bool(r.slack_joined),
      npn: str(r.npn),
      ethos_back: bool(r.ethos_back),
      ethos_source: source && ETHOS_SOURCES.has(source) ? (source as EthosSource) : null,
      ethos_since: str(r.ethos_since),
      ethos_issued: numOf(r.ethos_issued),
      ethos_inforce: numOf(r.ethos_inforce),
      ethos_chargeback: numOf(r.ethos_chargeback),
      carriers: Array.isArray(r.carriers) ? r.carriers.flatMap((c): TeamProfileCarrier[] => {
        if (!c || typeof c !== "object") return [];
        const x = c as Record<string, unknown>;
        const carrier = str(x.carrier);
        return carrier ? [{ carrier, status: str(x.status) ?? "unknown", source: str(x.source) ?? "unknown", as_of: str(x.as_of), active: bool(x.active) }] : [];
      }) : [],
      carriers_active: Math.max(0, Math.round(numOf(r.carriers_active))),
      sold_carriers: Array.isArray(r.sold_carriers) ? r.sold_carriers.flatMap((c): TeamProfileSold[] => {
        if (!c || typeof c !== "object") return [];
        const x = c as Record<string, unknown>;
        const carrier = str(x.carrier);
        return carrier ? [{ carrier, deals: Math.max(0, Math.round(numOf(x.deals))), alp: numOf(x.alp), last_posted: str(x.last_posted) }] : [];
      }) : [],
    };
  }
  return out;
}

// ── Words ─────────────────────────────────────────────────────────────────

/** Where the Ethos fact was read from, for the card: "on the Ethos hierarchy export of Nov 19". */
export const ETHOS_SOURCE_WORDS: Record<EthosSource, string> = {
  ethos_hierarchy: "on the Ethos hierarchy export",
  ethos_portal: "on the Ethos portal",
  review_mark: "marked received in the contracting review",
};

/** "Nov 19" or "Nov 19, 2025" for a YYYY-MM-DD; "" when unreadable. */
export function shortDay(dateKey: string | null | undefined, todayKey?: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateKey ?? "");
  if (!m) return "";
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12));
  const sameYear = todayKey ? todayKey.slice(0, 4) === m[1] : new Date().getUTCFullYear() === Number(m[1]);
  return d.toLocaleDateString("en-US", sameYear ? { month: "short", day: "numeric", timeZone: "UTC" } : { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export interface ProfileWord { text: string; tone: "good" | "warn" | null }

/**
 * The Ethos contract on one row. Back is the fact Sam asked for first. A licensed person with nothing on file is
 * the amber one; someone still getting licensed cannot have it yet, so their row says nothing. null while the
 * facts have not loaded.
 */
export function ethosWords(profile: TeamProfile | null | undefined, licenseStatus: string | null | undefined): ProfileWord | null {
  if (!profile) return null;
  if (profile.ethos_back) return { text: "Ethos back", tone: "good" };
  if (licenseStatus === "licensed") return { text: "No Ethos on file", tone: "warn" };
  return null;
}

/** The names of the active carrier contracts, A to Z, Ethos first because it is the one Sam reads for. */
export function activeCarrierNames(profile: TeamProfile | null | undefined): string[] {
  if (!profile) return [];
  const names = [...new Set(profile.carriers.filter((c) => c.active).map((c) => c.carrier))];
  return names.sort((a, b) => (a === "Ethos" ? -1 : b === "Ethos" ? 1 : a.localeCompare(b)));
}

/**
 * "Contracts: Ethos, Aflac, Combined" (up to four names, then "+N"); "Contracts pending: Aflac" when none is active
 * yet; "No carrier contracts on file" for a licensed person with nothing; null otherwise.
 */
export function carriersWords(profile: TeamProfile | null | undefined, licenseStatus: string | null | undefined): string | null {
  if (!profile) return null;
  const active = activeCarrierNames(profile);
  const list = (names: string[]) => (names.length > 4 ? `${names.slice(0, 4).join(", ")} +${names.length - 4}` : names.join(", "));
  if (active.length > 0) return `Contracts: ${list(active)}`;
  const pending = [...new Set(profile.carriers.map((c) => c.carrier))].sort();
  if (pending.length > 0) return `Contracts pending: ${list(pending)}`;
  return licenseStatus === "licensed" ? "No carrier contracts on file" : null;
}

/** "Sold $9.5K lifetime, mostly American Home Life"; null when nothing has been sold. */
export function soldWords(profile: TeamProfile | null | undefined, lifetimeAlp: number | string | null | undefined): string | null {
  if (!profile || profile.sold_carriers.length === 0) return null;
  const top = profile.sold_carriers[0];
  const alp = usdOrNull(lifetimeAlp) ?? usdOrNull(profile.sold_carriers.reduce((s, c) => s + c.alp, 0));
  const deals = profile.sold_carriers.reduce((s, c) => s + c.deals, 0);
  const head = alp ? `Sold ${alp} lifetime` : `Sold ${deals} ${deals === 1 ? "deal" : "deals"}`;
  return profile.sold_carriers.length > 1 ? `${head}, mostly ${top.carrier}` : `${head} with ${top.carrier}`;
}

/** Whole days between an ISO instant and now, floored at 0 (a clock ahead of the server never reads negative). */
function daysSinceInstant(iso: string, nowMs: number): number | null {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return Math.floor(Math.max(0, nowMs - t) / 86_400_000);
}

/** "Signed in today", "Signed in 3 days ago", "Never signed in", "No login"; null while the facts have not loaded. */
export function signInWords(profile: TeamProfile | null | undefined, nowMs: number = Date.now()): ProfileWord | null {
  if (!profile) return null;
  if (!profile.has_login) return { text: "No login", tone: "warn" };
  if (!profile.last_sign_in_at) return { text: "Never signed in", tone: "warn" };
  const days = daysSinceInstant(profile.last_sign_in_at, nowMs);
  if (days === null) return { text: "Last sign-in unknown", tone: null };
  if (days === 0) return { text: "Signed in today", tone: null };
  if (days === 1) return { text: "Signed in yesterday", tone: null };
  // timeago-allow: the delta above is floored at 0 in daysSinceInstant, so this can never read as a negative count.
  return { text: `Signed in ${days} days ago`, tone: days >= 14 ? "warn" : null };
}

/** The public Instagram page for a handle; null when none is on file. */
export function instagramUrl(handle: string | null | undefined): string | null {
  const h = (handle ?? "").replace(/^@+/, "").trim();
  return /^[A-Za-z0-9._]{1,30}$/.test(h) ? `https://www.instagram.com/${h}/` : null;
}

// ── States ────────────────────────────────────────────────────────────────

export const US_STATE_NAMES: Readonly<Record<string, string>> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware",
  DC: "Washington DC", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas",
  KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi",
  MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York",
  NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island",
  SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington",
  WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming", PR: "Puerto Rico",
};

/** A two-letter code from a URL or typed value, or null when it is not a US state. */
export function parseStateCode(value: string | null | undefined): string | null {
  const code = (value ?? "").trim().toUpperCase();
  return code in US_STATE_NAMES ? code : null;
}

/** "Wisconsin" for WI; the code itself when unknown. */
export function stateName(code: string): string {
  return US_STATE_NAMES[code.toUpperCase()] ?? code;
}

/** "WI" alone, or "WI, licensed in IL and MI" for the card; null when nothing is on file. */
export function stateWords(profile: TeamProfile | null | undefined): string | null {
  if (!profile) return null;
  const home = profile.home_state;
  const others = profile.license_states.filter((s) => s !== home);
  if (!home && others.length === 0) return null;
  if (!home) return `Licensed in ${others.join(", ")}`;
  if (others.length === 0) return home;
  return `${home}, licensed in ${others.join(", ")}`;
}
