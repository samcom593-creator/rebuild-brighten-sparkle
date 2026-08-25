import { useQuery } from "@tanstack/react-query";
import { Activity, DollarSign, RefreshCw, TrendingUp, Users, Wallet } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n || 0);

interface FinanceSummary {
  kpis: { today: number; mtd: number; ytd: number; forecast_90d: number };
  team_kpis: { today: number; mtd: number; ytd: number };
  production: { policies: number; producers: number; last_synced_at: string | null };
}

export function TeamCommissionsCard() {
  const query = useQuery({
    queryKey: ["finance-truth", "team-card"],
    staleTime: 120_000,
    refetchInterval: 300_000,
    queryFn: async () => {
      const month = new Date().toISOString().slice(0, 7) + "-01";
      const { data, error } = await supabase.rpc("finances_overview" as never, {
        p_scope: "agency",
        p_month: month,
      } as never);
      if (error) throw error;
      return data as unknown as FinanceSummary;
    },
  });

  const data = query.data;

  return (
    <Card className="border-border/60 bg-white dark:bg-card">
      <CardContent className="p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <div className="rounded-lg bg-primary/15 p-2">
              <Activity className="h-4 w-4 text-primary" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-semibold">My agency earnings</h3>
                <Badge className="text-[10px] uppercase tracking-wide" variant="outline">Unified ledger · Live</Badge>
              </div>
              <p className="text-[11px] text-muted-foreground">Direct plus comp-spread overrides from valid posted production</p>
            </div>
          </div>
          <Button aria-label="Refresh agency earnings" className="h-8 w-8 p-0" disabled={query.isFetching} onClick={() => void query.refetch()} size="sm" variant="outline">
            <RefreshCw className={query.isFetching ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} />
          </Button>
        </div>

        {query.isError ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
            Finance truth could not load. No zero total was substituted.
          </div>
        ) : !data ? (
          <div className="h-24 animate-pulse rounded-lg bg-muted" />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
              <Stat icon={DollarSign} label="Today" value={fmt(data.kpis.today)} />
              <Stat accent icon={Wallet} label="MTD" value={fmt(data.kpis.mtd)} />
              <Stat icon={TrendingUp} label="YTD" value={fmt(data.kpis.ytd)} />
              <Stat icon={TrendingUp} label="90-day production" value={fmt(data.kpis.forecast_90d)} />
              <Stat icon={Users} label="Unified policies" muted value={data.production.policies.toLocaleString()} />
            </div>
            <p className="mt-3 text-[11px] text-muted-foreground">
              Team gross MTD: <span className="font-semibold tabular-nums text-foreground">{fmt(data.team_kpis.mtd)}</span> · {data.production.producers.toLocaleString()} producers
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  accent,
  muted,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  accent?: boolean;
  muted?: boolean;
}) {
  return (
    <div className={accent ? "rounded-lg bg-primary/10 p-3 ring-1 ring-primary/30" : muted ? "rounded-lg bg-muted/20 p-3" : "rounded-lg bg-muted/30 p-3"}>
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
        <Icon className="h-3 w-3" /> {label}
      </div>
      <div className="mt-1 text-lg font-bold tabular-nums">{value}</div>
    </div>
  );
}
