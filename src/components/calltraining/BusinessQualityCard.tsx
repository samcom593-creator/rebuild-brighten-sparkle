// BusinessQualityCard: what happened to each agent's dialer sales after the call (MP-310, 2026-10-29).
//
// Sam: "track bad quality business." v_agent_business_quality counts each seat's sold calls and where they went:
// booked and holding, never booked, fell off, lapsing, or booked with a compliance flag. Tap a seat to list its
// sales (v_sold_call_quality) by verdict. Both views are security_invoker: Sam and Aisha see the agency, an upline
// sees their own team.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ShieldAlert } from "lucide-react";
import { Link } from "react-router-dom";
import { looseSupabase } from "@/lib/looseSupabase";
import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { SALE_VERDICTS, bookedPct, saleVerdictLabel, saleVerdictTone, salesAtRisk, type SaleVerdict, type SeatQuality } from "@/lib/businessQuality";

interface SaleRow {
  call_id: string;
  call_started_at: string | null;
  lead_first_name: string | null;
  lead_last_name: string | null;
  book_status: string | null;
  book_carrier: string | null;
  quality_verdict: string;
  resell_summary: string | null;
  declined_after_ssn_bank: boolean | null;
}

const shortDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "");
const seatKey = (s: SeatQuality) => s.agent_id ?? `raw:${s.agent_raw ?? s.agent_name ?? "unknown"}`;
const seatName = (s: SeatQuality) => (s.agent_name ?? s.agent_raw ?? "Unknown").replace(/\s*\(deleted\)\s*$/i, "");
const ROSE_TEXT = "font-semibold text-rose-700 dark:text-rose-300";
const AMBER_TEXT = "font-semibold text-amber-700 dark:text-amber-300";

async function fetchSeats(): Promise<SeatQuality[]> {
  const { data, error } = await looseSupabase
    .from<SeatQuality>("v_agent_business_quality")
    .select("agent_name, agent_id, agent_raw, sold_calls, in_book, not_in_book, active, pending, lapsing, fell_off, status_unknown, compliance_flagged, urgent_flags, declined_after_ssn_bank, fall_off_pct, last_sale_at")
    .limit(300);
  if (error) throw error;
  return [...(data ?? [])].filter((s) => Number(s.sold_calls) > 0).sort((a, b) => salesAtRisk(b) - salesAtRisk(a) || Number(b.sold_calls) - Number(a.sold_calls));
}
async function fetchSales(s: SeatQuality): Promise<SaleRow[]> {
  const base = looseSupabase
    .from<SaleRow>("v_sold_call_quality")
    .select("call_id, call_started_at, lead_first_name, lead_last_name, book_status, book_carrier, quality_verdict, resell_summary, declined_after_ssn_bank");
  const scoped = s.agent_id ? base.eq("agent_id", s.agent_id) : base.eq("agent_raw", s.agent_raw ?? "");
  const { data, error } = await scoped.order("call_started_at", { ascending: false }).limit(400);
  if (error) throw error;
  return data ?? [];
}

export function BusinessQualityCard({ onPickAgent, canOpenSoldCalls }: { onPickAgent: (name: string) => void; canOpenSoldCalls: boolean }) {
  const [open, setOpen] = useState(false);
  const [seat, setSeat] = useState<SeatQuality | null>(null);
  const [verdict, setVerdict] = useState<SaleVerdict | "all">("all");
  const seats = useQuery({ queryKey: ["business-quality"], queryFn: fetchSeats, enabled: open, staleTime: 5 * 60_000 });
  const sales = useQuery({
    queryKey: ["business-quality-sales", seat ? seatKey(seat) : ""],
    queryFn: () => fetchSales(seat as SeatQuality),
    enabled: open && !!seat,
    staleTime: 5 * 60_000,
  });
  const counts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of sales.data ?? []) m[r.quality_verdict] = (m[r.quality_verdict] ?? 0) + 1;
    return m;
  }, [sales.data]);
  const shown = (sales.data ?? []).filter((r) => verdict === "all" || r.quality_verdict === verdict);
  return (
    <GlassCard className="p-0">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-semibold">
        <span className="inline-flex items-center gap-2"><ShieldAlert className="h-4 w-4 text-primary" /> Business quality: where each agent's sales went</span>
        <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="space-y-4 border-t border-border/60 px-4 py-3 text-sm">
          <p className="text-xs text-muted-foreground">Every dialer sale, followed to the book. The seats with the most sales never booked, fallen off or lapsing come first. Tap a seat to see its sales.</p>
          {seats.isLoading ? (
            <p className="text-muted-foreground">Loading…</p>
          ) : seats.isError ? (
            <p className="text-rose-700 dark:text-rose-300">This did not load: {(seats.error as Error).message}</p>
          ) : (seats.data ?? []).length === 0 ? (
            <p className="text-muted-foreground">No dialer sales you can see yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="py-1 pr-2">Agent</th><th className="px-2 text-right">Sold</th><th className="px-2 text-right">Booked</th>
                    <th className="px-2 text-right">Never booked</th><th className="px-2 text-right">Fell off</th><th className="px-2 text-right">Lapsing</th>
                    <th className="px-2 text-right">Fall-off</th><th className="px-2 text-right">Compliance</th>
                  </tr>
                </thead>
                <tbody>
                  {(seats.data ?? []).map((s) => {
                    const pct = bookedPct(s);
                    return (
                      <tr key={seatKey(s)} className={cn("border-t border-border/40", seat && seatKey(seat) === seatKey(s) && "bg-primary/5")}>
                        <td className="py-1.5 pr-2">
                          <button type="button" className="text-left font-medium text-primary hover:underline" onClick={() => { setSeat(s); setVerdict("all"); }}>{seatName(s)}</button>
                        </td>
                        <td className="px-2 text-right tabular-nums">{s.sold_calls}</td>
                        <td className="px-2 text-right tabular-nums">{pct == null ? "—" : `${pct}%`}</td>
                        <td className={cn("px-2 text-right tabular-nums", Number(s.not_in_book) > 0 && ROSE_TEXT)}>{s.not_in_book}</td>
                        <td className={cn("px-2 text-right tabular-nums", Number(s.fell_off) > 0 && ROSE_TEXT)}>{s.fell_off}</td>
                        <td className={cn("px-2 text-right tabular-nums", Number(s.lapsing) > 0 && AMBER_TEXT)}>{s.lapsing}</td>
                        <td className="px-2 text-right tabular-nums">{s.fall_off_pct == null ? "—" : `${Math.round(Number(s.fall_off_pct))}%`}</td>
                        <td className={cn("px-2 text-right tabular-nums", Number(s.compliance_flagged) > 0 && AMBER_TEXT)}>{s.compliance_flagged}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {seat && (
            <div className="space-y-2 rounded-md border border-border/60 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold">{seatName(seat)}: {seat.sold_calls} dialer sale{Number(seat.sold_calls) === 1 ? "" : "s"}</p>
                <div className="flex flex-wrap gap-2">
                  {seat.agent_name && <Button type="button" size="sm" variant="outline" onClick={() => onPickAgent(seatName(seat))}>Coaching and calls</Button>}
                  <Button type="button" size="sm" variant="ghost" onClick={() => setSeat(null)}>Close</Button>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <Button type="button" size="sm" variant={verdict === "all" ? "default" : "outline"} onClick={() => setVerdict("all")}>All ({(sales.data ?? []).length})</Button>
                {SALE_VERDICTS.filter((v) => counts[v.key]).map((v) => (
                  <Button key={v.key} type="button" size="sm" variant={verdict === v.key ? "default" : "outline"} onClick={() => setVerdict(v.key)}>{v.label} ({counts[v.key]})</Button>
                ))}
              </div>
              {sales.isLoading ? (
                <p className="text-muted-foreground">Loading the sales…</p>
              ) : sales.isError ? (
                <p className="text-rose-700 dark:text-rose-300">The sales did not load: {(sales.error as Error).message}</p>
              ) : shown.length === 0 ? (
                <p className="text-muted-foreground">No sales in this view.</p>
              ) : (
                <ul className="divide-y divide-border/40">
                  {shown.map((r) => (
                    <li key={r.call_id} className="space-y-0.5 py-2">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span className="font-medium">{[r.lead_first_name, r.lead_last_name].filter(Boolean).join(" ") || "Name not on file"}</span>
                        <Badge variant="outline" className={cn("font-normal", saleVerdictTone(r.quality_verdict))}>{saleVerdictLabel(r.quality_verdict)}</Badge>
                        <span className="text-muted-foreground">
                          {shortDate(r.call_started_at)}{r.book_status ? ` · book: ${r.book_status}` : ""}{r.book_carrier ? ` · ${r.book_carrier}` : ""}{r.declined_after_ssn_bank ? " · declined after SSN and bank" : ""}
                        </span>
                        {canOpenSoldCalls && <Link to={`/dashboard/sold-calls?call=${encodeURIComponent(r.call_id)}`} className="text-primary hover:underline">Open in Sold Calls</Link>}
                      </div>
                      {r.resell_summary && <p className="text-muted-foreground">{r.resell_summary}</p>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </GlassCard>
  );
}
