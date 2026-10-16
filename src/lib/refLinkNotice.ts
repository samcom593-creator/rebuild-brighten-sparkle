/**
 * refLinkOutcome: what the application page should do with a ?ref= recruiting
 * code after resolve-ref-slug answers.
 *
 * The audit (F01 acceptance, 2026-10-14) requires that an invalid code gets a
 * useful public message instead of silence: before this helper the page credited
 * a resolved agent and said nothing at all for an unknown code, a deactivated
 * agent, or a failed call, so the recruit applied unattributed without knowing.
 */
export type RefLinkOutcome =
  | { kind: "credited"; agentId: string; displayName: string | null }
  | { kind: "unknown"; message: string }
  | { kind: "deactivated"; message: string }
  | { kind: "unchecked"; message: string };

const STILL_APPLY = "You can still apply; choose who referred you below.";

export function refLinkOutcome(payload: unknown, invokeError: unknown): RefLinkOutcome {
  if (invokeError) {
    return { kind: "unchecked", message: `We could not check your recruiting link right now. ${STILL_APPLY}` };
  }
  const p = (payload && typeof payload === "object" ? payload : {}) as {
    resolved?: unknown;
    agent_id?: unknown;
    display_name?: unknown;
    reason?: unknown;
  };
  if (p.resolved === true && typeof p.agent_id === "string" && p.agent_id) {
    const name = typeof p.display_name === "string" && p.display_name.trim() ? p.display_name.trim() : null;
    return { kind: "credited", agentId: p.agent_id, displayName: name };
  }
  if (p.reason === "deactivated") {
    return { kind: "deactivated", message: `The agent on this recruiting link is no longer active. ${STILL_APPLY}` };
  }
  return { kind: "unknown", message: `This recruiting link is not recognized. ${STILL_APPLY}` };
}
