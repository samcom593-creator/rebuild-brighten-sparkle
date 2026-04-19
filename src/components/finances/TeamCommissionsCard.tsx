import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { safeInvoke } from "@/shared/api/safeInvoke";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DollarSign, RefreshCw, TrendingUp, Users, Wallet, Activity } from "lucide-react";
import { toast } from "sonner";

const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n || 0);

interface SnapshotRow {
  agent_id: string | null;
  today_earnings: number | null;
  mtd_earnings: number | null;
  ytd_earnings: number | null;
  forecast_90_day: number | null;
  direct_commissions: number | null;
  override_commissions: number | null;
  snapshot_date: string;
}

export function TeamCommissionsCard() {
  const [syncing, setSyncing] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["insuracloud", "team-snapshots-latest"],
    queryFn: async () => {
      // Pull all snapshots from the last 2 days, then dedupe to most recent per agent
      const cutoff = new Date(Date.now() - 1000 * 60 * 60 * 48).toISOString().slice(0, 10);
      const { data, error } = await supabase
        .from("insuracloud_snapshots")
        .select("agent_id, today_earnings, mtd_earnings, ytd_earnings, forecast_90_day, direct_commissions, override_commissions, snapshot_date")
        .gte("snapshot_date", cutoff)
        .order("snapshot_date", { ascending: false });
      if (error) throw error;
      const seen = new Set<string>();
      const latest: SnapshotRow[] = [];
      for (const r of (data ?? []) as SnapshotRow[]) {
        const key = r.agent_id ?? "AGENCY";
        if (seen.has(key)) continue;
        seen.add(key);
        latest.push(r);
      }
      return latest;
    },
    staleTime: 30_000,
  });

  const totals = useMemo(() => {
    const rows = data ?? [];
    return rows.reduce(
      (acc, r) => {
        acc.today += Number(r.today_earnings ?? 0);
        acc.mtd += Number(r.mtd_earnings ?? 0);
        acc.ytd += Number(r.ytd_earnings ?? 0);
        acc.forecast += Number(r.forecast_90_day ?? 0);
        acc.direct += Number(r.direct_commissions ?? 0);
        acc.override += Number(r.override_commissions ?? 0);
        acc.agents += 1;
        return acc;
      },
      { today: 0, mtd: 0, ytd: 0, forecast: 0, direct: 0, override: 0, agents: 0 }
    );
  }, [data]);

  const onSyncAll = async () => {
    setSyncing(true);
    const res = await safeInvoke<{ ok: boolean; results?: any[] }>("insuracloud-sync", {});
    setSyncing(false);
    if (res.error) {
      toast.error(`Sync failed: ${res.error.message}`);
      return;
    }
    const n = res.data?.results?.length ?? 0;
    toast.success(`Synced ${n} agent${n === 1 ? "" : "s"}`);
    refetch();
  };

  const empty = !isLoading && totals.agents === 0;

  return (
    <Card className="border-border/60 bg-gradient-to-br from-primary/5 via-background to-background">
      <CardContent className="p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-primary/15">
              <Activity className="h-4 w-4 text-primary" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold">Team Commissions</h3>
                <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
                  InsuraCloud · Live
                </Badge>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Real-time totals pulled from carrier book of business
              </p>
            </div>
          </div>
          <Button size="sm" variant="outline" onClick={onSyncAll} disabled={syncing} className="gap-2">
            <RefreshCw className={`h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`} />
            Sync All
          </Button>
        </div>

        {empty ? (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 flex items-center justify-between">
            <div className="text-sm text-amber-600 dark:text-amber-400">
              No agents synced yet. Click <span className="font-semibold">Sync All</span> to pull live commission data.
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
            <Stat icon={DollarSign} label="Today" value={fmt(totals.today)} />
            <Stat icon={Wallet} label="MTD" value={fmt(totals.mtd)} accent />
            <Stat icon={TrendingUp} label="YTD" value={fmt(totals.ytd)} />
            <Stat icon={TrendingUp} label="90-Day Forecast" value={fmt(totals.forecast)} />
            <Stat icon={Users} label="Agents Synced" value={String(totals.agents)} muted />
          </div>
        )}

        {!empty && (totals.direct > 0 || totals.override > 0) && (
          <div className="mt-3 flex items-center gap-4 text-[11px] text-muted-foreground">
            <span>Direct: <span className="text-foreground font-medium tabular-nums">{fmt(totals.direct)}</span></span>
            <span>Override: <span className="text-foreground font-medium tabular-nums">{fmt(totals.override)}</span></span>
          </div>
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
    <div
      className={`rounded-lg p-3 ${
        accent ? "bg-primary/10 ring-1 ring-primary/30" : muted ? "bg-muted/20" : "bg-muted/30"
      }`}
    >
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
        <Icon className="h-3 w-3" /> {label}
      </div>
      <div className="mt-1 text-lg font-bold tabular-nums">{value}</div>
    </div>
  );
}
