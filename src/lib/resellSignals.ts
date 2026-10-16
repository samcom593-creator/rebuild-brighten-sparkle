// Shared rules for reselling a sold or objection call (Sold Calls page). Kept out of the
// component file so React fast refresh keeps working.
export type WorkStatus = "contacted" | "resold" | "pushed" | "pushback";
export type ApprovalStatus = "approved" | "declined" | "pending" | "not_said";

export interface KeyMoment { t: string; label: string; quote: string }

/** The work + insight columns v_sold_calls_queue and v_objection_calls both carry. */
export interface ResellFields {
  work_status?: WorkStatus | null;
  work_note?: string | null;
  work_updated_at?: string | null;
  contacted_at?: string | null;
  resold_at?: string | null;
  pushed_at?: string | null;
  pushback_at?: string | null;
  mortgage_protection?: boolean | null;
  spouse_coverage?: boolean | null;
  price_objection?: boolean | null;
  bank_objection?: boolean | null;
  ssn_objection?: boolean | null;
  said_ssn?: boolean | null;
  said_bank?: boolean | null;
  approval_status?: ApprovalStatus | null;
  approval_quote?: string | null;
  declined_after_ssn_bank?: boolean | null;
  other_opportunities?: string[] | null;
  key_moments?: KeyMoment[] | null;
  insight_summary?: string | null;
  insight_verified?: boolean | null;
}

export const WORK_LABEL: Record<WorkStatus, string> = {
  contacted: "Contacted",
  resold: "Resold",
  pushed: "Pushed",
  pushback: "Pushback",
};

/** Any reason to call this person back with an offer. */
export function isResellLead(r: ResellFields): boolean {
  return Boolean(
    r.declined_after_ssn_bank || r.mortgage_protection || r.spouse_coverage || r.price_objection || r.bank_objection
      || (r.other_opportunities && r.other_opportunities.length > 0) || r.approval_status === "declined",
  );
}

export const phx = (iso: string | null | undefined, withYear = false) =>
  iso
    ? new Date(iso).toLocaleString("en-US", {
        timeZone: "America/Phoenix", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", ...(withYear ? { year: "numeric" } : {}),
      })
    : "";

/** "Mon, Oct 12, 2026 · 10:15 AM" in Phoenix time, for the corner of a call card. */
export function callStamp(iso: string | null | undefined): string {
  if (!iso) return "Date unknown";
  const d = new Date(iso);
  const day = d.toLocaleDateString("en-US", { timeZone: "America/Phoenix", weekday: "short", month: "short", day: "numeric", year: "numeric" });
  const time = d.toLocaleTimeString("en-US", { timeZone: "America/Phoenix", hour: "numeric", minute: "2-digit" });
  return `${day} · ${time}`;
}

