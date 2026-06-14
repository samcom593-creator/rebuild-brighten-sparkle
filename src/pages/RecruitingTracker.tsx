// RecruitingTracker · per-recruiter scorecard + LIVE interview cascade
// 2026-06-14 Sam: "What's tied to a tracker that tracks my calendar · interviews"
// dedup now resolved at DB layer (wave-93) via v_agent_canonical_map →
// v_recruiting_leaderboard + v_recruiter_pipeline canonicalize SJAMES01/02 et al.

import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  Trophy, RefreshCw, Users, TrendingUp, Award, Crown, Calendar, Phone, ExternalLink,
} from "lucide-react";
import { Link } from "react-router-dom";
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

  // Recruiter name lookup keyed on the canonical recruiter_id returned by
  // v_recruiting_leaderboard (post wave-93 DB canonicalization).
  const nameByRecruiter = new Map<string, string>();
  for (const r of (pipeline.data ?? [])) {
    if (r.recruiter_name) nameByRecruiter.set(r.recruiter_id, r.recruiter_name);
  }

  const leaderRows = (leaders.data ?? []) as LeaderRow[];
  const pipelineRows = (pipeline.data ?? []) as PipelineRow[];

  // 2026-06-14 NEW: pull today's + tomorrow's Calendly-booked interviews
  // (synced via google calendar → applications. Reads calls scheduled via Calendly)
  const interviews = useQuery({
    queryKey: ["scheduled-interviews"],
    queryFn: async () => {
      const { data } = await supabase
        .from("apex_scheduled_calls" as any)
        .select("id, scheduled_for, summary, location, phone, applicant_name, source, status")
        .gte("scheduled_for", new Date().toISOString())
        .lte("scheduled_for", new Date(Date.now() + 48 * 3600 * 1000).toISOString())
        .order("scheduled_for", { ascending: true })
        .limit(25);
      return (data ?? []) as Array<{
        id: string;
        scheduled_for: string;
        summary: string | null;
        location: string | null;
        phone: string | null;
        applicant_name: string | null;
        source: string | null;
        status: string | null;
      }>;
    },
    refetchInterval: 5 * 60_000,
  });

  const top3 = leaderRows.slice(0, 3);
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

      {/* 2026-06-14 NEW · Interview cascade (next 48h) */}
      <Card className="border-emerald-500/30 bg-emerald-500/[0.04]">
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-13 font-bold flex items-center gap-2">
              <Calendar className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              Interview Cascade · next 48h
            </h3>
            <Badge variant="outline" className="text-11">
              {interviews.data?.length ?? 0} booked
            </Badge>
          </div>
          {interviews.isLoading ? (
            <div className="space-y-2">{Array.from({length:3}).map((_,i)=><Skeleton key={i} className="h-10" />)}</div>
          ) : (interviews.data ?? []).length === 0 ? (
            <div className="text-center py-4">
              <Calendar className="h-5 w-5 mx-auto mb-1 text-muted-foreground opacity-50" />
              <p className="text-12 text-muted-foreground">No interviews scheduled in the next 48 hours.</p>
              <p className="text-11 text-muted-foreground mt-0.5">Bookings sync from Google Calendar + Calendly.</p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {(interviews.data ?? []).map((iv) => {
                const when = new Date(iv.scheduled_for);
                const isToday = when.toDateString() === new Date().toDateString();
                return (
                  <div key={iv.id} className="flex items-center gap-3 px-3 py-2 rounded-md border border-border/40 hover:border-emerald-500/40 hover:bg-emerald-500/5 transition-colors">
                    <div className="text-center shrink-0 w-14">
                      <p className={`text-11 font-bold uppercase tracking-wider ${isToday ? "text-rose-600 dark:text-rose-400" : "text-amber-600 dark:text-amber-400"}`}>
                        {isToday ? "TODAY" : format(when, "EEE")}
                      </p>
                      <p className="text-14 font-bold tabular-nums">{format(when, "h:mm a")}</p>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-13 font-medium truncate">{iv.applicant_name ?? iv.summary ?? "Interview"}</p>
                      <p className="text-11 text-muted-foreground truncate">{iv.source ?? "Calendly"}</p>
                    </div>
                    {iv.phone && (
                      <a href={`tel:${iv.phone}`} className="shrink-0 p-1.5 rounded-md text-emerald-600 hover:bg-emerald-500/10">
                        <Phone className="h-3.5 w-3.5" />
                      </a>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

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
                  {leaderRows.map((r) => (
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
                  {pipelineRows.map((r) => (
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
