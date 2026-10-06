// AgentLink (agentlink.insuracloud.ai) base URL.
//
// Apex no longer uses AgentLink for deal entry. Agents post deals in Apex
// (Post a Deal), and production also arrives from the Discord deal feed and
// Ethos policies. AgentLink rows that remain in the book are historical
// imports. The old deep links and the "submit deals in AgentLink" tagline were
// removed (PL-APEX-OS-COHERENCE) so that copy cannot drift back into the UI.

export const AGENTLINK_BASE = "https://agentlink.insuracloud.ai";
