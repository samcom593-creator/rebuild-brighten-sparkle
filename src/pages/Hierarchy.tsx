// Hierarchy — Sam's biggest legs at a glance.
//
// Sam's voice directive (2026-06-15): "Give me another side navigation called
// Hierarchy where I could see my biggest legs and how many people they've
// had, get contracted, etcetera."
//
// A "leg" = a direct downline recruiter Sam (or a manager) has personally
// hired who now has their own downline rolling underneath them. Phone-first,
// single column at 375px, ZERO horizontal scroll on the default view.
//
// Data sources (verified 2026-06-15 via bot-sql):
//   - v_agent_with_downline_production  (per-agent direct_recruits +
//     downline_size + downline_ap_mtd + team_ap_mtd + own_deals_mtd)
//   - v_recruiter_pipeline              (total_assigned applicants + paid_count
//     + contracting_count + total_premium per recruiter)
//   - v_recruiting_leaderboard          (today / this_week / this_month /
//     last_30d hire counts per recruiter)
//   - agents                            (canonical_agent_id IS NULL filter +
//     display_name + agent_code + license_status + status)
//
// Role scoping (matches RecruitingFunnels / Leaderboard pattern):
//   - isAdmin: shows EVERY top-level leg across the agency. "Top-level leg" =
//     any canonical agent with at least one direct recruit (downline_size >= 1)
//     OR who is themselves a direct report of Sam (manager_id = Sam's id).
//     This is Sam's primary view.
//   - isManager (not admin): shows ONLY agents whose manager_id resolves to
//     the signed-in user's own agent row. Manager sees their own legs only.
//   - neither: <AccessDenied />-style empty state — but ProtectedRoute on the
//     route already blocks this at /dashboard/hierarchy (requireAdmin
//     allowManagers).

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Workflow, Crown, Users, TrendingUp, ShieldCheck, ChevronDown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { usePageTitle } from "@/hooks/usePageTitle";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { AgentAvatar } from "@/components/ui/AgentAvatar";
import { cn } from "@/lib/utils";

type AgentRow = {
  id: string;
  user_id: string | null;
  display_name: string | null;
  agent_code: string | null;
  manager_id: string | null;
  status: string | null;
  license_status: string | null;
};

type DownlineProdRow = {
  agent_id: string;
  name: string | null;
  invited_by_manager_id: string | null;
  manager_id: string | null;
  status: string | null;
  license_status: string | null;
  own_deals_mtd: number | string | null;
  direct_recruits: number | string | null;
  downline_size: number | string | null;
  downline_ap_mtd: number | string | null;
  team_ap_mtd: number | string | null;
};

type RecruiterPipelineRow = {
  recruiter_id: string;
  agent_code: string | null;
  recruiter_name: string | null;
  total_assigned: number | string | null;
  paid_count: number | string | null;
  contracting_count: number | string | null;
  total_premium: number | string | null;
};

type LeaderboardRow = {
  recruiter_id: string;
  today: number | string | null;
  this_week: number | string | null;
  this_month: number | string | null;
  last_30d: number | string | null;
};

function num(v: unknown): number {
  if (v === null || v === undefined) return 0;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function fmtInt(v: unknown): string {
  const n = num(v);
  if (n <= 0) return "—";
  return n.toLocaleString();
}

function fmtUSD(v: unknown): string {
  const n = num(v);
  if (n <= 0) return "—";
  return `$${Math.round(n).toLocaleString()}`;
}

function legName(name: string | null | undefined, code: string | null | undefined): string {
  const n = (name ?? "").trim();
  if (n && n.toLowerCase() !== "unknown") return n;
  const c = (code ?? "").trim();
  if (c) return c;
  return "—";
}

function medal(rank: number): string {
  if (rank === 1) return "🥇";
  if (rank === 2) return "🥈";
  if (rank === 3) return "🥉";
  return `#${rank}`;
}

interface LegRow {
  agent_id: string;
  display_name: string;
  agent_code: string | null;
  status: string | null;
  license_status: string | null;
  // primary score — total people they've personally recruited (downline size)
  downline_size: number;
  direct_recruits: number;
  // secondary
  total_assigned: number;        // applicants assigned to them as recruiter
  contracting_count: number;     // their applicants in contracting stage
  contracted_total: number;      // licensed downline (proxy = paid_count + contracting_count)
  paid_count: number;            // their applicants who actually paid through
  team_ap_mtd: number;           // their team's ALP for the current month
  own_deals_mtd: number;         // own deals this month
  hires_this_month: number;      // from v_recruiting_leaderboard
  hires_last_30d: number;
}

const HERO_SKELETON_BARS = [0, 1, 2];
const LEG_SKELETON_ROWS = [0, 1, 2, 3, 4];

export default function Hierarchy() {
  usePageTitle("Hierarchy · APEX");
  const { user, isAdmin, isManager, isLoading: authLoading } = useAuth();

  // Resolve the signed-in user → canonical agent row. Admins use this only
  // when they want to scope to "my legs"; we keep it loaded for both roles
  // so a manager-only view filters correctly.
  const meAgent = useQuery({
    queryKey: ["hierarchy-me-agent", user?.id ?? null],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data } = await supabase
        .from("agents")
        .select("id, user_id, display_name, agent_code, manager_id, status, license_status")
        .eq("user_id", user!.id)
        .is("canonical_agent_id", null)
        .maybeSingle();
      return (data ?? null) as AgentRow | null;
    },
    staleTime: 60_000,
  });

  // Per-agent downline production view — primary leg dataset.
  const downline = useQuery({
    queryKey: ["hierarchy-downline-prod"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_agent_with_downline_production" as never)
        .select("agent_id, name, invited_by_manager_id, manager_id, status, license_status, own_deals_mtd, direct_recruits, downline_size, downline_ap_mtd, team_ap_mtd")
        .limit(500);
      if (error) throw error;
      return (data ?? []) as unknown as DownlineProdRow[];
    },
    refetchInterval: 60_000,
  });

  // Recruiter-pipeline rollup — applicants assigned + paid + contracting per
  // recruiter. JOINed by agent_id (= recruiter_id in this view).
  const pipeline = useQuery({
    queryKey: ["hierarchy-recruiter-pipeline"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_recruiter_pipeline" as never)
        .select("recruiter_id, agent_code, recruiter_name, total_assigned, paid_count, contracting_count, total_premium")
        .limit(500);
      if (error) throw error;
      return (data ?? []) as unknown as RecruiterPipelineRow[];
    },
    refetchInterval: 60_000,
  });

  // Hire-pace per recruiter (today / week / month / 30d).
  const leaderboard = useQuery({
    queryKey: ["hierarchy-recruiting-leaderboard"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_recruiting_leaderboard" as never)
        .select("recruiter_id, today, this_week, this_month, last_30d")
        .limit(500);
      if (error) throw error;
      return (data ?? []) as unknown as LeaderboardRow[];
    },
    refetchInterval: 60_000,
  });

  // Lookup map for canonical agent rows so legName + status + license badge
  // render even when downline view has missing fields.
  const agentLookup = useQuery({
    queryKey: ["hierarchy-agent-lookup"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("agents")
        .select("id, user_id, display_name, agent_code, manager_id, status, license_status")
        .is("canonical_agent_id", null)
        .limit(2000);
      if (error) throw error;
      return (data ?? []) as AgentRow[];
    },
    staleTime: 5 * 60_000,
  });

  const isLoading = authLoading || downline.isLoading || pipeline.isLoading || leaderboard.isLoading || agentLookup.isLoading;

  // Build the leg list. Filtering depends on role:
  //   - admin: every canonical agent who has at least one direct recruit
  //     (downline_size >= 1) is a leg of the agency
  //   - manager: only agents whose manager_id = current manager's agent row
  const legs: LegRow[] = useMemo(() => {
    if (isLoading) return [];
    const myAgentId = meAgent.data?.id ?? null;
    const dpByAgent = new Map<string, DownlineProdRow>();
    for (const r of downline.data ?? []) dpByAgent.set(r.agent_id, r);
    const pipeByAgent = new Map<string, RecruiterPipelineRow>();
    for (const r of pipeline.data ?? []) pipeByAgent.set(r.recruiter_id, r);
    const lbByAgent = new Map<string, LeaderboardRow>();
    for (const r of leaderboard.data ?? []) lbByAgent.set(r.recruiter_id, r);
    const agentById = new Map<string, AgentRow>();
    for (const a of agentLookup.data ?? []) agentById.set(a.id, a);

    // Candidate agent IDs come from either source — covers the case where a
    // recruiter has applicants assigned but no downline yet, or vice versa.
    const candidates = new Set<string>();
    for (const r of downline.data ?? []) candidates.add(r.agent_id);
    for (const r of pipeline.data ?? []) candidates.add(r.recruiter_id);

    const rows: LegRow[] = [];
    for (const id of candidates) {
      const agent = agentById.get(id);
      if (!agent) continue; // non-canonical / dropped after canonical merge
      const dp = dpByAgent.get(id);
      const pp = pipeByAgent.get(id);
      const lb = lbByAgent.get(id);

      // Role scoping. Manager-only view = legs whose manager_id is the
      // signed-in manager's agent row. Admin view = every canonical agent
      // with at least one direct recruit OR with applicants assigned.
      if (isManager && !isAdmin) {
        if (!myAgentId) continue;
        if (agent.manager_id !== myAgentId) continue;
      }

      const direct = num(dp?.direct_recruits);
      const dsize = num(dp?.downline_size);
      const assigned = num(pp?.total_assigned);
      const contracting = num(pp?.contracting_count);
      const paid = num(pp?.paid_count);

      // A leg has SOMETHING — either downline, or applicants assigned, or a
      // hire this month. Skip empty shell rows so we don't fill the page
      // with zeros.
      const hasSignal = dsize > 0 || direct > 0 || assigned > 0 || paid > 0 || num(lb?.this_month) > 0 || num(lb?.last_30d) > 0;
      if (!hasSignal) continue;

      rows.push({
        agent_id: id,
        display_name: legName(agent.display_name ?? dp?.name ?? null, agent.agent_code ?? pp?.agent_code ?? null),
        agent_code: agent.agent_code ?? pp?.agent_code ?? null,
        status: agent.status ?? dp?.status ?? null,
        license_status: agent.license_status ?? dp?.license_status ?? null,
        downline_size: dsize,
        direct_recruits: direct,
        total_assigned: assigned,
        contracting_count: contracting,
        contracted_total: paid + contracting,
        paid_count: paid,
        team_ap_mtd: num(dp?.team_ap_mtd),
        own_deals_mtd: num(dp?.own_deals_mtd),
        hires_this_month: num(lb?.this_month),
        hires_last_30d: num(lb?.last_30d),
      });
    }

    // Sort by total people recruited (downline_size first, then total_assigned
    // as a tiebreaker — assigned applicants are still "people they've had").
    rows.sort((a, b) => {
      if (b.downline_size !== a.downline_size) return b.downline_size - a.downline_size;
      if (b.total_assigned !== a.total_assigned) return b.total_assigned - a.total_assigned;
      if (b.paid_count !== a.paid_count) return b.paid_count - a.paid_count;
      return a.display_name.localeCompare(b.display_name);
    });

    return rows;
  }, [isLoading, meAgent.data, downline.data, pipeline.data, leaderboard.data, agentLookup.data, isAdmin, isManager]);

  // Hero totals — sum across the (already role-scoped) leg list.
  const hero = useMemo(() => {
    if (!legs.length) {
      return { total_people: 0, total_contracted: 0, total_producing_mtd: 0, leg_count: 0 };
    }
    let total_people = 0;
    let total_contracted = 0;
    let total_producing_mtd = 0;
    for (const l of legs) {
      total_people += l.downline_size + l.total_assigned;
      total_contracted += l.contracted_total;
      if (l.team_ap_mtd > 0 || l.own_deals_mtd > 0) total_producing_mtd += 1;
    }
    return {
      total_people,
      total_contracted,
      total_producing_mtd,
      leg_count: legs.length,
    };
  }, [legs]);

  const topLegs = legs.slice(0, 10);

  // Depth distribution buckets — simple horizontal bar.
  const depthBuckets = useMemo(() => {
    const buckets = [
      { label: "1-5",  min: 1,  max: 5,  count: 0 },
      { label: "6-15", min: 6,  max: 15, count: 0 },
      { label: "16-50",min: 16, max: 50, count: 0 },
      { label: "50+",  min: 51, max: Number.POSITIVE_INFINITY, count: 0 },
    ];
    for (const l of legs) {
      const s = l.downline_size;
      if (s < 1) continue;
      const b = buckets.find((x) => s >= x.min && s <= x.max);
      if (b) b.count += 1;
    }
    return buckets;
  }, [legs]);
  const depthMax = Math.max(1, ...depthBuckets.map((b) => b.count));

  return (
    <div className="px-4 sm:px-6 pb-24 space-y-5">
      <PageHeader
        eyebrow="Recruiting"
        eyebrowIcon={<Workflow className="h-3 w-3" />}
        title="Hierarchy"
        subtitle="Biggest legs · contracts · production rolling up."
      />

      {/* Hero summary — 3 big numbers, stacked on phone, row on >sm. */}
      <section
        aria-label="Hierarchy summary"
        className="rounded-3xl bg-card/40 border border-border/40 px-6 py-7"
      >
        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            {HERO_SKELETON_BARS.map((i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-12 w-32" />
              </div>
            ))}
          </div>
        ) : (
          <dl className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            <div>
              <dt className="text-sm text-muted-foreground uppercase tracking-wide">
                {isAdmin ? "Agency people" : "People in your legs"}
              </dt>
              <dd className="mt-1 text-5xl font-black tabular-nums leading-none">
                {hero.total_people > 0 ? hero.total_people.toLocaleString() : "—"}
              </dd>
              <p className="mt-1 text-xs text-muted-foreground">
                downline + applicants assigned
              </p>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground uppercase tracking-wide">
                Contracted
              </dt>
              <dd className="mt-1 text-5xl font-black tabular-nums leading-none">
                {hero.total_contracted > 0 ? hero.total_contracted.toLocaleString() : "—"}
              </dd>
              <p className="mt-1 text-xs text-muted-foreground">
                paid + contracting across all legs
              </p>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground uppercase tracking-wide">
                Producing legs (MTD)
              </dt>
              <dd className="mt-1 text-5xl font-black tabular-nums leading-none">
                {hero.total_producing_mtd > 0 ? hero.total_producing_mtd.toLocaleString() : "—"}
              </dd>
              <p className="mt-1 text-xs text-muted-foreground">
                legs with team ALP or own deals this month
              </p>
            </div>
          </dl>
        )}
      </section>

      {/* Top 10 Legs leaderboard */}
      <section aria-label="Top legs leaderboard" className="space-y-4">
        <header className="flex items-baseline justify-between gap-3">
          <h2 className="text-xl font-bold tracking-tight flex items-center gap-2">
            <Crown className="h-5 w-5 text-amber-400" />
            Top {Math.min(10, topLegs.length || 10)} legs
          </h2>
          {!isLoading && hero.leg_count > 0 && (
            <span className="text-xs text-muted-foreground tabular-nums">
              {hero.leg_count.toLocaleString()} total
            </span>
          )}
        </header>

        {isLoading ? (
          <div className="space-y-3">
            {LEG_SKELETON_ROWS.map((i) => (
              <div
                key={i}
                className="rounded-3xl bg-card/40 border border-border/40 px-6 py-7"
              >
                <Skeleton className="h-5 w-44" />
                <Skeleton className="h-12 w-28 mt-3" />
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
                  <Skeleton className="h-8" />
                  <Skeleton className="h-8" />
                  <Skeleton className="h-8" />
                  <Skeleton className="h-8" />
                </div>
              </div>
            ))}
          </div>
        ) : topLegs.length === 0 ? (
          <EmptyState
            icon={<Workflow className="h-7 w-7" />}
            title="No direct legs yet."
            description="Hires you make become your legs. Once a recruit has applicants of their own, they appear here ranked by downline size."
          />
        ) : (
          <div className="space-y-3">
            {topLegs.map((leg, idx) => {
              const rank = idx + 1;
              const isTop = rank === 1;
              return (
                <article
                  key={leg.agent_id}
                  className={cn(
                    "rounded-3xl border px-6 py-7",
                    isTop
                      ? "bg-amber-500/10 border-amber-500/20"
                      : "bg-card/40 border-border/40",
                  )}
                >
                  <header className="flex items-start gap-4">
                    <div
                      aria-hidden
                      className={cn(
                        "text-2xl font-black tabular-nums leading-none w-12 shrink-0",
                        isTop ? "text-amber-400" : "text-muted-foreground",
                      )}
                    >
                      {medal(rank)}
                    </div>
                    <AgentAvatar name={leg.display_name} size="md" />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-lg font-bold tracking-tight truncate">
                          {leg.display_name}
                        </h3>
                        {isTop && (
                          <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md border border-amber-500/20 bg-amber-500/10 text-amber-400">
                            Top leg
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-2 flex-wrap">
                        <span className="tabular-nums">{leg.agent_code ?? "—"}</span>
                        {leg.license_status === "licensed" && (
                          <span className="inline-flex items-center gap-1 text-emerald-400">
                            <ShieldCheck className="h-3 w-3" /> licensed
                          </span>
                        )}
                        {leg.status && leg.status !== "active" && (
                          <span className="text-rose-400 uppercase tracking-wide">
                            {leg.status}
                          </span>
                        )}
                      </p>
                    </div>
                  </header>

                  {/* Hero metric — total people they've personally recruited */}
                  <div className="mt-5">
                    <p className="text-xs text-muted-foreground uppercase tracking-wide">
                      People they've recruited
                    </p>
                    <p className="text-5xl font-black tabular-nums leading-none mt-1">
                      {fmtInt(leg.downline_size)}
                    </p>
                  </div>

                  {/* Secondary grid — applicants / contracted / producing / ALP */}
                  <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-3 mt-5">
                    <div>
                      <dt className="text-[11px] text-muted-foreground uppercase tracking-wide">
                        Applicants
                      </dt>
                      <dd className="text-lg font-bold tabular-nums leading-none mt-0.5">
                        {fmtInt(leg.total_assigned)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[11px] text-muted-foreground uppercase tracking-wide">
                        Contracted
                      </dt>
                      <dd className="text-lg font-bold tabular-nums leading-none mt-0.5">
                        {fmtInt(leg.contracted_total)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[11px] text-muted-foreground uppercase tracking-wide">
                        Hires (30d)
                      </dt>
                      <dd className="text-lg font-bold tabular-nums leading-none mt-0.5">
                        {fmtInt(leg.hires_last_30d)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[11px] text-muted-foreground uppercase tracking-wide">
                        Team ALP (MTD)
                      </dt>
                      <dd className="text-lg font-bold tabular-nums leading-none mt-0.5">
                        {fmtUSD(leg.team_ap_mtd)}
                      </dd>
                    </div>
                  </dl>

                  {/* Drilldown — exact split + month-vs-30d delta */}
                  <details className="group mt-5">
                    <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 select-none">
                      <ChevronDown className="h-3 w-3 transition-transform group-open:rotate-180" />
                      Show breakdown
                    </summary>
                    <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                      <div className="flex justify-between border-b border-border/30 py-1.5">
                        <span className="text-muted-foreground">Direct recruits</span>
                        <span className="tabular-nums font-medium">{fmtInt(leg.direct_recruits)}</span>
                      </div>
                      <div className="flex justify-between border-b border-border/30 py-1.5">
                        <span className="text-muted-foreground">Downline size</span>
                        <span className="tabular-nums font-medium">{fmtInt(leg.downline_size)}</span>
                      </div>
                      <div className="flex justify-between border-b border-border/30 py-1.5">
                        <span className="text-muted-foreground">Paid through</span>
                        <span className="tabular-nums font-medium">{fmtInt(leg.paid_count)}</span>
                      </div>
                      <div className="flex justify-between border-b border-border/30 py-1.5">
                        <span className="text-muted-foreground">In contracting</span>
                        <span className="tabular-nums font-medium">{fmtInt(leg.contracting_count)}</span>
                      </div>
                      <div className="flex justify-between border-b border-border/30 py-1.5">
                        <span className="text-muted-foreground">Hires this month</span>
                        <span className="tabular-nums font-medium">{fmtInt(leg.hires_this_month)}</span>
                      </div>
                      <div className="flex justify-between border-b border-border/30 py-1.5">
                        <span className="text-muted-foreground">Own deals (MTD)</span>
                        <span className="tabular-nums font-medium">{fmtInt(leg.own_deals_mtd)}</span>
                      </div>
                    </div>
                  </details>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {/* Depth distribution — at-a-glance hierarchy shape */}
      {!isLoading && legs.length > 0 && (
        <section
          aria-label="Hierarchy depth distribution"
          className="rounded-3xl bg-card/40 border border-border/40 px-6 py-7"
        >
          <h2 className="text-base font-bold tracking-tight flex items-center gap-2">
            <Users className="h-4 w-4 text-muted-foreground" />
            Depth distribution
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            How many legs sit in each downline-size bucket.
          </p>
          <div className="mt-5 space-y-3">
            {depthBuckets.map((b) => {
              const pct = depthMax > 0 ? Math.round((b.count / depthMax) * 100) : 0;
              return (
                <div key={b.label} className="grid grid-cols-[3rem_1fr_2.5rem] items-center gap-3">
                  <span className="text-xs text-muted-foreground tabular-nums">{b.label}</span>
                  <div
                    className="h-2 rounded-md bg-border/40 overflow-hidden"
                    role="progressbar"
                    aria-valuenow={b.count}
                    aria-valuemin={0}
                    aria-valuemax={depthMax}
                    aria-label={`${b.count} legs with ${b.label} downline`}
                  >
                    <div
                      className="h-full bg-primary/70"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="text-sm font-bold tabular-nums text-right">
                    {b.count > 0 ? b.count : "—"}
                  </span>
                </div>
              );
            })}
          </div>
          <p className="mt-4 text-xs text-muted-foreground flex items-center gap-1.5">
            <TrendingUp className="h-3 w-3" />
            Legs without any downline yet are not counted here — they roll up under "Applicants" in the leaderboard.
          </p>
        </section>
      )}
    </div>
  );
}
