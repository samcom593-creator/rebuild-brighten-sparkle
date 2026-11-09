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

// One tier/flag vocabulary for BOTH sides of a drop (MP-LEAD-MANAGER-11,
// 2026-11-09). Lead Manager (Sam's pack preview) and My Leads (the agent
// working the pack) must describe a lead identically — these moved here from
// LeadManager.tsx the day agents gained full lead info.
export const TIER_STYLE: Record<string, string> = {
  S: "bg-primary/15 border-primary/40 text-primary",
  A: "bg-emerald-500/15 border-emerald-500/40 text-emerald-300",
  B: "bg-blue-500/15 border-blue-500/40 text-blue-300",
  C: "bg-slate-500/15 border-slate-500/40 text-muted-foreground",
  D: "bg-slate-500/10 border-slate-500/30 text-muted-foreground",
  pos: "bg-violet-500/15 border-violet-500/40 text-violet-300",
};

export const FLAG_BADGE: Record<string, { label: string; cls: string }> = {
  mortgage: { label: "Mortgage", cls: "bg-blue-500/15 border-blue-500/40 text-blue-300" },
  veteran: { label: "Veteran", cls: "bg-emerald-500/15 border-emerald-500/40 text-emerald-300" },
  homeowner: { label: "Homeowner", cls: "bg-cyan-500/15 border-cyan-500/40 text-cyan-300" },
  policyholder: { label: "Policyholder", cls: "bg-violet-500/15 border-violet-500/40 text-violet-300" },
  cc: { label: "Card on file", cls: "bg-emerald-500/15 border-emerald-500/40 text-emerald-300" },
  direct_express: { label: "Direct Express", cls: "bg-cyan-500/15 border-cyan-500/40 text-cyan-300" },
  bank_on_file: { label: "Bank on file", cls: "bg-emerald-500/15 border-emerald-500/40 text-emerald-300" },
  no_bank: { label: "No bank", cls: "bg-rose-500/15 border-rose-500/40 text-rose-300" },
  ssn_collected: { label: "SSN ✓", cls: "bg-slate-500/15 border-slate-500/40 text-muted-foreground" },
  bank_collected: { label: "Bank ✓", cls: "bg-slate-500/15 border-slate-500/40 text-muted-foreground" },
  hung_up: { label: "Data collected", cls: "bg-amber-500/15 border-amber-500/40 text-amber-300" },
  spouse: { label: "Spouse opp", cls: "bg-violet-500/15 border-violet-500/40 text-violet-300" },
  lapsed: { label: "Lapsed", cls: "bg-amber-500/15 border-amber-500/40 text-amber-300" },
  vantage: { label: "Vantage", cls: "bg-primary/15 border-primary/40 text-primary" },
};

export function flagBadges(flags: Record<string, unknown>, under9: boolean) {
  const out: { key: string; label: string; cls: string }[] = [];
  if (under9) out.push({ key: "u9", label: "Under 9mo", cls: "bg-amber-500/15 border-amber-500/40 text-amber-300" });
  for (const [k, v] of Object.entries(flags ?? {})) {
    if (v === true && FLAG_BADGE[k]) out.push({ key: k, ...FLAG_BADGE[k] });
  }
  return out;
}
