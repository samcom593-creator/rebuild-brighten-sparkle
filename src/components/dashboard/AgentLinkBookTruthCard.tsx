import { useQuery } from "@tanstack/react-query";
import { TrendingUp, AlertTriangle } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { looseSupabase } from "@/lib/looseSupabase";

interface BookTruth {
  total_deals: number;
  total_annual_premium: number;
  deals_this_month: number;
  premium_this_month: number;
  last_synced_at: string | null;
}

function money(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${Math.round(n)}`;
}

// PL-MP242: MTD reverted to calendar month (Phoenix TZ). Show the actual date
// range so users read "Month" as the honest slice (e.g. Jul 1 – Jul 5) instead
// of assuming it's a rolling window.
function mtdRangeLabel(): string {
  const nowPhx = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Phoenix" }));
  const start = new Date(nowPhx.getFullYear(), nowPhx.getMonth(), 1);
  const fmt = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `${fmt(start)} – ${fmt(nowPhx)}`;
}

/**
 * 2026-06-09 — AgentLink Book Truth card.
 * Surfaces the canonical source-of-truth book numbers pulled from
 * agentlink.insuracloud.ai/api/deals (every 30 min via launchd).
 * Shows what apex deals table has been missing during the AgentLink
 * sync gap (was 20 days dark; resolved 2026-06-08).
 */
export function AgentLinkBookTruthCard() {
  const q = useQuery({
    queryKey: ["agentlink_book_truth"],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<BookTruth | null> => {
      const { data, error } = await looseSupabase
        .from<Record<string, unknown>>("v_agentlink_book_truth")
        .select("total_deals, total_annual_premium, deals_this_month, premium_this_month, last_synced_at")
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return {
        total_deals: Number(data.total_deals ?? 0),
        total_annual_premium: Number(data.total_annual_premium ?? 0),
        deals_this_month: Number(data.deals_this_month ?? 0),
        premium_this_month: Number(data.premium_this_month ?? 0),
        last_synced_at: typeof data.last_synced_at === "string" ? data.last_synced_at : null,
      };
    },
  });

  if (q.isLoading) {
    return (
      <Card className="border-amber-500/30 bg-amber-500/[0.03]">
        <CardContent className="p-4 space-y-2">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-9 w-44" />
          <Skeleton className="h-3 w-56" />
        </CardContent>
      </Card>
    );
  }
  if (q.error || !q.data) return null;

  const d = q.data;
  const syncAgo = d.last_synced_at ? formatDistanceToNow(new Date(d.last_synced_at), { addSuffix: true }) : null;
  const stale = d.last_synced_at && (Date.now() - new Date(d.last_synced_at).getTime()) > 6 * 3600 * 1000;

  return (
    <Card className="border-amber-500/40 bg-amber-500/[0.06]">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-amber-300">
                AgentLink book — total truth
              </p>
              {stale ? (
                <Badge variant="outline" className="border-rose-500/40 bg-rose-500/10 text-rose-300">
                  <AlertTriangle className="mr-1 h-3 w-3" /> stale
                </Badge>
              ) : (
                <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/10 text-emerald-300">
                  <span className="mr-1 h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  live
                </Badge>
              )}
            </div>
            <p className="mt-1 text-3xl font-bold tabular-nums text-foreground">
              {money(d.total_annual_premium)}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {d.total_deals.toLocaleString()} deals across all carriers
            </p>
          </div>
          <TrendingUp className="h-7 w-7 text-amber-400/70" />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 border-t border-amber-500/20 pt-3">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">MTD ({mtdRangeLabel()})</p>
            <p className="text-base font-bold tabular-nums">{money(d.premium_this_month)}</p>
            <p className="text-[11px] text-muted-foreground">{d.deals_this_month} deals</p>
          </div>
          {syncAgo && (
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Last sync</p>
              <p className="text-sm font-medium">{syncAgo}</p>
              <p className="text-[11px] text-muted-foreground">Auto every 30 min</p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
