import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useInsuraCloud } from "@/hooks/useInsuraCloud";
import { DollarSign, RefreshCw, TrendingUp } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n || 0);

export function RealFinancesCard({ agentId }: { agentId?: string | null }) {
  const { snapshot, sync } = useInsuraCloud(agentId);
  const [syncing, setSyncing] = useState(false);
  const data = snapshot.data;

  const onSync = async () => {
    setSyncing(true);
    const res = await sync({ agentId: agentId ?? undefined });
    setSyncing(false);
    if (res.error) toast.error(`Sync failed: ${res.error.message}`);
    else {
      toast.success("InsuraCloud synced");
      snapshot.refetch();
    }
  };

  return (
    <Card className="border-border/60">
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <div className="flex items-center gap-2">
          <DollarSign className="h-4 w-4 text-primary" />
          <CardTitle className="text-sm font-medium">Real Finances</CardTitle>
          <Badge variant="outline" className="text-[10px]">Live · InsuraCloud</Badge>
        </div>
        <Button size="sm" variant="ghost" onClick={onSync} disabled={syncing}>
          <RefreshCw className={`h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`} />
        </Button>
      </CardHeader>
      <CardContent>
        {!data ? (
          <div className="text-sm text-muted-foreground">No snapshot yet. Click sync to pull live data.</div>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            <Stat label="Today" value={fmt(Number(data.today_earnings))} />
            <Stat label="90-Day Forecast" value={fmt(Number(data.forecast_90_day))} icon />
            <Stat label="MTD" value={fmt(Number(data.mtd_earnings))} />
            <Stat label="YTD" value={fmt(Number(data.ytd_earnings))} />
            <Stat label="Direct" value={fmt(Number(data.direct_commissions))} />
            <Stat label="Override" value={fmt(Number(data.override_commissions))} />
          </div>
        )}
        {data?.snapshot_date && (
          <div className="mt-3 text-[10px] text-muted-foreground">
            Snapshot: {new Date(data.snapshot_date).toLocaleDateString()}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, icon }: { label: string; value: string; icon?: boolean }) {
  return (
    <div className="rounded-md bg-muted/30 p-3">
      <div className="flex items-center gap-1 text-[11px] uppercase tracking-wide text-muted-foreground">
        {icon && <TrendingUp className="h-3 w-3" />} {label}
      </div>
      <div className="mt-1 text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}
