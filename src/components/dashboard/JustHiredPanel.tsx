import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { UserPlus, Crown } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";
import { useRealtimeTable } from "@/shared/realtime/useRealtimeTable";

type HireRow = {
  id: string;
  display_name: string | null;
  start_date: string | null;
  routed_to: string;
  created_at: string;
};

/**
 * JustHiredPanel — last-30d hires with routed-to manager, including direct-to-Sam.
 * Replaces the prior "Recent Hires" widget that didn't surface direct-to-Sam.
 * Read v_recent_hires-style query via direct table join. Real data only.
 */
export function JustHiredPanel() {
  const { data: hires, isLoading, refetch } = useQuery({
    queryKey: ["just_hired_30d"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("get_just_hired_30d");
      if (error || !data) {
        // Fallback: direct query if RPC missing
        // 2026-08-19: the old fallback embedded agents!agents_invited_by_manager_id_fkey,
        // which PostgREST rejects with PGRST200 on this self-referencing fk (the
        // constraint-name hint resolves the WRONG direction on self-joins; the
        // column hint returns children, not the inviting manager). Verified live
        // as Sam: HTTP 400 — so this fallback threw and the panel showed the
        // empty state whenever the RPC was unavailable. Two plain queries are
        // boring and unambiguous.
        const fallback = await supabase
          .from("agents")
          .select("id, display_name, start_date, created_at, invited_by_manager_id")
          .gte("created_at", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
          .eq("is_deactivated", false)
          .order("created_at", { ascending: false })
          .limit(15);
        if (fallback.error) throw fallback.error;
        const rows = fallback.data ?? [];
        const mgrIds = Array.from(new Set(rows.map((r: any) => r.invited_by_manager_id).filter(Boolean)));
        const mgrName = new Map<string, string>();
        if (mgrIds.length) {
          const mgrs = await supabase.from("agents").select("id, display_name").in("id", mgrIds);
          for (const m of mgrs.data ?? []) mgrName.set((m as any).id, (m as any).display_name);
        }
        return rows.map((r: any) => ({
          id: r.id,
          display_name: r.display_name,
          start_date: r.start_date,
          routed_to: mgrName.get(r.invited_by_manager_id) ?? "(direct to Sam)",
          created_at: r.created_at,
        })) as HireRow[];
      }
      return data as HireRow[];
    },
    // Keep the list fresh even if Realtime reconnects slowly on a phone.
    refetchInterval: 30_000,
  });

  useRealtimeTable({ table: "agents", channelSuffix: "just-hired" }, () => {
    void refetch();
  });

  const directToSamCount = (hires ?? []).filter(h => h.routed_to === "(direct to Sam)" || h.routed_to === "Samuel James").length;

  return (
    <Card className="ops-card-depth border-amber-500/20">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between gap-3 text-base">
          <span className="flex items-center gap-2">
            <UserPlus className="h-4 w-4 text-amber-300" />
            Just hired · last 30 days
          </span>
          {directToSamCount > 0 && (
            <Badge variant="outline" className="text-amber-300 border-amber-500/40 text-xs">
              <Crown className="h-3 w-3 mr-1" /> {directToSamCount} direct to Sam
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : !hires?.length ? (
          <div className="text-xs text-muted-foreground italic p-3 border border-dashed border-white/10 rounded-md">
            No hires in last 30 days. Source: agents table where created_at &gt; now() - 30d.
          </div>
        ) : (
          <ul className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
            {hires.slice(0, 9).map((h) => {
              const isDirect = h.routed_to === "(direct to Sam)" || h.routed_to === "Samuel James";
              return (
                <li key={h.id} className={cn(
                  "border rounded-md text-sm transition-colors",
                  isDirect ? "border-amber-500/30 bg-amber-500/[0.04]" : "border-white/5 bg-white/[0.02]"
                )}>
                  <Link
                    to={`/dashboard/profile?agentId=${h.id}`}
                    className="block rounded-md p-2.5 hover:bg-white/[0.04] focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)]"
                    aria-label={`Open ${h.display_name ?? "new hire"} profile`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium truncate">{h.display_name ?? "(unnamed agent)"}</span>
                      {isDirect && <Crown className="h-3 w-3 text-amber-300 flex-shrink-0" />}
                    </div>
                    <div className="text-[10px] text-muted-foreground mt-0.5 flex items-center justify-between">
                      <span>→ {h.routed_to}</span>
                      <span>{formatDistanceToNow(new Date(h.created_at), { addSuffix: true })}</span>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
