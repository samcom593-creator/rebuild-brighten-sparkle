import { useQuery } from "@tanstack/react-query";
import { Trophy } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";

interface CarrierRow {
  carrier_id: number;
  carrier_name: string | null;
  carrier_logo: string | null;
  deal_count: number;
  total_premium: number | string | null;
  premium_this_month: number | string | null;
  deals_this_month: number;
}

function money(n: number | string | null | undefined): string {
  const v = typeof n === "string" ? Number(n) : n;
  if (v == null || isNaN(v) || v === 0) return "$0";
  if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (Math.abs(v) >= 1_000) return `$${Math.round(v / 1_000)}K`;
  return `$${Math.round(v)}`;
}

/**
 * v9 2026-06-10 — Production by carrier leaderboard, matches AgentLink layout.
 * Top 8 carriers by total book premium with this-month delta and bar mark.
 */
export function CarrierBreakdownCard() {
  const q = useQuery({
    queryKey: ["carrier_production"],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<CarrierRow[]> => {
      const { data, error } = await supabase
        .from("v_carrier_production")
        .select("carrier_id, carrier_name, carrier_logo, deal_count, total_premium, premium_this_month, deals_this_month")
        .order("total_premium", { ascending: false, nullsFirst: false })
        .limit(8);
      if (error) throw error;
      return (data ?? []) as unknown as CarrierRow[];
    },
  });

  const rows = q.data ?? [];
  const max = Math.max(...rows.map((r) => Number(r.total_premium ?? 0)), 1);

  return (
    <Card className="bg-white dark:bg-card border-slate-200 dark:border-border">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-16 flex items-center gap-2">
            <Trophy className="h-4 w-4 text-amber-500" />
            Top carriers
          </CardTitle>
          <span className="text-12 text-muted-foreground">All-time book</span>
        </div>
      </CardHeader>
      <CardContent className="pt-0 space-y-2">
        {q.isLoading ? (
          <>
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </>
        ) : rows.length === 0 ? (
          <p className="text-12 text-muted-foreground py-4 text-center">No carrier data yet.</p>
        ) : (
          rows.map((row, i) => {
            const pct = max > 0 ? (Number(row.total_premium ?? 0) / max) * 100 : 0;
            return (
              <div key={row.carrier_id} className="space-y-1">
                <div className="flex items-center gap-2 text-12">
                  <span className="text-muted-foreground w-4 tabular-nums">{i + 1}</span>
                  <span className="font-medium truncate flex-1">{row.carrier_name ?? "—"}</span>
                  <span className="tabular-nums text-slate-600 dark:text-muted-foreground">{row.deal_count}</span>
                  <span className="tabular-nums font-semibold w-16 text-right">{money(row.total_premium)}</span>
                </div>
                <div className="h-1.5 rounded-full bg-slate-100 dark:bg-muted overflow-hidden">
                  <div className="h-full bg-emerald-500 rounded-full transition-base" style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
