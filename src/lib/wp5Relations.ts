/**
 * WP5 (2026-11-10): relations created live by migrations 20261111100400 / 100410 / 100420 that are not yet in the
 * generated src/integrations/supabase/types.ts.
 *
 * The onboarding-audit work packages must not regenerate types.ts (a partial regen has deleted live functions before);
 * the integrator regenerates it once, serially, at merge. Until then the call sites read these names from here and
 * type their rows locally. check:supabase-relation-types reports them as "unprovable" (non-voting) rather than as
 * missing. INTEGRATOR: after the types.ts regen, inline these literals back into their call sites so the guard grades
 * them again.
 */
export const WP5_RELATION = {
  hireClock: "v_licensed_hire_clock",
  licensedUnresolved: "v_licensed_unresolved",
  dialerState: "v_agent_dialer_state",
  activationState: "v_agent_activation_state",
} as const;
