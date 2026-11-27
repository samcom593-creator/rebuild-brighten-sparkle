/**
 * My Team > Bring back (MP-TEAM-BRING-BACK, 2026-11-27). Sam: "make sure all the agents are there and the ones
 * that I can bring back with contracts and all."
 *
 * The roster (crm_agent_roster) drops people flagged hidden, deactivated or excluded, so the people worth a
 * bring-back call were reachable from nowhere on My Team, and the Ethos call sheet hides the quiet ones under
 * its 30-day rule. crm_bring_back_candidates() (src/hooks/useBringBack.ts) returns everyone OFF the roster who
 * holds a contract, wrote business, is licensed, or holds Sam's Ethos contract with no account here. This
 * module is pure: the shape, the parser that refuses a garbled read, the groups, the order, the state filter
 * and the words. People Sam let go come back with fired = true and stay behind a toggle (2026-11-24: "if I
 * fired them, remove them"); they are never mixed in by default.
 */
import { parseStateCode, stateName, type TeamProfileCarrier } from "@/lib/teamProfile";
import { usdOrNull } from "@/lib/teamRoster";

export type BringBackStanding = "no_account" | "hidden" | "inactive" | "excluded" | "let_go";

export interface BringBackPerson {
  /** The agent id, or the Ethos person id when they have no agent record. */
  person_key: string;
  source: "agent" | "ethos_person";
  agent_id: string | null;
  full_name: string;
  phone: string | null;
  email: string | null;
  home_state: string | null;
  license: string | null;
  standing: BringBackStanding;
  fired: boolean;
  let_go_reason: string | null;
  /** True only for a person hidden with My Team's "Hide from roster"; restoring is the exact inverse. */
  can_restore: boolean;
  manager_name: string | null;
  ethos_back: boolean;
  ethos_source: string | null;
  ethos_since: string | null;
  ethos_issued: number;
  ethos_inforce: number;
  carriers: TeamProfileCarrier[];
  carriers_active: number;
  deals: number;
  lifetime_ap: number;
  last_deal: string | null;
  last_sign_in_at: string | null;
  instagram: string | null;
  last_call_outcome: string | null;
  last_call_at: string | null;
  /** The latest of their last deal, last sign-in and last logged call, YYYY-MM-DD; null when nothing is on file. */
  last_active_on: string | null;
  comp_level: string | null;
}

const STANDINGS: ReadonlySet<string> = new Set(["no_account", "hidden", "inactive", "excluded", "let_go"]);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const numOf = (v: unknown): number => { const n = Number(v ?? 0); return Number.isFinite(n) ? n : 0; };

/** The RPC rows, or a throw: a garbled read is "did not load", never an empty bring-back list. */
export function parseBringBack(data: unknown): BringBackPerson[] {
  if (!Array.isArray(data)) throw new Error("The bring-back list did not come back as a list.");
  return data.map((raw) => {
    if (!raw || typeof raw !== "object") throw new Error("A bring-back row was not an object.");
    const r = raw as Record<string, unknown>;
    const key = str(r.person_key);
    const standing = str(r.standing);
    if (!key || !standing || !STANDINGS.has(standing)) throw new Error("A bring-back row had no id or an unknown standing.");
    return {
      person_key: key,
      source: r.source === "ethos_person" ? "ethos_person" : "agent",
      agent_id: str(r.agent_id),
      full_name: str(r.full_name) ?? "Name not on file",
      phone: str(r.phone),
      email: str(r.email),
      home_state: str(r.home_state)?.toUpperCase() ?? null,
      license: str(r.license),
      standing: standing as BringBackStanding,
      fired: r.fired === true,
      let_go_reason: str(r.let_go_reason),
      can_restore: r.can_restore === true,
      manager_name: str(r.manager_name),
      ethos_back: r.ethos_back === true,
      ethos_source: str(r.ethos_source),
      ethos_since: str(r.ethos_since),
      ethos_issued: numOf(r.ethos_issued),
      ethos_inforce: numOf(r.ethos_inforce),
      carriers: Array.isArray(r.carriers) ? r.carriers.flatMap((c): TeamProfileCarrier[] => {
        if (!c || typeof c !== "object") return [];
        const x = c as Record<string, unknown>;
        const carrier = str(x.carrier);
        return carrier ? [{ carrier, status: str(x.status) ?? "unknown", source: str(x.source) ?? "unknown", as_of: str(x.as_of), active: x.active === true }] : [];
      }) : [],
      carriers_active: Math.max(0, Math.round(numOf(r.carriers_active))),
      deals: Math.max(0, Math.round(numOf(r.deals))),
      lifetime_ap: numOf(r.lifetime_ap),
      last_deal: str(r.last_deal),
      last_sign_in_at: str(r.last_sign_in_at),
      instagram: str(r.instagram),
      last_call_outcome: str(r.last_call_outcome),
      last_call_at: str(r.last_call_at),
      last_active_on: str(r.last_active_on),
      comp_level: str(r.comp_level),
    };
  });
}

// ── Groups ────────────────────────────────────────────────────────────────

export interface BringBackGroup {
  key: BringBackStanding;
  label: string;
  /** What the group means, in one sentence. */
  means: string;
}

/** The groups in the order to work them: contract holders with no account first, then the people hidden here. */
export const BRING_BACK_GROUPS: readonly BringBackGroup[] = [
  { key: "no_account", label: "Hold your Ethos contract, no account here", means: "On the latest Ethos hierarchy export under you, with no agent record in this app. They can write Ethos business today." },
  { key: "hidden", label: "Hidden from the roster", means: "Marked hidden with Hide from roster. Back on the roster puts them straight back on My Team." },
  { key: "inactive", label: "Marked inactive", means: "Their record says inactive. Back on the roster lists them under Not active, where their card can set them active again." },
  { key: "excluded", label: "Kept off the roster", means: "On the roster exclusion list, usually a duplicate or a seat that is not a person. Shown so nothing is hidden." },
  { key: "let_go", label: "Let go", means: "Deactivated, terminated, banned or suspended. Off by default; a toggle shows the ones who still hold a contract or wrote business." },
];

export function bringBackGroup(key: BringBackStanding): BringBackGroup {
  return BRING_BACK_GROUPS.find((g) => g.key === key)!;
}

// ── Filter and order ──────────────────────────────────────────────────────

export interface BringBackFilters {
  state: string | null;
  /** Show the people Sam let go (fired). Off by default. */
  includeLetGo: boolean;
  search: string;
}

export const NO_BRING_BACK_FILTERS: BringBackFilters = { state: null, includeLetGo: false, search: "" };

export function parseBringBackFilters(get: (key: string) => string | null): BringBackFilters {
  return { state: parseStateCode(get("state")), includeLetGo: get("letgo") === "1", search: get("q") ?? "" };
}

const fold = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function matchesBringBack(p: BringBackPerson, f: BringBackFilters): boolean {
  if (p.fired && !f.includeLetGo) return false;
  // "" is the people with no state on file, its own choice; null is no state filter at all.
  if (f.state !== null && (f.state === "" ? p.home_state !== null : p.home_state !== f.state)) return false;
  const q = fold(f.search.trim());
  if (q) {
    const text = fold([p.full_name, p.email, p.manager_name, p.instagram].filter(Boolean).join(" "));
    const digits = q.replace(/\D/g, "");
    if (!text.includes(q) && !(digits.length >= 3 && (p.phone ?? "").replace(/\D/g, "").includes(digits))) return false;
  }
  return true;
}

/** The states on file across the people shown (before the state filter), most people first. */
export function bringBackStateOptions(people: readonly BringBackPerson[], includeLetGo: boolean): Array<{ code: string; name: string; count: number; }> {
  const counts = new Map<string, number>();
  let unknown = 0;
  for (const p of people) {
    if (p.fired && !includeLetGo) continue;
    if (p.home_state) counts.set(p.home_state, (counts.get(p.home_state) ?? 0) + 1);
    else unknown += 1;
  }
  const out = [...counts.entries()].map(([code, count]) => ({ code, name: stateName(code), count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  return unknown > 0 ? [...out, { code: "", name: "No state on file", count: unknown }] : out;
}

/** Days from a YYYY-MM-DD to today's key; null when unknown. */
export function daysSinceKey(dateKey: string | null, todayKey: string): number | null {
  const parse = (k: string | null) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(k ?? ""); return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null; };
  const a = parse(dateKey);
  const b = parse(todayKey);
  if (a === null || b === null) return null;
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

/**
 * Worth-a-call score, higher first: Ethos in force, then Ethos back, then active carrier contracts, then
 * production; inside a tie the most recently active first, then the name.
 */
export function compareBringBack(todayKey: string): (a: BringBackPerson, b: BringBackPerson) => number {
  const score = (p: BringBackPerson) => (p.ethos_inforce > 0 ? 400 : 0) + (p.ethos_back ? 200 : 0) + Math.min(p.carriers_active, 9) * 10 + (p.deals > 0 ? 5 : 0) + (p.license === "licensed" ? 1 : 0);
  const recency = (p: BringBackPerson) => { const d = daysSinceKey(p.last_active_on, todayKey); return d === null ? Number.POSITIVE_INFINITY : d; };
  return (a, b) => score(b) - score(a) || recency(a) - recency(b) || a.full_name.localeCompare(b.full_name);
}

/** The people of one group, filtered and in order. */
export function bringBackRows(people: readonly BringBackPerson[], group: BringBackStanding, f: BringBackFilters, todayKey: string): BringBackPerson[] {
  return people.filter((p) => p.standing === group && matchesBringBack(p, f)).sort(compareBringBack(todayKey));
}

/** Every group's count under the filters, so a heading always equals the list under it. */
export function bringBackCounts(people: readonly BringBackPerson[], f: BringBackFilters): Record<BringBackStanding, number> {
  const out = { no_account: 0, hidden: 0, inactive: 0, excluded: 0, let_go: 0 } as Record<BringBackStanding, number>;
  for (const p of people) if (matchesBringBack(p, f)) out[p.standing] += 1;
  return out;
}

// ── Words ─────────────────────────────────────────────────────────────────

/** "Ethos back, $17.9K issued, $15.6K in force" / "Ethos back, nothing written yet" / null. */
export function ethosLine(p: BringBackPerson): string | null {
  if (!p.ethos_back) return null;
  const issued = usdOrNull(p.ethos_issued);
  const inforce = usdOrNull(p.ethos_inforce);
  if (!issued && !inforce) return "Ethos back, nothing written on it yet";
  return `Ethos back, ${issued ?? "$0"} issued, ${inforce ?? "$0"} in force`;
}

/** "Contracts: Ethos, Aflac +2" from the active carriers, Ethos first; null when none. */
export function carriersLine(p: BringBackPerson): string | null {
  const names = [...new Set(p.carriers.filter((c) => c.active).map((c) => c.carrier))].sort((a, b) => (a === "Ethos" ? -1 : b === "Ethos" ? 1 : a.localeCompare(b)));
  if (names.length === 0) return null;
  return `Contracts: ${names.length > 4 ? `${names.slice(0, 4).join(", ")} +${names.length - 4}` : names.join(", ")}`;
}

/** "Sold $22.7K here, last Jun 20" / "Never sold here" (agents only; Ethos-only people have no record here). */
export function soldLine(p: BringBackPerson, todayKey: string): string | null {
  if (p.source !== "agent") return null;
  if (p.deals === 0) return "Never sold here";
  const days = daysSinceKey(p.last_deal, todayKey);
  // timeago-allow: daysSinceKey floors the delta at 0, so a future-dated deal reads as today, never as a negative count.
  return `Sold ${usdOrNull(p.lifetime_ap) ?? "$0"} here${days === null ? "" : `, last deal ${days === 0 ? "today" : `${days} days ago`}`}`;
}

/** "Quiet 160 days" from the last deal, sign-in or logged call; "No activity on file" when nothing is. */
export function quietLine(p: BringBackPerson, todayKey: string): string {
  const days = daysSinceKey(p.last_active_on, todayKey);
  if (days === null) return "No activity on file";
  if (days === 0) return "Active today";
  return `Quiet ${days} ${days === 1 ? "day" : "days"}`;
}

export const STANDING_WORDS: Record<BringBackStanding, string> = {
  no_account: "No account here",
  hidden: "Hidden from roster",
  inactive: "Marked inactive",
  excluded: "Kept off roster",
  let_go: "Let go",
};

/** "Not interested (Nov 3)", from the Ethos call sheet log; null when never called from there. */
export function lastCallLine(p: BringBackPerson): string | null {
  if (!p.last_call_outcome) return null;
  const words: Record<string, string> = {
    no_answer: "No answer", voicemail: "Left voicemail", texted: "Texted", callback: "Call back later", coming_back: "Coming back",
    needs_help: "Wants in, needs help", not_interested: "Not interested", wrong_number: "Wrong number",
  };
  const when = p.last_call_at ? new Date(p.last_call_at).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "";
  return `Last call: ${words[p.last_call_outcome] ?? p.last_call_outcome}${when ? ` (${when})` : ""}`;
}
