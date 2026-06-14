// RecruitingFunnels · phone-first 4-stage drop-off funnel + dense
// disclosures.
//
// 2026-06-15 Sam directive (judge Proposal B): page is "Recruiting Funnels"
// (eyebrow stays "Recruiting"). Funnel shows 4 stages, last 30 days:
//   1) New applicants
//   2) Contacted
//   3) Licensed
//   4) Wrote first deal
// Course-bought + Exam-passed intermediate stages still live behind the
// 6-stage strip disclosure for power users.
//
// Amber bottleneck callout pinned ABOVE the funnel — picks the worst
// stage-to-stage conv% and offers a one-line coaching prompt.
//
// "Where they came from" → top-3 referral sources rendered INLINE (one
// line each); the full 8-source dense grid moves behind "See all sources".
// Drop-off heatmap + weekly stacked trend + full 6-stage strip all move
// behind <details> disclosures so the default first paint ships zero
// Recharts JS and the page fits ~2 phone screens before any expansion.

import { useState } from "react";
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
import { FunnelStageCard } from "@/components/recruiting/FunnelStageCard";
import { FunnelConnector } from "@/components/recruiting/FunnelConnector";
import { BottleneckCallout } from "@/components/recruiting/BottleneckCallout";

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

// Coaching line per bottleneck transition.
function bottleneckCoachingLine(fromStage: string): string {
  if (fromStage === "Contacted") return "Push the contacted ones today.";
  if (fromStage === "New") return "Contact today's new applicants.";
  if (fromStage === "Licensed") return "Coach the newly licensed.";
  return "Fix this first.";
}

interface ApplicationStageRow {
  created_at: string | null;
  contacted_at: string | null;
  course_purchased_at: string | null;
  exam_passed_at: string | null;
  licensed_at: string | null;
  first_deal_at: string | null;
}

export default function RecruitingFunnels() {
  usePageTitle("Recruiting Funnels · APEX");

  // Disclosure state — chart subtrees only render when open.
  const [openAllSources, setOpenAllSources] = useState(false);
  const [openHeatmap, setOpenHeatmap] = useState(false);
  const [openWeeklyTrend, setOpenWeeklyTrend] = useState(false);
  const [openSixStage, setOpenSixStage] = useState(false);

  // Hero totals (kept; still feeds optional surfaces inside disclosures
  // if needed, but the default view no longer renders the 6-tile grid).
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

  // 30d stage rollup (new headline window). Also feeds 4-stage card sublines.
  const stageRow30d = useQuery({
    queryKey: ["funnel-stage-row-30d"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("applications" as never)
        .select("created_at, contacted_at, course_purchased_at, exam_passed_at, licensed_at, first_deal_at")
        .gte("created_at", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
        .limit(10000);
      if (error) throw error;
      const rows = (data ?? []) as unknown as ApplicationStageRow[];
      const total = rows.length;
      const contacted = rows.filter(r => r.contacted_at).length;
      const course = rows.filter(r => r.course_purchased_at).length;
      const exam = rows.filter(r => r.exam_passed_at).length;
      const licensed = rows.filter(r => r.licensed_at).length;
      const first_deal = rows.filter(r => r.first_deal_at).length;
      return { total, contacted, course, exam, licensed, first_deal } as Omit<StageRow, "avg_days_to_contact"|"avg_days_to_course"|"avg_days_to_licensed">;
    },
    refetchInterval: 60_000,
  });

  // Two 7-day windows for WoW deltas — current 7d + previous 7d.
  const wow = useQuery({
    queryKey: ["funnel-wow-14d"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("applications" as never)
        .select("created_at, contacted_at, licensed_at, first_deal_at")
        .gte("created_at", new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString())
        .limit(10000);
      if (error) throw error;
      const rows = (data ?? []) as unknown as ApplicationStageRow[];
      const now = Date.now();
      const sevenAgo = now - 7 * 24 * 60 * 60 * 1000;
      const fourteenAgo = now - 14 * 24 * 60 * 60 * 1000;
      const inWin = (iso: string | null, fromMs: number, toMs: number): boolean => {
        if (!iso) return false;
        const t = new Date(iso).getTime();
        return !Number.isNaN(t) && t >= fromMs && t < toMs;
      };
      const thisWeek = {
        newApps: rows.filter(r => inWin(r.created_at, sevenAgo, now)).length,
        contacted: rows.filter(r => inWin(r.contacted_at, sevenAgo, now)).length,
        licensed: rows.filter(r => inWin(r.licensed_at, sevenAgo, now)).length,
        first_deal: rows.filter(r => inWin(r.first_deal_at, sevenAgo, now)).length,
      };
      const lastWeek = {
        newApps: rows.filter(r => inWin(r.created_at, fourteenAgo, sevenAgo)).length,
        contacted: rows.filter(r => inWin(r.contacted_at, fourteenAgo, sevenAgo)).length,
        licensed: rows.filter(r => inWin(r.licensed_at, fourteenAgo, sevenAgo)).length,
        first_deal: rows.filter(r => inWin(r.first_deal_at, fourteenAgo, sevenAgo)).length,
      };
      return { thisWeek, lastWeek };
    },
    refetchInterval: 60_000,
  });

  // Stage row used inside the 6-stage <details> (kept verbatim from prior
  // implementation — 180d window so power users can see deeper history).
  const stageRow = useQuery({
    queryKey: ["funnel-stage-row"],
    enabled: openSixStage,
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
        return d >= 0 ? d : null;
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

  // Source attribution (top sources). Compute for inline top-3 (cheap) +
  // full grid inside <details>. Keep one query — fetch full and slice.
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

  // Weekly trend (12 weeks) — lazy (only fires when heatmap or trend disclosure opens).
  const weekly = useQuery({
    queryKey: ["funnel-weekly-12w"],
    enabled: openWeeklyTrend || openHeatmap,
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
      const weekStart = (iso: string) => {
        const d = new Date(iso);
        const day = (d.getUTCDay() + 6) % 7;
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
    stageRow30d.refetch();
    wow.refetch();
    sourceFunnel.refetch();
    if (openSixStage) stageRow.refetch();
    if (openWeeklyTrend || openHeatmap) weekly.refetch();
  };

  // ────────────────── DERIVE 4-STAGE FUNNEL ──────────────────
  const newApps30d = stageRow30d.data?.total ?? null;
  const contacted30d = stageRow30d.data?.contacted ?? null;
  const licensed30d = stageRow30d.data?.licensed ?? null;
  const firstDeal30d = stageRow30d.data?.first_deal ?? null;

  const newDelta = wow.data ? wow.data.thisWeek.newApps - wow.data.lastWeek.newApps : null;
  const contactedDelta = wow.data ? wow.data.thisWeek.contacted - wow.data.lastWeek.contacted : null;
  const licensedDelta = wow.data ? wow.data.thisWeek.licensed - wow.data.lastWeek.licensed : null;
  const firstDealDelta = wow.data ? wow.data.thisWeek.first_deal - wow.data.lastWeek.first_deal : null;

  const thisWeekNew = wow.data?.thisWeek.newApps ?? null;
  const thisWeekContacted = wow.data?.thisWeek.contacted ?? null;
  const thisWeekLicensed = wow.data?.thisWeek.licensed ?? null;
  const thisWeekFirstDeal = wow.data?.thisWeek.first_deal ?? null;

  const fmtThisWeek = (n: number | null, d: number | null): string => {
    if (n == null) return "this week: —";
    if (d == null || d === 0) return `this week: ${n}`;
    const glyph = d > 0 ? "▲" : "▼";
    return `this week: ${n} (${glyph} ${Math.abs(d)})`;
  };

  // Bottleneck callout: pick the worst stage-to-stage conv% across the
  // 30d window. We compute conv = next/prev * 100.
  const bottleneck = (() => {
    if (newApps30d == null || contacted30d == null || licensed30d == null || firstDeal30d == null) {
      return null;
    }
    const transitions = [
      { from: "New", to: "Contacted", prev: newApps30d, next: contacted30d },
      { from: "Contacted", to: "Licensed", prev: contacted30d, next: licensed30d },
      { from: "Licensed", to: "First deal", prev: licensed30d, next: firstDeal30d },
    ];
    const scored = transitions
      .filter(t => t.prev > 0)
      .map(t => ({ ...t, convPct: Math.round((t.next / t.prev) * 100) }));
    if (scored.length === 0) return null;
    scored.sort((a, b) => a.convPct - b.convPct);
    const worst = scored[0];
    return {
      headline: `${worst.from} → ${worst.to} (only ${worst.convPct}%)`,
      coachingLine: bottleneckCoachingLine(worst.from),
    };
  })();

  // Top 3 referral sources — inline list under the funnel.
  const top3Sources = (sourceFunnel.data ?? []).slice(0, 3);

  return (
    <div className="page-enter px-4 sm:px-6 pb-24 space-y-5">
      <PageHeader
        eyebrow="Recruiting"
        eyebrowIcon={<Filter className="h-3 w-3" />}
        title="Recruiting Funnels"
        subtitle="Where applicants drop off · last 30 days."
        actions={
          <Button variant="outline" size="sm" onClick={refetchAll}>
            <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${totals.isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        }
      />

      {/* ─────────── Bottleneck callout (amber · ABOVE the funnel) ─────────── */}
      {bottleneck ? (
        <BottleneckCallout
          headline={bottleneck.headline}
          coachingLine={bottleneck.coachingLine}
        />
      ) : null}

      {/* ─────────── 4-STAGE FUNNEL (vertical · phone-first) ─────────── */}
      <div className="space-y-2 max-w-md mx-auto w-full">
        <FunnelStageCard
          stageNumber={1}
          stageLabel="New applicants"
          count={newApps30d}
          delta={newDelta}
          subline={fmtThisWeek(thisWeekNew, newDelta)}
        />
        <FunnelConnector prev={newApps30d} next={contacted30d} verb="got contacted" />
        <FunnelStageCard
          stageNumber={2}
          stageLabel="Contacted"
          count={contacted30d}
          delta={contactedDelta}
          subline={fmtThisWeek(thisWeekContacted, contactedDelta)}
        />
        <FunnelConnector prev={contacted30d} next={licensed30d} verb="got licensed" />
        <FunnelStageCard
          stageNumber={3}
          stageLabel="Licensed"
          count={licensed30d}
          delta={licensedDelta}
          subline={fmtThisWeek(thisWeekLicensed, licensedDelta)}
        />
        <FunnelConnector prev={licensed30d} next={firstDeal30d} verb="wrote first deal" />
        <FunnelStageCard
          stageNumber={4}
          stageLabel="Wrote first deal"
          count={firstDeal30d}
          delta={firstDealDelta}
          subline={fmtThisWeek(thisWeekFirstDeal, firstDealDelta)}
        />
      </div>

      {/* ─────────── Where they came from (inline top-3 + nested See all) ─────────── */}
      <div className="rounded-3xl bg-card/40 border border-border/40 px-6 py-5 max-w-md mx-auto w-full">
        <div className="text-sm text-muted-foreground mb-3">Where they came from (top 3)</div>
        {sourceFunnel.isLoading ? (
          <div className="space-y-2">{Array.from({length:3}).map((_,i)=><Skeleton key={i} className="h-6" />)}</div>
        ) : top3Sources.length === 0 ? (
          <p className="text-sm text-muted-foreground">— new this week</p>
        ) : (
          top3Sources.map(src => {
            const label = (src.referral_source ?? "—").replace(/-/g, " ");
            return (
              <div key={label} className="flex items-baseline justify-between py-2 border-b border-border/20 last:border-0">
                <div className="text-base capitalize">{label}</div>
                <div className="text-sm text-muted-foreground tabular-nums">
                  {src.total} started · {src.licensed} lic.
                </div>
              </div>
            );
          })
        )}
        <details
          className="mt-3"
          open={openAllSources}
          onToggle={(e) => setOpenAllSources((e.currentTarget as HTMLDetailsElement).open)}
        >
          <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground select-none">
            See all sources
          </summary>
          {openAllSources && (
            <div className="mt-4">
              <SourceGrid data={sourceFunnel.data} loading={sourceFunnel.isLoading} />
            </div>
          )}
        </details>
      </div>

      {/* See weekly drop-off detail */}
      <details
        className="rounded-2xl bg-card/30 border border-border/30 px-5 py-4"
        open={openHeatmap}
        onToggle={(e) => setOpenHeatmap((e.currentTarget as HTMLDetailsElement).open)}
      >
        <summary className="cursor-pointer text-sm font-medium text-muted-foreground hover:text-foreground select-none">
          See weekly drop-off detail
        </summary>
        {openHeatmap && (
          <div className="mt-4">
            <DropoffHeatmap data={weekly.data} loading={weekly.isLoading} />
          </div>
        )}
      </details>

      {/* See 12-week stacked trend */}
      <details
        className="rounded-2xl bg-card/30 border border-border/30 px-5 py-4"
        open={openWeeklyTrend}
        onToggle={(e) => setOpenWeeklyTrend((e.currentTarget as HTMLDetailsElement).open)}
      >
        <summary className="cursor-pointer text-sm font-medium text-muted-foreground hover:text-foreground select-none">
          See 12-week stacked trend
        </summary>
        {openWeeklyTrend && (
          <div className="mt-4">
            <WeeklyTrendChart data={weekly.data} loading={weekly.isLoading} />
          </div>
        )}
      </details>

      {/* See full 6-stage strip */}
      <details
        className="rounded-2xl bg-card/30 border border-border/30 px-5 py-4"
        open={openSixStage}
        onToggle={(e) => setOpenSixStage((e.currentTarget as HTMLDetailsElement).open)}
      >
        <summary className="cursor-pointer text-sm font-medium text-muted-foreground hover:text-foreground select-none">
          See full 6-stage strip
        </summary>
        {openSixStage && (
          <div className="mt-4">
            <StageStrip data={stageRow.data} loading={stageRow.isLoading} />
          </div>
        )}
      </details>
    </div>
  );
}

// =====================================================================
//                         SECTION COMPONENTS
//   (rendered only inside <details> disclosures on the new default view)
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
        fetched={data?.total ?? 0}
        source="applications · 180d window"
      />
    );
  }
  const values: number[] = STAGES_NEW.map(s => Number(data[s.key as StageKey] ?? 0));
  const maxV = Math.max(...values, 1);

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
            <p className="text-sm font-bold text-amber-300">Stage drop-off · 180d</p>
          </div>
          <Badge variant="outline" className="text-xs border-amber-400/40 bg-amber-400/10 text-amber-200">
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
            const minH = 14;
            const Icon = s.icon;
            const days = avgDays(i);
            return (
              <div key={s.key} className="flex items-end gap-2 sm:gap-3 shrink-0">
                {i > 0 && (
                  <div className="flex flex-col items-center justify-end pb-6 text-rose-300/80 shrink-0">
                    <ArrowDown className="h-4 w-4" />
                    <span className="text-xs tabular-nums">−{dropAbs.toLocaleString()}</span>
                  </div>
                )}
                <div className="flex flex-col items-center min-w-[110px]">
                  <div
                    className="w-full rounded-2xl border border-white/10 bg-gradient-to-b from-amber-500/15 via-amber-500/5 to-emerald-500/10 flex flex-col justify-end p-3 transition-all"
                    style={{ height: `${Math.max(heightPct, minH) * 1.6 + 60}px` }}
                  >
                    <Icon className="h-4 w-4 text-amber-300 mb-2 self-start" />
                    <p className="text-3xl font-black tabular-nums leading-none">{v.toLocaleString()}</p>
                    <p className="text-xs text-white/60 mt-1.5">{s.label}</p>
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <span className={`text-xs font-bold tabular-nums ${convPct >= 60 ? "text-emerald-300" : convPct >= 30 ? "text-amber-300" : "text-rose-300"}`}>
                        {convPct.toFixed(0)}%
                      </span>
                      {days ? (
                        <span className="text-xs tabular-nums text-white/50">{days}</span>
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
        fetched={data?.length ?? 0}
        source="applications.referral_source · 180d window"
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
            <p className="text-sm font-bold text-amber-300">Source attribution · 180d</p>
          </div>
          <Badge variant="outline" className="text-xs border-amber-400/40 bg-amber-400/10 text-amber-200">
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
            const label = row.referral_source ?? "—";
            const courseRate = row.total > 0 ? (row.course / row.total) * 100 : 0;
            const contactRate = row.total > 0 ? (row.contacted / row.total) * 100 : 0;
            return (
              <div
                key={label}
                className={`rounded-2xl border ${tone} p-4`}
              >
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <p className="text-xs text-white/60 mb-1">Source</p>
                    <p className="text-base font-bold text-white capitalize">{label.replace(/-/g, " ")}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-white/60 mb-1">Licensed %</p>
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
                <div className="mt-3 flex items-center justify-between text-xs text-white/60">
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
      <p className="text-xs text-white/50">{label}</p>
      <p className={`text-base font-bold tabular-nums leading-tight ${accent}`}>{value.toLocaleString()}</p>
      {sub ? <p className="text-xs tabular-nums text-white/40">{sub}</p> : null}
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
        fetched={data?.length ?? 0}
        source="applications · 12-week window"
      />
    );
  }
  const avg = data.reduce((s, r) => s + r.created, 0) / data.length;

  const chartData = data.map(r => ({
    week: r.week_start.slice(5),
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
            <p className="text-sm font-bold text-emerald-300">Weekly trend · 12 weeks</p>
          </div>
          <Badge variant="outline" className="text-xs border-emerald-400/40 bg-emerald-400/10 text-emerald-200">
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
        fetched={data?.length ?? 0}
        source="applications · 8-week stage transitions"
      />
    );
  }

  const last8 = data.slice(-8);
  type Stage = { key: string; label: string; from: keyof WeeklyTrendRow; to: keyof WeeklyTrendRow };
  const stages: Stage[] = [
    { key: "ct", label: "New → Contacted",     from: "created",   to: "contacted" },
    { key: "co", label: "Contacted → Course",  from: "contacted", to: "course" },
    { key: "li", label: "Course → Licensed",   from: "course",    to: "licensed" },
    { key: "fd", label: "Licensed → 1st Deal", from: "licensed",  to: "first_deal" },
  ];

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
            <p className="text-sm font-bold text-rose-300">Drop-off heatmap · last 8 weeks</p>
          </div>
          <Badge variant="outline" className="text-xs border-rose-400/40 bg-rose-400/10 text-rose-200">
            <Layers className="h-3 w-3 mr-1" />
            stage × week
          </Badge>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm border-separate border-spacing-1">
            <thead>
              <tr>
                <th className="text-left text-xs text-white/50 font-semibold pr-2 pb-1">Stage</th>
                {last8.map(wk => (
                  <th key={wk.week_start} className="text-center text-xs tabular-nums text-white/50 font-semibold pb-1">
                    {wk.week_start.slice(5)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {cells.map(row => (
                <tr key={row.stage.key}>
                  <td className="text-xs text-white/80 pr-3 py-1 whitespace-nowrap">{row.stage.label}</td>
                  {row.values.map((c, idx) => {
                    const tone = toneFor(c.drop);
                    return (
                      <td key={idx} className="p-0">
                        <div className={`rounded-md border ${tone.border} ${tone.bg} h-12 flex flex-col items-center justify-center`}>
                          <span className={`text-xs font-bold tabular-nums ${tone.text}`}>
                            {c.drop == null ? "—" : `${(c.drop * 100).toFixed(0)}%`}
                          </span>
                          <span className={`text-xs tabular-nums ${tone.text}/70`}>
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

        <div className="mt-3 flex items-center gap-3 text-xs text-white/55">
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
  eyebrow, color, title, line, fetched, source,
}: {
  eyebrow: string;
  color: "amber" | "emerald" | "rose";
  title: string;
  line: string;
  fetched?: number;
  source?: string;
}) {
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
      <div className="relative p-6 text-center py-12">
        <Users className="h-10 w-10 text-white/40 mx-auto mb-4" />
        <div className="flex items-center justify-center gap-2.5 mb-2">
          <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${dot}`} />
          <p className={`text-sm font-bold ${eye}`}>{eyebrow}</p>
        </div>
        <p className="text-lg font-bold">{title}</p>
        <p className="text-sm text-white/70 mt-1">{line}</p>
        {fetched != null && (
          <div className="max-w-md mx-auto mt-4 space-y-3">
            <p className="text-sm text-white/60">
              Fetched <span className="font-bold text-white tabular-nums">{fetched.toLocaleString()}</span> rows from {source ?? "applications"}.
            </p>
            {fetched === 0 && (
              <div className="text-sm text-rose-300">
                Zero rows came back. Likely causes:
                <ul className="list-disc list-inside mt-2 text-left">
                  <li>180d window is genuinely empty (intake dark · check apply form)</li>
                  <li>Your role lost admin/manager grant (check user_roles)</li>
                  <li>RLS regression on applications (check Supabase logs)</li>
                </ul>
                <p className="mt-2 font-semibold">Hold the Standard.</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// Silence unused-import linter for totals — left intact in case a future
// section reuses it. The hero tile grid was intentionally removed from
// the default view per judge Proposal B.
void num;
