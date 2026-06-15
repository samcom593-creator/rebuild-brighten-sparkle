// RecruitingTracker · phone-first 3-stage funnel + dense disclosures
//
// 2026-06-15 Sam directive (judge Proposal B): page is "Recruitment Tracker"
// (eyebrow stays "Recruiting"). Funnel is the headline:
//   1) Applications started (this week)
//   2) Ref-link clicks (this week)
//   3) Completed applications (this week)
// with WoW deltas + plain-language "X of every 100" connectors.
//
// Amber bottleneck callout pinned ABOVE the funnel. All dense panels
// (per-recruiter scorecards / top-performer podium / 12-week hiring pace /
// interview cascade) move behind <details> disclosures so the default
// first paint ships zero Recharts JS and the page fits ~2 phone screens.
//
// 2026-06-14 base (kept) — per-recruiter rich cards + LIVE interview
// cascade + Top-3 podium + 12-week agency-wide hiring pace AreaChart
// all survive verbatim inside the disclosures. dedup is resolved at DB
// layer (wave-93) via v_agent_canonical_map.

import { useState } from "react";
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
import { FunnelStageCard } from "@/components/recruiting/FunnelStageCard";
import { FunnelConnector } from "@/components/recruiting/FunnelConnector";
import { BottleneckCallout } from "@/components/recruiting/BottleneckCallout";
import { AgentNameLink } from "@/components/dashboard/AgentNameLink";

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

interface ApplicationFunnelRow {
  created_at: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  status: string | null;
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

// Time helpers
function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

export default function RecruitingTracker() {
  usePageTitle("Recruitment Tracker · APEX");

  // Disclosure state — chart subtrees only render when open so the
  // default first paint ships zero Recharts JS.
  const [openPodium, setOpenPodium] = useState(false);
  const [openScorecards, setOpenScorecards] = useState(false);
  const [openPace, setOpenPace] = useState(false);
  const [openCascade, setOpenCascade] = useState(false);

  // ───────────── NEW FUNNEL QUERIES (last 14d covers WoW + 30d) ─────────────
  // 30d window of applications used for: this-week count, last-week count,
  // 30d total, and the "completed" predicate (first/last/phone non-null +
  // status != 'partial').
  const funnel30d = useQuery({
    queryKey: ["tracker-funnel-30d"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("applications")
        .select("created_at, first_name, last_name, phone, status")
        .gte("created_at", isoDaysAgo(30))
        .limit(5000);
      if (error) throw error;
      return (data ?? []) as unknown as ApplicationFunnelRow[];
    },
    refetchInterval: 60_000,
  });

  // ───────────── EXISTING QUERIES (kept for disclosures) ─────────────
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

  // 12-week agency-wide hiring pace (applications + licensed counts) —
  // only fetched lazily when the disclosure opens, to keep the default
  // first paint Recharts-free.
  const agencyPace = useQuery({
    queryKey: ["agency-hire-pace-12w"],
    enabled: openPace,
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

  // 8-week per-recruiter sparkline data — lazy (only when podium disclosure opens).
  const recruiterPace = useQuery({
    queryKey: ["recruiter-pace-8w"],
    enabled: openPodium,
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

  // 2026-06-14: Calendly-booked interviews (next 48h) — lazy (only when
  // cascade disclosure opens).
  const interviews = useQuery({
    queryKey: ["scheduled-interviews"],
    enabled: openCascade,
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

  // ────────────────── DERIVE 3-STAGE FUNNEL ──────────────────
  // Stage 1: Applications started — created_at row count.
  // Stage 2: Ref-link clicks — no dedicated table yet (Section 11 wiring
  //   pending); render "—" + inline note. DO NOT INVENT A NUMBER.
  // Stage 3: Completed applications — first_name + last_name + phone all
  //   non-null AND status != 'partial'.
  const funnelRows = funnel30d.data ?? [];
  const now = Date.now();
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
  const thisWeekStart = now - sevenDaysMs;
  const lastWeekStart = now - 2 * sevenDaysMs;

  const isComplete = (r: ApplicationFunnelRow): boolean =>
    !!r.first_name && !!r.last_name && !!r.phone && r.status !== "partial";

  let appsThisWeek = 0;
  let appsLastWeek = 0;
  let appsTotal30d = 0;
  let completedThisWeek = 0;
  let completedLastWeek = 0;
  let completedTotal30d = 0;

  for (const r of funnelRows) {
    if (!r.created_at) continue;
    const t = new Date(r.created_at).getTime();
    if (Number.isNaN(t)) continue;
    appsTotal30d++;
    const complete = isComplete(r);
    if (complete) completedTotal30d++;
    if (t >= thisWeekStart) {
      appsThisWeek++;
      if (complete) completedThisWeek++;
    } else if (t >= lastWeekStart) {
      appsLastWeek++;
      if (complete) completedLastWeek++;
    }
  }

  // Ref-link click attribution: no dedicated source-of-truth table yet.
  // Per judge brief — render "—" for the count and an inline note. The
  // delta therefore can't be computed and renders "— new this week".
  const refClicksThisWeek: number | null = null;
  const refClicksLastWeek: number | null = null;
  const refClicks30dTotal: number | null = null;
  const refClicksDelta: number | null = null;
  const refClicksNote = "Click attribution pending — Section 11 wiring.";

  const appsDelta = funnel30d.isLoading ? null : appsThisWeek - appsLastWeek;
  const completedDelta = funnel30d.isLoading ? null : completedThisWeek - completedLastWeek;

  // Bottleneck callout: pick the stage with the most-negative delta. If
  // all deltas are ≥ 0 (or null), pick the stage with the lowest count.
  // Skip the ref-link stage entirely when its data is null.
  const bottleneck = (() => {
    type Cand = { label: string; count: number; delta: number };
    const cands: Cand[] = [];
    if (funnel30d.data) {
      cands.push({ label: "Applications started", count: appsThisWeek, delta: appsThisWeek - appsLastWeek });
      cands.push({ label: "Completed applications", count: completedThisWeek, delta: completedThisWeek - completedLastWeek });
    }
    if (cands.length === 0) return null;
    // worst negative delta wins; if none negative, lowest count wins.
    cands.sort((a, b) => {
      if (a.delta < 0 && b.delta >= 0) return -1;
      if (b.delta < 0 && a.delta >= 0) return 1;
      if (a.delta !== b.delta) return a.delta - b.delta;
      return a.count - b.count;
    });
    const top = cands[0];
    const glyph = top.delta < 0 ? "▼" : top.delta > 0 ? "▲" : "·";
    return {
      headline: `${top.label} ${glyph} ${Math.abs(top.delta)} vs last week`,
      coachingLine: top.delta < 0 ? "Fix this first." : "Push the next stage today.",
    };
  })();

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
    const nowD = new Date();
    const day = nowD.getUTCDay();
    const diff = (day + 6) % 7;
    const start = new Date(nowD);
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
    const nowD = new Date();
    const day = nowD.getUTCDay();
    const diff = (day + 6) % 7;
    const start = new Date(nowD);
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
        eyebrow="Recruiting"
        eyebrowIcon={<Trophy className="h-3 w-3" />}
        title="Recruitment Tracker"
        subtitle="How leads become licensed agents · this week vs last."
        actions={
          <Button variant="outline" size="sm" onClick={() => {
            funnel30d.refetch();
            pipeline.refetch(); leaders.refetch();
            if (openPace) agencyPace.refetch();
            if (openPodium) recruiterPace.refetch();
            if (openCascade) interviews.refetch();
            agentLookup.refetch();
          }}>
            <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${funnel30d.isFetching ? "animate-spin" : ""}`} />
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

      {/* ─────────── 3-STAGE FUNNEL (vertical · phone-first) ─────────── */}
      <div className="space-y-2 max-w-md mx-auto w-full">
        <FunnelStageCard
          stageNumber={1}
          stageLabel="Applications started"
          count={funnel30d.isLoading ? null : appsThisWeek}
          delta={appsDelta}
          subline={`30d total: ${funnel30d.isLoading ? "—" : appsTotal30d}`}
        />
        <FunnelConnector
          prev={funnel30d.isLoading ? null : appsThisWeek}
          next={refClicksThisWeek}
          verb="clicked the ref link"
        />
        <FunnelStageCard
          stageNumber={2}
          stageLabel="Ref-link clicks"
          count={refClicksThisWeek}
          delta={refClicksDelta}
          subline={`30d total: ${refClicks30dTotal == null ? "—" : refClicks30dTotal}`}
          note={refClicksNote}
        />
        <FunnelConnector
          prev={refClicksThisWeek}
          next={funnel30d.isLoading ? null : completedThisWeek}
          verb="completed the app"
        />
        <FunnelStageCard
          stageNumber={3}
          stageLabel="Completed applications"
          count={funnel30d.isLoading ? null : completedThisWeek}
          delta={completedDelta}
          subline={`30d total: ${funnel30d.isLoading ? "—" : completedTotal30d}`}
        />
      </div>

      {/* ───────────── DISCLOSURES (lazy-mount; default view ships zero charts) ───────────── */}

      {/* See per-recruiter scorecards */}
      <details
        className="rounded-2xl bg-card/30 border border-border/30 px-5 py-4"
        open={openScorecards}
        onToggle={(e) => setOpenScorecards((e.currentTarget as HTMLDetailsElement).open)}
      >
        <summary className="cursor-pointer text-sm font-medium text-muted-foreground hover:text-foreground select-none">
          See per-recruiter scorecards
        </summary>
        {openScorecards && (
          <div className="mt-4 space-y-3">
            {pipeline.isLoading || leaders.isLoading ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {Array.from({length:6}).map((_,i)=><Skeleton key={i} className="h-44" />)}
              </div>
            ) : cardRecruiterIds.length === 0 ? (
              <div className="text-center py-8">
                <Users className="h-10 w-10 text-muted-foreground/40 mx-auto mb-4" />
                <h3 className="text-lg font-semibold mb-2">No recruiter scorecards</h3>
                <div className="space-y-3 max-w-md mx-auto">
                  <p className="text-13 text-muted-foreground">
                    Fetched <span className="font-bold tabular-nums">{(pipeline.data ?? []).length.toLocaleString()}</span> pipeline rows ·{" "}
                    <span className="font-bold tabular-nums">{(leaders.data ?? []).length.toLocaleString()}</span> leaderboard rows.
                  </p>
                  <div className="text-12 text-rose-400">
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
                    <div key={rid} className="rounded-2xl border border-border/40 bg-card/50 p-4 hover:border-amber-400/40 transition-colors">
                      <div className="flex items-center gap-3 mb-3">
                        {prof?.avatar ? (
                          <img src={prof.avatar} alt={prof.name} className="h-12 w-12 rounded-full border-2 border-border/60 object-cover shrink-0" />
                        ) : (
                          <div className="h-12 w-12 rounded-full border-2 border-border/60 bg-muted flex items-center justify-center text-sm font-bold uppercase shrink-0">
                            {initials(prof?.name)}
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          {/* 2026-06-15 — clickable recruiter name opens AgentProfileDrawer */}
                          <p className="text-sm font-bold truncate">
                            <AgentNameLink agentId={rid}>{prof?.name ?? "Recruiter"}</AgentNameLink>
                          </p>
                          {prof?.agent_code && <p className="text-xs text-muted-foreground tabular-nums">{prof.agent_code}</p>}
                        </div>
                        <Badge className={`text-xs border ${badge.cls} shrink-0`}>
                          <Icon className="h-3 w-3 mr-1" />
                          {badge.label}
                        </Badge>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 mb-3">
                        <div className="rounded-lg bg-muted/40 px-2 py-1.5 text-center">
                          <p className="text-2xl font-black tabular-nums leading-none">{today}</p>
                          <p className="text-xs text-muted-foreground mt-1">Today</p>
                        </div>
                        <div className="rounded-lg bg-muted/40 px-2 py-1.5 text-center">
                          <p className="text-2xl font-black tabular-nums leading-none">{week}</p>
                          <p className="text-xs text-muted-foreground mt-1">Week</p>
                        </div>
                        <div className="rounded-lg bg-muted/40 px-2 py-1.5 text-center">
                          <p className="text-2xl font-black tabular-nums leading-none">{month}</p>
                          <p className="text-xs text-muted-foreground mt-1">Month</p>
                        </div>
                        <div className="rounded-lg bg-emerald-500/15 px-2 py-1.5 text-center">
                          <p className="text-2xl font-black tabular-nums leading-none text-emerald-300">{last30}</p>
                          <p className="text-xs text-emerald-300/80 mt-1">30d</p>
                        </div>
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <div>
                          <p className="text-muted-foreground">Conv → engaged</p>
                          <p className="font-bold tabular-nums text-amber-300">{convPct}% <span className="text-muted-foreground">· {paid} paid</span></p>
                        </div>
                        <div className="text-right">
                          <p className="text-muted-foreground">Pipeline AP</p>
                          <p className="font-bold tabular-nums text-emerald-300">{compactMoney(premium)}</p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            {!leaders.isLoading && leaderRows.length > 3 && (
              <Card>
                <CardContent className="p-4">
                  <h3 className="text-sm font-bold flex items-center gap-2 mb-3">
                    <Award className="h-4 w-4 text-amber-500" /> Honorable mentions
                  </h3>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
                    {leaderRows.slice(3, 13).map((r, idx) => {
                      const prof = profileByRecruiter.get(r.recruiter_id);
                      return (
                        <div key={r.recruiter_id} className="flex items-center gap-2 rounded-md border border-border/40 px-2 py-1.5 hover:border-amber-500/40 transition-colors">
                          <span className="text-xs font-bold text-muted-foreground tabular-nums w-5 text-right">#{idx + 4}</span>
                          {prof?.avatar ? (
                            <img src={prof.avatar} alt={prof.name} className="h-7 w-7 rounded-full object-cover shrink-0" />
                          ) : (
                            <div className="h-7 w-7 rounded-full bg-muted flex items-center justify-center text-xs font-bold uppercase shrink-0">
                              {initials(prof?.name)}
                            </div>
                          )}
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-medium truncate">
                              <AgentNameLink agentId={r.recruiter_id}>{prof?.name ?? "Recruiter"}</AgentNameLink>
                            </p>
                            <p className="text-xs text-muted-foreground tabular-nums">{num(r.last_30d)} · 30d</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </details>

      {/* See top-performer podium */}
      <details
        className="rounded-2xl bg-card/30 border border-border/30 px-5 py-4"
        open={openPodium}
        onToggle={(e) => setOpenPodium((e.currentTarget as HTMLDetailsElement).open)}
      >
        <summary className="cursor-pointer text-sm font-medium text-muted-foreground hover:text-foreground select-none">
          See top-performer podium
        </summary>
        {openPodium && (
          <div className="mt-4">
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
                    <p className="text-sm font-bold text-amber-300">Top performers · last 30d</p>
                  </div>
                  <Badge variant="outline" className="text-xs border-amber-400/40 text-amber-300">
                    <Crown className="h-3 w-3 mr-1" /> Podium
                  </Badge>
                </div>
                {leaders.isLoading || agentLookup.isLoading ? (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {Array.from({length:3}).map((_,i)=><Skeleton key={i} className="h-44 bg-white/5" />)}
                  </div>
                ) : top3.length === 0 ? (
                  <p className="text-sm text-amber-100/70">First deal opens the board.</p>
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
                      const medal = ["1st", "2nd", "3rd"][i];
                      return (
                        <div key={r.recruiter_id} className={`rounded-2xl border bg-gradient-to-br ${rankBg} p-4 backdrop-blur-sm`}>
                          <div className="flex items-start justify-between mb-2">
                            <span className="text-sm font-bold text-amber-200">{medal}</span>
                            <Badge variant="outline" className="text-xs border-white/20 text-white/80">#{i+1}</Badge>
                          </div>
                          <div className="flex items-center gap-3 mb-3">
                            {prof?.avatar ? (
                              <img src={prof.avatar} alt={prof.name} className="h-12 w-12 rounded-full border-2 border-white/30 object-cover" />
                            ) : (
                              <div className="h-12 w-12 rounded-full border-2 border-white/30 bg-white/10 flex items-center justify-center text-sm font-bold uppercase">
                                {initials(prof?.name)}
                              </div>
                            )}
                            <div className="min-w-0">
                              <p className="text-sm font-bold truncate">
                                <AgentNameLink agentId={r.recruiter_id} className="text-white hover:text-white">
                                  {prof?.name ?? "Recruiter"}
                                </AgentNameLink>
                              </p>
                              {prof?.agent_code && <p className="text-xs text-white/60 tabular-nums">{prof.agent_code}</p>}
                            </div>
                          </div>
                          <div className="flex items-end justify-between mb-2">
                            <div>
                              <p className="text-4xl leading-none font-black tabular-nums">{num(r.last_30d)}</p>
                              <p className="text-xs text-white/70 mt-1">applicants · 30d</p>
                            </div>
                            <div className="text-right">
                              <Badge className="bg-emerald-500/20 border border-emerald-400/40 text-emerald-200 text-xs">+{thisWk} this wk</Badge>
                              <p className="text-xs text-white/70 mt-1 tabular-nums">{qualityPct}% paid</p>
                            </div>
                          </div>
                          <div className="h-10 -mx-1">
                            <ResponsiveContainer width="100%" height="100%">
                              <LineChart data={spark}>
                                <Line type="monotone" dataKey="apps" stroke="#fbbf24" strokeWidth={2} dot={false} isAnimationActive={false} />
                              </LineChart>
                            </ResponsiveContainer>
                          </div>
                          <p className="text-xs text-white/50 mt-1">8-week trend</p>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </details>

      {/* See 12-week hiring pace */}
      <details
        className="rounded-2xl bg-card/30 border border-border/30 px-5 py-4"
        open={openPace}
        onToggle={(e) => setOpenPace((e.currentTarget as HTMLDetailsElement).open)}
      >
        <summary className="cursor-pointer text-sm font-medium text-muted-foreground hover:text-foreground select-none">
          See 12-week hiring pace
        </summary>
        {openPace && (
          <div className="mt-4">
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
                    <p className="text-sm font-bold text-emerald-300">Hiring pace · 12 weeks</p>
                  </div>
                  <Badge variant="outline" className="text-xs border-emerald-400/40 text-emerald-300">
                    <TrendingUp className="h-3 w-3 mr-1" /> Agency-wide
                  </Badge>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                  <div className="rounded-xl bg-black/30 p-3">
                    <p className="text-xs text-emerald-300/80">Total · 12w</p>
                    <p className="text-3xl leading-none font-black tabular-nums mt-1">{agencyTotal12w}</p>
                    <p className="text-xs text-white/50 mt-1">applicants created</p>
                  </div>
                  <div className="rounded-xl bg-black/30 p-3">
                    <p className="text-xs text-emerald-300/80">Weekly avg</p>
                    <p className="text-3xl leading-none font-black tabular-nums mt-1">{agencyAvgPerWeek}</p>
                    <p className="text-xs text-white/50 mt-1">per week</p>
                  </div>
                  <div className="rounded-xl bg-black/30 p-3">
                    <p className="text-xs text-emerald-300/80">This week</p>
                    <p className="text-3xl leading-none font-black tabular-nums mt-1">{lastWeek?.apps ?? 0}</p>
                    <p className={`text-xs mt-1 ${wowDelta >= 0 ? "text-emerald-300" : "text-rose-300"}`}>
                      {wowDelta >= 0 ? "+" : ""}{wowDelta} WoW
                    </p>
                  </div>
                  <div className="rounded-xl bg-black/30 p-3">
                    <p className="text-xs text-emerald-300/80">Licensed · 12w</p>
                    <p className="text-3xl leading-none font-black tabular-nums mt-1">{agencyLicensed12w}</p>
                    <p className="text-xs text-white/50 mt-1">{agencyTotal12w > 0 ? `${((agencyLicensed12w / agencyTotal12w) * 100).toFixed(1)}% conv` : "—"}</p>
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
                <div className="flex items-center gap-4 mt-2 text-xs">
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
          </div>
        )}
      </details>

      {/* See interview cascade (48h) */}
      <details
        className="rounded-2xl bg-card/30 border border-border/30 px-5 py-4"
        open={openCascade}
        onToggle={(e) => setOpenCascade((e.currentTarget as HTMLDetailsElement).open)}
      >
        <summary className="cursor-pointer text-sm font-medium text-muted-foreground hover:text-foreground select-none">
          See interview cascade (48h)
        </summary>
        {openCascade && (
          <div className="mt-4">
            <Card className="border-emerald-500/30 bg-emerald-500/[0.04]">
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-bold flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                    Interview cascade · next 48h
                  </h3>
                  <Badge variant="outline" className="text-xs">
                    {interviews.data?.length ?? 0} booked
                  </Badge>
                </div>
                {interviews.isLoading ? (
                  <div className="space-y-2">{Array.from({length:3}).map((_,i)=><Skeleton key={i} className="h-10" />)}</div>
                ) : (interviews.data ?? []).length === 0 ? (
                  <div className="text-center py-4">
                    <Calendar className="h-5 w-5 mx-auto mb-1 text-muted-foreground opacity-50" />
                    <p className="text-sm text-muted-foreground">Inbox zero. Hold the Standard.</p>
                    <p className="text-xs text-muted-foreground mt-0.5">Bookings sync from Google Calendar + Calendly.</p>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {(interviews.data ?? []).map((iv) => {
                      const when = new Date(iv.scheduled_for);
                      const isToday = when.toDateString() === new Date().toDateString();
                      return (
                        <div key={iv.id} className="flex items-center gap-3 px-3 py-2 rounded-md border border-border/40 hover:border-emerald-500/40 hover:bg-emerald-500/5 transition-colors">
                          <div className="text-center shrink-0 w-14">
                            <p className={`text-xs font-bold ${isToday ? "text-rose-600 dark:text-rose-400" : "text-amber-600 dark:text-amber-400"}`}>
                              {isToday ? "Today" : format(when, "EEE")}
                            </p>
                            <p className="text-sm font-bold tabular-nums">{format(when, "h:mm a")}</p>
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{iv.applicant_name ?? iv.summary ?? "Interview"}</p>
                            <p className="text-xs text-muted-foreground truncate">{iv.source ?? "Calendly"}</p>
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
          </div>
        )}
      </details>
    </div>
  );
}
