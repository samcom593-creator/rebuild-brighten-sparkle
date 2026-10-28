// schedule-auto-populate: who owns a schedule item.
//
// A draft check rolls up to the policy's agent's manager; a post-test follow-up to
// the applicant's hiring manager, else the assigned agent's chain. Pure (maps in,
// owner out) so manager-resolve.test.ts can prove the rule offline.
//
// A departed agent (terminated or deactivated) never receives calendar traffic or
// the summary email: invited_by_manager_id / manager_id are kept for attribution
// after departure (AGENTS.md, 2026-08-17), so the check happens here, when the
// owner is picked. hiring_manager_user_id is an auth user id, so index.ts resolves
// the departed-or-banned set for it once per run and passes it in.

import { isDepartedAgent } from "../_shared/departed.ts";

export type AgentRow = {
  id: string;
  user_id: string | null;
  invited_by_manager_id: string | null;
  manager_id: string | null;
  display_name: string | null;
  agent_code: string | null;
  is_deactivated?: boolean | null;
  status?: string | null;
};

export type ProfileRow = {
  user_id: string;
  email: string | null;
  full_name: string | null;
};

export type Manager = {
  userId: string | null;
  email: string | null;
  name: string;
};

export type ApplicationOwnerRow = {
  hiring_manager_user_id?: string | null;
  assigned_agent_id?: string | null;
  recruiter_id?: string | null;
};

export function managerForAgent(
  agentId: string | null | undefined,
  agents: Map<string, AgentRow>,
  profiles: Map<string, ProfileRow>,
  fallback: Manager,
): Manager {
  if (!agentId) return fallback;
  const agent = agents.get(agentId);
  if (!agent) return fallback;

  // The inviting manager, then the operational manager, then the agent itself: the
  // first one still with the company who has a login owns the item.
  const live = [agent.invited_by_manager_id, agent.manager_id, agent.id]
    .map((id) => (id ? agents.get(id) : undefined))
    .filter((row): row is AgentRow => !!row && !isDepartedAgent(row));
  const owner = live.find((row) => !!row.user_id) ?? null;
  const userId = owner?.user_id ?? fallback.userId;
  if (!userId) return fallback;

  const managerAgent = owner && owner.id !== agent.id ? owner : null;
  const profile = profiles.get(userId);
  return {
    userId,
    email: profile?.email ?? fallback.email,
    name: profile?.full_name ?? managerAgent?.display_name ?? agent.display_name ?? fallback.name,
  };
}

export function managerForApplication(
  app: ApplicationOwnerRow,
  agents: Map<string, AgentRow>,
  profiles: Map<string, ProfileRow>,
  fallback: Manager,
  departedUserIds: Set<string> = new Set(),
): Manager {
  if (app.hiring_manager_user_id && !departedUserIds.has(app.hiring_manager_user_id)) {
    const profile = profiles.get(app.hiring_manager_user_id);
    return {
      userId: app.hiring_manager_user_id,
      email: profile?.email ?? fallback.email,
      name: profile?.full_name ?? fallback.name,
    };
  }
  return managerForAgent(app.assigned_agent_id ?? app.recruiter_id, agents, profiles, fallback);
}
