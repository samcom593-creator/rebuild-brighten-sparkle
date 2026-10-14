import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ClipboardCheck, Download, EyeOff, GraduationCap, Link2, Mail, MoreHorizontal, Phone, RefreshCw, ShieldCheck, Sparkles, TrendingUp, UserCheck, UserX, Users, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useTeamWorkspace } from "@/hooks/useTeamWorkspace";
import { useTeamFacts } from "@/hooks/useTeamFacts";
import { usePortalLoginSender } from "@/hooks/usePortalLoginSender";
import { useProductionRealtime } from "@/hooks/useProductionRealtime";
import { useRealtimeTable } from "@/shared/realtime/useRealtimeTable";
import { daysSince, ensureCompleteRead, isSyncOnly, num, plural, type RosterRow } from "@/lib/teamRoster";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { GlassCard } from "@/components/ui/glass-card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageLoadingSkeleton } from "@/components/ui/page-loading-skeleton";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AddAgentModal } from "@/components/dashboard/AddAgentModal";
import { ApplicationDetailSheet } from "@/components/dashboard/ApplicationDetailSheet";
import { DeactivateAgentDialog } from "@/components/dashboard/DeactivateAgentDialog";
import { AgentQuickEditDialog } from "@/components/dashboard/AgentQuickEditDialog";
import { JustHiredPanel } from "@/components/dashboard/JustHiredPanel";
import { TeamEngagementPanel } from "@/components/dashboard/TeamEngagementPanel";
import { ProductionMetricsCard } from "@/components/dashboard/ProductionMetricsCard";
import { ContractingReviewWorkspace } from "@/components/contracting-review/ContractingReviewWorkspace";
import { TeamOverview } from "@/components/team/TeamOverview";
import { TeamAttendance } from "@/components/team/TeamAttendance";
import { ContractingCallList } from "@/components/team/ContractingCallList";
import { RosterToolbar, type ActiveFilter } from "@/components/team/RosterToolbar";
import { RosterProductionList } from "@/components/team/RosterRows";
import { TeamPersonDrawer, type TeamPersonManage } from "@/components/team/TeamPersonDrawer";

/**
 * My Team (rebuilt 2026-10-14, Sam: "far too much clutter, more functions, easier to use and manage").
 *
 * One page, four working views, one card per person:
 *   Overview           who is on the team, grouped by stage, with the gaps (no stage, no schedule, no login) one tap away
 *   Attendance         today in Phoenix
 *   Contracting        the carrier review
 *   Contracting calls  licensed agents who fell off, with one-tap call and log
 * Tapping a name anywhere opens the person's card (?person=), which now also manages their stage, work days, login and
 * roster status. The old second roster (the recruiting pipeline with its twelve buckets, bulk mode and compose drawer)
 * is gone from this page: Recruit Pipeline owns applicants, and every per-agent action it carried lives on the card.
 */
interface RosterContact {
  agent_id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
}

interface RosterSegments {
  total: number; active: number; inactive: number; terminated: number;
  licensed: number; unlicensed: number; sync_only: number;
  producing_mtd: number; mtd_alp: number | string; active_mtd_alp: number | string;
  offroster_mtd_alp: number | string; never_produced: number; dormant_60d: number;
  no_contact_14d: number; book_last_posted: string | null;
}

interface TodayProduction {
  today_alp: number | string;
  today_policies: number;
  selling_streak_days: number;
  business_date: string;
}

type RosterSegmentKey =
  | "all" | "new_hires" | "producing" | "never_produced"
  | "no_longer_here" | "unlicensed" | "inactive" | "terminated" | "free_leads" | "free_leads_close"
  | "sync_only";

/**
 * A sync-only row is NOT a person on this team. crm_agent_roster() projects
 * `is_sync_only` = (agent_code like 'GHOST\_%' and user_id is null) for the
 * placeholder seats ingest_ayro_sales_deal() / ingest_discord_production_deal()
 * mint to hold the attribution of a Discord post whose author matched no agent.
 * They have no auth user, no email, no phone and no onboarding path.
 *
 * The flag was projected, typed at RosterRow.is_sync_only, counted by
 * crm_roster_segments() as `sync_only` — and read by nothing on this page, so
 * 6 of them sat inside the worklists below wearing every marker a real hire
 * wears. ProducerProfile.tsx:277 badged them; the LIST where the work actually
 * happens did not.
 */
/**
 * Honest segmentation — every predicate reads a column the row actually carries,
 * and the chip count is the length of the very list the chip renders, so a chip
 * can never advertise a number the table below disagrees with.
 *
 * `admitsSyncOnly` is declared, never inferred. A worklist chip that implies a
 * human action (open their profile, chase their license, coach them) must set
 * it false, because none of those actions exist for a placeholder. A chip that
 * mirrors a server-side tile in ProductionMetricsCard must set it TRUE and say
 * which tile: the roster totals come from crm_roster_segments() and are not
 * touched here, so narrowing only the client side would put two different
 * answers to one question on the same screen. Whether that $16,600 of
 * discord_external production belongs in Apex's month at all is a book
 * question, deliberately not decided by a UI filter.
 */
const ROSTER_SEGMENTS: Array<{
  key: RosterSegmentKey; label: string; icon: typeof Users; desc: string;
  admitsSyncOnly: boolean; match: (r: RosterRow) => boolean;
}> = [
  { key: "new_hires", label: "New hires", icon: UserCheck,
    desc: "Joined in the last 30 days. Open a profile to control login, licensing, onboarding, contracting, and assigned work. Sync-only placeholder seats are not hires and sit in their own chip.",
    admitsSyncOnly: false,
    match: (r) => r.status === "active" && !isSyncOnly(r) && r.tenure_days !== null && r.tenure_days <= 30 },
  { key: "free_leads", label: "Free leads ✓", icon: Sparkles,
    desc: "Qualify for free leads right now. Route leads to these agents first.",
    admitsSyncOnly: false,
    match: (r) => r.status === "active" && !isSyncOnly(r) && !!r.free_leads_qualified },
  { key: "free_leads_close", label: "Close to free leads", icon: TrendingUp,
    desc: "Within $5K of the free-leads bar. One push this week gets them there.",
    admitsSyncOnly: false,
    match: (r) => r.status === "active" && !isSyncOnly(r) && !r.free_leads_qualified && num(r.free_leads_needed_for_qual) > 0 && num(r.free_leads_needed_for_qual) <= 5000 },
  { key: "all", label: "All agents", icon: Users,
    desc: "Active agents who have produced. Never-produced and departed seats stay in their own review queues. Sync-only placeholder seats are included and badged, so this count still reconciles with Team size.",
    admitsSyncOnly: true, // mirrors ProductionMetricsCard "Team size" / "Active" (crm_roster_segments.total/active)
    match: (r) => r.status === "active" && (r.lifetime_deals ?? 0) > 0 },
  { key: "producing", label: "Producing", icon: TrendingUp,
    desc: "Wrote business this month. Sync-only placeholder seats are badged here rather than dropped — the headline tile counts them too, and hiding them from one of the two would make the screen disagree with itself.",
    admitsSyncOnly: true, // mirrors ProductionMetricsCard "Producing this month" (crm_roster_segments.producing_mtd)
    match: (r) => r.status === "active" && num(r.mtd_alp) > 0 },
  { key: "never_produced", label: "Never produced", icon: UserX,
    desc: "Active roster seats with zero lifetime deals — the activation and coaching queue. A placeholder cannot be coached, so sync-only seats are excluded.",
    admitsSyncOnly: false,
    match: (r) => r.status === "active" && !isSyncOnly(r) && (r.lifetime_deals ?? 0) === 0 },
  { key: "no_longer_here", label: "No longer here", icon: EyeOff,
    desc: "Previously produced but no business in 60+ days. Review these seats before formally marking them inactive or terminated. Sync-only seats are excluded — there is no seat to retire.",
    admitsSyncOnly: false,
    match: (r) => {
      const d = daysSince(r.last_posted_date);
      return r.status === "active" && !isSyncOnly(r) && (r.lifetime_deals ?? 0) > 0 && d !== null && d >= 60;
    } },
  { key: "unlicensed", label: "Unlicensed", icon: GraduationCap,
    desc: "Still working through licensing — these seats cannot legally earn yet. Sync-only placeholder seats carry license_status 'unlicensed' by default and have nobody to license, so they are excluded.",
    admitsSyncOnly: false,
    match: (r) => r.license_status !== "licensed" && !isSyncOnly(r) },
  { key: "inactive", label: "Inactive", icon: EyeOff,
    desc: "Dormant or hidden by hand. Confirm they are gone before the seat stops counting.",
    admitsSyncOnly: true, // a status bucket, not a worklist: it must partition the roster by status alone
    match: (r) => r.status === "inactive" },
  { key: "terminated", label: "Terminated", icon: X,
    desc: "Off the roster. Kept visible so a wrong removal can be caught and reversed.",
    admitsSyncOnly: true, // a status bucket, not a worklist: it must partition the roster by status alone
    match: (r) => r.status === "terminated" },
  { key: "sync_only", label: "Sync only", icon: Link2,
    desc: "Placeholder seats, not people. The Discord deal ingest mints one of these when a posted sale names an author it cannot match to an agent, so the production has somewhere to land. They have no login, no email and no onboarding path — do not chase them. Match a real agent to the posts and the seat stops being needed.",
    admitsSyncOnly: true,
    match: (r) => isSyncOnly(r) },
];

type RosterSortKey = "mtd_desc" | "l30_desc" | "lifetime_desc" | "streak_desc" | "name" | "stalest" | "newest";

const PRODUCTION_SORTS = [
  { value: "mtd_desc", label: "Month ALP (high to low)" },
  { value: "l30_desc", label: "Last 30 days ALP" },
  { value: "lifetime_desc", label: "Lifetime ALP" },
  { value: "streak_desc", label: "Current sales streak" },
  { value: "stalest", label: "Longest since a sale" },
  { value: "newest", label: "Newest on the roster" },
  { value: "name", label: "Name (A to Z)" },
];

/** The first sentence of a group's description. The rest is definition detail that does not help anyone decide. */
const leadSentence = (desc: string): string => {
  const i = desc.indexOf(". ");
  return i === -1 ? desc : desc.slice(0, i + 1);
};

function RosterPanel({ rows, isLoading, isError, onRetry, team }: {
  rows: RosterRow[];
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  team: ReturnType<typeof useTeamWorkspace>;
}) {
  const [segment, setSegment] = useState<RosterSegmentKey>("new_hires");
  const [q, setQ] = useState("");
  const [managerFilter, setManagerFilter] = useState("all");
  const [sortChoice, setSortChoice] = useState<string>(PRODUCTION_SORTS[0].value);
  const sortOptions = PRODUCTION_SORTS;
  const sort = sortOptions.some((o) => o.value === sortChoice) ? sortChoice : sortOptions[0].value;

  const managers = useMemo(() => {
    const m = new Map<string, string>();
    rows.forEach((r) => { if (r.manager_id && r.manager_name) m.set(r.manager_id, r.manager_name); });
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [rows]);

  const searched = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (managerFilter !== "all" && r.manager_id !== managerFilter) return false;
      if (!needle) return true;
      return (
        (r.full_name ?? "").toLowerCase().includes(needle) ||
        (r.email ?? "").toLowerCase().includes(needle) ||
        (r.phone ?? "").toLowerCase().includes(needle) ||
        (r.agent_code ?? "").toLowerCase().includes(needle) ||
        (r.manager_name ?? "").toLowerCase().includes(needle) ||
        (r.license_status ?? "").toLowerCase().includes(needle) ||
        (r.onboarding_stage ?? "").toLowerCase().includes(needle) ||
        (r.status ?? "").toLowerCase().includes(needle)
      );
    });
  }, [rows, q, managerFilter]);

  // Group counts come from the SAME searched list the rows are drawn from, so a count can never contradict the list.
  const bySegment = useMemo(() => {
    const m = new Map<RosterSegmentKey, RosterRow[]>();
    for (const seg of ROSTER_SEGMENTS) m.set(seg.key, searched.filter(seg.match));
    return m;
  }, [searched]);

  const visible = useMemo(() => {
    const base = bySegment.get(segment) ?? [];
    const list = [...base];
    const name = (r: RosterRow) => r.full_name ?? "";
    switch (sort) {
      case "mtd_desc": list.sort((a, b) => num(b.mtd_alp) - num(a.mtd_alp)); break;
      case "l30_desc": list.sort((a, b) => num(b.l30_alp) - num(a.l30_alp)); break;
      case "lifetime_desc": list.sort((a, b) => num(b.lifetime_alp) - num(a.lifetime_alp)); break;
      case "streak_desc": list.sort((a, b) => num(b.selling_streak_days) - num(a.selling_streak_days) || num(b.today_alp) - num(a.today_alp)); break;
      case "name": list.sort((a, b) => name(a).localeCompare(name(b))); break;
      case "newest": list.sort((a, b) => (b.tenure_days ?? -1) === (a.tenure_days ?? -1) ? 0 : (a.tenure_days ?? 1e9) - (b.tenure_days ?? 1e9)); break;
      case "stalest": list.sort((a, b) => {
        const at = a.last_posted_date ? new Date(a.last_posted_date).getTime() : 0;
        const bt = b.last_posted_date ? new Date(b.last_posted_date).getTime() : 0;
        return at - bt;
      }); break;
    }
    return list;
  }, [bySegment, segment, sort]);

  const activeSeg = ROSTER_SEGMENTS.find((s) => s.key === segment)!;
  const groupRows = bySegment.get(segment) ?? [];
  const placeholders = visible.filter(isSyncOnly).length;

  const activeFilters: ActiveFilter[] = [
    ...(q.trim() !== "" ? [{ key: "q", label: `Search: ${q.trim()}`, onRemove: () => setQ("") }] : []),
    ...(managerFilter !== "all" ? [{ key: "mgr", label: `Upline: ${managers.find(([id]) => id === managerFilter)?.[1] ?? "selected"}`, onRemove: () => setManagerFilter("all") }] : []),
  ];
  const clearAll = () => { setQ(""); setManagerFilter("all"); };

  if (isError) {
    return (
      <GlassCard className="p-4">
        <EmptyState
          icon={<Users className="h-7 w-7" />}
          variant="warning"
          title="The roster could not be read"
          description="crm_agent_roster() did not answer, or its answer may have been cut short. Nothing is being guessed at in its place. Retry, and if it keeps failing the roster functions need looking at."
          actions={<Button variant="outline" size="sm" onClick={onRetry}>Retry</Button>}
        />
      </GlassCard>
    );
  }

  return (
    <div className="space-y-3" id="team-roster">
      <RosterToolbar
        q={q} onQ={setQ}
        managers={managers} manager={managerFilter} onManager={setManagerFilter}
        groups={ROSTER_SEGMENTS.map((s) => ({ key: s.key, label: s.label, count: (bySegment.get(s.key) ?? []).length }))}
        group={segment} onGroup={(v) => setSegment(v as RosterSegmentKey)}
        sort={sort} onSort={setSortChoice} sortOptions={sortOptions}
        shown={visible.length} groupTotal={groupRows.length} groupLabel={activeSeg.label}
        activeFilters={activeFilters} onClearAll={clearAll}
      />

      <GlassCard className="p-3 sm:p-4">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="flex min-w-0 items-center gap-2 text-base font-semibold text-foreground">
            <activeSeg.icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="truncate">{activeSeg.label}</span>
          </h3>
          <span className="shrink-0 text-sm font-semibold tabular-nums text-muted-foreground" aria-label={`${visible.length} people shown`}>{visible.length}</span>
        </div>
        <p className="mb-2 text-xs text-muted-foreground">
          {leadSentence(activeSeg.desc)}
          {placeholders > 0 ? ` Includes ${plural(placeholders, "placeholder seat")} that ${placeholders === 1 ? "is" : "are"} not a person.` : ""}
        </p>

        {isLoading ? (
          <div className="space-y-2" role="status" aria-label="Loading the roster">
            {[...Array(6)].map((_, i) => (
              // stable-key-allow:skeleton — static Array(N) decorative loader, no reorder
              <div key={i} className="h-[76px] animate-pulse rounded-md bg-muted/30" />
            ))}
          </div>
        ) : visible.length === 0 ? (
          <EmptyState
            icon={<Users className="h-7 w-7" />}
            title="Nobody matches"
            description={activeFilters.length > 0
              ? "A filter may be too tight. Clear them to see the whole group."
              : "Nothing on the roster fits this group right now. That is the honest answer, not a loading state."}
            actions={activeFilters.length > 0 ? <Button variant="outline" size="sm" onClick={clearAll}>Clear filters</Button> : undefined}
          />
        ) : (
          <RosterProductionList rows={visible} selectedId={team.selectedId} onOpen={team.openPerson} />
        )}
      </GlassCard>
    </div>
  );
}

/**
 * One action cluster for the page header. PageHeader folds every action after the first into a "More (n)" step on
 * phones; with Add Agent plus a menu that produced a "More" that only revealed another "More". A single component child
 * (not a bare div, which PageHeader unwraps) keeps both controls on one row at every width.
 */
function HeaderActionRow({ children }: { children: React.ReactNode }) {
  return <div className="flex w-full items-center gap-2 sm:w-auto [&>*:first-child]:flex-1 sm:[&>*:first-child]:flex-none">{children}</div>;
}

type Mode = "overview" | "attendance" | "work" | "link";
const MODE_KEY = "crm.mode.v3";
const VIEWS: Array<{ key: Mode; label: string; param: string; icon: typeof Users }> = [
  { key: "overview", label: "Overview", param: "overview", icon: Users },
  { key: "attendance", label: "Attendance", param: "attendance", icon: ClipboardCheck },
  { key: "work", label: "Contracting", param: "contracting", icon: ShieldCheck },
  { key: "link", label: "Contracting calls", param: "link", icon: Phone },
];
const modeFromParam = (v: string | null): Mode | null => VIEWS.find((m) => m.param === v)?.key ?? null;

export default function DashboardCRM() {
  const { user, isAdmin, isManager, isLoading: authLoading } = useAuth();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const portalLogins = usePortalLoginSender();
  const [viewAppTarget, setViewAppTarget] = useState<{ agentId: string } | null>(null);
  const [deactivateAgent, setDeactivateAgent] = useState<{ id: string; name: string; managerId?: string } | null>(null);
  const [editLoginAgent, setEditLoginAgent] = useState<{ id: string; name: string } | null>(null);

  // Canonical roster — the functions that own "who is on this team". They are authorised server-side (admin, manager,
  // VA manager and VA), so a VA with no agent record of their own still reads the agency roster.
  const rosterSegmentsQuery = useQuery({
    queryKey: ["crm-roster-segments"],
    enabled: !authLoading && !!user,
    staleTime: 60_000,
    queryFn: async (): Promise<RosterSegments | null> => {
      const { data, error } = await supabase.rpc("crm_roster_segments" as never);
      if (error) throw error;
      const value = data as unknown;
      const row = Array.isArray(value) ? value[0] : value;
      return (row as RosterSegments) ?? null;
    },
  });
  const todayProductionQuery = useQuery({
    queryKey: ["crm-today-production"],
    enabled: !authLoading && !!user,
    staleTime: 15_000,
    // No poll: crm_today_production is one of the platform's most expensive reads. Realtime below covers its tables.
    refetchOnWindowFocus: false,
    queryFn: async (): Promise<TodayProduction | null> => {
      const { data, error } = await supabase.rpc("crm_today_production" as never);
      if (error) throw error;
      const value = data as unknown;
      const row = Array.isArray(value) ? value[0] : value;
      return (row as TodayProduction) ?? null;
    },
  });
  useProductionRealtime(() => { void todayProductionQuery.refetch(); }, 800);
  const rosterQuery = useQuery({
    queryKey: ["crm-agent-roster"],
    enabled: !authLoading && !!user,
    staleTime: 60_000,
    queryFn: async (): Promise<RosterRow[]> => {
      const [rosterResult, pulseResult, contactResult, freeLeadsResult] = await Promise.all([
        supabase.rpc("crm_agent_roster" as never),
        supabase.rpc("crm_agent_sales_pulse" as never),
        supabase.rpc("crm_agent_contacts" as never),
        supabase.rpc("crm_agent_free_leads_status" as never),
      ]);
      if (rosterResult.error) throw rosterResult.error;
      if (pulseResult.error) throw pulseResult.error;
      if (contactResult.error) throw contactResult.error;
      if (freeLeadsResult.error) throw freeLeadsResult.error;
      // A read that stops exactly at the platform page limit may be cut short: fail it rather than show a roster that quietly ends.
      ensureCompleteRead("crm_agent_roster", rosterResult.data as unknown as unknown[]);
      ensureCompleteRead("crm_agent_sales_pulse", pulseResult.data as unknown as unknown[]);
      ensureCompleteRead("crm_agent_contacts", contactResult.data as unknown as unknown[]);
      ensureCompleteRead("crm_agent_free_leads_status", freeLeadsResult.data as unknown as unknown[]);
      const pulseByAgent = new Map(
        ((pulseResult.data as unknown as Array<Pick<RosterRow, "agent_id" | "today_alp" | "today_deals" | "selling_streak_days">>) ?? [])
          .map((row) => [row.agent_id, row] as const),
      );
      const contactByAgent = new Map(((contactResult.data as unknown as RosterContact[]) ?? []).map((row) => [row.agent_id, row] as const));
      const freeLeadsByAgent = new Map(
        ((freeLeadsResult.data as unknown as Array<{ agent_id: string; qualifies: boolean; reason: string; needed_for_qual: number | string }>) ?? [])
          .map((row) => [row.agent_id, row] as const),
      );
      return ((rosterResult.data as unknown as RosterRow[]) ?? []).map((row) => ({
        ...row,
        full_name: contactByAgent.get(row.agent_id)?.full_name ?? row.full_name,
        email: contactByAgent.get(row.agent_id)?.email ?? row.email,
        phone: contactByAgent.get(row.agent_id)?.phone ?? row.phone,
        today_alp: pulseByAgent.get(row.agent_id)?.today_alp ?? 0,
        today_deals: pulseByAgent.get(row.agent_id)?.today_deals ?? 0,
        selling_streak_days: pulseByAgent.get(row.agent_id)?.selling_streak_days ?? 0,
        free_leads_qualified: freeLeadsByAgent.get(row.agent_id)?.qualifies ?? false,
        free_leads_reason: freeLeadsByAgent.get(row.agent_id)?.reason ?? null,
        free_leads_needed_for_qual: freeLeadsByAgent.get(row.agent_id)?.needed_for_qual ?? null,
      }));
    },
  });

  const refreshAll = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["crm-agent-roster"] });
    queryClient.invalidateQueries({ queryKey: ["crm-roster-segments"] });
    queryClient.invalidateQueries({ queryKey: ["crm-today-production"] });
    queryClient.invalidateQueries({ queryKey: ["team-facts"] });
  }, [queryClient]);

  // MP-361: every handler below invalidates and ignores the payload, so a burst of row events needs ONE refetch.
  const CRM_COALESCE_MS = 750;
  useRealtimeTable({ table: "agents", channelSuffix: "crm", coalesceMs: CRM_COALESCE_MS }, () => {
    queryClient.invalidateQueries({ queryKey: ["crm-agent-roster"] });
    queryClient.invalidateQueries({ queryKey: ["crm-roster-segments"] });
  });
  useRealtimeTable({ table: "deals", channelSuffix: "crm-production", coalesceMs: CRM_COALESCE_MS }, () => {
    queryClient.invalidateQueries({ queryKey: ["crm-today-production"] });
    queryClient.invalidateQueries({ queryKey: ["crm-agent-roster"] });
    queryClient.invalidateQueries({ queryKey: ["crm-roster-segments"] });
  });
  useRealtimeTable({ table: "agentlink_book", channelSuffix: "crm-production", coalesceMs: CRM_COALESCE_MS }, () => {
    queryClient.invalidateQueries({ queryKey: ["crm-today-production"] });
    queryClient.invalidateQueries({ queryKey: ["crm-agent-roster"] });
    queryClient.invalidateQueries({ queryKey: ["crm-roster-segments"] });
  });
  useRealtimeTable(
    { table: "production_external_daily_snapshots", channelSuffix: "crm-production", coalesceMs: CRM_COALESCE_MS },
    () => { queryClient.invalidateQueries({ queryKey: ["crm-today-production"] }); },
  );
  useRealtimeTable(
    { table: "production_external_deals", channelSuffix: "crm-production", coalesceMs: CRM_COALESCE_MS },
    () => {
      queryClient.invalidateQueries({ queryKey: ["crm-today-production"] });
      queryClient.invalidateQueries({ queryKey: ["crm-agent-roster"] });
      queryClient.invalidateQueries({ queryKey: ["crm-roster-segments"] });
    },
  );

  // The view lives in the URL (?view=overview|attendance|contracting|link) so a link lands on the right one; the last
  // choice is remembered for a plain visit.
  const [mode, setMode] = useState<Mode>(() => {
    try { const v = localStorage.getItem(MODE_KEY); return VIEWS.some((m) => m.key === v) ? (v as Mode) : "overview"; }
    catch { return "overview"; } // empty-catch-allow:localstorage-incognito
  });
  useEffect(() => {
    try { localStorage.setItem(MODE_KEY, mode); }
    catch { /* ignore quota / disabled storage */ } // empty-catch-allow:localstorage-incognito
  }, [mode]);
  useEffect(() => { const m = modeFromParam(searchParams.get("view")); if (m) setMode(m); }, [searchParams]);
  const team = useTeamWorkspace(rosterQuery.data ?? [], !rosterQuery.isLoading);
  const facts = useTeamFacts(team.contractingEnabled);
  // Roles with no contracting access only ever see the production roster.
  const effectiveMode: Mode | "production" = team.contractingEnabled ? mode : "production";
  const showView = (m: Mode) => {
    setMode(m);
    const next = new URLSearchParams(searchParams);
    next.set("view", VIEWS.find((v) => v.key === m)!.param);
    setSearchParams(next, { replace: true });
  };

  const rows = (rosterQuery.data ?? []) as RosterRow[];
  const working = rows.filter((r) => r.status === "active" && r.is_sync_only !== true);

  // 2026-09-30 (Sam): "a button to download all agents: first name, last name, email, NPN."
  const downloadAgentsCsv = async () => {
    const { data, error } = await supabase.rpc("crm_agents_export" as never);
    if (error) { toast.error(`Export failed: ${error.message}`); return; }
    const exported = (data ?? []) as Array<Record<string, string | null>>;
    if (exported.length === 0) { toast.error("No agents to export."); return; }
    const cols = ["first_name", "last_name", "email", "npn", "phone", "status", "license_status", "manager_name", "agent_code", "start_date"];
    const cell = (v: string | null | undefined) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const csv = [cols.join(","), ...exported.map((r) => cols.map((c) => cell(r[c])).join(","))].join("\r\n");
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `apex-agents-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    toast.success(`Downloaded ${exported.length} agents.`);
  };

  // The person card's management actions. Each one is a receipt: it says what landed, never assumes.
  const selected = team.row;
  const selectedName = selected?.full_name ?? "This agent";
  const personFacts = team.selectedId ? facts.facts?.people.find((p) => p.agent_id === team.selectedId) ?? null : null;
  const canManage = isAdmin || isManager;
  const checkIn = async (row: RosterRow) => {
    // The check-in stamp lives on the person's application (what last_contacted_at reads from), never invented on agents.
    const { data: agent, error: readError } = await supabase.from("agents").select("source_application_id").eq("id", row.agent_id).maybeSingle();
    if (readError) { toast.error(`Check-in did not save: ${readError.message}`); return; }
    if (!agent?.source_application_id) { toast.error(`${row.full_name ?? "This agent"} has no application on file to check in against.`); return; }
    const checkedInAt = new Date().toISOString();
    const { error } = await supabase.from("applications").update({ last_contacted_at: checkedInAt }).eq("id", agent.source_application_id);
    if (error) { toast.error(`Check-in did not save: ${error.message}`); return; }
    toast.success(`${row.full_name ?? "Agent"} marked checked in`);
    refreshAll();
  };
  const sendPortalLogin = async (row: RosterRow) => {
    try {
      const { data, error } = await supabase.functions.invoke("send-agent-portal-login", { body: { agentId: row.agent_id } });
      if (error) throw error;
      if ((data as { success?: boolean; error?: string } | null)?.success === false) throw new Error((data as { error?: string }).error || "Failed");
      toast.success(`Portal login sent to ${row.email ?? row.full_name ?? "the agent"}`);
    } catch (err) { toast.error(err instanceof Error ? err.message : "Failed to send"); }
  };
  const hideFromRoster = async (row: RosterRow) => {
    const { error } = await supabase.from("agents").update({ is_inactive: true }).eq("id", row.agent_id);
    if (error) { toast.error(`Could not hide: ${error.message}`); return; }
    toast.success(`${row.full_name ?? "Agent"} hidden from the roster`);
    team.closePerson();
    refreshAll();
  };
  const manage: TeamPersonManage | undefined = selected && team.contractingEnabled ? {
    facts: personFacts,
    factsLoading: facts.query.isLoading,
    canEdit: facts.canEdit,
    saving: (what) => facts.isPending(selected.agent_id, what),
    setStage: (s) => { void facts.setStage(selected.agent_id, selectedName, s); },
    setWorkdays: (days, from) => facts.setWorkdays(selected.agent_id, selectedName, days, from),
    ...(canManage ? {
      onCheckIn: () => { void checkIn(selected); },
      ...(isAdmin ? { onSendPortalLogin: () => { void sendPortalLogin(selected); } } : {}),
      onEditLogin: () => setEditLoginAgent({ id: selected.agent_id, name: selectedName }),
      onViewApplication: () => setViewAppTarget({ agentId: selected.agent_id }),
      onHide: () => { void hideFromRoster(selected); },
      onDeactivate: () => setDeactivateAgent({ id: selected.agent_id, name: selectedName, managerId: selected.manager_id ?? undefined }),
    } : {}),
  } : undefined;

  if (authLoading) return <PageLoadingSkeleton variant="table" />;

  const fold = (title: string, body: React.ReactNode) => (
    <details className="group rounded-lg border border-border bg-card [&[open]_.chev]:rotate-180">
      <summary className="flex min-h-[44px] cursor-pointer list-none items-center gap-2 px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground">
        {title}
        <ChevronDown className="chev ml-auto h-4 w-4 transition-transform" aria-hidden />
      </summary>
      <div className="border-t border-border p-4">{body}</div>
    </details>
  );

  return (
    <>
      {/* max-w-[1400px] (not max-w-6xl): the production view is an 8-column grid at xl. px-4 sm:px-6 is required so
          PageHeader's -mx-4 sm:-mx-6 cancels exactly. */}
      <div className="page-enter mx-auto w-full max-w-[1400px] space-y-4 px-4 pb-24 sm:px-6">
        <PageHeader
          accent="cyan"
          eyebrow="Team"
          eyebrowIcon={<Users className="h-3.5 w-3.5" />}
          title="My Team"
          actions={
            <HeaderActionRow>
              <AddAgentModal onAgentAdded={refreshAll} />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="h-10 gap-1.5 sm:h-9" aria-label="More team actions">
                    <MoreHorizontal className="h-4 w-4 shrink-0" aria-hidden /> More
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {isAdmin ? (
                    <DropdownMenuItem disabled={portalLogins.sending} onClick={() => portalLogins.send()}>
                      <Mail className="mr-2 h-4 w-4" aria-hidden /> {portalLogins.sending ? "Sending..." : "Send portal logins (all)"}
                    </DropdownMenuItem>
                  ) : null}
                  <DropdownMenuItem onClick={() => { navigator.clipboard.writeText("https://apex-financial.org/agent-login"); toast.success("Check-in link copied. Paste it into a text or DM."); }}>
                    <Link2 className="mr-2 h-4 w-4" aria-hidden /> Copy check-in link
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={downloadAgentsCsv}>
                    <Download className="mr-2 h-4 w-4" aria-hidden /> Download agents CSV
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={refreshAll}>
                    <RefreshCw className="mr-2 h-4 w-4" aria-hidden /> Refresh
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </HeaderActionRow>
          }
        />

        <ProductionMetricsCard
          snapshot={rosterSegmentsQuery.data ?? null}
          isLoading={rosterSegmentsQuery.isLoading}
          todayProduction={todayProductionQuery.data ?? null}
          isTodayLoading={todayProductionQuery.isLoading}
          // Team size = active agents actually working the business (no terminated / inactive / sync-only placeholder
          // seats). New hires, no sale = those who joined ≤30d ago with zero lifetime deals — the activation queue.
          teamSize={working.length}
          newHires30dNoSale={working.filter((r) => (r.tenure_days ?? 9999) <= 30 && (r.lifetime_deals ?? 0) === 0).length}
        />

        {team.contractingEnabled ? (
          <div className="inline-flex flex-wrap rounded-lg border border-border bg-card p-1" role="group" aria-label="Team view">
            {VIEWS.map((m) => {
              const Icon = m.icon;
              const isActive = effectiveMode === m.key;
              return (
                <button key={m.key} type="button" onClick={() => showView(m.key)} aria-pressed={isActive}
                  className={cn("inline-flex min-h-[40px] items-center gap-1.5 rounded-md px-3 text-sm font-medium transition-colors",
                    "focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)]",
                    isActive ? "bg-primary/10 text-foreground ring-1 ring-primary/60" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground")}>
                  <Icon className="h-4 w-4 shrink-0" aria-hidden />
                  {m.label}
                </button>
              );
            })}
          </div>
        ) : null}

        {effectiveMode === "overview" ? (
          <>
            <GlassCard className="p-3 sm:p-4"><TeamOverview rows={rows} onOpenPerson={team.openPerson} /></GlassCard>
            {isAdmin || isManager ? fold("Just hired · last 30 days", <JustHiredPanel />) : null}
            {isAdmin ? fold("Engagement: who logged in, emails sent, course progress", <TeamEngagementPanel />) : null}
          </>
        ) : effectiveMode === "attendance" ? (
          <GlassCard className="p-3 sm:p-4"><TeamAttendance /></GlassCard>
        ) : effectiveMode === "work" ? (
          <GlassCard className="p-3 sm:p-4"><ContractingReviewWorkspace /></GlassCard>
        ) : effectiveMode === "link" ? (
          <GlassCard className="p-3 sm:p-4"><ContractingCallList /></GlassCard>
        ) : (
          <RosterPanel
            rows={rows}
            isLoading={rosterQuery.isLoading}
            isError={rosterQuery.isError}
            onRetry={() => { rosterQuery.refetch(); rosterSegmentsQuery.refetch(); }}
            team={team}
          />
        )}
      </div>

      <TeamPersonDrawer
        open={Boolean(team.selectedId) && Boolean(team.row)}
        onOpenChange={(o) => { if (!o) team.closePerson(); }}
        row={team.row}
        manage={manage}
        onOpenContracting={(id) => {
          // Drive the URL: ?view=contracting is what this page reads, ?review= is what the review follows (and what a
          // shared link carries); dropping ?person= closes the drawer.
          const next = new URLSearchParams(searchParams);
          next.set("view", "contracting"); next.set("review", id); next.delete("person");
          setSearchParams(next, { replace: true });
        }}
      />

      <ApplicationDetailSheet open={!!viewAppTarget} onOpenChange={(o) => !o && setViewAppTarget(null)} agentId={viewAppTarget?.agentId} onRefresh={refreshAll} />
      <DeactivateAgentDialog open={!!deactivateAgent} onOpenChange={(o) => !o && setDeactivateAgent(null)} agentId={deactivateAgent?.id || ""} agentName={deactivateAgent?.name || ""} currentManagerId={deactivateAgent?.managerId} onComplete={() => { setDeactivateAgent(null); team.closePerson(); refreshAll(); }} />
      {editLoginAgent ? (
        <AgentQuickEditDialog open onOpenChange={(o) => !o && setEditLoginAgent(null)} agentId={editLoginAgent.id} currentName={editLoginAgent.name} onUpdate={refreshAll} />
      ) : null}
    </>
  );
}
