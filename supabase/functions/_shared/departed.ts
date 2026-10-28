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
