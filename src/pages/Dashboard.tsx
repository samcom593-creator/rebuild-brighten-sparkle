import { useMemo, useState, type ElementType } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Bell,
  Briefcase,
  CalendarDays,
  CheckCircle2,
  CreditCard,
  Database,
  DollarSign,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Target,
  Users,
  Zap,
} from "lucide-react";

import AgentCommandDashboard from "@/pages/AgentCommandDashboard";
import { UnclaimedLeadsCommandCard } from "@/components/dashboard/UnclaimedLeadsCommandCard";
import { XcelStalledCard } from "@/components/dashboard/XcelStalledCard";
import { WhatShippedTodayBanner } from "@/components/dashboard/WhatShippedTodayBanner";
import { LicensedHiresRange } from "@/components/dashboard/LicensedHiresRange";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageLoadingSkeleton } from "@/components/ui/page-loading-skeleton";
import { PageHeader } from "@/components/ui/page-header";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useMyDownline } from "@/hooks/useMyDownline";
import { useRolePreview, type RolePreview } from "@/hooks/useRolePreview";
import { getBusinessDayBounds, getBusinessMonthBounds, getBusinessWeekBounds, getMatchedPriorWeekBounds } from "@/lib/dateUtils";
import { DEAL_TRUTH_STATUS_FILTER, dealTruthWindowOr, liveDealWindowOr } from "@/lib/dealTruth";
import { getCloseRate, getLiveAgentCutoffIso, LIVE_AGENT_DEAL_WINDOW_DAYS, sumAnnualPremium } from "@/lib/metricTruth";
import { cn } from "@/lib/utils";

type IntegrationState = "ok" | "warning" | "critical" | "unavailable";

interface DashboardSnapshot {
  scopeLabel: string;
  sourceGeneratedAt: string;
  production: {
    todayAlp: number;
    todayDeals: number;
    weekAlp: number;
    weekDeals: number;
    monthAlp: number;
    monthDeals: number;
    previousWeekAlp: number;
    liveAgents: number;
    presentationsWeek: number;
    hoursWeek: number;
    closeRate: number;
  };
  recruiting: {
    applicants: number;
    contacted: number;
    booked: number;
    seminarAttended: number;
    noShow: number;
    advanced: number;
    icaSent: number;
    licensed: number;
    contracted: number;
    activated: number;
    firstSale: number;
  };
  referrals: {
    caught: number;
    presentations: number;
    bookedInHome: number;
  };
  stripe: {
    confirmedPurchases: number;
    pendingRequests: number;
    revenueCents: number;
    lastChargeAt: string | null;
  };
  readyMode: {
    available: number | null;
    manualCounter: number | null;
    source: string;
    updatedAt: string | null;
    state: IntegrationState;
  };
  agentLink: {
    status: string | null;
    lastSyncAt: string | null;
    policiesSeen: number;
    dealsInserted: number;
    dealsUpdated: number;
    error: string | null;
    state: IntegrationState;
  };
  system: {
    status: string | null;
    checkedAt: string | null;
    critical: number;
    warnings: number;
  };
}

interface CurrentAgent {
  id: string;
  display_name: string | null;
}

function money(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function number(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function percent(value: number): string {
  return `${Math.round(value)}%`;
}

function parseCount(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function minutesSince(iso: string | null): number | null {
  if (!iso) return null;
  const time = new Date(iso).getTime();
  if (!Number.isFinite(time)) return null;
  return Math.round((Date.now() - time) / 60_000);
}

function ageLabel(iso: string | null): string {
  const mins = minutesSince(iso);
  if (mins === null) return "Never";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

async function getRows<T = any>(builder: any, label: string): Promise<T[]> {
  if (!builder) return [];
  const { data, error } = await builder;
  if (error) {
    console.warn(`[dashboard:${label}]`, error);
    return [];
  }
  return (data ?? []) as T[];
}

async function getOne<T = any>(builder: any, label: string): Promise<T | null> {
  if (!builder) return null;
  const { data, error } = await builder;
  if (error) {
    console.warn(`[dashboard:${label}]`, error);
    return null;
  }
  return (data ?? null) as T | null;
}

function applyAgentScope(builder: any, agentIds: string[] | undefined) {
  if (!agentIds) return builder;
  if (agentIds.length === 0) return null;
  return builder.in("agent_id", agentIds);
}

function isAdvancedApplication(app: any): boolean {
  return Boolean(
    app.qualified_at ||
    app.reviewed_at ||
    ["reviewing", "interview", "contracting", "approved"].includes(app.status),
  );
}

function isLicensedApplication(app: any): boolean {
  return app.licensed_at || app.license_status === "licensed" || app.license_progress === "licensed";
}

function isContractedApplication(app: any): boolean {
  return app.contracted_at || app.status === "approved";
}

async function loadApplications(role: RolePreview, userId: string, scopedAgentIds: string[]): Promise<any[]> {
  const q: any = supabase;
  if (role === "admin") {
    return getRows(q.from("applications").select("*").is("terminated_at", null).limit(2_000), "applications-admin");
  }

  const visibleViaView = await getRows(
    q.from("v_my_applications").select("*").is("terminated_at", null).limit(2_000),
    "visible-applications-view",
  );
  if (visibleViaView.length > 0) return visibleViaView;
  if (scopedAgentIds.length === 0) return [];

  const filters = scopedAgentIds.flatMap((agentId) => [
    `assigned_agent_id.eq.${agentId}`,
    `recruiter_id.eq.${agentId}`,
    `referral_manager_id.eq.${agentId}`,
  ]);
  filters.push(`hiring_manager_user_id.eq.${userId}`);

  return getRows(
    q.from("applications").select("*").is("terminated_at", null).or(filters.join(",")).limit(2_000),
    "applications-scoped-fallback",
  );
}

async function loadDashboardSnapshot(
  role: RolePreview,
  userId: string,
  scopedAgentIds: string[] | undefined,
): Promise<DashboardSnapshot> {
  const q: any = supabase;
  const day = getBusinessDayBounds();
  const week = getBusinessWeekBounds();
  const month = getBusinessMonthBounds();
  const priorWeek = getMatchedPriorWeekBounds();
  const agentScope = role === "admin" ? undefined : scopedAgentIds ?? [];
  const scopeLabel = role === "admin" ? "Agency" : role === "manager" ? "Manager downline" : "Agent";

  const dealQuery = (windowOr: string) =>
    applyAgentScope(
      q.from("deals")
        .select("agent_id, annual_premium, posted_at, created_at")
        .or(windowOr)
        .in("status", DEAL_TRUTH_STATUS_FILTER),
      agentScope,
    );

  const productionQuery = applyAgentScope(
    q.from("daily_production")
      .select("agent_id, presentations, hours_called, referrals_caught, referral_presentations, booked_inhome_referrals, production_date")
      .gte("production_date", week.startIso.slice(0, 10))
      .lt("production_date", day.endIso.slice(0, 10)),
    agentScope,
  );

  const applications = await loadApplications(role, userId, agentScope ?? []);
  const applicationIds = new Set(applications.map((app) => app.id).filter(Boolean));
  const applicationEmails = new Set(
    applications
      .map((app) => String(app.email ?? "").toLowerCase())
      .filter(Boolean),
  );

  const interviewQuery = role === "admin" || applicationIds.size > 0
    ? q.from("scheduled_interviews")
        .select("*")
        .gte("interview_date", week.startIso)
        .limit(2_000)
    : null;

  const scopedInterviewQuery = role === "admin" || !interviewQuery
    ? interviewQuery
    : interviewQuery.in("application_id", Array.from(applicationIds));

  const [
    todayDeals,
    weekDeals,
    monthDeals,
    priorWeekDeals,
    liveDeals,
    productionRows,
    scheduledInterviews,
    seminarRowsRaw,
    purchaseRequests,
    leadPurchases,
    agentLinkRow,
    readySettings,
    leadCounterRows,
    healthRow,
  ] = await Promise.all([
    getRows(dealQuery(dealTruthWindowOr(day.startIso, day.endIso)), "today-deals"),
    getRows(dealQuery(dealTruthWindowOr(week.startIso, week.endIso)), "week-deals"),
    getRows(dealQuery(dealTruthWindowOr(month.startIso, month.endIso)), "month-deals"),
    getRows(dealQuery(dealTruthWindowOr(priorWeek.startIso, priorWeek.endIso)), "prior-week-deals"),
    getRows(
      applyAgentScope(
        q.from("deals")
          .select("agent_id, annual_premium, posted_at, created_at")
          .or(liveDealWindowOr(getLiveAgentCutoffIso()))
          .in("status", DEAL_TRUTH_STATUS_FILTER),
        agentScope,
      ),
      "live-deals",
    ),
    getRows(productionQuery, "daily-production-week"),
    getRows(scopedInterviewQuery, "scheduled-interviews"),
    getRows(q.from("seminar_registrations").select("*").limit(2_000), "seminar-registrations"),
    getRows(
      applyAgentScope(
        q.from("lead_purchase_requests").select("*").order("requested_at", { ascending: false }).limit(500),
        agentScope,
      ),
      "lead-purchase-requests",
    ),
    getRows(
      applyAgentScope(
        q.from("lead_purchases").select("*").gte("charged_at", month.startIso).order("charged_at", { ascending: false }).limit(500),
        agentScope,
      ),
      "lead-purchases",
    ),
    // Canonical sync health — coalesces cookie + API transports for AgentLink
    // and surfaces is_partial / action_required. Was reading agentlink_sync_log
    // directly which only showed the cookie path and made dead cookies look
    // like dead data.
    getOne(q.rpc("sync_health_summary").maybeSingle(), "sync-health-summary"),
    getRows(
      q.from("system_settings")
        .select("key, value, updated_at")
        .in("key", ["readymode_available_leads", "readymode_inventory_count", "readymode_inventory_updated_at"])
        .limit(10),
      "readymode-settings",
    ),
    getRows(q.from("lead_counter").select("count, updated_at").limit(1), "lead-counter"),
    getOne(
      q.from("system_health_logs")
        .select("overall_status, checked_at, critical_count, warning_count")
        .order("checked_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      "system-health",
    ),
  ]);

  const seminarRows = role === "admin"
    ? seminarRowsRaw
    : seminarRowsRaw.filter((row: any) => applicationEmails.has(String(row.email ?? "").toLowerCase()));

  const weekProduction = productionRows as Array<{
    presentations?: number | null;
    hours_called?: number | null;
    referrals_caught?: number | null;
    referral_presentations?: number | null;
    booked_inhome_referrals?: number | null;
  }>;

  const settingsMap = new Map((readySettings as any[]).map((row) => [row.key, row]));
  const readyCount = parseCount(settingsMap.get("readymode_available_leads")?.value ?? settingsMap.get("readymode_inventory_count")?.value);
  const readyUpdatedAt = settingsMap.get("readymode_inventory_updated_at")?.value ?? settingsMap.get("readymode_available_leads")?.updated_at ?? null;
  const manualCounter = parseCount((leadCounterRows as any[])[0]?.count);
  const manualCounterUpdatedAt = (leadCounterRows as any[])[0]?.updated_at ?? null;

  const syncAt = (agentLinkRow as any)?.finished_at ?? (agentLinkRow as any)?.started_at ?? null;
  const syncAge = minutesSince(syncAt);
  const agentLinkState: IntegrationState = !(agentLinkRow as any)
    ? "unavailable"
    : (agentLinkRow as any).status !== "ok"
      ? "critical"
      : syncAge !== null && syncAge > 6 * 60
        ? "warning"
        : "ok";

  const confirmedRequests = (purchaseRequests as any[]).filter((row) =>
    ["confirmed", "paid", "completed", "succeeded"].includes(String(row.status ?? "").toLowerCase()),
  );
  const pendingRequests = (purchaseRequests as any[]).filter((row) =>
    ["pending", "requested", "processing"].includes(String(row.status ?? "pending").toLowerCase()),
  );

  return {
    scopeLabel,
    sourceGeneratedAt: new Date().toISOString(),
    production: {
      todayAlp: sumAnnualPremium(todayDeals),
      todayDeals: todayDeals.length,
      weekAlp: sumAnnualPremium(weekDeals),
      weekDeals: weekDeals.length,
      monthAlp: sumAnnualPremium(monthDeals),
      monthDeals: monthDeals.length,
      previousWeekAlp: sumAnnualPremium(priorWeekDeals),
      liveAgents: new Set((liveDeals as any[]).map((row) => row.agent_id).filter(Boolean)).size,
      presentationsWeek: weekProduction.reduce((sum, row) => sum + Number(row.presentations ?? 0), 0),
      hoursWeek: weekProduction.reduce((sum, row) => sum + Number(row.hours_called ?? 0), 0),
      closeRate: getCloseRate(weekDeals.length, weekProduction.reduce((sum, row) => sum + Number(row.presentations ?? 0), 0)),
    },
    recruiting: {
      applicants: applications.length,
      contacted: applications.filter((app) => app.contacted_at || app.last_contacted_at || app.first_contact_attempt_at).length,
      booked: (scheduledInterviews as any[]).filter((row) => !["cancelled", "no_show"].includes(String(row.status ?? "").toLowerCase())).length,
      seminarAttended: (seminarRows as any[]).filter((row) => row.attended === true).length,
      noShow: (seminarRows as any[]).filter((row) => row.attended === false).length,
      advanced: applications.filter(isAdvancedApplication).length,
      icaSent: applications.filter((app) => app.status === "contracting" || app.status === "approved" || app.contracted_at).length,
      licensed: applications.filter(isLicensedApplication).length,
      contracted: applications.filter(isContractedApplication).length,
      activated: applications.filter((app) => app.first_deal_at || app.start_date).length,
      firstSale: applications.filter((app) => app.first_deal_at).length,
    },
    referrals: {
      caught: weekProduction.reduce((sum, row) => sum + Number(row.referrals_caught ?? 0), 0),
      presentations: weekProduction.reduce((sum, row) => sum + Number(row.referral_presentations ?? 0), 0),
      bookedInHome: weekProduction.reduce((sum, row) => sum + Number(row.booked_inhome_referrals ?? 0), 0),
    },
    stripe: {
      confirmedPurchases: confirmedRequests.length + (leadPurchases as any[]).length,
      pendingRequests: pendingRequests.length,
      revenueCents: (leadPurchases as any[]).reduce((sum, row) => sum + Number(row.amount_cents ?? 0), 0),
      lastChargeAt: (leadPurchases as any[])[0]?.charged_at ?? null,
    },
    readyMode: {
      available: readyCount,
      manualCounter,
      source: readyCount === null ? "ReadyMode inventory unavailable" : "system_settings.readymode_available_leads",
      updatedAt: readyUpdatedAt || manualCounterUpdatedAt || null,
      state: readyCount === null ? (manualCounter === null ? "unavailable" : "warning") : "ok",
    },
    agentLink: {
      status: (agentLinkRow as any)?.status ?? null,
      lastSyncAt: syncAt,
      policiesSeen: Number((agentLinkRow as any)?.policies_seen ?? 0),
      dealsInserted: Number((agentLinkRow as any)?.deals_inserted ?? 0),
      dealsUpdated: Number((agentLinkRow as any)?.deals_updated ?? 0),
      error: (agentLinkRow as any)?.error_message ?? null,
      state: agentLinkState,
    },
    system: {
      status: (healthRow as any)?.overall_status ?? null,
      checkedAt: (healthRow as any)?.checked_at ?? null,
      critical: Number((healthRow as any)?.critical_count ?? 0),
      warnings: Number((healthRow as any)?.warning_count ?? 0),
    },
  };
}

function useCurrentAgent(userId: string | undefined) {
  return useQuery({
    queryKey: ["current-agent-for-dashboard", userId],
    queryFn: async (): Promise<CurrentAgent | null> => {
      if (!userId) return null;
      const { data, error } = await supabase
        .from("agents")
        .select("id, display_name")
        .eq("user_id", userId)
        .maybeSingle();
      if (error) {
        console.warn("[dashboard:current-agent]", error);
        return null;
      }
      return data;
    },
    enabled: Boolean(userId),
    staleTime: 5 * 60_000,
  });
}

function StateBadge({ state }: { state: IntegrationState }) {
  const label = state === "ok" ? "Live" : state === "warning" ? "Review" : state === "critical" ? "Broken" : "Unavailable";
  return (
    <Badge
      variant={state === "critical" ? "destructive" : state === "ok" ? "default" : "outline"}
      className={cn(state === "warning" && "border-amber-400/50 text-amber-600")}
    >
      {label}
    </Badge>
  );
}

function StatTile({
  icon: Icon,
  label,
  value,
  detail,
  tone = "default",
}: {
  icon: ElementType;
  label: string;
  value: string;
  detail: string;
  tone?: "default" | "success" | "warning";
}) {
  // 2026-grade hero tiles: subtle gradient background, soft border, larger
  // typography, icon in a glassmorphic pill. Tone changes the gradient
  // color and icon accent.
  const gradient =
    tone === "success"
      ? "from-emerald-500/15 via-emerald-500/5 to-transparent border-emerald-500/30"
      : tone === "warning"
        ? "from-amber-500/15 via-amber-500/5 to-transparent border-amber-500/30"
        : "from-primary/15 via-primary/5 to-transparent border-primary/25";
  const iconBg =
    tone === "success"
      ? "bg-emerald-500/15 text-emerald-400 ring-emerald-500/30"
      : tone === "warning"
        ? "bg-amber-500/15 text-amber-400 ring-amber-500/30"
        : "bg-primary/15 text-primary ring-primary/30";
  return (
    <Card className={cn("rounded-xl overflow-hidden bg-gradient-to-br border", gradient)}>
      <CardContent className="p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{label}</p>
            <p className="mt-2 text-3xl font-bold tracking-tight tabular-nums">{value}</p>
            <p className="mt-1.5 text-xs text-muted-foreground leading-snug">{detail}</p>
          </div>
          <div className={cn("rounded-lg p-2.5 ring-1", iconBg)}>
            <Icon className="h-4 w-4" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function IntegrationCard({
  icon: Icon,
  title,
  value,
  detail,
  state,
  href,
}: {
  icon: ElementType;
  title: string;
  value: string;
  detail: string;
  state: IntegrationState;
  href: string;
}) {
  return (
    <Card className="rounded-lg">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Icon className="h-4 w-4 text-muted-foreground" />
              <p className="truncate text-sm font-semibold">{title}</p>
            </div>
            <p className="mt-3 text-xl font-bold">{value}</p>
            <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{detail}</p>
          </div>
          <StateBadge state={state} />
        </div>
        <Button asChild variant="ghost" size="sm" className="mt-3 h-8 px-0 text-xs">
          <Link to={href}>
            Open <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

function RecruitingGrid({ stats }: { stats: DashboardSnapshot["recruiting"] }) {
  // PL-020: Licensed is now a date-range-aware tile (default this-month).
  // Every other tile stays the all-time count because that's what they
  // represent in the source rollup.
  const rows = [
    ["Applicants", stats.applicants],
    ["Contacted", stats.contacted],
    ["Booked", stats.booked],
    ["Seminar attended", stats.seminarAttended],
    ["No-show", stats.noShow],
    ["Advanced", stats.advanced],
    ["Contract sent", stats.icaSent],
    ["Contracted", stats.contracted],
    ["Activated", stats.activated],
    ["First sale", stats.firstSale],
  ];

  return (
    <Card className="rounded-lg">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Target className="h-4 w-4 text-primary" />
          Recruiting Pipeline
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          <LicensedHiresRange />
          {rows.map(([label, value]) => (
            <div key={label} className="rounded-lg border border-border/70 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
              <p className="mt-1 text-xl font-bold">{number(Number(value))}</p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function WeekProductionCard({ snapshot }: { snapshot: DashboardSnapshot }) {
  const hasWeekProduction = snapshot.production.weekDeals > 0 || snapshot.production.weekAlp > 0 || snapshot.production.presentationsWeek > 0;
  const change = snapshot.production.previousWeekAlp > 0
    ? ((snapshot.production.weekAlp - snapshot.production.previousWeekAlp) / snapshot.production.previousWeekAlp) * 100
    : null;

  return (
    <Card className="rounded-lg">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <BarChart3 className="h-4 w-4 text-primary" />
          Week in Agency Production
        </CardTitle>
      </CardHeader>
      <CardContent>
        {hasWeekProduction ? (
          <div className="grid gap-4 md:grid-cols-4">
            <div>
              <p className="text-xs text-muted-foreground">ALP posted this week</p>
              <p className="mt-1 text-3xl font-bold">{money(snapshot.production.weekAlp)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Deals posted</p>
              <p className="mt-1 text-3xl font-bold">{number(snapshot.production.weekDeals)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Presentations logged</p>
              <p className="mt-1 text-3xl font-bold">{number(snapshot.production.presentationsWeek)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Vs prior matched week</p>
              <p className={cn("mt-1 text-3xl font-bold", change !== null && change < 0 ? "text-amber-600" : "text-emerald-600")}>
                {change === null ? "N/A" : percent(change)}
              </p>
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-border p-5">
            <div className="flex gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 text-amber-500" />
              <div>
                <p className="font-semibold">No posted production found for this scope this week.</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  This panel is no longer blank. It reads valid deals from `deals.posted_at` and presentations from `daily_production`; zero means no trusted records are visible to this role.
                </p>
              </div>
            </div>
          </div>
        )}
        <p className="mt-4 text-xs text-muted-foreground">
          Source: deals.status in submitted/active filters, posted_at in America/Chicago business windows. Presentations remain manual `daily_production` input.
        </p>
      </CardContent>
    </Card>
  );
}

function ExecutiveDashboard({
  role,
  snapshot,
  onRunSystemCheck,
  runningSystemCheck,
}: {
  role: RolePreview;
  snapshot: DashboardSnapshot;
  onRunSystemCheck: () => Promise<void>;
  runningSystemCheck: boolean;
}) {
  const title = role === "admin" ? "Apex Financial" : "Manager Command";
  const readyValue = snapshot.readyMode.available === null ? "Unavailable" : number(snapshot.readyMode.available);
  const readyDetail = snapshot.readyMode.available === null
    ? snapshot.readyMode.manualCounter === null
      ? "No ReadyMode inventory setting is configured."
      : `Manual lead counter ${number(snapshot.readyMode.manualCounter)} is shown only as unverified fallback.`
    : `Updated ${ageLabel(snapshot.readyMode.updatedAt)} from ReadyMode inventory setting.`;

  return (
    <div className="space-y-6 pb-8 lg:pr-[18rem]">
      <PageHeader
        accent="primary"
        eyebrow={role === "admin" ? "Apex Financial · CEO Command" : "Manager · Command"}
        eyebrowIcon={<ShieldCheck className="h-3 w-3" />}
        title={title}
        subtitle="Production, recruiting, lead inventory, Stripe, and integration state — every number sourced from live tables, with explicit unavailable states instead of filler."
        actions={
          <>
            <Badge variant="outline" className="text-xs">{snapshot.scopeLabel}</Badge>
            <Badge variant="secondary" className="text-xs">Generated {ageLabel(snapshot.sourceGeneratedAt)}</Badge>
            <Button onClick={onRunSystemCheck} disabled={runningSystemCheck} size="sm">
              {runningSystemCheck ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              Run System Check
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link to="/numbers">
                Log Numbers <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </>
        }
      />

      {/* Pinned receipts banner — what shipped to the platform between
          this login and the last one. Sam reported "everything looks the
          same" despite 24+ commits; this makes the delta impossible to miss. */}
      <WhatShippedTodayBanner />

      {/* Funnel-leak command row — biggest two leaks live in one strip
          at the top of every admin dashboard load: unclaimed applicants
          (recruiting side) + stalled XCEL students (licensing side). */}
      <div className="grid gap-4 xl:grid-cols-2">
        <UnclaimedLeadsCommandCard />
        <XcelStalledCard />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile icon={DollarSign} label="Today ALP" value={money(snapshot.production.todayAlp)} detail={`${number(snapshot.production.todayDeals)} posted deals today`} />
        <StatTile icon={BarChart3} label="Week ALP" value={money(snapshot.production.weekAlp)} detail={`${number(snapshot.production.weekDeals)} deals this business week`} />
        <StatTile icon={Activity} label={`Live agents (${LIVE_AGENT_DEAL_WINDOW_DAYS}d)`} value={number(snapshot.production.liveAgents)} detail="At least one valid posted deal in live window" />
        <StatTile icon={CheckCircle2} label="Close rate" value={percent(snapshot.production.closeRate)} detail={`${number(snapshot.production.presentationsWeek)} presentations logged`} tone="success" />
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <IntegrationCard
          icon={Database}
          title="AgentLink"
          value={snapshot.agentLink.status ?? "No sync"}
          detail={`${number(snapshot.agentLink.policiesSeen)} policies seen · ${number(snapshot.agentLink.dealsInserted + snapshot.agentLink.dealsUpdated)} deal writes · ${ageLabel(snapshot.agentLink.lastSyncAt)}`}
          state={snapshot.agentLink.state}
          href="/dashboard/agentlink-sync"
        />
        <IntegrationCard
          icon={Zap}
          title="ReadyMode Inventory"
          value={readyValue}
          detail={readyDetail}
          state={snapshot.readyMode.state}
          href="/dashboard/leads"
        />
        <IntegrationCard
          icon={CreditCard}
          title="Stripe Lead Purchases"
          value={money(snapshot.stripe.revenueCents / 100)}
          detail={`${number(snapshot.stripe.confirmedPurchases)} confirmed · ${number(snapshot.stripe.pendingRequests)} pending · last charge ${ageLabel(snapshot.stripe.lastChargeAt)}`}
          state={snapshot.stripe.pendingRequests > 0 ? "warning" : "ok"}
          href="/purchase-leads"
        />
        <IntegrationCard
          icon={ShieldCheck}
          title="System Health"
          value={snapshot.system.status ?? "No check"}
          detail={`${number(snapshot.system.critical)} critical · ${number(snapshot.system.warnings)} warnings · checked ${ageLabel(snapshot.system.checkedAt)}`}
          state={snapshot.system.status === "critical" ? "critical" : snapshot.system.status === "degraded" ? "warning" : snapshot.system.status ? "ok" : "unavailable"}
          href="/dashboard/system-health"
        />
      </div>

      <WeekProductionCard snapshot={snapshot} />

      {/* PL-026: removed "Activity And Referrals" 30-day widget per Sam.
          Recruiting block now spans full width. */}
      <div className="grid gap-4">
        <RecruitingGrid stats={snapshot.recruiting} />
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Button asChild variant="outline" className="justify-between">
          <Link to="/dashboard/leaderboard">Leaderboard <ArrowRight className="h-4 w-4" /></Link>
        </Button>
        <Button asChild variant="outline" className="justify-between">
          <Link to="/dashboard/recruit">Recruiting <ArrowRight className="h-4 w-4" /></Link>
        </Button>
        <Button asChild variant="outline" className="justify-between">
          <Link to="/dashboard/seminar-control">Seminar Control <ArrowRight className="h-4 w-4" /></Link>
        </Button>
        <Button asChild variant="outline" className="justify-between">
          <Link to="/dashboard/notifications">Communication Center <ArrowRight className="h-4 w-4" /></Link>
        </Button>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { user, isLoading, isAdmin } = useAuth();

  // /dashboard for admins now renders the new AgencyCommandView (real-time
  // agency rollup) instead of the 800-line legacy CEO panel. Per Sam:
  // owner-mode first, not yet-another-agent-dashboard.
  if (isAdmin) return <AgentCommandDashboard />;

  const { effectiveRole, actualRole, isPreviewing } = useRolePreview();
  const currentAgent = useCurrentAgent(user?.id);
  const downline = useMyDownline();
  const [runningSystemCheck, setRunningSystemCheck] = useState(false);

  const scopedAgentIds = useMemo(() => {
    if (effectiveRole === "admin") return undefined;
    const ids = new Set<string>();
    if (currentAgent.data?.id) ids.add(currentAgent.data.id);
    if (effectiveRole === "manager") {
      for (const id of downline.data ?? []) ids.add(id);
    }
    return Array.from(ids);
  }, [currentAgent.data?.id, downline.data, effectiveRole]);

  const snapshotQuery = useQuery({
    queryKey: ["launch-dashboard-snapshot", user?.id, effectiveRole, scopedAgentIds?.join(",") ?? "agency"],
    queryFn: () => loadDashboardSnapshot(effectiveRole, user!.id, scopedAgentIds),
    enabled: Boolean(user?.id) && !currentAgent.isLoading && !downline.isLoading,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });

  const runSystemCheck = async () => {
    setRunningSystemCheck(true);
    try {
      const { error } = await supabase.functions.invoke("system-health-check");
      if (error) throw error;
      toast.success("System check started");
      await snapshotQuery.refetch();
    } catch (error: any) {
      toast.error(error?.message ?? "System check failed to start");
    } finally {
      setRunningSystemCheck(false);
    }
  };

  if (isLoading || currentAgent.isLoading || downline.isLoading) {
    return <PageLoadingSkeleton title="Loading command dashboard" />;
  }

  if (!user) return null;

  if (effectiveRole === "agent") {
    return (
      <div className="space-y-4 lg:pr-[18rem]">
        {isPreviewing && (
          <Badge variant="outline">Previewing Agent View from {actualRole}</Badge>
        )}
        <AgentCommandDashboard />
      </div>
    );
  }

  if (snapshotQuery.isLoading || !snapshotQuery.data) {
    return <PageLoadingSkeleton title="Loading live dashboard snapshot" />;
  }

  return (
    <>
      {isPreviewing && (
        <div className="mb-4 lg:pr-[18rem]">
          <Badge variant="outline">Previewing {effectiveRole} dashboard from {actualRole}</Badge>
        </div>
      )}
      <ExecutiveDashboard
        role={effectiveRole}
        snapshot={snapshotQuery.data}
        onRunSystemCheck={runSystemCheck}
        runningSystemCheck={runningSystemCheck}
      />
    </>
  );
}
