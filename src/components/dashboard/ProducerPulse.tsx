import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Activity, ChevronRight, Phone } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

// Sam: "make it easier to check downlines or agencies production, or producers
// who live and go a day no sale."
//
// Quiet is counted in BUSINESS days. A producer who sold Friday is not three
// days quiet on Monday, and a Sunday list that flags the whole team is a list
// nobody opens twice.

type Leg = { leg: string; producers: number; sold_today: number; quiet: number; slipping: number; cold: number; ap_today: number; ap_7d: number; ap_mtd: number };
type Pulse = { agent_id: string; agent_name: string; leg: string; pulse: string; business_days_quiet: number; last_sale: string | null; ap_mtd: number; deals_mtd: number };

const money = (n: number | null | undefined) => `$${Math.round(Number(n ?? 0)).toLocaleString()}`;
const PULSE_STYLE: Record<string, { label: string; cls: string }> = {
  sold_today: { label: "Sold today", cls: "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" },
  quiet:      { label: "Quiet",      cls: "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400" },
  slipping:   { label: "Slipping",   cls: "border-orange-500/40 bg-orange-500/10 text-orange-600 dark:text-orange-400" },
  cold:       { label: "Cold",       cls: "border-rose-500/40 bg-rose-500/10 text-rose-600 dark:text-rose-400" },
  never_sold: { label: "No sale yet", cls: "border-border bg-muted text-muted-foreground" },
};

export function ProducerPulse() {
  const [openLeg, setOpenLeg] = useState<string | null>(null);

  const { data: legs = [], isLoading } = useQuery({
    queryKey: ["leg-production"],
    staleTime: 120_000,
    queryFn: async () => {
      const { data, error } = await supabase.from("v_leg_production" as never).select("*");
      if (error) throw error;
      return (data ?? []) as unknown as Leg[];
    },
  });

  const { data: people = [] } = useQuery({
    queryKey: ["producer-pulse", openLeg],
    enabled: openLeg !== null,
    staleTime: 120_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_producer_pulse" as never)
        .select("agent_id, agent_name, leg, pulse, business_days_quiet, last_sale, ap_mtd, deals_mtd")
        .eq("leg", openLeg as string);
      if (error) throw error;
      return (data ?? []) as unknown as Pulse[];
    },
  });

  if (isLoading) return <Skeleton className="h-44 rounded-lg" />;
  if (legs.length === 0) return null;

  return (
    <Card>
      <CardContent className="p-4">
        <div className="mb-3 flex items-baseline justify-between">
          <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
            <Activity className="h-3 w-3" /> Producer pulse by leg
          </p>
          <Link to="/dashboard/team" className="text-xs text-primary hover:underline">Team</Link>
        </div>

        <div className="space-y-2">
          {legs.map((l) => {
            const open = openLeg === l.leg;
            return (
              <div key={l.leg} className="rounded-lg border border-border">
                <button
                  type="button"
                  onClick={() => setOpenLeg(open ? null : l.leg)}
                  aria-expanded={open}
                  className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-muted/40"
                >
                  <ChevronRight className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{l.leg}</span>
                  <span className="hidden shrink-0 gap-1 sm:flex">
                    {l.sold_today > 0 && <Badge variant="outline" className={PULSE_STYLE.sold_today.cls}>{l.sold_today} sold today</Badge>}
                    {l.quiet > 0 && <Badge variant="outline" className={PULSE_STYLE.quiet.cls}>{l.quiet} quiet</Badge>}
                    {l.slipping > 0 && <Badge variant="outline" className={PULSE_STYLE.slipping.cls}>{l.slipping} slipping</Badge>}
                    {l.cold > 0 && <Badge variant="outline" className={PULSE_STYLE.cold.cls}>{l.cold} cold</Badge>}
                  </span>
                  <span className="w-24 shrink-0 text-right text-sm font-semibold tabular-nums">{money(l.ap_mtd)}</span>
                </button>

                {open && (
                  <div className="border-t border-border">
                    {people.length === 0 ? (
                      <p className="px-3 py-4 text-center text-xs text-muted-foreground">Loading producers…</p>
                    ) : (
                      <table className="w-full text-sm">
                        <tbody className="divide-y divide-border">
                          {people
                            .slice()
                            .sort((a, b) => (b.business_days_quiet ?? 0) - (a.business_days_quiet ?? 0))
                            .map((p) => {
                              const st = PULSE_STYLE[p.pulse] ?? PULSE_STYLE.never_sold;
                              return (
                                <tr key={p.agent_id}>
                                  <td className="max-w-44 truncate py-2 pl-9 pr-2">{p.agent_name}</td>
                                  <td className="py-2 pr-2">
                                    <Badge variant="outline" className={cn("text-[10px]", st.cls)}>{st.label}</Badge>
                                  </td>
                                  <td className="py-2 pr-2 text-xs tabular-nums text-muted-foreground">
                                    {p.pulse === "sold_today" ? "today"
                                      : p.last_sale ? `${p.business_days_quiet}d quiet · last ${p.last_sale}`
                                      : "no sale on record"}
                                  </td>
                                  <td className="py-2 pr-3 text-right tabular-nums">{money(p.ap_mtd)}</td>
                                  <td className="w-8 py-2 pr-3 text-right">
                                    <Link to={`/dashboard/team?agent=${p.agent_id}`} aria-label={`Open ${p.agent_name}`}>
                                      <Phone className="h-3.5 w-3.5 text-muted-foreground hover:text-primary" />
                                    </Link>
                                  </td>
                                </tr>
                              );
                            })}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
