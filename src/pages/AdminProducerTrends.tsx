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
 */

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

function riskBadgeClasses(level: RiskLevel): { className: string; label: string } {
  switch (level) {
    case "critical":
      return { className: "bg-rose-500/15 text-rose-300 border border-rose-500/40", label: "Critical" };
    case "dropping":
      return { className: "bg-amber-500/15 text-amber-300 border border-amber-500/40", label: "Dropping" };
    case "watch":
      return { className: "bg-blue-500/15 text-blue-300 border border-blue-500/40", label: "Watch" };
    case "stable":
      return { className: "bg-slate-500/15 text-slate-300 border border-slate-500/40", label: "Stable" };
    case "recovered":
      return { className: "bg-emerald-500/15 text-emerald-300 border border-emerald-500/40", label: "Recovered" };
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
    <div className="min-h-screen bg-background text-foreground">
      <div className="container mx-auto px-4 py-6 space-y-6 max-w-7xl">
        {/* Header */}
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-muted-foreground mb-1">
              <TrendingDown className="h-3.5 w-3.5" /> Producers · Trend Surface
            </div>
            <h1 className="text-3xl font-bold text-foreground">Producer Trends</h1>
            <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
              Weekly ALP trends, activation gaps, and production drop alerts.
              Nobody dips silently.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Manager filter */}
            <Select value={managerFilter} onValueChange={setManagerFilter}>
              <SelectTrigger className="h-9 w-[180px] bg-muted/30 border-white/[0.08] text-foreground">
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
              <SelectTrigger className="h-9 w-[140px] bg-muted/30 border-white/[0.08] text-foreground">
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
              className="border-white/[0.14] text-foreground hover:bg-white/[0.04]"
            >
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
              Refresh
            </Button>

            <Button
              size="sm"
              onClick={startRecoveryReview}
              disabled={filtered.length === 0}
              className="bg-teal-500 hover:bg-teal-500/90 text-slate-950 font-semibold"
            >
              <Play className="h-3.5 w-3.5 mr-1.5" />
              Start Recovery Review
            </Button>
          </div>
        </div>

        {/* KPI Grid — clickable filters */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
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
            tone="blue"
          />
        </div>

        {/* Alert Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <ProducerAlertCard
            tone="rose"
            icon={<AlertTriangle className="h-5 w-5 text-rose-300" />}
            eyebrow="3-Week Drop Alert"
            title={`${kpiCounts.dropping_3w} producer${kpiCounts.dropping_3w === 1 ? "" : "s"} dropped ALP 3 weeks in a row`}
            body="Same slide Daniel had. Nobody caught it. Reach out today."
            cta="Review Producers"
            onCta={() => setKpi("dropping_3w")}
          />
          <ProducerAlertCard
            tone="rose"
            icon={<UserCheck className="h-5 w-5 text-rose-300" />}
            eyebrow="Never Activated"
            title={`${kpiCounts.never_activated_60d} licensed hire${kpiCounts.never_activated_60d === 1 ? "" : "s"} without a first deal`}
            body="Licensed, cleared the finish line, still zero production."
            cta="Start Activation Push"
            onCta={() => setKpi("never_activated_60d")}
          />
          <ProducerAlertCard
            tone="amber"
            icon={<Link2Off className="h-5 w-5 text-amber-300" />}
            eyebrow="No AgentLink"
            title={`${noAgentLinkCount} producer${noAgentLinkCount === 1 ? "" : "s"} missing AgentLink`}
            body="Production is invisible until AgentLink is linked. Fix the pipe."
            cta="Fix Links"
            onCta={() => setRiskFilter("watch")}
          />
        </div>

        {/* Manager scorecard — v_manager_scorecard */}
        <Card className="bg-card border-white/[0.08]">
          <CardHeader>
            <CardTitle className="text-base text-foreground flex flex-wrap items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-rose-300" />
              Manager scorecard · retention risk + first-sale gap
              <span className="ml-auto text-xs font-normal text-muted-foreground">
                {scorecardRows.length} manager{scorecardRows.length === 1 ? "" : "s"} holding downline
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {managerScorecardQ.isLoading ? (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                {/* stable-key-allow:skeleton */}
                {["scorecard-a", "scorecard-b"].map((slot) => (
                  <div
                    key={slot}
                    className="h-48 rounded-lg border border-white/[0.08] bg-muted/30 animate-pulse"
                  />
                ))}
              </div>
            ) : managerScorecardQ.isError ? (
              <div className="py-8 text-center text-sm text-rose-300">
                Manager scorecard failed to load. These numbers are missing, not zero.
                <div className="text-xs text-muted-foreground mt-1">
                  {managerScorecardQ.error?.message ?? "v_manager_scorecard returned an error."}
                </div>
              </div>
            ) : scorecardRows.length === 0 ? (
              <div className="py-8 text-center text-muted-foreground">
                {managerFilter === "all"
                  ? "No manager holds a downline yet. Set manager_id on agents and every leg scores itself here."
                  : "The selected manager holds no downline. Switch to All managers to see the legs that do."}
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                {scorecardRows.map((r) => (
                  <ManagerScorecardCard key={r.manager_agent_id} row={r} />
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* ProducerRiskTable */}
        <Card className="bg-card border-white/[0.08]">
          <CardHeader>
            <CardTitle className="text-base text-foreground flex items-center justify-between">
              <span>Producer risk queue</span>
              <span className="text-xs font-normal text-muted-foreground">
                {filtered.length} row{filtered.length === 1 ? "" : "s"}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {trendsQ.isLoading ? (
              <div className="py-10 text-center text-muted-foreground">Loading producer trends…</div>
            ) : filtered.length === 0 ? (
              <div className="py-10 text-center text-muted-foreground">
                No producers match the current filters. Adjust the KPI, manager, or risk filter above.
              </div>
            ) : (
              <ProducerRiskTable
                rows={filtered}
                onOpen={(id) => {
                  setDrawerId(id);
                  setDrawerOpen(true);
                }}
              />
            )}
          </CardContent>
        </Card>

        {/* NeverActivatedTable */}
        <Card className="bg-card border-white/[0.08]">
          <CardHeader>
            <CardTitle className="text-base text-foreground flex items-center gap-2">
              <UserCheck className="h-4 w-4 text-rose-300" />
              Never activated · licensed hires without a first deal
              <span className="ml-auto text-xs font-normal text-muted-foreground">
                {filteredNewHires.length} row{filteredNewHires.length === 1 ? "" : "s"}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {filteredNewHires.length === 0 ? (
              <div className="py-8 text-center text-muted-foreground">
                Every recently-licensed hire has produced a first deal. Ship it.
              </div>
            ) : (
              <NeverActivatedTable rows={filteredNewHires} />
            )}
          </CardContent>
        </Card>
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
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-white/[0.08] bg-background/95 backdrop-blur">
          <div className="container mx-auto max-w-7xl px-4 py-3 flex items-center gap-3 text-sm">
            <ClipboardCheck className="h-4 w-4 text-teal-400" />
            <span className="text-foreground font-semibold">
              Recovery Review · {reviewIdx + 1} of {reviewQueue.length}
            </span>
            <span className="text-muted-foreground truncate">
              {drawerRow?.display_name ?? "—"}
            </span>
            <div className="ml-auto flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => stepReview(-1)}
                disabled={reviewIdx === 0}
                className="border-white/[0.14] text-foreground hover:bg-white/[0.04]"
              >
                Prev
              </Button>
              <Button
                size="sm"
                onClick={() => stepReview(1)}
                className="bg-teal-500 hover:bg-teal-500/90 text-slate-950 font-semibold"
              >
                Next
                <ChevronRight className="h-3.5 w-3.5 ml-1" />
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setReviewQueue(null);
                  setDrawerOpen(false);
                }}
                className="border-white/[0.14] text-foreground hover:bg-white/[0.04]"
              >
                Exit
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// -------------------------------------------------------------------------
// KpiTile
// -------------------------------------------------------------------------
function KpiTile({
  label,
  value,
  tone,
  active,
  onClick,
}: {
  label: string;
  value: number;
  tone: "rose" | "amber" | "emerald" | "blue" | "neutral";
  active?: boolean;
  onClick?: () => void;
}) {
  const toneClass: Record<typeof tone, string> = {
    rose: "border-rose-500/30 text-rose-300",
    amber: "border-amber-500/30 text-amber-300",
    emerald: "border-emerald-500/30 text-emerald-300",
    blue: "border-blue-500/30 text-blue-300",
    neutral: "border-white/[0.08] text-foreground",
  };
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "text-left rounded-lg border bg-muted/30 p-3 transition hover:bg-muted/50",
        toneClass[tone],
        active && "ring-2 ring-teal-400/60",
      )}
    >
      <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
      <div className="text-2xl font-bold tabular-nums leading-none mt-1.5">
        {value.toLocaleString()}
      </div>
    </button>
  );
}

// -------------------------------------------------------------------------
// ProducerAlertCard — richer than KPI tiles, subtle rose border-l-4
// -------------------------------------------------------------------------
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
  icon: React.ReactNode;
  eyebrow: string;
  title: string;
  body: string;
  cta: string;
  onCta: () => void;
}) {
  const borderClass =
    tone === "rose"
      ? "border-l-rose-500/70"
      : tone === "amber"
        ? "border-l-amber-500/70"
        : "border-l-emerald-500/70";
  return (
    <div
      className={cn(
        "rounded-lg border border-white/[0.08] bg-muted/30 p-4 border-l-4",
        borderClass,
      )}
    >
      <div className="flex items-start gap-3">
        <div className="rounded-md border border-white/[0.08] bg-card p-2 shrink-0">
          {icon}
        </div>
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            {eyebrow}
          </div>
          <div className="text-base font-bold text-foreground mt-0.5">{title}</div>
          <p className="text-sm text-muted-foreground mt-1">{body}</p>
          <Button
            size="sm"
            variant="outline"
            onClick={onCta}
            className="mt-3 border-white/[0.14] text-foreground hover:bg-white/[0.04]"
          >
            {cta}
            <ArrowRight className="h-3 w-3 ml-1.5" />
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
const SCORE_HERO_TONE: Record<ScoreTone, string> = {
  rose: "border-rose-500/40 text-rose-300",
  amber: "border-amber-500/40 text-amber-300",
  emerald: "border-emerald-500/40 text-emerald-300",
  neutral: "border-white/[0.08] text-foreground",
};

const SCORE_TEXT_TONE: Record<ScoreTone, string> = {
  rose: "text-rose-300",
  amber: "text-amber-300",
  emerald: "text-emerald-300",
  neutral: "text-foreground",
};

const SCORE_EDGE_TONE: Record<ScoreTone, string> = {
  rose: "border-l-rose-500/70",
  amber: "border-l-amber-500/70",
  emerald: "border-l-emerald-500/70",
  neutral: "border-l-white/[0.14]",
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
        "rounded-lg border border-white/[0.08] bg-muted/30 p-4 border-l-4",
        SCORE_EDGE_TONE[edgeTone],
        row.manager_deactivated && "opacity-70",
      )}
    >
      {/* Header — name opens the agent drawer, roster counts sit underneath. */}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            Manager · downline health
          </div>
          <div className="text-base font-bold text-foreground mt-0.5 truncate">
            <AgentNameLink agentId={row.manager_agent_id}>
              {row.manager_name ?? "Unnamed manager"}
            </AgentNameLink>
          </div>
          <div className="text-xs text-muted-foreground mt-0.5 tabular-nums">
            {fmtInt(row.reports_activeroster)} on active roster · {fmtInt(row.reports_total)} total
            reports
          </div>
        </div>
        {row.manager_deactivated && (
          <Badge
            variant="outline"
            className="border-rose-500/40 text-rose-400 text-[10px] shrink-0"
          >
            <UserX className="h-3 w-3 mr-1" />
            deactivated
          </Badge>
        )}
      </div>

      {/* The two numbers that cost money. */}
      <div className="grid grid-cols-2 gap-2 mt-3">
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
      <div className="flex flex-wrap gap-1.5 mt-3">
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
    <div className={cn("rounded-lg border bg-card p-3 min-w-0", SCORE_HERO_TONE[tone])}>
      <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
      <div className="text-3xl font-bold tabular-nums leading-none mt-1.5">{value}</div>
      <div className="text-[11px] text-muted-foreground mt-1.5">{sub}</div>
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
      className="inline-flex items-baseline gap-1.5 rounded-md border border-white/[0.08] bg-card px-2 py-1"
    >
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className={cn("text-xs font-semibold tabular-nums", SCORE_TEXT_TONE[tone])}>
        {value}
      </span>
    </span>
  );
}

// -------------------------------------------------------------------------
// ProducerRiskTable
// -------------------------------------------------------------------------
function ProducerRiskTable({
  rows,
  onOpen,
}: {
  rows: RiskRow[];
  onOpen: (producer_id: string) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-[10px] uppercase tracking-wider text-muted-foreground border-b border-white/[0.08]">
            <th className="text-left py-2 px-2">Producer</th>
            <th className="text-left py-2 px-2">Manager</th>
            <th className="text-right py-2 px-2">This Week</th>
            <th className="text-right py-2 px-2">Prev Week</th>
            <th className="text-left py-2 px-2">3-Week Trend</th>
            <th className="text-right py-2 px-2">Policies</th>
            <th className="text-left py-2 px-2">Stage</th>
            <th className="text-left py-2 px-2">AgentLink</th>
            <th className="text-left py-2 px-2">Last Contact</th>
            <th className="text-left py-2 px-2">Risk</th>
            <th className="text-left py-2 px-2">Next Best Action</th>
            <th className="text-right py-2 px-2">Actions</th>
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
                  "border-b border-white/[0.06] hover:bg-white/[0.03] cursor-pointer",
                  r.currently_dropping && "bg-rose-500/[0.04]",
                )}
              >
                <td className="py-2 px-2 font-medium text-foreground" onClick={(e) => e.stopPropagation()}>
                  <AgentNameLink agentId={r.producer_id}>
                    {r.display_name}
                  </AgentNameLink>
                </td>
                <td className="py-2 px-2 text-muted-foreground text-xs">{r.manager_name}</td>
                <td className="py-2 px-2 text-right tabular-nums font-semibold text-foreground">
                  {fmtUSDCompact(r.current_week_alp)}
                </td>
                <td className="py-2 px-2 text-right tabular-nums text-muted-foreground">
                  {fmtUSDCompact(r.previous_week_alp)}
                </td>
                <td className="py-2 px-2">
                  <TrendCell
                    series={r.weekly_series}
                    delta_pct={r.delta_pct}
                    direction={r.direction}
                    dropping={r.currently_dropping}
                  />
                </td>
                <td className="py-2 px-2 text-right tabular-nums text-muted-foreground">
                  {r.total_policies ?? "—"}
                </td>
                <td className="py-2 px-2 text-muted-foreground text-xs">
                  {r.stage ?? "—"}
                </td>
                <td className="py-2 px-2">
                  {r.agentlink_linked ? (
                    <Badge variant="outline" className="border-emerald-500/40 text-emerald-400 text-[10px]">
                      <Link2 className="h-3 w-3 mr-1" /> linked
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="border-amber-500/40 text-amber-400 text-[10px]">
                      <Link2Off className="h-3 w-3 mr-1" /> unlinked
                    </Badge>
                  )}
                </td>
                <td className="py-2 px-2 text-muted-foreground text-xs">
                  {fmtDate(r.last_contact)}
                </td>
                <td className="py-2 px-2">
                  <div className="flex flex-col gap-1">
                    <Badge className={cn("text-[10px] font-semibold", riskBadge.className)}>
                      {riskBadge.label}
                    </Badge>
                    <Badge className={cn("text-[9px] font-semibold", priorityBadge.className)}>
                      {priorityBadge.text}
                    </Badge>
                  </div>
                </td>
                <td className="py-2 px-2 max-w-[220px]">
                  <div className="text-xs text-foreground font-medium truncate" title={nba.action}>
                    {nba.action}
                  </div>
                  <div className="text-[10px] text-muted-foreground truncate" title={nba.reason}>
                    {nba.reason}
                  </div>
                </td>
                <td className="py-2 px-2 text-right">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpen(r.producer_id);
                    }}
                    aria-label={`Open ${r.display_name}`}
                    className="border-white/[0.14] text-foreground hover:bg-white/[0.04]"
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
      ? "bg-rose-400/70"
      : highlight === "emerald"
        ? "bg-emerald-400/70"
        : "bg-muted-foreground/40";
  const max = Math.max(...(series.length ? series : [1]), 1);
  return (
    <div className="flex items-center gap-2">
      <div className="flex items-end gap-0.5 h-6 w-24">
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
          "text-xs tabular-nums font-semibold inline-flex items-center gap-0.5",
          delta_pct < -25 && "text-rose-400",
          delta_pct >= -25 && delta_pct < 0 && "text-amber-400",
          delta_pct === 0 && "text-muted-foreground",
          delta_pct > 0 && "text-emerald-400",
        )}
      >
        {direction === "down" && <ArrowDownRight className="h-3 w-3" />}
        {direction === "up" && <ArrowUpRight className="h-3 w-3" />}
        {direction === "flat" && <Minus className="h-3 w-3" />}
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
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-[10px] uppercase tracking-wider text-muted-foreground border-b border-white/[0.08]">
            <th className="text-left py-2 px-2">Producer</th>
            <th className="text-right py-2 px-2">Days Since Hire</th>
            <th className="text-left py-2 px-2">Stage</th>
            <th className="text-left py-2 px-2">Manager</th>
            <th className="text-left py-2 px-2">AgentLink</th>
            <th className="text-left py-2 px-2">Last Activity</th>
            <th className="text-left py-2 px-2">Next Action</th>
            <th className="text-right py-2 px-2">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.agent_id} className="border-b border-white/[0.06] hover:bg-white/[0.03]">
              <td className="py-2 px-2 font-medium text-foreground">
                <AgentNameLink agentId={r.agent_id}>{r.display_name}</AgentNameLink>
              </td>
              <td
                className={cn(
                  "py-2 px-2 text-right tabular-nums font-semibold",
                  r.days_since_hire >= 30 && "text-rose-400",
                  r.days_since_hire >= 14 && r.days_since_hire < 30 && "text-amber-400",
                  r.days_since_hire < 14 && "text-muted-foreground",
                )}
              >
                {r.days_since_hire}d
              </td>
              <td className="py-2 px-2 text-muted-foreground text-xs">{r.onboarding_stage ?? "—"}</td>
              <td className="py-2 px-2 text-muted-foreground text-xs">{r.manager_name ?? "—"}</td>
              <td className="py-2 px-2">
                {r.agentlink_linked ? (
                  <Badge variant="outline" className="border-emerald-500/40 text-emerald-400 text-[10px]">
                    <Link2 className="h-3 w-3 mr-1" />
                    linked
                  </Badge>
                ) : (
                  <Badge variant="outline" className="border-amber-500/40 text-amber-400 text-[10px]">
                    <Link2Off className="h-3 w-3 mr-1" />
                    unlinked
                  </Badge>
                )}
              </td>
              <td className="py-2 px-2 text-muted-foreground text-xs">
                {fmtDate(r.hire_date)}
              </td>
              <td className="py-2 px-2 max-w-[220px]">
                <div className="text-xs text-foreground truncate" title={r.next_action_text ?? undefined}>
                  {r.next_action_text ?? "AgentLink check + first-deal push"}
                </div>
                {r.next_action_due_at && (
                  <div className="text-[10px] text-muted-foreground">
                    Due {fmtDate(r.next_action_due_at)}
                  </div>
                )}
              </td>
              <td className="py-2 px-2 text-right">
                <Button
                  size="sm"
                  variant="outline"
                  asChild
                  className="border-white/[0.14] text-foreground hover:bg-white/[0.04]"
                >
                  <a href={`/dashboard/agents/${r.agent_id}`} aria-label={`Open ${r.display_name}`}>
                    <UserX className="h-3.5 w-3.5 mr-1" />
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
