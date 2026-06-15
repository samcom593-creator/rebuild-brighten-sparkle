/**
 * agentProfileDrawer — global zustand store for the AgentProfileDrawer overlay.
 *
 * 2026-06-15 — Sam directive (voice): "Even for example, if I search up an
 * agent, I should… I tap their name, I should push a pull up that I'm inside
 * the CRM."
 *
 * Any surface (sidebar search, Hierarchy legs, RecruitingTracker cards,
 * DashboardApplicants assigned-agent column, DashboardCRM rows) can call
 * `useAgentProfileDrawer.getState().openAgent(agentId)` to slide the deep
 * profile drawer over whatever page Sam is on. Close just zeroes the id —
 * no navigation, no reload (Sam's in-place close preference).
 */

import { create } from "zustand";

interface AgentProfileDrawerState {
  agentId: string | null;
  /** Open the drawer for a specific agent. Pass `null` to close. */
  openAgent: (agentId: string | null) => void;
  /** Close convenience. */
  close: () => void;
}

export const useAgentProfileDrawer = create<AgentProfileDrawerState>((set) => ({
  agentId: null,
  openAgent: (agentId) => set({ agentId }),
  close: () => set({ agentId: null }),
}));

/** Top-level helper for non-React imperative callers. */
export const openAgentProfile = (agentId: string) =>
  useAgentProfileDrawer.getState().openAgent(agentId);
