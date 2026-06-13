// TeamAnalytics — mirrors agentlink.insuracloud.ai/team-analytics
//
// Layout: ranked producer list + total team output + filterable by 30d window
// Data source: v_team_analytics_producers (joins agentlink_deals_snapshot to
// our agents table via al_user_id, so apex display names show when mapped)
//
// When AgentLink /api/v1/team-analytics stops 500-ing, swap to that endpoint.

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Users, Trophy, DollarSign, TrendingUp, RefreshCw, X, Calendar, ChevronRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { usePageTitle } from "@/hooks/usePageTitle";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { format } from "date-fns";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip as RTooltip, CartesianGrid } from "recharts";

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

interface DeepDive {
  user_id: number;
  agent_name: string | null;
  agent_code: string | null;
  deals_30d: number;
  premium_30d: string;
  avg_deal_size: string;
  last_deal_at: string | null;
  first_deal_at: string | null;
  carriers: Array<{ carrier_name: string; deals: number; premium: string }>;
  recent_deals: Array<{ effective_date: string; annual_premium: string; client_first_name: string | null; product_sold: string | null }>;
  daily_trend: Array<{ day: string; premium: string }>;
}

export default function TeamAnalytics() {
  usePageTitle("Team Analytics · APEX");
  const [search, setSearch] = useState("");
  const [openUserId, setOpenUserId] = useState<number | null>(null);

  const deepDive = useQuery({
    queryKey: ["producer-deep-dive", openUserId],
    enabled: openUserId !== null,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("producer_deep_dive" as any, { p_user_id: openUserId });
      if (error) throw error;
      return data as unknown as DeepDive;
    },
  });

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
                  <div
                    key={p.user_id}
                    onClick={() => setOpenUserId(p.user_id)}
                    className="flex items-center gap-3 py-2.5 px-1 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/40 rounded-md transition-base"
                  >
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
                    <ChevronRight className="h-4 w-4 text-muted-foreground/50 shrink-0" />
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* WAVE B3 · Producer Deep-Dive sheet · slides in from right on row click.
          30d carrier mix + recent 15 deals + daily premium chart + meta. */}
      <Sheet open={openUserId !== null} onOpenChange={(o) => !o && setOpenUserId(null)}>
        <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <Users className="h-4 w-4 text-emerald-500" />
              {deepDive.data?.agent_name ?? `AgentLink user #${openUserId}`}
              {deepDive.data?.agent_code && (
                <span className="text-12 font-mono text-muted-foreground">{deepDive.data.agent_code}</span>
              )}
            </SheetTitle>
            <SheetDescription>Last 30 days · click outside to close</SheetDescription>
          </SheetHeader>

          {deepDive.isLoading ? (
            <div className="space-y-3 mt-5">
              <Skeleton className="h-20" /><Skeleton className="h-32" /><Skeleton className="h-40" />
            </div>
          ) : deepDive.data ? (
            <div className="space-y-5 mt-5">
              {/* Header stats */}
              <div className="grid grid-cols-3 gap-2">
                <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800">
                  <CardContent className="p-3">
                    <p className="text-11 uppercase tracking-wider font-semibold text-slate-500">Deals</p>
                    <p className="text-22 font-bold tabular-nums">{deepDive.data.deals_30d}</p>
                  </CardContent>
                </Card>
                <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800">
                  <CardContent className="p-3">
                    <p className="text-11 uppercase tracking-wider font-semibold text-slate-500">Premium</p>
                    <p className="text-22 font-bold tabular-nums text-emerald-600 dark:text-emerald-400">{fmtUsd(Number(deepDive.data.premium_30d), true)}</p>
                  </CardContent>
                </Card>
                <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800">
                  <CardContent className="p-3">
                    <p className="text-11 uppercase tracking-wider font-semibold text-slate-500">Avg deal</p>
                    <p className="text-22 font-bold tabular-nums">{fmtUsd(Number(deepDive.data.avg_deal_size))}</p>
                  </CardContent>
                </Card>
              </div>

              {/* Trend chart */}
              {deepDive.data.daily_trend.length > 0 && (
                <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800">
                  <CardContent className="p-4">
                    <p className="text-11 uppercase tracking-wider font-semibold text-slate-500 mb-3">Daily premium · last 30d</p>
                    <ResponsiveContainer width="100%" height={140}>
                      <AreaChart data={deepDive.data.daily_trend}>
                        <defs>
                          <linearGradient id={`pdg-${openUserId}`} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="hsl(168 70% 45%)" stopOpacity={0.6} />
                            <stop offset="100%" stopColor="hsl(168 70% 45%)" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border)/0.4)" />
                        <XAxis dataKey="day" tickFormatter={(d) => format(new Date(d), "MMM d")} fontSize={9} stroke="hsl(var(--muted-foreground))" />
                        <YAxis fontSize={9} stroke="hsl(var(--muted-foreground))" tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                        <RTooltip
                          contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 6 }}
                          labelFormatter={(d) => format(new Date(d), "PPP")}
                          formatter={(v: number) => fmtUsd(v)}
                        />
                        <Area type="monotone" dataKey="premium" stroke="hsl(168 70% 45%)" fill={`url(#pdg-${openUserId})`} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              )}

              {/* Carrier mix */}
              {deepDive.data.carriers.length > 0 && (
                <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800">
                  <CardContent className="p-4">
                    <p className="text-11 uppercase tracking-wider font-semibold text-slate-500 mb-3">Carrier mix</p>
                    <div className="space-y-1.5">
                      {deepDive.data.carriers.map((c, i) => {
                        const totalP = deepDive.data!.carriers.reduce((s, x) => s + Number(x.premium), 0);
                        const pct = (Number(c.premium) / Math.max(1, totalP)) * 100;
                        return (
                          <div key={`${c.carrier_name}-${i}`} className="flex items-center gap-3 text-12">
                            <span className="flex-1 truncate font-semibold">{c.carrier_name}</span>
                            <span className="text-muted-foreground tabular-nums">{c.deals} deals</span>
                            <span className="font-semibold tabular-nums text-emerald-600 dark:text-emerald-400 w-16 text-right">{fmtUsd(Number(c.premium), true)}</span>
                            <span className="text-muted-foreground tabular-nums w-12 text-right">{pct.toFixed(0)}%</span>
                          </div>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Recent deals */}
              {deepDive.data.recent_deals.length > 0 && (
                <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800">
                  <CardContent className="p-4">
                    <p className="text-11 uppercase tracking-wider font-semibold text-slate-500 mb-3">Recent deals · {deepDive.data.recent_deals.length}</p>
                    <div className="space-y-1.5">
                      {deepDive.data.recent_deals.map((d, i) => (
                        <div key={i} className="flex items-center gap-2 text-12">
                          <Calendar className="h-3 w-3 text-muted-foreground shrink-0" />
                          <span className="tabular-nums text-muted-foreground w-16 text-11">{format(new Date(d.effective_date), "MMM d")}</span>
                          <span className="flex-1 truncate">{d.client_first_name ?? "—"} · {d.product_sold ?? "—"}</span>
                          <span className="font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">{fmtUsd(Number(d.annual_premium))}</span>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          ) : (
            <EmptyState icon={<Users className="h-6 w-6" />} title="No data" description="This producer has no deals in the last 30 days." />
          )}
        </SheetContent>
      </Sheet>
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
