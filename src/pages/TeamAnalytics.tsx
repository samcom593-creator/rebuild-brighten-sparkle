// TeamAnalytics — mirrors agentlink.insuracloud.ai/team-analytics
//
// Layout: ranked producer list + total team output + filterable by 30d window
// Data source: v_team_analytics_producers (joins agentlink_deals_snapshot to
// our agents table via al_user_id, so apex display names show when mapped)
//
// When AgentLink /api/v1/team-analytics stops 500-ing, swap to that endpoint.

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Users, Trophy, DollarSign, TrendingUp, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { usePageTitle } from "@/hooks/usePageTitle";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { format } from "date-fns";

function fmtUsd(n: number, compact = false): string {
  const v = Number(n ?? 0);
  if (compact && v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (compact && v >= 1_000)     return `$${(v / 1_000).toFixed(1)}K`;
  return v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}
function fmtNum(n: number | string | null | undefined): string {
  return Number(n ?? 0).toLocaleString("en-US");
}

interface Producer {
  user_id: number;
  agent_name: string | null;
  agent_code: string | null;
  deals_30d: number;
  premium_30d: string;
  monthly_30d: string;
  avg_deal_size: string;
  last_deal_date: string | null;
}

export default function TeamAnalytics() {
  usePageTitle("Team Analytics · APEX");
  const [search, setSearch] = useState("");

  const producers = useQuery({
    queryKey: ["team-analytics-producers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_team_analytics_producers" as any)
        .select("user_id, agent_name, agent_code, deals_30d, premium_30d, monthly_30d, avg_deal_size, last_deal_date")
        .limit(200);
      if (error) throw error;
      return (data ?? []) as unknown as Producer[];
    },
    refetchInterval: 5 * 60_000,
  });

  const all = producers.data ?? [];
  const filtered = search.trim()
    ? all.filter((p) =>
        (p.agent_name ?? "").toLowerCase().includes(search.toLowerCase()) ||
        (p.agent_code ?? "").toLowerCase().includes(search.toLowerCase()) ||
        String(p.user_id).includes(search))
    : all;

  const totalProducers = all.length;
  const totalDeals = all.reduce((s, p) => s + p.deals_30d, 0);
  const totalPremium = all.reduce((s, p) => s + Number(p.premium_30d ?? 0), 0);

  return (
    <div className="page-enter px-4 sm:px-6 pb-24 space-y-5">
      <PageHeader
        eyebrow="Analytics"
        eyebrowIcon={<Users className="h-3 w-3" />}
        title="Team Analytics"
        subtitle="Ranked producer output across the team. Mirrors AgentLink's team-analytics page."
        actions={
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-11">Last 30 days</Badge>
            <Button variant="outline" size="sm" onClick={() => producers.refetch()}>
              <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${producers.isFetching ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        }
      />

      {/* 3-KPI tile row */}
      <div className="grid gap-3 sm:grid-cols-3">
        <Kpi icon={Users}    label="Active Producers · 30d" value={fmtNum(totalProducers)} loading={producers.isLoading} />
        <Kpi icon={Trophy}   label="Team Deals · 30d"       value={fmtNum(totalDeals)}    loading={producers.isLoading} />
        <Kpi icon={DollarSign} label="Team Premium · 30d"   value={fmtUsd(totalPremium, true)} sub={fmtUsd(totalPremium)} color="text-emerald-600 dark:text-emerald-400" loading={producers.isLoading} />
      </div>

      {/* Search */}
      <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800">
        <CardContent className="p-3">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, agent code, or AgentLink user ID..."
            className="h-9"
          />
        </CardContent>
      </Card>

      {/* Ranked producer list */}
      <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800">
        <CardContent className="p-5">
          <div className="flex items-baseline justify-between mb-4">
            <h2 className="text-base font-semibold flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-emerald-500" />
              Top Producers
            </h2>
            <span className="text-11 text-muted-foreground tabular-nums">
              Showing {fmtNum(filtered.length)} of {fmtNum(totalProducers)}
            </span>
          </div>

          {producers.isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={<Users className="h-6 w-6" />}
              title={search ? "No matching producers" : "No producers in the last 30 days"}
              description={search ? "Try clearing the search or check the spelling." : "Producer rows appear here as deals land via the AgentLink sync."}
            />
          ) : (
            <div className="divide-y divide-slate-200 dark:divide-slate-800">
              {filtered.map((p, i) => {
                const sharePct = totalPremium > 0 ? (Number(p.premium_30d) / totalPremium) * 100 : 0;
                const displayName = p.agent_name ?? `AgentLink user #${p.user_id}`;
                return (
                  <div key={p.user_id} className="flex items-center gap-3 py-2.5 px-1">
                    <span className={`text-11 tabular-nums w-6 text-right shrink-0 ${
                      i === 0 ? "text-amber-600 dark:text-amber-400 font-bold" :
                      i < 5 ? "text-foreground font-semibold" :
                      "text-muted-foreground"
                    }`}>{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2">
                        <p className="text-13 font-semibold truncate">{displayName}</p>
                        {p.agent_code && (
                          <span className="text-11 text-muted-foreground font-mono">{p.agent_code}</span>
                        )}
                      </div>
                      <p className="text-11 text-muted-foreground">
                        {fmtNum(p.deals_30d)} deals · avg {fmtUsd(Number(p.avg_deal_size))}
                        {p.last_deal_date && (
                          <span> · last {format(new Date(p.last_deal_date), "MMM d")}</span>
                        )}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-13 font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                        {fmtUsd(Number(p.premium_30d))}
                      </p>
                      <p className="text-11 text-muted-foreground tabular-nums">{sharePct.toFixed(1)}% share</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Kpi({
  icon: Icon, label, value, sub, color = "text-foreground", loading,
}: {
  icon: any; label: string; value: string; sub?: string; color?: string; loading?: boolean;
}) {
  return (
    <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-11 uppercase tracking-wider font-semibold text-slate-500">
          <Icon className="h-3.5 w-3.5 opacity-60" />
          {label}
        </div>
        {loading ? (
          <Skeleton className="h-8 w-20 mt-2" />
        ) : (
          <>
            <p className={`text-28 font-bold tabular-nums ${color}`}>{value}</p>
            {sub && <p className="text-11 text-muted-foreground tabular-nums">{sub}</p>}
          </>
        )}
      </CardContent>
    </Card>
  );
}
