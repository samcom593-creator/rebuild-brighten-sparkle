import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Award,
  Check,
  CheckCircle2,
  Circle,
  ClipboardCheck,
  Loader2,
  Route,
  Search,
  Target,
  TrendingUp,
} from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { toast } from "sonner";

import { QuickAddAgentDialog } from "@/components/onboarding/QuickAddAgentDialog";
import { RecruitingWorkspaceNav } from "@/components/recruiting/RecruitingWorkspaceNav";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/glass-card";
import { Input } from "@/components/ui/input";
import { resolveBrand } from "@/config/brand";
import { PageHeader } from "@/components/ui/page-header";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import {
  APEX_30_60_90_STEPS,
  APEX_JOURNEY_STEPS,
  buildRecruitLifecycleSnapshot,
  calculateCareerQualification,
  type ApexJourneyPath,
  type ApexJourneyStep,
  type CareerTrack,
  type RecruitLifecycleSnapshot,
  type RecruitMilestoneStatus,
} from "@/lib/apexCareerToolkit";
import { cn } from "@/lib/utils";
import { usePageTitle } from "@/hooks/usePageTitle";

interface ToolkitAgent {
  id: string;
  subject_type: "application" | "toolkit_agent";
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  npn: string | null;
  pa_number: string | null;
  license_status: string;
  license_progress: string | null;
  started_training: boolean | null;
  status: string | null;
  record_type: string;
  created_at: string;
}

interface JourneyRow {
  id: string;
  application_id: string | null;
  toolkit_agent_id: string | null;
  path: ApexJourneyPath;
  started_at: string;
  updated_at: string;
}

interface JourneyStepRow {
  journey_id: string;
  step_key: string;
  completed_at: string;
}

interface ToolkitData {
  agents: ToolkitAgent[];
  journeys: JourneyRow[];
  steps: JourneyStepRow[];
}

interface ToolkitQueryResult<T> {
  data: T | null;
  error: { message: string } | null;
}

interface ToolkitQuery<T> extends PromiseLike<ToolkitQueryResult<T[]>> {
  select(columns: string): ToolkitQuery<T>;
  in(column: string, values: unknown[]): ToolkitQuery<T>;
  is(column: string, value: null): ToolkitQuery<T>;
  order(column: string, options?: { ascending?: boolean }): ToolkitQuery<T>;
  limit(count: number): ToolkitQuery<T>;
}

interface ToolkitClient {
  from<T>(table: string): ToolkitQuery<T>;
  rpc(functionName: string, args: Record<string, unknown>): Promise<ToolkitQueryResult<unknown>>;
}

const toolkitClient = supabase as unknown as ToolkitClient;

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

function fullName(agent: ToolkitAgent): string {
  return `${agent.first_name} ${agent.last_name}`.trim();
}

function subjectKey(agent: Pick<ToolkitAgent, "id" | "subject_type">): string {
  return `${agent.subject_type}:${agent.id}`;
}

function journeySubjectKey(journey: JourneyRow): string | null {
  if (journey.application_id) return `application:${journey.application_id}`;
  if (journey.toolkit_agent_id) return `toolkit_agent:${journey.toolkit_agent_id}`;
  return null;
}

function inferredPath(agent: ToolkitAgent): ApexJourneyPath {
  return agent.license_status === "licensed" ? "licensed" : "unlicensed";
}

export default function ApexCareerToolkit() {
  const brand = resolveBrand();
  const trainingLabel = `${brand.platformName} Training`;
  usePageTitle(`${trainingLabel} ${brand.titleSuffix}`);
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [agentSearch, setAgentSearch] = useState("");
  const [busyStep, setBusyStep] = useState<string | null>(null);
  const [careerTrack, setCareerTrack] = useState<CareerTrack>("producer");
  const [firstMonth, setFirstMonth] = useState(0);
  const [secondMonth, setSecondMonth] = useState(0);
  const [qualifyingLegs, setQualifyingLegs] = useState(0);

  const toolkit = useQuery<ToolkitData>({
    queryKey: ["apex-career-toolkit"],
    queryFn: async () => {
      const [applicationsResult, toolkitAgentsResult, journeysResult, stepsResult] = await Promise.all([
        toolkitClient
          .from<Omit<ToolkitAgent, "subject_type" | "npn" | "pa_number"> & { nipr_number: string | null }>("applications")
          .select("id,first_name,last_name,email,phone,nipr_number,license_status,license_progress,started_training,status,record_type,created_at")
          .in("record_type", ["application"])
          .is("terminated_at", null)
          .order("created_at", { ascending: false })
          .limit(1000),
        toolkitClient
          .from<Omit<ToolkitAgent, "subject_type" | "license_progress" | "record_type">>("apex_toolkit_agents")
          .select("id,first_name,last_name,email,phone,npn,pa_number,license_status,status,created_at")
          .order("created_at", { ascending: false })
          .limit(1000),
        toolkitClient
          .from<JourneyRow>("apex_agent_journeys")
          .select("id,application_id,toolkit_agent_id,path,started_at,updated_at")
          .order("updated_at", { ascending: false })
          .limit(1000),
        toolkitClient
          .from<JourneyStepRow>("apex_agent_journey_steps")
          .select("journey_id,step_key,completed_at")
          .limit(10_000),
      ]);
      if (applicationsResult.error) throw applicationsResult.error;
      if (toolkitAgentsResult.error) throw toolkitAgentsResult.error;
      if (journeysResult.error) throw journeysResult.error;
      if (stepsResult.error) throw stepsResult.error;
      return {
        agents: [
          ...(applicationsResult.data ?? []).map(({ nipr_number, ...agent }) => ({
            ...agent,
            subject_type: "application" as const,
            npn: nipr_number,
            pa_number: null,
          })),
          ...(toolkitAgentsResult.data ?? []).map((agent) => ({
            ...agent,
            subject_type: "toolkit_agent" as const,
            license_progress: null,
            started_training: false,
            record_type: "manual_agent",
          })),
        ].sort((left, right) => right.created_at.localeCompare(left.created_at)),
        journeys: (journeysResult.data ?? []) as JourneyRow[],
        steps: (stepsResult.data ?? []) as JourneyStepRow[],
      };
    },
    staleTime: 15_000,
  });

  const agents = useMemo(() => toolkit.data?.agents ?? [], [toolkit.data?.agents]);
  const journeysByAgent = useMemo(
    () => new Map((toolkit.data?.journeys ?? []).flatMap((journey) => {
      const key = journeySubjectKey(journey);
      return key ? [[key, journey] as const] : [];
    })),
    [toolkit.data?.journeys],
  );
  const completedByAgent = useMemo(() => {
    const map = new Map<string, Set<string>>();
    const journeyKeys = new Map(
      (toolkit.data?.journeys ?? []).flatMap((journey) => {
        const key = journeySubjectKey(journey);
        return key ? [[journey.id, key] as const] : [];
      }),
    );
    for (const step of toolkit.data?.steps ?? []) {
      const key = journeyKeys.get(step.journey_id);
      if (!key) continue;
      const completed = map.get(key) ?? new Set<string>();
      completed.add(step.step_key);
      map.set(key, completed);
    }
    return map;
  }, [toolkit.data?.journeys, toolkit.data?.steps]);

  const selectedId = searchParams.get("agent") ?? "";
  const selectedSource = searchParams.get("source") === "toolkit_agent" ? "toolkit_agent" : "application";
  const selectedAgent = agents.find(
    (agent) => agent.id === selectedId && agent.subject_type === selectedSource,
  ) ?? null;

  useEffect(() => {
    if (toolkit.isSuccess && agents.length > 0 && !selectedAgent) {
      const next = new URLSearchParams(searchParams);
      next.set("agent", agents[0].id);
      next.set("source", agents[0].subject_type);
      setSearchParams(next, { replace: true });
    }
  }, [agents, searchParams, selectedAgent, setSearchParams, toolkit.isSuccess]);

  const matchingAgents = useMemo(() => {
    const query = agentSearch.trim().toLowerCase();
    if (!query) return agents.slice(0, 150);
    return agents.filter((agent) => {
      const haystack = `${fullName(agent)} ${agent.email} ${agent.phone ?? ""} ${agent.npn ?? ""} ${agent.pa_number ?? ""}`.toLowerCase();
      return haystack.includes(query);
    }).slice(0, 150);
  }, [agentSearch, agents]);

  const lifecycleRows = useMemo(() => matchingAgents.map((agent) => {
    const key = subjectKey(agent);
    const journey = journeysByAgent.get(key);
    const completedSteps = completedByAgent.get(key) ?? new Set<string>();
    return {
      agent,
      snapshot: buildRecruitLifecycleSnapshot({
        path: journey?.path ?? inferredPath(agent),
        licenseStatus: agent.license_status,
        licenseProgress: agent.license_progress,
        startedTraining: agent.started_training,
        completedSteps,
        lastProgressAt: journey?.updated_at ?? agent.created_at,
      }),
    };
  }), [completedByAgent, journeysByAgent, matchingAgents]);

  const path = selectedAgent
    ? journeysByAgent.get(subjectKey(selectedAgent))?.path ?? inferredPath(selectedAgent)
    : "licensed";
  const completed = selectedAgent
    ? completedByAgent.get(subjectKey(selectedAgent)) ?? new Set<string>()
    : new Set<string>();
  const pathSteps = APEX_JOURNEY_STEPS[path];
  const allTrackedSteps = [...pathSteps, ...APEX_30_60_90_STEPS];
  const completedCount = allTrackedSteps.filter((step) => completed.has(step.key)).length;
  const percentComplete = allTrackedSteps.length > 0
    ? Math.round((completedCount / allTrackedSteps.length) * 100)
    : 0;
  const nextStep = pathSteps.find((step) => !completed.has(step.key)) ?? null;

  const qualification = useMemo(
    () => calculateCareerQualification({
      track: careerTrack,
      firstMonthProduction: firstMonth,
      secondMonthProduction: secondMonth,
      qualifyingLegs,
    }),
    [careerTrack, firstMonth, qualifyingLegs, secondMonth],
  );

  const selectAgent = (value: string) => {
    const separator = value.indexOf(":");
    if (separator < 1) return;
    const source = value.slice(0, separator);
    const agentId = value.slice(separator + 1);
    if (source !== "application" && source !== "toolkit_agent") return;
    const next = new URLSearchParams(searchParams);
    next.set("agent", agentId);
    next.set("source", source);
    setSearchParams(next);
  };

  const handleAdded = async (agentId: string) => {
    await queryClient.invalidateQueries({ queryKey: ["apex-career-toolkit"] });
    await queryClient.invalidateQueries({ queryKey: ["licensed-inbox"] });
    selectAgent(`toolkit_agent:${agentId}`);
  };

  const toggleStep = async (step: ApexJourneyStep) => {
    if (!selectedAgent) return;
    const nextComplete = !completed.has(step.key);
    setBusyStep(step.key);
    try {
      const { error } = await toolkitClient.rpc("set_apex_journey_step", {
        p_subject_type: selectedAgent.subject_type,
        p_subject_id: selectedAgent.id,
        p_step_key: step.key,
        p_complete: nextComplete,
      });
      if (error) throw error;
      toast.success(nextComplete ? `${step.label} completed` : `${step.label} reopened`);
      await queryClient.invalidateQueries({ queryKey: ["apex-career-toolkit"] });
      await queryClient.invalidateQueries({ queryKey: ["licensed-inbox"] });
      await queryClient.invalidateQueries({ queryKey: ["hiring-pipeline-v2"] });
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Journey step could not be saved.");
    } finally {
      setBusyStep(null);
    }
  };

  return (
    <div className="page-enter mx-auto w-full max-w-7xl space-y-5 px-4 pb-24 sm:px-6">
      <RecruitingWorkspaceNav />
      <PageHeader
        eyebrow={`Recruiting · ${trainingLabel}`}
        eyebrowIcon={<Route className="h-4 w-4" />}
        title={trainingLabel}
        subtitle={`Move every recruit from licensing through ${trainingLabel}, certification, launch readiness, and first sale. Every completed milestone is saved.`}
        accent="amber"
        actions={(
          <>
            <Button asChild variant="outline" className="h-10 gap-2 sm:h-9">
              <Link to="/admin/licensed-inbox">
                <ArrowLeft className="h-4 w-4" /> Licensed Inbox
              </Link>
            </Button>
            <QuickAddAgentDialog onAgentAdded={handleAdded} />
          </>
        )}
      />

      {toolkit.isError && (
        <GlassCard className="border-rose-500/35 p-4">
          <p className="text-sm font-semibold text-rose-600 dark:text-rose-400">Toolkit data could not load</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {(toolkit.error as Error | null)?.message ?? "The Supabase workflow tables did not respond."}
          </p>
        </GlassCard>
      )}

      {!toolkit.isLoading && !toolkit.isError && lifecycleRows.length > 0 && (
        <GlassCard className="overflow-hidden p-0">
          <div className="border-b border-border p-4 sm:p-5">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 className="text-base font-bold text-foreground">Master recruit pipeline</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  One continuous record from welcome activation through first sale. Select a recruit to update the durable milestones below.
                </p>
              </div>
              <span className="text-xs font-semibold tabular-nums text-muted-foreground">
                {lifecycleRows.length.toLocaleString()} shown
              </span>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-[1580px] w-full text-left text-xs">
              <thead className="bg-muted/45 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="sticky left-0 z-10 min-w-52 border-r border-border bg-muted px-4 py-3">Recruit</th>
                  <th className="px-3 py-3">Overall</th>
                  <th className="px-3 py-3">Welcome</th>
                  <th className="px-3 py-3">Pre-license course</th>
                  <th className="px-3 py-3">Exam schedule</th>
                  <th className="px-3 py-3">Exam result</th>
                  <th className="px-3 py-3">License</th>
                  <th className="px-3 py-3">{trainingLabel}</th>
                  <th className="px-3 py-3">Certification</th>
                  <th className="px-3 py-3">Launch ready</th>
                  <th className="px-3 py-3">First sale</th>
                  <th className="min-w-48 px-3 py-3">Next action</th>
                  <th className="px-3 py-3">Risk</th>
                </tr>
              </thead>
              <tbody>
                {lifecycleRows.map(({ agent, snapshot }) => (
                  <RecruitLifecycleRow
                    key={subjectKey(agent)}
                    agent={agent}
                    snapshot={snapshot}
                    onSelect={() => selectAgent(subjectKey(agent))}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </GlassCard>
      )}

      <GlassCard className="p-4">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.65fr)] lg:items-end">
          <div>
            <label htmlFor="toolkit-agent-search" className="mb-1.5 block text-xs font-semibold text-muted-foreground">
              Find an agent
            </label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="toolkit-agent-search"
                value={agentSearch}
                onChange={(event) => setAgentSearch(event.target.value)}
                placeholder="Name, email, phone, or NPN"
                className="h-11 pl-9 sm:h-10"
              />
            </div>
          </div>
          <div>
            <label htmlFor="toolkit-agent-select" className="mb-1.5 block text-xs font-semibold text-muted-foreground">
              Active journey
            </label>
            <Select value={selectedAgent ? subjectKey(selectedAgent) : ""} onValueChange={selectAgent}>
              <SelectTrigger id="toolkit-agent-select" className="h-11 sm:h-10">
                <SelectValue placeholder={toolkit.isLoading ? "Loading agents..." : "Select an agent"} />
              </SelectTrigger>
              <SelectContent>
                {matchingAgents.map((agent) => (
                  <SelectItem key={subjectKey(agent)} value={subjectKey(agent)}>
                    {fullName(agent)}
                    {agent.npn ? ` · NPN ${agent.npn}` : agent.pa_number ? ` · Legacy PA ${agent.pa_number}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </GlassCard>

      {toolkit.isLoading && (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.65fr)_minmax(280px,0.7fr)]">
          <div className="h-[520px] animate-pulse rounded-xl bg-muted/30" />
          <div className="h-[320px] animate-pulse rounded-xl bg-muted/30" />
        </div>
      )}

      {!toolkit.isLoading && selectedAgent && (
        <>
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1.65fr)_minmax(280px,0.7fr)]">
            <GlassCard className="p-4 sm:p-5">
              <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-xl font-bold text-foreground">{fullName(selectedAgent)}</h2>
                    <PathBadge path={path} />
                    {selectedAgent.record_type === "manual_agent" && (
                      <span className="rounded-sm border border-border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                        Manual agent
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {selectedAgent.email}
                    {selectedAgent.npn
                      ? ` · NPN ${selectedAgent.npn}`
                      : selectedAgent.pa_number
                        ? ` · Legacy PA ${selectedAgent.pa_number}`
                        : " · NPN not recorded"}
                  </p>
                </div>
                <div className="shrink-0 text-left sm:text-right">
                  <div className="text-2xl font-bold tabular-nums">{percentComplete}%</div>
                  <div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Journey complete</div>
                </div>
              </div>

              <div className="mb-5 h-2 overflow-hidden rounded-full bg-muted/50" aria-label={`${percentComplete}% complete`}>
                <div className="h-full rounded-full bg-amber-500 transition-[width]" style={{ width: `${percentComplete}%` }} />
              </div>

              <div className="space-y-2">
                {pathSteps.map((step, index) => (
                  <JourneyStepButton
                    key={step.key}
                    step={step}
                    index={index}
                    complete={completed.has(step.key)}
                    busy={busyStep === step.key}
                    disabled={busyStep !== null}
                    onClick={() => void toggleStep(step)}
                  />
                ))}
              </div>
            </GlassCard>

            <div className="space-y-5">
              <GlassCard className="p-4">
                <div className="flex items-center gap-2">
                  <Target className="h-5 w-5 text-amber-500" />
                  <h2 className="font-semibold">Next right action</h2>
                </div>
                {nextStep ? (
                  <>
                    <p className="mt-3 text-lg font-bold">{nextStep.label}</p>
                    <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{nextStep.description}</p>
                    <p className="mt-3 rounded-lg border border-amber-500/25 bg-amber-500/5 p-3 text-xs text-foreground">
                      Done when: {nextStep.successCondition}
                    </p>
                  </>
                ) : (
                  <div className="mt-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3">
                    <p className="flex items-center gap-2 text-sm font-semibold text-emerald-600 dark:text-emerald-400">
                      <CheckCircle2 className="h-4 w-4" /> Activation path complete
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">Keep coaching activity and production consistency.</p>
                  </div>
                )}
              </GlassCard>

              <GlassCard className="p-4">
                <div className="flex items-center gap-2">
                  <ClipboardCheck className="h-5 w-5 text-emerald-500" />
                  <h2 className="font-semibold">Path rule</h2>
                </div>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                  {path === "licensed"
                    ? "Licensed means the licensing stage may be skipped; systems, contracting, training, and launch readiness still must be completed."
                    : "Licensing speed varies by state, course progress, exam availability, results, and administrative requirements. Record the next completed action without promising a date."}
                </p>
              </GlassCard>
            </div>
          </div>

          <GlassCard className="p-4 sm:p-5">
            <div className="mb-4 flex items-start gap-3">
              <TrendingUp className="mt-0.5 h-5 w-5 text-emerald-500" />
              <div>
                <h2 className="font-semibold">First 30, 60, and 90 days</h2>
                <p className="mt-1 text-xs text-muted-foreground">Complete each objective when the operating habit is visible, not merely discussed.</p>
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              {APEX_30_60_90_STEPS.map((step) => {
                const isComplete = completed.has(step.key);
                const isBusy = busyStep === step.key;
                return (
                  <button
                    key={step.key}
                    type="button"
                    aria-pressed={isComplete}
                    disabled={busyStep !== null}
                    onClick={() => void toggleStep(step)}
                    className={cn(
                      "rounded-lg border p-4 text-left transition-colors focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)]",
                      isComplete
                        ? "border-emerald-500/45 bg-emerald-500/10"
                        : "border-border bg-card hover:border-amber-500/40 hover:bg-amber-500/5",
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold">{step.label}</span>
                      {isBusy ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : isComplete ? (
                        <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                      ) : (
                        <Circle className="h-4 w-4 text-muted-foreground" />
                      )}
                    </div>
                    <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{step.description}</p>
                    <p className="mt-3 text-[11px] font-medium text-foreground">{step.successCondition}</p>
                  </button>
                );
              })}
            </div>
          </GlassCard>
        </>
      )}

      {!toolkit.isLoading && !toolkit.isError && agents.length === 0 && (
        <GlassCard className="p-8 text-center">
          <Award className="mx-auto h-8 w-8 text-muted-foreground" />
          <h2 className="mt-3 font-semibold">No agent journey is ready yet</h2>
          <p className="mt-1 text-sm text-muted-foreground">Add a licensed agent or return after an application arrives.</p>
          <div className="mt-4 flex justify-center"><QuickAddAgentDialog onAgentAdded={handleAdded} /></div>
        </GlassCard>
      )}

      <GlassCard className="p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <Award className="mt-0.5 h-5 w-5 text-amber-500" />
          <div>
            <h2 className="font-semibold">Career qualification calculator</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              The supplied chart requires the production threshold for two consecutive months. These are qualification levels, not guaranteed income.
            </p>
          </div>
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-4">
          <div>
            <label htmlFor="career-track" className="mb-1.5 block text-xs font-semibold text-muted-foreground">Path</label>
            <Select value={careerTrack} onValueChange={(value) => setCareerTrack(value as CareerTrack)}>
              <SelectTrigger id="career-track" className="h-11 sm:h-10"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="producer">Producer · personal</SelectItem>
                <SelectItem value="builder">Builder · team</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <NumberField id="career-month-one" label="Month one production" value={firstMonth} onChange={setFirstMonth} />
          <NumberField id="career-month-two" label="Month two production" value={secondMonth} onChange={setSecondMonth} />
          <NumberField id="career-legs" label="Legs at $15K" value={qualifyingLegs} onChange={setQualifyingLegs} step={1} />
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Metric label="Current level" value={`${qualification.current.level} · ${qualification.current.title}`} />
          <Metric label="Two-month qualifying pace" value={currency.format(qualification.twoMonthProduction)} />
          <Metric
            label="Next level"
            value={qualification.next ? `${qualification.next.level} · ${qualification.next.title}` : "Top level reached"}
          />
          <Metric
            label="Still needed"
            value={qualification.next
              ? `${currency.format(qualification.productionRemaining)}${qualification.legsRemaining ? ` + ${qualification.legsRemaining} leg${qualification.legsRemaining === 1 ? "" : "s"}` : ""}`
              : "—"}
          />
        </div>
      </GlassCard>
    </div>
  );
}

function PathBadge({ path }: { path: ApexJourneyPath }) {
  return (
    <span className={cn(
      "rounded-sm border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
      path === "licensed"
        ? "border-emerald-500/35 text-emerald-600 dark:text-emerald-400"
        : "border-amber-500/35 text-amber-600 dark:text-amber-400",
    )}>
      {path} path
    </span>
  );
}

function RecruitLifecycleRow({
  agent,
  snapshot,
  onSelect,
}: {
  agent: ToolkitAgent;
  snapshot: RecruitLifecycleSnapshot;
  onSelect: () => void;
}) {
  return (
    <tr className="border-t border-border first:border-t-0 hover:bg-muted/20">
      <td className="sticky left-0 z-[1] border-r border-border bg-card px-4 py-3">
        <button type="button" onClick={onSelect} className="max-w-48 text-left focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)]">
          <span className="block truncate font-semibold text-foreground">{fullName(agent)}</span>
          <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">{agent.email}</span>
        </button>
      </td>
      <td className="px-3 py-3 text-sm font-bold tabular-nums text-foreground">{snapshot.percentComplete}%</td>
      <MilestoneCell status={snapshot.welcome} />
      <MilestoneCell status={snapshot.preLicensing} />
      <MilestoneCell status={snapshot.examSchedule} />
      <MilestoneCell status={snapshot.examResult} />
      <MilestoneCell status={snapshot.license} />
      <MilestoneCell status={snapshot.apexTraining} />
      <MilestoneCell status={snapshot.certification} />
      <MilestoneCell status={snapshot.launchReady} />
      <MilestoneCell status={snapshot.firstSale} />
      <td className="px-3 py-3 font-medium text-foreground">{snapshot.nextAction}</td>
      <MilestoneCell status={snapshot.risk} />
    </tr>
  );
}

function MilestoneCell({ status }: { status: RecruitMilestoneStatus }) {
  const tone = {
    complete: "text-emerald-600 dark:text-emerald-400",
    progress: "text-amber-600 dark:text-amber-400",
    pending: "text-muted-foreground",
    failed: "text-rose-600 dark:text-rose-400",
    ready: "text-primary",
    muted: "text-muted-foreground/70",
  }[status.tone];
  return <td className={cn("whitespace-nowrap px-3 py-3 font-medium", tone)}>{status.label}</td>;
}

function JourneyStepButton({
  step,
  index,
  complete,
  busy,
  disabled,
  onClick,
}: {
  step: ApexJourneyStep;
  index: number;
  complete: boolean;
  busy: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={complete}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "group flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)] sm:p-4",
        complete
          ? "border-emerald-500/35 bg-emerald-500/5"
          : "border-border bg-card hover:border-amber-500/40 hover:bg-amber-500/5",
      )}
    >
      <span className={cn(
        "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-bold",
        complete
          ? "border-emerald-500 bg-emerald-500 text-white"
          : "border-border text-muted-foreground group-hover:border-amber-500/60",
      )}>
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : complete ? <Check className="h-4 w-4" /> : index + 1}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-foreground">{step.label}</span>
        <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">{step.description}</span>
        <span className="mt-2 block text-[11px] font-medium text-foreground">Done when: {step.successCondition}</span>
      </span>
    </button>
  );
}

function NumberField({
  id,
  label,
  value,
  onChange,
  step = 1000,
}: {
  id: string;
  label: string;
  value: number;
  onChange: (value: number) => void;
  step?: number;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-xs font-semibold text-muted-foreground">{label}</label>
      <Input
        id={id}
        type="number"
        min={0}
        step={step}
        value={value}
        onChange={(event) => onChange(Math.max(0, Number(event.target.value) || 0))}
        className="h-11 tabular-nums sm:h-10"
      />
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-base font-bold tabular-nums text-foreground">{value}</div>
    </div>
  );
}
