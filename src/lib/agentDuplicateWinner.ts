/**
 * Which row of a duplicate-agent group /admin/agent-duplicates proposes to keep.
 *
 * Merging sets canonical_agent_id on the loser. The person's login stays on
 * whichever row holds agents.user_id, and useScriptsUnlocked, interviews-pipeline
 * and add-agent all look the login up with `canonical_agent_id IS NULL`. Merge
 * the login row away and those lookups find nothing, and the canonical-mapped
 * production views (v_agent_weekly_production) roll his book up to a row he
 * cannot sign in as. Production follows the merge in either direction, so it
 * cannot pick the winner on its own.
 *
 * Order: a row someone can log in as, then most lifetime ALP, then oldest.
 * Before PL-WIB-DUP-CANDIDATES-CANONICAL it was ALP alone; on Tyler Krejcha's
 * $0 = $0 tie (the view read raw `deals`) that proposed the ghost row with no
 * login. has_login undefined (view not yet deployed) falls back to ALP.
 */
export type DuplicateMember = {
  agent_id: string;
  lifetime_alp: number | string;
  created_at: string;
  has_login?: boolean | null;
};

const loginRank = (m: DuplicateMember) => (m.has_login === true ? 0 : 1);

export function rankDuplicateMembers<T extends DuplicateMember>(members: readonly T[]): T[] {
  return [...members].sort(
    (a, b) =>
      loginRank(a) - loginRank(b) ||
      Number(b.lifetime_alp) - Number(a.lifetime_alp) ||
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime() ||
      a.agent_id.localeCompare(b.agent_id),
  );
}

/** Why the first row of a ranked group won, for the badge Sam reads. */
export function proposedReason(ranked: readonly DuplicateMember[]): "login" | "production" {
  const [first, ...rest] = ranked;
  if (!first) return "production";
  const outranksOnAlp = rest.some((m) => Number(m.lifetime_alp) > Number(first.lifetime_alp));
  return first.has_login === true && outranksOnAlp ? "login" : "production";
}
