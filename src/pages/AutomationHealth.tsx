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

interface HealthRow {
  job_name: string;
  last_run: string | null;
  success_count_24h: number;
  error_count_24h: number;
  total_24h: number;
  avg_duration_ms: number | null;
  last_error: string | null;
  health_status: "healthy" | "flaky" | "broken" | "stale";
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

const STATUS_META: Record<string, { color: string; icon: any; label: string }> = {
  healthy: { color: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30", icon: CheckCircle2,   label: "Healthy" },
  flaky:   { color: "bg-amber-500/10 text-amber-400 border-amber-500/30",       icon: AlertTriangle,  label: "Flaky" },
  broken:  { color: "bg-red-500/10 text-red-400 border-red-500/40",             icon: XCircle,        label: "Broken" },
  stale:   { color: "bg-gray-500/10 text-gray-400 border-gray-500/30",          icon: Clock,          label: "Stale" },
};

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

  const { data: health = [], isLoading: healthLoading } = useQuery({
    queryKey: ["automation-health"],
    queryFn: async (): Promise<HealthRow[]> => {
      const { data } = await supabase.from("automation_health" as any).select("*");
      return (data as any) ?? [];
    },
    enabled: isAdmin,
    refetchInterval: 30_000,
  });

  const { data: runs = [] } = useQuery({
    queryKey: ["automation-runs"],
    queryFn: async (): Promise<RunLogRow[]> => {
      const { data } = await supabase
        .from("automation_run_log" as any)
        .select("*")
        .order("triggered_at", { ascending: false })
        .limit(100);
      return (data as any) ?? [];
    },
    enabled: isAdmin,
    refetchInterval: 30_000,
  });

  const allJobs = useMemo(() => {
    const healthMap = new Map(health.map(h => [h.job_name, h]));
    const jobs: (HealthRow & { registry?: typeof JOB_REGISTRY[string] })[] = [];
    for (const [jobName, meta] of Object.entries(JOB_REGISTRY)) {
      const h = healthMap.get(jobName);
      jobs.push({
        job_name: jobName,
        last_run: h?.last_run ?? null,
        success_count_24h: h?.success_count_24h ?? 0,
        error_count_24h: h?.error_count_24h ?? 0,
        total_24h: h?.total_24h ?? 0,
        avg_duration_ms: h?.avg_duration_ms ?? null,
        last_error: h?.last_error ?? null,
        health_status: h?.health_status ?? "stale",
        registry: meta,
      });
    }
    for (const h of health) {
      if (!JOB_REGISTRY[h.job_name]) jobs.push(h);
    }
    return jobs;
  }, [health]);

  const filtered = useMemo(() => {
    return allJobs.filter(j => {
      if (statusFilter !== "all" && j.health_status !== statusFilter) return false;
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
    const s = { healthy: 0, flaky: 0, broken: 0, stale: 0 };
    for (const j of allJobs) {
      if (j.health_status in s) (s as any)[j.health_status]++;
    }
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
        subtitle="Every cron-scheduled job. Green = running. Red = needs attention. Same truth source the External Cron uses."
        actions={
          <Button size="sm" variant="outline" onClick={() => {
            queryClient.invalidateQueries({ queryKey: ["automation-health"] });
            queryClient.invalidateQueries({ queryKey: ["automation-runs"] });
          }}>
            <RefreshCw className="h-4 w-4 mr-1.5" /> Refresh
          </Button>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {(["healthy", "flaky", "broken", "stale"] as const).map(s => {
          const meta = STATUS_META[s];
          const Icon = meta.icon;
          return (
            <button
              key={s}
              onClick={() => setStatusFilter(statusFilter === s ? "all" : s)}
              className={`p-4 rounded-md border text-left transition ${meta.color} ${statusFilter === s ? "ring-2 ring-primary" : ""}`}
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

          {healthLoading ? (
            <div className="space-y-2">
              {[...Array(5)].map((_, i) => <div key={i} className="h-20 rounded-lg bg-muted/20 animate-pulse" />)}
            </div>
          ) : filtered.length === 0 ? (
            <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">No jobs match this filter.</CardContent></Card>
          ) : (
            <div className="space-y-2">
              {filtered.map(j => {
                const meta = STATUS_META[j.health_status] || STATUS_META.stale;
                const StatusIcon = meta.icon;
                return (
                  <Card key={j.job_name} className={j.health_status === "broken" ? "border-red-500/30" : ""}>
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
                          {j.registry && <span>⏱ {j.registry.schedule}</span>}
                          <span>{j.total_24h} runs / 24h</span>
                          {j.success_count_24h > 0 && <span className="text-emerald-400">{j.success_count_24h} ok</span>}
                          {j.error_count_24h > 0 && <span className="text-red-400">{j.error_count_24h} errors</span>}
                          {j.avg_duration_ms !== null && <span>avg {j.avg_duration_ms}ms</span>}
                          {j.last_run && <span>last {formatDistanceToNow(new Date(j.last_run), { addSuffix: true })}</span>}
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
                          {triggering === j.job_name ? "Running..." : "Run Now"}
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
