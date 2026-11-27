import { isOpenLead } from "@/lib/leadBundles";

export interface LeadResponseRow {
  status: string;
  granted_at?: string | null;
  status_at?: string | null;
  attrs?: Record<string, unknown> | null;
}
export type LeadResponseKind = "overdue" | "followup_unplanned" | "first_outcome" | "retry" | "scheduled" | "closed";
export interface LeadResponsePriority {
  kind: LeadResponseKind;
  rank: number;
  sortAt: number | null;
  dueAt: string | null;
  assignedAt: string | null;
  label: string;
  nextAction: string;
}

const instant = (value: unknown): number | null => {
  if (typeof value !== "string" || !value.trim()) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
};

/** Prioritize real agreed dates and assignment age; no inferred response deadline. */
export function leadResponsePriority(lead: LeadResponseRow, now = Date.now()): LeadResponsePriority {
  const assigned = instant(lead.granted_at);
  const assignedAt = assigned !== null && assigned <= now ? lead.granted_at! : null;
  const callback = instant(lead.attrs?.callback_at);
  const dueAt = callback !== null ? String(lead.attrs?.callback_at) : null;
  const action = typeof lead.attrs?.next_action === "string" ? lead.attrs.next_action.trim() : "";
  const base = { assignedAt, dueAt };
  if (!isOpenLead(lead.status)) return { ...base, kind: "closed", rank: 5, sortAt: null, label: "Outcome recorded", nextAction: action };
  if (callback !== null) return callback <= now
    ? { ...base, kind: "overdue", rank: 0, sortAt: callback, label: callback < now ? "Follow-up overdue" : "Follow-up due", nextAction: action || "Follow up and record the actual outcome." }
    : { ...base, kind: "scheduled", rank: 4, sortAt: callback, label: "Follow-up scheduled", nextAction: action || "Follow the agreed callback time." };
  const touched = instant(lead.status_at);
  if (lead.status === "callback" || lead.status === "appointment" || !!lead.attrs?.callback_at) return {
    ...base, kind: "followup_unplanned", rank: 1, sortAt: touched !== null && touched <= now ? touched : null,
    label: lead.attrs?.callback_at ? "Follow-up time unavailable" : "Follow-up time missing",
    nextAction: action || "Review the callback plan and save the agreed time.",
  };
  if (lead.status === "new") return { ...base, kind: "first_outcome", rank: 2, sortAt: assignedAt ? assigned : null,
    label: "No outcome recorded", nextAction: action || "Call, then record what actually happened." };
  return { ...base, kind: "retry", rank: 3, sortAt: touched !== null && touched <= now ? touched : null,
    label: "Retry needed", nextAction: action || "Retry contact and record the outcome." };
}

export function compareLeadResponse(a: LeadResponseRow, b: LeadResponseRow, now = Date.now()): number {
  const first = leadResponsePriority(a, now), second = leadResponsePriority(b, now);
  if (first.rank !== second.rank) return first.rank - second.rank;
  // Missing dates keep their unknown state and stable server order after dated rows.
  if (first.sortAt === null) return second.sortAt === null ? 0 : 1;
  if (second.sortAt === null) return -1;
  return first.sortAt - second.sortAt;
}
