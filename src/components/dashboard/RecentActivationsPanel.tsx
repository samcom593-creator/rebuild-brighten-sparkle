import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Rocket } from "lucide-react";
import { formatDistanceToNowStrict } from "date-fns";
import { cn } from "@/lib/utils";

type Row = {
  agent_id: string;
  display_name: string;
  first_deal_at: string;
  first_30d_alp: number;
  first_30d_deals: number;
  rank_in_month: number;
};

const fmtMoney = (n: number) =>
  n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(2)}M` :
  n >= 1_000     ? `$${(n / 1_000).toFixed(1)}K` :
                   `$${Number(n).toLocaleString()}`;

/**
 * PL-023: Recent Activations leaderboard. Surfaces every agent who hit
 * their first deal this month (or last month), ranked by ALP posted
 * inside the 30-day window after activation. Replaces the
 * empty/redundant "last 8 deals" second stat with something that
 * directly answers "are new agents activating into real production?"
 */
export function RecentActivationsPanel() {
  const { data, isLoading } = useQuery({
    queryKey: ["v_recent_activations_alp"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_recent_activations_alp" as any)
        .select("*")
        .limit(20);
      if (error) throw error;
      return (data as unknown as Row[]) ?? [];
    },
    refetchInterval: 5 * 60_000,
  });

  return (
    <Card className="rounded-lg border-amber-500/20 bg-white dark:bg-card">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Rocket className="h-4 w-4 text-amber-400" />
          Recent activations · avg first-30d ALP
        </CardTitle>
        <p className="text-xs text-muted-foreground mt-1">
          Agents whose first posted deal lands inside this month or last month,
          ranked by ALP posted within 30 days of activation.
          Source: <code className="font-mono">v_recent_activations_alp</code>
        </p>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : !data || data.length === 0 ? (
          <p className="text-sm text-muted-foreground italic p-3 border border-dashed border-white/10 rounded-md">
            No activations in the last two months. New-hire pipeline is dry — first $10K rep is the next move.
          </p>
        ) : (
          <ol className="space-y-1.5">
            {data.map((row, i) => (
              <li
                key={row.agent_id}
                className={cn(
                  "flex items-center gap-2 border rounded-md p-2 text-sm transition-colors",
                  i === 0 ? "border-amber-400/40 bg-amber-500/5" : "border-white/5 bg-white/[0.02] hover:border-white/15",
                )}
              >
                <span className={cn(
                  "font-mono text-xs w-5 text-center",
                  i === 0 ? "text-amber-300 font-bold" : i < 3 ? "text-slate-600 dark:text-slate-300" : "text-slate-600 dark:text-slate-300",
                )}>
                  {i + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="truncate font-medium">{row.display_name}</div>
                  <div className="text-[10px] text-muted-foreground truncate">
                    Activated {formatDistanceToNowStrict(new Date(row.first_deal_at), { addSuffix: true })}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xs font-mono text-emerald-300">{fmtMoney(Number(row.first_30d_alp))}</div>
                  <div className="text-[10px] text-muted-foreground">{row.first_30d_deals} deal{row.first_30d_deals === 1 ? "" : "s"}</div>
                </div>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
