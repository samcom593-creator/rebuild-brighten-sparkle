import { useEffect, useState } from "react";
import { Trophy, Crown, Medal, TrendingUp, Calendar, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

type Period = "daily" | "weekly" | "monthly";
type Row = {
  rank: number;
  agent_id: string;
  deals: number;
  alp: number;
  mp: number;
  agent_name: string | null;
  avatar_url: string | null;
};

const RANK_ICONS: Record<number, { icon: any; color: string }> = {
  1: { icon: Crown,  color: "text-amber-400" },
  2: { icon: Medal,  color: "text-slate-300" },
  3: { icon: Medal,  color: "text-orange-400" },
};

export default function Leaderboard() {
  const [period, setPeriod] = useState<Period>("monthly");
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [snapshotDate, setSnapshotDate] = useState<string>("");

  const load = async (p: Period) => {
    setLoading(true);
    try {
      const { data: latest } = await supabase
        .from("leaderboard_snapshots" as any)
        .select("snapshot_date")
        .eq("period", p)
        .order("snapshot_date", { ascending: false })
        .limit(1);
      const date = (latest as any)?.[0]?.snapshot_date;
      if (!date) { setRows([]); return; }
      setSnapshotDate(date);

      const { data } = await supabase
        .from("leaderboard_snapshots" as any)
        .select("rank, agent_id, deals, alp, mp")
        .eq("period", p)
        .eq("snapshot_date", date)
        .order("rank");
      if (!data) { setRows([]); return; }

      const ids = (data as any[]).map(r => r.agent_id);
      const { data: agents } = await supabase
        .from("agents")
        .select("id, profile:profiles(full_name, avatar_url)")
        .in("id", ids);
      const byId = new Map((agents ?? []).map((a: any) => [a.id, a.profile]));

      setRows((data as any[]).map(r => ({
        rank: r.rank,
        agent_id: r.agent_id,
        deals: r.deals,
        alp: Number(r.alp),
        mp: Number(r.mp),
        agent_name: (byId.get(r.agent_id) as any)?.full_name ?? null,
        avatar_url:  (byId.get(r.agent_id) as any)?.avatar_url ?? null,
      })));
    } finally { setLoading(false); }
  };
  useEffect(() => { load(period); }, [period]);

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-4">
      <div className="flex items-center gap-3">
        <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-amber-500/30 to-yellow-500/20 flex items-center justify-center">
          <Trophy className="h-6 w-6 text-amber-300" />
        </div>
        <div className="flex-1">
          <h1 className="apex-headline text-3xl font-bold">Leaderboard</h1>
          <p className="text-sm text-muted-foreground">
            Live rankings from Agent Link — refreshed nightly. Top producers earn badges automatically.
          </p>
        </div>
        {snapshotDate && <Badge variant="outline" className="gap-1.5"><Calendar className="h-3 w-3" />{new Date(snapshotDate).toLocaleDateString()}</Badge>}
      </div>

      <Tabs value={period} onValueChange={v => setPeriod(v as Period)}>
        <TabsList className="grid grid-cols-3 w-full md:w-auto">
          <TabsTrigger value="daily">Daily</TabsTrigger>
          <TabsTrigger value="weekly">Weekly</TabsTrigger>
          <TabsTrigger value="monthly">Monthly</TabsTrigger>
        </TabsList>

        {(["daily","weekly","monthly"] as Period[]).map(p => (
          <TabsContent key={p} value={p} className="mt-4">
            {loading ? (
              <div className="flex items-center justify-center py-12 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading…
              </div>
            ) : rows.length === 0 ? (
              <GlassCard className="p-12 text-center text-muted-foreground">
                No {p} leaderboard data yet. Wait for the nightly top-producers cron (03:05 UTC) to fire.
              </GlassCard>
            ) : (
              <GlassCard className="p-0 overflow-hidden">
                <div className="divide-y divide-border/40">
                  {rows.map(r => {
                    const RankIcon = RANK_ICONS[r.rank]?.icon ?? TrendingUp;
                    const rankColor = RANK_ICONS[r.rank]?.color ?? "text-muted-foreground";
                    const highlight = r.rank <= 3;
                    return (
                      <div key={r.rank}
                        className={cn(
                          "flex items-center gap-3 px-4 py-3 transition-all",
                          highlight && "bg-gradient-to-r from-amber-500/10 to-transparent"
                        )}>
                        <div className={cn("w-10 text-center font-bold text-lg", rankColor)}>
                          #{r.rank}
                        </div>
                        <RankIcon className={cn("h-5 w-5", rankColor)} />
                        {r.avatar_url
                          ? <img src={r.avatar_url} alt="" className="h-9 w-9 rounded-full ring-2 ring-border/40" />
                          : <div className="h-9 w-9 rounded-full bg-muted/50 flex items-center justify-center text-xs font-semibold">
                              {(r.agent_name ?? "?").split(" ").map(n => n[0]).slice(0,2).join("")}
                            </div>}
                        <div className="flex-1 min-w-0">
                          <div className="font-semibold truncate">{r.agent_name ?? "Unknown agent"}</div>
                          <div className="text-xs text-muted-foreground">{r.deals} deal{r.deals === 1 ? "" : "s"}</div>
                        </div>
                        <div className="text-right">
                          <div className="font-bold tabular-nums text-emerald-400">${r.alp.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                          <div className="text-xs text-muted-foreground tabular-nums">${r.mp.toLocaleString(undefined, { minimumFractionDigits: 2 })}/mo</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </GlassCard>
            )}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
