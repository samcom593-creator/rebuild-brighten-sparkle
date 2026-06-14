// RecruitingTracker · mirrors AgentLink's "Recruiting Tracker"
// Per-recruiter scorecard: pipeline state + conversion + leaderboard.

import { useQuery } from "@tanstack/react-query";
import {
  Trophy, RefreshCw, Users, TrendingUp, Award, Crown,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { usePageTitle } from "@/hooks/usePageTitle";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

interface PipelineRow {
  recruiter_id: string;
  agent_code: string | null;
  recruiter_email: string | null;
  recruiter_name: string | null;
  total_assigned: number | null;
  new_count: number | null;
  in_progress_count: number | null;
  contracting_count: number | null;
  paid_count: number | null;
  [k: string]: any;
}

interface LeaderRow {
  recruiter_id: string;
  today: string | number;
  this_week: string | number;
  this_month: string | number;
  last_30d: string | number;
  recruiter_name?: string | null;
}

export default function RecruitingTracker() {
  usePageTitle("Recruiting Tracker · APEX");

  const pipeline = useQuery({
    queryKey: ["recruiter-pipeline"],
    queryFn: async () => {
      const { data } = await supabase
        .from("v_recruiter_pipeline" as any)
        .select("*")
        .order("paid_count", { ascending: false })
        .limit(100);
      return (data ?? []) as unknown as PipelineRow[];
    },
    refetchInterval: 60_000,
  });

  const leaders = useQuery({
    queryKey: ["recruiter-leaderboard"],
    queryFn: async () => {
      const { data } = await supabase
        .from("v_recruiting_leaderboard" as any)
        .select("*")
        .order("last_30d", { ascending: false })
        .limit(20);
      return (data ?? []) as unknown as LeaderRow[];
    },
    refetchInterval: 60_000,
  });

  // Join: leaderboard rows + names from pipeline rows
  const nameByRecruiter = new Map<string, string>();
  for (const r of (pipeline.data ?? [])) {
    if (r.recruiter_name) nameByRecruiter.set(r.recruiter_id, r.recruiter_name);
  }

  const top3 = (leaders.data ?? []).slice(0, 3);
  const podium = ["bg-amber-500", "bg-slate-400", "bg-amber-700"];

  return (
    <div className="page-enter px-4 sm:px-6 pb-24 space-y-5">
      <PageHeader
        eyebrow="Recruiting"
        eyebrowIcon={<Trophy className="h-3 w-3" />}
        title="Recruiting Tracker"
        subtitle="Per-recruiter scorecards · live leaderboard · pipeline depth."
        actions={
          <Button variant="outline" size="sm" onClick={() => { pipeline.refetch(); leaders.refetch(); }}>
            <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${pipeline.isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        }
      />

      {/* Podium */}
      <Card>
        <CardContent className="p-5">
          <h3 className="text-13 font-bold mb-4 flex items-center gap-2"><Crown className="h-4 w-4 text-amber-500" /> Top 3 · last 30 days</h3>
          {leaders.isLoading ? (
            <div className="grid grid-cols-3 gap-3">{Array.from({length:3}).map((_,i)=><Skeleton key={i} className="h-24" />)}</div>
          ) : top3.length === 0 ? (
            <p className="text-13 text-muted-foreground">No recruiting activity in the last 30 days.</p>
          ) : (
            <div className="grid grid-cols-3 gap-3">
              {top3.map((r, i) => (
                <div key={r.recruiter_id} className={`p-4 rounded-lg ${podium[i]} text-white text-center`}>
                  <Award className="h-6 w-6 mx-auto mb-1 opacity-90" />
                  <p className="text-11 uppercase tracking-wider opacity-90">#{i+1}</p>
                  <p className="text-13 font-bold truncate" title={nameByRecruiter.get(r.recruiter_id) ?? r.recruiter_id}>
                    {nameByRecruiter.get(r.recruiter_id) ?? "Recruiter"}
                  </p>
                  <p className="text-22 font-bold tabular-nums mt-1">{r.last_30d}</p>
                  <p className="text-11 opacity-90">applicants / 30d</p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Leaderboard table */}
      <Card>
        <CardContent className="p-0">
          <div className="px-5 py-4">
            <h3 className="text-13 font-bold flex items-center gap-2"><TrendingUp className="h-4 w-4 text-amber-500" /> Full Leaderboard</h3>
          </div>
          {leaders.isLoading ? (
            <div className="p-4 space-y-2">{Array.from({length:5}).map((_,i)=><Skeleton key={i} className="h-8" />)}</div>
          ) : (
            <div className="overflow-auto">
              <table className="w-full text-13">
                <thead className="border-y border-border bg-muted/30 text-12 uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="text-left px-4 py-2">Recruiter</th>
                    <th className="text-right px-4 py-2">Today</th>
                    <th className="text-right px-4 py-2">This Week</th>
                    <th className="text-right px-4 py-2">This Month</th>
                    <th className="text-right px-4 py-2 font-semibold">Last 30d</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {(leaders.data ?? []).map((r) => (
                    <tr key={r.recruiter_id} className="hover:bg-muted/20">
                      <td className="px-4 py-2 font-medium">{nameByRecruiter.get(r.recruiter_id) ?? r.recruiter_id.slice(0, 8) + "…"}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{r.today}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{r.this_week}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{r.this_month}</td>
                      <td className="px-4 py-2 text-right tabular-nums font-bold text-emerald-600">{r.last_30d}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Per-recruiter pipeline depth */}
      <Card>
        <CardContent className="p-0">
          <div className="px-5 py-4">
            <h3 className="text-13 font-bold flex items-center gap-2"><Users className="h-4 w-4 text-amber-500" /> Per-Recruiter Pipeline Depth</h3>
          </div>
          {pipeline.isLoading ? (
            <div className="p-4 space-y-2">{Array.from({length:5}).map((_,i)=><Skeleton key={i} className="h-8" />)}</div>
          ) : (
            <div className="overflow-auto">
              <table className="w-full text-13">
                <thead className="border-y border-border bg-muted/30 text-12 uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="text-left px-4 py-2">Recruiter</th>
                    <th className="text-right px-4 py-2">Total</th>
                    <th className="text-right px-4 py-2">New</th>
                    <th className="text-right px-4 py-2">In Progress</th>
                    <th className="text-right px-4 py-2">Contracting</th>
                    <th className="text-right px-4 py-2 font-semibold">Paid</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {(pipeline.data ?? []).map((r) => (
                    <tr key={r.recruiter_id} className="hover:bg-muted/20">
                      <td className="px-4 py-2 font-medium">
                        {r.recruiter_name ?? r.recruiter_email ?? r.recruiter_id.slice(0, 8) + "…"}
                        {r.agent_code && <span className="ml-2 text-11 text-muted-foreground tabular-nums">[{r.agent_code}]</span>}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">{r.total_assigned ?? 0}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{r.new_count ?? 0}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{r.in_progress_count ?? 0}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{r.contracting_count ?? 0}</td>
                      <td className="px-4 py-2 text-right tabular-nums font-bold text-emerald-600">{r.paid_count ?? 0}</td>
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
