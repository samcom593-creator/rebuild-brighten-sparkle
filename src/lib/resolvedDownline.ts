/**
 * A manager's team, read from the same agents row the shared identity
 * resolver chose (F10 / F17 in the 2026-10-14 Galaxy OS map, 2026-10-15).
 *
 * The old path, useMyDownline, called my_downline_agent_ids(), which picks
 * `agents WHERE user_id = auth.uid() LIMIT 1` with no ORDER BY and ignores
 * merge pointers: a different identity rule from useAgentIdentity. It also
 * logged a failed call and returned [], so Team Production listed only the
 * manager's own deals, or "No deals logged yet", whenever the team list could
 * not be read.
 *
 * Here the root is the row useAgentIdentity resolved, passed to
 * get_downline_agent_ids(p_root_agent_id), which returns the root plus every
 * descendant through invited_by_manager_id. Only when the resolver itself
 * failed does the read fall back to the server's own lookup, and a failure of
 * either read is an error, never an empty team.
 */
import type { AgentIdentity } from "@/lib/agentIdentity";

export type DownlineSource =
  /** The shared resolver found this login's row: read the team under it. */
  | { kind: "root"; agentId: string }
  /** The resolver failed: the server looks the login up by itself. */
  | { kind: "server" }
  /** Still loading, no agent row, or more than one: there is no root to read from. */
  | { kind: "none" };

export function downlineSourceFor(identity: AgentIdentity | undefined): DownlineSource {
  if (!identity) return { kind: "none" };
  if (identity.status === "resolved") return { kind: "root", agentId: identity.agentId };
  if (identity.status === "error") return { kind: "server" };
  // An ambiguous login is quarantined, not resolved by whichever row the
  // server happens to return first.
  return { kind: "none" };
}

/**
 * The agent ids from either downline RPC ({ agent_id }[]), deduplicated in
 * order. Anything that is not that shape throws, so a contract change shows
 * as an error instead of a smaller team.
 */
export function parseDownlineIds(data: unknown): string[] {
  if (!Array.isArray(data)) throw new Error("The team list returned no result set.");
  const ids = new Set<string>();
  for (const row of data) {
    const id = row && typeof row === "object" ? (row as { agent_id?: unknown }).agent_id : undefined;
    if (typeof id !== "string" || id.length === 0) throw new Error("The team list returned a row without an agent id.");
    ids.add(id);
  }
  return [...ids];
}
