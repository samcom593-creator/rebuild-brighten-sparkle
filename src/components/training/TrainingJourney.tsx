// TrainingJourney: the Training Center's front page (MP-TRAINING-CENTER.2, 2026-11-23).
//
// Sam: the tab "looks a little bit overwhelming. It should be easily used. Something that agents are having to go
// through." So the first screen is four steps in order with one obvious next action, not six module cards and a
// course grid. Field Course, then the top calls, then the objections, then practice. The module-by-module list is
// still here, folded under step one for the agent who wants it.
import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Check, ChevronDown, FileText, GraduationCap, Headphones, MessageCircleQuestion, Mic, Phone, Star, TrendingUp } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/glass-card";
import { Progress } from "@/components/ui/progress";
import { TrainingPathPanel } from "@/components/training/TrainingPathPanel";
import { resolveBrand } from "@/config/brand";
import { TRAINING_ROUTES } from "@/lib/trainingRoutes";
import { cn } from "@/lib/utils";
import { contactLinkProps, phoneHref } from "@/lib/phone";
import { OBJECTION_TYPES_GOAL, START_CALL_COUNT, useTrainingProgress } from "@/components/training/useTrainingProgress";

const HELP_PHONE = "+19788047212";
const OFFICIAL_SCRIPT = "https://docs.google.com/document/d/1OeDu_6TABfIJtVHrn1TrJUjWGzgehYttoMj7ttSebxI/edit?tab=t.0#heading=h.u8s4qkrx1od7";

interface Step {
  key: string;
  title: string;
  blurb: string;
  icon: typeof Star;
  done: boolean;
  status: string;
  cta: string;
  go: () => void;
  href?: string;
}

function useFieldCourse() {
  const { user } = useAuth();
  // Same keys as TrainingPathPanel, so opening the module list below costs no second read.
  const agentQ = useQuery({
    queryKey: ["training-path-agent", user?.id],
    enabled: !!user?.id,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from("agents").select("id, display_name").eq("user_id", user!.id).order("created_at", { ascending: false }).limit(1);
      if (error) throw error;
      return (data?.[0] as { id: string; display_name: string | null } | undefined) ?? null;
    },
  });
  const agentId = agentQ.data?.id ?? null;
  const modulesQ = useQuery({
    queryKey: ["training-path-modules"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from("onboarding_modules").select("id, order_index, title, description, pass_threshold").eq("is_active", true).order("order_index");
      if (error) throw error;
      return data ?? [];
    },
  });
  const progressQ = useQuery({
    queryKey: ["training-path-progress", agentId],
    enabled: !!agentId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from("onboarding_progress").select("module_id, passed, video_watched_percent, score, completed_at, started_at").eq("agent_id", agentId!);
      if (error) throw error;
      return data ?? [];
    },
  });
  const total = modulesQ.data?.length ?? 0;
  const passedIds = new Set((progressQ.data ?? []).filter((p) => p.passed === true).map((p) => p.module_id));
  const passed = (modulesQ.data ?? []).filter((m) => passedIds.has(m.id)).length;
  return { total, passed, firstName: (agentQ.data?.display_name ?? "").trim().split(/\s+/)[0] || "" };
}

function usePracticeCount() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["training-center-practice", user?.id],
    enabled: !!user?.id,
    staleTime: 60_000,
    queryFn: async () => {
      const { count, error } = await supabase.from("call_lab_sessions").select("id", { count: "exact", head: true }).eq("user_id", user!.id).eq("status", "complete");
      if (error) throw error;
      return count ?? 0;
    },
  });
}

export function TrainingJourney({ onOpenTab, callsAvailable }: { onOpenTab: (tab: string) => void; callsAvailable: number | null }) {
  const course = useFieldCourse();
  const practice = usePracticeCount();
  const { heardCalls, heardObjections } = useTrainingProgress();
  const [showModules, setShowModules] = useState(false);
  const brand = resolveBrand().shortName;

  const callGoal = callsAvailable == null ? START_CALL_COUNT : Math.min(START_CALL_COUNT, callsAvailable);
  const callsHeard = Math.min(heardCalls.size, callGoal);
  const objectionsHeard = Math.min(heardObjections.size, OBJECTION_TYPES_GOAL);
  const practiced = practice.data ?? 0;

  const steps: Step[] = [
    {
      key: "course",
      title: "Field Course",
      blurb: "The script, the dialer and the close, one lesson at a time.",
      icon: GraduationCap,
      done: course.total > 0 && course.passed >= course.total,
      status: course.total > 0 ? `${course.passed} of ${course.total} lessons passed` : "Your lessons",
      cta: course.total > 0 && course.passed >= course.total ? "Review" : course.passed > 0 ? "Continue" : "Start",
      go: () => {
        setShowModules(true);
        requestAnimationFrame(() => document.getElementById("training-course-modules")?.scrollIntoView({ behavior: "smooth", block: "start" }));
      },
    },
    {
      key: "calls",
      title: "Top calls",
      blurb: "Hear how the best agents on the team open, handle pushback and close.",
      icon: Star,
      done: callGoal > 0 && callsHeard >= callGoal,
      status: callGoal > 0 ? `${callsHeard} of ${callGoal} heard` : "Calls are being prepared",
      cta: callsHeard > 0 && callsHeard < callGoal ? "Keep listening" : "Listen",
      go: () => onOpenTab("calls"),
    },
    {
      key: "objections",
      title: "Objections",
      blurb: "Pick what the client said. Read what worked. Hear the moment.",
      icon: MessageCircleQuestion,
      done: objectionsHeard >= OBJECTION_TYPES_GOAL,
      status: `${objectionsHeard} of ${OBJECTION_TYPES_GOAL} objection types heard`,
      cta: "Open",
      go: () => onOpenTab("objections"),
    },
    {
      key: "practice",
      title: "Practice a call",
      blurb: "Run the script out loud against a live roleplay before you dial.",
      icon: Mic,
      done: practiced > 0,
      status: practiced > 0 ? `${practiced} practice call${practiced === 1 ? "" : "s"} done` : "No practice calls yet",
      cta: "Practice",
      go: () => undefined,
      href: "/dashboard/call-lab",
    },
  ];
  const doneCount = steps.filter((s) => s.done).length;
  const next = steps.find((s) => !s.done) ?? null;
  const pct = Math.round((doneCount / steps.length) * 100);

  return (
    <div className="space-y-8">
      <GlassCard className="p-5 sm:p-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-primary">{next ? "Next up" : "All four steps done"}</p>
            <h2 className="mt-1 text-2xl font-bold leading-tight sm:text-3xl">
              {next ? next.title : `${course.firstName ? `${course.firstName}, you` : "You"} are phone-ready`}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">{next ? next.blurb : "Keep the top calls and the objections open while you dial."}</p>
          </div>
          {next && <StepAction step={next} size="lg" />}
        </div>
        <div className="mt-5 flex items-center gap-3">
          <Progress value={pct} className="h-2 flex-1" aria-label="Training steps complete" />
          <span className="shrink-0 text-xs font-medium tabular-nums text-muted-foreground">{doneCount} of {steps.length} steps</span>
        </div>
      </GlassCard>

      <ol className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {steps.map((s, i) => {
          const isNext = next?.key === s.key;
          const Icon = s.icon;
          return (
            <li key={s.key}>
              <GlassCard className={cn("flex h-full flex-col gap-3 p-5", isNext && "border-primary/60", s.done && "border-success/40")}>
                <div className="flex items-center gap-3">
                  <span
                    className={cn(
                      "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold",
                      s.done ? "bg-success/15 text-success" : isNext ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
                    )}
                  >
                    {s.done ? <Check className="h-4 w-4" /> : i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 text-base font-semibold leading-tight">
                      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                      {s.title}
                    </p>
                    <p className="text-xs text-muted-foreground">{s.status}</p>
                  </div>
                </div>
                <p className="flex-1 text-sm text-muted-foreground">{s.blurb}</p>
                <div><StepAction step={s} quiet={!isNext} /></div>
              </GlassCard>
            </li>
          );
        })}
      </ol>

      <section id="training-course-modules" className="scroll-mt-24 space-y-3">
        <button
          type="button"
          onClick={() => setShowModules((v) => !v)}
          aria-expanded={showModules}
          className="flex w-full items-center justify-between rounded-md border border-border px-4 py-3 text-left text-sm font-semibold hover:bg-muted/40"
        >
          <span>Field Course lessons</span>
          <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", showModules && "rotate-180")} />
        </button>
        {showModules && (
          <div className="space-y-3">
            <TrainingPathPanel />
            <Button asChild variant="outline" size="sm" className="gap-2">
              <Link to={TRAINING_ROUTES.fieldCourse}>
                Open the Field Course
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">Keep these open</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <ResourceTile icon={<FileText className="h-4 w-4" />} title={`Official ${brand} script`} sub="The words, start to close" href={OFFICIAL_SCRIPT} external />
          <ResourceTile icon={<FileText className="h-4 w-4" />} title="Scripts & guides" sub="Playbook, scripts, PDFs" onClick={() => onOpenTab("library")} />
          <ResourceTile icon={<Headphones className="h-4 w-4" />} title="Recordings" sub="Full calls from top closers" onClick={() => onOpenTab("recordings")} />
          <ResourceTile icon={<TrendingUp className="h-4 w-4" />} title="Annuities" sub="The annuity training" to={TRAINING_ROUTES.annuities} />
          {/* Onboarding help moved here from the old "Practice toolkit" block: a stuck agent needs a person, not a page. */}
          <a href={phoneHref(HELP_PHONE) ?? `tel:${HELP_PHONE}`} {...contactLinkProps(phoneHref(HELP_PHONE))} className="col-span-2 block h-full lg:col-span-1">
            <GlassCard className="flex h-full flex-col gap-1 border-primary/30 p-4 hover:border-primary">
              <span className="flex items-center gap-2 text-sm font-semibold"><Phone className="h-4 w-4 text-primary" />Stuck? Ask Aisha</span>
              <span className="text-xs text-muted-foreground">Call or text 978-804-7212</span>
            </GlassCard>
          </a>
        </div>
      </section>
    </div>
  );
}

function StepAction({ step, quiet = false, size = "sm" }: { step: Step; quiet?: boolean; size?: "sm" | "lg" }) {
  const body = (
    <>
      {step.cta}
      <ArrowRight className="h-4 w-4" />
    </>
  );
  if (step.href) {
    return (
      <Button asChild size={size} variant={quiet ? "outline" : "default"} className="gap-2">
        <Link to={step.href}>{body}</Link>
      </Button>
    );
  }
  return (
    <Button type="button" size={size} variant={quiet ? "outline" : "default"} className="gap-2" onClick={step.go}>
      {body}
    </Button>
  );
}

function ResourceTile({ icon, title, sub, href, to, onClick, external }: { icon: ReactNode; title: string; sub: string; href?: string; to?: string; onClick?: () => void; external?: boolean }) {
  const inner = (
    <GlassCard className="flex h-full flex-col gap-1 p-4 text-left hover:border-primary/40">
      <span className="flex items-center gap-2 text-sm font-semibold"><span className="text-primary">{icon}</span>{title}</span>
      <span className="text-xs text-muted-foreground">{sub}</span>
    </GlassCard>
  );
  if (href) return <a href={href} target={external ? "_blank" : undefined} rel={external ? "noopener noreferrer" : undefined} className="block h-full">{inner}</a>;
  if (to) return <Link to={to} className="block h-full">{inner}</Link>;
  return <button type="button" onClick={onClick} className="block h-full w-full">{inner}</button>;
}

export default TrainingJourney;
