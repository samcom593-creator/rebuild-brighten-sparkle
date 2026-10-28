// Who may still be reached by automation.
//
// A departed agent (status terminated, or deactivated) or a banned login must never
// receive routing, alerts, calendar traffic, queues or messages (AGENTS.md: KJ Vaughn
// departed 2026-08-17; auth 75b17131-… banned, agent 431dff0d-… terminated). The
// departure migration (20260817153000) kept historical attribution on purpose, so a
// column such as agents.invited_by_manager_id can still point at a departed person and
// every sender that follows such a pointer has to check at send time. These predicates
// are the one rule they share; the test beside this file proves them against the row
// shapes the senders read.
//
// `isDepartedAgent` uses the same definition as preferLiveAgent's "dead" rank in
// resolve-one.ts so two callers reading the same row agree.

export interface DepartedAgentRow {
  is_deactivated?: boolean | null;
  status?: string | null;
}

/** Columns a caller must select for isDepartedAgent to see what it needs. */
export const DEPARTED_AGENT_COLUMNS = "user_id, is_deactivated, status";

export function isDepartedAgent(row: DepartedAgentRow | null | undefined): boolean {
  if (!row) return true;
  return row.is_deactivated === true || row.status === "terminated";
}

export interface UplineRow extends DepartedAgentRow {
  id: string;
  manager_id?: string | null;
  canonical_agent_id?: string | null;
}

export type UplineLookup = (id: string) => Promise<UplineRow | null>;

/** Columns walkToLiveUpline needs on each row it is handed. */
export const UPLINE_COLUMNS = "id, manager_id, canonical_agent_id, is_deactivated, status";

/**
 * The first agent still with the company at or above `startId`: the row itself when it
 * is live, else its canonical row (when the upline is a duplicate) or its manager, at
 * most `maxHops` up. This is resolve-ref-slug's rule for a terminated manager's /r/ link
 * (PL-TERMINATION-RECODE, 2026-10-25), shared so every entry point that attaches a new
 * agent to a manager behaves the same way. Null when nobody live is found: callers must
 * then refuse, never attach the recruit to the departed row or to a silent default.
 */
export async function walkToLiveUpline(
  startId: string,
  lookup: UplineLookup,
  maxHops = 4,
): Promise<{ agent: UplineRow; redirected: boolean } | null> {
  let row = await lookup(startId);
  let hops = 0;
  let redirected = false;
  while (row && isDepartedAgent(row) && hops < maxHops) {
    const upId = row.canonical_agent_id ?? row.manager_id ?? null;
    if (!upId || upId === row.id) return null;
    row = await lookup(upId);
    redirected = true;
    hops++;
  }
  if (!row || isDepartedAgent(row)) return null;
  return { agent: row, redirected };
}

export interface BannableUser {
  banned_until?: string | null;
}

/** True while GoTrue's banned_until lies in the future (a ban "until 2099" counts). */
export function isBannedUser(user: BannableUser | null | undefined, now: Date = new Date()): boolean {
  if (!user) return true;
  const until = user.banned_until;
  if (!until) return false;
  const t = Date.parse(until);
  if (Number.isNaN(t)) return true; // unreadable ban date: treat as banned, never as clear
  return t > now.getTime();
}
