// DialerActivityCard: each dialer seat's last 30 days, from the ReadyMode call log (MP-310 wave 2, 2026-10-28).
//
// ReadyMode's own agent report is a JavaScript screen the bot cannot read headless, so the same numbers are
// computed from every call the bot pulls (v_readymode_agent_scorecard over v_readymode_agent_daily). A seat the
// roster cannot match (VA and departed dialer logins) shows the name ReadyMode uses. The dialer's own call
// duration is mostly empty, so talk time is not shown. Sam + Aisha only, like the rest of Call Training: the view
// is security_invoker over readymode_dialer_calls, whose read policy is can_view_sold_calls().
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, PhoneCall } from "lucide-react";
import { looseSupabase } from "@/lib/looseSupabase";
import { GlassCard } from "@/components/ui/glass-card";
import { cn } from "@/lib/utils";

interface SeatRow {
  agent_name: string | null;
  agent_id: string | null;
  agent_raw: string | null;
  calls_30d: number | null;
  contacts_30d: number | null;
  sold_30d: number | null;
  appointments_30d: number | null;
  days_dialed_30d: number | null;
  calls_all: number | null;
  sold_all: number | null;
  sold_per_100_contacts: number | null;
  last_call_at: string | null;
}

const num = (v: number | null | undefined) => Number(v ?? 0);
const share = (part: number, whole: number) => (whole > 0 ? `${Math.round((100 * part) / whole)}%` : "");
const shortDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "");

async function fetchSeats(): Promise<SeatRow[]> {
  const { data, error } = await (looseSupabase
    .from("v_readymode_agent_scorecard")
    .select("agent_name, agent_id, agent_raw, calls_30d, contacts_30d, sold_30d, appointments_30d, days_dialed_30d, calls_all, sold_all, sold_per_100_contacts, last_call_at")
    .order("calls_30d", { ascending: false })
    .limit(200) as unknown as Promise<{ data: SeatRow[] | null; error: Error | null }>);
  if (error) throw error;
  return data ?? [];
}

export function DialerActivityCard() {
  const [open, setOpen] = useState(false);
  const q = useQuery({ queryKey: ["dialer-activity"], queryFn: fetchSeats, staleTime: 5 * 60_000, enabled: open });
  const rows = (q.data ?? []).filter((r) => num(r.calls_all) > 0);
  return (
    <GlassCard className="p-0">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-semibold">
        <span className="inline-flex items-center gap-2"><PhoneCall className="h-4 w-4 text-primary" /> Dialer activity · last 30 days</span>
        <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="overflow-x-auto border-t border-border/60">
          {q.isLoading ? (
            <p className="px-4 py-3 text-sm text-muted-foreground">Loading dialer activity…</p>
          ) : q.isError ? (
            <p className="px-4 py-3 text-sm text-rose-700 dark:text-rose-300">Dialer activity did not load: {(q.error as Error).message}</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-2">Seat</th>
                  <th className="px-2 py-2 text-right">Days</th>
                  <th className="px-2 py-2 text-right">Calls</th>
                  <th className="px-2 py-2 text-right">Reached</th>
                  <th className="px-2 py-2 text-right">Sold</th>
                  <th className="px-2 py-2 text-right">Appts</th>
                  <th className="px-2 py-2 text-right">Sold per 100 reached, all time</th>
                  <th className="px-2 py-2 text-right">Last call</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={`${r.agent_id ?? "none"}|${r.agent_raw ?? ""}`} className="border-t border-border/40">
                    <td className="px-4 py-2 font-medium">
                      {r.agent_name || r.agent_raw || "Unknown"}
                      {!r.agent_id && <span className="ml-1 text-xs font-normal text-muted-foreground">(not on the roster)</span>}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">{num(r.days_dialed_30d)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{num(r.calls_30d).toLocaleString()}</td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {num(r.contacts_30d).toLocaleString()} <span className="text-xs text-muted-foreground">{share(num(r.contacts_30d), num(r.calls_30d))}</span>
                    </td>
                    <td className="px-2 py-2 text-right font-semibold tabular-nums">{num(r.sold_30d)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{num(r.appointments_30d)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{r.sold_per_100_contacts == null ? "" : Number(r.sold_per_100_contacts).toFixed(1)}</td>
                    <td className="px-2 py-2 text-right text-muted-foreground">{shortDate(r.last_call_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </GlassCard>
  );
}
