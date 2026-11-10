import { format } from "date-fns";

/** One row of public.v_licensed_hire_clock (WP5, 2026-11-10). */
export interface HireClockRow {
  agent_id: string;
  first_name: string;
  hired_at: string;
  days_since_hire: number;
  manager_first_name: string | null;
  owner_source: "contracting_owner" | "manager";
  has_npn: boolean;
  contract_profile_present: boolean;
  marks: Record<string, string>;
  marked_count: number;
  required_carriers: string[] | null;
  required_missing: string[] | null;
  contracting_state: "no_record" | "partial" | "required_complete" | "marked_required_unset";
  onboarding_call_booked_at: string | null;
  onboarding_call_held: boolean;
  dialer_first_dial_at: string | null;
  dials_14d: number;
  dials_total: number;
  has_open_seat: boolean;
  lead_grant_at: string | null;
  first_deal_at: string | null;
  production_truth_degraded: boolean;
  dark_origins: string[] | null;
  first_deal_state: "has_deal" | "unprovable" | "none";
  next_checkpoint: number | null;
  next_checkpoint_at: string | null;
  stalled: boolean;
  next_action: string;
}

const CARRIER_LABEL: Record<string, string> = {
  combine: "Combine", aflac: "AFLAC", gto: "GTO", ethos: "Ethos", chubb: "Chubb", ahl: "AHL",
};

/** The first-deal cell. Pure, so the "never say no deal while truth is dark" rule is pinned by a unit test. */
export function firstDealCell(row: Pick<HireClockRow, "first_deal_state" | "first_deal_at" | "dark_origins">): { text: string; tone: "good" | "warn" | "muted"; title: string } {
  if (row.first_deal_state === "has_deal" && row.first_deal_at) {
    return { text: format(new Date(row.first_deal_at), "MMM d"), tone: "good", title: "First deal on record (any source)" };
  }
  if (row.first_deal_state === "unprovable") {
    const origins = (row.dark_origins ?? []).join(", ") || "a production origin";
    return { text: "Unprovable", tone: "warn", title: `No deal on record, but ${origins} is dark, so a deal could exist that this page cannot see.` };
  }
  return { text: "No deal yet", tone: "muted", title: "Every production origin is live and none has a deal for this person." };
}

export function contractingText(row: Pick<HireClockRow, "contracting_state" | "marks" | "required_missing">): string {
  const marked = Object.keys(row.marks ?? {}).map((k) => CARRIER_LABEL[k] ?? k);
  if (row.contracting_state === "no_record") return "No contracting record";
  if (row.contracting_state === "required_complete") return `Contracted: ${marked.join(", ")}`;
  if (row.contracting_state === "partial") {
    return `Missing ${(row.required_missing ?? []).map((k) => CARRIER_LABEL[k] ?? k).join(", ")}`;
  }
  return `Marked: ${marked.join(", ")}`;
}

