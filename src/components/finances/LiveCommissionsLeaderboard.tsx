import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Trophy, Medal, Award } from "lucide-react";
import { cn } from "@/lib/utils";
import { useState } from "react";

type Period = "today" | "mtd" | "ytd";

const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n || 0);

interface Row {
  agent_id: string;
  agent_name: string;
  amount: number;
  direct: number;
  override: number;
  isYou: boolean;
}

export function LiveCommissionsLeaderboard() {
  const { user } = useAuth();
  const [period, setPeriod] = useState<Period>("mtd");

  const { data, isLoading } = useQuery({
    queryKey: ["insuracloud", "leaderboard", period, user?.id],
    queryFn: async () => {
      // Get latest snapshot per agent
      const cutoff = new Date(Date.now() - 1000 * 60 * 60 * 48).toISOString().slice(0, 10);
      const { data: snaps, error } = await supabase
        .from("insuracloud_snapshots")
        .select("agent_id, today_earnings, mtd_earnings, ytd_earnings, direct_commissions, override_commissions, snapshot_date")
        .gte("snapshot_date", cutoff)
        .not("agent_id", "is", null)
        .order("snapshot_date", { ascending: false });
      if (error) throw error;

      // Dedupe to latest per agent
      const seen = new Map<string, any>();
      for (const r of snaps ?? []) {
        if (!seen.has(r.agent_id!)) seen.set(r.agent_id!, r);
      }
      const agentIds = [...seen.keys()];
      if (agentIds.length === 0) return [] as Row[];

      // Look up agent display names + user_id (to flag "YOU")
      const { data: agents } = await supabase
        .from("agents")
        .select("id, user_id, display_name, profiles:profile_id(full_name)")
        .in("id", agentIds);

      const nameMap = new Map<string, { name: string; userId: string | null }>();
      for (const a of (agents ?? []) as any[]) {
        nameMap.set(a.id, {
          name: a.display_name ?? a.profiles?.full_name ?? "—",
          userId: a.user_id ?? null,
        });
      }

      const rows: Row[] = [...seen.values()].map((s: any) => {
        const meta = nameMap.get(s.agent_id) ?? { name: "—", userId: null };
        const amount =
          period === "today"
            ? Number(s.today_earnings ?? 0)
            : period === "mtd"
              ? Number(s.mtd_earnings ?? 0)
              : Number(s.ytd_earnings ?? 0);
        return {
          agent_id: s.agent_id,
          agent_name: meta.name,
          amount,
          direct: Number(s.direct_commissions ?? 0),
          override: Number(s.override_commissions ?? 0),
          isYou: !!user?.id && meta.userId === user.id,
        };
      });

      rows.sort((a, b) => b.amount - a.amount);
      return rows;
    },
    staleTime: 30_000,
  });

  const rows = data ?? [];
  const totalLive = useMemo(() => rows.reduce((s, r) => s + r.amount, 0), [rows]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Tabs value={period} onValueChange={(v) => setPeriod(v as Period)}>
          <TabsList className="h-8">
            <TabsTrigger value="today" className="text-xs px-3">Today</TabsTrigger>
            <TabsTrigger value="mtd" className="text-xs px-3">MTD</TabsTrigger>
            <TabsTrigger value="ytd" className="text-xs px-3">YTD</TabsTrigger>
          </TabsList>
        </Tabs>
        <Badge variant="outline" className="text-[10px]">
          {rows.length} synced · {fmt(totalLive)}
        </Badge>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-14 bg-muted animate-pulse rounded-lg" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-amber-600 dark:text-amber-400">
          No commissions data synced yet. Use <span className="font-semibold">Sync All</span> on the
          Team Commissions card above.
        </div>
      ) : (
        <div className="space-y-2 overflow-y-auto scrollbar-custom max-h-[60vh]">
          {rows.map((r, i) => {
            const isPodium = i < 3;
            return (
              <div
                key={r.agent_id}
                className={cn(
                  "flex items-center gap-3 p-3 rounded-lg border border-transparent transition-all",
                  r.isYou
                    ? "bg-primary/10 ring-2 ring-primary/40"
                    : i === 0
                      ? "bg-amber-500/10 border-amber-500/30"
                      : i === 1
                        ? "bg-gray-300/10 border-gray-300/30"
                        : i === 2
                          ? "bg-amber-700/10 border-amber-700/30"
                          : "bg-muted/30 hover:bg-muted/50"
                )}
              >
                <div
                  className={cn(
                    "w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold shrink-0",
                    i === 0 && "bg-amber-500 text-black",
                    i === 1 && "bg-gray-300 text-black",
                    i === 2 && "bg-amber-700 text-white",
                    i > 2 && "bg-muted text-muted-foreground"
                  )}
                >
                  {isPodium ? (
                    i === 0 ? <Trophy className="h-4 w-4" /> : i === 1 ? <Medal className="h-4 w-4" /> : <Award className="h-4 w-4" />
                  ) : (
                    i + 1
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium truncate">{r.agent_name}</span>
                    {r.isYou && (
                      <Badge className="text-[10px] bg-primary text-primary-foreground">YOU</Badge>
                    )}
                  </div>
                  <div className="text-[11px] text-muted-foreground tabular-nums">
                    Direct {fmt(r.direct)} · Override {fmt(r.override)}
                  </div>
                </div>

                <div className="text-right shrink-0">
                  <div className="font-bold text-base tabular-nums">{fmt(r.amount)}</div>
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    {period}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
