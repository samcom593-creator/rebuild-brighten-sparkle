import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowDownUp,
  ArrowRight,
  BarChart3,
  CheckCircle2,
  Copy,
  Crown,
  ExternalLink,
  GraduationCap,
  Link as LinkIcon,
  Loader2,
  Network,
  PhoneCall,
  Search,
  ShieldCheck,
  TrendingUp,
  UserCog,
  Users,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { HireStageSelect } from "@/components/hires/HireStageControl";
import { usePageTitle } from "@/hooks/usePageTitle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PageHeader } from "@/components/ui/page-header";
import { cn } from "@/lib/utils";

type BuilderTrack = "agent" | "manager_track" | "agency_owner_track";
type DashboardMode = "builders" | "managers" | "agencyOwners";
type SortKey =
  | "rank"
  | "monthly_production"
  | "active_agent_count"
  | "hires_this_month"
  | "activation_rate"
  | "growth_rate"
  | "stuck_applicants"
  | "coursework_completion_rate";

interface BuilderRow {
  agent_id: string;
  builder_name: string;
  email: string | null;
  phone: string | null;
  state: string | null;
  user_id: string | null;
  profile_id: string | null;
  manager_id: string | null;
  upline_id: string | null;
  invited_by_manager_id: string | null;
  builder_track: BuilderTrack;
  earned_title: "Agent" | "Manager" | "Agency Owner" | "Agency Owner Track - Not Qualified Yet";
  license_status: string | null;
  status: string | null;
  onboarding_stage: string | null;
  created_at: string;
  updated_at: string | null;
  direct_agent_count: number;
  total_downline_count: number;
  active_agent_count: number;
  licensed_agent_count: number;
  unlicensed_agent_count: number;
  hires_this_month: number;
  applicant_count: number;
  licensed_recruits: number;
  unlicensed_recruits: number;
  coursework_completed_count: number;
  activation_count: number;
  stuck_applicants: number;
  applicants_this_month: number;
  applicants_from_referral_link: number;
  licensed_from_referral_link: number;
  activated_from_referral_link: number;
  referral_conversion_rate: number | null;
  coursework_completion_rate: number | null;
  activation_rate: number | null;
  monthly_production: number | string | null;
  monthly_production_available: boolean;
  growth_rate: number | string | null;
  last_production_date: string | null;
  last_activity_at: string | null;
  referral_code: string;
  referral_link: string;
  application_link: string;
  qualifies_agency_owner: boolean;
  above_100k_monthly: boolean | null;
  is_builder: boolean;
  action_needed: string;
}

interface AgentDetailRow {
  id: string;
  display_name: string | null;
  status: string | null;
  license_status: string | null;
  onboarding_stage: string | null;
  invited_by_manager_id: string | null;
  manager_id: string | null;
  builder_track: BuilderTrack | null;
  created_at: string;
  updated_at: string | null;
  profile?: {
    full_name?: string | null;
    email?: string | null;
    phone?: string | null;
    state?: string | null;
  } | null;
}

interface ApplicationDetailRow {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  state: string | null;
  status: string | null;
  license_status: string | null;
  license_progress: string | null;
  created_at: string;
  updated_at: string | null;
  course_purchased_at: string | null;
  course_started_at: string | null;
  exam_scheduled_at: string | null;
  exam_passed_at: string | null;
  licensed_at: string | null;
  license_approved_at: string | null;
  contracted_at: string | null;
  ica_paid: boolean | null;
  ica_paid_at: string | null;
  first_deal_at: string | null;
  next_action: string | null;
  next_action_due_at: string | null;
  next_step_due_at: string | null;
  is_ghosted: boolean | null;
  assigned_agent_id: string | null;
  referral_manager_id: string | null;
  recruiter_id: string | null;
  referrer_agent_id: string | null;
  referral_source: string | null;
}

interface QueryResponse<T> {
  data: T[] | null;
  error: unknown | null;
}

interface BuilderViewClient {
  from(table: "v_builder_operating_dashboard"): {
    select(columns: string): Promise<QueryResponse<BuilderRow>>;
  };
}

interface AgentDetailClient {
  from(table: "agents"): {
    select(columns: string): {
      order(column: string, options: { ascending: boolean }): {
        limit(count: number): Promise<QueryResponse<AgentDetailRow>>;
      };
    };
  };
}

interface ApplicationDetailClient {
  from(table: "applications"): {
    select(columns: string): {
      order(column: string, options: { ascending: boolean }): {
        limit(count: number): Promise<QueryResponse<ApplicationDetailRow>>;
      };
    };
  };
}

interface LeadPaymentRow {
  agent_id: string;
  paid: boolean | null;
  tier: string;
  payment_status?: string | null;
  lead_type?: string | null;
  amount?: number | string | null;
  marked_at?: string | null;
}

const TRACK_LABEL: Record<BuilderTrack, string> = {
  agent: "Agent",
  manager_track: "Manager Track",
  agency_owner_track: "Agency Owner Track",
};

const TITLE_TONE: Record<string, string> = {
  "Agency Owner": "border-amber-400/50 bg-amber-400/10 text-amber-300",
  "Agency Owner Track - Not Qualified Yet": "border-info/30 bg-info/10 text-info",
  Manager: "border-emerald-400/50 bg-emerald-400/10 text-emerald-300",
  Agent: "border-slate-400/40 bg-slate-400/10 text-slate-600 dark:text-slate-300",
};

const SORT_LABELS: Record<SortKey, string> = {
  rank: "Default rank",
  monthly_production: "Monthly production",
  active_agent_count: "Active agents",
  hires_this_month: "Hires this month",
  activation_rate: "Activation rate",
  growth_rate: "Growth rate",
  stuck_applicants: "Stuck recruits",
  coursework_completion_rate: "Coursework completion",
};

function numberValue(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "string" ? Number(value) : value;
  return Number.isFinite(n) ? n : null;
}

function fmtInt(value: number | null | undefined): string {
  return new Intl.NumberFormat("en-US").format(value ?? 0);
}

function fmtMoney(value: number | string | null | undefined): string {
  const n = numberValue(value);
  if (n === null) return "Insufficient data";
  if (Math.abs(n) >= 1000000) return `$${(n / 1000000).toFixed(1)}M`;
  if (Math.abs(n) >= 1000) return `$${(n / 1000).toFixed(1)}k`;
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

function fmtPct(value: number | string | null | undefined): string {
  const n = numberValue(value);
  if (n === null) return "Insufficient data";
  return `${n.toFixed(n % 1 === 0 ? 0 : 1)}%`;
}

function fmtDate(value: string | null | undefined): string {
  if (!value) return "Insufficient data";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Insufficient data";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(date);
}

function paymentLabel(rows: LeadPaymentRow[] | undefined): string {
  if (!rows || rows.length === 0) return "No lead payment";
  const latest = [...rows].sort((a, b) => String(b.marked_at ?? "").localeCompare(String(a.marked_at ?? "")))[0];
  const status = latest.payment_status || (latest.paid ? "confirmed" : "pending");
  const type = latest.lead_type || latest.tier || "lead";
  const amount = Number(latest.amount ?? 0);
  const amountLabel = Number.isFinite(amount) && amount > 0 ? ` · ${fmtMoney(amount)}` : "";
  return `${type} · ${status}${amountLabel}`;
}

function daysAgo(value: string | null | undefined): string {
  if (!value) return "Insufficient data";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Insufficient data";
  const days = Math.max(0, Math.floor((Date.now() - date.getTime()) / 86_400_000));
  if (days === 0) return "today";
  if (days === 1) return "1 day ago";
  if (days < 30) return `${days} days ago`;
  if (days < 365) return `${Math.floor(days / 30)} months ago`;
  return `${Math.floor(days / 365)} years ago`;
}

function agentName(agent: AgentDetailRow): string {
  return agent.profile?.full_name || agent.display_name || "—";
}

function appName(app: ApplicationDetailRow): string {
  return `${app.first_name ?? ""} ${app.last_name ?? ""}`.trim() || app.email;
}

function licensingLabel(app: ApplicationDetailRow): string {
  if (app.license_status === "licensed" || app.license_progress === "licensed" || app.licensed_at || app.license_approved_at) return "Licensed";
  if (app.exam_passed_at || app.license_progress === "exam_passed" || app.license_progress === "passed_test") return "Exam passed";
  if (app.exam_scheduled_at || app.license_progress === "test_scheduled") return "Exam scheduled";
  if (app.license_progress === "finished_course") return "Course completed";
  if (app.course_started_at) return "Course started";
  if (app.course_purchased_at || app.license_progress === "course_purchased") return "Course purchased";
  if (app.status === "paid" || app.ica_paid) return "Activation needed";
  return "Needs licensing push";
}

function isActivated(app: ApplicationDetailRow): boolean {
  return Boolean(app.ica_paid || app.ica_paid_at || app.contracted_at || app.first_deal_at || app.status === "paid" || app.status === "onboarding" || app.status === "producing");
}

function isStuck(app: ApplicationDetailRow): boolean {
  const stale = app.updated_at ? Date.now() - new Date(app.updated_at).getTime() > 10 * 86_400_000 : false;
  const overdue =
    (app.next_action_due_at && new Date(app.next_action_due_at).getTime() < Date.now()) ||
    (app.next_step_due_at && new Date(app.next_step_due_at).getTime() < Date.now());
  return Boolean(app.is_ghosted || overdue || (stale && app.license_status !== "licensed" && !isActivated(app)));
}

function compareRows(a: BuilderRow, b: BuilderRow, sortKey: SortKey): number {
  if (sortKey === "rank") {
    return (
      (numberValue(b.monthly_production) ?? -1) - (numberValue(a.monthly_production) ?? -1) ||
      b.active_agent_count - a.active_agent_count ||
      b.hires_this_month - a.hires_this_month ||
      (numberValue(b.activation_rate) ?? -1) - (numberValue(a.activation_rate) ?? -1) ||
      (numberValue(b.growth_rate) ?? -999) - (numberValue(a.growth_rate) ?? -999)
    );
  }
  if (sortKey === "stuck_applicants") return b.stuck_applicants - a.stuck_applicants;
  return (numberValue(b[sortKey]) ?? -1) - (numberValue(a[sortKey]) ?? -1);
}

function MetricCard({
  label,
  value,
  sub,
  icon: Icon,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: LucideIcon;
}) {
  return (
    <Card className="border-border/50 bg-card/70">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
            <p className="mt-1 truncate text-2xl font-semibold text-foreground">{value}</p>
            {sub ? <p className="mt-1 truncate text-xs text-muted-foreground">{sub}</p> : null}
          </div>
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-primary/20 bg-primary/10 text-primary">
            <Icon className="h-4 w-4" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function BarList({
  title,
  rows,
  value,
  formatter,
}: {
  title: string;
  rows: BuilderRow[];
  value: (row: BuilderRow) => number;
  formatter: (value: number) => string;
}) {
  const max = Math.max(1, ...rows.map(value));
  return (
    <Card className="border-border/50 bg-card/70">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Insufficient data</p>
        ) : (
          rows.slice(0, 10).map((row) => {
            const v = value(row);
            return (
              <div key={row.agent_id} className="space-y-1.5">
                <div className="flex items-center justify-between gap-3 text-xs">
                  <span className="truncate font-medium">{row.builder_name}</span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">{formatter(v)}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${Math.max(4, Math.min(100, (v / max) * 100))}%` }}
                  />
                </div>
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}

export default function BuildersDashboard({ mode = "builders" }: { mode?: DashboardMode }) {
  const params = useParams();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("rank");
  // P5: $50K+ Watchlist filter — surface high-value leaders by monthly production
  const [watchlist50k, setWatchlist50k] = useState(false);

  const modeTitle =
    mode === "agencyOwners" ? "Agency Owners" : mode === "managers" ? "Managers" : "Builders";
  usePageTitle(`${modeTitle} Dashboard · APEX`);

  const buildersQ = useQuery({
    queryKey: ["builder-operating-dashboard"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as unknown as BuilderViewClient)
        .from("v_builder_operating_dashboard")
        .select("*");
      if (error) throw error;
      return data ?? [];
    },
  });

  const agentsQ = useQuery({
    queryKey: ["builder-detail-agents", mode],
    enabled: mode !== "agencyOwners" || Boolean(params.builderId),
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as unknown as AgentDetailClient)
        .from("agents")
        .select("id, display_name, status, license_status, onboarding_stage, invited_by_manager_id, manager_id, builder_track, created_at, updated_at, profile:profiles(full_name,email,phone,state)")
        .order("created_at", { ascending: false })
        .limit(1200);
      if (error) throw error;
      return data ?? [];
    },
  });

  const applicationsQ = useQuery({
    queryKey: ["builder-detail-applications", mode],
    enabled: mode !== "agencyOwners" || Boolean(params.builderId),
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as unknown as ApplicationDetailClient)
        .from("applications")
        .select("id, first_name, last_name, email, phone, state, status, license_status, license_progress, created_at, updated_at, course_purchased_at, course_started_at, exam_scheduled_at, exam_passed_at, licensed_at, license_approved_at, contracted_at, ica_paid, ica_paid_at, first_deal_at, next_action, next_action_due_at, next_step_due_at, is_ghosted, assigned_agent_id, referral_manager_id, recruiter_id, referrer_agent_id, referral_source")
        .order("created_at", { ascending: false })
        .limit(1200);
      if (error) throw error;
      return data ?? [];
    },
  });

  const paymentsQ = useQuery({
    queryKey: ["builder-lead-payments", mode],
    enabled: mode === "agencyOwners",
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<LeadPaymentRow[]> => {
      const { data, error } = await (supabase as any)
        .from("lead_payment_tracking")
        .select("agent_id, paid, tier, payment_status, lead_type, amount, marked_at")
        .order("marked_at", { ascending: false, nullsFirst: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as LeadPaymentRow[];
    },
  });

  const rows = useMemo(() => buildersQ.data ?? [], [buildersQ.data]);
  const agents = useMemo(() => agentsQ.data ?? [], [agentsQ.data]);
  const applications = useMemo(() => applicationsQ.data ?? [], [applicationsQ.data]);

  const filteredBase = useMemo(() => {
    let base = rows.filter((row) => row.is_builder);
    if (mode === "managers") {
      base = base.filter((row) => row.earned_title === "Manager" || row.earned_title === "Agency Owner Track - Not Qualified Yet");
    }
    if (mode === "agencyOwners") {
      base = base.filter((row) => row.earned_title === "Agency Owner");
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      base = base.filter((row) =>
        [row.builder_name, row.email, row.phone, row.state, row.earned_title, TRACK_LABEL[row.builder_track]]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(q)),
      );
    }
    if (watchlist50k) {
      // P5: $50K+ Watchlist — keep only builders with monthly_production above 50000.
      // String/number coercion is safe because monthly_production is the only
      // numeric-ish field surfaced in the BuilderRow shape.
      base = base.filter((row) => {
        const v = numberValue(row.monthly_production);
        return v !== null && v >= 50000;
      });
    }
    return base;
  }, [mode, rows, search, watchlist50k]);

  const rankedRows = useMemo(
    () => [...filteredBase].sort((a, b) => compareRows(a, b, sortKey)),
    [filteredBase, sortKey],
  );

  const allBuilders = useMemo(() => rows.filter((row) => row.is_builder), [rows]);
  const topBuilder = useMemo(() => [...allBuilders].sort((a, b) => compareRows(a, b, "rank"))[0] ?? null, [allBuilders]);
  const fastestGrowing = useMemo(() => {
    return [...allBuilders]
      .filter((row) => numberValue(row.growth_rate) !== null)
      .sort((a, b) => (numberValue(b.growth_rate) ?? -999) - (numberValue(a.growth_rate) ?? -999))[0] ?? null;
  }, [allBuilders]);

  const summary = useMemo(() => {
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const activeAgents = rows.filter((row) => row.status === "active").length;
    const hiresThisMonth = rows.filter((row) => new Date(row.created_at) >= monthStart).length;
    const activeApps = applications.filter((app) => !["rejected", "disqualified", "lapsed"].includes(String(app.status)));
    const licensed = activeApps.filter((app) => app.license_status === "licensed" || app.license_progress === "licensed" || app.licensed_at || app.license_approved_at).length;
    const unlicensed = activeApps.length - licensed;
    const courseworkDone = activeApps.filter((app) =>
      ["finished_course", "test_scheduled", "passed_test", "exam_passed", "fingerprints_done", "waiting_fingerprints", "waiting_on_license", "licensed", "in_field_training"].includes(String(app.license_progress)),
    ).length;
    const activations = activeApps.filter(isActivated).length;
    const stuck = activeApps.filter(isStuck).length;

    return {
      totalBuilders: allBuilders.length,
      managers: rows.filter((row) => row.earned_title === "Manager" || row.earned_title === "Agency Owner Track - Not Qualified Yet").length,
      agencyOwners: rows.filter((row) => row.earned_title === "Agency Owner").length,
      totalAgents: rows.length,
      activeAgents,
      hiresThisMonth,
      licensed,
      unlicensed,
      stuck,
      courseworkRate: activeApps.length ? (courseworkDone / activeApps.length) * 100 : null,
      activationRate: activeApps.length ? (activations / activeApps.length) * 100 : null,
    };
  }, [allBuilders.length, applications, rows]);

  const childrenByParent = useMemo(() => {
    const map = new Map<string, AgentDetailRow[]>();
    for (const agent of agents) {
      for (const parentId of [agent.invited_by_manager_id, agent.manager_id]) {
        if (!parentId || parentId === agent.id) continue;
        const current = map.get(parentId) ?? [];
        if (!current.some((item) => item.id === agent.id)) current.push(agent);
        map.set(parentId, current);
      }
    }
    return map;
  }, [agents]);

  const selected = useMemo(() => {
    if (params.builderId) return rows.find((row) => row.agent_id === params.builderId) ?? rankedRows[0] ?? null;
    return rankedRows[0] ?? null;
  }, [params.builderId, rankedRows, rows]);

  const selectedDownlineIds = useMemo(() => {
    if (!selected) return new Set<string>();
    const ids = new Set<string>([selected.agent_id]);
    const stack = [...(childrenByParent.get(selected.agent_id) ?? [])];
    while (stack.length) {
      const agent = stack.pop();
      if (!agent || ids.has(agent.id)) continue;
      ids.add(agent.id);
      stack.push(...(childrenByParent.get(agent.id) ?? []));
    }
    return ids;
  }, [childrenByParent, selected]);

  const directAgents = useMemo(() => {
    if (!selected) return [];
    return (childrenByParent.get(selected.agent_id) ?? []).sort((a, b) => agentName(a).localeCompare(agentName(b)));
  }, [childrenByParent, selected]);

  const selectedApplications = useMemo(() => {
    if (!selected) return [];
    return applications.filter((app) => {
      const ids = [app.referrer_agent_id, app.referral_manager_id, app.recruiter_id, app.assigned_agent_id].filter(Boolean) as string[];
      return ids.some((id) => selectedDownlineIds.has(id));
    });
  }, [applications, selected, selectedDownlineIds]);

  const paymentsByAgent = useMemo(() => {
    const map = new Map<string, LeadPaymentRow[]>();
    for (const row of paymentsQ.data ?? []) {
      const current = map.get(row.agent_id) ?? [];
      current.push(row);
      map.set(row.agent_id, current);
    }
    return map;
  }, [paymentsQ.data]);

  const recentActivityCount = useMemo(() => {
    const weekAgo = Date.now() - 7 * 86_400_000;
    const agentActivity = agents.filter((agent) => selectedDownlineIds.has(agent.id) && agent.updated_at && new Date(agent.updated_at).getTime() >= weekAgo).length;
    const appActivity = selectedApplications.filter((app) => app.updated_at && new Date(app.updated_at).getTime() >= weekAgo).length;
    return agentActivity + appActivity;
  }, [agents, selectedApplications, selectedDownlineIds]);

  const analyticsRows = useMemo(() => [...allBuilders].sort((a, b) => compareRows(a, b, "rank")), [allBuilders]);
  const productionRows = useMemo(
    () => analyticsRows.filter((row) => numberValue(row.monthly_production) !== null).sort((a, b) => (numberValue(b.monthly_production) ?? 0) - (numberValue(a.monthly_production) ?? 0)),
    [analyticsRows],
  );
  const activeRows = useMemo(() => [...analyticsRows].sort((a, b) => b.active_agent_count - a.active_agent_count), [analyticsRows]);
  const stuckRows = useMemo(() => [...analyticsRows].filter((row) => row.stuck_applicants > 0).sort((a, b) => b.stuck_applicants - a.stuck_applicants), [analyticsRows]);
  const qualificationRows = useMemo(
    () => [...analyticsRows].sort((a, b) => Math.min(b.active_agent_count, b.total_downline_count) - Math.min(a.active_agent_count, a.total_downline_count)),
    [analyticsRows],
  );

  const copyLink = async (value: string, label = "Link") => {
    await navigator.clipboard.writeText(value);
    toast.success(`${label} copied`);
  };

  const loading = buildersQ.isLoading || agentsQ.isLoading || applicationsQ.isLoading;
  const error = buildersQ.error || agentsQ.error || applicationsQ.error;

  return (
    <div className="page-enter px-4 pb-24 sm:px-6">
      <PageHeader
        eyebrow="Recruiting Operating System"
        eyebrowIcon={<Network className="h-3 w-3" />}
        title={modeTitle}
        subtitle="Builder ranking, licensing pressure, agency-owner qualification, referral links, and downline visibility."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant={mode === "builders" ? "default" : "outline"} size="sm">
              <Link to="/dashboard/builders">Builders</Link>
            </Button>
            <Button asChild variant={mode === "managers" ? "default" : "outline"} size="sm">
              <Link to="/dashboard/managers">Managers</Link>
            </Button>
            <Button asChild variant={mode === "agencyOwners" ? "default" : "outline"} size="sm">
              <Link to="/dashboard/agency-owners">Agency Owners</Link>
            </Button>
          </div>
        }
      />

      {error ? (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="p-4 text-sm text-destructive">
            Builder dashboard could not load: {error instanceof Error ? error.message : "something went wrong — refresh to try again"}
          </CardContent>
        </Card>
      ) : null}

      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Total builders" value={fmtInt(summary.totalBuilders)} sub="Tracks, downlines, or recruit ownership" icon={Network} />
        <MetricCard label="Managers" value={fmtInt(summary.managers)} sub="Not agency-owner qualified yet" icon={UserCog} />
        <MetricCard label="Agency owners" value={fmtInt(summary.agencyOwners)} sub="10 active and 10 total downline" icon={Crown} />
        <MetricCard label="Total agents" value={fmtInt(summary.totalAgents)} sub={`${fmtInt(summary.activeAgents)} active agents`} icon={Users} />
        <MetricCard label="Hires this month" value={fmtInt(summary.hiresThisMonth)} sub="Agent records created this month" icon={CheckCircle2} />
        <MetricCard label="Licensed recruits" value={fmtInt(summary.licensed)} sub={`${fmtInt(summary.unlicensed)} unlicensed recruits`} icon={GraduationCap} />
        <MetricCard label="Stuck applicants" value={fmtInt(summary.stuck)} sub="Overdue, ghosted, or stalled licensing" icon={PhoneCall} />
        <MetricCard label="Coursework completion" value={fmtPct(summary.courseworkRate)} sub={`Activation ${fmtPct(summary.activationRate)}`} icon={ShieldCheck} />
        <MetricCard label="Monthly production" value={fmtMoney(topBuilder?.monthly_production)} sub={topBuilder ? `Top leg: ${topBuilder.builder_name}` : "Insufficient data"} icon={BarChart3} />
        <MetricCard label="Month growth" value={fastestGrowing && new Date().getDate() > 7 ? fmtPct(fastestGrowing.growth_rate) : "Building"} sub={new Date().getDate() > 7 ? (fastestGrowing?.builder_name ?? "Needs production history") : "Month just started"} icon={TrendingUp} />
        <MetricCard label="Top builder" value={topBuilder?.builder_name ?? "Insufficient data"} sub={topBuilder ? topBuilder.action_needed : "No builder data"} icon={Crown} />
        <MetricCard label="Fastest growing" value={fastestGrowing?.builder_name ?? "Insufficient data"} sub={fastestGrowing && new Date().getDate() > 7 ? fmtPct(fastestGrowing.growth_rate) : "Growth vs last month · from day 8"} icon={ArrowRight} />
      </div>

      <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card className="border-border/50 bg-card/70">
          <CardHeader className="gap-3 border-b border-border/50 pb-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <CardTitle className="flex items-center gap-2 text-base">
                  <ArrowDownUp className="h-4 w-4 text-primary" />
                  Builder rankings
                </CardTitle>
                <p className="mt-1 text-xs text-muted-foreground">
                  Default rank: monthly production, active agents, new hires, activation rate, then growth.
                </p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button
                  variant={watchlist50k ? "default" : "outline"}
                  size="sm"
                  onClick={() => setWatchlist50k((v) => !v)}
                  className="h-9 shrink-0"
                  aria-pressed={watchlist50k}
                >
                  $50K+ Watchlist
                </Button>
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search builders..."
                    className="h-9 pl-8 sm:w-64"
                  />
                </div>
                <Select value={sortKey} onValueChange={(value) => setSortKey(value as SortKey)}>
                  <SelectTrigger className="h-9 sm:w-56">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(SORT_LABELS) as SortKey[]).map((key) => (
                      <SelectItem key={key} value={key}>
                        {SORT_LABELS[key]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading builder operating data...
              </div>
            ) : rankedRows.length === 0 ? (
              <div className="p-6 text-sm text-muted-foreground">No builders match this view.</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/30 hover:bg-muted/30">
                    <TableHead className="w-14">Rank</TableHead>
                    <TableHead className="min-w-[190px]">Builder</TableHead>
                    <TableHead>Earned title</TableHead>
                    <TableHead>Track</TableHead>
                    <TableHead className="text-right">Active</TableHead>
                    <TableHead className="text-right">Downline</TableHead>
                    <TableHead className="text-right">Hires</TableHead>
                    <TableHead className="text-right">Licensed</TableHead>
                    <TableHead className="text-right">Unlicensed</TableHead>
                    <TableHead className="text-right">Coursework</TableHead>
                    <TableHead className="text-right">Activation</TableHead>
                    <TableHead className="text-right">Production</TableHead>
                    <TableHead className="text-right">Growth</TableHead>
                    <TableHead className="text-right">Stuck</TableHead>
                    <TableHead>Referral</TableHead>
                    <TableHead>Last activity</TableHead>
                    <TableHead>Action needed</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rankedRows.map((row, index) => {
                    const selectedRow = selected?.agent_id === row.agent_id;
                    return (
                      <TableRow
                        key={row.agent_id}
                        className={cn("cursor-pointer", selectedRow && "bg-primary/5")}
                        onClick={() => navigate(`/dashboard/builders/${row.agent_id}`)}
                      >
                        <TableCell className="font-semibold tabular-nums">{index + 1}</TableCell>
                        <TableCell>
                          <div className="font-medium">{row.builder_name}</div>
                          <div className="text-xs text-muted-foreground">{row.email ?? row.state ?? "No contact data"}</div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={cn("whitespace-nowrap", TITLE_TONE[row.earned_title] ?? TITLE_TONE.Agent)}>
                            {row.earned_title}
                          </Badge>
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-sm text-muted-foreground">{TRACK_LABEL[row.builder_track]}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmtInt(row.active_agent_count)}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmtInt(row.total_downline_count)}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmtInt(row.hires_this_month)}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmtInt(row.licensed_recruits)}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmtInt(row.unlicensed_recruits)}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmtPct(row.coursework_completion_rate)}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmtPct(row.activation_rate)}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmtMoney(row.monthly_production)}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmtPct(row.growth_rate)}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          <span className={row.stuck_applicants > 0 ? "text-rose-400" : ""}>{fmtInt(row.stuck_applicants)}</span>
                        </TableCell>
                        <TableCell>
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8"
                            onClick={(event) => {
                              event.stopPropagation();
                              void copyLink(row.application_link, "Application link");
                            }}
                            aria-label={`Copy referral link for ${row.builder_name}`}
                          >
                            <Copy className="h-4 w-4" />
                          </Button>
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-sm text-muted-foreground">{daysAgo(row.last_activity_at)}</TableCell>
                        <TableCell className="min-w-[160px] text-sm">{row.action_needed}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card className="border-border/50 bg-card/70">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Next call list</CardTitle>
            <p className="text-xs text-muted-foreground">Highest stuck count first, then weak activity.</p>
          </CardHeader>
          <CardContent className="space-y-2">
            {stuckRows.slice(0, 8).map((row) => (
              <button
                key={row.agent_id}
                type="button"
                onClick={() => navigate(`/dashboard/builders/${row.agent_id}`)}
                className="w-full rounded-md border border-border/50 bg-background/60 p-3 text-left transition hover:border-primary/40"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="truncate text-sm font-medium">{row.builder_name}</span>
                  <Badge variant="outline" className="border-rose-400/40 bg-rose-400/10 text-rose-300">
                    {row.stuck_applicants} stuck
                  </Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{row.action_needed}</p>
              </button>
            ))}
            {stuckRows.length === 0 ? <p className="text-sm text-muted-foreground">No stuck builder legs in this view.</p> : null}
          </CardContent>
        </Card>
      </div>

      {selected ? (
        <div className="mt-5 grid gap-4 xl:grid-cols-[420px_minmax(0,1fr)]">
          <Card className="border-border/50 bg-card/70">
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle className="text-lg">{selected.builder_name}</CardTitle>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Badge variant="outline" className={cn(TITLE_TONE[selected.earned_title] ?? TITLE_TONE.Agent)}>
                      {selected.earned_title}
                    </Badge>
                    <Badge variant="outline">{TRACK_LABEL[selected.builder_track]}</Badge>
                  </div>
                </div>
                <Button asChild variant="ghost" size="icon"
                aria-label="Copy referral link">
                  <Link to={`/agent/${selected.agent_id}`} aria-label="Open agent profile">
                    <ExternalLink className="h-4 w-4" />
                  </Link>
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <MiniStat label="Rank" value={`#${Math.max(1, rankedRows.findIndex((row) => row.agent_id === selected.agent_id) + 1)}`} />
                <MiniStat label="Monthly production" value={fmtMoney(selected.monthly_production)} />
                <MiniStat label="Active agents" value={fmtInt(selected.active_agent_count)} />
                <MiniStat label="Total downline" value={fmtInt(selected.total_downline_count)} />
                <MiniStat label="New hires" value={fmtInt(selected.hires_this_month)} />
                <MiniStat label="Growth" value={fmtPct(selected.growth_rate)} />
                <MiniStat label="Licensed" value={fmtInt(selected.licensed_recruits)} />
                <MiniStat label="Unlicensed" value={fmtInt(selected.unlicensed_recruits)} />
                <MiniStat label="Coursework" value={fmtPct(selected.coursework_completion_rate)} />
                <MiniStat label="Activation" value={fmtPct(selected.activation_rate)} />
                <MiniStat label="Stuck" value={fmtInt(selected.stuck_applicants)} />
                <MiniStat label="Last 7 days" value={fmtInt(recentActivityCount)} />
                {mode === "agencyOwners" ? (
                  <MiniStat label="Lead/payment" value={paymentLabel(paymentsByAgent.get(selected.agent_id))} />
                ) : null}
              </div>

              <div className="rounded-md border border-border/50 bg-background/60 p-3">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <ShieldCheck className="h-4 w-4 text-primary" />
                  Agency-owner qualification
                </div>
                <div className="mt-3 space-y-2">
                  <QualificationBar label="Active agents" value={selected.active_agent_count} target={10} />
                  <QualificationBar label="Total downline" value={selected.total_downline_count} target={10} />
                </div>
                {selected.monthly_production_available ? (
                  <p className="mt-3 text-xs text-muted-foreground">
                    Production: {selected.above_100k_monthly ? "above" : "below"} $100,000/month.
                  </p>
                ) : (
                  <p className="mt-3 text-xs text-muted-foreground">Production threshold: insufficient data.</p>
                )}
              </div>

              <div className="rounded-md border border-border/50 bg-background/60 p-3">
                <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                  <LinkIcon className="h-4 w-4 text-primary" />
                  Referral links
                </div>
                <LinkRow label="Personal" value={selected.referral_link} onCopy={() => copyLink(selected.referral_link, "Personal referral link")} />
                <LinkRow label="Application" value={selected.application_link} onCopy={() => copyLink(selected.application_link, "Application link")} />
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                  <span>Applicants: {fmtInt(selected.applicants_from_referral_link)}</span>
                  <span>Licensed: {fmtInt(selected.licensed_from_referral_link)}</span>
                  <span>Activated: {fmtInt(selected.activated_from_referral_link)}</span>
                  <span>Conversion: {fmtPct(selected.referral_conversion_rate)}</span>
                </div>
              </div>

              <div className="rounded-md border border-border/50 bg-background/60 p-3">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Next action</p>
                <p className="mt-1 text-sm font-semibold">{selected.action_needed}</p>
              </div>
            </CardContent>
          </Card>

          <div className="space-y-4">
            <Card className="border-border/50 bg-card/70">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Agency leg</CardTitle>
                <p className="text-xs text-muted-foreground">
                  Direct agents first. Total leg includes nested downline when present.
                </p>
              </CardHeader>
              <CardContent>
                {directAgents.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No direct agents under this builder yet.</p>
                ) : (
                  <div className="grid gap-2 md:grid-cols-2">
                    {directAgents.map((agent) => (
                      <div key={agent.id} className="rounded-md border border-border/50 bg-background/60 p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">{agentName(agent)}</p>
                            <p className="truncate text-xs text-muted-foreground">{agent.profile?.email ?? "No email"}</p>
                          </div>
                          <Badge variant="outline" className="shrink-0">
                            {agent.status ?? "unknown"}
                          </Badge>
                        </div>
                        <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                          <span>License: {agent.license_status ?? "unknown"}</span>
                          <span className="inline-flex items-center gap-1" onClick={(e) => e.stopPropagation()}>Stage: <HireStageSelect agentId={agent.id} name={agentName(agent)} stage={agent.onboarding_stage} licenseStatus={agent.license_status ?? null} email={agent.profile?.email ?? undefined} /></span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="border-border/50 bg-card/70">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Applicants in pipeline</CardTitle>
                <p className="text-xs text-muted-foreground">
                  Stuck and licensing-needed recruits are shown first.
                </p>
              </CardHeader>
              <CardContent>
                {selectedApplications.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No attributed applicants found for this leg.</p>
                ) : (
                  <div className="space-y-2">
                    {[...selectedApplications]
                      .sort((a, b) => Number(isStuck(b)) - Number(isStuck(a)) || new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
                      .slice(0, 12)
                      .map((app) => (
                        <div key={app.id} className="rounded-md border border-border/50 bg-background/60 p-3">
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium">{appName(app)}</p>
                              <p className="truncate text-xs text-muted-foreground">
                                {app.email} {app.phone ? `- ${app.phone}` : ""}
                              </p>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {isStuck(app) ? (
                                <Badge variant="outline" className="border-rose-400/40 bg-rose-400/10 text-rose-300">
                                  Stuck
                                </Badge>
                              ) : null}
                              <Badge variant="outline">{licensingLabel(app)}</Badge>
                            </div>
                          </div>
                          <div className="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-4">
                            <span>Status: {app.status ?? "unknown"}</span>
                            <span>Applied: {fmtDate(app.created_at)}</span>
                            <span>Updated: {daysAgo(app.updated_at)}</span>
                            <span>Next: {app.next_action ?? selected.action_needed}</span>
                          </div>
                        </div>
                      ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      ) : null}

      <div className="mt-5 grid gap-4 xl:grid-cols-2">
        <BarList title="Active agents by builder" rows={activeRows} value={(row) => row.active_agent_count} formatter={fmtInt} />
        <BarList title="Monthly production by builder" rows={productionRows} value={(row) => numberValue(row.monthly_production) ?? 0} formatter={(value) => fmtMoney(value)} />
        <BarList title="Stuck applicants by builder" rows={stuckRows} value={(row) => row.stuck_applicants} formatter={fmtInt} />
        <BarList
          title="Agency-owner qualification progress"
          rows={qualificationRows}
          value={(row) => Math.min(100, (Math.min(row.active_agent_count, row.total_downline_count) / 10) * 100)}
          formatter={(value) => `${Math.round(value)}%`}
        />
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border/50 bg-background/60 p-3">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 truncate text-sm font-semibold">{value}</p>
    </div>
  );
}

function QualificationBar({ label, value, target }: { label: string; value: number; target: number }) {
  const pct = Math.min(100, (value / target) * 100);
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium tabular-nums">
          {value}/{target}
        </span>
      </div>
      <Progress value={pct} className="h-2" />
    </div>
  );
}

function LinkRow({ label, value, onCopy }: { label: string; value: string; onCopy: () => void }) {
  return (
    <div className="flex items-center gap-2 py-1">
      <span className="w-20 shrink-0 text-xs font-medium text-muted-foreground">{label}</span>
      <span className="min-w-0 flex-1 truncate text-xs">{value}</span>
      <Button type="button" size="icon"
      aria-label="Copy to clipboard" variant="ghost" className="h-7 w-7 shrink-0" onClick={onCopy}>
        <Copy className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
