/**
 * AgentProfileDrawer — global deep-profile overlay for any agent.
 *
 * 2026-06-15 — Sam directive (voice): "Even for example, if I search up an
 * agent, I should… I tap their name, I should push a pull up that I'm inside
 * the CRM. Like the fact that I can't do that is outrageous. It should have
 * systems where it's easy to see, check whether they're in field training,
 * on court [classroom], in classroom. Inventory borrowers active in the
 * field — i.e. active producing in the field."
 *
 * - State lives in `useAgentProfileDrawer` (zustand) so any surface can call
 *   `openAgentProfile(agentId)` without prop-drilling.
 * - Mobile: full-screen right-slide (Sheet primitive sets w-3/4 + sm:max-w-sm
 *   by default — we override to w-full on mobile so the drawer covers the
 *   viewport on iPhone 375px).
 * - Desktop: ~480px right-side drawer.
 * - In-place close (Sam's preference) — no navigation pop.
 *
 * Sections reuse the existing rich per-agent components from DashboardCRM:
 *   - Avatar + name + agent_code + status badges
 *   - License + contact info
 *   - AgentTrainingStageBar (NEW)
 *   - Manager chain + downline count
 *   - Recent activity (last contact, last deal)
 *   - One-tap actions (call/email/SMS/copy code/open AgentDetail)
 *   - AgentCredentialsPanel (admin only — existing component)
 *   - AgentNotes (existing component)
 */

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  Phone,
  Mail,
  MessageSquare,
  Copy,
  ExternalLink,
  Loader2,
  ShieldCheck,
  ShieldAlert,
  Users,
  Calendar,
  TrendingUp,
  TrendingDown,
  MessageCircle,
  Pencil,
  Check,
  X,
  UserX,
  UserCheck,
  Trash2,
  Link as LinkIcon,
  KeyRound,
  Edit2,
  ListTodo,
} from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AgentAvatar } from "@/components/ui/AgentAvatar";
import { AgentTrainingStageBar } from "@/components/dashboard/AgentTrainingStageBar";
import { LicenseProgressSelector } from "@/components/dashboard/LicenseProgressSelector";
import { AgentReferralLinkCard } from "@/components/agent/AgentReferralLinkCard";
import { CandidateGoalsNotesPanel } from "@/components/dashboard/CandidateGoalsNotesPanel";
import { FreeLeadsStatusCard } from "@/components/dashboard/FreeLeadsStatusCard";
import { AgentOnboardingEmailStatus } from "@/components/dashboard/AgentOnboardingEmailStatus";
import { AgentOnboardingCommandCenter } from "@/components/dashboard/AgentOnboardingCommandCenter";
import { ReassignManagerButton } from "@/components/agents/ReassignManagerButton";
import { AgentCredentialsPanel } from "@/components/dashboard/AgentCredentialsPanel";
import { AgentQuickEditDialog } from "@/components/dashboard/AgentQuickEditDialog";
import { AgentTaskManager } from "@/components/dashboard/AgentTaskManager";
import { AgentNotes } from "@/components/dashboard/AgentNotes";
import { DeactivateAgentDialog } from "@/components/dashboard/DeactivateAgentDialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useConfirm } from "@/hooks/useConfirm";
import { useAgentProfileDrawer } from "@/stores/agentProfileDrawer";
import { cn } from "@/lib/utils";
import { formatEnumLabel } from "@/lib/formatEnumLabel";
import { toast } from "sonner";

interface AgentRow {
  id: string;
  user_id: string | null;
  agent_code: string | null;
  status: string | null;
  license_status: string | null;
  license_progress: string | null;
  nipr_number: string | null;
  start_date: string | null;
  total_policies: number | null;
  total_premium: number | null;
  total_earnings: number | null;
  manager_id: string | null;
  display_name: string | null;
  is_deactivated: boolean | null;
  is_inactive: boolean | null;
  onboarding_stage: string | null;
  first_deal_at: string | null;
  contracted_at: string | null;
  /** Row-level operational stamp written by the add-agent edge function
   *  (e.g. "[NEEDS TRANSFER] owner=… next=Confirm carrier releases …").
   *  Full structured detail lives in agent_notes — this is the flag. */
  notes: string | null;
  profile: { full_name: string | null; email: string | null; phone: string | null; avatar_url: string | null } | null;
  manager: { id: string; profile: { full_name: string | null } | null } | null;
}

interface ActivityRow {
  last_contacted_at: string | null;
  last_deal_posted_at: string | null;
  lifetime_deals: number | null;
  lifetime_alp: number | null;
  downline_count: number | null;
}

interface MonthlyProductionRow {
  items_this_month: number | null;
  annual_volume_this_month: number | null;
  legs: number | null;
}

interface PaceVerdictRow {
  agent_id: string;
  ap_mtd: number | null;
  projected_eom_ap: number | null;
  pace_verdict: "hit_20k" | "on_pace_20k" | "below_pace" | "new_hire_grace" | "zero_mtd" | string;
}

interface TrendAlertRow {
  producer_id: string;
  current_week_alp: number | null;
  alp_3_weeks_ago: number | null;
  delta_pct: number | null;
  direction: "up" | "down" | "flat" | string;
  currently_dropping: boolean;
}

interface CallTimelineRow {
  source: "call" | "note" | string;
  id: string;
  occurred_at: string;
  outcome: string | null;
  notes: string | null;
  logged_by_name: string | null;
}

function copyToClipboard(text: string, label: string) {
  if (!text) return;
  try {
    navigator.clipboard?.writeText(text);
    toast.success(`${label} copied`);
  } catch {
    toast.error(`Could not copy ${label}`);
  }
}

function fmtUSD(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function fmtUSDCompact(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n >= 1000) {
    return `$${(n / 1000).toLocaleString("en-US", { maximumFractionDigits: 1 })}k`;
  }
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function fmtRelative(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    const now = Date.now();
    // Clamp future-dated inputs so a future policy/effective date never renders
    // a negative ("-18690m ago"). Canonical formatter: formatTimeAgo in dateUtils.
    const diffMs = Math.max(0, now - d.getTime());
    const mins = Math.round(diffMs / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.round(hrs / 24);
    if (days < 7) return `${days}d ago`;
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch {
    return "—";
  }
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return "—";
  }
}

function statusBadgeColor(status: string | null | undefined): string {
  switch ((status ?? "").toLowerCase()) {
    case "active":     return "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20";
    case "inactive":   return "bg-slate-500/10 text-slate-600 dark:text-muted-foreground border-slate-500/20";
    case "terminated": return "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20";
    case "pending":    return "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20";
    default:           return "bg-muted/50 text-muted-foreground border-border";
  }
}

// wave-18 (2026-07-06): formatEnumLabel extracted to src/lib/formatEnumLabel.ts
// so AgentDetail and any other enum-rendering surface can route through the
// same normalizer. The raw-db-slug-leak guard (scripts/check-db-slug-leak.mjs)
// now enforces this at commit time.

export function AgentProfileDrawer() {
  const { isAdmin } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const askConfirm = useConfirm();
  const agentId = useAgentProfileDrawer((s) => s.agentId);
  const close = useAgentProfileDrawer((s) => s.close);

  // 2026-07-01 PL-MP231 — full-control edit surfaces (Sam: "once hired I have
  // full control of their account"). Local UI state for inline name edit +
  // deactivate dialog + delete confirmation.
  const [nameEditing, setNameEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [nameSaving, setNameSaving] = useState(false);
  // MP-233 magic hire link — one-tap generate + copy to clipboard.
  const [hireLinkLoading, setHireLinkLoading] = useState(false);
  // MP-234 magic join/prospect link — one-tap generate + copy to clipboard.
  const [joinLinkLoading, setJoinLinkLoading] = useState(false);
  const [deactivateOpen, setDeactivateOpen] = useState(false);
  const [quickEditOpen, setQuickEditOpen] = useState(false);

  // Close on route change happens automatically because the Sheet primitive
  // is portaled — but we reset on unmount just in case.
  useEffect(() => {
    return () => {
      // No cleanup needed — zustand state persists across renders.
    };
  }, []);

  const { data: agent, isLoading } = useQuery<AgentRow | null>({
    queryKey: ["agent-profile-drawer", agentId],
    enabled: !!agentId,
    queryFn: async () => {
      if (!agentId) return null;
      const { data, error } = await supabase
        .from("v_agents_full")
        .select(
          `id, user_id, agent_code, status, license_status, license_progress, nipr_number, start_date,
           total_policies, total_premium, total_earnings, manager_id,
           display_name, is_deactivated, is_inactive, onboarding_stage,
           first_deal_at, contracted_at, notes,
           profile:profiles!agents_profile_id_fkey(full_name, email, phone, avatar_url),
           manager:agents!manager_id(id, profile:profiles(full_name))`,
        )
        .eq("id", agentId)
        .maybeSingle();
      if (error) {
        // 2026-06-16 Sam-feedback: search doesn't pull up profile. If RLS
        // or the embedded join breaks, surface it instead of silent-null.

        console.error("[AgentProfileDrawer] agent query failed", { agentId, error });
        toast.error(`Profile load failed: ${error.message?.slice(0, 80) ?? "unknown"}`);
        throw error;
      }
      if (!data) {

        console.warn("[AgentProfileDrawer] no agent row for id", agentId);
        toast.warning(`No agent row for id ${agentId.slice(0, 8)}…`);
      }
      return (data as any) ?? null;
    },
    staleTime: 30_000,
  });

interface CarrierMixRow {
  carrier: string | null;
  policies: number | string | null;
  pct_of_policies: number | string | null;
  alp: number | string | null;
  pct_of_alp: number | string | null;
  in_force: number | string | null;
}

interface DealQualityRow {
  deals_total: number | string | null;
  deals_30d: number | string | null;
  avg_deal_alp: number | string | null;
  persistency_pct: number | string | null;
  pct_never_issued: number | string | null;
  in_force: number | string | null;
  lapsed: number | string | null;
  carriers_used: number | string | null;
  top_carrier: string | null;
  top_carrier_share_pct: number | string | null;
}
interface EarningsRow {
  contract_pct: number | string | null;
  est_earned_in_force: number | string | null;
  est_pending_if_issued: number | string | null;
  est_earned_mtd: number | string | null;
}
const qnum = (v: number | string | null | undefined): number | null => {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

  const { data: activity } = useQuery<ActivityRow | null>({
    queryKey: ["agent-profile-drawer-activity", agentId],
    enabled: !!agentId,
    queryFn: async () => {
      if (!agentId) return null;
      // Lifetime production from the well-known view.
      const [lpRes, dlRes, contactRes] = await Promise.all([
        supabase
          .from("agent_lifetime_production" as any)
          .select("lifetime_alp, lifetime_deals, last_production_date")
          .eq("agent_id", agentId)
          .maybeSingle(),
        supabase
          .from("agents")
          .select("id", { count: "exact", head: true })
          .eq("manager_id", agentId),
        supabase
          .from("agent_notes")
          .select("created_at")
          .eq("agent_id", agentId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
      const lp = lpRes.data as any;
      const contactRow = contactRes.data as any;
      return {
        last_contacted_at: contactRow?.created_at ?? null,
        last_deal_posted_at: lp?.last_production_date ?? null,
        lifetime_deals: lp?.lifetime_deals ?? 0,
        lifetime_alp: lp?.lifetime_alp ?? 0,
        downline_count: dlRes.count ?? 0,
      };
    },
    staleTime: 30_000,
  });

  // MP-268: book QUALITY, not just volume. A manager taps an agent and sees what
  // the book is actually made of — how much of it sticks, how much never issued,
  // and how concentrated it is on one carrier.
  const { data: quality } = useQuery<DealQualityRow | null>({
    queryKey: ["agent-drawer-deal-quality", agentId],
    enabled: !!agentId,
    staleTime: 60_000,
    queryFn: async () => {
      if (!agentId) return null;
      const { data, error } = await (supabase as any)
        .from("v_agent_deal_quality")
        // pct_with_policy_number deliberately dropped 2026-07-27. It reads 100.0 for all 50
        // agents — one distinct value — because agentlink_book has 0 of 1607 rows missing a
        // policy number and deals has 0 of 1598; neither system records a deal without one.
        // It was fetched here but never rendered. A metric that cannot vary is not a quality
        // signal, and putting it on screen would train Sam to ignore the panel.
        .select("deals_total, deals_30d, avg_deal_alp, persistency_pct, pct_never_issued, in_force, lapsed, carriers_used, top_carrier, top_carrier_share_pct")
        .eq("agent_id", agentId)
        .maybeSingle();
      if (error) throw error;
      return (data as DealQualityRow) ?? null;
    },
  });

  // Full carrier breakdown — what "top carrier" alone cannot show.
  const { data: carrierMix } = useQuery<CarrierMixRow[] | null>({
    queryKey: ["agent-drawer-carrier-mix", agentId],
    enabled: !!agentId,
    staleTime: 60_000,
    queryFn: async () => {
      if (!agentId) return null;
      const { data, error } = await (supabase as any)
        .from("v_agent_carrier_mix")
        .select("carrier, policies, pct_of_policies, alp, pct_of_alp, in_force")
        .eq("agent_id", agentId)
        .order("policies", { ascending: false });
      if (error) throw error;
      return (data as CarrierMixRow[]) ?? [];
    },
  });

  // ESTIMATED earnings only. No payout feed exists (agentlink_commissions and
  // insuracloud_payouts have never had a row), so this is premium x contract %
  // and is labelled as an estimate wherever it renders.
  const { data: earnings } = useQuery<EarningsRow | null>({
    queryKey: ["agent-drawer-earnings-estimate", agentId],
    enabled: !!agentId,
    staleTime: 60_000,
    queryFn: async () => {
      if (!agentId) return null;
      const { data, error } = await (supabase as any)
        .from("v_earnings_estimate")
        .select("contract_pct, est_earned_in_force, est_pending_if_issued, est_earned_mtd")
        .eq("agent_id", agentId)
        .maybeSingle();
      if (error) throw error;
      return (data as EarningsRow) ?? null;
    },
  });

  // Monthly production: IT (deals this month), AV (annual volume this month), Legs.
  // Sam directive 2026-06-16 voice — recruit profile DB hero tiles.
  const { data: monthly } = useQuery<MonthlyProductionRow | null>({
    queryKey: ["agent-profile-drawer-monthly", agentId],
    enabled: !!agentId,
    queryFn: async () => {
      if (!agentId) return null;
      const { data, error } = await supabase
        .from("v_agent_monthly_production" as any)
        .select("items_this_month, annual_volume_this_month, legs")
        .eq("agent_id", agentId)
        .maybeSingle();
      if (error) {
        // Graceful: never block the drawer if the view is missing in dev.

        console.warn("[AgentProfileDrawer] monthly production query failed", error);
        return { items_this_month: 0, annual_volume_this_month: 0, legs: 0 };
      }
      return (data as any) ?? { items_this_month: 0, annual_volume_this_month: 0, legs: 0 };
    },
    staleTime: 30_000,
  });

  // 2026-06-18 — pace_verdict from v_agent_20k_target_leaderboard.
  // Shows "Hit $20K" / "On pace $20K" / "Below pace" / etc. as a colored pill
  // so Sam instantly sees if an agent is tracking for the $20K MTD target.
  const { data: pace } = useQuery<PaceVerdictRow | null>({
    queryKey: ["agent-profile-drawer-pace", agentId],
    enabled: !!agentId,
    queryFn: async () => {
      if (!agentId) return null;
      const { data, error } = await supabase
        .from("v_agent_20k_target_leaderboard" as any)
        .select("agent_id, ap_mtd, projected_eom_ap, pace_verdict")
        .eq("agent_id", agentId)
        .maybeSingle();
      if (error || !data) return null;
      return data as any;
    },
    staleTime: 60_000,
  });

  // 2026-07-01 — producer weekly trend chip. Reads v_producer_trend_alert
  // (populated from agentlink_deals_snapshot). currently_dropping = 3 strict
  // consecutive weekly ALP drops → shows a red "DROPPING 3W" chip so the
  // Daniel-didn't-know slip mode gets caught on any drawer open.
  const { data: trend } = useQuery<TrendAlertRow | null>({
    queryKey: ["agent-profile-drawer-trend", agentId],
    enabled: !!agentId,
    queryFn: async () => {
      if (!agentId) return null;
      const { data, error } = await supabase
        .from("v_producer_trend_alert" as any)
        .select("producer_id, current_week_alp, alp_3_weeks_ago, delta_pct, direction, currently_dropping")
        .eq("producer_id", agentId)
        .maybeSingle();
      if (error || !data) return null;
      return data as any;
    },
    staleTime: 60_000,
  });

  // Call notes timeline: merged call_activity + agent_notes via SECURITY INVOKER RPC.
  // Sam directive 2026-06-16 voice — "notes from the call" surfaced in profile.
  const { data: timeline } = useQuery<CallTimelineRow[]>({
    queryKey: ["agent-profile-drawer-timeline", agentId],
    enabled: !!agentId,
    queryFn: async () => {
      if (!agentId) return [];
      const { data, error } = await supabase.rpc("agent_call_activity" as any, { p_agent_id: agentId });
      if (error) {

        console.warn("[AgentProfileDrawer] timeline rpc failed", error);
        return [];
      }
      return ((data as any) ?? []) as CallTimelineRow[];
    },
    staleTime: 30_000,
  });

  const open = !!agentId;
  const name = agent?.display_name || agent?.profile?.full_name || "—";
  const email = agent?.profile?.email ?? null;
  const phone = agent?.profile?.phone ?? null;
  const avatarUrl = agent?.profile?.avatar_url ?? null;
  const code = agent?.agent_code ?? null;
  const managerName = agent?.manager?.profile?.full_name ?? null;
  const isLicensed = agent?.license_status === "licensed";

  return (
    <>
    {/* 2026-07-01 PL-MP231 — deactivate dialog for full-control admin block. */}
    {agent && (
      <DeactivateAgentDialog
        open={deactivateOpen}
        onOpenChange={setDeactivateOpen}
        agentId={agent.id}
        agentName={name}
        currentManagerId={agent.manager_id ?? undefined}
        onComplete={() => {
          setDeactivateOpen(false);
          qc.invalidateQueries({ queryKey: ["agent-profile-drawer"] });
          toast.success(`${name} deactivated`);
        }}
      />
    )}
    {agent && (
      <AgentQuickEditDialog
        open={quickEditOpen}
        onOpenChange={setQuickEditOpen}
        agentId={agent.id}
        currentName={name}
        production={agent.total_premium ?? 0}
        deals={agent.total_policies ?? 0}
        onUpdate={() => qc.invalidateQueries({ queryKey: ["agent-profile-drawer"] })}
      />
    )}
    <Sheet open={open} onOpenChange={(o) => { if (!o) close(); }}>
      <SheetContent
        side="right"
        className={cn(
          // Mobile-first: full-screen on phones (override Sheet primitive's
          // default w-3/4 + sm:max-w-sm). Desktop: ~480px rail.
          // 2026-06-18: flex column so the sticky footer hugs the bottom.
          "w-full max-w-full p-0 sm:max-w-[480px] flex flex-col h-full",
        )}
      >
        <SheetHeader className="px-4 pt-4 pb-2 border-b border-border bg-card/60 sticky top-0 z-10 backdrop-blur-sm">
          <SheetTitle className="text-base">Agent profile</SheetTitle>
          <SheetDescription className="sr-only">
            Deep profile view for the selected agent. License, training stage, contact, manager chain, credentials, notes.
          </SheetDescription>
        </SheetHeader>

        {isLoading || !agent ? (
          <div className="flex-1 flex items-center justify-center py-16">
            {isLoading ? <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /> : (
              <p className="text-sm text-muted-foreground">Agent not found.</p>
            )}
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
            {/* Identity */}
            <div className="flex items-start gap-3">
              <AgentAvatar avatarUrl={avatarUrl ?? undefined} name={name} size="lg" className="ring-2 ring-background shadow-sm" />
              <div className="min-w-0 flex-1">
                {/* 2026-07-01 PL-MP231 — inline display_name edit. Tap pencil,
                    type, hit check. Writes agents.display_name directly. */}
                {nameEditing ? (
                  <div className="flex items-center gap-1.5">
                    <input
                      autoFocus
                      value={nameDraft}
                      onChange={(e) => setNameDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") { setNameEditing(false); }
                      }}
                      className="min-w-0 flex-1 text-lg font-bold leading-tight bg-background border-2 border-primary/60 rounded-md px-2 py-1 focus:outline-none"
                      placeholder="Display name"
                    />
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 p-0"
                      disabled={nameSaving || !nameDraft.trim()}
                      onClick={async () => {
                        if (!agent?.id || !nameDraft.trim()) return;
                        setNameSaving(true);
                        const { error } = await (supabase as any)
                          .from("agents")
                          .update({ display_name: nameDraft.trim(), updated_at: new Date().toISOString() })
                          .eq("id", agent.id);
                        setNameSaving(false);
                        if (error) {
                          toast.error(`Rename failed: ${error.message.slice(0, 80)}`);
                        } else {
                          toast.success(`Renamed → ${nameDraft.trim()}`);
                          setNameEditing(false);
                          qc.invalidateQueries({ queryKey: ["agent-profile-drawer"] });
                        }
                      }}
                      title="Save"
                    >
                      {nameSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 p-0"
                      onClick={() => setNameEditing(false)}
                      title="Cancel"
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5">
                    <h2 className="text-lg font-bold leading-tight truncate">{name}</h2>
                    <button
                      type="button"
                      onClick={() => { setNameDraft(agent?.display_name ?? agent?.profile?.full_name ?? ""); setNameEditing(true); }}
                      className="text-muted-foreground hover:text-foreground shrink-0"
                      title="Rename agent"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-1.5 mt-1">
                  {code && (
                    <button
                      type="button"
                      onClick={() => copyToClipboard(code, "Agent code")}
                      className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                      title="Copy agent code"
                    >
                      <span className="tabular-nums">{code}</span>
                      <Copy className="h-3 w-3" />
                    </button>
                  )}
                  <Badge variant="outline" className={cn("text-[10px]", statusBadgeColor(agent.status))}>
                    {formatEnumLabel(agent.status, "—")}
                  </Badge>
                  {/* 2026-06-18 Sam directive 'make sure their license to go ahead
                      and start that coursework'. License badge is a click-to-flip
                      toggle. Tap unlicensed → flips to licensed, fires course email
                      via existing trg_agents_hired_licensed_enqueue trigger. */}
                  {isLicensed ? (
                    <button
                      onClick={async () => {
                        if (!agent?.id) return;
                        const ok = await askConfirm({
                          title: `Mark ${agent.display_name ?? "this agent"} as unlicensed?`,
                          description: "Their status flips back to unlicensed and the license timestamp is cleared.",
                          confirmText: "Mark unlicensed",
                          tone: "danger",
                        });
                        if (!ok) return;
                        // MP231-verify fix 2026-07-01: null licensed_at when
                        // flipping back to unlicensed. Downstream views (v_agent_
                        // licensed_pipeline, hired→licensed enqueue trigger) key
                        // off licensed_at timestamp — leaving it stale would fool
                        // them into treating an unlicensed agent as still licensed.
                        const { error } = await (supabase as any)
                          .from("agents")
                          .update({ license_status: "unlicensed", licensed_at: null, updated_at: new Date().toISOString() })
                          .eq("id", agent.id);
                        if (error) toast.error(`Update failed: ${error.message.slice(0, 80)}`);
                        else {
                          toast.success(`${agent.display_name} → unlicensed`);
                          qc.invalidateQueries({ queryKey: ["agent-profile-drawer"] });
                        }
                      }}
                      className="inline-flex items-center text-[10px] px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20 transition-colors"
                      title="Tap to flip back to unlicensed"
                    >
                      <ShieldCheck className="h-3 w-3 mr-0.5" /> licensed
                    </button>
                  ) : (
                    <button
                      onClick={() => {
                        setQuickEditOpen(true);
                        toast.info("Enter or verify the NPN, choose Licensed, then save. Contracting and onboarding will start automatically.");
                      }}
                      className="inline-flex items-center text-[10px] px-2 py-0.5 rounded-md bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 hover:bg-amber-500/20 transition-colors"
                      title="Open license and onboarding controls"
                    >
                      <ShieldAlert className="h-3 w-3 mr-0.5" /> {formatEnumLabel(agent.license_status, "Unlicensed")} <span className="ml-1 opacity-60">→ verify NPN</span>
                    </button>
                  )}
                  {agent.is_deactivated && (
                    <Badge variant="outline" className="text-[10px] bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20">deactivated</Badge>
                  )}
                  {/* 2026-08-06: the add-agent transfer block stamps
                      agents.notes with "[NEEDS TRANSFER] …". Until now the
                      column did not exist and nothing rendered it, so an agent
                      needing carrier releases looked identical to one who
                      didn't. Full detail sits in the Notes tab (agent_notes). */}
                  {agent.notes?.startsWith("[NEEDS TRANSFER]") && (
                    <Badge
                      variant="outline"
                      className="text-[10px] bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20"
                      title={agent.notes}
                    >
                      needs transfer
                    </Badge>
                  )}
                </div>
              </div>
            </div>

            {isAdmin && (
              <Button
                size="sm"
                className="h-11 w-full gap-2 bg-amber-500 font-bold text-black hover:bg-amber-400"
                onClick={() => setQuickEditOpen(true)}
              >
                <KeyRound className="h-4 w-4" />
                Owner controls — login, email, password &amp; profile
              </Button>
            )}

            {/* 2026-06-18 — pace verdict from v_agent_20k_target_leaderboard.
                Instant visual: 🔥 hit_20k · 📈 on_pace_20k · 📉 below_pace ·
                🆕 new_hire_grace · 😴 zero_mtd. */}
            {pace && pace.pace_verdict && (
              <div className={cn(
                "rounded-full border px-3 py-2 flex items-center justify-between gap-2 text-xs",
                pace.pace_verdict === "hit_20k" && "border-emerald-500/40 bg-emerald-500/10 text-emerald-500",
                pace.pace_verdict === "on_pace_20k" && "border-info/30 bg-info/10 text-info",
                pace.pace_verdict === "below_pace" && "border-amber-500/40 bg-amber-500/10 text-amber-500",
                pace.pace_verdict === "new_hire_grace" && "border-slate-500/40 bg-slate-500/10 text-muted-foreground",
                pace.pace_verdict === "zero_mtd" && "border-rose-500/40 bg-rose-500/10 text-rose-500",
              )}>
                <span className="font-semibold tabular-nums">
                  {pace.pace_verdict === "hit_20k" && "🔥 Hit $20K MTD"}
                  {pace.pace_verdict === "on_pace_20k" && "📈 On pace for $20K"}
                  {pace.pace_verdict === "below_pace" && "📉 Below $20K pace"}
                  {pace.pace_verdict === "new_hire_grace" && "🆕 New hire grace"}
                  {pace.pace_verdict === "zero_mtd" && "😴 0 MTD"}
                </span>
                {pace.projected_eom_ap != null && pace.pace_verdict !== "new_hire_grace" && (
                  <span className="text-muted-foreground tabular-nums">
                    EOM proj {fmtUSDCompact(pace.projected_eom_ap)}
                  </span>
                )}
              </div>
            )}

            {/* 2026-07-01 — producer weekly trend chip. Reads v_producer_trend_alert.
                currently_dropping=true (3 strict consecutive weekly ALP drops) → red
                chip "DROPPING 3W". Direction up/down/flat renders as arrow + Δ%.
                Solves the "Daniel didn't know his production dropped 3 weeks"
                slip. Renders nothing when no trend row exists (unlinked producer). */}
            {trend && trend.delta_pct != null && (
              <div className={cn(
                "rounded-full border px-3 py-2 flex items-center justify-between gap-2 text-xs",
                trend.currently_dropping && "border-rose-500/50 bg-rose-500/15 text-rose-400",
                !trend.currently_dropping && trend.direction === "down" && "border-amber-500/40 bg-amber-500/10 text-amber-400",
                !trend.currently_dropping && trend.direction === "up" && "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
                !trend.currently_dropping && trend.direction === "flat" && "border-border bg-muted/30 text-muted-foreground",
              )}>
                <span className="font-semibold inline-flex items-center gap-1.5">
                  {trend.currently_dropping ? (
                    <>
                      <TrendingDown className="h-3.5 w-3.5" /> DROPPING 3W
                    </>
                  ) : trend.direction === "down" ? (
                    <>
                      <TrendingDown className="h-3.5 w-3.5" /> Trend down
                    </>
                  ) : trend.direction === "up" ? (
                    <>
                      <TrendingUp className="h-3.5 w-3.5" /> Trend up
                    </>
                  ) : (
                    <>Trend flat</>
                  )}
                </span>
                <span className="tabular-nums">
                  {(trend.delta_pct ?? 0) > 0 ? "+" : ""}{trend.delta_pct}% · 3wk
                </span>
              </div>
            )}

            {/* Hero IT / AV / Legs row — Sam directive 2026-06-16 voice:
                "I want their how much production they're doing monthly,
                 whether it's IT or AV, how many legs they have, and then
                 obviously notes from the call."
                2026-06-18 polish: color-accent each tile so the eye scans
                items vs money vs downline instantly. */}
            <div className="rounded-3xl border border-border bg-card/40 grid grid-cols-3 divide-x divide-border overflow-hidden">
              <div className="min-w-0 px-3 py-4">
                <p className="text-[10px] uppercase tracking-wider text-emerald-500/80 font-semibold flex items-center gap-1">
                  <Calendar className="h-2.5 w-2.5" /> IT
                </p>
                <p className="mt-1 text-3xl font-black tabular-nums leading-none text-emerald-500 dark:text-emerald-400">
                  {(monthly?.items_this_month ?? 0).toLocaleString()}
                </p>
                <p className="mt-1 text-[10px] text-muted-foreground">items · this month</p>
              </div>
              <div className="min-w-0 px-3 py-4">
                <p className="text-[10px] uppercase tracking-wider text-amber-500/80 font-semibold flex items-center gap-1">
                  <TrendingUp className="h-2.5 w-2.5" /> AV
                </p>
                <p className="mt-1 text-3xl font-black tabular-nums leading-none text-amber-500 dark:text-amber-400">
                  {fmtUSDCompact(monthly?.annual_volume_this_month ?? 0)}
                </p>
                <p className="mt-1 text-[10px] text-muted-foreground">premium · this month</p>
              </div>
              <div className="min-w-0 px-3 py-4">
                <p className="text-[10px] uppercase tracking-wider text-info/80 font-semibold flex items-center gap-1">
                  <Users className="h-2.5 w-2.5" /> Legs
                </p>
                <p className="mt-1 text-3xl font-black tabular-nums leading-none text-info dark:text-info">
                  {(monthly?.legs ?? 0).toLocaleString()}
                </p>
                <p className="mt-1 text-[10px] text-muted-foreground">downline</p>
              </div>
            </div>

            {!isLicensed ? (
              <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card p-3">
                <div>
                  <p className="text-sm font-semibold">Licensing progress</p>
                  <p className="text-xs text-muted-foreground">Tap the current official milestone.</p>
                </div>
                <LicenseProgressSelector
                  agentId={agent.id}
                  currentProgress={(agent.license_progress || "unlicensed") as any}
                  onProgressUpdated={() => {
                    qc.invalidateQueries({ queryKey: ["agent-profile-drawer", agent.id] });
                    qc.invalidateQueries({ queryKey: ["crm-agents"] });
                  }}
                />
              </div>
            ) : null}

            {/* Production qualification + permanent recruiting link. */}
            <FreeLeadsStatusCard agentId={agent.id} />

            <AgentReferralLinkCard agentId={agent.id} />

            <CandidateGoalsNotesPanel agentId={agent.id} />

            {/* Training stage tracker (NEW) */}
            <AgentTrainingStageBar agentId={agent.id} />

            {/* Onboarding email status — Sam directive 2026-06-17:
                "people who are saying they're not getting emails after I...
                 like, for example, I have someone who just says he didn't
                 get the email after he just signed up and logged up with me."
                v_agents_onboarding_status returns course_state + last_error +
                course_sent_at. Resend-now button manually fires for THIS agent
                via the send-agent-onboarding-email edge fn. */}
            <AgentOnboardingEmailStatus agentId={agent.id} />

            {/* Complete onboarding + carrier-contract workflow. This is the
                tap-agent operating surface: account, license, contracting,
                training, Discord, field training and first-deal state, plus
                Sam's auditable per-carrier sent/submitted/active controls. */}
            <AgentOnboardingCommandCenter agentId={agent.id} agentName={name} />

            {/* 2026-06-17 Sam directive: "change the manager's things" —
                inline manager reassign on every agent. */}
            <div className="flex items-center justify-between rounded-3xl border border-border bg-card/40 px-4 py-3">
              <div className="min-w-0">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Manager</p>
                <p className="text-sm font-medium truncate">
                  {agent.manager?.profile?.full_name || "—"}
                </p>
              </div>
              <ReassignManagerButton
                kind="agent"
                targetId={agent.id}
                currentManagerId={agent.manager_id ?? null}
              />
            </div>



            {/* One-tap actions */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-9 gap-1.5"
                disabled={!phone}
                onClick={() => phone && (window.location.href = `tel:${phone}`)}
              >
                <Phone className="h-3.5 w-3.5" /> Call
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-9 gap-1.5"
                disabled={!email}
                onClick={() => email && (window.location.href = `mailto:${email}`)}
              >
                <Mail className="h-3.5 w-3.5" /> Email
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-9 gap-1.5"
                disabled={!phone}
                onClick={() => phone && (window.location.href = `sms:${phone}`)}
              >
                <MessageSquare className="h-3.5 w-3.5" /> SMS
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-9 gap-1.5"
                onClick={() => { close(); navigate(`/dashboard/agent/${agent.id}`); }}
              >
                <ExternalLink className="h-3.5 w-3.5" /> Full page
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-9 gap-1.5"
                onClick={() => setQuickEditOpen(true)}
              >
                <Edit2 className="h-3.5 w-3.5" /> Edit &amp; access
              </Button>
            </div>

            {/* MP-233 — Generate Hire Link (admin/manager only). One tap:
                generate + copy URL to clipboard + toast success. Prospect
                pastes it wherever the conversation is already happening. */}
            {isAdmin && (
              <Button
                variant="secondary"
                size="sm"
                data-testid="generate-hire-link"
                data-invite-kind="hire"
                className="w-full h-9 gap-1.5"
                disabled={hireLinkLoading}
                onClick={async () => {
                  if (!agent) return;
                  setHireLinkLoading(true);
                  try {
                    const licensed = (agent.license_status ?? "").toLowerCase() === "licensed";
                    const { data, error } = await supabase.rpc("generate_invite_token", {
                      p_kind: "hire",
                      p_expires_hours: 168,
                      p_target_role: licensed ? "hired_licensed" : "hired_unlicensed",
                      p_target_manager_id: agent.manager_id ?? null,
                      p_prefill: {
                        full_name: agent.display_name ?? agent.profile?.full_name ?? null,
                        phone: agent.profile?.phone ?? null,
                        email: agent.profile?.email ?? null,
                      },
                      p_notes: `AgentProfileDrawer for ${agent.id}`,
                    });
                    if (error) {
                      toast.error(error.message);
                      return;
                    }
                    const url = (data as { url?: string })?.url;
                    if (!url) {
                      toast.error("No URL returned. Try again.");
                      return;
                    }
                    try {
                      await navigator.clipboard.writeText(url);
                      toast.success("Hire link copied. 7-day expiry, one-use.");
                    } catch {
                      toast.success(`Hire link generated: ${url}`);
                    }
                  } catch (err) {
                    console.error("generate_invite_token failed", err);
                    toast.error("Couldn't generate hire link.");
                  } finally {
                    setHireLinkLoading(false);
                  }
                }}
              >
                {hireLinkLoading ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Generating…
                  </>
                ) : (
                  <>
                    <LinkIcon className="h-3.5 w-3.5" />
                    Generate Hire Link
                  </>
                )}
              </Button>
            )}

            {/* MP-234 — Generate Prospect Join Link (admin/manager only).
                Same one-tap generate + copy + toast pattern as hire link, but
                mints kind='join' so the consumer creates an application row
                (not an agent) and triggers the calendly + prospect_whatsapp
                fanout via existing DB triggers. */}
            {isAdmin && (
              <Button
                variant="secondary"
                size="sm"
                data-testid="generate-join-link"
                data-invite-kind="join"
                className="w-full h-9 gap-1.5"
                disabled={joinLinkLoading}
                onClick={async () => {
                  if (!agent) return;
                  setJoinLinkLoading(true);
                  try {
                    const { data, error } = await supabase.rpc(
                      "generate_invite_token",
                      {
                        p_kind: "join",
                        p_expires_hours: 168,
                        p_target_role: "referral_prospect",
                        p_target_manager_id: agent.manager_id ?? agent.id ?? null,
                        p_prefill: {},
                        p_notes: `AgentProfileDrawer join for ${agent.id}`,
                      },
                    );
                    if (error) {
                      toast.error(error.message);
                      return;
                    }
                    const url = (data as { url?: string })?.url;
                    if (!url) {
                      toast.error("No URL returned. Try again.");
                      return;
                    }
                    try {
                      await navigator.clipboard.writeText(url);
                      toast.success("Join link copied. 7-day expiry, one-use.");
                    } catch {
                      toast.success(`Join link generated: ${url}`);
                    }
                  } catch (err) {
                    console.error("generate_invite_token (join) failed", err);
                    toast.error("Couldn't generate join link.");
                  } finally {
                    setJoinLinkLoading(false);
                  }
                }}
              >
                {joinLinkLoading ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Generating…
                  </>
                ) : (
                  <>
                    <LinkIcon className="h-3.5 w-3.5" />
                    Generate Prospect Join Link
                  </>
                )}
              </Button>
            )}

            {/* Contact + manager */}
            <div className="grid grid-cols-1 gap-2 rounded-lg border border-border bg-card/60 p-3">
              <div className="grid grid-cols-3 gap-2 text-xs">
                <span className="text-muted-foreground">Email</span>
                <span className="col-span-2 truncate">{email ?? "—"}</span>
                <span className="text-muted-foreground">Phone</span>
                <span className="col-span-2 truncate">{phone ?? "—"}</span>
                <span className="text-muted-foreground">Manager</span>
                <span className="col-span-2 truncate">{managerName ?? "—"}</span>
                <span className="text-muted-foreground">Hired</span>
                <span className="col-span-2 tabular-nums">{fmtDate(agent.start_date)}</span>
                <span className="text-muted-foreground">Contracted</span>
                <span className="col-span-2 tabular-nums">{fmtDate(agent.contracted_at)}</span>
                <span className="text-muted-foreground">First deal</span>
                <span className="col-span-2 tabular-nums">{fmtDate(agent.first_deal_at)}</span>
              </div>
            </div>

            {/* Activity + downline */}
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-lg border border-border bg-card/60 p-2.5">
                <div className="flex items-center gap-1.5 mb-1">
                  <TrendingUp className="h-3 w-3 text-emerald-500" />
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Lifetime ALP</span>
                </div>
                <p className="text-sm font-bold tabular-nums">{fmtUSD(activity?.lifetime_alp ?? null)}</p>
              </div>
              <div className="rounded-lg border border-border bg-card/60 p-2.5">
                <div className="flex items-center gap-1.5 mb-1">
                  <Calendar className="h-3 w-3 text-info" />
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Deals</span>
                </div>
                <p className="text-sm font-bold tabular-nums">{(activity?.lifetime_deals ?? 0).toLocaleString()}</p>
              </div>
              <div className="rounded-lg border border-border bg-card/60 p-2.5">
                <div className="flex items-center gap-1.5 mb-1">
                  <Users className="h-3 w-3 text-violet-500" />
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Downline</span>
                </div>
                <p className="text-sm font-bold tabular-nums">{(activity?.downline_count ?? 0).toLocaleString()}</p>
              </div>
            </div>

            {/* MP-268 · Book quality + estimated earnings.
                Volume hides the truth: an agent can write 120 deals and keep 38%
                while another writes 75 and keeps 81%. This shows what the book is
                actually made of. Earnings are an ESTIMATE (premium x contract %) —
                there is no payout feed, so it is never presented as settled money. */}
            {quality && qnum(quality.deals_total) ? (
              <div className="rounded-lg border border-border bg-card/60 p-3">
                <div className="mb-1 flex items-baseline justify-between gap-2">
                  <h3 className="text-xs font-bold uppercase tracking-wide">Book quality</h3>
                  <span className="text-[10px] text-muted-foreground tabular-nums">
                    {qnum(quality.deals_total)?.toLocaleString()} deals
                  </span>
                </div>
                <p className="mb-3 text-[11px] leading-relaxed text-muted-foreground">
                  What this agent's book is made of — how much of it sticks, and how much never issued.
                </p>

                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <div className="min-w-0 rounded-lg border border-border bg-background p-2.5">
                    <div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Persistency</div>
                    <p className={
                      "mt-1 text-lg font-bold leading-none tabular-nums " +
                      ((qnum(quality.persistency_pct) ?? 0) >= 70
                        ? "text-emerald-600 dark:text-emerald-400"
                        : (qnum(quality.persistency_pct) ?? 0) >= 50
                          ? "text-amber-600 dark:text-amber-400"
                          : "text-rose-600 dark:text-rose-400")
                    }>
                      {qnum(quality.persistency_pct) !== null ? `${qnum(quality.persistency_pct)}%` : "—"}
                    </p>
                    <div className="mt-0.5 text-[10px] text-muted-foreground tabular-nums">
                      {qnum(quality.in_force) ?? 0} in force · {qnum(quality.lapsed) ?? 0} lapsed
                    </div>
                  </div>

                  <div className="min-w-0 rounded-lg border border-border bg-background p-2.5">
                    <div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Avg deal</div>
                    <p className="mt-1 text-lg font-bold leading-none tabular-nums text-foreground">
                      {qnum(quality.avg_deal_alp) !== null ? fmtUSD(qnum(quality.avg_deal_alp)) : "—"}
                    </p>
                    <div className="mt-0.5 text-[10px] text-muted-foreground tabular-nums">
                      {qnum(quality.deals_30d) ?? 0} in 30d
                    </div>
                  </div>

                  <div className="min-w-0 rounded-lg border border-border bg-background p-2.5">
                    <div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Never issued</div>
                    <p className={
                      "mt-1 text-lg font-bold leading-none tabular-nums " +
                      ((qnum(quality.pct_never_issued) ?? 0) >= 15
                        ? "text-rose-600 dark:text-rose-400"
                        : "text-foreground")
                    }>
                      {qnum(quality.pct_never_issued) !== null ? `${qnum(quality.pct_never_issued)}%` : "—"}
                    </p>
                    <div className="mt-0.5 text-[10px] text-muted-foreground">declined · withdrawn · NTO</div>
                  </div>

                  <div className="min-w-0 rounded-lg border border-border bg-background p-2.5">
                    <div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Top carrier</div>
                    <p className="mt-1 truncate text-sm font-bold leading-tight text-foreground">
                      {quality.top_carrier ?? "—"}
                    </p>
                    <div className={
                      "mt-0.5 text-[10px] tabular-nums " +
                      ((qnum(quality.top_carrier_share_pct) ?? 0) >= 60
                        ? "text-amber-600 dark:text-amber-400"
                        : "text-muted-foreground")
                    }>
                      {qnum(quality.top_carrier_share_pct) !== null
                        ? `${qnum(quality.top_carrier_share_pct)}% of book`
                        : ""}
                      {(qnum(quality.carriers_used) ?? 0) > 0 ? ` · ${qnum(quality.carriers_used)} carriers` : ""}
                    </div>
                  </div>
                </div>

                {/* Full carrier mix. "Top carrier" answers whether they are concentrated;
                    this answers where the rest of the book actually sits, which is what Sam
                    asked for. The in-force column is the payoff — it exposes a carrier an
                    agent writes heavily that never issues (Aisha Kebbeh: 30 Foresters
                    policies, $37.5K ALP, 0 in force). */}
                {carrierMix && carrierMix.length > 0 && (
                  <div className="mt-3 rounded-lg border border-border bg-background p-2.5">
                    <div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                      Carrier mix
                    </div>
                    <ul className="mt-1.5 space-y-1">
                      {carrierMix.slice(0, 6).map((c) => {
                        const pct = qnum(c.pct_of_policies) ?? 0;
                        const inForce = qnum(c.in_force) ?? 0;
                        const pols = qnum(c.policies) ?? 0;
                        const noneIssued = pols >= 5 && inForce === 0;
                        return (
                          <li key={c.carrier ?? "unknown"} className="min-w-0">
                            <div className="flex items-baseline justify-between gap-2 text-xs">
                              <span className="truncate text-foreground">{c.carrier ?? "—"}</span>
                              <span className="shrink-0 tabular-nums text-muted-foreground">
                                {pols} · {fmtUSD(qnum(c.alp))}
                              </span>
                            </div>
                            <div className="mt-0.5 flex items-center gap-2">
                              <div className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
                                <div
                                  className="h-full rounded-full bg-primary"
                                  style={{ width: `${Math.min(100, pct)}%` }}
                                />
                              </div>
                              <span
                                className={
                                  "shrink-0 text-[10px] tabular-nums " +
                                  (noneIssued
                                    ? "text-rose-600 dark:text-rose-400"
                                    : "text-muted-foreground")
                                }
                              >
                                {noneIssued ? `${pols} written, 0 in force` : `${inForce} in force`}
                              </span>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}

                {earnings && (
                  <div className="mt-3 rounded-lg border border-border bg-background p-2.5">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                        Estimated earnings
                      </span>
                      <span className="text-[10px] text-muted-foreground tabular-nums">
                        contract {qnum(earnings.contract_pct) ?? "—"}%
                      </span>
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-baseline gap-x-4 gap-y-1">
                      <span className="text-lg font-bold leading-none tabular-nums text-foreground">
                        {fmtUSD(qnum(earnings.est_earned_in_force))}
                      </span>
                      <span className="text-[11px] text-muted-foreground">earned on in-force</span>
                      <span className="text-sm font-bold leading-none tabular-nums text-amber-600 dark:text-amber-400">
                        {fmtUSD(qnum(earnings.est_pending_if_issued))}
                      </span>
                      <span className="text-[11px] text-muted-foreground">pending if it issues</span>
                    </div>
                    <p className="mt-1.5 text-[10px] leading-snug text-muted-foreground">
                      Estimate — annual premium x contract %. There is no payout feed, so this is not settled money.
                    </p>
                  </div>
                )}
              </div>
            ) : null}

            {/* Call Notes Timeline — Sam directive 2026-06-16 voice:
                "notes from the call." Merges call_activity + agent_notes via
                agent_call_activity(uuid) RPC. Stays empty-graceful so the
                drawer never crashes when the timeline is empty. */}
            <div className="rounded-lg border border-border bg-card/60 p-3">
              <div className="flex items-center gap-2 mb-2">
                <MessageCircle className="h-3.5 w-3.5 text-amber-500" />
                <h3 className="text-xs font-bold uppercase tracking-wide">Call notes timeline</h3>
                {(timeline?.length ?? 0) > 0 && (
                  <Badge variant="outline" className="text-[10px] ml-auto">
                    {timeline?.length ?? 0}
                  </Badge>
                )}
              </div>
              {!timeline || timeline.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">
                  No calls or notes logged yet.
                </p>
              ) : (
                <ul className="space-y-2 max-h-72 overflow-y-auto pr-1">
                  {timeline.slice(0, 6).map((row) => (
                    <li
                      key={`${row.source}-${row.id}`}
                      className="rounded-md border border-border/60 bg-background/40 p-2 text-xs"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <Badge
                            variant="outline"
                            className={cn(
                              "text-[9px] uppercase tracking-wide shrink-0",
                              row.source === "call"
                                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                                : "border-info/30 bg-info/10 text-info dark:text-info",
                            )}
                          >
                            {row.source === "call" ? "call" : "note"}
                          </Badge>
                          {row.outcome && (
                            <span className="text-[10px] font-semibold truncate">{row.outcome}</span>
                          )}
                        </div>
                        <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
                          {fmtRelative(row.occurred_at)}
                        </span>
                      </div>
                      {row.notes && (
                        <p className="mt-1 text-[11px] text-muted-foreground line-clamp-3">{row.notes}</p>
                      )}
                      <p className="mt-1 text-[10px] text-muted-foreground/70">
                        by {row.logged_by_name ?? "—"}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* 2026-07-01 PL-MP231. Full-control admin block. Sam directive:
                "once hired I have full control of their account". Deactivate
                soft-deletes (via existing DeactivateAgentDialog which zeros
                downline links + closes tickets). Restore un-flags. Delete
                (hard) is bot-sql only and never wired to UI. Surfaced as an
                inline note so Sam knows the exact incantation. */}
            {isAdmin && (
              <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <ShieldAlert className="h-3.5 w-3.5 text-red-500" />
                  <h3 className="text-xs font-bold uppercase tracking-wide text-red-500">Full control · admin</h3>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {agent.is_deactivated ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-9 gap-1.5 border-emerald-500/40 text-emerald-500 hover:bg-emerald-500/10"
                      onClick={async () => {
                        if (!agent?.id) return;
                        const ok = await askConfirm({
                          title: `Restore ${name}?`,
                          description: "They come back into the roster, deactivation reason and manager-switch pointer are cleared.",
                          confirmText: "Restore",
                        });
                        if (!ok) return;
                        // MP231-verify fix 2026-07-01: also clear deactivation_reason
                        // and switched_to_manager_id so downstream views/queries that
                        // filter on those don't treat a restored agent as still
                        // deactivated/switched. Without this the Restore was a
                        // half-flip — status flipped back but the reason ghost
                        // remained.
                        const { error } = await (supabase as any)
                          .from("agents")
                          .update({
                            is_deactivated: false,
                            is_inactive: false,
                            status: "active",
                            deactivation_reason: null,
                            switched_to_manager_id: null,
                            updated_at: new Date().toISOString(),
                          })
                          .eq("id", agent.id);
                        if (error) toast.error(`Restore failed: ${error.message.slice(0, 80)}`);
                        else {
                          toast.success(`✅ ${name} restored`);
                          qc.invalidateQueries({ queryKey: ["agent-profile-drawer"] });
                        }
                      }}
                      title="Restore this deactivated agent"
                    >
                      <UserCheck className="h-3.5 w-3.5" /> Restore
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-9 gap-1.5 border-amber-500/40 text-amber-500 hover:bg-amber-500/10"
                      onClick={() => setDeactivateOpen(true)}
                      title="Soft-delete: terminate, switch teams, or remove"
                    >
                      <UserX className="h-3.5 w-3.5" /> Deactivate
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-9 gap-1.5 border-red-500/40 text-red-500 hover:bg-red-500/10"
                    onClick={() => {
                      // Hard-delete requires bot-sql (guarded by service role +
                      // Sam's admin token). Never wired to the UI to prevent
                      // accidental prod nukes. Copy the exact SQL so Sam can
                      // paste-run from his admin machine.
                      const sql = `-- HARD DELETE agent ${agent.id} (${name})\n-- Run via bot-sql only — service role required.\nselect apex_admin_hard_delete_agent('${agent.id}');`;
                      copyToClipboard(sql, "Hard-delete SQL");
                      toast.warning("Hard delete = bot-sql only. SQL copied to clipboard.");
                    }}
                    title="Hard delete (bot-sql only). Copies the SQL to clipboard."
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Delete SQL
                  </Button>
                </div>
                <p className="text-[10px] text-muted-foreground leading-tight">
                  Deactivate = soft (reversible). Delete = hard (bot-sql only, irreversible). SQL copied to clipboard for Sam to run via admin RPC.
                </p>
              </div>
            )}

            <details className="rounded-xl border border-border bg-card/60">
              <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-xs font-bold uppercase tracking-wide">
                <ListTodo className="h-4 w-4 text-amber-500" /> Work assignments
              </summary>
              <div className="border-t border-border p-3">
                <AgentTaskManager agentFilter={agent.id} compact />
              </div>
            </details>

            {/* Credentials (admin only — the existing AgentCredentialsPanel
                already hides itself for non-admins). */}
            {isAdmin && (
              <AgentCredentialsPanel agentId={agent.id} agentName={name} agentEmail={email ?? ""} />
            )}

            {/* Notes */}
            <AgentNotes agentId={agent.id} onNoteAdded={() => {}} />
            {/* Bottom spacer so the sticky footer doesn't cover the last note. */}
            <div className="h-2" />
          </div>
        )}

        {/* 2026-06-18 Sam directive: 'I want all the UI perfect'.
            Sticky footer with the four actions Sam taps most: Call · Text ·
            CRM · Send Course (added 2026-06-18 to re-fire course/discord
            emails even if license is already set). Always visible. */}
        {agent && (
          <div className="border-t border-border bg-card/80 backdrop-blur-sm px-4 py-3 grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Button
              size="sm"
              className="h-9 gap-1.5"
              disabled={!phone}
              onClick={() => phone && (window.location.href = `tel:${phone}`)}
              title={phone ? `Call ${phone}` : "No phone on file"}
            >
              <Phone className="h-3.5 w-3.5" /> Call
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-9 gap-1.5"
              disabled={!phone}
              onClick={() => phone && (window.location.href = `sms:${phone}`)}
              title={phone ? `Text ${phone}` : "No phone on file"}
            >
              <MessageSquare className="h-3.5 w-3.5" /> Text
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-9 gap-1.5"
              onClick={() => {
                if (isAdmin) setQuickEditOpen(true);
                else {
                  close();
                  navigate(`/agent/${agent.id}`);
                }
              }}
              title={isAdmin ? "Manage login, email, password, profile and access" : "Open full CRM page"}
            >
              {isAdmin ? <KeyRound className="h-3.5 w-3.5" /> : <ExternalLink className="h-3.5 w-3.5" />}
              {isAdmin ? "Controls" : "CRM"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-9 gap-1.5 border-emerald-500/40 text-emerald-500 hover:bg-emerald-500/10"
              onClick={async () => {
                if (!agent?.id) return;
                try {
                  // 2026-07-01 PL-MP231 — also re-fire WhatsApp hired invite
                  // (hired_whatsapp email_kind) so the full onboarding trio
                  // (Course + Discord + WhatsApp) ships from one tap.
                  await (supabase as any)
                    .from("agent_onboarding_queue")
                    .upsert(
                      [
                        { agent_id: agent.id, email_kind: "course",          target_send_at: new Date().toISOString(), sent_at: null, attempt_count: 0, last_error: null },
                        { agent_id: agent.id, email_kind: "discord",         target_send_at: new Date().toISOString(), sent_at: null, attempt_count: 0, last_error: null },
                        { agent_id: agent.id, email_kind: "hired_whatsapp",  target_send_at: new Date().toISOString(), sent_at: null, attempt_count: 0, last_error: null },
                      ],
                      { onConflict: "agent_id,email_kind" },
                    );
                  const { data } = await supabase.functions.invoke("send-agent-onboarding-email", { body: {} });
                  const sent = (data as any)?.sent ?? 0;
                  toast.success(`Course + Discord + WhatsApp re-sent (${sent} delivered)`);
                } catch (e: any) {
                  toast.error(`Send failed: ${e?.message?.slice(0, 80) ?? "unknown"}`);
                }
              }}
              title="Re-fire course + Discord + WhatsApp onboarding emails (idempotent)"
            >
              <Mail className="h-3.5 w-3.5" /> Onboard
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
    </>
  );
}
