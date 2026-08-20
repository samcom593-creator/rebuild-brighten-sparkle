import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/glass-card";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { isAgentLinkSyncStale, shouldAutoRepairLeaderboards } from "@/lib/metricTruth";
import { getBusinessDayBounds } from "@/lib/dateUtils";

interface DataFreshnessBannerProps {
  className?: string;
  autoRepair?: boolean;
}

export function DataFreshnessBanner({ className, autoRepair = false }: DataFreshnessBannerProps) {
  const { isAdmin } = useAuth();
  const attemptedRepairRef = useRef(false);

  const { data, isFetching, refetch } = useQuery({
    queryKey: ["agentlink-freshness-banner"],
    queryFn: async () => {
      const todayBounds = getBusinessDayBounds();
      const [{ data: syncRow }, { data: todayDeals }] = await Promise.all([
        supabase
          .from("agentlink_sync_log" as any)
          .select("started_at, finished_at, status")
          .eq("status", "ok")
          .order("started_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from("deals")
          .select("id", { count: "exact", head: true })
          .gte("posted_at", todayBounds.startIso)
          .lt("posted_at", todayBounds.endIso),
      ]);

      return {
        lastSuccessAt: (syncRow as { finished_at?: string | null; started_at?: string | null } | null)?.finished_at
          || (syncRow as { started_at?: string | null } | null)?.started_at
          || null,
        todayDealsCount: todayDeals.count || 0,
      };
    },
    staleTime: 60_000,
    refetchInterval: 300_000,
  });

  const stale = isAgentLinkSyncStale(data?.lastSuccessAt ?? null, 15);
  const shouldRepair = autoRepair && isAdmin && stale && shouldAutoRepairLeaderboards() && (data?.todayDealsCount ?? 0) === 0;

  useEffect(() => {
    if (!shouldRepair || attemptedRepairRef.current) return;
    attemptedRepairRef.current = true;
    (async () => {
      toast.info("Refreshing AgentLink deals for leaderboard accuracy...");
      const [syncResult, awardResult] = await Promise.all([
        supabase.rpc("agentlink_live_pull" as never),
        supabase.rpc("agentlink_award_top_producers" as never),
      ]);
      if (syncResult.error || awardResult.error) {
        toast.error(syncResult.error?.message || awardResult.error?.message || "Refresh failed");
        return;
      }
      toast.success("Leaderboard data refreshed from AgentLink");
      refetch();
    })();
  }, [shouldRepair, refetch]);

  if (!stale) return null;

  return (
    <GlassCard className={className}>
      <div className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between">
        <div className="flex items-start gap-3">
          <div className="rounded-full bg-amber-500/15 p-2">
            <AlertTriangle className="h-4 w-4 text-amber-400" />
          </div>
          <div>
            <p className="font-semibold text-foreground">Data is waiting on a fresher AgentLink sync.</p>
            <p className="text-sm text-muted-foreground">
              Dashboard and leaderboard totals are reading the deals truth layer, but the latest successful import is older than 15 minutes.
            </p>
          </div>
        </div>
        {isAdmin && (
          <Button
            variant="outline"
            size="sm"
            disabled={isFetching}
            onClick={async () => {
              toast.info("Refreshing AgentLink data...");
              const [syncResult, awardResult] = await Promise.all([
                supabase.rpc("agentlink_live_pull" as never),
                supabase.rpc("agentlink_award_top_producers" as never),
              ]);
              if (syncResult.error || awardResult.error) {
                toast.error(syncResult.error?.message || awardResult.error?.message || "Refresh failed");
                return;
              }
              toast.success("Fresh data pulled from AgentLink");
              refetch();
            }}
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh now
          </Button>
        )}
      </div>
    </GlassCard>
  );
}
