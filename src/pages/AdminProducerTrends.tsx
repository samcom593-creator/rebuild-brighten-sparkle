/**
 * /admin/producer-trends — MP-259 rebuild
 *
 * Sam directive (2026-07-07): rebuild the Producer Trends surface with a
 * proper CommandHeader + 6-KPI grid + 3 ProducerAlertCards + ProducerRiskTable
 * + NeverActivatedTable + ProducerDetailsDrawer wired to the recovery-review
 * workflow.
 *
 * Data sources (preserved end-to-end — no view invention):
 *   - public.v_producer_trend_alert    → per-producer trend + 3-week drop flag
 *   - public.v_agent_weekly_production → 12-week ALP series
 *   - public.v_new_hires_activation    → licensed hires with no first deal
 *   - public.v_manager_scorecard       → per-manager downline health (retention
 *                                        risk + first-sale gap + team ALP)
 *   - public.agents                    → manager_id / al_user_id / onboarding_stage
 *   - public.agent_notes               → coaching history / review + recovery markers
 *
 * The KPIs, ProducerAlertCards, table rows, and drawer all read from the
 * SAME derived data — clicking a KPI or an alert card filters the risk table
 * in place. Recovery Review sorts by highest risk and walks the queue.
 *
 * 2026-07-26 visual contract pass (presentation only — no query, hook,
 * condition, route, handler, permission gate, or rendered value changed):
 *   §1 page root      → page-enter mx-auto max-w-[1400px] space-y-5 px-4 pb-24 sm:px-6
 *   §2 sections       → GlassCard p-4 (the shadcn Card header/content stack is gone)
 *   §3 headers        → h3 + count + one-sentence description
 *   §4 type scale     → oversized headings + arbitrary tracking retired below PageHeader
 *   §6 severity       → rose/amber/emerald in the -600 dark:-400 paired form only
 *   §7 numerics       → tabular-nums + right-aligned on every numeric column
 *   §8 tables         → one dedicated -mx-4 overflow-x-auto scroll rail each
 *   §9 states         → every loading/empty/error branch kept, restyled
 *   §10 focus         → the single --apex-focus-ring token, never the multi-utility halo
 */

import { useMemo, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { GlassCard } from "@/components/ui/glass-card";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  ChevronRight,
  ClipboardCheck,
  Link2,
  Link2Off,
  Minus,
  Play,
  RefreshCw,
  ShieldAlert,
  TrendingDown,
  UserCheck,
  Users,
  UserX,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AgentNameLink } from "@/components/dashboard/AgentNameLink";
import { cn } from "@/lib/utils";
import { getNextBestAction } from "@/lib/nextBestAction";
import {
  getPriorityLabel,
  getPriorityScore,
  priorityBadgeClasses,
  type PriorityLabel,
} from "@/lib/priority";
import ProducerDetailsDrawer, {
  type ProducerDrawerInput,
} from "@/components/producers/ProducerDetailsDrawer";

// -------------------------------------------------------------------------
// Types
// -------------------------------------------------------------------------
type TrendAlertRow = {
  producer_id: string;
  display_name: string;
  current_week_start: string;
  current_week_alp: number;
  current_week_deals: number;
  alp_1w_ago: number | null;
  alp_2w_ago: number | null;
  alp_3_weeks_ago: number | null;
  delta_pct: number;
  direction: "up" | "down" | "flat";
  currently_dropping: boolean;
};

type NewHireActivationRow = {
  agent_id: string;
  display_name: string;
  hire_date: string;
  days_since_hire: number;
  onboarding_stage: string | null;
  license_status: string | null;
  manager_id: string | null;
  manager_name: string | null;
  agentlink_linked: boolean;
  next_action_text: string | null;
  next_action_due_at: string | null;
};

type WeeklyRow = {
  agent_id: string;
  display_name: string;
  week_start: string;
  deals: number;
  alp: number;
};

type AgentMetaRow = {
  id: string;
  agent_code: string | null;
  status: string | null;
  onboarding_stage: string | null;
  license_status: string | null;
  al_user_id: string | null;
  manager_id: string | null;
  total_policies: number | null;
};

type ManagerRow = { id: string; display_name: string | null };

/**
 * public.v_manager_scorecard — one row per manager who holds a downline.
 * Hand-written because src/integrations/supabase/types.ts predates this view;
 * the query casts the table name so the client compiles against the real shape
 * instead of a stale generated union.
 *
 * Column list verified against information_schema on 2026-07-25. The `bigint`
 * counters land as JSON numbers; the `numeric` columns can arrive as strings
 * depending on the driver in front of Postgres, so they are typed wide and
 * every read goes through `toNum()`. A silent `"55.6".toFixed is not a
 * function` would blank the exact numbers this section exists to show.
 */
interface ManagerScorecardRow {
  manager_agent_id: string;
  manager_name: string | null;
  reports_total: number | null;
  reports_activeroster: number | null;
  reports_licensed: number | null;
  reports_onboarding_incomplete: number | null;
  reports_no_first_sale: number | null;
  reports_licensed_inactive: number | null;
  reports_contracted: number | null;
  reports_appointment_set: number | null;
  pct_licensed: number | string | null;
  pct_licensed_producing: number | string | null;
  team_in_force_alp: number | string | null;
  team_deals_30d: number | null;
  team_alp_30d: number | string | null;
  retention_risk_pct: number | string | null;
  manager_deactivated: boolean | null;
}

/** Severity tone shared by the manager scorecard hero stats + chips. */
type ScoreTone = "rose" | "amber" | "emerald" | "neutral";

type ReviewTagRow = { agent_id: string; note: string; created_at: string };

type RiskLevel = "critical" | "dropping" | "watch" | "stable" | "recovered";

type KpiKey =
  | "all"
  | "dropping_3w"
  | "down_this_week"
  | "never_activated_60d"
  | "no_alp_30d"
  | "recovered_this_week"
  | "manager_review_needed";

// Enriched row consumed by the KPI grid + table + drawer.
interface RiskRow {
  producer_id: string;
  display_name: string;
  manager_id: string | null;
  manager_name: string;
  current_week_alp: number;
  previous_week_alp: number | null; // alp_1w_ago
  alp_2w_ago: number | null;
  alp_3_weeks_ago: number | null;
  delta_pct: number;
  direction: "up" | "down" | "flat";
  currently_dropping: boolean;
  weekly_series: number[];
  total_policies: number | null;
  stage: string | null;
  agentlink_linked: boolean;
  last_contact: string | null;
  never_activated_60_days: boolean;
  no_alp_30_days: boolean;
  no_agentlink: boolean;
  no_recent_contact: boolean;
  reviewed_this_week: boolean;
  recovered_this_week: boolean;
  priority_score: number;
  priority_label: PriorityLabel;
  risk_level: RiskLevel;
}

// -------------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------------
function fmtUSDCompact(n: number | null | undefined): string {
  if (n == null) return "—";
  if (Math.abs(n) >= 1000) return `$${(n / 1000).toFixed(1)}K`;
  return `$${n}`;
}

/**
 * PostgREST serialises `numeric` as a JSON number, but a driver/proxy change
 * can hand back a string. Coerce once here so a silent "NaN%" never renders.
 */
function toNum(v: number | string | null | undefined): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function fmtPct(v: number | string | null | undefined, digits = 1): string {
  const n = toNum(v);
  if (n == null) return "—";
  return `${n.toFixed(digits)}%`;
}

function fmtInt(v: number | string | null | undefined): string {
  const n = toNum(v);
  if (n == null) return "—";
  return n.toLocaleString();
}

/** Higher is worse: >= `bad` → rose, >= `warn` → amber, else emerald. */
function severityTone(v: number | null, bad: number, warn: number): ScoreTone {
  if (v == null) return "neutral";
  if (v >= bad) return "rose";
  if (v >= warn) return "amber";
  return "emerald";
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function daysBetween(iso: string | null | undefined, now = new Date()): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  // Clamped at 0: a future-dated hire/stage row must never render "-3 days".
  return Math.max(0, Math.floor((now.getTime() - d.getTime()) / 86_400_000));
}

function riskLevelFor(row: {
  recovered_this_week: boolean;
  currently_dropping: boolean;
  never_activated_60_days: boolean;
  no_alp_30_days: boolean;
  direction: "up" | "down" | "flat";
  no_agentlink: boolean;
  no_recent_contact: boolean;
}): RiskLevel {
  if (row.recovered_this_week) return "recovered";
  if (row.currently_dropping || row.never_activated_60_days || row.no_alp_30_days) return "critical";
  if (row.direction === "down") return "dropping";
  if (row.no_agentlink || row.no_recent_contact) return "watch";
  return "stable";
}

/**
 * Visual contract §6: rose / amber / emerald are the only severity hues and a
 * fourth level is not allowed, so "watch" reads as amber-outline (no fill)
 * against "dropping" amber-filled. The label word carries the distinction too —
 * colour is never the only channel.
 */
function riskBadgeClasses(level: RiskLevel): { className: string; label: string } {
  switch (level) {
    case "critical":
      return {
        className: "border-rose-500/40 bg-rose-500/10 text-rose-600 dark:text-rose-400",
        label: "Critical",
      };
    case "dropping":
      return {
        className: "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400",
        label: "Dropping",
      };
    case "watch":
      return {
        className: "border-amber-500/30 text-amber-600 dark:text-amber-400",
        label: "Watch",
      };
    case "stable":
      return {
        className: "border-border bg-muted/40 text-muted-foreground",
        label: "Stable",
      };
    case "recovered":
      return {
        className: "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
        label: "Recovered",
      };
  }
}

// -------------------------------------------------------------------------
// Page
// -------------------------------------------------------------------------
export default function AdminProducerTrends() {
  const qc = useQueryClient();
  const [kpi, setKpi] = useState<KpiKey>("all");
  const [managerFilter, setManagerFilter] = useState<string>("all"); // manager_id | 'all'
  const [riskFilter, setRiskFilter] = useState<string>("all"); // risk level
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [reviewQueue, setReviewQueue] = useState<string[] | null>(null);
  const [reviewIdx, setReviewIdx] = useState(0);

  // ---- Data sources ----
  const trendsQ = useQuery<TrendAlertRow[]>({
    queryKey: ["producer-trend-alert"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_producer_trend_alert" as any)
        .select("*")
        .order("currently_dropping", { ascending: false })
        .order("delta_pct", { ascending: true });
      if (error) throw error;
      return ((data as unknown) as TrendAlertRow[]) ?? [];
    },
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });

  const newHiresQ = useQuery<NewHireActivationRow[]>({
    queryKey: ["new-hires-activation"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_new_hires_activation" as any)
        .select("*")
        .order("days_since_hire", { ascending: false });
      if (error) throw error;
      return ((data as unknown) as NewHireActivationRow[]) ?? [];
    },
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });

  const weeklyQ = useQuery<WeeklyRow[]>({
    queryKey: ["agent-weekly-production"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_agent_weekly_production" as any)
        .select("agent_id, display_name, week_start, deals, alp")
        .order("week_start", { ascending: true });
      if (error) throw error;
      return ((data as unknown) as WeeklyRow[]) ?? [];
    },
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });

  // Per-manager downline health. Short list by construction — only managers
  // who actually hold reports appear, so this renders as cards, not a table.
  const managerScorecardQ = useQuery<ManagerScorecardRow[]>({
    queryKey: ["manager-scorecard"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_manager_scorecard" as any)
        .select("*")
        .order("retention_risk_pct", { ascending: false });
      if (error) throw error;
      return ((data as unknown) as ManagerScorecardRow[]) ?? [];
    },
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });

  const agentMetaQ = useQuery<AgentMetaRow[]>({
    queryKey: ["mp259-agent-meta", (trendsQ.data ?? []).map((r) => r.producer_id).join(",")],
    enabled: (trendsQ.data ?? []).length > 0,
    queryFn: async () => {
      const ids = (trendsQ.data ?? []).map((r) => r.producer_id);
      if (ids.length === 0) return [];
      const q: any = supabase;
      const { data, error } = await q
        .from("agents")
        .select(
          "id, agent_code, status, onboarding_stage, license_status, al_user_id, manager_id, total_policies",
        )
        .in("id", ids);
      if (error) return [];
      return (data ?? []) as AgentMetaRow[];
    },
    staleTime: 60_000,
  });

  const managerIds = useMemo(() => {
    const set = new Set<string>();
    for (const m of agentMetaQ.data ?? []) if (m.manager_id) set.add(m.manager_id);
    for (const nh of newHiresQ.data ?? []) if (nh.manager_id) set.add(nh.manager_id);
    return Array.from(set);
  }, [agentMetaQ.data, newHiresQ.data]);

  const managersQ = useQuery<ManagerRow[]>({
    queryKey: ["mp259-managers", managerIds.join(",")],
    enabled: managerIds.length > 0,
    queryFn: async () => {
      const q: any = supabase;
      const { data, error } = await q
        .from("agents")
        .select("id, display_name")
        .in("id", managerIds)
        .order("display_name", { ascending: true });
      if (error) return [];
      return (data ?? []) as ManagerRow[];
    },
    staleTime: 5 * 60_000,
  });

  // Review + recovery tags from agent_notes — canonical [REVIEWED] / [RECOVERED]
  // markers written by ProducerDetailsDrawer. 7-day window.
  const reviewTagsQ = useQuery<ReviewTagRow[]>({
    queryKey: ["mp259-review-tags"],
    queryFn: async () => {
      const q: any = supabase;
      const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
      const { data, error } = await q
        .from("agent_notes")
        .select("agent_id, note, created_at")
        .gte("created_at", since);
      if (error) return [];
      return (data ?? []) as ReviewTagRow[];
    },
    staleTime: 60_000,
  });

  // Last-contact map from agent_notes (most-recent per agent).
  const lastContactQ = useQuery<Record<string, string>>({
    queryKey: ["mp259-last-contact", (trendsQ.data ?? []).map((r) => r.producer_id).join(",")],
    enabled: (trendsQ.data ?? []).length > 0,
    queryFn: async () => {
      const q: any = supabase;
      const ids = (trendsQ.data ?? []).map((r) => r.producer_id);
      if (ids.length === 0) return {} as Record<string, string>;
      const { data, error } = await q
        .from("agent_notes")
        .select("agent_id, created_at")
        .in("agent_id", ids)
        .order("created_at", { ascending: false });
      if (error) return {} as Record<string, string>;
      const map: Record<string, string> = {};
      for (const r of (data ?? []) as Array<{ agent_id: string; created_at: string }>) {
        if (!map[r.agent_id]) map[r.agent_id] = r.created_at;
      }
      return map;
    },
    staleTime: 60_000,
  });

  // ---- Derivations ----
  const seriesByAgent = useMemo(() => {
    const map: Record<string, number[]> = {};
    for (const row of weeklyQ.data ?? []) {
      if (!map[row.agent_id]) map[row.agent_id] = [];
      map[row.agent_id].push(row.alp);
    }
    return map;
  }, [weeklyQ.data]);

  const metaById = useMemo(() => {
    const map: Record<string, AgentMetaRow> = {};
    for (const m of agentMetaQ.data ?? []) map[m.id] = m;
    return map;
  }, [agentMetaQ.data]);

  const managerNameById = useMemo(() => {
    const map: Record<string, string> = {};
    for (const m of managersQ.data ?? []) if (m.id) map[m.id] = m.display_name ?? "—";
    return map;
  }, [managersQ.data]);

  const reviewMap = useMemo(() => {
    const map = new Map<string, { reviewed: boolean; recovered: boolean }>();
    for (const r of reviewTagsQ.data ?? []) {
      const prev = map.get(r.agent_id) ?? { reviewed: false, recovered: false };
      if (r.note?.startsWith("[REVIEWED]")) prev.reviewed = true;
      if (r.note?.startsWith("[RECOVERED]")) prev.recovered = true;
      map.set(r.agent_id, prev);
    }
    return map;
  }, [reviewTagsQ.data]);

  const neverActivatedSet = useMemo(
    () => new Set((newHiresQ.data ?? []).map((h) => h.agent_id).filter(Boolean) as string[]),
    [newHiresQ.data],
  );

  const rows: RiskRow[] = useMemo(() => {
    const now = new Date();
    return (trendsQ.data ?? []).map((r) => {
      const meta = metaById[r.producer_id];
      const series = seriesByAgent[r.producer_id] ?? [];
      const lastContact = lastContactQ.data?.[r.producer_id] ?? null;
      const daysSinceContact = daysBetween(lastContact, now);
      const noAlp30 =
        (r.current_week_alp ?? 0) === 0 &&
        (r.alp_1w_ago ?? 0) === 0 &&
        (r.alp_2w_ago ?? 0) === 0 &&
        (r.alp_3_weeks_ago ?? 0) === 0;
      const noAgentlink = !meta?.al_user_id;
      const noRecentContact = daysSinceContact == null ? true : daysSinceContact >= 14;
      const rev = reviewMap.get(r.producer_id) ?? { reviewed: false, recovered: false };
      const neverActivated = neverActivatedSet.has(r.producer_id);

      const enriched = {
        currently_dropping: r.currently_dropping,
        never_activated_60_days: neverActivated,
        no_alp_30_days: noAlp30,
        direction: r.direction,
        no_agentlink: noAgentlink,
        no_recent_contact: noRecentContact,
        recovered_this_week: rev.recovered,
      };

      const score = getPriorityScore({
        kind: "producer_risk",
        dropped_3_weeks: enriched.currently_dropping,
        never_activated_60_days: enriched.never_activated_60_days,
        no_alp_30_days: enriched.no_alp_30_days,
        down_this_week: enriched.direction === "down" && !enriched.currently_dropping,
        no_agentlink: enriched.no_agentlink,
        no_recent_contact: enriched.no_recent_contact,
        reviewed_this_week: rev.reviewed,
        recovered: rev.recovered,
      });

      return {
        producer_id: r.producer_id,
        display_name: r.display_name,
        manager_id: meta?.manager_id ?? null,
        manager_name: meta?.manager_id ? managerNameById[meta.manager_id] ?? "—" : "Unassigned",
        current_week_alp: r.current_week_alp,
        previous_week_alp: r.alp_1w_ago,
        alp_2w_ago: r.alp_2w_ago,
        alp_3_weeks_ago: r.alp_3_weeks_ago,
        delta_pct: r.delta_pct,
        direction: r.direction,
        currently_dropping: r.currently_dropping,
        weekly_series: series,
        total_policies: meta?.total_policies ?? null,
        stage: meta?.onboarding_stage ?? meta?.status ?? null,
        agentlink_linked: !!meta?.al_user_id,
        last_contact: lastContact,
        never_activated_60_days: neverActivated,
        no_alp_30_days: noAlp30,
        no_agentlink: noAgentlink,
        no_recent_contact: noRecentContact,
        reviewed_this_week: rev.reviewed,
        recovered_this_week: rev.recovered,
        priority_score: score,
        priority_label: getPriorityLabel(score),
        risk_level: riskLevelFor(enriched),
      } satisfies RiskRow;
    });
  }, [trendsQ.data, metaById, seriesByAgent, lastContactQ.data, reviewMap, managerNameById, neverActivatedSet]);

  const kpiCounts = useMemo(() => {
    const dropping3w = rows.filter((r) => r.currently_dropping).length;
    const downThisWeek = rows.filter(
      (r) => r.direction === "down" && !r.currently_dropping,
    ).length;
    const neverActivated = (newHiresQ.data ?? []).length;
    const noAlp30 = rows.filter((r) => r.no_alp_30_days).length;
    const recovered = rows.filter((r) => r.recovered_this_week).length;
    const managerReview = rows.filter(
      (r) => r.currently_dropping && !r.reviewed_this_week && !r.recovered_this_week,
    ).length;
    return {
      all: rows.length,
      dropping_3w: dropping3w,
      down_this_week: downThisWeek,
      never_activated_60d: neverActivated,
      no_alp_30d: noAlp30,
      recovered_this_week: recovered,
      manager_review_needed: managerReview,
    };
  }, [rows, newHiresQ.data]);

  const filtered = useMemo(() => {
    let out = rows;
    if (managerFilter !== "all") {
      out = out.filter((r) => r.manager_id === managerFilter);
    }
    if (kpi === "dropping_3w") out = out.filter((r) => r.currently_dropping);
    else if (kpi === "down_this_week") out = out.filter((r) => r.direction === "down" && !r.currently_dropping);
    else if (kpi === "never_activated_60d") out = out.filter((r) => r.never_activated_60_days);
    else if (kpi === "no_alp_30d") out = out.filter((r) => r.no_alp_30_days);
    else if (kpi === "recovered_this_week") out = out.filter((r) => r.recovered_this_week);
    else if (kpi === "manager_review_needed")
      out = out.filter((r) => r.currently_dropping && !r.reviewed_this_week && !r.recovered_this_week);
    if (riskFilter !== "all") out = out.filter((r) => r.risk_level === riskFilter);
    // Sort by priority score desc so the highest-risk producers surface at the top.
    return [...out].sort((a, b) => b.priority_score - a.priority_score);
  }, [rows, managerFilter, kpi, riskFilter]);

  const filteredNewHires = useMemo(() => {
    let out = newHiresQ.data ?? [];
    if (managerFilter !== "all") out = out.filter((r) => r.manager_id === managerFilter);
    return out;
  }, [newHiresQ.data, managerFilter]);

  // Worst retention risk first — a 9-person leg bleeding 55% outranks a
  // 96-person leg bleeding 27%. Deactivated managers sink to the bottom.
  const scorecardRows = useMemo(() => {
    let out = managerScorecardQ.data ?? [];
    if (managerFilter !== "all") out = out.filter((r) => r.manager_agent_id === managerFilter);
    return [...out].sort((a, b) => {
      const deactivated = Number(!!a.manager_deactivated) - Number(!!b.manager_deactivated);
      if (deactivated !== 0) return deactivated;
      return (toNum(b.retention_risk_pct) ?? -1) - (toNum(a.retention_risk_pct) ?? -1);
    });
  }, [managerScorecardQ.data, managerFilter]);

  // ---- Recovery Review workflow ----
  function startRecoveryReview() {
    const queue = filtered.map((r) => r.producer_id);
    if (queue.length === 0) return;
    setReviewQueue(queue);
    setReviewIdx(0);
    setDrawerId(queue[0]);
    setDrawerOpen(true);
  }

  function stepReview(delta: number) {
    if (!reviewQueue) return;
    const next = reviewIdx + delta;
    if (next < 0 || next >= reviewQueue.length) {
      // End of queue — close.
      setReviewQueue(null);
      setDrawerOpen(false);
      return;
    }
    setReviewIdx(next);
    setDrawerId(reviewQueue[next]);
  }

  function refreshAll() {
    qc.invalidateQueries({ queryKey: ["producer-trend-alert"] });
    qc.invalidateQueries({ queryKey: ["new-hires-activation"] });
    qc.invalidateQueries({ queryKey: ["agent-weekly-production"] });
    qc.invalidateQueries({ queryKey: ["manager-scorecard"] });
    qc.invalidateQueries({ queryKey: ["mp259-agent-meta"] });
    qc.invalidateQueries({ queryKey: ["mp259-review-tags"] });
    qc.invalidateQueries({ queryKey: ["mp259-last-contact"] });
  }

  const drawerRow = useMemo(
    () => (drawerId ? rows.find((r) => r.producer_id === drawerId) ?? null : null),
    [drawerId, rows],
  );

  const drawerInput: ProducerDrawerInput | null = useMemo(() => {
    if (!drawerRow) return null;
    return {
      producer_id: drawerRow.producer_id,
      display_name: drawerRow.display_name,
      current_week_alp: drawerRow.current_week_alp,
      alp_1w_ago: drawerRow.previous_week_alp,
      alp_2w_ago: drawerRow.alp_2w_ago,
      alp_3_weeks_ago: drawerRow.alp_3_weeks_ago,
      delta_pct: drawerRow.delta_pct,
      direction: drawerRow.direction,
      currently_dropping: drawerRow.currently_dropping,
      weekly_series: drawerRow.weekly_series,
      never_activated_60_days: drawerRow.never_activated_60_days,
      no_alp_30_days: drawerRow.no_alp_30_days,
      no_agentlink: drawerRow.no_agentlink,
      no_recent_contact: drawerRow.no_recent_contact,
    };
  }, [drawerRow]);

  const noAgentLinkCount = useMemo(
    () => rows.filter((r) => r.no_agentlink).length,
    [rows],
  );

  return (
    <>
      {/* max-w-[1400px] (not max-w-6xl) — the primary content is a 12-column
          risk table, one of the two width exceptions the visual contract
          allows. px-4 sm:px-6 is required so PageHeader's -mx-4 sm:-mx-6
          cancels exactly; pb-24 clears the fixed Recovery Review dock. */}
      <div className="page-enter mx-auto w-full max-w-[1400px] space-y-5 px-4 pb-24 sm:px-6">
        <PageHeader
          accent="rose"
          eyebrow="Producers · Trend Surface"
          eyebrowIcon={<TrendingDown className="h-3 w-3" />}
          title="Producer Trends"
          subtitle="Weekly ALP trends, activation gaps, and production drop alerts. Nobody dips silently."
          actions={
            <>
              {/* Manager filter */}
              <Select value={managerFilter} onValueChange={setManagerFilter}>
                <SelectTrigger
                  aria-label="Filter by manager"
                  className="h-10 w-[150px] text-sm sm:h-9 sm:w-[170px]"
                >
                  <SelectValue placeholder="Manager" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All managers</SelectItem>
                  {(managersQ.data ?? []).map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.display_name ?? "—"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* Risk filter */}
              <Select value={riskFilter} onValueChange={setRiskFilter}>
                <SelectTrigger
                  aria-label="Filter by risk level"
                  className="h-10 w-[150px] text-sm sm:h-9 sm:w-[140px]"
                >
                  <SelectValue placeholder="Risk" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All risks</SelectItem>
                  <SelectItem value="critical">Critical</SelectItem>
                  <SelectItem value="dropping">Dropping</SelectItem>
                  <SelectItem value="watch">Watch</SelectItem>
                  <SelectItem value="stable">Stable</SelectItem>
                  <SelectItem value="recovered">Recovered</SelectItem>
                </SelectContent>
              </Select>

              <Button
                variant="outline"
                size="sm"
                onClick={refreshAll}
                className="h-10 gap-1.5 sm:h-9"
              >
                <RefreshCw className="h-4 w-4 shrink-0" />
                Refresh
              </Button>

              <Button
                size="sm"
                onClick={startRecoveryReview}
                disabled={filtered.length === 0}
                className="h-10 gap-1.5 sm:h-9"
              >
                <Play className="h-4 w-4 shrink-0" />
                Start Recovery Review
              </Button>
            </>
          }
        />

        {/* KPI Grid — clickable filters */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <KpiTile
            active={kpi === "dropping_3w"}
            onClick={() => setKpi(kpi === "dropping_3w" ? "all" : "dropping_3w")}
            label="Dropping 3 weeks"
            value={kpiCounts.dropping_3w}
            tone="rose"
          />
          <KpiTile
            active={kpi === "down_this_week"}
            onClick={() => setKpi(kpi === "down_this_week" ? "all" : "down_this_week")}
            label="Down this week"
            value={kpiCounts.down_this_week}
            tone="amber"
          />
          <KpiTile
            active={kpi === "never_activated_60d"}
            onClick={() => setKpi(kpi === "never_activated_60d" ? "all" : "never_activated_60d")}
            label="Never activated 60d"
            value={kpiCounts.never_activated_60d}
            tone="rose"
          />
          <KpiTile
            active={kpi === "no_alp_30d"}
            onClick={() => setKpi(kpi === "no_alp_30d" ? "all" : "no_alp_30d")}
            label="No ALP 30d"
            value={kpiCounts.no_alp_30d}
            tone="amber"
          />
          <KpiTile
            active={kpi === "recovered_this_week"}
            onClick={() => setKpi(kpi === "recovered_this_week" ? "all" : "recovered_this_week")}
            label="Recovered this week"
            value={kpiCounts.recovered_this_week}
            tone="emerald"
          />
          <KpiTile
            active={kpi === "manager_review_needed"}
            onClick={() => setKpi(kpi === "manager_review_needed" ? "all" : "manager_review_needed")}
            label="Manager review needed"
            value={kpiCounts.manager_review_needed}
            tone="rose"
          />
        </div>

        {/* Alert Cards */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <ProducerAlertCard
            tone="rose"
            icon={
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-rose-600 dark:text-rose-400" />
            }
            eyebrow="3-Week Drop Alert"
            title={`${kpiCounts.dropping_3w} producer${kpiCounts.dropping_3w === 1 ? "" : "s"} dropped ALP 3 weeks in a row`}
            body="Same slide Daniel had. Nobody caught it. Reach out today."
            cta="Review Producers"
            onCta={() => setKpi("dropping_3w")}
          />
          <ProducerAlertCard
            tone="rose"
            icon={
              <UserCheck className="mt-0.5 h-5 w-5 shrink-0 text-rose-600 dark:text-rose-400" />
            }
            eyebrow="Never Activated"
            title={`${kpiCounts.never_activated_60d} licensed hire${kpiCounts.never_activated_60d === 1 ? "" : "s"} without a first deal`}
            body="Licensed, cleared the finish line, still zero production."
            cta="Start Activation Push"
            onCta={() => setKpi("never_activated_60d")}
          />
          <ProducerAlertCard
            tone="amber"
            icon={
              <Link2Off className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
            }
            eyebrow="No AgentLink"
            title={`${noAgentLinkCount} producer${noAgentLinkCount === 1 ? "" : "s"} missing AgentLink`}
            body="Production is invisible until AgentLink is linked. Fix the pipe."
            cta="Fix Links"
            onCta={() => setRiskFilter("watch")}
          />
        </div>

        {/* Manager scorecard — v_manager_scorecard */}
        <GlassCard className="p-4">
          <div className="mb-1 flex items-baseline justify-between gap-2">
            <h3 className="flex min-w-0 items-center gap-2 text-sm font-semibold text-foreground">
              <ShieldAlert className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="truncate">Manager scorecard</span>
            </h3>
            <span className="shrink-0 text-sm font-bold tabular-nums text-muted-foreground">
              {scorecardRows.length}
            </span>
          </div>
          <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
            Retention risk and first-sale gap for every manager holding a downline — a leg
            scoring high is losing licensed agents faster than it activates them.
          </p>

          {managerScorecardQ.isLoading ? (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {/* stable-key-allow:skeleton */}
              {["scorecard-a", "scorecard-b"].map((slot) => (
                <div
                  key={slot}
                  className="h-48 animate-pulse rounded-lg border border-border bg-muted/30"
                />
              ))}
            </div>
          ) : managerScorecardQ.isError ? (
            <div className="rounded-lg border border-rose-500/35 bg-rose-500/5 p-3 sm:p-4">
              <div className="flex min-w-0 items-start gap-3">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-rose-600 dark:text-rose-400" />
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground">
                    Manager scorecard failed to load
                  </p>
                  <p className="mt-0.5 text-xs text-amber-600 dark:text-amber-400">
                    These numbers are missing, not zero.
                  </p>
                  <p className="mt-1 break-words text-xs text-muted-foreground">
                    {managerScorecardQ.error?.message ?? "v_manager_scorecard returned an error."}
                  </p>
                </div>
              </div>
            </div>
          ) : scorecardRows.length === 0 ? (
            <EmptyState
              icon={<ShieldAlert className="h-7 w-7" />}
              variant={managerFilter === "all" ? "warning" : "default"}
              title={
                managerFilter === "all"
                  ? "No manager holds a downline yet"
                  : "The selected manager holds no downline"
              }
              description={
                managerFilter === "all"
                  ? "Set manager_id on agents and every leg scores itself here."
                  : "Switch to All managers to see the legs that do."
              }
            />
          ) : (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {scorecardRows.map((r) => (
                <ManagerScorecardCard key={r.manager_agent_id} row={r} />
              ))}
            </div>
          )}
        </GlassCard>

        {/* ProducerRiskTable */}
        <GlassCard className="overflow-hidden p-4">
          <div className="mb-1 flex items-baseline justify-between gap-2">
            <h3 className="flex min-w-0 items-center gap-2 text-sm font-semibold text-foreground">
              <TrendingDown className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="truncate">Producer risk queue</span>
            </h3>
            <span className="shrink-0 text-sm font-bold tabular-nums text-muted-foreground">
              {filtered.length}
            </span>
          </div>
          <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
            Hardest problem first — a row sits here because the week-over-week ALP moved
            against the producer or the pipe carrying their production is broken.
          </p>

          {trendsQ.isLoading ? (
            <div className="space-y-2">
              {[...Array(6)].map((_, i) => (
                // stable-key-allow:skeleton — static Array(N) decorative loader, no reorder
                <div key={i} className="h-11 animate-pulse rounded-lg bg-muted/30" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={<Users className="h-7 w-7" />}
              variant="default"
              title="No producers match the current filters"
              description="Adjust the KPI, manager, or risk filter above to widen the queue."
            />
          ) : (
            <ProducerRiskTable
              rows={filtered}
              onOpen={(id) => {
                setDrawerId(id);
                setDrawerOpen(true);
              }}
            />
          )}
        </GlassCard>

        {/* NeverActivatedTable */}
        <GlassCard className="overflow-hidden p-4">
          <div className="mb-1 flex items-baseline justify-between gap-2">
            <h3 className="flex min-w-0 items-center gap-2 text-sm font-semibold text-foreground">
              <UserCheck className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="truncate">Never activated</span>
            </h3>
            <span className="shrink-0 text-sm font-bold tabular-nums text-muted-foreground">
              {filteredNewHires.length}
            </span>
          </div>
          <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
            Licensed hires that have never written a first deal — every day on this list is a
            paid-for license returning nothing.
          </p>

          {filteredNewHires.length === 0 ? (
            <EmptyState
              icon={<UserCheck className="h-7 w-7" />}
              variant="success"
              title="Every recently-licensed hire has produced a first deal"
              description="Nobody is sitting licensed and idle. Keep the activation push running so this list stays empty."
            />
          ) : (
            <NeverActivatedTable rows={filteredNewHires} />
          )}
        </GlassCard>
      </div>

      {/* Producer details drawer */}
      <ProducerDetailsDrawer
        open={drawerOpen}
        onOpenChange={(v) => {
          setDrawerOpen(v);
          if (!v) setReviewQueue(null);
        }}
        producer={drawerInput}
      />

      {/* Recovery Review dock */}
      {reviewQueue && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background">
          <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-2 px-4 py-3 sm:px-6">
            <ClipboardCheck className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="shrink-0 text-sm font-semibold tabular-nums text-foreground">
              Recovery Review · {reviewIdx + 1} of {reviewQueue.length}
            </span>
            <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
              {drawerRow?.display_name ?? "—"}
            </span>
            <div className="flex shrink-0 items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => stepReview(-1)}
                disabled={reviewIdx === 0}
                className="h-10 sm:h-9"
              >
                Prev
              </Button>
              <Button
                size="sm"
                onClick={() => stepReview(1)}
                className="h-10 gap-1.5 sm:h-9"
              >
                Next
                <ChevronRight className="h-4 w-4 shrink-0" />
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setReviewQueue(null);
                  setDrawerOpen(false);
                }}
                className="h-10 sm:h-9"
              >
                Exit
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// -------------------------------------------------------------------------
// KpiTile
// -------------------------------------------------------------------------
const KPI_TONE: Record<"rose" | "amber" | "emerald" | "neutral", string> = {
  rose: "text-rose-600 dark:text-rose-400",
  amber: "text-amber-600 dark:text-amber-400",
  emerald: "text-emerald-600 dark:text-emerald-400",
  neutral: "text-foreground",
};

function KpiTile({
  label,
  value,
  tone,
  active,
  onClick,
}: {
  label: string;
  value: number;
  tone: "rose" | "amber" | "emerald" | "neutral";
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        // h-full + justify-between keeps every headline number on the same
        // baseline even when a two-word label wraps to two lines.
        "flex h-full min-w-0 flex-col justify-between rounded-lg border border-border bg-card p-3 text-left",
        "transition-colors hover:bg-muted/30",
        "focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)]",
        active && "ring-2 ring-primary/60",
      )}
    >
      <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className={cn("mt-2 text-2xl font-bold leading-none tabular-nums", KPI_TONE[tone])}>
        {value.toLocaleString()}
      </span>
    </button>
  );
}

// -------------------------------------------------------------------------
// ProducerAlertCard — whole-block severity callout (visual contract §6)
// -------------------------------------------------------------------------
const ALERT_TONE: Record<"rose" | "amber" | "emerald", string> = {
  rose: "border-rose-500/35 bg-rose-500/5",
  amber: "border-amber-500/35 bg-amber-500/5",
  emerald: "border-emerald-500/35 bg-emerald-500/5",
};

function ProducerAlertCard({
  tone,
  icon,
  eyebrow,
  title,
  body,
  cta,
  onCta,
}: {
  tone: "rose" | "amber" | "emerald";
  icon: ReactNode;
  eyebrow: string;
  title: string;
  body: string;
  cta: string;
  onCta: () => void;
}) {
  return (
    <div className={cn("rounded-lg border p-3 sm:p-4", ALERT_TONE[tone])}>
      <div className="flex min-w-0 items-start gap-3">
        {icon}
        <div className="min-w-0">
          <div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
            {eyebrow}
          </div>
          <p className="mt-0.5 text-sm font-semibold text-foreground">{title}</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{body}</p>
          <Button
            size="sm"
            variant="outline"
            onClick={onCta}
            className="mt-3 h-10 w-full gap-1.5 sm:h-9 sm:w-auto"
          >
            {cta}
            <ArrowRight className="h-4 w-4 shrink-0" />
          </Button>
        </div>
      </div>
    </div>
  );
}

// -------------------------------------------------------------------------
// ManagerScorecardCard — one card per manager who holds a downline.
//
// Only a couple of managers carry reports, so this renders as a short stack of
// cards instead of a 17-column table nobody reads on a phone. The two numbers
// that cost Sam money get hero treatment (retention risk, reports with no first
// sale); everything else the view returns rides a compact wrapping chip line so
// no column is dropped and nothing needs a horizontal scrollbar.
// -------------------------------------------------------------------------

/** Border-only tint — the container states severity, the number carries it. */
const SCORE_EDGE_BORDER: Record<ScoreTone, string> = {
  rose: "border-rose-500/35",
  amber: "border-amber-500/35",
  emerald: "border-emerald-500/35",
  neutral: "border-border",
};

const SCORE_TEXT_TONE: Record<ScoreTone, string> = {
  rose: "text-rose-600 dark:text-rose-400",
  amber: "text-amber-600 dark:text-amber-400",
  emerald: "text-emerald-600 dark:text-emerald-400",
  neutral: "text-foreground",
};

const SCORE_EDGE_TONE: Record<ScoreTone, string> = {
  rose: "border-l-rose-500/70",
  amber: "border-l-amber-500/70",
  emerald: "border-l-emerald-500/70",
  neutral: "border-l-border",
};

function ManagerScorecardCard({ row }: { row: ManagerScorecardRow }) {
  const risk = toNum(row.retention_risk_pct);
  const active = toNum(row.reports_activeroster) ?? 0;
  const noFirstSale = toNum(row.reports_no_first_sale);
  const noFirstSaleShare =
    noFirstSale != null && active > 0 ? (noFirstSale / active) * 100 : null;

  const riskTone = severityTone(risk, 50, 25);
  const saleTone = severityTone(noFirstSaleShare, 50, 25);
  // pct_licensed_producing is a "higher is better" number; severityTone reads
  // "higher is worse", so score the shortfall instead of the value.
  const producingPct = toNum(row.pct_licensed_producing);
  const producingShortfall = producingPct == null ? null : 100 - producingPct;
  // The view can hand back a percentage outside 0-100 (prod returned -14.5 for
  // the largest leg on 2026-07-25). Surface it verbatim with a flag rather than
  // clamping or blanking it — a hidden bad number is how a broken view survives.
  const producingOutOfRange =
    producingPct != null && (producingPct < 0 || producingPct > 100);
  // Card edge takes whichever of the two headline numbers is screaming loudest.
  const edgeTone: ScoreTone =
    riskTone === "rose" || saleTone === "rose"
      ? "rose"
      : riskTone === "amber" || saleTone === "amber"
        ? "amber"
        : riskTone === "neutral" && saleTone === "neutral"
          ? "neutral"
          : "emerald";

  // Everything the view returns that is not a hero stat or the header line.
  // Keys are literal + stable so the chip row never index-keys a DB-derived list.
  const chips: Array<{
    key: string;
    label: string;
    value: string;
    tone: ScoreTone;
    title?: string;
  }> = [
    {
      key: "licensed",
      label: "Licensed",
      value: `${fmtInt(row.reports_licensed)} · ${fmtPct(row.pct_licensed)}`,
      tone: "neutral",
    },
    {
      key: "licensed-producing",
      label: producingOutOfRange ? "Licensed producing ⚠" : "Licensed producing",
      value: fmtPct(producingPct),
      tone: severityTone(producingShortfall, 75, 50),
      title: producingOutOfRange
        ? "v_manager_scorecard returned a percentage outside 0-100. That is the view's math, not a display bug — fix pct_licensed_producing upstream."
        : undefined,
    },
    {
      key: "onboarding-incomplete",
      label: "Onboarding open",
      value: fmtInt(row.reports_onboarding_incomplete),
      tone: "neutral",
    },
    {
      key: "contracted",
      label: "Contracted",
      value: fmtInt(row.reports_contracted),
      tone: "neutral",
    },
    {
      key: "appointment-set",
      label: "Appt set",
      value: fmtInt(row.reports_appointment_set),
      tone: "neutral",
    },
    {
      key: "in-force-alp",
      label: "Team in-force ALP",
      value: fmtUSDCompact(toNum(row.team_in_force_alp)),
      tone: "neutral",
    },
    {
      key: "deals-30d",
      label: "Deals 30d",
      value: fmtInt(row.team_deals_30d),
      tone: (toNum(row.team_deals_30d) ?? 0) === 0 ? "amber" : "neutral",
    },
    {
      key: "alp-30d",
      label: "ALP 30d",
      value: fmtUSDCompact(toNum(row.team_alp_30d)),
      tone: (toNum(row.team_alp_30d) ?? 0) === 0 ? "amber" : "neutral",
    },
  ];

  return (
    <div
      className={cn(
        "rounded-lg border border-border border-l-4 bg-card p-3 sm:p-4",
        SCORE_EDGE_TONE[edgeTone],
        row.manager_deactivated && "opacity-70",
      )}
    >
      {/* Header — name opens the agent drawer, roster counts sit underneath. */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
            Manager · downline health
          </div>
          <div className="mt-0.5 min-w-0">
            <AgentNameLink agentId={row.manager_agent_id}>
              <span className="min-w-0 truncate text-sm font-semibold text-foreground">
                {row.manager_name ?? "Unnamed manager"}
              </span>
            </AgentNameLink>
          </div>
          <div className="mt-0.5 text-[11px] tabular-nums text-muted-foreground">
            {fmtInt(row.reports_activeroster)} on active roster · {fmtInt(row.reports_total)} total
            reports
          </div>
        </div>
        {row.manager_deactivated && (
          <Badge
            variant="outline"
            className="shrink-0 border-rose-500/40 text-[10px] text-rose-600 dark:text-rose-400"
          >
            <UserX className="mr-1 h-3 w-3 shrink-0" />
            deactivated
          </Badge>
        )}
      </div>

      {/* The two numbers that cost money. */}
      <div className="mt-3 grid grid-cols-2 gap-3">
        <ScorecardHeroStat
          label="Retention risk"
          value={fmtPct(risk)}
          sub={`${fmtInt(row.reports_licensed_inactive)} licensed but not producing`}
          tone={riskTone}
        />
        <ScorecardHeroStat
          label="No first sale"
          value={fmtInt(noFirstSale)}
          sub={
            noFirstSaleShare == null
              ? "No active roster to measure against"
              : `${fmtPct(noFirstSaleShare, 0)} of the active roster`
          }
          tone={saleTone}
        />
      </div>

      {/* Everything else the view returns — wraps, never scrolls sideways. */}
      <div className="mt-3 flex flex-wrap gap-2">
        {chips.map((c) => (
          <ScorecardChip
            key={c.key}
            label={c.label}
            value={c.value}
            tone={c.tone}
            title={c.title}
          />
        ))}
      </div>
    </div>
  );
}

function ScorecardHeroStat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub: string;
  tone: ScoreTone;
}) {
  return (
    <div className={cn("min-w-0 rounded-lg border bg-background p-3", SCORE_EDGE_BORDER[tone])}>
      <div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className={cn("mt-1.5 text-2xl font-bold leading-none tabular-nums", SCORE_TEXT_TONE[tone])}>
        {value}
      </div>
      <div className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">{sub}</div>
    </div>
  );
}

function ScorecardChip({
  label,
  value,
  tone,
  title,
}: {
  label: string;
  value: string;
  tone: ScoreTone;
  title?: string;
}) {
  return (
    <span
      title={title}
      className="inline-flex min-w-0 items-baseline gap-1.5 rounded-md border border-border bg-background px-2 py-1"
    >
      <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className={cn("text-xs font-bold tabular-nums", SCORE_TEXT_TONE[tone])}>{value}</span>
    </span>
  );
}

// -------------------------------------------------------------------------
// ProducerRiskTable
//
// 12 real columns, so it stays a table rather than a card list. The
// `-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0` wrapper is the only element
// allowed to scroll sideways — the page body never does.
// -------------------------------------------------------------------------
function ProducerRiskTable({
  rows,
  onOpen,
}: {
  rows: RiskRow[];
  onOpen: (producer_id: string) => void;
}) {
  return (
    <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <table className="w-full min-w-[1120px] text-sm">
        <thead>
          <tr className="border-b border-border text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
            <th className="px-2 py-2 text-left">Producer</th>
            <th className="px-2 py-2 text-left">Manager</th>
            <th className="px-2 py-2 text-right">Latest Week</th>
            <th className="px-2 py-2 text-right">Prior Week</th>
            <th className="px-2 py-2 text-left">3-Week Trend</th>
            <th className="px-2 py-2 text-right">Policies</th>
            <th className="px-2 py-2 text-left">Stage</th>
            <th className="px-2 py-2 text-left">AgentLink</th>
            <th className="px-2 py-2 text-right">Last Contact</th>
            <th className="px-2 py-2 text-left">Risk</th>
            <th className="px-2 py-2 text-left">Next Best Action</th>
            <th className="px-2 py-2 text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const nba = getNextBestAction({
              kind: "producer_risk",
              dropped_3_weeks: r.currently_dropping,
              never_activated_60_days: r.never_activated_60_days,
              no_alp_30_days: r.no_alp_30_days,
              down_this_week: r.direction === "down" && !r.currently_dropping,
              no_agentlink: r.no_agentlink,
              no_recent_contact: r.no_recent_contact,
              reviewed_this_week: r.reviewed_this_week,
              recovered: r.recovered_this_week,
            });
            const priorityBadge = priorityBadgeClasses(r.priority_label);
            const riskBadge = riskBadgeClasses(r.risk_level);
            return (
              <tr
                key={r.producer_id}
                onClick={() => onOpen(r.producer_id)}
                className={cn(
                  "cursor-pointer border-b border-border/60 transition-colors hover:bg-muted/30",
                  r.currently_dropping &&
                    "border-l-2 border-l-rose-500/50 bg-rose-500/[0.05] hover:bg-rose-500/10",
                )}
              >
                <td className="max-w-[200px] px-2 py-2" onClick={(e) => e.stopPropagation()}>
                  <AgentNameLink agentId={r.producer_id}>
                    <span className="min-w-0 truncate text-sm font-medium text-foreground">
                      {r.display_name}
                    </span>
                  </AgentNameLink>
                </td>
                <td className="max-w-[140px] px-2 py-2">
                  <div className="truncate text-[11px] text-muted-foreground">{r.manager_name}</div>
                </td>
                <td className="px-2 py-2 text-right text-sm font-bold tabular-nums text-foreground">
                  {fmtUSDCompact(r.current_week_alp)}
                </td>
                <td className="px-2 py-2 text-right text-sm tabular-nums text-muted-foreground">
                  {fmtUSDCompact(r.previous_week_alp)}
                </td>
                <td className="px-2 py-2">
                  <TrendCell
                    series={r.weekly_series}
                    delta_pct={r.delta_pct}
                    direction={r.direction}
                    dropping={r.currently_dropping}
                  />
                </td>
                <td className="px-2 py-2 text-right text-sm tabular-nums text-muted-foreground">
                  {r.total_policies ?? "—"}
                </td>
                <td className="max-w-[120px] px-2 py-2">
                  <div className="truncate text-[11px] text-muted-foreground">{r.stage ?? "—"}</div>
                </td>
                <td className="px-2 py-2">
                  {r.agentlink_linked ? (
                    <Badge
                      variant="outline"
                      className="border-emerald-500/40 text-[10px] text-emerald-600 dark:text-emerald-400"
                    >
                      <Link2 className="mr-1 h-3 w-3 shrink-0" /> linked
                    </Badge>
                  ) : (
                    <Badge
                      variant="outline"
                      className="border-amber-500/40 text-[10px] text-amber-600 dark:text-amber-400"
                    >
                      <Link2Off className="mr-1 h-3 w-3 shrink-0" /> unlinked
                    </Badge>
                  )}
                </td>
                <td className="px-2 py-2 text-right text-[11px] tabular-nums text-muted-foreground">
                  {fmtDate(r.last_contact)}
                </td>
                <td className="px-2 py-2">
                  {/* Risk carries the severity colour; priority rides underneath as a
                      micro-label so one cell never stacks two competing hues. */}
                  <Badge
                    variant="outline"
                    className={cn("text-[10px] font-bold", riskBadge.className)}
                  >
                    {riskBadge.label}
                  </Badge>
                  <div className="mt-1 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                    {priorityBadge.text}
                  </div>
                </td>
                <td className="max-w-[220px] px-2 py-2">
                  <div
                    className="truncate text-sm font-medium text-foreground"
                    title={nba.action}
                  >
                    {nba.action}
                  </div>
                  <div className="mt-0.5 truncate text-[11px] text-muted-foreground" title={nba.reason}>
                    {nba.reason}
                  </div>
                </td>
                <td className="px-2 py-2 text-right">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpen(r.producer_id);
                    }}
                    aria-label={`Open ${r.display_name}`}
                    className="h-10 sm:h-8"
                  >
                    Open
                  </Button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function TrendCell({
  series,
  delta_pct,
  direction,
  dropping,
}: {
  series: number[];
  delta_pct: number;
  direction: "up" | "down" | "flat";
  dropping: boolean;
}) {
  const highlight: "rose" | "emerald" | "muted" = dropping
    ? "rose"
    : direction === "up"
      ? "emerald"
      : "muted";
  const barClass =
    highlight === "rose"
      ? "bg-rose-500"
      : highlight === "emerald"
        ? "bg-emerald-500"
        : "bg-muted-foreground/40";
  const max = Math.max(...(series.length ? series : [1]), 1);
  return (
    <div className="flex items-center gap-2">
      <div className="flex h-6 w-24 shrink-0 items-end gap-0.5">
        {(series.length ? series : Array.from({ length: 12 }, () => 0)).map((v, i) => (
          <div
            // stable-key-allow:deterministic-week-index-fixed-length-sparkline
            key={i}
            className={cn("w-1.5 rounded-sm", barClass)}
            style={{ height: `${Math.max(2, (v / max) * 100)}%` }}
            title={`Week ${i + 1}: $${v.toLocaleString()}`}
          />
        ))}
      </div>
      <span
        className={cn(
          "inline-flex shrink-0 items-center gap-0.5 text-sm font-bold tabular-nums",
          delta_pct < -25 && "text-rose-600 dark:text-rose-400",
          delta_pct >= -25 && delta_pct < 0 && "text-amber-600 dark:text-amber-400",
          delta_pct === 0 && "text-muted-foreground",
          delta_pct > 0 && "text-emerald-600 dark:text-emerald-400",
        )}
      >
        {direction === "down" && <ArrowDownRight className="h-3 w-3 shrink-0" />}
        {direction === "up" && <ArrowUpRight className="h-3 w-3 shrink-0" />}
        {direction === "flat" && <Minus className="h-3 w-3 shrink-0" />}
        {delta_pct > 0 ? "+" : ""}
        {delta_pct}%
      </span>
    </div>
  );
}

// -------------------------------------------------------------------------
// NeverActivatedTable
// -------------------------------------------------------------------------
function NeverActivatedTable({ rows }: { rows: NewHireActivationRow[] }) {
  return (
    <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <table className="w-full min-w-[880px] text-sm">
        <thead>
          <tr className="border-b border-border text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
            <th className="px-2 py-2 text-left">Producer</th>
            <th className="px-2 py-2 text-right">Days Since Hire</th>
            <th className="px-2 py-2 text-left">Stage</th>
            <th className="px-2 py-2 text-left">Manager</th>
            <th className="px-2 py-2 text-left">AgentLink</th>
            <th className="px-2 py-2 text-right">Last Activity</th>
            <th className="px-2 py-2 text-left">Next Action</th>
            <th className="px-2 py-2 text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.agent_id}
              className="border-b border-border/60 transition-colors hover:bg-muted/30"
            >
              <td className="max-w-[200px] px-2 py-2">
                <AgentNameLink agentId={r.agent_id}>
                  <span className="min-w-0 truncate text-sm font-medium text-foreground">
                    {r.display_name}
                  </span>
                </AgentNameLink>
              </td>
              <td
                className={cn(
                  "px-2 py-2 text-right text-sm font-bold tabular-nums",
                  r.days_since_hire >= 30 && "text-rose-600 dark:text-rose-400",
                  r.days_since_hire >= 14 && r.days_since_hire < 30 && "text-amber-600 dark:text-amber-400",
                  r.days_since_hire < 14 && "text-muted-foreground",
                )}
              >
                {r.days_since_hire}d
              </td>
              <td className="max-w-[140px] px-2 py-2">
                <div className="truncate text-[11px] text-muted-foreground">
                  {r.onboarding_stage ?? "—"}
                </div>
              </td>
              <td className="max-w-[140px] px-2 py-2">
                <div className="truncate text-[11px] text-muted-foreground">
                  {r.manager_name ?? "—"}
                </div>
              </td>
              <td className="px-2 py-2">
                {r.agentlink_linked ? (
                  <Badge
                    variant="outline"
                    className="border-emerald-500/40 text-[10px] text-emerald-600 dark:text-emerald-400"
                  >
                    <Link2 className="mr-1 h-3 w-3 shrink-0" />
                    linked
                  </Badge>
                ) : (
                  <Badge
                    variant="outline"
                    className="border-amber-500/40 text-[10px] text-amber-600 dark:text-amber-400"
                  >
                    <Link2Off className="mr-1 h-3 w-3 shrink-0" />
                    unlinked
                  </Badge>
                )}
              </td>
              <td className="px-2 py-2 text-right text-[11px] tabular-nums text-muted-foreground">
                {fmtDate(r.hire_date)}
              </td>
              <td className="max-w-[220px] px-2 py-2">
                <div
                  className="truncate text-sm font-medium text-foreground"
                  title={r.next_action_text ?? undefined}
                >
                  {r.next_action_text ?? "AgentLink check + first-deal push"}
                </div>
                {r.next_action_due_at && (
                  <div className="mt-0.5 truncate text-[11px] tabular-nums text-muted-foreground">
                    Due {fmtDate(r.next_action_due_at)}
                  </div>
                )}
              </td>
              <td className="px-2 py-2 text-right">
                <Button size="sm" variant="outline" asChild className="h-10 sm:h-8">
                  <a href={`/dashboard/agents/${r.agent_id}`} aria-label={`Open ${r.display_name}`}>
                    Open
                  </a>
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
