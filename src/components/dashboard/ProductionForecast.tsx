import { TrendingUp } from "lucide-react";
import { GlassCard } from "@/components/ui/glass-card";
import { useProducerProductionMetrics } from "@/hooks/useProducerProductionMetrics";
import { productionRunRate } from "@/lib/productionRunRate";

const money = (amount: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(amount);

export function ProductionForecast({ agentId }: { agentId: string }) {
  const query = useProducerProductionMetrics(agentId);
  const data = query.data;
  const runRate = data ? productionRunRate({ mtd_ap: data.mtd_ap, completed_ap: data.completed_ap, completed_active_days: data.completed_active_days }, data.completed_calendar_days, data.days_in_month) : null;
  return (
    <GlassCard className="p-4">
      <h4 className="mb-3 flex items-center gap-2 text-sm font-semibold"><TrendingUp className="h-4 w-4 text-primary" />Personal posted ALP · month run rate</h4>
      {query.isLoading ? <p className="text-sm text-muted-foreground">Loading verified production…</p> : !data ? <p className="text-sm text-muted-foreground">Production could not be verified. Run rate unavailable.</p> : <>
        {query.isError && <p role="status" className="mb-3 text-xs text-destructive">Latest refresh failed. Showing the last verified read.</p>}
        <div className="grid grid-cols-3 gap-3">
          <div><p className="text-xs text-muted-foreground">Posted this month</p><p className="mt-1 text-lg font-bold tabular-nums">{money(data.mtd_ap)}</p></div>
          <div><p className="text-xs text-muted-foreground">Completed sale days</p><p className="mt-1 text-lg font-bold tabular-nums">{data.completed_active_days}</p></div>
          <div><p className="text-xs text-muted-foreground">Month run rate</p><p className="mt-1 text-lg font-bold tabular-nums">{runRate?.amount == null ? "Unavailable" : money(runRate.amount)}</p></div>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">{runRate?.reason ?? `${money(data.completed_ap)} posted through yesterday ÷ ${data.completed_calendar_days} completed Phoenix days × ${data.days_in_month} days in the month; at least current MTD.`}</p>
        <p className="mt-2 text-xs text-muted-foreground">{data.mtd_policies} posted policies through {data.as_of}. Arithmetic estimate only; it does not predict issued, paid or commission cash.</p>
      </>}
    </GlassCard>
  );
}
