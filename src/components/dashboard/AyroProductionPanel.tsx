/**
 * AyroProductionPanel — Ayro Financial production, live on the site (2026-09-24, Sam directive).
 *
 * Ayro (el.ayrofinancial.com) is a SEPARATE production book from AgentLink and Ethos; these agents write
 * through it and it never showed on apex-financial.org. Pulled all-time from Sam's session into public.ayro_book
 * (its own table, so an AgentLink resync can't wipe it). Snowflake / Dom / Cal Jante / Cal David are excluded
 * per Sam and never counted here. Reads v_ayro_totals / v_ayro_production / v_ayro_book.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Trophy, ChevronDown, ChevronUp, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

type Totals = { deals: number; production: number; agents: number; excluded_production: number; excluded_agents: string | null; as_of: string | null };
type Prod = { agent_name: string; agent_id: string | null; deals: number; all_time_production: number; carriers: string | null };
type Deal = { id: number; agent_name: string; policy_number: string | null; carrier: string | null; annual_premium: number; is_excluded: boolean; no_policy_number: boolean };

const money = (n: number | null | undefined) =>
  (n ?? 0).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export function AyroProductionPanel() {
  const [showDeals, setShowDeals] = useState(false);

  const totalsQ = useQuery({
    queryKey: ["ayro-totals"],
    staleTime: 60_000,
    queryFn: async (): Promise<Totals | null> => {
      const { data, error } = await supabase.from("v_ayro_totals" as never).select("*").maybeSingle();
      if (error) throw error;
      return (data as unknown as Totals) ?? null;
    },
  });
  const prodQ = useQuery({
    queryKey: ["ayro-production"],
    staleTime: 60_000,
    queryFn: async (): Promise<Prod[]> => {
      const { data, error } = await supabase.from("v_ayro_production" as never).select("*");
      if (error) throw error;
      return (data ?? []) as unknown as Prod[];
    },
  });
  const dealsQ = useQuery({
    queryKey: ["ayro-deals"],
    enabled: showDeals,
    staleTime: 60_000,
    queryFn: async (): Promise<Deal[]> => {
      const { data, error } = await supabase.from("v_ayro_book" as never).select("id,agent_name,policy_number,carrier,annual_premium,is_excluded,no_policy_number").eq("is_excluded", false);
      if (error) throw error;
      return (data ?? []) as unknown as Deal[];
    },
  });

  const t = totalsQ.data;
  const failed = totalsQ.isError || prodQ.isError;

  return (
    <GlassCard className="space-y-4 border-accent-blue/30 p-4 sm:p-5" aria-label="Ayro production">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-sky-400">
            <Trophy className="h-4 w-4" /> Ayro Financial · production (all-time)
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            A separate book from AgentLink and Ethos, now live. {t?.excluded_agents ? <>Excluded per Sam: {t.excluded_agents}.</> : null}
            {t?.as_of && <span className="ml-1 text-xs">Pulled {new Date(t.as_of).toLocaleString()}.</span>}
          </p>
        </div>
        <div className="flex gap-4">
          <div className="text-right">
            <div className="text-2xl font-bold tabular-nums text-accent-green">{money(t?.production)}</div>
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{t?.deals ?? 0} deals · {t?.agents ?? 0} agents</div>
          </div>
        </div>
      </div>

      {failed && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
          <AlertTriangle className="mr-1 inline h-4 w-4" /> Ayro production did not load — a read failure, not an empty book.
        </div>
      )}

      {/* Leaderboard */}
      <div className="overflow-x-auto">
        {prodQ.isLoading ? (
          <Skeleton className="h-32" />
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wider text-muted-foreground">
              <tr><th className="py-1 pr-3">#</th><th className="py-1 pr-3">Agent</th><th className="py-1 pr-3 text-right">Production</th><th className="py-1 pr-3 text-right">Deals</th><th className="py-1 pr-3">Carriers</th></tr>
            </thead>
            <tbody>
              {(prodQ.data ?? []).map((r, i) => (
                <tr key={r.agent_name} className="border-t border-border/50">
                  <td className="py-1.5 pr-3 tabular-nums text-muted-foreground">{i + 1}</td>
                  <td className="py-1.5 pr-3 font-medium">
                    {r.agent_name}
                    {!r.agent_id && <Badge variant="outline" className="ml-2 text-[10px]">not linked</Badge>}
                  </td>
                  <td className="py-1.5 pr-3 text-right font-bold tabular-nums text-accent-green">{money(r.all_time_production)}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{r.deals}</td>
                  <td className="py-1.5 pr-3 text-xs text-muted-foreground">{r.carriers}</td>
                </tr>
              ))}
              {!prodQ.data?.length && !prodQ.isLoading && (
                <tr><td colSpan={5} className="py-4 text-center text-muted-foreground">No Ayro production.</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={() => setShowDeals((v) => !v)} aria-expanded={showDeals}>
          {showDeals ? <ChevronUp className="mr-1 h-4 w-4" /> : <ChevronDown className="mr-1 h-4 w-4" />}
          {showDeals ? "Hide deals" : "Show every deal"}
        </Button>
        {(t?.excluded_production ?? 0) > 0 && (
          <span className="text-xs text-muted-foreground">{money(t?.excluded_production)} excluded ({t?.excluded_agents})</span>
        )}
      </div>

      {showDeals && (
        <div className="overflow-x-auto">
          {dealsQ.isLoading ? (
            <Skeleton className="h-40" />
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                <tr><th className="py-1 pr-3">Agent</th><th className="py-1 pr-3">Carrier</th><th className="py-1 pr-3">Policy #</th><th className="py-1 pr-3 text-right">Premium</th></tr>
              </thead>
              <tbody>
                {(dealsQ.data ?? []).map((d) => (
                  <tr key={d.id} className="border-t border-border/50">
                    <td className="py-1 pr-3 whitespace-nowrap">{d.agent_name}</td>
                    <td className="py-1 pr-3 whitespace-nowrap">{d.carrier}</td>
                    <td className={cn("py-1 pr-3 font-mono text-xs", d.no_policy_number && "text-amber-400")}>{d.policy_number || "MISSING"}</td>
                    <td className="py-1 pr-3 text-right tabular-nums">{money(d.annual_premium)}</td>
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

export default AyroProductionPanel;
