// PL-LEAK-GATE-CENSUS (2026-10-27).
//
// requireSendAuth's floors answer "may this login call at all". They do not
// answer "may this login act about THIS agent". PL-LEAK-GATE put four senders
// (notify-comeback-alert, notify-rank-passed, notify-streak-alert,
// notify-course-started) on the any_authenticated floor while each still took
// an agent id off the request body and mailed about it: two of them bcc the
// whole live roster, one mails every agent the body id "passed", one mails the
// body agent's manager. Signup is open, so any self-registered account held a
// valid JWT for all four. The census in notify-caller-policy.test.ts caught it.
//
// This module is the one place the "whose agent is it" verdict lives:
//   - callerUid(): the auth uid behind a "user:<uuid>" caller, null for the
//     service key (which stays unbound: pg_net and function-to-function
//     callers act on rows they already own).
//   - resolveCallerScope(): the caller's OWN agents rows (plural on purpose:
//     MP-275 found eight auth ids mapped to two agents rows each, and a
//     .single() there would turn "two rows" into "no row") plus whether the
//     caller holds a staff role.
//   - bodyAgentAllowed(): pure, testable without a database. Staff may name
//     any agent (ProductionEntry lets a manager enter for a team member);
//     everyone else may only name themselves. A read error is reported as
//     null so the handler answers 503, never 200 and never a send.
import { STAFF_ROLES } from "./send-floor.ts";

export function callerUid(caller: string | undefined | null): string | null {
  if (!caller || !caller.startsWith("user:")) return null;
  const uid = caller.slice("user:".length).trim();
  return uid.length > 0 ? uid : null;
}

export function bodyAgentAllowed(
  bodyAgentId: unknown,
  ownAgentIds: readonly string[],
  isStaff: boolean,
): boolean {
  if (isStaff) return true;
  if (typeof bodyAgentId !== "string" || bodyAgentId.length === 0) return false;
  return ownAgentIds.includes(bodyAgentId);
}

export interface CallerScope {
  ownAgentIds: string[];
  isStaff: boolean;
}

// Structural so the module pulls in no supabase-js copy of its own (the
// MP-273 boot-death class: a second SDK copy in a bundle).
type SupabaseLike = { from: (table: string) => any };

export async function resolveCallerScope(sb: SupabaseLike, uid: string): Promise<CallerScope | null> {
  const [rolesRead, rowsRead] = await Promise.all([
    sb.from("user_roles").select("role").eq("user_id", uid),
    sb.from("agents").select("id").eq("user_id", uid),
  ]);
  if (rolesRead?.error || rowsRead?.error) return null;
  const roles = (rolesRead?.data ?? []) as Array<{ role: unknown }>;
  const rows = (rowsRead?.data ?? []) as Array<{ id: unknown }>;
  return {
    ownAgentIds: rows.map((r) => String(r.id)),
    isStaff: roles.some((r) => STAFF_ROLES.has(String(r.role))),
  };
}
