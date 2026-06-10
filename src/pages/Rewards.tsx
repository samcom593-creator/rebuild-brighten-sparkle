import { useEffect, useState } from "react";
import { Award, Crown, Medal, Sparkles, Loader2, Calendar } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { GlassCard } from "@/components/ui/glass-card";
import { PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type Reward = {
  id: string;
  agent_id: string;
  period: "daily" | "weekly" | "monthly";
  period_key: string;
  rank: number;
  title: string;
  description: string | null;
  alp: number | null;
  deals: number | null;
  awarded_at: string;
  agent_name: string | null;
  avatar_url: string | null;
};

const PERIOD_ORDER: Record<string, number> = { monthly: 0, weekly: 1, daily: 2 };

export default function Rewards() {
  const { isAdmin } = useAuth();
  const [rewards, setRewards] = useState<Reward[]>([]);
  const [loading, setLoading] = useState(true);
  const [scope, setScope] = useState<"mine" | "all">(isAdmin ? "all" : "mine");

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const { data } = await supabase
          .from("agentlink_rewards" as any)
          .select("*")
          .order("awarded_at", { ascending: false })
          .limit(100);
        if (!data) { setRewards([]); return; }

        const ids = (data as any[]).map(r => r.agent_id);
        const { data: agents } = await supabase
          .from("agents")
          .select("id, profile:profiles(full_name, avatar_url)")
          .in("id", ids);
        const byId = new Map((agents ?? []).map((a: any) => [a.id, a.profile]));

        setRewards((data as any[]).map(r => ({
          ...r,
          alp: r.alp ? Number(r.alp) : null,
          agent_name: (byId.get(r.agent_id) as any)?.full_name ?? null,
          avatar_url:  (byId.get(r.agent_id) as any)?.avatar_url ?? null,
        })));
      } finally { setLoading(false); }
    })();
  }, [scope]);

  const grouped = rewards.reduce<Record<string, Reward[]>>((acc, r) => {
    const key = `${r.period}-${r.period_key}`;
    (acc[key] ||= []).push(r);
    return acc;
  }, {});
  const groupKeys = Object.keys(grouped).sort((a, b) => {
    const pa = PERIOD_ORDER[a.split("-")[0]] ?? 9;
    const pb = PERIOD_ORDER[b.split("-")[0]] ?? 9;
    if (pa !== pb) return pa - pb;
    return b.localeCompare(a);
  });

  const rankIcon = (rank: number) => rank === 1 ? Crown : rank <= 3 ? Medal : Award;
  const rankColor = (rank: number) =>
    rank === 1 ? "text-amber-400" : rank === 2 ? "text-slate-600 dark:text-slate-300" : rank === 3 ? "text-orange-400" : "text-muted-foreground";
  const periodLabel = (p: string) => p === "monthly" ? "Monthly" : p === "weekly" ? "Weekly" : "Daily";

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-4">
      <PageHeader
        accent="purple"
        eyebrow="Production · Rewards"
        eyebrowIcon={<Sparkles className="h-3 w-3" />}
        title="Awards & Rewards"
        subtitle="Auto-issued to top producers every night at 3:05 UTC from live AgentLink data."
      />

      {loading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading…
        </div>
      ) : rewards.length === 0 ? (
        <GlassCard className="p-12 text-center text-muted-foreground">
          No rewards issued yet. The nightly top-producers cron will populate this.
        </GlassCard>
      ) : (
        <div className="space-y-6">
          {groupKeys.map(key => {
            const list = grouped[key];
            const first = list[0];
            return (
              <div key={key} className="space-y-2">
                <div className="flex items-center gap-2 text-sm">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  <span className="font-semibold">{periodLabel(first.period)}</span>
                  <Badge variant="outline" className="font-mono text-[10px]">{first.period_key}</Badge>
                  <span className="text-xs text-muted-foreground">{list.length} reward{list.length === 1 ? "" : "s"}</span>
                </div>
                <GlassCard className="p-0 overflow-hidden">
                  <div className="divide-y divide-border/30">
                    {list.sort((a, b) => a.rank - b.rank).map(r => {
                      const Icon = rankIcon(r.rank);
                      return (
                        <div key={r.id}
                          className={cn(
                            "flex items-center gap-3 px-4 py-3",
                            r.rank === 1 && "bg-white dark:bg-slate-900",
                          )}>
                          <Icon className={cn("h-5 w-5", rankColor(r.rank))} />
                          {r.avatar_url
                            ? <img src={r.avatar_url} alt="" className="h-9 w-9 rounded-full" />
                            : <div className="h-9 w-9 rounded-full bg-muted/50 flex items-center justify-center text-xs font-semibold">
                                {(r.agent_name ?? "?").split(" ").map(n => n[0]).slice(0,2).join("")}
                              </div>}
                          <div className="flex-1 min-w-0">
                            <div className="font-semibold truncate">{r.agent_name ?? "Unknown"}</div>
                            <div className="text-xs text-muted-foreground truncate">{r.title} · {r.description}</div>
                          </div>
                          <div className="text-right">
                            {r.alp != null && <div className="font-bold text-emerald-400 tabular-nums">${r.alp.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</div>}
                            <div className="text-xs text-muted-foreground">{new Date(r.awarded_at).toLocaleDateString()}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </GlassCard>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
