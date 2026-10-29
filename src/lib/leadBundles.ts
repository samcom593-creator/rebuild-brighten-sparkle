// Lead bundles (MP-310 wave 3, 2026-10-29): the words the Lead Bundles admin page and My Leads share.
//
// Sam: "assign a certain amount of leads at different bundles, formats and packages, from the quality of the leads, to
// agents or managers on the team ... dispatch them as called leads or POSs ... revoke access, give access." Tiers come
// from v_readymode_lead_quality; every write goes through the lead_bundle_* RPCs (Sam and Aisha only, except a holder
// recording what happened with one of their own leads).

export type LeadStatus = "new" | "no_answer" | "callback" | "appointment" | "sold" | "not_interested" | "bad_number" | "do_not_call";

export const LEAD_STATUS_BUTTONS: ReadonlyArray<{ key: Exclude<LeadStatus, "new">; label: string }> = [
  { key: "no_answer", label: "No answer" },
  { key: "callback", label: "Callback" },
  { key: "appointment", label: "Appointment" },
  { key: "sold", label: "Sold" },
  { key: "not_interested", label: "Not interested" },
  { key: "bad_number", label: "Bad number" },
  { key: "do_not_call", label: "Do not call" },
];

/** Statuses that still need a call. */
const OPEN: ReadonlySet<string> = new Set(["new", "no_answer", "callback", "appointment"]);
export const isOpenLead = (status: string | null | undefined) => OPEN.has(status ?? "new");

export function leadStatusLabel(status: string | null | undefined): string {
  if (!status || status === "new") return "Not called yet";
  return LEAD_STATUS_BUTTONS.find((b) => b.key === status)?.label ?? status.replace(/_/g, " ");
}

export const CALLED_LEAD_TIERS: ReadonlyArray<{ key: "A" | "B" | "C" | "D"; label: string }> = [
  { key: "A", label: "A: warm, booked or stopped at bank or SSN" },
  { key: "B", label: "B: talked to an agent, never bought" },
  { key: "C", label: "C: never reached, 3 dials or fewer" },
  { key: "D", label: "D: never reached, 4 dials or more" },
];

export function tierLabel(tier: string | null | undefined): string {
  if (tier === "pos") return "Policy owner";
  if (tier === "blocked") return "Do not call";
  return tier ? `Tier ${tier}` : "";
}

export const formatLabel = (format: string | null | undefined) => (format === "pos" ? "POS" : "Called leads");

/** A lead marked do not call never gets a Call link, here or anywhere. */
export const canDial = (status: string | null | undefined) => status !== "do_not_call";
