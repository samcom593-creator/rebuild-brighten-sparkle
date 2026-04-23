/**
 * TopProducersTodayCard — replaces the generic "Recruiting Pipeline" tile.
 * Shows today's top 5 deal writers sorted by AOP, with avatars + deal count,
 * plus live Agent Link posted-today total. Auto-refreshes every 5 minutes.
 */

import { useEffect, useState } from "react";
import { Trophy, TrendingUp, Flame } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { GlassCard } from "@/components/ui/glass-card";
import { cn } from "@/lib/utils";

type Row = {
  agentId: string;
  name: string;
  avatar: string | null;
  aop: number;
  deals: number;
};

export function TopProducersTodayCard() {
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      // Deals posted today (America/Chicago) — same rule as the Weekly widget
      const now = new Date();
      const todayStart = new Date(now); todayStart.setHours(0,0,0,0);
      const { data } = await supabase
        .from("deals")
        .select(`annual_premium, agent_id, agents:agent_id(profile:profiles(full_name, avatar_url))`)
        .gte("posted_at", todayStart.toISOString());

      const map = new Map<string, Row>();
      let sum = 0;
      for (const r of (data ?? []) as any[]) {
        if (!r.agent_id) continue;
        const alp = Number(r.annual_premium || 0);
        sum += alp;
        const cur = map.get(r.agent_id) || {
          agentId: r.agent_id,
          name:   r.agents?.profile?.full_name ?? "Agent",
          avatar: r.agents?.profile?.avatar_url ?? null,
          aop: 0, deals: 0,
        };
        cur.aop += alp;
        cur.deals += 1;
        map.set(r.agent_id, cur);
      }
      if (!mounted) return;
      setTotal(sum);
      setRows([...map.values()].sort((a, b) => b.aop - a.aop).slice(0, 5));
      setLoading(false);
    };
    load();
    const t = setInterval(load, 5 * 60 * 1000); // 5 min
    return () => { mounted = false; clearInterval(t); };
  }, []);

  return (
    <GlassCard className="p-5 space-y-3 border-emerald-500/20">
      <div className="flex items-center gap-2 text-sm font-bold">
        <Trophy className="h-4 w-4 text-amber-400" />
        <span>Top Producers Today</span>
        <div className="flex-1" />
        <span className="text-xs text-muted-foreground tabular-nums">
          ${Math.round(total).toLocaleString()} total
        </span>
      </div>

      {loading ? (
        <div className="text-xs text-muted-foreground py-6 text-center">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="text-xs text-muted-foreground py-6 text-center">
          <Flame className="h-8 w-8 mx-auto mb-2 opacity-40" />
          No deals posted yet today. Who's going to be first?
        </div>
      ) : (
        <div className="space-y-1.5">
          {rows.map((r, i) => (
            <div key={r.agentId}
              className="flex items-center gap-3 py-1.5 px-2 rounded-md hover:bg-muted/30 transition-colors">
              <div className={cn(
                "w-5 text-center text-xs font-bold",
                i === 0 && "text-amber-400",
                i === 1 && "text-slate-300",
                i === 2 && "text-orange-400",
                i >= 3  && "text-muted-foreground"
              )}>
                #{i + 1}
              </div>
              {r.avatar
                ? <img src={r.avatar} alt="" className="h-7 w-7 rounded-full" />
                : <div className="h-7 w-7 rounded-full bg-muted/50 flex items-center justify-center text-[10px] font-semibold">
                    {r.name.split(" ").map(n => n[0]).slice(0,2).join("")}
                  </div>}
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{r.name}</div>
                <div className="text-[10px] text-muted-foreground">{r.deals} deal{r.deals === 1 ? "" : "s"}</div>
              </div>
              <div className="text-right font-bold tabular-nums text-emerald-400 text-sm">
                ${Math.round(r.aop).toLocaleString()}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center gap-1 text-[10px] text-muted-foreground pt-1 border-t border-border/30">
        <TrendingUp className="h-3 w-3" />
        Live from Agent Link · refreshes every 5 min
      </div>
    </GlassCard>
  );
}
