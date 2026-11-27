import type { TeamProfile } from "@/lib/teamProfile";

/** Synthetic profile facts only (crm_agent_profile_facts shape). Nothing here is a real person. */
export const teamProfile = (o: Partial<TeamProfile> = {}): TeamProfile => ({
  agent_id: "a1", home_state: null, home_state_source: null, license_states: [], instagram: null, instagram_source: null,
  has_login: true, last_sign_in_at: "2026-10-30T15:00:00Z", discord_joined: false, slack_joined: false, npn: null,
  ethos_back: false, ethos_source: null, ethos_since: null, ethos_issued: 0, ethos_inforce: 0, ethos_chargeback: 0,
  carriers: [], carriers_active: 0, sold_carriers: [], ethos_requested: false, ethos_requested_on: null, ethos_partner_id: null, ...o,
});
