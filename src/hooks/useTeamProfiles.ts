import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ROSTER_PARTS, partRows } from "@/lib/productionMetrics";
import { ensureCompleteRead } from "@/lib/teamRoster";
import { parseTeamProfiles, type TeamProfiles } from "@/lib/teamProfile";

/**
 * The profile facts for everyone on My Team (MP-TEAM-PROFILE-FACTS, 2026-11-27): state, licensed states,
 * Instagram, login and last sign-in, Discord and Slack, the Ethos contract with its source, carrier contracts
 * and production by carrier. One read, crm_agent_profile_facts(), authorised exactly like the roster read, so
 * it describes the same people. Kept apart from the roster query so a failure here leaves the list standing
 * and says only that these facts did not load.
 */
export function useTeamProfiles(enabled: boolean) {
  return useQuery({
    queryKey: ["crm-agent-profile-facts"],
    enabled,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<TeamProfiles> => {
      const result = await supabase.rpc(ROSTER_PARTS.profile as never);
      const rows = partRows<unknown>(ROSTER_PARTS.profile, result);
      ensureCompleteRead("Profile facts", rows);
      return parseTeamProfiles(rows);
    },
  });
}
