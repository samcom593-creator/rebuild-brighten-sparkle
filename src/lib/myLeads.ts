// The caller's own leads, shared by My Leads and the Home card (MP-BEST-3, 2026-11-19).
//
// Home had no path to the leads a person holds: 434 Home views by 21 people in 30 days, 420 of 656 handed-out leads
// never called, and not one line on Home said "you have leads waiting". Both screens read my_lead_bundles() under one
// query key, so opening My Leads from the Home card paints from cache.
import { supabase } from "@/integrations/supabase/client";
import { isOpenLead } from "@/lib/leadBundles";
import { leadResponsePriority, type LeadResponseRow } from "@/lib/leadResponsePriority";
import { holdLabels } from "@/lib/leadManagerFilters";
import { isDialablePhone } from "@/lib/phone";

/** The fields the Home card needs from my_lead_bundles(); My Leads reads the full row. */
export interface MyLeadRow extends LeadResponseRow {
  item_id: string;
  status: string;
  /** Server verdict: 8 AM to 7 PM in the lead's own time zone. An older server that omits it leaves the lead workable. */
  callable_now?: boolean | null;
  callable_at?: string | null;
  phone10?: string | null;
}

export const MY_LEADS_QUERY_KEY = ["my-leads"] as const;

export async function fetchMyLeads<T extends MyLeadRow = MyLeadRow>(): Promise<T[]> {
  const { data, error } = await supabase.rpc("my_lead_bundles" as never);
  if (error) throw new Error(error.message);
  return (Array.isArray(data) ? data : []) as T[];
}

export interface LeadsWaiting {
  /** Leads that still need a call, whatever the hour. */
  open: number;
  /** Open and inside calling hours right now. */
  toCall: number;
  /** Of toCall: the agreed callback time is due. */
  callbacks: number;
  /** Of toCall: nobody has called them yet. */
  neverCalled: number;
  /** Open, but it is outside calling hours where the lead lives. */
  closedHours: number;
  scheduled: number;
  followupsWithoutTime: number;
  held: number;
}

export function leadsWaitingSummary(rows: ReadonlyArray<MyLeadRow>, now = Date.now()): LeadsWaiting {
  const open = rows.filter((r) => isOpenLead(r.status));
  const held = (r: MyLeadRow) => r.attrs?.blocked === true || holdLabels({ true_dnc: r.attrs?.true_dnc, dnc: r.attrs?.dnc,
    current_client: r.attrs?.current_client, import_review_required: r.attrs?.import_review_required, invalid_number: r.attrs?.invalid_number }).length > 0
    || (r.phone10 !== undefined && !isDialablePhone(r.phone10));
  const available = open.filter(r => !held(r));
  const unscheduled = available.filter(r => leadResponsePriority(r, now).kind !== "scheduled");
  const callable = unscheduled.filter((r) => r.callable_now !== false);
  return {
    open: open.length,
    toCall: callable.length,
    callbacks: callable.filter((r) => leadResponsePriority(r, now).kind === "overdue").length,
    neverCalled: callable.filter((r) => leadResponsePriority(r, now).kind === "first_outcome").length,
    closedHours: unscheduled.length - callable.length,
    scheduled: available.length - unscheduled.length,
    followupsWithoutTime: callable.filter(r => leadResponsePriority(r, now).kind === "followup_unplanned").length,
    held: open.length - available.length,
  };
}
