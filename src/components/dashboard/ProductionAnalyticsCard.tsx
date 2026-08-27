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
 * Three-period production analytics: This Week · MTD · YTD.
 *
 * Reads production_period_totals(), which carries the SAME canonical filter as
 * agent_lifetime_production (v_production_unified, excluding
 * origin = 'external_daily_gap' and null agent_id), so this headline cannot
 * drift from the lifetime metric the rest of the app reports.
 *
 * WHY IT IS AN RPC AND NOT A .from() (2026-08-27, MP-329):
 *   1. PostgREST caps a plain select at 1000 rows. YTD is already 1,315 rows,
 *      so summing client-side would have silently UNDER-reported the year.
 *   2. The sum belongs next to the canonical filter. Two places computing one
 *      number is how the week-over-week tile came to divide truth by legacy.
 *
 * WHAT WAS WRONG BEFORE: this card queried `.from("production")` — a relation
 * that exists in NO schema of this database. PostgREST resolves rather than
 * rejects, so the old `sum(rows ?? null)` helper returned 0 and the card
 * rendered a confident "$0 / $0 / $0" on /dashboard/admin while the real YTD
 * was $1,733,745.44 across 1,315 deals. A failed read that renders as a NUMBER
 * is worse than one that renders as an error, so failure now shows "—".
 */
export function ProductionAnalyticsCard() {
  const [stats, setStats] = useState<PeriodStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const fail = () => {
      if (cancelled) return;
      setFailed(true);
      setLoading(false);
    };

    supabase
      .rpc("production_period_totals")
      .then(({ data, error }) => {
        if (cancelled) return;
        const row = Array.isArray(data) ? data[0] : data;
        // A non-staff caller is REFUSED by the function rather than handed
        // zeros, so an error here means "we could not read", never "it is 0".
        if (error || !row) {
          fail();
          return;
        }
        setStats({
          week: Number(row.week_alp ?? 0),
          month: Number(row.month_alp ?? 0),
          year: Number(row.year_alp ?? 0),
          weekDeals: Number(row.week_deals ?? 0),
          monthDeals: Number(row.month_deals ?? 0),
          yearDeals: Number(row.year_deals ?? 0),
        });
        setLoading(false);
      })
      .catch(fail);

    return () => {
      cancelled = true;
    };
  }, []);

  const fmt = (n: number) =>
    n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(1)}M`
    : n >= 1_000   ? `$${(n / 1_000).toFixed(1)}K`
    : `$${Math.round(n).toLocaleString()}`;

  // Explicit calendar-month + year labels (Phoenix TZ, Sam 2026-07-05):
  // MTD = calendar month (e.g. "Jul"), YTD = calendar year (e.g. "2026").
  // The RPC windows on Phoenix dates too, so label and number agree.
  const nowPhx = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Phoenix" }));
  const monthLabel = nowPhx.toLocaleDateString("en-US", { month: "short", timeZone: "America/Phoenix" });
  const yearLabel = String(nowPhx.getFullYear());

  const show = (value: number | undefined) =>
    loading ? "…" : failed || value === undefined ? "—" : fmt(value);

  return (
    <Card className="stat-card group overflow-hidden border-border/70 bg-card/95 shadow-sm transition-all .5 hover:border-foreground/20 hover:shadow-md">
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
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">This week</p>
            <p className="text-lg font-bold tabular-nums leading-tight">{show(stats?.week)}</p>
            {stats && stats.weekDeals > 0 && <p className="text-[10px] text-muted-foreground">{stats.weekDeals} deals</p>}
          </div>
          <div className="border-l border-border/60 pl-2">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">MTD ({monthLabel})</p>
            <p className="text-lg font-bold tabular-nums leading-tight">{show(stats?.month)}</p>
            {stats && stats.monthDeals > 0 && <p className="text-[10px] text-muted-foreground">{stats.monthDeals} deals · calendar month</p>}
          </div>
          <div className="border-l border-border/60 pl-2">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">YTD ({yearLabel})</p>
            <p className="text-lg font-bold tabular-nums leading-tight">{show(stats?.year)}</p>
            {stats && stats.yearDeals > 0 && <p className="text-[10px] text-muted-foreground">{stats.yearDeals} deals</p>}
          </div>
        </div>
        {failed && (
          <p className="mt-2 text-[10px] text-muted-foreground">
            Production figures unavailable — the read failed. This is not a zero.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
