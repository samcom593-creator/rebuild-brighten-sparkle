import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Users, Trophy, TrendingUp, ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";

type ManagerRow = {
  manager_id: string;
  manager_name: string;
  team_size: number;
  team_alp_mtd: number;
  team_deals_mtd: number;
  producing_team_mtd: number;
};

type ProducerRow = {
  agent_id: string;
  display_name: string;
  deals_mtd: number;
  alp_mtd: number;
  manager_name: string;
};

const fmtMoney = (n: number) =>
  n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(2)}M` :
  n >= 1_000     ? `$${(n / 1_000).toFixed(1)}K` :
                   `$${n.toLocaleString()}`;

/**
 * ManagerHierarchyMtdPanel — replaces the weak "Recent 8 deals" row on the
 * executive dashboard. Shows each manager's team size + MTD ALP + deal count
 * + producing-team-count + % of total agency production. Plus a top-10
 * producers leaderboard MTD.
 *
 * Real data via v_manager_hierarchy_mtd + v_top_producers_mtd. No fake numbers.
 */
export function ManagerHierarchyMtdPanel() {
  const { data: managers, isLoading: mgrLoading } = useQuery({
    queryKey: ["v_manager_hierarchy_mtd"],
    queryFn: async () => {
      const { data, error } = await supabase.from("v_manager_hierarchy_mtd").select("*");
      if (error) throw error;
      return data as ManagerRow[];
    },
    refetchInterval: 5 * 60_000,
  });

  const { data: producers, isLoading: prodLoading } = useQuery({
    queryKey: ["v_top_producers_mtd"],
    queryFn: async () => {
      const { data, error } = await supabase.from("v_top_producers_mtd").select("*").limit(10);
      if (error) throw error;
      return data as ProducerRow[];
    },
    refetchInterval: 5 * 60_000,
  });

  const totalAgencyAlp = (managers ?? []).reduce((s, m) => s + Number(m.team_alp_mtd ?? 0), 0);
  const totalAgencyDeals = (managers ?? []).reduce((s, m) => s + Number(m.team_deals_mtd ?? 0), 0);

  return (
    <Card className="ops-card-depth border-[#22d3a5]/20 bg-gradient-to-br from-[#22d3a5]/[0.04] via-card to-card">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="h-4 w-4 text-[#22d3a5]" />
            Manager hierarchy · MTD production
          </CardTitle>
          <Link to="/dashboard/admin/manager" className="text-xs inline-flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors">
            Manager command <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
        <div className="text-xs text-muted-foreground mt-1">
          Agency total: <span className="font-mono text-emerald-300">{fmtMoney(totalAgencyAlp)}</span> · <span className="font-mono">{totalAgencyDeals.toLocaleString()} deals</span> · live from <code>v_manager_hierarchy_mtd</code>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* MANAGER HIERARCHY */}
          <div>
            <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
              <TrendingUp className="h-3 w-3" /> Team production share
            </div>
            {mgrLoading ? (
              <Skeleton className="h-40 w-full" />
            ) : !managers?.length ? (
              <div className="text-xs text-muted-foreground italic p-3 border border-dashed border-white/10 rounded-md">
                No managers loaded (v_manager_hierarchy_mtd returned 0 rows). Check agents.invited_by_manager_id wiring.
              </div>
            ) : (
              <ul className="space-y-2">
                {managers.map((m) => {
                  const pct = totalAgencyAlp > 0 ? (Number(m.team_alp_mtd) / totalAgencyAlp) * 100 : 0;
                  return (
                    <li key={m.manager_id} className="border border-white/5 rounded-md bg-white/[0.02] p-2.5 hover:border-white/15 transition-colors">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-medium truncate flex-1">{m.manager_name}</span>
                        <span className="text-xs font-mono text-emerald-300 ml-2">{fmtMoney(Number(m.team_alp_mtd))}</span>
                      </div>
                      <div className="text-[10px] text-muted-foreground flex items-center justify-between">
                        <span>{m.team_size} team · {m.producing_team_mtd}/{m.team_size} producing · {m.team_deals_mtd} deals</span>
                        <span className="font-mono">{pct.toFixed(1)}%</span>
                      </div>
                      <div className="mt-1.5 h-1.5 bg-white/5 rounded-full overflow-hidden">
                        <div
                          className={cn("h-full transition-all", pct > 30 ? "bg-emerald-400" : pct > 10 ? "bg-amber-400" : "bg-slate-400")}
                          style={{ width: `${Math.min(pct, 100)}%` }}
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* TOP PRODUCERS */}
          <div>
            <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
              <Trophy className="h-3 w-3" /> Top producers MTD
            </div>
            {prodLoading ? (
              <Skeleton className="h-40 w-full" />
            ) : !producers?.length ? (
              <div className="text-xs text-muted-foreground italic p-3 border border-dashed border-white/10 rounded-md">
                No producers loaded (v_top_producers_mtd returned 0 rows).
              </div>
            ) : (
              <ol className="space-y-1.5">
                {producers.map((p, i) => (
                  <li key={p.agent_id} className="flex items-center gap-2 border border-white/5 rounded-md bg-white/[0.02] p-2 text-sm hover:border-white/15 transition-colors">
                    <span className={cn("font-mono text-xs w-5 text-center",
                      i === 0 ? "text-amber-300 font-bold" : i < 3 ? "text-slate-300" : "text-slate-500")}>
                      {i + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="truncate">{p.display_name}</div>
                      <div className="text-[10px] text-muted-foreground truncate">{p.manager_name}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs font-mono text-emerald-300">{fmtMoney(Number(p.alp_mtd))}</div>
                      <div className="text-[10px] text-muted-foreground">{p.deals_mtd} deals</div>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
