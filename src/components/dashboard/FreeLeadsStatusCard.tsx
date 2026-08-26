import { useQuery } from "@tanstack/react-query";
import { Lock, Zap } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";

export type FreeLeadsStatus = {
  qualifies: boolean;
  reason: string;
  l30_alp: number | string;
  tenure_days: number;
  days_left_in_ramp: number;
  needed_for_qual: number | string;
  qualifying_threshold: number | string;
  ramp_days: number;
};

const money = (value: number | string | null | undefined) =>
  Number(value ?? 0).toLocaleString("en-US", { maximumFractionDigits: 0 });

export function FreeLeadsStatusCard({ agentId }: { agentId: string }) {
  const { data: status, isLoading } = useQuery({
    queryKey: ["agent-free-leads-status", agentId],
    enabled: Boolean(agentId),
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_agent_free_leads_status" as never, {
        p_agent_id: agentId,
      } as never);
      if (error) throw error;
      return data as unknown as FreeLeadsStatus;
    },
  });

  if (isLoading) return <div className="h-28 animate-pulse rounded-xl bg-muted/30" />;
  if (!status?.reason) return null;

  const threshold = Math.max(1, Number(status.qualifying_threshold ?? 20_000));
  const alp = Math.max(0, Number(status.l30_alp ?? 0));
  const progress = Math.min(100, Math.round((alp / threshold) * 100));

  return (
    <Card className={status.qualifies ? "border-sky-500/50 bg-sky-500/5" : "border-border bg-card"}>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-2.5">
            <div className={status.qualifies ? "rounded-lg bg-sky-500/20 p-2 text-sky-400" : "rounded-lg bg-muted p-2 text-muted-foreground"}>
              {status.qualifies ? <Zap className="h-5 w-5 fill-current" /> : <Lock className="h-5 w-5" />}
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-bold text-foreground">Free Leads</h3>
                <Badge variant="outline" className={status.qualifies
                  ? "border-sky-500/50 bg-sky-500/10 text-sky-400"
                  : "border-amber-500/30 bg-amber-500/10 text-amber-400"}>
                  {status.qualifies ? "Active" : "Locked"}
                </Badge>
              </div>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{status.reason}</p>
            </div>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-lg font-bold tabular-nums text-foreground">${money(alp)}</p>
            <p className="text-[10px] text-muted-foreground">Trailing 30d ALP</p>
          </div>
        </div>

        {!status.qualifies && (
          <div className="border-t border-border/60 pt-3">
            <div className="mb-1.5 flex justify-between text-xs">
              <span className="text-muted-foreground">Progress to ${money(threshold)}</span>
              <span className="font-bold tabular-nums text-foreground">{progress}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-sky-500 transition-all" style={{ width: `${progress}%` }} />
            </div>
            <p className="mt-1.5 text-[11px] text-sky-400">
              Write ${money(status.needed_for_qual)} more in ALP to unlock weekly lead drops.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
