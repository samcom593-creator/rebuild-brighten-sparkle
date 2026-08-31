import { useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Building2,
  CalendarCheck2,
  Check,
  Circle,
  ExternalLink,
  FileCheck2,
  GraduationCap,
  Headphones,
  Landmark,
  LockKeyhole,
  MessageSquare,
  RefreshCw,
  Rocket,
  ShieldCheck,
  UserRoundCheck,
} from "lucide-react";
import { Link } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { resolveBrand } from "@/config/brand";
import { supabase } from "@/integrations/supabase/client";
import { SCHEDULING_LINKS, TEAM_COMMUNITY_LINKS } from "@/lib/apexConfig";
import { TRAINING_ROUTES } from "@/lib/trainingRoutes";
import { cn } from "@/lib/utils";
import { useRealtimeTable } from "@/shared/realtime/useRealtimeTable";

type StepStatus = "complete" | "current" | "available" | "locked";

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
  contact_name: string;
  contact_email: string;
  steps: OnboardingStep[];
}

interface LaunchDetails {
  agent: {
    display_name: string | null;
    user_id: string | null;
    profile_id: string | null;
    license_status: string | null;
    nipr_number: string | null;
    eft_ready: boolean;
    eo_certificate_url: string | null;
    eo_expires_at: string | null;
    contracted_at: string | null;
  } | null;
  profile: {
    full_name: string | null;
    email: string | null;
    phone: string | null;
    state: string | null;
    avatar_url: string | null;
    photo_url: string | null;
  } | null;
  documents: Array<{ kind: string; status: string }>;
}

const STEP_ICONS = {
  profile: UserRoundCheck,
  slack: MessageSquare,
  license: ShieldCheck,
  intake: FileCheck2,
  call: CalendarCheck2,
  identity_documents: FileCheck2,
  eo: ShieldCheck,
  eft: Landmark,
  carriers: Building2,
  training: GraduationCap,
  dialer: Headphones,
  first_deal: Rocket,
} as const;

const BRAND = resolveBrand();

function hasLocalContractingReceipt(): boolean {
  try {
    const saved = JSON.parse(window.localStorage.getItem("apex.contracting.intake") ?? "null") as {
      intake_id?: string;
      status?: string;
    } | null;
    return Boolean(saved?.intake_id && ["accepted", "completed"].includes(saved.status ?? "accepted"));
  } catch {
    return false;
  }
}

function completeOrAvailable(complete: boolean): StepStatus {
  return complete ? "complete" : "available";
}

function buildCompleteLaunchSteps(
  roadmap: OnboardingRoadmap,
  details: LaunchDetails | null,
  localIntakeReceipt = false,
): OnboardingStep[] {
  const source = new Map(roadmap.steps.map((step) => [step.key, step]));
  const agent = details?.agent;
  const profile = details?.profile;
  const documents = details?.documents ?? [];
  const licensed = agent?.license_status === "licensed" || roadmap.path === "licensed";
  const profileReady = Boolean(
    profile?.full_name?.trim()
    && profile.email?.trim()
    && profile.phone?.trim()
    && profile.state?.trim()
    && (profile.avatar_url?.trim() || profile.photo_url?.trim()),
  );
  const npnReady = licensed && Boolean(agent?.nipr_number?.trim());
  const slack = source.get("slack");
  const originalLicense = source.get("license");
  const originalContracting = source.get("contracting");
  const training = source.get("training");
  const dialer = source.get("dialer");
  const firstDeal = source.get("first_deal");
  const callBooked = originalContracting?.status === "complete"
    || originalContracting?.label.toLowerCase().includes("finish contracting");
  const intakeReceived = localIntakeReceipt || originalContracting?.status === "complete";
  const approvedLicense = documents.some((doc) => doc.kind === "license" && doc.status === "approved");
  const approvedId = documents.some((doc) => doc.kind === "id" && doc.status === "approved");
  const submittedIdentityDocuments = documents.some(
    (doc) => ["license", "id"].includes(doc.kind) && doc.status === "submitted",
  );
  const identityDocumentsReady = approvedLicense && approvedId;
  const approvedEo = documents.some((doc) => doc.kind === "eo_certificate" && doc.status === "approved");
  const submittedEo = documents.some((doc) => doc.kind === "eo_certificate" && doc.status === "submitted");
  const eoExpiry = agent?.eo_expires_at?.trim();
  const eoExpiryTime = eoExpiry
    ? new Date(eoExpiry.length === 10 ? `${eoExpiry}T23:59:59` : eoExpiry).getTime()
    : Number.NaN;
  const eoExpired = Number.isFinite(eoExpiryTime) && eoExpiryTime < Date.now();
  const eoCurrent = !eoExpired && (Boolean(agent?.eo_certificate_url) || approvedEo);
  const approvedEft = documents.some((doc) => doc.kind === "voided_check" && doc.status === "approved");
  const submittedEft = documents.some((doc) => doc.kind === "voided_check" && doc.status === "submitted");
  const eftReady = Boolean(agent?.eft_ready) || approvedEft;
  const carriersReady = Boolean(agent?.contracted_at);

  const steps: OnboardingStep[] = [
    {
      key: "profile",
      label: "Confirm your account and profile",
      detail: profileReady
        ? "Your name, email, mobile number, state, and profile photo are confirmed."
        : "Confirm your name, email, mobile number, photo, state, and contact details so the team can reach you.",
      status: completeOrAvailable(profileReady),
      action_label: profileReady ? null : "Complete profile",
      action_url: profileReady ? null : "/dashboard/profile",
    },
    {
      key: "slack",
      label: `Join the ${BRAND.shortName} Slack`,
      detail: slack?.detail ?? "Join the team workspace for launch support, announcements, and daily help.",
      status: slack?.status === "complete" ? "complete" : "available",
      action_label: slack?.status === "complete" ? null : "Join Slack",
      action_url: slack?.status === "complete" ? null : (slack?.action_url ?? TEAM_COMMUNITY_LINKS.slack),
    },
    {
      key: "license",
      label: "Finish licensing and confirm your NPN",
      detail: npnReady
        ? `Licensed producer record confirmed${agent?.nipr_number ? ` · NPN ${agent.nipr_number}` : ""}.`
        : licensed
          ? "Your license is marked active. Add your NPN through the contracting intake so carrier setup can match your record."
          : (originalLicense?.detail ?? "Complete the course, exam, fingerprints, state license, and NPN milestones."),
      status: npnReady ? "complete" : "available",
      action_label: npnReady ? null : (licensed ? "Add NPN" : "Open licensing roadmap"),
      action_url: npnReady ? null : (licensed ? "/start-contracting" : "/get-licensed"),
    },
    {
      key: "intake",
      label: "Submit your contracting intake",
      detail: intakeReceived
        ? `Your ${BRAND.shortName} contracting intake has a durable receipt.`
        : "Review the details already on file and submit only what is missing.",
      status: intakeReceived ? "complete" : licensed ? "available" : "locked",
      action_label: intakeReceived || !licensed ? null : "Complete intake",
      action_url: intakeReceived || !licensed ? null : "/start-contracting",
    },
    {
      key: "call",
      label: "Book your onboarding call",
      detail: callBooked
        ? "Your onboarding call with Milver is on the calendar."
        : "Book the 30-minute fast-track call so contracting, training, and launch ownership are clear.",
      status: callBooked ? "complete" : licensed ? "available" : "locked",
      action_label: callBooked || !licensed ? null : "Book with Milver",
      action_url: callBooked || !licensed ? null : SCHEDULING_LINKS.onboarding,
    },
    {
      key: "identity_documents",
      label: "Upload license and identity documents",
      detail: identityDocumentsReady
        ? "Your license and identity documents are approved in the private document vault."
        : submittedIdentityDocuments
          ? "One or more identity documents are uploaded and waiting for review."
          : "Upload your insurance license and government-issued ID privately for appointment verification.",
      status: identityDocumentsReady ? "complete" : licensed ? "available" : "locked",
      action_label: identityDocumentsReady || !licensed ? null : "Open private documents",
      action_url: identityDocumentsReady || !licensed ? null : "/dashboard/profile#contracting-documents",
    },
    {
      key: "eo",
      label: "Secure and upload E&O coverage",
      detail: eoCurrent
        ? "An approved E&O certificate is on file."
        : eoExpired
          ? "The E&O certificate on file has expired. Replace it before carrier appointment work continues."
        : submittedEo
          ? "Your E&O certificate is uploaded and waiting for review."
          : "Purchase active errors-and-omissions coverage if needed, then upload the certificate privately.",
      status: eoCurrent ? "complete" : licensed ? "available" : "locked",
      action_label: eoCurrent || !licensed ? null : (submittedEo ? "View documents" : "Open E&O and documents"),
      action_url: eoCurrent || !licensed ? null : "/dashboard/profile#contracting-documents",
    },
    {
      key: "eft",
      label: "Prepare EFT documentation",
      detail: eftReady
        ? "EFT readiness is confirmed."
        : submittedEft
          ? "Your voided check or bank letter is uploaded and waiting for review."
          : "Upload a voided check or bank letter privately. Enter account and routing numbers only inside carrier portals.",
      status: eftReady ? "complete" : licensed ? "available" : "locked",
      action_label: eftReady || !licensed ? null : "Upload EFT document",
      action_url: eftReady || !licensed ? null : "/dashboard/profile#contracting-documents",
    },
    {
      key: "carriers",
      label: "Finish carrier appointments",
      detail: carriersReady
        ? "Carrier contracting is recorded and your producer setup is active."
        : "Complete carrier-specific forms, signatures, EFT, and appointment requirements in each secure carrier portal.",
      status: carriersReady ? "complete" : licensed ? "available" : "locked",
      action_label: carriersReady || !licensed ? null : "Open carrier directory",
      action_url: carriersReady || !licensed ? null : "/dashboard/contracting/carriers",
    },
    {
      key: "training",
      label: "Complete every onboarding module",
      detail: training?.detail ?? `Finish the ${BRAND.shortName}, script, objections, ReadyMode, pipeline, deal-posting, and underwriting modules.`,
      status: training?.status === "complete" ? "complete" : licensed ? "available" : "locked",
      action_label: training?.status === "complete" || !licensed ? null : "Resume training",
      action_url: training?.status === "complete" || !licensed ? null : TRAINING_ROUTES.fieldCourse,
    },
    {
      key: "dialer",
      label: "Get ReadyMode field-ready",
      detail: dialer?.detail ?? "Complete the system walkthroughs and have your manager confirm dialer access.",
      status: dialer?.status === "complete" ? "complete" : training?.status === "complete" ? "available" : "locked",
      action_label: dialer?.status === "complete" || training?.status !== "complete" ? null : "Review ReadyMode training",
      action_url: dialer?.status === "complete" || training?.status !== "complete" ? null : TRAINING_ROUTES.fieldCourse,
    },
    {
      key: "first_deal",
      label: "Post your first deal",
      detail: firstDeal?.detail ?? "Launch into the field and post your first submitted policy so production and commissions update.",
      status: firstDeal?.status === "complete" ? "complete" : dialer?.status === "complete" && carriersReady ? "available" : "locked",
      action_label: firstDeal?.status === "complete" || dialer?.status !== "complete" || !carriersReady ? null : "Post a deal",
      action_url: firstDeal?.status === "complete" || dialer?.status !== "complete" || !carriersReady ? null : "/dashboard/production",
    },
  ];

  let currentAssigned = false;
  return steps.map((step) => {
    if (step.status !== "available" || currentAssigned) return step;
    currentAssigned = true;
    return { ...step, status: "current" };
  });
}

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
  const detailsKey = ["agent-onboarding-launch-details", agentId] as const;
  const query = useQuery({
    queryKey,
    queryFn: async (): Promise<OnboardingRoadmap> => {
      const { data, error } = await supabase.rpc(
        "apex_agent_onboarding_roadmap" as never,
        { p_agent_id: agentId } as never,
      );
      if (error) throw error;
      const payload = data as unknown as OnboardingRoadmap | null;
      if (!payload || !Array.isArray(payload.steps)) throw new Error("Onboarding roadmap is unavailable");
      return payload;
    },
    staleTime: 15_000,
    refetchInterval: 300_000,
  });
  const detailsQuery = useQuery({
    queryKey: detailsKey,
    queryFn: async (): Promise<LaunchDetails> => {
      const { data: agent, error: agentError } = await supabase
        .from("agents")
        .select("display_name,user_id,profile_id,license_status,nipr_number,eft_ready,eo_certificate_url,eo_expires_at,contracted_at")
        .eq("id", agentId)
        .maybeSingle();
      if (agentError) throw agentError;

      const profileQuery = agent?.profile_id
        ? supabase.from("profiles").select("full_name,email,phone,state,avatar_url,photo_url").eq("id", agent.profile_id).maybeSingle()
        : agent?.user_id
          ? supabase.from("profiles").select("full_name,email,phone,state,avatar_url,photo_url").eq("user_id", agent.user_id).maybeSingle()
          : Promise.resolve({ data: null, error: null });
      const [profileResult, documentsResult] = await Promise.all([
        profileQuery,
        supabase
          .from("agent_documents" as never)
          .select("kind,status")
          .eq("agent_id", agentId),
      ]);

      return {
        agent,
        profile: profileResult.error ? null : profileResult.data,
        documents: documentsResult.error
          ? []
          : (documentsResult.data ?? []) as unknown as Array<{ kind: string; status: string }>,
      };
    },
    staleTime: 15_000,
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey });
    void queryClient.invalidateQueries({ queryKey: detailsKey });
  };
  useRealtimeTable({ table: "agents", filter: `id=eq.${agentId}`, channelSuffix: `roadmap-agent-${agentId}` }, refresh);
  useRealtimeTable({ table: "agent_documents", filter: `agent_id=eq.${agentId}`, channelSuffix: `roadmap-documents-${agentId}` }, refresh);
  useRealtimeTable({ table: "onboarding_progress", filter: `agent_id=eq.${agentId}`, channelSuffix: `roadmap-training-${agentId}` }, refresh);
  useRealtimeTable({ table: "interview_events", filter: `agent_id=eq.${agentId}`, channelSuffix: `roadmap-call-${agentId}` }, refresh);
  useRealtimeTable({ table: "messaging_identity_links", filter: `agent_id=eq.${agentId}`, channelSuffix: `roadmap-slack-${agentId}` }, refresh);

  const steps = useMemo(
    () => query.data ? buildCompleteLaunchSteps(query.data, detailsQuery.data ?? null, hasLocalContractingReceipt()) : [],
    [detailsQuery.data, query.data],
  );

  if (query.isLoading) return <Skeleton className="h-72 rounded-xl" />;
  if (query.isError || !query.data) {
    return (
      <Card className="border-amber-500/35 bg-amber-500/5 p-5" role="alert">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" aria-hidden />
          <div className="min-w-0 flex-1">
            <h2 className="font-bold">Your launch roadmap needs a refresh</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Your progress is still saved. Retry here or contact onboarding so you never have to guess what comes next.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => void query.refetch()}>
                <RefreshCw className="mr-1.5 h-4 w-4" /> Retry
              </Button>
              <Button asChild size="sm" variant="outline">
                <a href="mailto:milver.taca@gmail.com">Email Milver</a>
              </Button>
            </div>
          </div>
        </div>
      </Card>
    );
  }

  const completedSteps = steps.filter((step) => step.status === "complete").length;
  const progressPercent = steps.length ? Math.round((completedSteps / steps.length) * 100) : 0;
  const nextStep = steps.find((step) => step.status === "current") ?? null;
  const nextExternal = Boolean(nextStep?.action_url && /^https?:\/\//.test(nextStep.action_url));

  return (
    <Card className="overflow-hidden border-primary/30 bg-card">
      <div className="border-b border-border bg-primary/5 p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Your complete {BRAND.platformName} launch roadmap</p>
            <h2 className="mt-1 text-xl font-bold">Nothing skipped. You always know what happens next.</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {query.data.path === "licensed" ? "Licensed fast track" : "Licensing fast track"} · {completedSteps} of {steps.length} verified milestones complete
            </p>
          </div>
          <div className="min-w-28 text-left sm:text-right">
            <p className="text-2xl font-bold tabular-nums text-primary">{progressPercent}%</p>
            <p className="text-xs text-muted-foreground">launch progress</p>
          </div>
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted" aria-label={`${progressPercent}% complete`}>
          <div className="h-full rounded-full bg-primary transition-[width] duration-200" style={{ width: `${progressPercent}%` }} />
        </div>
      </div>

      {nextStep && (
        <div className="border-b border-border bg-background/40 p-4 sm:p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-primary">Do this now</p>
              <p className="mt-1 text-lg font-bold">{nextStep.label}</p>
              <p className="mt-1 text-sm text-muted-foreground">{nextStep.detail}</p>
            </div>
            {nextStep.action_url && nextStep.action_label && (
              <Button asChild className="h-11 shrink-0 font-bold">
                {nextExternal ? (
                  <a href={nextStep.action_url} target="_blank" rel="noopener noreferrer">
                    {nextStep.action_label} <ExternalLink className="ml-2 h-4 w-4" />
                  </a>
                ) : (
                  <Link to={nextStep.action_url}>{nextStep.action_label}</Link>
                )}
              </Button>
            )}
          </div>
        </div>
      )}

      <ol className="grid gap-px bg-border sm:grid-cols-2 xl:grid-cols-3">
        {steps.map((step, index) => {
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
                  step.status === "available" && "border-primary/40 bg-primary/5 text-primary",
                  step.status === "locked" && "border-border bg-muted text-muted-foreground",
                )}>
                  {complete ? <Check className="h-4 w-4" /> : step.status === "locked" ? <LockKeyhole className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
                </span>
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Step {index + 1}</p>
                  <p className="text-sm font-bold">{step.label}</p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{step.detail}</p>
                  {step.status === "locked" && (
                    <p className="mt-2 text-[11px] font-medium text-muted-foreground">Unlocks after the earlier required milestones.</p>
                  )}
                  <StepAction step={step} />
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      <div className="border-t border-border p-4">
        {detailsQuery.isError && (
          <p className="mb-2 text-xs text-amber-600 dark:text-amber-400">
            Some document and profile receipts could not be checked. Every step remains visible; refresh to update completion marks.
          </p>
        )}
        <div className="flex flex-col gap-2 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <span>Stuck at any step? {query.data.contact_name}, Contracting &amp; Onboarding Manager, owns the handoff.</span>
          <a className="font-semibold text-foreground hover:text-primary" href={`mailto:${query.data.contact_email}`}>
            {query.data.contact_email}
          </a>
        </div>
      </div>
    </Card>
  );
}

export default AgentOnboardingStepper;
