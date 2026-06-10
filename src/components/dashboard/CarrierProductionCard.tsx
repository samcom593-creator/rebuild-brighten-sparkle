import { useQuery } from "@tanstack/react-query";
import { TrendingUp } from "lucide-react";
import { format, parseISO } from "date-fns";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";

interface MonthRow {
  month: string;
  deals: number;
  premium: number | string | null;
}

function money(n: number | string | null | undefined): string {
  const v = typeof n === "string" ? Number(n) : n;
  if (v == null || isNaN(v)) return "$0";
  if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `$${Math.round(v / 1_000)}K`;
  return `$${Math.round(v)}`;
}

/**
 * v9 2026-06-10 — 12-month book trend bar chart from v_book_by_month.
 * AgentLink-style restraint: bars only, no axis, no legend, no grid.
 */
export function BookTrendCard() {
  const q = useQuery({
    queryKey: ["book_by_month"],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<MonthRow[]> => {
      const { data, error } = await supabase
        .from("v_book_by_month")
        .select("month, deals, premium");
      if (error) throw error;
      return (data ?? []) as MonthRow[];
    },
  });

  const max = Math.max(...((q.data ?? []).map((r) => Number(r.premium ?? 0))), 1);

  return (
    <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-16 flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-emerald-600" />
            Premium by month
          </CardTitle>
          <span className="text-12 text-slate-500">Last 12 months</span>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {q.isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : (q.data ?? []).length === 0 ? (
          <p className="text-12 text-slate-500 py-8 text-center">
            No monthly history yet — view refreshes every 30 min.
          </p>
        ) : (
          <div className="flex items-end gap-1.5 h-40 pt-5">
            {(q.data ?? []).map((row) => {
              const h = max > 0 ? Math.max(4, (Number(row.premium ?? 0) / max) * 100) : 4;
              const dt = parseISO(row.month);
              return (
                <div key={row.month} className="flex-1 flex flex-col items-center gap-1 min-w-0 group">
                  <div className="w-full flex flex-col items-center">
                    <span className="text-11 text-slate-700 dark:text-slate-200 mb-0.5 font-semibold whitespace-nowrap tabular-nums">
                      {money(row.premium)}
                    </span>
                    <div
                      className="w-full bg-emerald-500 rounded-t transition-base"
                      style={{ height: `${h}%`, minHeight: 4 }}
                      title={`${format(dt, "MMM yyyy")} · ${row.deals} deals · ${money(row.premium)}`}
                    />
                  </div>
                  <span className="text-11 text-slate-500">{format(dt, "MMM")}</span>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
