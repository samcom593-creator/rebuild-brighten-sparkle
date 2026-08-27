/**
 * Sam's v18 name rule, as one seam.
 *
 * An agent's human name has never lived in one column. It is resolved in order:
 *   1. the profile reached through `agents.profile_id` (imported agents),
 *   2. the profile reached through `agents.user_id`,
 *   3. `agents.display_name`,
 *   4. an em-dash.
 *
 * Until 2026-08-27 most surfaces implemented only step 1, as a PostgREST embed
 * (`profile:profiles(full_name)`). That worked only because `public.profiles`
 * was readable by every logged-in account — 613 rows of email and phone. When
 * MP-325 closed that (a plain agent now reads their OWN profile and their
 * manager's, 613 -> 2), every one of those embeds silently returned null for
 * everybody else, and each surface rendered whatever its fallback happened to
 * be. Two of them rendered the literal string "Agent"; measured as a real
 * non-staff agent, 56 of 57 active agents on the agent portal were "Agent".
 *
 * Step 2 is what makes this safe to fix without re-opening the leak:
 * `get_leaderboard_profiles()` is SECURITY DEFINER and granted to
 * `authenticated`, so it returns display identity (user_id, full_name,
 * avatar_url) for everyone WITHOUT exposing the email/phone columns that
 * MP-325 closed. It is the same source BuildingLeaderboard already used, which
 * is why that surface kept its names through the lockdown.
 *
 * Coverage measured on live prod as a plain agent: 46 of 57 active agents
 * resolve via step 2, the remaining 11 (null user_id) via step 3, and
 * `display_name` is non-null on all 190 agent rows — so this chain yields a
 * real name for every agent and step 4 is unreachable in today's data. It is
 * kept because "unreachable today" is not "unreachable", and an em-dash is an
 * honest blank where "Agent" is a placeholder that reads as a real name.
 *
 * Callers should select `id, user_id, display_name` and stop embedding
 * `profiles` for names. `scripts/check-agent-name-fallback.mjs` holds the line.
 */
import { supabase } from "@/integrations/supabase/client";

/** Honest blank. Never a word that could be mistaken for somebody's name. */
export const AGENT_NAME_FALLBACK = "—";

export type AgentNameSource = {
  id: string;
  user_id?: string | null;
  display_name?: string | null;
  /** Optional: only still present on admin surfaces that legitimately embed profiles. */
  profile?: { full_name?: string | null; avatar_url?: string | null } | null;
};

export type ResolvedAgentName = {
  name: string;
  avatarUrl: string | null;
};

/**
 * Resolve display identity for a set of agent rows.
 *
 * Makes at most ONE extra round trip (the RPC), and none at all when no row
 * carries a `user_id`. Never throws: an RPC failure degrades to
 * `display_name`, because a leaderboard with real names and no avatars beats a
 * leaderboard that crashed.
 */
export async function resolveAgentNames(
  agents: AgentNameSource[],
): Promise<Map<string, ResolvedAgentName>> {
  const resolved = new Map<string, ResolvedAgentName>();
  if (!agents.length) return resolved;

  const userIds = new Set(
    agents.map((a) => a.user_id).filter((id): id is string => Boolean(id)),
  );

  let byUserId = new Map<string, { full_name?: string | null; avatar_url?: string | null }>();
  if (userIds.size) {
    const { data, error } = await supabase.rpc("get_leaderboard_profiles");
    if (error) {
      // Deliberately not rethrown — see doc comment. Surfaces fall through to
      // display_name, which is populated on every agent row.
      console.warn("[agentDisplayNames] get_leaderboard_profiles failed:", error.message);
    }
    byUserId = new Map(
      ((data ?? []) as Array<{ user_id: string; full_name: string | null; avatar_url: string | null }>)
        .filter((p) => p.user_id && userIds.has(p.user_id))
        .map((p) => [p.user_id, p]),
    );
  }

  for (const agent of agents) {
    const viaProfileId = agent.profile ?? null;
    const viaUserId = agent.user_id ? byUserId.get(agent.user_id) ?? null : null;
    resolved.set(agent.id, {
      name:
        viaProfileId?.full_name ||
        viaUserId?.full_name ||
        agent.display_name ||
        AGENT_NAME_FALLBACK,
      avatarUrl: viaProfileId?.avatar_url || viaUserId?.avatar_url || null,
    });
  }

  return resolved;
}
