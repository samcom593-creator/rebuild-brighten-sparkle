import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Zap, CheckCircle2, AlertTriangle, XCircle, Clock, Play, RefreshCw, Search, Activity,
} from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow, format } from "date-fns";

// MP-412: this page used to be a hardcoded list of 23 automations, each rendered
// beside a confident schedule string ("Daily at 11pm CST") that nothing verified,
// and its header claimed "Every cron-scheduled job".
//
// Measured against live prod on 2026-09-04: 22 of those 23 had NO cron.job row
// under either their job name or their edge function, and the 23rd
// (apex-churn-risk -> apex-daily-churn-check) is active=false. Not one was
// scheduled and enabled. 21 of them last wrote a run log in April 2026. So the
// page printed a schedule for 23 automations that do not run, and could not
// show the 65 cron jobs that do.
//
// The view it read, public.automation_health, cannot report this either: its CTE
// filters triggered_at > now() - 24h and its verdict then asks
// last_run < now() - 2 days, so the 'stale' branch is unreachable BY CONSTRUCTION
// and a job that stops running vanishes from the view instead of going stale.
// Absence rendered as health -- the same shape as v_stripe_event_health going
// blank-green when Stripe went dark.
//
// The spine is now cron.job itself, via get_cron_jobs_with_status() (already
// admin-gated, already used by CronJobsPanel). JOB_REGISTRY is DESCRIPTION ONLY:
// its schedule string is rendered as a *claim* and is never presented as fact.
type Verdict =
  | "healthy" | "flaky" | "broken" | "stale"
  | "unlogged"       // scheduled + enabled, but writes no automation_run_log row
  | "disabled"       // cron.job row exists with active = false
  | "not_scheduled"; // named here, but no cron.job row at all

// Rows returned by get_cron_jobs_with_status(). last_run/last_status/runs_24h all
// come from automation_run_log joined on job_name = cron jobname.
interface CronRow {
  jobname: string;
  schedule: string;
  active: boolean;
  command: string;
  last_run: string | null;
  last_status: string | null;
  last_error: string | null;
  runs_24h: number;
  errors_24h: number;
}

interface JobRow {
  job_name: string;
  verdict: Verdict;
  cron_schedule: string | null;   // the REAL schedule, or null when unscheduled
  claimed_schedule: string | null; // the registry's assertion -- shown as a claim
  active: boolean | null;
  last_run: string | null;
  runs_24h: number;
  errors_24h: number;
  last_error: string | null;
  registry?: typeof JOB_REGISTRY[string];
}

interface RunLogRow {
  id: string;
  job_name: string;
  triggered_at: string;
  completed_at: string | null;
  status: string;
  http_status: number | null;
  error: string | null;
  duration_ms: number | null;
}

const STATUS_META: Record<Verdict, { color: string; icon: any; label: string; hint: string }> = {
  healthy:       { color: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30", icon: CheckCircle2,  label: "Healthy",       hint: "Scheduled, enabled, logging runs with no errors." },
  flaky:         { color: "bg-amber-500/10 text-amber-400 border-amber-500/30",       icon: AlertTriangle, label: "Flaky",         hint: "Logging both successes and errors in the last 24h." },
  broken:        { color: "bg-red-500/10 text-red-400 border-red-500/40",             icon: XCircle,       label: "Broken",        hint: "Every logged run in the last 24h errored." },
  stale:         { color: "bg-amber-500/10 text-amber-400 border-amber-500/30",       icon: Clock,         label: "Stale",         hint: "Logged before, but nothing for over 7 days." },
  unlogged:      { color: "bg-sky-500/10 text-sky-400 border-sky-500/30",             icon: Activity,      label: "No run log",    hint: "Scheduled and enabled, but it does not write automation_run_log — this page cannot see whether it works. Not a fault." },
  disabled:      { color: "bg-gray-500/10 text-muted-foreground border-gray-500/30",  icon: Clock,         label: "Disabled",      hint: "A cron.job row exists but active = false. It will never fire until re-enabled." },
  not_scheduled: { color: "bg-red-500/10 text-red-400 border-red-500/40",             icon: XCircle,       label: "Not scheduled", hint: "Listed in this app's registry, but there is no cron.job row for it. It only runs if you press Run Now." },
};

const STALE_MS = 7 * 24 * 60 * 60 * 1000;

const JOB_REGISTRY: Record<string, { fn: string; body?: any; description: string; schedule: string }> = {
  "apex-daily-plaques":         { fn: "check-daily-plaques",         description: "Single-day production milestones (Bronze/Gold/Platinum)", schedule: "Daily at 11pm CST" },
  "apex-daily-awards":          { fn: "check-daily-awards",          description: "Generic daily award checks",                              schedule: "Daily at 11:05pm CST" },
  "apex-streak-milestones":     { fn: "check-streak-milestones",     description: "Hot streak / on-fire / unstoppable badges",               schedule: "Daily at 11:10pm CST" },
  "apex-comeback-milestones":   { fn: "check-comeback-milestones",   description: "Comeback champion recognition",                           schedule: "Daily at 11:15pm CST" },
  "apex-weekly-milestones":     { fn: "check-weekly-milestones",     description: "Weekly Diamond ($10k+)",                                  schedule: "Mondays 12:30am CST" },
  "apex-monthly-milestones":    { fn: "check-monthly-milestones",    description: "Elite Producer ($25k+ monthly)",                         schedule: "1st of month 1am CST" },
  "apex-team-milestones":       { fn: "check-team-milestones",       description: "Team-level milestone awards",                             schedule: "Daily at 11:30pm CST" },
  "apex-recruiting-milestones": { fn: "check-recruiting-milestones", description: "Rising Recruiter / Hiring Champion / Team Builder",      schedule: "Daily at 11:35pm CST" },
  "apex-early-performance":     { fn: "check-early-performance",     description: "Flags new agents hitting early wins",                     schedule: "Daily at 11:40pm CST" },
  "apex-churn-risk":            { fn: "check-churn-risk",            description: "Detects agents showing churn-risk patterns",              schedule: "Daily at 6am CST" },
  "apex-stale-onboarding":      { fn: "check-stale-onboarding",      description: "Agents stuck in onboarding >5 days",                      schedule: "Daily at 7am CST" },
  "apex-overdue-tasks":         { fn: "check-overdue-tasks",         description: "Task deadline notifications",                             schedule: "Daily at 8am CST" },
  "apex-abandoned-applications":{ fn: "check-abandoned-applications",description: "Applicants who started but didn't finish",                 schedule: "Daily at 9am CST" },
  "apex-dropped-leads":         { fn: "detect-dropped-leads",        description: "Leads untouched >24h",                                    schedule: "Daily at 10am CST" },
  "apex-ghosted-applicants":    { fn: "detect-ghosted-applicants",   description: "Applicants not responding to follow-ups",                 schedule: "Daily at 10:15am CST" },
  "apex-production-gaps":       { fn: "detect-production-gaps",      description: "Active agents with gaps in production",                   schedule: "Daily at 5pm CST" },
  "apex-low-aop-friday":        { fn: "check-low-aop-friday",        description: "Friday afternoon low-production alert",                   schedule: "Fridays 3pm CST" },
  "apex-detect-duplicates":     { fn: "detect-duplicates",           description: "Duplicate applications / leads / agents",                 schedule: "Daily at 4am CST" },
  "apex-detect-inactive":       { fn: "detect-inactive-agents",      description: "7+/14+/30+ day inactive agents",                          schedule: "Daily at 2am CST" },
  "apex-email-status":          { fn: "check-email-status",          description: "Sync Resend delivery status to email_delivery_log",       schedule: "Every 2 hours" },
  "apex-insuracloud-sync":      { fn: "sync-insuracloud",            description: "Pull real commissions from Insuracloud (per agent)",      schedule: "Hourly, business hours" },
  "apex-morning-report":        { fn: "send-sam-morning-report",     description: "Daily morning report email",                              schedule: "Daily at 6am CST" },
  "apex-log-cleanup":           { fn: "(db)",                        description: "Trim automation_run_log + email_delivery_log old rows",   schedule: "Daily at 3am CST" },
};

export default function AutomationHealth() {
  const { isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [triggering, setTriggering] = useState<string | null>(null);

  // The spine. cron.job is the only place that knows what is actually scheduled;
  // automation_health cannot answer this because a job that stops running leaves
  // that view entirely (see the note at the top of this file).
  const { data: cronJobs = [], isLoading: cronLoading, isError: cronError } = useQuery({
    queryKey: ["automation-cron-catalog"],
    queryFn: async (): Promise<CronRow[]> => {
      const { data, error } = await supabase.rpc("get_cron_jobs_with_status" as any);
      // The RPC raises 'Admins only' rather than returning empty, so an error here
      // is a real failure to look -- never silently rendered as "no jobs exist".
      if (error) throw error;
      return (data as any) ?? [];
    },
    enabled: isAdmin,
    refetchInterval: 300_000,
  });

  const { data: runs = [] } = useQuery({
    queryKey: ["automation-runs"],
    queryFn: async (): Promise<RunLogRow[]> => {
      const { data } = await supabase
        .from("automation_run_log" as any).select("id,job_name,triggered_at,status,http_status,error,duration_ms,completed_at")
        .order("triggered_at", { ascending: false })
        .limit(100);
      return (data as any) ?? [];
    },
    enabled: isAdmin,
    refetchInterval: 300_000,
  });

  // A registry entry is "scheduled" if a cron.job row carries its job name OR
  // invokes its edge function. Matching on jobname alone would have called
  // apex-churn-risk unscheduled when apex-daily-churn-check does invoke
  // check-churn-risk (disabled, but that is a different answer with a different
  // remedy).
  const matchCron = (rows: CronRow[], key: string, fn: string) =>
    rows.find(c => c.jobname === key)
    ?? (fn && fn !== "(db)" ? rows.find(c => c.command?.includes(`/${fn}`)) : undefined);

  const verdictFor = (c: CronRow | undefined): Verdict => {
    if (!c) return "not_scheduled";
    if (!c.active) return "disabled";
    if (!c.last_run) return "unlogged";
    if (Date.now() - new Date(c.last_run).getTime() > STALE_MS) return "stale";
    const errors = c.errors_24h ?? 0;
    const runs = c.runs_24h ?? 0;
    if (errors > 0 && runs > 0 && errors >= runs) return "broken";
    if (errors > 0) return "flaky";
    return "healthy";
  };

  const allJobs = useMemo<JobRow[]>(() => {
    const jobs: JobRow[] = [];
    const claimedCron = new Set<string>();

    // 1. Every registry entry, graded against the live catalog.
    for (const [jobName, meta] of Object.entries(JOB_REGISTRY)) {
      const c = matchCron(cronJobs, jobName, meta.fn);
      if (c) claimedCron.add(c.jobname);
      jobs.push({
        job_name: c?.jobname ?? jobName,
        verdict: verdictFor(c),
        cron_schedule: c?.schedule ?? null,
        claimed_schedule: meta.schedule,
        active: c?.active ?? null,
        last_run: c?.last_run ?? null,
        runs_24h: c?.runs_24h ?? 0,
        errors_24h: c?.errors_24h ?? 0,
        last_error: c?.last_error ?? null,
        registry: meta,
      });
    }

    // 2. Every OTHER cron job. Without this the header's "every cron-scheduled
    //    job" stays false: 65 jobs exist and the registry names 23.
    for (const c of cronJobs) {
      if (claimedCron.has(c.jobname)) continue;
      jobs.push({
        job_name: c.jobname,
        verdict: verdictFor(c),
        cron_schedule: c.schedule,
        claimed_schedule: null,
        active: c.active,
        last_run: c.last_run,
        runs_24h: c.runs_24h ?? 0,
        errors_24h: c.errors_24h ?? 0,
        last_error: c.last_error,
      });
    }
    return jobs;
  }, [cronJobs]);

  const filtered = useMemo(() => {
    return allJobs.filter(j => {
      if (statusFilter !== "all" && j.verdict !== statusFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        return j.job_name.toLowerCase().includes(q)
          || j.registry?.description.toLowerCase().includes(q)
          || j.registry?.fn.toLowerCase().includes(q);
      }
      return true;
    });
  }, [allJobs, statusFilter, search]);

  const stats = useMemo(() => {
    const s: Record<Verdict, number> = {
      healthy: 0, flaky: 0, broken: 0, stale: 0, unlogged: 0, disabled: 0, not_scheduled: 0,
    };
    for (const j of allJobs) s[j.verdict]++;
    return s;
  }, [allJobs]);

  const triggerJob = async (jobName: string) => {
    const meta = JOB_REGISTRY[jobName];
    if (!meta || meta.fn === "(db)") {
      toast.error("This job runs in the database, not as an edge function.");
      return;
    }
    setTriggering(jobName);
    try {
      const { error } = await supabase.functions.invoke(meta.fn, { body: meta.body ?? {} });
      if (error) throw error;
      toast.success(`Triggered ${jobName}`);
      setTimeout(() => queryClient.invalidateQueries({ queryKey: ["automation-runs"] }), 2000);
    } catch (e: any) {
      toast.error(`Failed: ${e.message || "unknown"}`);
    } finally {
      setTriggering(null);
    }
  };

  if (!isAdmin) {
    return <div className="flex items-center justify-center h-64"><p className="text-muted-foreground">Admin access required</p></div>;
  }

  return (
    <div className="space-y-6 p-4 md:p-6 page-enter">
      <PageHeader
        accent="amber"
        eyebrow="Admin · Health"
        eyebrowIcon={<Zap className="h-3 w-3" />}
        title="Automation Health"
        subtitle="Every row in cron.job, plus anything this app claims to schedule. \u201cNot scheduled\u201d means no cron.job row exists \u2014 it will only ever run if you press Run Now."
        actions={
          <Button size="sm" variant="outline" onClick={() => {
            queryClient.invalidateQueries({ queryKey: ["automation-cron-catalog"] });
            queryClient.invalidateQueries({ queryKey: ["automation-runs"] });
          }}>
            <RefreshCw className="h-4 w-4 mr-1.5" /> Refresh
          </Button>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
        {(["not_scheduled", "broken", "disabled", "flaky", "stale", "unlogged", "healthy"] as const).map(s => {
          const meta = STATUS_META[s];
          const Icon = meta.icon;
          return (
            <button
              key={s}
              onClick={() => setStatusFilter(statusFilter === s ? "all" : s)}
              className={`p-4 rounded-md border text-left transition ${meta.color} ${statusFilter === s ? "ring-2 ring-primary" : ""}`}
              title={meta.hint}
            >
              <div className="flex items-center gap-1.5 mb-1">
                <Icon className="h-3.5 w-3.5" />
                <p className="text-[10px] uppercase font-semibold opacity-80">{meta.label}</p>
              </div>
              <p className="text-2xl font-bold">{stats[s]}</p>
            </button>
          );
        })}
      </div>

      <Tabs defaultValue="jobs">
        <TabsList>
          <TabsTrigger value="jobs">All Jobs ({allJobs.length})</TabsTrigger>
          <TabsTrigger value="runs">Recent Runs ({runs.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="jobs" className="space-y-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search jobs..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>

          {cronLoading ? (
            <div className="space-y-2">
              {/* stable-key-allow:skeleton */}
              {[...Array(5)].map((_, i) => <div key={i} className="h-20 rounded-lg bg-muted/20 animate-pulse" />)}
            </div>
          ) : cronError ? (
            <Card className="border-red-500/40"><CardContent className="p-8 text-center text-sm text-red-400">
              Could not read the cron catalog. This is a failure to look, not an all-clear — do not read it as “no jobs are scheduled”.
            </CardContent></Card>
          ) : filtered.length === 0 ? (
            <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">No jobs match this filter.</CardContent></Card>
          ) : (
            <div className="space-y-2">
              {filtered.map(j => {
                const meta = STATUS_META[j.verdict] ?? STATUS_META.unlogged;
                const StatusIcon = meta.icon;
                return (
                  <Card key={j.job_name} className={j.verdict === "broken" || j.verdict === "not_scheduled" ? "border-red-500/30" : ""}>
                    <CardContent className="p-4 flex items-center gap-3 flex-wrap">
                      <div className={`p-2 rounded-lg border ${meta.color}`}>
                        <StatusIcon className="h-4 w-4" />
                      </div>
                      <div className="flex-1 min-w-[240px]">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <p className="font-mono text-sm font-semibold">{j.job_name}</p>
                          <Badge variant="outline" className={meta.color + " text-[10px]"}>{meta.label}</Badge>
                          {j.registry && <span className="text-[10px] text-muted-foreground">→ {j.registry.fn}</span>}
                        </div>
                        {j.registry && <p className="text-xs text-muted-foreground mb-1">{j.registry.description}</p>}
                        <div className="flex items-center gap-3 text-[10px] text-muted-foreground flex-wrap">
                          {/* The real cron expression, never the registry's prose. When there
                              is no cron row the claim is shown AS a claim -- struck through and
                              labelled -- because printing it plainly is what made this page lie. */}
                          {j.cron_schedule
                            ? <span className="font-mono">⏱ {j.cron_schedule}{j.active === false ? " (disabled)" : ""}</span>
                            : j.claimed_schedule
                              ? <span className="text-red-400">⏱ <span className="line-through">{j.claimed_schedule}</span> — claimed here, not in cron</span>
                              : null}
                          <span>{j.runs_24h} logged runs / 24h</span>
                          {j.errors_24h > 0 && <span className="text-red-400">{j.errors_24h} errors</span>}
                          {j.last_run
                            ? <span>last {formatDistanceToNow(new Date(j.last_run), { addSuffix: true })}</span>
                            : j.verdict === "unlogged"
                              ? <span className="text-sky-400">no run log — this page cannot see it</span>
                              : <span>never logged a run</span>}
                        </div>
                        {j.last_error && (
                          <p className="text-[10px] text-red-400 mt-1 font-mono truncate">⚠ {j.last_error}</p>
                        )}
                      </div>
                      {j.registry && j.registry.fn !== "(db)" && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={triggering === j.job_name}
                          onClick={() => triggerJob(j.job_name)}
                        >
                          <Play className="h-3.5 w-3.5 mr-1" />
                          {triggering === j.job_name ? "Running..." : j.verdict === "not_scheduled" ? "Run Once" : "Run Now"}
                        </Button>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="runs" className="space-y-1">
          {runs.length === 0 ? (
            <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">
              No runs logged yet. Jobs will appear here once cron fires them (or you trigger manually).
            </CardContent></Card>
          ) : (
            runs.map(r => (
              <Card key={r.id} className={r.status === "error" ? "border-red-500/30" : ""}>
                <CardContent className="p-3 flex items-center gap-3 flex-wrap">
                  <Activity className={`h-4 w-4 ${r.status === "success" ? "text-emerald-400" : r.status === "error" ? "text-red-400" : "text-muted-foreground"}`} />
                  <div className="flex-1 min-w-[200px]">
                    <p className="font-mono text-sm">{r.job_name}</p>
                    {r.error && <p className="text-[10px] text-red-400 font-mono truncate">{r.error}</p>}
                  </div>
                  <div className="text-right text-[10px] text-muted-foreground whitespace-nowrap">
                    <p>{format(new Date(r.triggered_at), "MMM d, h:mm:ss a")}</p>
                    {r.duration_ms !== null && <p>{r.duration_ms}ms</p>}
                  </div>
                  <Badge variant="outline" className={
                    r.status === "success" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30" :
                    r.status === "error" ? "bg-red-500/10 text-red-400 border-red-500/30" :
                    "bg-muted/30"
                  }>
                    {r.status}
                  </Badge>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
