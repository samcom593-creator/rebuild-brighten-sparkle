// PreLicensing — daily XCEL Solutions report viewer.
//
// Reads v_xcel_latest (last seeded report) and shows:
//   - Pipeline summary (enrolled / active / % completed)
//   - Health buckets (completed / almost done / in progress / just started / stalled)
//   - Per-section student grid (Code & Ethics, Life Only, Life & Health)
//   - Each row: name, % complete bar, last login, hours, status, jump to application

import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  GraduationCap, Clock, Mail, Phone, CheckCircle2, Flame,
  AlertCircle, AlertTriangle, Calendar, TrendingUp, Filter, Search, ExternalLink,
  RefreshCw, BookOpen, FileText, Sparkles, CalendarRange, XCircle,
} from "lucide-react";
import { format, parseISO, differenceInDays } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useMyDownline } from "@/hooks/useMyDownline";
import { usePageTitle } from "@/hooks/usePageTitle";
import { PageHeader } from "@/components/ui/page-header";
import { GlassCard } from "@/components/ui/glass-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { XcelIngestDialog } from "@/components/admin/XcelIngestDialog";
import { contactLinkProps, formatPhoneDisplay, phoneHref } from "@/lib/phone";

interface Report {
  id: string;
  report_date: string;
  enrolled_last_30d: number | null;
  enrolled_last_7d: number | null;
  active_last_10d: number | null;
  active_pipeline: number | null;
  pct_completed: number | string | null;
  received_at: string;
}

interface XcelStudent {
  id: string;
  course_section: string;
  course_name: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  date_enrolled: string | null;
  last_log_in: string | null;
  time_spent_minutes: number | null;
  pct_complete: number | string | null;
  date_completed: string | null;
  hiring_manager_name: string | null;
  application_id: string | null;
  matched_at: string | null;
  application_status: string | null;
  application_license_progress: string | null;
  assigned_agent_name: string | null;
  days_since_login: number | null;
  health_bucket: "completed" | "almost_done" | "in_progress" | "just_started" | "stalled";
}

const SECTION_META: Record<string, { label: string; color: string }> = {
  code_and_ethics:  { label: "Code & Ethics",          color: "bg-violet-500/15 text-violet-400 border-violet-500/40" },
  life_only:        { label: "Life Only",              color: "bg-emerald-500/15 text-emerald-400 border-emerald-500/40" },
  life_and_health:  { label: "Life & Health",          color: "bg-amber-500/15 text-amber-400 border-amber-500/40" },
};

const HEALTH_META: Record<XcelStudent["health_bucket"], { label: string; color: string; icon: React.ElementType }> = {
  completed:    { label: "Completed",   color: "bg-emerald-500/15 text-emerald-400 border-emerald-500/40", icon: CheckCircle2 },
  almost_done:  { label: "Almost done", color: "bg-slate-500/15 text-foreground border-info/30",         icon: TrendingUp },
  in_progress:  { label: "In progress", color: "bg-primary/15 text-primary border-primary/40",            icon: BookOpen },
  just_started: { label: "Just started", color: "bg-info/15 text-info border-info/30",        icon: Sparkles },
  stalled:      { label: "Stalled",     color: "bg-rose-500/15 text-rose-400 border-rose-500/40",         icon: AlertCircle },
};

function fmtPhone(p: string | null): string {
  if (!p) return "—";
  return formatPhoneDisplay(p) || p;
}

function fmtHours(min: number | null): string {
  if (!min || min <= 0) return "0h";
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h >= 100) return `${h}h`;
  if (h >= 10) return `${h}h ${m}m`;
  return `${h}h ${m}m`;
}

function producerTypeLabel(s: XcelStudent): string {
  const hay = [
    s.course_name,
    s.application_status,
    s.application_license_progress,
    s.hiring_manager_name,
  ].filter(Boolean).join(" ").toLowerCase();
  if (hay.includes("agency owner") || hay.includes("owner")) return "Agency owner";
  if (hay.includes("solo")) return "Solo producer";
  if (s.assigned_agent_name || s.hiring_manager_name) return "Solo producer";
  return "Producer";
}

function nextStepLabel(s: XcelStudent): string {
  const pct = Number(s.pct_complete ?? 0);
  if (s.date_completed || pct >= 100) return "Confirm exam/licensing";
  if (s.health_bucket === "stalled") return "Manager follow-up today";
  if (pct >= 80) return "Finish course + schedule exam";
  if (pct >= 40) return "Keep course pace";
  if (pct > 0) return "Push next module";
  return "Get first login";
}

export default function PreLicensing() {
  usePageTitle("Pre-Licensing · APEX");

  const { isAdmin, isManager } = useAuth();
  const downline = useMyDownline();

  const [search, setSearch] = useState("");
  const [sectionFilter, setSectionFilter] = useState<string>("__all__");
  const [healthFilter, setHealthFilter] = useState<string>("__all__");
  // PL-061: custom date-enrolled range. Empty strings = no bound.
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");
  const [visibleCount, setVisibleCount] = useState(100);

  const reportQ = useQuery({
    queryKey: ["xcel-report-latest"],
    refetchInterval: 300_000,
    staleTime: 90_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("xcel_pre_licensing_reports" as any)
        .select("*")
        .order("report_date", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as unknown as Report | null;
    },
  });

  const studentsQ = useQuery({
    queryKey: ["xcel-students-latest"],
    refetchInterval: 300_000,
    staleTime: 90_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_xcel_latest" as any)
        .select("id, course_section, course_name, first_name, last_name, email, phone, date_enrolled, last_log_in, time_spent_minutes, pct_complete, date_completed, hiring_manager_name, application_id, matched_at, application_status, application_license_progress, assigned_agent_name, days_since_login, health_bucket")
        .order("pct_complete", { ascending: false })
        .limit(600);
      if (error) throw error;
      return (data ?? []) as unknown as XcelStudent[];
    },
  });

  // Stabilize the reference so useMemo deps don't change every render.
  const students = useMemo(() => studentsQ.data ?? [], [studentsQ.data]);

  // PL-061: manager downline names — for non-admin managers we restrict the
  // student list to their own recruits (matched via the agents.assigned_agent
  // string on each XCEL student row).
  const downlineNamesQ = useQuery({
    queryKey: ["xcel-downline-names", downline.data ?? []],
    enabled: !isAdmin && isManager && !!(downline.data?.length),
    queryFn: async (): Promise<Set<string>> => {
      const ids = downline.data ?? [];
      if (ids.length === 0) return new Set();
      const { data, error } = await supabase
        .from("agents")
        .select("display_name, profile:profiles(full_name)")
        .in("id", ids);
      if (error) {

        return new Set();
      }
      const set = new Set<string>();
      for (const row of (data ?? []) as any[]) {
        if (row.display_name) set.add(String(row.display_name).toLowerCase().trim());
        if (row.profile?.full_name) set.add(String(row.profile.full_name).toLowerCase().trim());
      }
      return set;
    },
    staleTime: 5 * 60_000,
  });

  // Scope students to manager downline if non-admin manager.
  const scopedStudents = useMemo(() => {
    if (isAdmin || !isManager) return students;
    const names = downlineNamesQ.data;
    if (!names || names.size === 0) return students;
    return students.filter((s) => {
      const agent = String(s.assigned_agent_name ?? "").toLowerCase().trim();
      const mgr = String(s.hiring_manager_name ?? "").toLowerCase().trim();
      return (agent && names.has(agent)) || (mgr && names.has(mgr));
    });
  }, [students, isAdmin, isManager, downlineNamesQ.data]);

  const counts = useMemo(() => {
    const byBucket: Record<string, number> = {};
    for (const s of scopedStudents) byBucket[s.health_bucket] = (byBucket[s.health_bucket] ?? 0) + 1;
    const bySection: Record<string, number> = {};
    for (const s of scopedStudents) bySection[s.course_section] = (bySection[s.course_section] ?? 0) + 1;
    return { byBucket, bySection };
  }, [scopedStudents]);

  const filtered = useMemo(() => {
    let r = scopedStudents;
    if (sectionFilter !== "__all__") r = r.filter((s) => s.course_section === sectionFilter);
    if (healthFilter !== "__all__") r = r.filter((s) => s.health_bucket === healthFilter);
    // PL-061: date-enrolled range filter (inclusive, ISO YYYY-MM-DD)
    if (dateFrom) r = r.filter((s) => (s.date_enrolled ?? "") >= dateFrom);
    if (dateTo) r = r.filter((s) => (s.date_enrolled ?? "") <= dateTo);
    if (search.trim()) {
      const q = search.toLowerCase();
      r = r.filter(
        (s) =>
          (s.first_name ?? "").toLowerCase().includes(q) ||
          (s.last_name ?? "").toLowerCase().includes(q) ||
          (s.email ?? "").toLowerCase().includes(q) ||
          (s.course_name ?? "").toLowerCase().includes(q) ||
          (s.assigned_agent_name ?? "").toLowerCase().includes(q),
      );
    }
    return r;
  }, [scopedStudents, sectionFilter, healthFilter, dateFrom, dateTo, search]);

  const report = reportQ.data;
  const pctCompleted = Number(report?.pct_completed ?? 0);

  return (
    <div className="page-enter px-4 sm:px-6 pb-24 space-y-5">
      <PageHeader
        eyebrow="Recruiting · Pre-Licensing"
        eyebrowIcon={<GraduationCap className="h-3 w-3" />}
        title="Pre-Licensing Course Progress"
        subtitle={
          <>
            Daily snapshot from <span className="text-foreground font-medium">XCEL Solutions</span>.
            {report?.report_date && <> Last report: <span className="text-foreground font-medium">{format(parseISO(report.report_date), "PPP")}</span></>}
            {report?.received_at && <> · ingested {format(parseISO(report.received_at), "h:mm a")}</>}
          </>
        }
        accent="purple"
        actions={(() => {
          const lastReportDate = report?.report_date ? parseISO(report.report_date) : null;
          const isStale = lastReportDate ? differenceInDays(new Date(), lastReportDate) > 2 : false;
          return (
            <div className="flex items-center gap-2">
              <Badge variant="outline" className={isStale
                ? "bg-amber-500/10 text-amber-400 border-amber-500/40"
                : "bg-emerald-500/10 text-emerald-400 border-emerald-500/40"
              }>
                <span className={`h-1.5 w-1.5 rounded-full mr-1.5 ${isStale ? "bg-amber-500" : "bg-emerald-500 animate-pulse"}`} />
                {isStale ? "Stale" : "Live"}
              </Badge>
              <Button onClick={() => { reportQ.refetch(); studentsQ.refetch(); }} variant="outline" size="sm">
                <RefreshCw className="h-4 w-4 mr-1.5" /> Refresh
              </Button>
              <XcelIngestDialog />
            </div>
          );
        })()}
      />

      {/* P2: stale-feed banner — surfaces the known-dead XCEL Gmail pull
          so Sam doesn't mistake the page's stale data for fresh data. */}
      {(() => {
        const lastReportDate = report?.report_date ? parseISO(report.report_date) : null;
        const staleDays = lastReportDate ? differenceInDays(new Date(), lastReportDate) : null;
        if (staleDays == null || staleDays <= 2) return null;
        return (
          <div className="flex items-center gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <div className="flex-1">
              <div className="font-semibold">Data lagging — last refresh {staleDays} days ago</div>
              <div className="text-xs text-amber-200/80">
                XCEL Gmail pull awaiting OAuth seed (system_settings.gmail_xcel_oauth).
                Numbers below are accurate as of last sync, not real-time.
              </div>
            </div>
          </div>
        );
      })()}

      {/* Summary tiles */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <SummaryTile icon={GraduationCap} label="Active in pipeline" value={report?.active_pipeline ?? 0} color="text-primary" loading={reportQ.isLoading} />
        <SummaryTile icon={Calendar}      label="Enrolled · last 30d" value={report?.enrolled_last_30d ?? 0} color="text-violet-400" loading={reportQ.isLoading} />
        <SummaryTile icon={Sparkles}      label="Enrolled · last 7d"  value={report?.enrolled_last_7d ?? 0}  color="text-foreground"   loading={reportQ.isLoading} />
        <SummaryTile icon={TrendingUp}    label="Active · last 10d"   value={report?.active_last_10d ?? 0}   color="text-amber-400"  loading={reportQ.isLoading} />
        <SummaryTile icon={CheckCircle2}  label="% Completed"         value={`${Math.round(pctCompleted)}%`} color="text-emerald-400" loading={reportQ.isLoading} />
      </div>

      {/* Health buckets bar */}
      <GlassCard className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold">Student health</p>
            <h3 className="text-lg font-bold">Where your enrollees sit right now</h3>
          </div>
          <Badge variant="outline" className="text-xs">
            {scopedStudents.length} students
            {!isAdmin && isManager ? <span className="ml-1 text-muted-foreground">· your downline</span> : null}
          </Badge>
        </div>
        {studentsQ.isLoading ? (
          <Skeleton className="h-10 w-full" />
        ) : scopedStudents.length === 0 ? (
          <EmptyState
            icon={<GraduationCap className="h-6 w-6" />}
            title="No XCEL report ingested yet"
            description="Once the daily XCEL email is parsed, every enrolled student lands here with their progress, last-login, and stalled-bucket flag."
          />
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            {(Object.keys(HEALTH_META) as Array<XcelStudent["health_bucket"]>).map((b) => {
              const meta = HEALTH_META[b];
              const Icon = meta.icon;
              const n = counts.byBucket[b] ?? 0;
              return (
                <button
                  key={b}
                  type="button"
                  onClick={() => setHealthFilter(healthFilter === b ? "__all__" : b)}
                  className={`rounded-lg border px-3 py-2.5 text-left transition-all ${meta.color} ${
                    healthFilter === b ? "ring-2 ring-primary" : "hover:scale-[1.02]"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <Icon className="h-4 w-4" />
                    <span className="text-xl font-bold tabular-nums">{n}</span>
                  </div>
                  <p className="text-[11px] uppercase tracking-wider font-semibold mt-1">{meta.label}</p>
                </button>
              );
            })}
          </div>
        )}
      </GlassCard>

      {/* Filter strip */}
      <GlassCard className="p-3">
        <div className="flex flex-col gap-2 md:flex-row md:items-center">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, email, course, agent"
              className="pl-9"
            />
          </div>
          <Select value={sectionFilter} onValueChange={setSectionFilter}>
            <SelectTrigger className="md:w-[180px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All courses</SelectItem>
              {Object.entries(SECTION_META).map(([k, m]) => (
                <SelectItem key={k} value={k}>{m.label} {counts.bySection[k] ? `(${counts.bySection[k]})` : ""}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={healthFilter} onValueChange={setHealthFilter}>
            <SelectTrigger className="md:w-[160px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All status</SelectItem>
              {(Object.keys(HEALTH_META) as Array<XcelStudent["health_bucket"]>).map((b) => (
                <SelectItem key={b} value={b}>{HEALTH_META[b].label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {/* PL-061: date-enrolled range — applies to date_enrolled column */}
          <div className="flex items-center gap-1.5 md:gap-2 text-xs">
            <CalendarRange className="h-4 w-4 text-muted-foreground shrink-0" />
            <Input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="h-9 w-[140px] text-xs"
              aria-label="Date enrolled from"
            />
            <span className="text-muted-foreground">→</span>
            <Input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="h-9 w-[140px] text-xs"
              aria-label="Date enrolled to"
            />
            {(dateFrom || dateTo) && (
              <Button variant="ghost" size="sm" className="h-9 px-2" onClick={() => { setDateFrom(""); setDateTo(""); }}>
                <XCircle className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
          <Badge variant="outline" className="hidden md:inline-flex">
            <Filter className="h-3 w-3 mr-1" /> {filtered.length} shown
          </Badge>
        </div>
      </GlassCard>

      {/* Student list */}
      {studentsQ.isLoading ? (
        <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => /* stable-key-allow:skeleton */ <Skeleton key={i} className="h-20 w-full" />)}</div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<GraduationCap className="h-7 w-7" />}
          title="No students match these filters"
          actions={<Button variant="ghost" size="sm" onClick={() => { setSearch(""); setSectionFilter("__all__"); setHealthFilter("__all__"); setDateFrom(""); setDateTo(""); }}>Clear filters</Button>}
        />
      ) : (
        // PL-062: bump gap from space-y-2 (8px) → space-y-3 (12px) so rows
        // are visually separable, alternate row tint, and color the Progress
        // bar by health bucket so back-to-back greens become a varied stripe.
        <div className="space-y-3">
          {filtered.slice(0, visibleCount).map((s, i) => {
            const section = SECTION_META[s.course_section] ?? { label: s.course_section, color: "bg-muted" };
            const health = HEALTH_META[s.health_bucket];
            const HealthIcon = health.icon;
            const pct = Number(s.pct_complete ?? 0);
            // PL-062: zebra striping + health-driven bar color
            const zebra = i % 2 === 0 ? "bg-card/60" : "bg-card/30";
            const barColor = {
              completed:   "[&>div]:bg-emerald-500",
              almost_done: "[&>div]:bg-info",
              in_progress: "[&>div]:bg-primary",
              just_started: "[&>div]:bg-amber-400",
              stalled:     "[&>div]:bg-rose-500",
            }[s.health_bucket] ?? "[&>div]:bg-primary";
            return (
              <motion.div
                key={s.id}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(i * 0.01, 0.2), duration: 0.25 }}
              >
                <GlassCard className={`p-4 border-l-2 ${health.color.split(" ").find((c) => c.startsWith("border-")) ?? "border-border/40"} ${zebra}`}>
                  <div className="flex flex-col gap-3 md:flex-row md:items-center">
                    {/* Identity */}
                    <div className="flex items-center gap-3 md:w-[260px] shrink-0">
                      <div className="h-10 w-10 rounded-full bg-primary/15 text-primary font-bold flex items-center justify-center shrink-0">
                        {(s.first_name?.[0] ?? "?") + (s.last_name?.[0] ?? "")}
                      </div>
                      <div className="min-w-0">
                        <p className="font-semibold truncate capitalize">
                          {[s.first_name, s.last_name].filter(Boolean).join(" ") || "(no name)"}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">
                          {fmtPhone(s.phone)}
                        </p>
                      </div>
                    </div>

                    {/* Progress + course */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1.5">
                        <Badge variant="outline" className={`text-[10px] ${section.color}`}>
                          {section.label}
                        </Badge>
                        <Badge variant="outline" className={`text-[10px] gap-1 ${health.color}`}>
                          <HealthIcon className="h-2.5 w-2.5" /> {health.label}
                        </Badge>
                        <Badge variant="outline" className="text-[10px] bg-background/70">
                          {producerTypeLabel(s)}
                        </Badge>
                        {s.course_name && (
                          <span className="text-[11px] text-muted-foreground truncate">{s.course_name}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-3">
                        <Progress value={pct} className={`h-2 flex-1 ${barColor}`} />
                        <span className={`text-sm font-bold tabular-nums shrink-0 w-12 text-right ${
                          pct >= 100 ? "text-emerald-400" : pct >= 50 ? "text-foreground" : "text-amber-400"
                        }`}>
                          {Math.round(pct)}%
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-[11px] text-muted-foreground mt-2 flex-wrap">
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" /> {fmtHours(s.time_spent_minutes)}
                        </span>
                        {s.date_enrolled && (
                          <span>Enrolled {format(parseISO(s.date_enrolled), "MMM d")}</span>
                        )}
                        {s.last_log_in && (
                          <span className={s.days_since_login != null && s.days_since_login > 7 ? "text-rose-400" : ""}>
                            Last login {format(parseISO(s.last_log_in), "MMM d")}
                            {s.days_since_login != null && s.days_since_login > 0 && <> · {s.days_since_login}d ago</>}
                          </span>
                        )}
                        {s.date_completed && (
                          <span className="text-emerald-400 font-medium">
                            ✓ Completed {format(parseISO(s.date_completed), "MMM d")}
                          </span>
                        )}
                        {s.assigned_agent_name && (
                          <span>Hiring mgr: {s.assigned_agent_name}</span>
                        )}
                        <span className="font-medium text-foreground/80">Next: {nextStepLabel(s)}</span>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1 shrink-0">
                      {s.phone && (
                        <Button asChild size="icon" variant="ghost" title="Call">
                          <a href={phoneHref(s.phone) ?? `tel:${s.phone}`} {...contactLinkProps(phoneHref(s.phone))}><Phone className="h-4 w-4" /></a>
                        </Button>
                      )}
                      {s.email && (
                        <Button asChild size="icon" variant="ghost" title="Email">
                          <a href={`mailto:${s.email}`}><Mail className="h-4 w-4" /></a>
                        </Button>
                      )}
                      {s.application_id && (
                        <Button asChild size="sm" variant="outline" title="Open application">
                          <Link to={`/dashboard/applicants?id=${s.application_id}`}>
                            <ExternalLink className="h-3.5 w-3.5 mr-1" /> App
                          </Link>
                        </Button>
                      )}
                    </div>
                  </div>
                </GlassCard>
              </motion.div>
            );
          })}
          {filtered.length > visibleCount && (
            <div className="flex flex-wrap items-center justify-center gap-3 py-4 text-sm">
              <span className="text-muted-foreground">Showing {visibleCount.toLocaleString()} of {filtered.length.toLocaleString()}</span>
              <button type="button" onClick={() => setVisibleCount((n) => n + 200)} className="rounded-md border border-border bg-muted/40 px-4 py-1.5 font-medium text-foreground transition hover:bg-muted">Show more ({(filtered.length - visibleCount).toLocaleString()} hidden)</button>
              <button type="button" onClick={() => setVisibleCount(filtered.length)} className="rounded-md px-3 py-1.5 font-medium text-primary transition hover:underline">Show all</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface SummaryTileProps {
  icon: React.ElementType; label: string;
  value: number | string; color: string; loading: boolean;
}
function SummaryTile({ icon: Icon, label, value, color, loading }: SummaryTileProps) {
  return (
    <GlassCard className="p-4">
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold">{label}</p>
          {loading ? (
            <Skeleton className="h-9 w-20 mt-1" />
          ) : (
            <p className={`text-3xl font-bold tabular-nums mt-1 ${color}`}>{value}</p>
          )}
        </div>
        <Icon className={`h-7 w-7 ${color} opacity-70`} />
      </div>
    </GlassCard>
  );
}
