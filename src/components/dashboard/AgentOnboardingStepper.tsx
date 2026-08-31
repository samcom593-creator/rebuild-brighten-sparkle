import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarCheck2, Check, Circle, ExternalLink, GraduationCap, Headphones, LockKeyhole, MessageSquare, Rocket, ShieldCheck } from "lucide-react";
import { Link } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { resolveBrand } from "@/config/brand";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { useRealtimeTable } from "@/shared/realtime/useRealtimeTable";

type StepStatus = "complete" | "current" | "locked";

interface OnboardingStep {
  key: string;
  label: string;
  detail: string;
  status: StepStatus;
  action_label: string | null;
  action_url: string | null;
}

interface OnboardingRoadmap {
  agent_id: string;
  agent_name: string;
  path: "licensed" | "unlicensed";
  completed_steps: number;
  total_steps: number;
  progress_percent: number;
  next_step_key: string | null;
  next_step_label: string | null;
  next_step_detail: string | null;
  next_step_url: string | null;
  next_step_action: string | null;
  contact_name: string;
  contact_email: string;
  steps: OnboardingStep[];
}

const STEP_ICONS = {
  slack: MessageSquare,
  license: ShieldCheck,
  contracting: CalendarCheck2,
  training: GraduationCap,
  dialer: Headphones,
  first_deal: Rocket,
} as const;

const BRAND = resolveBrand();

function StepAction({ step }: { step: OnboardingStep }) {
  if (!step.action_url || !step.action_label || step.status === "locked") return null;
  const external = /^https?:\/\//.test(step.action_url);
  const classes = "mt-3 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline";
  return external ? (
    <a className={classes} href={step.action_url} target="_blank" rel="noopener noreferrer">
      {step.action_label} <ExternalLink className="h-3 w-3" />
    </a>
  ) : (
    <Link className={classes} to={step.action_url}>{step.action_label}</Link>
  );
}

export function AgentOnboardingStepper({ agentId }: { agentId: string }) {
  const queryClient = useQueryClient();
  const queryKey = ["agent-onboarding-roadmap", agentId] as const;
  const query = useQuery({
    queryKey,
    queryFn: async (): Promise<OnboardingRoadmap> => {
      const { data, error } = await (supabase as any).rpc("apex_agent_onboarding_roadmap", { p_agent_id: agentId });
      if (error) throw error;
      if (!data || !Array.isArray(data.steps)) throw new Error("Onboarding roadmap is unavailable");
      return data as OnboardingRoadmap;
    },
    staleTime: 15_000,
    // 60s -> 5min. These read realtime-covered tables and a one-minute poll on
    // a page left open all day is what produced 11+ hours of database time
    // across the platform's top RPCs.
    refetchInterval: 300_000,
  });

  const refresh = () => void queryClient.invalidateQueries({ queryKey });
  useRealtimeTable({ table: "agents", filter: `id=eq.${agentId}`, channelSuffix: `roadmap-agent-${agentId}` }, refresh);
  useRealtimeTable({ table: "onboarding_progress", filter: `agent_id=eq.${agentId}`, channelSuffix: `roadmap-training-${agentId}` }, refresh);
  useRealtimeTable({ table: "interview_events", filter: `agent_id=eq.${agentId}`, channelSuffix: `roadmap-call-${agentId}` }, refresh);
  useRealtimeTable({ table: "messaging_identity_links", filter: `agent_id=eq.${agentId}`, channelSuffix: `roadmap-slack-${agentId}` }, refresh);

  if (query.isLoading) return <Skeleton className="h-56 rounded-xl" />;
  if (query.isError || !query.data) return null;

  const roadmap = query.data;
  const nextExternal = Boolean(roadmap.next_step_url && /^https?:\/\//.test(roadmap.next_step_url));

  return (
    <Card className="overflow-hidden border-primary/30 bg-card">
      <div className="border-b border-border bg-primary/5 p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Your {BRAND.platformName} launch roadmap</p>
            <h2 className="mt-1 text-xl font-bold">You always know what happens next</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {roadmap.path === "licensed" ? "Licensed fast track" : "Licensing fast track"} · {roadmap.completed_steps} of {roadmap.total_steps} milestones complete
            </p>
          </div>
          <div className="min-w-28 text-left sm:text-right">
            <p className="text-2xl font-bold tabular-nums text-primary">{roadmap.progress_percent}%</p>
            <p className="text-xs text-muted-foreground">launch progress</p>
          </div>
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted" aria-label={`${roadmap.progress_percent}% complete`}>
          <div className="h-full rounded-full bg-primary transition-[width] duration-200" style={{ width: `${roadmap.progress_percent}%` }} />
        </div>
      </div>

      {roadmap.next_step_label && (
        <div className="border-b border-border bg-background/40 p-4 sm:p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-primary">Do this now</p>
              <p className="mt-1 text-lg font-bold">{roadmap.next_step_label}</p>
              <p className="mt-1 text-sm text-muted-foreground">{roadmap.next_step_detail}</p>
            </div>
            {roadmap.next_step_url && roadmap.next_step_action && (
              <Button asChild className="h-11 shrink-0 font-bold">
                {nextExternal ? (
                  <a href={roadmap.next_step_url} target="_blank" rel="noopener noreferrer">
                    {roadmap.next_step_action} <ExternalLink className="ml-2 h-4 w-4" />
                  </a>
                ) : (
                  <Link to={roadmap.next_step_url}>{roadmap.next_step_action}</Link>
                )}
              </Button>
            )}
          </div>
        </div>
      )}

      <ol className="grid gap-px bg-border sm:grid-cols-2 xl:grid-cols-3">
        {roadmap.steps.map((step, index) => {
          const Icon = STEP_ICONS[step.key as keyof typeof STEP_ICONS] ?? Circle;
          const complete = step.status === "complete";
          const current = step.status === "current";
          return (
            <li key={step.key} className={cn("bg-card p-4", current && "bg-primary/5")}>
              <div className="flex items-start gap-3">
                <span className={cn(
                  "grid h-9 w-9 shrink-0 place-items-center rounded-full border",
                  complete && "border-emerald-500/40 bg-emerald-500/10 text-emerald-500",
                  current && "border-primary bg-primary text-primary-foreground",
                  step.status === "locked" && "border-border bg-muted text-muted-foreground",
                )}>
                  {complete ? <Check className="h-4 w-4" /> : step.status === "locked" ? <LockKeyhole className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
                </span>
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Step {index + 1}</p>
                  <p className="text-sm font-bold">{step.label}</p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{step.detail}</p>
                  <StepAction step={step} />
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      <div className="flex flex-col gap-2 border-t border-border p-4 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <span>Contracting questions: {roadmap.contact_name}, Contracting &amp; Onboarding Manager</span>
        <a className="font-semibold text-foreground hover:text-primary" href={`mailto:${roadmap.contact_email}`}>
          {roadmap.contact_email}
        </a>
      </div>
    </Card>
  );
}

export default AgentOnboardingStepper;
