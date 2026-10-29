// Business quality (MP-310, 2026-10-29): what happened to each agent's dialer sales after the call.
// Sam: "track bad quality business." Verdicts come from v_sold_call_quality; the seat totals from
// v_agent_business_quality. These are the shared words and the ranking rule for the Call Training card.

export type SaleVerdict = "not_in_book" | "not_in_book_no_packet" | "fell_off" | "lapsing" | "compliance_flag" | "ok";

const ROSE = "border-rose-500/40 text-rose-700 dark:text-rose-300";
const AMBER = "border-amber-500/40 text-amber-700 dark:text-amber-300";
const EMERALD = "border-emerald-500/40 text-emerald-700 dark:text-emerald-300";

export const SALE_VERDICTS: ReadonlyArray<{ key: SaleVerdict; label: string; tone: string }> = [
  { key: "not_in_book", label: "Sold, never booked", tone: ROSE },
  { key: "not_in_book_no_packet", label: "Sold, never booked, no packet", tone: ROSE },
  { key: "fell_off", label: "Booked, then fell off", tone: ROSE },
  { key: "lapsing", label: "Booked, now lapsing", tone: AMBER },
  { key: "compliance_flag", label: "Booked, compliance flag on the call", tone: AMBER },
  { key: "ok", label: "Booked and holding", tone: EMERALD },
];

export function saleVerdictLabel(v: string | null | undefined): string {
  return SALE_VERDICTS.find((x) => x.key === v)?.label ?? (v ?? "").replace(/_/g, " ");
}
export function saleVerdictTone(v: string | null | undefined): string {
  return SALE_VERDICTS.find((x) => x.key === v)?.tone ?? "text-muted-foreground";
}

export interface SeatQuality {
  agent_name: string | null;
  agent_id: string | null;
  agent_raw: string | null;
  sold_calls: number;
  in_book: number;
  not_in_book: number;
  active: number;
  pending: number;
  lapsing: number;
  fell_off: number;
  status_unknown: number;
  compliance_flagged: number;
  urgent_flags: number;
  declined_after_ssn_bank: number;
  fall_off_pct: number | null;
  last_sale_at: string | null;
}

/** Sales that still need work: never booked, fell off, or lapsing. Seats are ranked by this, most first. */
export const salesAtRisk = (s: Pick<SeatQuality, "not_in_book" | "fell_off" | "lapsing">) =>
  Number(s.not_in_book ?? 0) + Number(s.fell_off ?? 0) + Number(s.lapsing ?? 0);

/** Share of a seat's dialer sales that reached the book, or null for a seat with none. */
export const bookedPct = (s: Pick<SeatQuality, "sold_calls" | "in_book">) =>
  Number(s.sold_calls) > 0 ? Math.round((100 * Number(s.in_book)) / Number(s.sold_calls)) : null;
