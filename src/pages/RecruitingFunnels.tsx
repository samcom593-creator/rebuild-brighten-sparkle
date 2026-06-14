// RecruitingFunnels · mirrors AgentLink's "Recruiting Funnels"
// Visualizes the recruit-to-licensed-producer conversion funnel.

import { useQuery } from "@tanstack/react-query";
import {
  Filter, RefreshCw, TrendingUp, Users, ArrowDown,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { usePageTitle } from "@/hooks/usePageTitle";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

interface FunnelTotals {
  total: string | number;
  new_count: string | number;
  contacted_count: string | number;
  paid_count: string | number;
  qualified_count: string | number;
  approved_count: string | number;
  rejected_count: string | number;
  last_7d: string | number;
  last_30d: string | number;
  pct_paid_of_total: string | number;
  pct_approved_of_total: string | number;
}

interface SourceRow {
  source: string;
  utm_source: string | null;
  total_applications: number;
  moved_past_new: number;
  paid: number;
  rejected: number;
  no_pickup: number;
  paid_pct: string;
}

const STAGES: Array<{ key: keyof FunnelTotals; label: string; tone: string }> = [
  { key: "new_count",        label: "New",        tone: "bg-slate-500/20 text-slate-700 dark:text-slate-300" },
  { key: "contacted_count",  label: "Contacted",  tone: "bg-amber-500/20 text-amber-700 dark:text-amber-300" },
  { key: "paid_count",       label: "Paid",       tone: "bg-emerald-500/20 text-emerald-700 dark:text-emerald-300" },
  { key: "qualified_count",  label: "Qualified",  tone: "bg-emerald-500/30 text-emerald-700 dark:text-emerald-300" },
  { key: "approved_count",   label: "Approved",   tone: "bg-emerald-600/30 text-emerald-800 dark:text-emerald-200" },
];

function num(v: string | number) { return Number(v ?? 0); }

export default function RecruitingFunnels() {
  usePageTitle("Recruiting Funnels · APEX");

  const totals = useQuery({
    queryKey: ["funnel-totals"],
    queryFn: async () => {
      const { data } = await supabase.from("v_application_conversion_funnel" as any).select("*").maybeSingle();
      return data as unknown as FunnelTotals;
    },
    refetchInterval: 60_000,
  });

  const bySource = useQuery({
    queryKey: ["funnel-by-source"],
    queryFn: async () => {
      const { data } = await supabase.from("v_funnel_by_source" as any).select("*").limit(30);
      return (data ?? []) as unknown as SourceRow[];
    },
    refetchInterval: 60_000,
  });

  const refetchAll = () => { totals.refetch(); bySource.refetch(); };
  const t = totals.data;
  const maxCount = t ? num(t.total) : 0;

  return (
    <div className="page-enter px-4 sm:px-6 pb-24 space-y-5">
      <PageHeader
        eyebrow="Recruiting"
        eyebrowIcon={<Filter className="h-3 w-3" />}
        title="Recruiting Funnels"
        subtitle="Conversion funnel · stage-by-stage drop-off · source attribution."
        actions={
          <Button variant="outline" size="sm" onClick={refetchAll}>
            <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${totals.isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        }
      />

      {/* Top stats */}
      {totals.isLoading ? (
        <div className="grid gap-2 grid-cols-2 md:grid-cols-4">
          {Array.from({length:4}).map((_,i) => <Skeleton key={i} className="h-20" />)}
        </div>
      ) : t ? (
        <div className="grid gap-2 grid-cols-2 md:grid-cols-4">
          <Card><CardContent className="p-3">
            <p className="text-11 text-muted-foreground uppercase tracking-wider mb-1">Total Applicants</p>
            <p className="text-22 font-bold tabular-nums">{num(t.total).toLocaleString()}</p>
          </CardContent></Card>
          <Card><CardContent className="p-3">
            <p className="text-11 text-muted-foreground uppercase tracking-wider mb-1">Last 30 days</p>
            <p className="text-22 font-bold tabular-nums text-amber-600">{num(t.last_30d)}</p>
            <p className="text-11 text-muted-foreground tabular-nums">{num(t.last_7d)} in last 7d</p>
          </CardContent></Card>
          <Card><CardContent className="p-3">
            <p className="text-11 text-muted-foreground uppercase tracking-wider mb-1">% Paid</p>
            <p className="text-22 font-bold tabular-nums text-emerald-600">{Number(t.pct_paid_of_total).toFixed(1)}%</p>
          </CardContent></Card>
          <Card><CardContent className="p-3">
            <p className="text-11 text-muted-foreground uppercase tracking-wider mb-1">% Approved</p>
            <p className="text-22 font-bold tabular-nums text-emerald-600">{Number(t.pct_approved_of_total).toFixed(1)}%</p>
          </CardContent></Card>
        </div>
      ) : null}

      {/* The funnel itself */}
      <Card>
        <CardContent className="p-5">
          <h3 className="text-13 font-bold mb-3 flex items-center gap-2"><TrendingUp className="h-4 w-4 text-amber-500" /> Stage Funnel</h3>
          {totals.isLoading ? (
            <div className="space-y-2">{Array.from({length:5}).map((_,i)=><Skeleton key={i} className="h-10" />)}</div>
          ) : t ? (
            <div className="space-y-1">
              {STAGES.map((s, i) => {
                const v = num(t[s.key]);
                const widthPct = maxCount > 0 ? (v / maxCount) * 100 : 0;
                const dropFromPrev = i > 0 ? num(t[STAGES[i-1].key]) - v : 0;
                const dropPct = i > 0 && num(t[STAGES[i-1].key]) > 0 ? (dropFromPrev / num(t[STAGES[i-1].key])) * 100 : 0;
                return (
                  <div key={s.key}>
                    {i > 0 && dropFromPrev > 0 && (
                      <div className="flex items-center justify-center gap-1 py-0.5 text-11 text-rose-600">
                        <ArrowDown className="h-3 w-3" />
                        −{dropFromPrev.toLocaleString()} ({dropPct.toFixed(0)}%)
                      </div>
                    )}
                    <div className="flex items-center gap-2">
                      <div className={`flex-1 px-3 py-2 rounded-md ${s.tone}`} style={{ width: `${Math.max(widthPct, 10)}%` }}>
                        <div className="flex justify-between items-center">
                          <span className="text-12 font-bold">{s.label}</span>
                          <span className="text-13 tabular-nums font-bold">{v.toLocaleString()}</span>
                        </div>
                      </div>
                      <div className="w-12 text-right text-11 text-muted-foreground tabular-nums">
                        {maxCount > 0 ? `${((v/maxCount)*100).toFixed(0)}%` : "—"}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* By source */}
      <Card>
        <CardContent className="p-0">
          <div className="p-5 pb-3">
            <h3 className="text-13 font-bold flex items-center gap-2"><Users className="h-4 w-4 text-amber-500" /> By Source</h3>
          </div>
          {bySource.isLoading ? (
            <div className="p-4 space-y-2">{Array.from({length:3}).map((_,i)=><Skeleton key={i} className="h-10" />)}</div>
          ) : (
            <div className="overflow-auto">
              <table className="w-full text-13">
                <thead className="border-y border-border bg-muted/30 text-12 uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="text-left px-4 py-2 font-semibold">Source</th>
                    <th className="text-left px-4 py-2 font-semibold">UTM</th>
                    <th className="text-right px-4 py-2 font-semibold">Total</th>
                    <th className="text-right px-4 py-2 font-semibold">Moved Past New</th>
                    <th className="text-right px-4 py-2 font-semibold">Paid</th>
                    <th className="text-right px-4 py-2 font-semibold">No Pickup</th>
                    <th className="text-right px-4 py-2 font-semibold">Rejected</th>
                    <th className="text-right px-4 py-2 font-semibold">Paid %</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {(bySource.data ?? []).map((r, i) => (
                    <tr key={i} className="hover:bg-muted/20">
                      <td className="px-4 py-2 font-medium">{r.source ?? "—"}</td>
                      <td className="px-4 py-2 text-foreground/70 text-12">{r.utm_source ?? "none"}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{r.total_applications.toLocaleString()}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{r.moved_past_new}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-emerald-600 font-bold">{r.paid}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{r.no_pickup}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-rose-600">{r.rejected}</td>
                      <td className="px-4 py-2 text-right tabular-nums font-bold">
                        <Badge variant="outline" className="text-11">{Number(r.paid_pct).toFixed(1)}%</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
