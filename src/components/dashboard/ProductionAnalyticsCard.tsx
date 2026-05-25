import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { DollarSign, TrendingUp } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface PeriodStats {
  week: number;
  month: number;
  year: number;
  weekDeals: number;
  monthDeals: number;
  yearDeals: number;
}

/**
 * Replaces the legacy "Total ALP" tile with three-period analytics:
 * This Week · This Month · This Year. Pulls from the production table
 * (canonical APEX production source) with date-window filters.
 *
 * Sam wanted: analytics of production for the week, month, year — not a
 * single static lifetime number.
 */
export function ProductionAnalyticsCard() {
  const [stats, setStats] = useState<PeriodStats>({
    week: 0, month: 0, year: 0, weekDeals: 0, monthDeals: 0, yearDeals: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const now = new Date();
    const dayOfWeek = now.getDay();
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - dayOfWeek);
    weekStart.setHours(0, 0, 0, 0);

    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const yearStart = new Date(now.getFullYear(), 0, 1);

    Promise.all([
      supabase.from("production").select("total_alp, deals_count").gte("production_date", weekStart.toISOString().slice(0, 10)),
      supabase.from("production").select("total_alp, deals_count").gte("production_date", monthStart.toISOString().slice(0, 10)),
      supabase.from("production").select("total_alp, deals_count").gte("production_date", yearStart.toISOString().slice(0, 10)),
    ]).then(([w, m, y]) => {
      const sum = (rows: any[] | null, key: string) =>
        rows ? rows.reduce((s, r) => s + Number(r[key] || 0), 0) : 0;
      setStats({
        week: sum(w.data, "total_alp"),
        month: sum(m.data, "total_alp"),
        year: sum(y.data, "total_alp"),
        weekDeals: sum(w.data, "deals_count"),
        monthDeals: sum(m.data, "deals_count"),
        yearDeals: sum(y.data, "deals_count"),
      });
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const fmt = (n: number) =>
    n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(1)}M`
    : n >= 1_000   ? `$${(n / 1_000).toFixed(1)}K`
    : `$${Math.round(n).toLocaleString()}`;

  return (
    <Card className="stat-card group overflow-hidden border-border/70 bg-card/95 shadow-sm transition-all hover:-translate-y-0.5 hover:border-foreground/20 hover:shadow-md">
      <CardContent className="p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-md bg-primary/10 ring-1 ring-primary/15">
              <DollarSign className="h-5 w-5 text-primary" />
            </div>
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Production</p>
          </div>
          <TrendingUp className="h-4 w-4 text-emerald-400/80" />
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Week</p>
            <p className="text-lg font-bold tabular-nums leading-tight">{loading ? "…" : fmt(stats.week)}</p>
            {stats.weekDeals > 0 && <p className="text-[10px] text-muted-foreground">{stats.weekDeals} deals</p>}
          </div>
          <div className="border-l border-border/60 pl-2">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Month</p>
            <p className="text-lg font-bold tabular-nums leading-tight">{loading ? "…" : fmt(stats.month)}</p>
            {stats.monthDeals > 0 && <p className="text-[10px] text-muted-foreground">{stats.monthDeals} deals</p>}
          </div>
          <div className="border-l border-border/60 pl-2">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Year</p>
            <p className="text-lg font-bold tabular-nums leading-tight">{loading ? "…" : fmt(stats.year)}</p>
            {stats.yearDeals > 0 && <p className="text-[10px] text-muted-foreground">{stats.yearDeals} deals</p>}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
