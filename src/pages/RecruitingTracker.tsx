// RecruitingTracker · per-recruiter rich-card scorecard + LIVE interview cascade
// 2026-06-14 Sam: "Recruit Tracker still trash." HEAD-TO-TOE REBUILD:
//   - KEEP interview cascade (it works)
//   - REPLACE podium + leaderboard + pipeline tables with:
//       1) Per-recruiter RICH CARDS (avatar + 4-metric grid + conversion% + status badge)
//       2) Top-3 deeper podium (big avatar, 8-week sparkline, +N this week, license-to-deal %)
//       3) Hiring pace AreaChart (12 weeks, agency-wide)
// dedup is resolved at DB layer (wave-93) via v_agent_canonical_map.

import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  Trophy, RefreshCw, Users, TrendingUp, Award, Crown, Calendar, Phone,
  Flame, Zap, Moon, Activity,
} from "lucide-react";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
  LineChart, Line,
} from "recharts";
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
  total_premium: number | null;
  total_earnings: number | null;
  total_policies: number | null;
  [k: string]: any;
}

interface LeaderRow {
  recruiter_id: string;
  today: number | string;
  this_week: number | string;
  this_month: number | string;
  last_30d: number | string;
  recruiter_name?: string | null;
}

interface AgentLookupRow {
  id: string;
  display_name: string | null;
  agent_code: string | null;
  profiles: { full_name: string | null; avatar_url: string | null; photo_url: string | null } | null;
}

interface RecruiterWeekRow {
  recruiter_id: string;
  wk: string;
  apps: number;
}

interface AgencyWeekRow {
  wk: string;
  apps: number;
  licensed: number;
}

function compactMoney(n: number | null | undefined): string {
  if (!n || n === 0) return "$0";
  const v = Number(n);
  if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `$${(v / 1_000).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
}

function num(x: number | string | null | undefined): number {
  if (x == null) return 0;
  const n = typeof x === "string" ? Number(x) : x;
  return Number.isFinite(n) ? n : 0;
}

function initials(name?: string | null): string {
  if (!name) return "—";
  const parts = name.trim().split(/\s+/);
  return (parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "");
}

export default function RecruitingTracker() {
  usePageTitle("Headhunters Tracker · APEX");

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
        .limit(40);
      return (data ?? []) as unknown as LeaderRow[];
    },
    refetchInterval: 60_000,
  });

  // Avatar / display-name lookup keyed on the agents.id (== recruiter_id from views).
  const agentLookup = useQuery({
    queryKey: ["recruiter-agent-lookup"],
    queryFn: async () => {
      const { data } = await supabase
        .from("agents")
        .select("id, display_name, agent_code, profiles ( full_name, avatar_url, photo_url )")
        .limit(500);
      return (data ?? []) as unknown as AgentLookupRow[];
    },
    refetchInterval: 5 * 60_000,
  });

  // 12-week agency-wide hiring pace (applications + licensed counts)
  const agencyPace = useQuery({
    queryKey: ["agency-hire-pace-12w"],
    queryFn: async () => {
      const since = new Date();
      since.setUTCDate(since.getUTCDate() - 7 * 12);
      const { data } = await supabase
        .from("applications")
        .select("created_at, licensed_at")
        .gte("created_at", since.toISOString())
        .limit(5000);
      // bucket by ISO week start (UTC; Phoenix-close enough for pace trend)
      const buckets = new Map<string, { apps: number; licensed: number }>();
      const startOfWeek = (d: Date) => {
        const x = new Date(d);
        const day = x.getUTCDay();
        const diff = (day + 6) % 7; // Monday-start
        x.setUTCDate(x.getUTCDate() - diff);
        x.setUTCHours(0, 0, 0, 0);
        return x.toISOString().slice(0, 10);
      };
      for (const r of (data ?? []) as Array<{ created_at: string; licensed_at: string | null }>) {
        const wk = startOfWeek(new Date(r.created_at));
        const b = buckets.get(wk) ?? { apps: 0, licensed: 0 };
        b.apps += 1;
        if (r.licensed_at) b.licensed += 1;
        buckets.set(wk, b);
      }
      const rows: AgencyWeekRow[] = Array.from(buckets.entries())
        .map(([wk, v]) => ({ wk, apps: v.apps, licensed: v.licensed }))
        .sort((a, b) => a.wk.localeCompare(b.wk));
      return rows;
    },
    refetchInterval: 5 * 60_000,
  });

  // 8-week per-recruiter sparkline data
  const recruiterPace = useQuery({
    queryKey: ["recruiter-pace-8w"],
    queryFn: async () => {
      const since = new Date();
      since.setUTCDate(since.getUTCDate() - 7 * 8);
      const { data } = await supabase
        .from("applications")
        .select("assigned_agent_id, created_at")
        .gte("created_at", since.toISOString())
        .not("assigned_agent_id", "is", null)
        .limit(5000);
      // pull canonical map
      const { data: mapRows } = await supabase
        .from("v_agent_canonical_map" as any)
        .select("agent_id, canonical_agent_id");
      const canon = new Map<string, string>();
      for (const m of (mapRows ?? []) as any[]) {
        if (m.agent_id) canon.set(m.agent_id, m.canonical_agent_id ?? m.agent_id);
      }
      const startOfWeek = (d: Date) => {
        const x = new Date(d);
        const day = x.getUTCDay();
        const diff = (day + 6) % 7;
        x.setUTCDate(x.getUTCDate() - diff);
        x.setUTCHours(0, 0, 0, 0);
        return x.toISOString().slice(0, 10);
      };
      const map = new Map<string, Map<string, number>>();
      for (const r of (data ?? []) as Array<{ assigned_agent_id: string; created_at: string }>) {
        const rid = canon.get(r.assigned_agent_id) ?? r.assigned_agent_id;
        const wk = startOfWeek(new Date(r.created_at));
        const inner = map.get(rid) ?? new Map<string, number>();
        inner.set(wk, (inner.get(wk) ?? 0) + 1);
        map.set(rid, inner);
      }
      const rows: RecruiterWeekRow[] = [];
      for (const [rid, inner] of map.entries()) {
        for (const [wk, apps] of inner.entries()) rows.push({ recruiter_id: rid, wk, apps });
      }
      return rows;
    },
    refetchInterval: 5 * 60_000,
  });

  // 2026-06-14: Calendly-booked interviews (next 48h)
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
        id: string; scheduled_for: string; summary: string | null; location: string | null;
        phone: string | null; applicant_name: string | null; source: string | null; status: string | null;
      }>;
    },
    refetchInterval: 5 * 60_000,
  });

  // ────────────────── BUILD DERIVED LOOKUPS ──────────────────
  // recruiter_id → { name, avatar, agent_code }
  const profileByRecruiter = new Map<string, { name: string; avatar: string | null; agent_code: string | null }>();
  for (const a of (agentLookup.data ?? [])) {
    const name = a.display_name ?? a.profiles?.full_name ?? "Recruiter";
    const avatar = a.profiles?.avatar_url ?? a.profiles?.photo_url ?? null;
    profileByRecruiter.set(a.id, { name, avatar, agent_code: a.agent_code });
  }
  // fall back to pipeline view's recruiter_name if agents lookup missed (e.g. dedup canonical mismatch)
  const pipelineByRecruiter = new Map<string, PipelineRow>();
  for (const r of (pipeline.data ?? [])) {
    pipelineByRecruiter.set(r.recruiter_id, r);
    if (!profileByRecruiter.has(r.recruiter_id) && r.recruiter_name) {
      profileByRecruiter.set(r.recruiter_id, { name: r.recruiter_name, avatar: null, agent_code: r.agent_code ?? null });
    }
  }
  const leaderByRecruiter = new Map<string, LeaderRow>();
  for (const r of (leaders.data ?? [])) leaderByRecruiter.set(r.recruiter_id, r);

  // per-recruiter sparkline lookup
  const sparkByRecruiter = new Map<string, Array<{ wk: string; apps: number }>>();
  const weeks8 = (() => {
    const out: string[] = [];
    const now = new Date();
    const day = now.getUTCDay();
    const diff = (day + 6) % 7;
    const start = new Date(now);
    start.setUTCDate(start.getUTCDate() - diff - 7 * 7);
    start.setUTCHours(0, 0, 0, 0);
    for (let i = 0; i < 8; i++) {
      const d = new Date(start);
      d.setUTCDate(d.getUTCDate() + 7 * i);
      out.push(d.toISOString().slice(0, 10));
    }
    return out;
  })();
  for (const r of (recruiterPace.data ?? [])) {
    const arr = sparkByRecruiter.get(r.recruiter_id) ?? weeks8.map((wk) => ({ wk, apps: 0 }));
    const idx = arr.findIndex((x) => x.wk === r.wk);
    if (idx >= 0) arr[idx] = { wk: r.wk, apps: r.apps };
    sparkByRecruiter.set(r.recruiter_id, arr);
  }

  const leaderRows = (leaders.data ?? []) as LeaderRow[];
  const top3 = leaderRows.slice(0, 3);

  // Card grid: every recruiter with any activity in last_30d OR any pipeline.
  const cardRecruiterIds = (() => {
    const set = new Set<string>();
    for (const r of leaderRows) if (num(r.last_30d) > 0 || num(r.this_month) > 0) set.add(r.recruiter_id);
    for (const r of (pipeline.data ?? [])) if (num(r.total_assigned) > 0) set.add(r.recruiter_id);
    return Array.from(set);
  })();
  // sort by paid_count desc, fallback to last_30d
  cardRecruiterIds.sort((a, b) => {
    const pa = num(pipelineByRecruiter.get(a)?.paid_count);
    const pb = num(pipelineByRecruiter.get(b)?.paid_count);
    if (pb !== pa) return pb - pa;
    return num(leaderByRecruiter.get(b)?.last_30d) - num(leaderByRecruiter.get(a)?.last_30d);
  });

  // agency pace chart data (zero-fill 12 weeks)
  const agencyWeeks12 = (() => {
    const out: AgencyWeekRow[] = [];
    const now = new Date();
    const day = now.getUTCDay();
    const diff = (day + 6) % 7;
    const start = new Date(now);
    start.setUTCDate(start.getUTCDate() - diff - 7 * 11);
    start.setUTCHours(0, 0, 0, 0);
    for (let i = 0; i < 12; i++) {
      const d = new Date(start);
      d.setUTCDate(d.getUTCDate() + 7 * i);
      out.push({ wk: d.toISOString().slice(0, 10), apps: 0, licensed: 0 });
    }
    const idxMap = new Map(out.map((r, i) => [r.wk, i]));
    for (const r of (agencyPace.data ?? [])) {
      const i = idxMap.get(r.wk);
      if (i != null) out[i] = r;
    }
    return out;
  })();
  const agencyTotal12w = agencyWeeks12.reduce((s, r) => s + r.apps, 0);
  const agencyLicensed12w = agencyWeeks12.reduce((s, r) => s + r.licensed, 0);
  const agencyAvgPerWeek = Math.round(agencyTotal12w / Math.max(1, agencyWeeks12.length));
  const lastWeek = agencyWeeks12[agencyWeeks12.length - 1];
  const prevWeek = agencyWeeks12[agencyWeeks12.length - 2];
  const wowDelta = (lastWeek?.apps ?? 0) - (prevWeek?.apps ?? 0);

  return (
    <div className="page-enter px-4 sm:px-6 pb-24 space-y-5">
      <PageHeader
        eyebrow="Headhunters"
        eyebrowIcon={<Trophy className="h-3 w-3" />}
        title="Headhunters Tracker"
        subtitle="Per-recruiter rich cards · live podium · 12-week hiring pace."
        actions={
          <Button variant="outline" size="sm" onClick={() => {
            pipeline.refetch(); leaders.refetch(); agencyPace.refetch();
            recruiterPace.refetch(); agentLookup.refetch();
          }}>
            <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${pipeline.isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        }
      />

      {/* ───────────── KEEP · Interview cascade (next 48h) ───────────── */}
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
              <p className="text-12 text-muted-foreground">Inbox zero. Hold the Standard.</p>
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

      {/* ───────────── PANEL 2 · TOP PERFORMER PODIUM (rich) ───────────── */}
      <div className="relative overflow-hidden rounded-3xl border border-amber-500/25 bg-gradient-to-br from-slate-950 via-slate-900 to-amber-950 text-white shadow-[0_0_48px_-12px_hsl(38_92%_50%/0.25)]">
        <div className="absolute -top-24 -right-24 h-72 w-72 rounded-full bg-amber-500/15 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-32 -left-24 h-80 w-80 rounded-full bg-emerald-500/10 blur-3xl pointer-events-none" />
        <div className="relative p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2.5">
              <span className="relative flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75 animate-ping" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-amber-500" />
              </span>
              <p className="text-[11px] uppercase tracking-[0.32em] font-bold text-amber-300">TOP PERFORMERS · LAST 30D</p>
            </div>
            <Badge variant="outline" className="text-11 border-amber-400/40 text-amber-300">
              <Crown className="h-3 w-3 mr-1" /> Podium
            </Badge>
          </div>
          {leaders.isLoading || agentLookup.isLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {Array.from({length:3}).map((_,i)=><Skeleton key={i} className="h-44 bg-white/5" />)}
            </div>
          ) : top3.length === 0 ? (
            <p className="text-13 text-amber-100/70">First deal opens the board.</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {top3.map((r, i) => {
                const prof = profileByRecruiter.get(r.recruiter_id);
                const spark = sparkByRecruiter.get(r.recruiter_id) ?? weeks8.map((wk) => ({ wk, apps: 0 }));
                const thisWk = num(r.this_week);
                const pipe = pipelineByRecruiter.get(r.recruiter_id);
                const paid = num(pipe?.paid_count);
                const total = num(pipe?.total_assigned);
                const qualityPct = total > 0 ? Math.round((paid / total) * 100) : 0;
                const rankBg = ["from-amber-500/30 to-amber-700/10 border-amber-400/40",
                                "from-slate-300/20 to-slate-500/5 border-slate-300/40",
                                "from-orange-600/20 to-orange-900/5 border-orange-500/40"][i];
                const medal = ["🥇", "🥈", "🥉"][i];
                return (
                  <div key={r.recruiter_id} className={`rounded-2xl border bg-gradient-to-br ${rankBg} p-4 backdrop-blur-sm`}>
                    <div className="flex items-start justify-between mb-2">
                      <span className="text-22 leading-none">{medal}</span>
                      <Badge variant="outline" className="text-10 border-white/20 text-white/80">#{i+1}</Badge>
                    </div>
                    <div className="flex items-center gap-3 mb-3">
                      {prof?.avatar ? (
                        <img src={prof.avatar} alt={prof.name} className="h-12 w-12 rounded-full border-2 border-white/30 object-cover" />
                      ) : (
                        <div className="h-12 w-12 rounded-full border-2 border-white/30 bg-white/10 flex items-center justify-center text-13 font-bold uppercase">
                          {initials(prof?.name)}
                        </div>
                      )}
                      <div className="min-w-0">
                        <p className="text-14 font-bold truncate">{prof?.name ?? "Recruiter"}</p>
                        {prof?.agent_code && <p className="text-10 uppercase tracking-wider text-white/60 tabular-nums">{prof.agent_code}</p>}
                      </div>
                    </div>
                    <div className="flex items-end justify-between mb-2">
                      <div>
                        <p className="text-[40px] leading-none font-black tabular-nums">{num(r.last_30d)}</p>
                        <p className="text-10 uppercase tracking-wider text-white/70 mt-1">applicants · 30d</p>
                      </div>
                      <div className="text-right">
                        <Badge className="bg-emerald-500/20 border border-emerald-400/40 text-emerald-200 text-11">+{thisWk} this wk</Badge>
                        <p className="text-11 text-white/70 mt-1 tabular-nums">{qualityPct}% paid</p>
                      </div>
                    </div>
                    <div className="h-10 -mx-1">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={spark}>
                          <Line type="monotone" dataKey="apps" stroke="#fbbf24" strokeWidth={2} dot={false} isAnimationActive={false} />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                    <p className="text-[10px] uppercase tracking-wider text-white/50 mt-1">8-week trend</p>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ───────────── PANEL 1 · PER-RECRUITER RICH CARDS ───────────── */}
      <div className="relative overflow-hidden rounded-3xl border border-amber-500/25 bg-gradient-to-br from-slate-950 via-slate-900 to-amber-950 text-white shadow-[0_0_48px_-12px_hsl(38_92%_50%/0.25)]">
        <div className="absolute -top-24 -right-24 h-72 w-72 rounded-full bg-amber-500/15 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-32 -left-24 h-80 w-80 rounded-full bg-emerald-500/10 blur-3xl pointer-events-none" />
        <div className="relative p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2.5">
              <span className="relative flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75 animate-ping" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-amber-500" />
              </span>
              <p className="text-[11px] uppercase tracking-[0.32em] font-bold text-amber-300">RECRUITER SCORECARDS</p>
            </div>
            <Badge variant="outline" className="text-11 border-amber-400/40 text-amber-300">
              <Users className="h-3 w-3 mr-1" /> {cardRecruiterIds.length} active
            </Badge>
          </div>
          {pipeline.isLoading || leaders.isLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {Array.from({length:6}).map((_,i)=><Skeleton key={i} className="h-44 bg-white/5" />)}
            </div>
          ) : cardRecruiterIds.length === 0 ? (
            // 2026-06-15 v7.2 diagnostic empty-state · mirror DashboardApplicants pattern.
            // Even though there are no client-side filters here, surface the fetched
            // counts from pipeline + leaders + likely causes so Sam never wonders WHY.
            <div className="text-center py-12">
              <Users className="h-10 w-10 text-amber-200/40 mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2 text-white">No recruiter scorecards</h3>
              <div className="space-y-3 max-w-md mx-auto">
                <p className="text-13 text-amber-100/70">
                  Fetched <span className="font-bold text-white tabular-nums">{(pipeline.data ?? []).length.toLocaleString()}</span> pipeline rows ·{" "}
                  <span className="font-bold text-white tabular-nums">{(leaders.data ?? []).length.toLocaleString()}</span> leaderboard rows from the database.
                </p>
                <div className="text-12 text-rose-300">
                  Zero recruiters with last_30d activity OR active pipeline. Likely causes:
                  <ul className="list-disc list-inside mt-2 text-left">
                    <li>Genuinely no recruiting activity in the window (intake dark)</li>
                    <li>v_recruiter_pipeline / v_recruiting_leaderboard RLS regression</li>
                    <li>agentlink_deals_snapshot or applications upstream sync dark</li>
                  </ul>
                  <p className="mt-2 font-semibold">Hold the Standard.</p>
                </div>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {cardRecruiterIds.slice(0, 24).map((rid) => {
                const prof = profileByRecruiter.get(rid);
                const lead = leaderByRecruiter.get(rid);
                const pipe = pipelineByRecruiter.get(rid);
                const today = num(lead?.today);
                const week = num(lead?.this_week);
                const month = num(lead?.this_month);
                const last30 = num(lead?.last_30d);
                const contracting = num(pipe?.contracting_count);
                const paid = num(pipe?.paid_count);
                const total = num(pipe?.total_assigned);
                // conversion: contracting/paid → 'engaged' divided by total assigned
                const convPct = total > 0 ? Math.round(((contracting + paid) / total) * 100) : 0;
                const premium = num(pipe?.total_premium);
                // status badge
                let badge: { label: string; cls: string; icon: any };
                if (last30 > 10) badge = { label: "ON FIRE", cls: "bg-rose-500/20 border-rose-400/40 text-rose-200", icon: Flame };
                else if (last30 >= 5) badge = { label: "ACTIVE", cls: "bg-amber-500/20 border-amber-400/40 text-amber-200", icon: Zap };
                else if (last30 >= 1) badge = { label: "WARM", cls: "bg-sky-500/20 border-sky-400/40 text-sky-200", icon: Activity };
                else badge = { label: "SLEEPING", cls: "bg-slate-500/20 border-slate-400/40 text-slate-300", icon: Moon };
                const Icon = badge.icon;
                return (
                  <div key={rid} className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 backdrop-blur-sm hover:border-amber-400/40 transition-colors">
                    <div className="flex items-center gap-3 mb-3">
                      {prof?.avatar ? (
                        <img src={prof.avatar} alt={prof.name} className="h-12 w-12 rounded-full border-2 border-white/20 object-cover shrink-0" />
                      ) : (
                        <div className="h-12 w-12 rounded-full border-2 border-white/20 bg-white/10 flex items-center justify-center text-13 font-bold uppercase shrink-0">
                          {initials(prof?.name)}
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="text-13 font-bold truncate">{prof?.name ?? "Recruiter"}</p>
                        {prof?.agent_code && <p className="text-10 uppercase tracking-wider text-white/50 tabular-nums">{prof.agent_code}</p>}
                      </div>
                      <Badge className={`text-10 border ${badge.cls} shrink-0`}>
                        <Icon className="h-3 w-3 mr-1" />
                        {badge.label}
                      </Badge>
                    </div>
                    <div className="grid grid-cols-4 gap-1.5 mb-3">
                      <div className="rounded-lg bg-black/30 px-2 py-1.5 text-center">
                        <p className="text-[26px] leading-none font-black tabular-nums text-white">{today}</p>
                        <p className="text-[9px] uppercase tracking-wider text-white/60 mt-1">Today</p>
                      </div>
                      <div className="rounded-lg bg-black/30 px-2 py-1.5 text-center">
                        <p className="text-[26px] leading-none font-black tabular-nums text-white">{week}</p>
                        <p className="text-[9px] uppercase tracking-wider text-white/60 mt-1">Week</p>
                      </div>
                      <div className="rounded-lg bg-black/30 px-2 py-1.5 text-center">
                        <p className="text-[26px] leading-none font-black tabular-nums text-white">{month}</p>
                        <p className="text-[9px] uppercase tracking-wider text-white/60 mt-1">Month</p>
                      </div>
                      <div className="rounded-lg bg-emerald-500/15 px-2 py-1.5 text-center">
                        <p className="text-[26px] leading-none font-black tabular-nums text-emerald-200">{last30}</p>
                        <p className="text-[9px] uppercase tracking-wider text-emerald-300/80 mt-1">30d</p>
                      </div>
                    </div>
                    <div className="flex items-center justify-between text-11">
                      <div>
                        <p className="text-white/50 uppercase tracking-wider text-[10px]">Conv → engaged</p>
                        <p className="font-bold tabular-nums text-amber-200">{convPct}% <span className="text-white/40">· {paid} paid</span></p>
                      </div>
                      <div className="text-right">
                        <p className="text-white/50 uppercase tracking-wider text-[10px]">Pipeline AP</p>
                        <p className="font-bold tabular-nums text-emerald-200">{compactMoney(premium)}</p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ───────────── PANEL 3 · 12-WEEK HIRING PACE (agency-wide) ───────────── */}
      <div className="relative overflow-hidden rounded-3xl border border-emerald-500/25 bg-gradient-to-br from-slate-950 via-slate-900 to-emerald-950 text-white shadow-[0_0_48px_-12px_hsl(168_70%_45%/0.25)]">
        <div className="absolute -top-24 -right-24 h-72 w-72 rounded-full bg-emerald-500/15 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-32 -left-24 h-80 w-80 rounded-full bg-emerald-500/10 blur-3xl pointer-events-none" />
        <div className="relative p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2.5">
              <span className="relative flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
              </span>
              <p className="text-[11px] uppercase tracking-[0.32em] font-bold text-emerald-300">HIRING PACE · 12 WEEKS</p>
            </div>
            <Badge variant="outline" className="text-11 border-emerald-400/40 text-emerald-300">
              <TrendingUp className="h-3 w-3 mr-1" /> Agency-wide
            </Badge>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <div className="rounded-xl bg-black/30 p-3">
              <p className="text-[10px] uppercase tracking-wider text-emerald-300/80">Total · 12w</p>
              <p className="text-[32px] leading-none font-black tabular-nums mt-1">{agencyTotal12w}</p>
              <p className="text-10 text-white/50 mt-1">applicants created</p>
            </div>
            <div className="rounded-xl bg-black/30 p-3">
              <p className="text-[10px] uppercase tracking-wider text-emerald-300/80">Weekly avg</p>
              <p className="text-[32px] leading-none font-black tabular-nums mt-1">{agencyAvgPerWeek}</p>
              <p className="text-10 text-white/50 mt-1">per week</p>
            </div>
            <div className="rounded-xl bg-black/30 p-3">
              <p className="text-[10px] uppercase tracking-wider text-emerald-300/80">This week</p>
              <p className="text-[32px] leading-none font-black tabular-nums mt-1">{lastWeek?.apps ?? 0}</p>
              <p className={`text-10 mt-1 ${wowDelta >= 0 ? "text-emerald-300" : "text-rose-300"}`}>
                {wowDelta >= 0 ? "+" : ""}{wowDelta} WoW
              </p>
            </div>
            <div className="rounded-xl bg-black/30 p-3">
              <p className="text-[10px] uppercase tracking-wider text-emerald-300/80">Licensed · 12w</p>
              <p className="text-[32px] leading-none font-black tabular-nums mt-1">{agencyLicensed12w}</p>
              <p className="text-10 text-white/50 mt-1">{agencyTotal12w > 0 ? `${((agencyLicensed12w / agencyTotal12w) * 100).toFixed(1)}% conv` : "—"}</p>
            </div>
          </div>
          {agencyPace.isLoading ? (
            <Skeleton className="h-56 bg-white/5" />
          ) : (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={agencyWeeks12} margin={{ top: 6, right: 12, left: -16, bottom: 0 }}>
                  <defs>
                    <linearGradient id="hireGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#34d399" stopOpacity={0.55} />
                      <stop offset="100%" stopColor="#34d399" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
                  <XAxis dataKey="wk" tick={{ fill: "rgba(255,255,255,0.65)", fontSize: 10 }}
                    tickFormatter={(v) => format(new Date(v), "MMM d")} />
                  <YAxis tick={{ fill: "rgba(255,255,255,0.65)", fontSize: 10 }} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{ background: "rgba(2,6,23,0.95)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 8, color: "white", fontSize: 12 }}
                    labelFormatter={(v) => `Week of ${format(new Date(v as string), "MMM d, yyyy")}`}
                    formatter={(v: any, key: any) => [v, key === "apps" ? "Applicants" : "Licensed"]}
                  />
                  <Area type="monotone" dataKey="apps" stroke="#34d399" strokeWidth={2} fill="url(#hireGrad)" isAnimationActive={false} />
                  <Area type="monotone" dataKey="licensed" stroke="#fbbf24" strokeWidth={1.5} fillOpacity={0} isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
          <div className="flex items-center gap-4 mt-2 text-11">
            <div className="flex items-center gap-1.5">
              <span className="inline-block h-2 w-3 rounded-sm bg-emerald-400" />
              <span className="text-white/70">Applicants created</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="inline-block h-2 w-3 rounded-sm bg-amber-400" />
              <span className="text-white/70">Licensed</span>
            </div>
          </div>
        </div>
      </div>

      {/* ───────────── Compact Award strip — link to full ranking ───────────── */}
      {!leaders.isLoading && leaderRows.length > 3 && (
        <Card>
          <CardContent className="p-4">
            <h3 className="text-13 font-bold flex items-center gap-2 mb-3"><Award className="h-4 w-4 text-amber-500" /> Honorable mentions</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
              {leaderRows.slice(3, 13).map((r, idx) => {
                const prof = profileByRecruiter.get(r.recruiter_id);
                return (
                  <div key={r.recruiter_id} className="flex items-center gap-2 rounded-md border border-border/40 px-2 py-1.5 hover:border-amber-500/40 transition-colors">
                    <span className="text-11 font-bold text-muted-foreground tabular-nums w-5 text-right">#{idx + 4}</span>
                    {prof?.avatar ? (
                      <img src={prof.avatar} alt={prof.name} className="h-7 w-7 rounded-full object-cover shrink-0" />
                    ) : (
                      <div className="h-7 w-7 rounded-full bg-muted flex items-center justify-center text-10 font-bold uppercase shrink-0">
                        {initials(prof?.name)}
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-12 font-medium truncate">{prof?.name ?? "Recruiter"}</p>
                      <p className="text-10 text-muted-foreground tabular-nums">{num(r.last_30d)} · 30d</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
