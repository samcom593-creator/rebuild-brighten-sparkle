import { lazy, Suspense, useMemo, useState, type ElementType, type ReactNode } from "react";
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

// wave-103 (2026-06-15): INVESTOR-003 code-split. Dashboard.js was 444KB
// because all role-specific + below-fold panels (esp. chart-heavy ones that
// pull vendor-charts 428KB) shipped eagerly. Default admin path renders only
// AgentCommandDashboard, so everything below moves into its own lazy chunk
// per route condition.
const AgentCommandDashboard = lazy(() => import("@/pages/AgentCommandDashboard"));
// The default admin landing is the clean APEX Today (the ONE canonical dashboard per
// spec) instead of the sprawling command view. The full command view is still at
// /agent-dashboard, and the "Admin View" preview toggle still shows ExecutiveDashboard.
const DashboardToday = lazy(() => import("@/pages/DashboardToday"));
const ManagerCommandView = lazy(() => import("@/pages/ManagerCommandView"));
const VaOpsCommandCenter = lazy(() => import("@/pages/VaOpsCommandCenter"));
const UnclaimedLeadsCommandCard = lazy(() =>
  import("@/components/dashboard/UnclaimedLeadsCommandCard").then((m) => ({ default: m.UnclaimedLeadsCommandCard })),
);
const EarningsEstimateCard = lazy(() =>
  import("@/components/dashboard/EarningsEstimateCard").then((m) => ({ default: m.EarningsEstimateCard })),
);
const XcelStalledCard = lazy(() =>
  import("@/components/dashboard/XcelStalledCard").then((m) => ({ default: m.XcelStalledCard })),
);
const LicensedHiresRange = lazy(() =>
  import("@/components/dashboard/LicensedHiresRange").then((m) => ({ default: m.LicensedHiresRange })),
);
const ManagerHierarchyMtdPanel = lazy(() =>
  import("@/components/dashboard/ManagerHierarchyMtdPanel").then((m) => ({ default: m.ManagerHierarchyMtdPanel })),
);
const JustHiredPanel = lazy(() =>
  import("@/components/dashboard/JustHiredPanel").then((m) => ({ default: m.JustHiredPanel })),
);
const BuilderProgressDashboard = lazy(() =>
  import("@/components/dashboard/BuilderProgressDashboard").then((m) => ({ default: m.BuilderProgressDashboard })),
);
const AgentLinkBookTruthCard = lazy(() =>
  import("@/components/dashboard/AgentLinkBookTruthCard").then((m) => ({ default: m.AgentLinkBookTruthCard })),
);
const CarrierBreakdownCard = lazy(() =>
  import("@/components/dashboard/CarrierBreakdownCard").then((m) => ({ default: m.CarrierBreakdownCard })),
);
const BookTrendCard = lazy(() =>
  import("@/components/dashboard/CarrierProductionCard").then((m) => ({ default: m.BookTrendCard })),
);
// wave-103: WhatShippedTodayBanner is 1126 lines (the SHIPPED receipts array
// grows on every ship). It accounted for ~150KB of Dashboard.js raw. Lazy-load
// so the banner shell paints fast and the receipts hydrate in.
const WhatShippedTodayBanner = lazy(() =>
  import("@/components/dashboard/WhatShippedTodayBanner").then((m) => ({ default: m.WhatShippedTodayBanner })),
);
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/glass-card";
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
import { ReferralLinkCard } from "@/components/dashboard/ReferralLinkCard";
import { AgentCloudHome } from "@/components/dashboard/AgentCloudHome";
import { ScopedProductionScoreboard } from "@/components/dashboard/ScopedProductionScoreboard";
import { APPLICATION_RECORD_TYPE } from "@/shared/api/applicationRecordType";

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
    hired: number;
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
  return Math.round(Math.max(0, Date.now() - time) / 60_000);
}

function ageLabel(iso: string | null): string {
  const mins = minutesSince(iso);
  if (mins === null) return "Never";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function LazyPanel({ children, minHeight = "h-24" }: { children: ReactNode; minHeight?: string }) {
  return (
    <Suspense
      fallback={
        <div className={cn("animate-pulse rounded-lg bg-muted/30", minHeight)} aria-hidden />
      }
    >
      {children}
    </Suspense>
  );
}

async function getRows<T = any>(builder: any, label: string): Promise<T[]> {
  if (!builder) return [];
  const { data, error } = await builder;
  if (error) {

    return [];
  }
  return (data ?? []) as T[];
}

async function getOne<T = any>(builder: any, label: string): Promise<T | null> {
  if (!builder) return null;
  const { data, error } = await builder;
  if (error) {

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
    return getRows(q.from("applications").select("id, email, status, contacted_at, last_contacted_at, first_contact_attempt_at, qualified_at, reviewed_at, contracted_at, closed_at, licensed_at, license_status, license_progress, first_deal_at, start_date, terminated_at").eq("record_type", APPLICATION_RECORD_TYPE).is("terminated_at", null).limit(2_000), "applications-admin");
  }

  const visibleViaView = await getRows(
    q.from("v_my_applications").select("id, email, status, contacted_at, last_contacted_at, first_contact_attempt_at, qualified_at, reviewed_at, contracted_at, closed_at, licensed_at, license_status, license_progress, first_deal_at, start_date, terminated_at").is("terminated_at", null).limit(2_000),
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
    q.from("applications").select("id, email, status, contacted_at, last_contacted_at, first_contact_attempt_at, qualified_at, reviewed_at, contracted_at, closed_at, licensed_at, license_status, license_progress, first_deal_at, start_date, terminated_at").eq("record_type", APPLICATION_RECORD_TYPE).is("terminated_at", null).or(filters.join(",")).limit(2_000),
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
  const promotedAgents = applicationIds.size > 0
    ? await getRows(
        q.from("agents").select("source_application_id, user_id, first_deal_at").in("source_application_id", Array.from(applicationIds)),
        "application-agent-lifecycle",
      )
    : [];
  const applicationEmails = new Set(
    applications
      .map((app) => String(app.email ?? "").toLowerCase())
      .filter(Boolean),
  );

  // interview_events is the live table; scheduled_interviews is dead (held 2 rows
  // vs ~185 real bookings). Derive status downstream from outcome/canceled_at.
  const interviewQuery = role === "admin" || applicationIds.size > 0
    ? q.from("interview_events").select("outcome, canceled_at, application_id, scheduled_at")
        .gte("scheduled_at", week.startIso)
        .is("canceled_at", null)
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
    getRows(q.from("seminar_registrations").select("email, attended").limit(2_000), "seminar-registrations"),
    getRows(
      applyAgentScope(
        q.from("lead_purchase_requests").select("status, requested_at").order("requested_at", { ascending: false }).limit(500),
        agentScope,
      ),
      "lead-purchase-requests",
    ),
    getRows(
      applyAgentScope(
        q.from("lead_purchases").select("amount_cents, charged_at").gte("charged_at", month.startIso).order("charged_at", { ascending: false }).limit(500),
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

  // sync_health_summary() returns { as_of, sources:[{source, last_status,
  // is_stale, last_success_at, action_required, ...}] } — NOT flat columns. Reading
  // top-level .status/.finished_at made it always undefined, so the card painted a
  // false "critical/broken" even when AgentLink had synced minutes ago. Pluck the
  // agentlink source and trust its own threshold-aware is_stale flag.
  const agentLink = (agentLinkRow as any)?.sources?.find((s: any) => s.source === "agentlink") ?? null;
  const syncAt = agentLink?.last_success_at ?? agentLink?.last_attempt_at ?? null;
  const syncAge = minutesSince(syncAt);
  const agentLinkState: IntegrationState = !agentLink
    ? "unavailable"
    : (agentLink.action_required || agentLink.last_status !== "ok")
      ? "critical"
      : agentLink.is_stale
        ? "warning"
        : "ok";

  const confirmedRequests = (purchaseRequests as any[]).filter((row) =>
    ["confirmed", "paid", "completed", "succeeded"].includes(String(row.status ?? "").toLowerCase()),
  );
  const pendingRequests = (purchaseRequests as any[]).filter((row) =>
    ["pending", "requested", "processing"].includes(String(row.status ?? "pending").toLowerCase()),
  );

  // v9 audit fix 2026-06-10: Dashboard StatTiles were summing the apex `deals`
  // table which has been stale since AgentLink sync went dark 20+ days ago.
  // Read the AgentLink truth view first; fall back to legacy computed values
  // only if the view is unavailable. Source of truth: agentlink_deals_snapshot
  // refreshed every 30 min by com.samjames.apex.agentlink-sync launchd.
  const { data: alTruth } = await q
    .from("v_agentlink_book_truth")
    .select("deals_today, premium_today, deals_this_week, premium_this_week, deals_this_month, premium_this_month, deals_prior_week, premium_prior_week")
    .maybeSingle();
  // MP237 invariant fix: source-mixing between AgentLink truth view and legacy
  // deals-table fallback broke Month>=Week>=Today when one bucket was
  // legitimately zero (e.g. no deals yet today) but others were not.
  // Decide the source ONCE per snapshot: if the truth row exists, use it for
  // all seven buckets (including legitimate zeros). Only fall back to the
  // legacy deals-table sum when the view returned no row at all.
  const alTruthAvailable = alTruth != null;
  const alTodayAlp = Number(alTruth?.premium_today ?? 0);
  const alTodayDeals = Number(alTruth?.deals_today ?? 0);
  const alWeekAlp = Number(alTruth?.premium_this_week ?? 0);
  const alWeekDeals = Number(alTruth?.deals_this_week ?? 0);
  const alMonthAlp = Number(alTruth?.premium_this_month ?? 0);
  const alMonthDeals = Number(alTruth?.deals_this_month ?? 0);
  // wave-wow-source-mismatch 2026-08-07: the "Vs prior matched week" tile used to
  // divide alWeekAlp (truth view) by the legacy deals-table prior week. Two sources,
  // one percentage. On 2026-08-07 that rendered -1.66% ("flat") while the same-source
  // comparison was -26.79% — the legacy table was missing 11 deals / $15,980 of the
  // baseline, so a real 27% production drop read as noise on Sam's landing surface.
  // v_agentlink_book_truth now carries its own matched prior week (same weekday span
  // shifted -7d, same Phoenix dates), so both operands share a source and a timezone.
  const alPriorWeekAlp = Number(alTruth?.premium_prior_week ?? 0);
  const legacyTodayAlp = sumAnnualPremium(todayDeals);
  const legacyMonthAlp = sumAnnualPremium(monthDeals);

  return {
    scopeLabel,
    sourceGeneratedAt: new Date().toISOString(),
    production: {
      // All-or-nothing: never mix truth-view and legacy across buckets in the
      // same snapshot, or Month>=Week>=Today can be violated when legacy is
      // stale relative to the AgentLink snapshot.
      todayAlp: alTruthAvailable ? alTodayAlp : legacyTodayAlp,
      todayDeals: alTruthAvailable ? alTodayDeals : todayDeals.length,
      weekAlp: alTruthAvailable ? alWeekAlp : sumAnnualPremium(weekDeals),
      weekDeals: alTruthAvailable ? alWeekDeals : weekDeals.length,
      monthAlp: alTruthAvailable ? alMonthAlp : legacyMonthAlp,
      monthDeals: alTruthAvailable ? alMonthDeals : monthDeals.length,
      // Must follow weekAlp's source exactly — a % whose numerator and denominator
      // come from different tables is not a growth rate, it is a coincidence.
      previousWeekAlp: alTruthAvailable ? alPriorWeekAlp : sumAnnualPremium(priorWeekDeals),
      liveAgents: new Set((liveDeals as any[]).map((row) => row.agent_id).filter(Boolean)).size,
      presentationsWeek: weekProduction.reduce((sum, row) => sum + Number(row.presentations ?? 0), 0),
      hoursWeek: weekProduction.reduce((sum, row) => sum + Number(row.hours_called ?? 0), 0),
      closeRate: getCloseRate(alTruthAvailable ? alWeekDeals : weekDeals.length, weekProduction.reduce((sum, row) => sum + Number(row.presentations ?? 0), 0)),
    },
    recruiting: {
      applicants: applications.length,
      contacted: applications.filter((app) => app.contacted_at || app.last_contacted_at || app.first_contact_attempt_at).length,
      booked: (scheduledInterviews as any[]).filter((row) => {
        // interview_events shape: canceled_at is already null-filtered upstream;
        // exclude no_show via outcome. A live row with no outcome = "scheduled".
        const status = row.canceled_at ? "cancelled" : String(row.outcome ?? "scheduled");
        return !["cancelled", "no_show"].includes(status.toLowerCase());
      }).length,
      seminarAttended: (seminarRows as any[]).filter((row) => row.attended === true).length,
      noShow: (seminarRows as any[]).filter((row) => row.attended === false).length,
      advanced: applications.filter(isAdvancedApplication).length,
      icaSent: applications.filter((app) => app.status === "contracting" || app.status === "approved" || app.contracted_at).length,
      licensed: applications.filter(isLicensedApplication).length,
      contracted: applications.filter(isContractedApplication).length,
      hired: applications.filter((app) => app.closed_at).length,
      activated: promotedAgents.filter((agent) => agent.user_id).length,
      // applications.first_deal_at was bulk-backfilled and is explicitly not
      // usable as a per-recruit milestone. agents.first_deal_at is the clean
      // producer event and source_application_id keeps it in this exact scope.
      firstSale: promotedAgents.filter((agent) => agent.first_deal_at).length,
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
      status: agentLink?.last_status ?? null,
      lastSyncAt: syncAt,
      policiesSeen: 0,
      dealsInserted: 0,
      dealsUpdated: 0,
      error: agentLink?.last_error ?? null,
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
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) {

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
      className={cn(
        "shrink-0",
        state === "warning" && "border-amber-500/35 text-amber-600 dark:text-amber-400",
      )}
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
  // Flat KPI tile: no gradient fill, no icon pill. Severity rides the icon
  // only (paired -600/dark:-400 so it survives the white light-theme card),
  // and the number is the loudest thing on the page.
  const iconTone =
    tone === "success"
      ? "text-emerald-600 dark:text-emerald-400"
      : tone === "warning"
        ? "text-amber-600 dark:text-amber-400"
        : "text-muted-foreground";
  return (
    <GlassCard className="p-4">
      <div className="flex items-center gap-2">
        <Icon className={cn("h-4 w-4 shrink-0", iconTone)} />
        <p className="min-w-0 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{label}</p>
      </div>
      {/* text-3xl, not the text-2xl contract scale. Sam reads these five tiles from across
          the room; the redesign shrank them and that read as the number being taken away. */}
      <p className="mt-2 break-words text-3xl font-bold leading-none tabular-nums text-foreground">{value}</p>
      <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">{detail}</p>
    </GlassCard>
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
    <GlassCard className="p-4">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <h3 className="flex min-w-0 items-center gap-2 text-sm font-semibold text-foreground">
          <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="truncate">{title}</span>
        </h3>
        <StateBadge state={state} />
      </div>
      <p className="text-sm font-bold tabular-nums text-foreground">{value}</p>
      <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">{detail}</p>
      <Button asChild variant="ghost" size="sm" className="mt-2 h-10 justify-start px-0 text-xs sm:h-9">
        <Link to={href}>
          Open <ArrowRight className="ml-1.5 h-4 w-4" />
        </Link>
      </Button>
    </GlassCard>
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
    ["Hired", stats.hired],
    ["Account created", stats.activated],
    ["First sale", stats.firstSale],
  ];

  return (
    <GlassCard className="p-4">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <h3 className="flex min-w-0 items-center gap-2 text-sm font-semibold text-foreground">
          <Target className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="truncate">Recruiting Pipeline</span>
        </h3>
      </div>
      <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
        Every stage of the hire funnel as an all-time count; a wide gap between two neighbouring stages is where applicants are dying.
      </p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <LazyPanel minHeight="h-16"><LicensedHiresRange /></LazyPanel>
        {rows.map(([label, value]) => (
          <div key={label} className="rounded-lg border border-border bg-card p-3">
            <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{label}</p>
            <p className="mt-1.5 text-2xl font-bold leading-none tabular-nums text-foreground">{number(Number(value))}</p>
          </div>
        ))}
      </div>
    </GlassCard>
  );
}

function WeekProductionCard({ snapshot }: { snapshot: DashboardSnapshot }) {
  const hasWeekProduction = snapshot.production.weekDeals > 0 || snapshot.production.weekAlp > 0 || snapshot.production.presentationsWeek > 0;
  const change = snapshot.production.previousWeekAlp > 0
    ? ((snapshot.production.weekAlp - snapshot.production.previousWeekAlp) / snapshot.production.previousWeekAlp) * 100
    : null;

  return (
    <GlassCard className="p-4">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <h3 className="flex min-w-0 items-center gap-2 text-sm font-semibold text-foreground">
          <BarChart3 className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="truncate">Week in Agency Production</span>
        </h3>
      </div>
      <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
        Posted ALP, deal count and presentations for the current business week, measured against the matched prior week.
      </p>
      {hasWeekProduction ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">ALP posted this week</p>
            <p className="mt-1.5 break-words text-2xl font-bold leading-none tabular-nums text-foreground">{money(snapshot.production.weekAlp)}</p>
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Deals posted</p>
            <p className="mt-1.5 text-2xl font-bold leading-none tabular-nums text-foreground">{number(snapshot.production.weekDeals)}</p>
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Presentations logged</p>
            <p className="mt-1.5 text-2xl font-bold leading-none tabular-nums text-foreground">{number(snapshot.production.presentationsWeek)}</p>
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Vs prior matched week</p>
            <p
              className={cn(
                "mt-1.5 text-2xl font-bold leading-none tabular-nums",
                change === null
                  ? "text-muted-foreground"
                  : change < 0
                    ? "text-amber-600 dark:text-amber-400"
                    : "text-emerald-600 dark:text-emerald-400",
              )}
            >
              {change === null ? "—" : percent(change)}
            </p>
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-amber-500/35 bg-amber-500/5 p-3 sm:p-4">
          <div className="flex min-w-0 items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
            <div className="min-w-0">
              <p className="text-sm font-semibold">No posted production found for this scope this week.</p>
              <p className="mt-0.5 break-words text-xs leading-relaxed text-muted-foreground">
                This panel is no longer blank. It reads valid deals from `deals.posted_at` and presentations from `daily_production`; zero means no trusted records are visible to this role.
              </p>
            </div>
          </div>
        </div>
      )}
      <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
        Source: deals.status in submitted/active filters, posted_at in America/Chicago business windows. Presentations remain manual `daily_production` input.
      </p>
    </GlassCard>
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

  // Explicit period labels so "Today / Week / Month" tiles surface the
  // real calendar range they cover (Sam 2026-07-05 correction: MTD is
  // calendar-month, not rolling-30d — labels must state which is which).
  const phoenixNow = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Phoenix" }));
  const monthShort = phoenixNow.toLocaleDateString("en-US", { month: "short", timeZone: "America/Phoenix" });
  const dayOfMonth = phoenixNow.getDate();
  const todayLabel = `${monthShort} ${dayOfMonth}`;
  const weekStart = new Date(phoenixNow);
  const dow = phoenixNow.getDay(); // 0=Sun; Postgres date_trunc('week') = Monday
  const daysSinceMonday = dow === 0 ? 6 : dow - 1;
  weekStart.setDate(phoenixNow.getDate() - daysSinceMonday);
  const weekStartLabel = weekStart.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Phoenix" });
  const weekRangeLabel = `${weekStartLabel} - ${todayLabel}`;
  // PL-MP242: MTD reverted to calendar month (America/Phoenix). Label the
  // range explicitly so a short new-month vs a long business week reads
  // as truth ("Jul 1 - Jul 5" vs "Jun 30 - Jul 5"), not as a broken KPI.
  const monthStartLabel = phoenixNow.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Phoenix" }).replace(/\s\d+$/, " 1");
  const mtdRangeLabel = `${monthStartLabel} - ${todayLabel}`;

  return (
    <div className="page-enter mx-auto w-full max-w-6xl space-y-5 px-4 pb-24 sm:px-6">
      <PageHeader
        accent="primary"
        eyebrow={role === "admin" ? "Apex Financial · CEO Command" : "Manager · Command"}
        eyebrowIcon={<ShieldCheck className="h-3 w-3" />}
        title={title}
        subtitle="Production, recruiting, lead inventory, Venmo lead payments, and integration state — every number sourced from live tables, with explicit unavailable states instead of filler."
        actions={
          <>
            <Badge variant="outline" className="text-xs">{snapshot.scopeLabel}</Badge>
            <Badge variant="secondary" className="text-xs tabular-nums">Generated {ageLabel(snapshot.sourceGeneratedAt)}</Badge>
            <Button onClick={onRunSystemCheck} disabled={runningSystemCheck} size="sm" className="h-10 w-full sm:h-9 sm:w-auto">
              {runningSystemCheck ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              Run System Check
            </Button>
            <Button asChild variant="outline" size="sm" className="h-10 w-full sm:h-9 sm:w-auto">
              <Link to="/numbers">
                Log Numbers <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </>
        }
      />

      {/* THE AGENT CLOUD HOME, mirrored. Sam: "dashboard still not good, mirror
          agent cloud". Every number here comes from ONE server-side RPC
          (apex_home_dashboard) that reconciles with the leaderboard, CRM and
          book truth to the dollar — replacing the per-panel client queries
          below, which a live measurement caught firing agentlink_deals_snapshot
          8x and agents 7x on a single load. */}
      <AgentCloudHome />

      {/* Producer recruiting link — unlocks at the production threshold so
          earners can recruit onto their own team instead of the general pool. */}
      <ReferralLinkCard />

      {/* Pinned receipts banner — what shipped to the platform between
          this login and the last one. Sam reported "everything looks the
          same" despite 24+ commits; this makes the delta impossible to miss. */}

      {/* Funnel-leak command row — biggest two leaks live in one strip
          at the top of every admin dashboard load: unclaimed applicants
          (recruiting side) + stalled XCEL students (licensing side). */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <LazyPanel minHeight="h-32"><UnclaimedLeadsCommandCard /></LazyPanel>
        <LazyPanel minHeight="h-32"><XcelStalledCard /></LazyPanel>
      </div>

      {/* MP-268: earnings restored to the dashboard. ALP tiles above are premium volume,
          not income — this is the only honest income answer the data supports. */}
      

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatTile
          icon={DollarSign}
          label="Today ALP"
          value={money(snapshot.production.todayAlp)}
          detail={`${number(snapshot.production.todayDeals)} posted deals · ${todayLabel} (America/Phoenix)`}
        />
        <StatTile
          icon={BarChart3}
          label="Week ALP (business week)"
          value={money(snapshot.production.weekAlp)}
          detail={`${number(snapshot.production.weekDeals)} deals · ${weekRangeLabel}`}
        />
        {/* PL-MP242: MTD reverted to calendar-month Phoenix TZ. Explicit
            range in label so short-month vs long-week is honest, not "broken". */}
        <StatTile
          icon={BarChart3}
          label={`MTD ALP (${mtdRangeLabel})`}
          value={money(snapshot.production.monthAlp)}
          detail={`${number(snapshot.production.monthDeals)} deals · calendar month · America/Phoenix`}
        />
        <StatTile icon={Activity} label={`Live agents (${LIVE_AGENT_DEAL_WINDOW_DAYS}d)`} value={number(snapshot.production.liveAgents)} detail="At least one valid posted deal in live window" />
        <StatTile icon={CheckCircle2} label="Close rate" value={percent(snapshot.production.closeRate)} detail={`${number(snapshot.production.presentationsWeek)} presentations logged`} tone="success" />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
          title="Lead Payments"
          value={money(snapshot.stripe.revenueCents / 100)}
          detail={`${number(snapshot.stripe.confirmedPurchases)} confirmed historical records · ${number(snapshot.stripe.pendingRequests)} pending requests · latest record ${ageLabel(snapshot.stripe.lastChargeAt)}`}
          state={snapshot.stripe.pendingRequests > 0 ? "warning" : "ok"}
          href="/dashboard/lead-payments"
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

      {/* My Builders — Sam's #1 focus (2026-06-03): hold builders, run the line.
          Shows Sam-direct recruits, their builder tier, onboarding progress,
          producing flag. Reads v_sam_builders_dashboard. */}

      {/* Manager hierarchy MTD + top producers — replaces the weak "Recent deals"
          widget per Sam's 2026-05-22 punch ("dashboard literally empty, leaderboard
          empty, last 8 deals still there, doesn't have pipeline stats"). Reads
          v_manager_hierarchy_mtd + v_top_producers_mtd — real data only. */}

      {/* Just-hired-direct-to-Sam feed — surfaces last-30d hires routed to Sam
          (no manager). Sam's 2026-05-22 ask: "Just-hired direct-to-Sam feed". */}

      {/* v9 audit fix 2026-06-10: AgentLink-style carrier breakdown + by-month trend.
          Two-column grid at desktop, stacked on mobile. */}
      

      {/* PL-026: removed "Activity And Referrals" 30-day widget per Sam.
          Recruiting block now spans full width. */}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Button asChild variant="outline" className="h-10 justify-between sm:h-9">
          <Link to="/dashboard/leaderboard"><span className="truncate">Leaderboard</span> <ArrowRight className="ml-2 h-4 w-4 shrink-0" /></Link>
        </Button>
        <Button asChild variant="outline" className="h-10 justify-between sm:h-9">
          <Link to="/dashboard/recruiting"><span className="truncate">Recruiting</span> <ArrowRight className="ml-2 h-4 w-4 shrink-0" /></Link>
        </Button>
        <Button asChild variant="outline" className="h-10 justify-between sm:h-9">
          <Link to="/dashboard/seminar-control"><span className="truncate">Seminar Control</span> <ArrowRight className="ml-2 h-4 w-4 shrink-0" /></Link>
        </Button>
        <Button asChild variant="outline" className="h-10 justify-between sm:h-9">
          <Link to="/dashboard/notifications"><span className="truncate">Communication Center</span> <ArrowRight className="ml-2 h-4 w-4 shrink-0" /></Link>
        </Button>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { user, isLoading, isAdmin, isVaManager, isVa } = useAuth();
  const { effectiveRole, actualRole, isPreviewing, previewRole } = useRolePreview();
  const shouldRenderDefaultAdminCommand = isAdmin && !previewRole && effectiveRole === "admin";
  // VA ops staff get their own /dashboard home (VaOpsCommandCenter) — the
  // agent/manager snapshot below scopes to an `agents` row they don't have.
  const isVaOps = !isAdmin && (isVaManager || isVa);

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
    queryKey: ["launch-dashboard-snapshot", user?.id, effectiveRole, scopedAgentIds ? [...scopedAgentIds].sort() : "agency"],
    queryFn: () => loadDashboardSnapshot(effectiveRole, user!.id, scopedAgentIds),
    enabled: Boolean(user?.id) && !shouldRenderDefaultAdminCommand && !isVaOps && !currentAgent.isLoading && !downline.isLoading,
    staleTime: 60_000,
    refetchInterval: 300_000,
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

  if (isLoading) {
    return <PageLoadingSkeleton />;
  }

  if (!user) return null;

  if (isVaOps) {
    return (
      <Suspense fallback={<PageLoadingSkeleton />}>
        <VaOpsCommandCenter />
      </Suspense>
    );
  }

  // Role preview routing contract:
  // - no preview + real admin: AgentCommandDashboard
  // - previewRole=agent: AgentCommandDashboard
  // - previewRole=manager: ManagerCommandView
  // - previewRole=admin: ExecutiveDashboard
  if (shouldRenderDefaultAdminCommand) {
    return (
      <div className="mx-auto w-full max-w-7xl p-4 sm:p-6">
        <AgentCloudHome />
      </div>
    );
  }

  if (currentAgent.isLoading || downline.isLoading) {
    return <PageLoadingSkeleton />;
  }

  if (effectiveRole === "agent") {
    return (
      <div className="space-y-5">
        {isPreviewing && (
          <div className="px-4 pt-4 sm:px-6">
            <Badge variant="outline">Previewing Agent View from {actualRole}</Badge>
          </div>
        )}
        <div className="px-4 pt-4 sm:px-6">
          <ScopedProductionScoreboard />
        </div>
        <Suspense fallback={<PageLoadingSkeleton />}>
          <AgentCommandDashboard />
        </Suspense>
      </div>
    );
  }

  if (effectiveRole === "manager") {
    return (
      <div className="space-y-5">
        {isPreviewing && (
          <div className="px-4 pt-4 sm:px-6">
            <Badge variant="outline">Previewing Manager View from {actualRole}</Badge>
          </div>
        )}
        <div className="px-4 pt-4 sm:px-6">
          <ScopedProductionScoreboard />
        </div>
        <Suspense fallback={<PageLoadingSkeleton />}>
          <ManagerCommandView />
        </Suspense>
      </div>
    );
  }

  if (snapshotQuery.isLoading || !snapshotQuery.data) {
    return <PageLoadingSkeleton />;
  }

  return (
    <>
      {isPreviewing && (
        <div className="mx-auto w-full max-w-6xl px-4 pt-4 sm:px-6">
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
