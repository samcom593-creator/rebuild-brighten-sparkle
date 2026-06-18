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

import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
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
  MessageCircle,
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
import { AgentOnboardingEmailStatus } from "@/components/dashboard/AgentOnboardingEmailStatus";
import { ReassignManagerButton } from "@/components/agents/ReassignManagerButton";
import { AgentCredentialsPanel } from "@/components/dashboard/AgentCredentialsPanel";
import { AgentNotes } from "@/components/dashboard/AgentNotes";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useAgentProfileDrawer } from "@/stores/agentProfileDrawer";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface AgentRow {
  id: string;
  user_id: string | null;
  agent_code: string | null;
  status: string | null;
  license_status: string | null;
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
    const diffMs = now - d.getTime();
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
    case "inactive":   return "bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/20";
    case "terminated": return "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20";
    case "pending":    return "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20";
    default:           return "bg-muted/50 text-muted-foreground border-border";
  }
}

export function AgentProfileDrawer() {
  const { isAdmin } = useAuth();
  const navigate = useNavigate();
  const agentId = useAgentProfileDrawer((s) => s.agentId);
  const close = useAgentProfileDrawer((s) => s.close);

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
        .from("agents")
        .select(
          `id, user_id, agent_code, status, license_status, start_date,
           total_policies, total_premium, total_earnings, manager_id,
           display_name, is_deactivated, is_inactive, onboarding_stage,
           first_deal_at, contracted_at,
           profile:profiles!agents_profile_id_fkey(full_name, email, phone, avatar_url),
           manager:agents!manager_id(id, profile:profiles(full_name))`,
        )
        .eq("id", agentId)
        .maybeSingle();
      if (error) {
        // 2026-06-16 Sam-feedback: search doesn't pull up profile. If RLS
        // or the embedded join breaks, surface it instead of silent-null.
        // eslint-disable-next-line no-console
        console.error("[AgentProfileDrawer] agent query failed", { agentId, error });
        toast.error(`Profile load failed: ${error.message?.slice(0, 80) ?? "unknown"}`);
        throw error;
      }
      if (!data) {
        // eslint-disable-next-line no-console
        console.warn("[AgentProfileDrawer] no agent row for id", agentId);
        toast.warning(`No agent row for id ${agentId.slice(0, 8)}…`);
      }
      return (data as any) ?? null;
    },
    staleTime: 30_000,
  });

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
        // eslint-disable-next-line no-console
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

  // Call notes timeline: merged call_activity + agent_notes via SECURITY INVOKER RPC.
  // Sam directive 2026-06-16 voice — "notes from the call" surfaced in profile.
  const { data: timeline } = useQuery<CallTimelineRow[]>({
    queryKey: ["agent-profile-drawer-timeline", agentId],
    enabled: !!agentId,
    queryFn: async () => {
      if (!agentId) return [];
      const { data, error } = await supabase.rpc("agent_call_activity" as any, { p_agent_id: agentId });
      if (error) {
        // eslint-disable-next-line no-console
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
            Deep profile view for the selected agent — license, training stage, contact, manager chain, credentials, notes.
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
                <h2 className="text-lg font-bold leading-tight truncate">{name}</h2>
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
                    {agent.status ?? "—"}
                  </Badge>
                  {isLicensed ? (
                    <Badge variant="outline" className="text-[10px] bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20">
                      <ShieldCheck className="h-3 w-3 mr-0.5" /> licensed
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-[10px] bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20">
                      <ShieldAlert className="h-3 w-3 mr-0.5" /> {agent.license_status ?? "unlicensed"}
                    </Badge>
                  )}
                  {agent.is_deactivated && (
                    <Badge variant="outline" className="text-[10px] bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20">deactivated</Badge>
                  )}
                </div>
              </div>
            </div>

            {/* 2026-06-18 — pace verdict from v_agent_20k_target_leaderboard.
                Instant visual: 🔥 hit_20k · 📈 on_pace_20k · 📉 below_pace ·
                🆕 new_hire_grace · 😴 zero_mtd. */}
            {pace && pace.pace_verdict && (
              <div className={cn(
                "rounded-full border px-3 py-2 flex items-center justify-between gap-2 text-xs",
                pace.pace_verdict === "hit_20k" && "border-emerald-500/40 bg-emerald-500/10 text-emerald-500",
                pace.pace_verdict === "on_pace_20k" && "border-sky-500/40 bg-sky-500/10 text-sky-500",
                pace.pace_verdict === "below_pace" && "border-amber-500/40 bg-amber-500/10 text-amber-500",
                pace.pace_verdict === "new_hire_grace" && "border-slate-500/40 bg-slate-500/10 text-slate-400",
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
                <p className="text-[10px] uppercase tracking-wider text-sky-500/80 font-semibold flex items-center gap-1">
                  <Users className="h-2.5 w-2.5" /> Legs
                </p>
                <p className="mt-1 text-3xl font-black tabular-nums leading-none text-sky-500 dark:text-sky-400">
                  {(monthly?.legs ?? 0).toLocaleString()}
                </p>
                <p className="mt-1 text-[10px] text-muted-foreground">downline</p>
              </div>
            </div>

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
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
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
            </div>

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
                  <Calendar className="h-3 w-3 text-sky-500" />
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
                                : "border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-sky-400",
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
            Sticky footer with the three actions Sam taps most: Call · Text ·
            Open in CRM. Always visible regardless of scroll depth. */}
        {agent && (
          <div className="border-t border-border bg-card/80 backdrop-blur-sm px-4 py-3 flex gap-2">
            <Button
              size="sm"
              className="flex-1 h-9 gap-1.5"
              disabled={!phone}
              onClick={() => phone && (window.location.href = `tel:${phone}`)}
              title={phone ? `Call ${phone}` : "No phone on file"}
            >
              <Phone className="h-3.5 w-3.5" /> Call
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="flex-1 h-9 gap-1.5"
              disabled={!phone}
              onClick={() => phone && (window.location.href = `sms:${phone}`)}
              title={phone ? `Text ${phone}` : "No phone on file"}
            >
              <MessageSquare className="h-3.5 w-3.5" /> Text
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="flex-1 h-9 gap-1.5"
              onClick={() => {
                close();
                navigate(`/agent/${agent.id}`);
              }}
              title="Open full CRM page"
            >
              <ExternalLink className="h-3.5 w-3.5" /> CRM
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
