import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Trophy, Medal, Award } from "lucide-react";
import { cn } from "@/lib/utils";
import { useState } from "react";
import { scoreboardWindow } from "@/lib/scoreboardPeriod";

type Period = "today" | "mtd" | "ytd";

const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n || 0);

interface Row {
  agent_id: string;
  agent_name: string;
  amount: number;
  isYou: boolean;
}

export function LiveCommissionsLeaderboard() {
  const { user } = useAuth();
  const [period, setPeriod] = useState<Period>("mtd");

  const { data, isLoading } = useQuery({
    queryKey: ["finance-truth", "leaderboard", period, user?.id],
    queryFn: async () => {
      const through = new Date().toLocaleDateString("en-CA", { timeZone: "America/Phoenix" });
      const window = scoreboardWindow(period === "today" ? "day" : period === "mtd" ? "month" : "year", through);
      const { data: board, error } = await supabase.rpc("leaderboard_board" as never, {
        p_start: window.start,
        p_end: window.end,
      } as never);
      if (error) throw error;

      const { data: mine } = await supabase
        .from("agents")
        .select("id")
        .eq("user_id", user?.id ?? "00000000-0000-0000-0000-000000000000");
      const myIds = new Set((mine ?? []).map((agent) => agent.id));

      const rows: Row[] = ((board ?? []) as Array<Record<string, unknown>>).map((item) => {
        const agentId = String(item.agent_id ?? item.agent_key ?? "unmapped");
        const amount = Number(item.est_earnings ?? 0);
        return {
          agent_id: agentId,
          agent_name: String(item.agent_name ?? "Unmapped producer"),
          amount,
          isYou: myIds.has(agentId),
        };
      });

      rows.sort((a, b) => b.amount - a.amount);
      return rows;
    },
    staleTime: 30_000,
  });

  const rows = useMemo(() => data ?? [], [data]);
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
          {rows.length} producers · {fmt(totalLive)} estimated
        </Badge>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => (
            // stable-key-allow:skeleton
            <div key={i} className="h-14 bg-muted animate-pulse rounded-lg" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-amber-600 dark:text-amber-400">
          No valid posted production exists in this period.
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
                    Unified production estimate
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
