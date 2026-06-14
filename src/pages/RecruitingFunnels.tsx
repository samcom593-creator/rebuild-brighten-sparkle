// RecruitingFunnels · mirrors AgentLink's "Recruiting Funnels"
// Visualizes the recruit-to-licensed-producer conversion funnel.
//
// 2026-06-14 head-to-toe densify rebuild:
//   - kept premium amber hero (it's good)
//   - replaced flat funnel + plain by-source table with 4 dense sections:
//       1. Stage-by-stage conversion strip (vertical pills + drop arrows)
//       2. Per-source funnel grid (tone-tinted by paid-pct)
//       3. Weekly created/contacted/paid/licensed bar chart (12w)
//       4. Drop-off heatmap (stages × last 8 weeks)
//   - all queries hit applications directly using REAL columns from DB audit
//     (created_at, contacted_at, course_purchased_at, exam_passed_at,
//      licensed_at, first_deal_at, referral_source).

import { useQuery } from "@tanstack/react-query";
import {
  Filter, RefreshCw, TrendingUp, Users, ArrowDown, Flame, Calendar, Layers,
} from "lucide-react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
  ReferenceLine,
} from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { usePageTitle } from "@/hooks/usePageTitle";
import { PageHeader } from "@/components/ui/page-header";
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

function num(v: unknown) { return Number((v as number | string | null | undefined) ?? 0); }

// ---------- Section 1 · stage strip + section 2 · per-source ----------
// Pulled directly from applications using canonical column names. We measure
// the standard 6-stage recruit pipeline:
//   New → Contacted → Course Bought → Exam Passed → Licensed → First Deal

type StageRow = {
  total: number;
  contacted: number;
  course: number;
  exam: number;
  licensed: number;
  first_deal: number;
  avg_days_to_contact: number | null;
  avg_days_to_course: number | null;
  avg_days_to_licensed: number | null;
};

type SourceFunnel = {
  referral_source: string | null;
  total: number;
  contacted: number;
  course: number;
  licensed: number;
  first_deal: number;
  avg_days_to_first_deal: number | null;
};

type WeeklyTrendRow = {
  week_start: string;
  created: number;
  contacted: number;
  course: number;
  licensed: number;
  first_deal: number;
};

const STAGES_NEW = [
  { key: "total",      label: "New",          icon: Users },
  { key: "contacted",  label: "Contacted",    icon: Flame },
  { key: "course",     label: "Course bought",icon: TrendingUp },
  { key: "exam",       label: "Exam passed",  icon: TrendingUp },
  { key: "licensed",   label: "Licensed",     icon: TrendingUp },
  { key: "first_deal", label: "First deal",   icon: TrendingUp },
] as const;

type StageKey = typeof STAGES_NEW[number]["key"];

export default function RecruitingFunnels() {
  usePageTitle("Recruiting Funnels · APEX");

  // legacy totals + by-source view kept feeding the hero (it works fine there)
  const totals = useQuery({
    queryKey: ["funnel-totals"],
    queryFn: async () => {
      const { data } = await supabase
        .from("v_application_conversion_funnel" as never)
        .select("*")
        .maybeSingle();
      return data as unknown as FunnelTotals | null;
    },
    refetchInterval: 60_000,
  });

  // Stage-by-stage live pull (180d window — matches discovery audit)
  const stageRow = useQuery({
    queryKey: ["funnel-stage-row"],
    queryFn: async () => {
      const { data } = await supabase
        .from("applications" as never)
        .select(
          "id, created_at, contacted_at, course_purchased_at, exam_passed_at, licensed_at, first_deal_at"
        )
        .gte("created_at", new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString());
      const rows = (data ?? []) as Array<{
        created_at: string | null;
        contacted_at: string | null;
        course_purchased_at: string | null;
        exam_passed_at: string | null;
        licensed_at: string | null;
        first_deal_at: string | null;
      }>;
      const total = rows.length;
      const contacted = rows.filter(r => r.contacted_at).length;
      const course = rows.filter(r => r.course_purchased_at).length;
      const exam = rows.filter(r => r.exam_passed_at).length;
      const licensed = rows.filter(r => r.licensed_at).length;
      const first_deal = rows.filter(r => r.first_deal_at).length;
      const daysBetween = (a: string | null, b: string | null) => {
        if (!a || !b) return null;
        const d = (new Date(b).getTime() - new Date(a).getTime()) / 86_400_000;
        return d >= 0 ? d : null; // skip inverted timestamps
      };
      const avg = (vals: Array<number | null>) => {
        const clean = vals.filter((v): v is number => v != null);
        return clean.length === 0 ? null : clean.reduce((s, v) => s + v, 0) / clean.length;
      };
      const out: StageRow = {
        total, contacted, course, exam, licensed, first_deal,
        avg_days_to_contact: avg(rows.map(r => daysBetween(r.created_at, r.contacted_at))),
        avg_days_to_course:  avg(rows.map(r => daysBetween(r.contacted_at, r.course_purchased_at))),
        avg_days_to_licensed:avg(rows.map(r => daysBetween(r.exam_passed_at, r.licensed_at))),
      };
      return out;
    },
    refetchInterval: 60_000,
  });

  const sourceFunnel = useQuery({
    queryKey: ["funnel-by-referral-source"],
    queryFn: async () => {
      const { data } = await supabase
        .from("applications" as never)
        .select(
          "referral_source, created_at, contacted_at, course_purchased_at, licensed_at, first_deal_at"
        )
        .gte("created_at", new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString());
      const rows = (data ?? []) as Array<{
        referral_source: string | null;
        created_at: string | null;
        contacted_at: string | null;
        course_purchased_at: string | null;
        licensed_at: string | null;
        first_deal_at: string | null;
      }>;
      const groups = new Map<string | null, typeof rows>();
      for (const r of rows) {
        const k = r.referral_source ?? null;
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k)!.push(r);
      }
      const out: SourceFunnel[] = [];
      for (const [k, arr] of groups) {
        const total = arr.length;
        const contacted = arr.filter(x => x.contacted_at).length;
        const course = arr.filter(x => x.course_purchased_at).length;
        const licensed = arr.filter(x => x.licensed_at).length;
        const first_deal = arr.filter(x => x.first_deal_at).length;
        const days = arr
          .map(x => {
            if (!x.created_at || !x.first_deal_at) return null;
            const d = (new Date(x.first_deal_at).getTime() - new Date(x.created_at).getTime()) / 86_400_000;
            return d >= 0 ? d : null;
          })
          .filter((v): v is number => v != null);
        out.push({
          referral_source: k,
          total, contacted, course, licensed, first_deal,
          avg_days_to_first_deal: days.length ? days.reduce((s, v) => s + v, 0) / days.length : null,
        });
      }
      out.sort((a, b) => b.total - a.total);
      return out.slice(0, 8);
    },
    refetchInterval: 5 * 60_000,
  });

  // Weekly trend (12 weeks) — feeds the bar chart and is also reused
  // downstream by the drop-off heatmap (last 8 weeks).
  const weekly = useQuery({
    queryKey: ["funnel-weekly-12w"],
    queryFn: async () => {
      const { data } = await supabase
        .from("applications" as never)
        .select(
          "created_at, contacted_at, course_purchased_at, exam_passed_at, licensed_at, first_deal_at"
        )
        .gte("created_at", new Date(Date.now() - 12 * 7 * 24 * 60 * 60 * 1000).toISOString());
      const rows = (data ?? []) as Array<{
        created_at: string | null;
        contacted_at: string | null;
        course_purchased_at: string | null;
        exam_passed_at: string | null;
        licensed_at: string | null;
        first_deal_at: string | null;
      }>;
      // bucket by ISO week start (Monday)
      const weekStart = (iso: string) => {
        const d = new Date(iso);
        const day = (d.getUTCDay() + 6) % 7; // 0 = Monday
        d.setUTCDate(d.getUTCDate() - day);
        d.setUTCHours(0, 0, 0, 0);
        return d.toISOString().slice(0, 10);
      };
      const buckets = new Map<string, WeeklyTrendRow>();
      const ensure = (k: string): WeeklyTrendRow => {
        if (!buckets.has(k)) {
          buckets.set(k, {
            week_start: k, created: 0, contacted: 0, course: 0, licensed: 0, first_deal: 0,
          });
        }
        return buckets.get(k)!;
      };
      for (const r of rows) {
        if (!r.created_at) continue;
        const wk = weekStart(r.created_at);
        const b = ensure(wk);
        b.created++;
        if (r.contacted_at) b.contacted++;
        if (r.course_purchased_at) b.course++;
        if (r.licensed_at) b.licensed++;
        if (r.first_deal_at) b.first_deal++;
      }
      const out = Array.from(buckets.values()).sort((a, b) => a.week_start.localeCompare(b.week_start));
      return out;
    },
    refetchInterval: 5 * 60_000,
  });

  const refetchAll = () => {
    totals.refetch();
    stageRow.refetch();
    sourceFunnel.refetch();
    weekly.refetch();
  };
  const t = totals.data;

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

      {/* ─── Hero (kept · premium amber/emerald glow) ───────────────── */}
      {totals.isLoading ? (
        <Skeleton className="h-32 w-full" />
      ) : t ? (
        <div className="relative overflow-hidden rounded-3xl border border-amber-500/25 bg-gradient-to-br from-slate-950 via-slate-900 to-amber-950 text-white shadow-[0_0_48px_-12px_hsl(168_70%_45%/0.25)]">
          <div className="absolute -top-24 -right-24 h-72 w-72 rounded-full bg-amber-500/15 blur-3xl pointer-events-none" />
          <div className="absolute -bottom-32 -left-24 h-80 w-80 rounded-full bg-emerald-500/10 blur-3xl pointer-events-none" />
          <div className="relative p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2.5">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping" />
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
                </span>
                <p className="text-[11px] uppercase tracking-[0.32em] font-bold text-amber-300">Live · 60s refresh</p>
              </div>
              <Badge variant="outline" className="text-11 border-amber-400/40 bg-amber-400/10 text-amber-200">
                Recruiting funnel
              </Badge>
            </div>

            <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
              <div>
                <p className="text-10 uppercase tracking-widest text-white/50 mb-1">Total applicants</p>
                <p className="text-3xl font-black tabular-nums text-white">{num(t.total).toLocaleString()}</p>
              </div>
              <div>
                <p className="text-10 uppercase tracking-widest text-white/50 mb-1">Last 30 days</p>
                <p className="text-3xl font-black tabular-nums text-amber-300">{num(t.last_30d).toLocaleString()}</p>
                <p className="text-10 text-white/40 tabular-nums">+{num(t.last_7d)} last 7d</p>
              </div>
              <div>
                <p className="text-10 uppercase tracking-widest text-white/50 mb-1">% Course bought</p>
                <p className="text-3xl font-black tabular-nums text-emerald-300">{Number(t.pct_paid_of_total).toFixed(1)}%</p>
              </div>
              <div>
                <p className="text-10 uppercase tracking-widest text-white/50 mb-1">% Approved</p>
                <p className="text-3xl font-black tabular-nums text-emerald-300">{Number(t.pct_approved_of_total).toFixed(1)}%</p>
              </div>
              <div>
                <p className="text-10 uppercase tracking-widest text-white/50 mb-1">Contacted</p>
                <p className="text-3xl font-black tabular-nums text-white">{num(t.contacted_count).toLocaleString()}</p>
              </div>
              <div>
                <p className="text-10 uppercase tracking-widest text-white/50 mb-1">Rejected</p>
                <p className="text-3xl font-black tabular-nums text-rose-300">{num(t.rejected_count).toLocaleString()}</p>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* ─── 1 · Stage-by-stage conversion strip ──────────────────── */}
      <StageStrip data={stageRow.data} loading={stageRow.isLoading} />

      {/* ─── 2 · Per-source funnel grid ───────────────────────────── */}
      <SourceGrid data={sourceFunnel.data} loading={sourceFunnel.isLoading} />

      {/* ─── 3 · Weekly trend bars ────────────────────────────────── */}
      <WeeklyTrendChart data={weekly.data} loading={weekly.isLoading} />

      {/* ─── 4 · Drop-off heatmap (stages × weeks) ────────────────── */}
      <DropoffHeatmap data={weekly.data} loading={weekly.isLoading} />
    </div>
  );
}

// =====================================================================
//                         SECTION COMPONENTS
// =====================================================================

function StageStrip({ data, loading }: { data: StageRow | undefined; loading: boolean }) {
  if (loading) {
    return (
      <div className="relative overflow-hidden rounded-3xl border border-amber-500/25 bg-gradient-to-br from-slate-950 via-slate-900 to-amber-950 text-white p-5">
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }
  if (!data || data.total === 0) {
    return (
      <EmptyHero
        eyebrow="Stage funnel"
        color="amber"
        title="Pipeline is empty"
        line="First applicant of the week opens the board."
      />
    );
  }
  const values: number[] = STAGES_NEW.map(s => Number(data[s.key as StageKey] ?? 0));
  const maxV = Math.max(...values, 1);

  // avg days lookup (only available for some transitions)
  const avgDays = (idx: number): string | null => {
    if (idx === 1 && data.avg_days_to_contact != null) return `${data.avg_days_to_contact.toFixed(1)}d avg`;
    if (idx === 2 && data.avg_days_to_course != null) return `${data.avg_days_to_course.toFixed(1)}d avg`;
    if (idx === 4 && data.avg_days_to_licensed != null) return `${data.avg_days_to_licensed.toFixed(1)}d avg`;
    return null;
  };

  return (
    <div className="relative overflow-hidden rounded-3xl border border-amber-500/25 bg-gradient-to-br from-slate-950 via-slate-900 to-amber-950 text-white shadow-[0_0_48px_-12px_hsl(168_70%_45%/0.25)]">
      <div className="absolute -top-24 -right-24 h-72 w-72 rounded-full bg-amber-500/15 blur-3xl pointer-events-none" />
      <div className="absolute -bottom-32 -left-24 h-80 w-80 rounded-full bg-emerald-500/10 blur-3xl pointer-events-none" />
      <div className="relative p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75 animate-ping" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-amber-500" />
            </span>
            <p className="text-[11px] uppercase tracking-[0.32em] font-bold text-amber-300">Stage drop-off · 180d</p>
          </div>
          <Badge variant="outline" className="text-11 border-amber-400/40 bg-amber-400/10 text-amber-200">
            {data.total.toLocaleString()} applicants
          </Badge>
        </div>

        <div className="flex items-end gap-2 sm:gap-3 overflow-x-auto pb-1">
          {STAGES_NEW.map((s, i) => {
            const v = values[i];
            const prev = i > 0 ? values[i - 1] : v;
            const convPct = i === 0 || prev === 0 ? 100 : (v / prev) * 100;
            const dropAbs = i === 0 ? 0 : prev - v;
            const heightPct = (v / maxV) * 100;
            const minH = 14; // floor so a 0-stage still shows
            const Icon = s.icon;
            const days = avgDays(i);
            return (
              <div key={s.key} className="flex items-end gap-2 sm:gap-3 shrink-0">
                {i > 0 && (
                  <div className="flex flex-col items-center justify-end pb-6 text-rose-300/80 shrink-0">
                    <ArrowDown className="h-4 w-4" />
                    <span className="text-[10px] tabular-nums">−{dropAbs.toLocaleString()}</span>
                  </div>
                )}
                <div className="flex flex-col items-center min-w-[110px]">
                  <div
                    className="w-full rounded-2xl border border-white/10 bg-gradient-to-b from-amber-500/15 via-amber-500/5 to-emerald-500/10 flex flex-col justify-end p-3 transition-all"
                    style={{ height: `${Math.max(heightPct, minH) * 1.6 + 60}px` }}
                  >
                    <Icon className="h-4 w-4 text-amber-300 mb-2 self-start" />
                    <p className="text-3xl font-black tabular-nums leading-none">{v.toLocaleString()}</p>
                    <p className="text-[10px] uppercase tracking-widest text-white/50 mt-1.5">{s.label}</p>
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <span className={`text-[11px] font-bold tabular-nums ${convPct >= 60 ? "text-emerald-300" : convPct >= 30 ? "text-amber-300" : "text-rose-300"}`}>
                        {convPct.toFixed(0)}%
                      </span>
                      {days ? (
                        <span className="text-[10px] tabular-nums text-white/50">{days}</span>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function SourceGrid({ data, loading }: { data: SourceFunnel[] | undefined; loading: boolean }) {
  if (loading) {
    return (
      <div className="relative overflow-hidden rounded-3xl border border-amber-500/25 bg-gradient-to-br from-slate-950 via-slate-900 to-amber-950 text-white p-5">
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (!data || data.length === 0) {
    return (
      <EmptyHero
        eyebrow="Source attribution"
        color="amber"
        title="No referral source tagged"
        line="UTM the next link · attribution opens the playbook."
      />
    );
  }

  return (
    <div className="relative overflow-hidden rounded-3xl border border-amber-500/25 bg-gradient-to-br from-slate-950 via-slate-900 to-amber-950 text-white shadow-[0_0_48px_-12px_hsl(168_70%_45%/0.25)]">
      <div className="absolute -top-24 -right-24 h-72 w-72 rounded-full bg-amber-500/15 blur-3xl pointer-events-none" />
      <div className="absolute -bottom-32 -left-24 h-80 w-80 rounded-full bg-emerald-500/10 blur-3xl pointer-events-none" />
      <div className="relative p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75 animate-ping" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-amber-500" />
            </span>
            <p className="text-[11px] uppercase tracking-[0.32em] font-bold text-amber-300">Source attribution · 180d</p>
          </div>
          <Badge variant="outline" className="text-11 border-amber-400/40 bg-amber-400/10 text-amber-200">
            <Users className="h-3 w-3 mr-1" />
            {data.length} sources
          </Badge>
        </div>

        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2">
          {data.map((row) => {
            const convPct = row.total > 0 ? (row.licensed / row.total) * 100 : 0;
            const tone =
              convPct >= 10 ? "border-emerald-400/30 bg-emerald-500/5" :
              convPct >= 5  ? "border-amber-400/30 bg-amber-500/5" :
                              "border-rose-400/20 bg-rose-500/5";
            const accent =
              convPct >= 10 ? "text-emerald-300" :
              convPct >= 5  ? "text-amber-300" :
                              "text-rose-300";
            const label = row.referral_source ?? "Unknown";
            const courseRate = row.total > 0 ? (row.course / row.total) * 100 : 0;
            const contactRate = row.total > 0 ? (row.contacted / row.total) * 100 : 0;
            return (
              <div
                key={label}
                className={`rounded-2xl border ${tone} p-4`}
              >
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <p className="text-[10px] uppercase tracking-widest text-white/50 mb-1">Source</p>
                    <p className="text-15 font-bold text-white capitalize">{label.replace(/-/g, " ")}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] uppercase tracking-widest text-white/50 mb-1">Licensed %</p>
                    <p className={`text-3xl font-black tabular-nums leading-none ${accent}`}>
                      {convPct.toFixed(1)}%
                    </p>
                  </div>
                </div>
                <div className="grid grid-cols-4 gap-2 text-center">
                  <Cell label="Total" value={row.total} accent="text-white" />
                  <Cell label="Contacted" value={row.contacted} sub={`${contactRate.toFixed(0)}%`} accent="text-amber-200" />
                  <Cell label="Course" value={row.course} sub={`${courseRate.toFixed(0)}%`} accent="text-emerald-200" />
                  <Cell label="Licensed" value={row.licensed} accent={accent} />
                </div>
                <div className="mt-3 flex items-center justify-between text-[11px] text-white/60">
                  <span>First deal: <span className="tabular-nums text-white">{row.first_deal}</span></span>
                  <span>
                    {row.avg_days_to_first_deal != null
                      ? <>Avg <span className="tabular-nums text-white">{row.avg_days_to_first_deal.toFixed(0)}d</span> to first deal</>
                      : <span className="text-white/40">No close yet</span>}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Cell({ label, value, sub, accent }: { label: string; value: number; sub?: string; accent: string }) {
  return (
    <div className="rounded-lg border border-white/5 bg-black/20 px-2 py-2">
      <p className="text-[9px] uppercase tracking-widest text-white/40">{label}</p>
      <p className={`text-base font-bold tabular-nums leading-tight ${accent}`}>{value.toLocaleString()}</p>
      {sub ? <p className="text-[10px] tabular-nums text-white/40">{sub}</p> : null}
    </div>
  );
}

function WeeklyTrendChart({ data, loading }: { data: WeeklyTrendRow[] | undefined; loading: boolean }) {
  if (loading) {
    return (
      <div className="relative overflow-hidden rounded-3xl border border-emerald-500/25 bg-gradient-to-br from-slate-950 via-slate-900 to-emerald-950 text-white p-5">
        <Skeleton className="h-60 w-full" />
      </div>
    );
  }
  if (!data || data.length === 0) {
    return (
      <EmptyHero
        eyebrow="Weekly hire pace"
        color="emerald"
        title="First week of data opens the chart"
        line="Hold the Standard. Average is the disease."
      />
    );
  }
  // average created across the visible window — used as a reference line
  const avg = data.reduce((s, r) => s + r.created, 0) / data.length;

  const chartData = data.map(r => ({
    week: r.week_start.slice(5), // MM-DD label
    Created: r.created,
    Contacted: r.contacted,
    Course: r.course,
    Licensed: r.licensed,
  }));

  return (
    <div className="relative overflow-hidden rounded-3xl border border-emerald-500/25 bg-gradient-to-br from-slate-950 via-slate-900 to-emerald-950 text-white shadow-[0_0_48px_-12px_hsl(168_70%_45%/0.25)]">
      <div className="absolute -top-24 -right-24 h-72 w-72 rounded-full bg-emerald-500/15 blur-3xl pointer-events-none" />
      <div className="absolute -bottom-32 -left-24 h-80 w-80 rounded-full bg-amber-500/10 blur-3xl pointer-events-none" />
      <div className="relative p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
            </span>
            <p className="text-[11px] uppercase tracking-[0.32em] font-bold text-emerald-300">Weekly trend · 12 weeks</p>
          </div>
          <Badge variant="outline" className="text-11 border-emerald-400/40 bg-emerald-400/10 text-emerald-200">
            <Calendar className="h-3 w-3 mr-1" />
            avg {avg.toFixed(0)}/wk
          </Badge>
        </div>

        <div className="h-60">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 6, right: 12, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="grad-created" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="rgba(245,158,11,0.95)" />
                  <stop offset="100%" stopColor="rgba(245,158,11,0.35)" />
                </linearGradient>
                <linearGradient id="grad-contacted" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="rgba(16,185,129,0.95)" />
                  <stop offset="100%" stopColor="rgba(16,185,129,0.35)" />
                </linearGradient>
                <linearGradient id="grad-course" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="rgba(56,189,248,0.95)" />
                  <stop offset="100%" stopColor="rgba(56,189,248,0.35)" />
                </linearGradient>
                <linearGradient id="grad-licensed" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="rgba(244,114,182,0.95)" />
                  <stop offset="100%" stopColor="rgba(244,114,182,0.45)" />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
              <XAxis dataKey="week" tick={{ fill: "rgba(255,255,255,0.55)", fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: "rgba(255,255,255,0.55)", fontSize: 10 }} axisLine={false} tickLine={false} width={28} />
              <Tooltip
                cursor={{ fill: "rgba(255,255,255,0.04)" }}
                contentStyle={{
                  background: "rgba(2,6,23,0.95)",
                  border: "1px solid rgba(245,158,11,0.35)",
                  borderRadius: 12,
                  color: "white",
                  fontSize: 12,
                }}
              />
              <ReferenceLine y={avg} stroke="rgba(245,158,11,0.55)" strokeDasharray="4 4" />
              <Bar dataKey="Created" stackId="a" fill="url(#grad-created)" radius={[6, 6, 0, 0]} />
              <Bar dataKey="Contacted" stackId="b" fill="url(#grad-contacted)" radius={[6, 6, 0, 0]} />
              <Bar dataKey="Course" stackId="c" fill="url(#grad-course)" radius={[6, 6, 0, 0]} />
              <Bar dataKey="Licensed" stackId="d" fill="url(#grad-licensed)" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

function DropoffHeatmap({ data, loading }: { data: WeeklyTrendRow[] | undefined; loading: boolean }) {
  if (loading) {
    return (
      <div className="relative overflow-hidden rounded-3xl border border-rose-500/25 bg-gradient-to-br from-slate-950 via-slate-900 to-rose-950 text-white p-5">
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (!data || data.length === 0) {
    return (
      <EmptyHero
        eyebrow="Drop-off heatmap"
        color="rose"
        title="Heatmap warms up next week"
        line="Once a stage clogs · this panel calls it."
      />
    );
  }

  // last 8 weeks
  const last8 = data.slice(-8);
  // rows: stage drop-off (created→contacted, contacted→course, course→licensed)
  type Stage = { key: string; label: string; from: keyof WeeklyTrendRow; to: keyof WeeklyTrendRow };
  const stages: Stage[] = [
    { key: "ct", label: "New → Contacted",     from: "created",   to: "contacted" },
    { key: "co", label: "Contacted → Course",  from: "contacted", to: "course" },
    { key: "li", label: "Course → Licensed",   from: "course",    to: "licensed" },
    { key: "fd", label: "Licensed → 1st Deal", from: "licensed",  to: "first_deal" },
  ];

  // For each cell compute drop pct. Heat = larger drop = hotter rose.
  const cells = stages.map(stage => {
    return {
      stage,
      values: last8.map(wk => {
        const from = Number(wk[stage.from] ?? 0);
        const to = Number(wk[stage.to] ?? 0);
        if (from === 0) return { drop: null as number | null, from, to };
        const drop = (from - to) / from;
        return { drop, from, to };
      }),
    };
  });

  const toneFor = (drop: number | null): { bg: string; border: string; text: string } => {
    if (drop == null) return { bg: "bg-white/5", border: "border-white/10", text: "text-white/40" };
    if (drop <= 0.20) return { bg: "bg-emerald-500/30", border: "border-emerald-400/40", text: "text-emerald-100" };
    if (drop <= 0.50) return { bg: "bg-amber-500/25",  border: "border-amber-400/40",  text: "text-amber-100" };
    if (drop <= 0.80) return { bg: "bg-rose-500/30",   border: "border-rose-400/45",   text: "text-rose-100" };
    return { bg: "bg-rose-600/55", border: "border-rose-400/60", text: "text-white" };
  };

  return (
    <div className="relative overflow-hidden rounded-3xl border border-rose-500/25 bg-gradient-to-br from-slate-950 via-slate-900 to-rose-950 text-white shadow-[0_0_48px_-12px_hsl(168_70%_45%/0.25)]">
      <div className="absolute -top-24 -right-24 h-72 w-72 rounded-full bg-rose-500/15 blur-3xl pointer-events-none" />
      <div className="absolute -bottom-32 -left-24 h-80 w-80 rounded-full bg-emerald-500/10 blur-3xl pointer-events-none" />
      <div className="relative p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75 animate-ping" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-rose-500" />
            </span>
            <p className="text-[11px] uppercase tracking-[0.32em] font-bold text-rose-300">Drop-off heatmap · last 8 weeks</p>
          </div>
          <Badge variant="outline" className="text-11 border-rose-400/40 bg-rose-400/10 text-rose-200">
            <Layers className="h-3 w-3 mr-1" />
            stage × week
          </Badge>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-12 border-separate border-spacing-1">
            <thead>
              <tr>
                <th className="text-left text-[10px] uppercase tracking-widest text-white/50 font-semibold pr-2 pb-1">Stage</th>
                {last8.map(wk => (
                  <th key={wk.week_start} className="text-center text-[10px] tabular-nums text-white/50 font-semibold pb-1">
                    {wk.week_start.slice(5)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {cells.map(row => (
                <tr key={row.stage.key}>
                  <td className="text-[11px] text-white/80 pr-3 py-1 whitespace-nowrap">{row.stage.label}</td>
                  {row.values.map((c, idx) => {
                    const tone = toneFor(c.drop);
                    return (
                      <td key={idx} className="p-0">
                        <div className={`rounded-md border ${tone.border} ${tone.bg} h-12 flex flex-col items-center justify-center`}>
                          <span className={`text-xs font-bold tabular-nums ${tone.text}`}>
                            {c.drop == null ? "—" : `${(c.drop * 100).toFixed(0)}%`}
                          </span>
                          <span className={`text-[9px] tabular-nums ${tone.text}/70`}>
                            {c.from}→{c.to}
                          </span>
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-3 flex items-center gap-3 text-[10px] text-white/55">
          <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded bg-emerald-500/30 border border-emerald-400/40" /> ≤20% drop</span>
          <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded bg-amber-500/25 border border-amber-400/40" /> ≤50%</span>
          <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded bg-rose-500/30 border border-rose-400/45" /> ≤80%</span>
          <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded bg-rose-600/55 border border-rose-400/60" /> &gt;80%</span>
        </div>
      </div>
    </div>
  );
}

function EmptyHero({
  eyebrow, color, title, line,
}: { eyebrow: string; color: "amber" | "emerald" | "rose"; title: string; line: string }) {
  const ring =
    color === "amber"   ? "border-amber-500/25 to-amber-950 shadow-[0_0_48px_-12px_hsl(168_70%_45%/0.25)]" :
    color === "emerald" ? "border-emerald-500/25 to-emerald-950 shadow-[0_0_48px_-12px_hsl(168_70%_45%/0.25)]" :
                          "border-rose-500/25 to-rose-950 shadow-[0_0_48px_-12px_hsl(168_70%_45%/0.25)]";
  const dot =
    color === "amber" ? "bg-amber-500" :
    color === "emerald" ? "bg-emerald-500" :
    "bg-rose-500";
  const eye =
    color === "amber" ? "text-amber-300" :
    color === "emerald" ? "text-emerald-300" :
    "text-rose-300";
  return (
    <div className={`relative overflow-hidden rounded-3xl border bg-gradient-to-br from-slate-950 via-slate-900 ${ring} text-white`}>
      <div className="relative p-6">
        <div className="flex items-center gap-2.5 mb-2">
          <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${dot}`} />
          <p className={`text-[11px] uppercase tracking-[0.32em] font-bold ${eye}`}>{eyebrow}</p>
        </div>
        <p className="text-lg font-bold">{title}</p>
        <p className="text-sm text-white/70 mt-1">{line}</p>
      </div>
    </div>
  );
}
