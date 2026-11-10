import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { AlertTriangle, Clock, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { WP5_RELATION } from "@/lib/wp5Relations";
import { contractingText, firstDealCell, type HireClockRow } from "@/lib/hireClock";

/**
 * Licensed hire clock (WP5, 2026-11-10). One row per active licensed recruit (canonical, not a manager account), with
 * the facts that decide whether they write in week 1: carrier contracting marks, the onboarding call, a dialer, leads
 * and the first deal. Producers start in week 1 or never, so the useful view is "who crossed day 3 / 7 / 14 with
 * nothing on file".
 *
 * Reads public.v_licensed_hire_clock, which is gated server-side to Sam (admin), Aisha (the manager role, her
 * downline) and service callers. An agent who somehow opened this tab gets zero rows, never someone else's.
 *
 * First deal: production truth has DARK origins (v_production_origin_freshness), so a recruit with no deal on record
 * reads "Unprovable", never "No deal", until every origin that could carry their deal is live again.
 */
type Lens = "stalled" | "first21" | "all";
const LENSES: ReadonlyArray<readonly [Lens, string]> = [
  ["stalled", "Stalled (day 7+, no contract, no deal)"],
  ["first21", "Days 0-21"],
  ["all", "Everyone"],
];

export function LicensedHireClockTab({ onOpenPerson }: { onOpenPerson?: (agentId: string) => void }) {
  const [lens, setLens] = useState<Lens>("stalled");
  const clock = useQuery({
    queryKey: ["licensed-hire-clock"],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from(WP5_RELATION.hireClock as never)
        .select("*")
        .order("days_since_hire", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as HireClockRow[];
    },
  });

  const rows = useMemo(() => clock.data ?? [], [clock.data]);
  const visible = useMemo(() => rows.filter((r) => {
    if (lens === "stalled") return r.stalled;
    if (lens === "first21") return r.days_since_hire <= 21;
    return true;
  }), [rows, lens]);
  const counts = useMemo(() => ({
    stalled: rows.filter((r) => r.stalled).length,
    first21: rows.filter((r) => r.days_since_hire <= 21).length,
    all: rows.length,
  }), [rows]);
  const degraded = rows.some((r) => r.production_truth_degraded);
  const darkOrigins = rows.find((r) => r.production_truth_degraded)?.dark_origins ?? [];

  if (clock.isLoading) {
    return <div role="status" className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading the hire clock…</div>;
  }
  if (clock.isError) {
    return (
      <div role="alert" className="rounded-xl border border-destructive/40 p-4 text-sm">
        The hire clock did not load, so nothing here is shown as on track.{" "}
        <button type="button" className="underline" onClick={() => { void clock.refetch(); }}>Retry</button>
      </div>
    );
  }

  return (
    <section aria-label="Licensed hire clock" className="flex flex-col gap-3">
      <div className="flex items-start gap-2 text-sm text-muted-foreground">
        <Clock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <p>
          Licensed hires write in week one or not at all. This shows each one&apos;s day since hire, carrier contracting, the
          onboarding call, dialer, leads and first deal. Seats and leads are your call; nothing here grants them.
        </p>
      </div>
      {degraded && (
        <div role="note" className="flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/5 p-3 text-[13px]">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
          <span>
            Production truth is partly dark ({darkOrigins.join(", ")}). Anyone without a deal on record reads
            &ldquo;Unprovable&rdquo;, not &ldquo;No deal&rdquo;.
          </span>
        </div>
      )}
      <div role="group" aria-label="Hire clock view" className="flex flex-wrap gap-2">
        {LENSES.map(([key, label]) => (
          <Button key={key} size="sm" variant={lens === key ? "default" : "outline"} className="h-10" aria-pressed={lens === key} onClick={() => setLens(key)}>
            {label}
            <span className="ml-1 rounded-full bg-black/10 px-1.5 text-[11px] tabular-nums">{counts[key]}</span>
          </Button>
        ))}
      </div>

      {visible.length === 0 ? (
        <div role="status" className="rounded-xl border border-border p-8 text-center text-sm text-muted-foreground">Nobody in this view right now.</div>
      ) : (
        <ul className="flex flex-col gap-2">
          {visible.map((row) => {
            const deal = firstDealCell(row);
            return (
              <li key={row.agent_id} className={cn("rounded-xl border bg-card p-3", row.stalled ? "border-warning/40" : "border-border")}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div className="min-w-0">
                    <button type="button" className="text-left text-[15px] font-semibold underline-offset-2 hover:underline" onClick={() => onOpenPerson?.(row.agent_id)}>
                      {row.first_name}
                    </button>
                    <span className="ml-2 text-[13px] text-muted-foreground">
                      Day {row.days_since_hire} · hired {format(new Date(row.hired_at), "MMM d")}
                      {row.manager_first_name ? ` · ${row.owner_source === "manager" ? "manager" : "owner"} ${row.manager_first_name}` : ""}
                    </span>
                  </div>
                  {row.next_checkpoint && row.next_checkpoint_at && (
                    <span className="text-[12px] text-muted-foreground">Day {row.next_checkpoint} check {format(new Date(row.next_checkpoint_at), "MMM d")}</span>
                  )}
                </div>
                <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[13px] sm:grid-cols-3">
                  <div><dt className="inline text-muted-foreground">Contracting: </dt><dd className={cn("inline", row.contracting_state === "no_record" && "font-semibold text-warning")}>{contractingText(row)}</dd></div>
                  <div><dt className="inline text-muted-foreground">NPN: </dt><dd className="inline">{row.has_npn ? "on file" : "missing"}</dd></div>
                  <div><dt className="inline text-muted-foreground">Onboarding call: </dt><dd className="inline">{row.onboarding_call_held ? "held" : row.onboarding_call_booked_at ? `booked ${format(new Date(row.onboarding_call_booked_at), "MMM d")}` : "not booked"}</dd></div>
                  <div><dt className="inline text-muted-foreground">Dialer: </dt><dd className="inline">{row.dials_total > 0 ? `${row.dials_total.toLocaleString()} dials (${row.dials_14d} in 14d)` : row.has_open_seat ? "seat, no dials" : "no seat on record"}</dd></div>
                  <div><dt className="inline text-muted-foreground">Leads: </dt><dd className="inline">{row.lead_grant_at ? `granted ${format(new Date(row.lead_grant_at), "MMM d")}` : "none"}</dd></div>
                  <div title={deal.title}><dt className="inline text-muted-foreground">First deal: </dt><dd className={cn("inline", deal.tone === "good" && "text-success", deal.tone === "warn" && "text-warning")}>{deal.text}</dd></div>
                </dl>
                <p className="mt-2 text-[13px] font-semibold">Next: {row.next_action}</p>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
