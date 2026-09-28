import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowRight, BookOpenCheck, Check, Circle, Compass, Phone, ShieldCheck, UserRoundCheck, Building2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { resolveBrand } from "@/config/brand";
import { supabase } from "@/integrations/supabase/client";
import { TRAINING_ROUTES } from "@/lib/trainingRoutes";
import { cn } from "@/lib/utils";

/**
 * FirstLoginGuide: the thing a brand-new agent sees before anything else.
 *
 * Sam, 2026-09-27: "I just had a new agent come to the dashboard and it felt a
 * little confused, asking me what's next." The home already carried an
 * 11-tile launch stepper and a pipeline next-step card; what it never had was
 * a first-login moment that says "welcome, here is the ONE thing to do now",
 * and a way back to that guide. This renders two things while an agent is
 * still getting started:
 *
 *   1. A welcome dialog on their first visit (per browser, per agent), laying
 *      out the four phases and one primary button for the current phase.
 *   2. A compact "Start here" card pinned above the stepper: step N of M, one
 *      action, and a button that reopens the full guide.
 *
 * Both disappear once the agent is settled (live / producing / evaluated) or
 * has closed a deal. Training is deliberately step 2 for everyone, licensed or
 * not: the course is the job, and it can run alongside licensing.
 */

const BRAND = resolveBrand();
const SETTLED_STAGES = new Set(["live", "producing", "evaluated"]);

type Phase = {
  key: "setup" | "training" | "license" | "contracting" | "writing";
  label: string;
  detail: string;
  href: string;
  cta: string;
  done: boolean;
  icon: typeof Compass;
};

type GuideData = {
  isAgent: boolean;
  firstName: string;
  stage: string;
  licensed: boolean;
  contracted: boolean;
  progress: Record<string, string | null> | null;
};

function storageKey(agentId: string) {
  return `apex.first-login-guide.v1.${agentId}`;
}
function hasSeen(agentId: string): boolean {
  try { return window.localStorage.getItem(storageKey(agentId)) === "1"; } catch { return true; }
}
function markSeen(agentId: string) {
  try { window.localStorage.setItem(storageKey(agentId), "1"); }
  catch (e) { console.warn("[first-login-guide] localStorage unavailable; the card still renders", e); }
}

export function FirstLoginGuide({ agentId }: { agentId: string }) {
  const { data } = useQuery({
    queryKey: ["first-login-guide", agentId],
    staleTime: 60_000,
    queryFn: async (): Promise<GuideData> => {
      const [agentRes, progressRes] = await Promise.all([
        (supabase as any).from("agents").select("display_name, onboarding_stage, license_status, contracted_at").eq("id", agentId).limit(1),
        (supabase as any).from("getting_started_progress").select("*").eq("agent_id", agentId).limit(1),
      ]);
      const agent = (agentRes.data ?? [])[0] ?? null;
      const progress = (progressRes.data ?? [])[0] ?? null;
      return {
        isAgent: Boolean(agent),
        firstName: String(agent?.display_name ?? "").trim().split(" ")[0] || "there",
        stage: String(agent?.onboarding_stage ?? ""),
        licensed: agent?.license_status === "licensed",
        contracted: Boolean(agent?.contracted_at || progress?.contracted_with_carriers),
        progress,
      };
    },
  });

  const phases = useMemo<Phase[]>(() => {
    if (!data) return [];
    const p = data.progress ?? {};
    const list: Phase[] = [
      {
        key: "setup", icon: UserRoundCheck,
        label: "Set up your account",
        detail: "Name, phone, state and a photo so the team can reach you. Five minutes.",
        href: "/dashboard/profile", cta: "Finish my profile",
        done: Boolean(p.completed_profile || p.added_phone_number),
      },
      {
        key: "training", icon: BookOpenCheck,
        label: "Start your training",
        detail: "The course is the job. Open module 1 today; everything else runs alongside it.",
        href: TRAINING_ROUTES.root, cta: "Start training",
        done: Boolean(p.completed_first_training),
      },
      data.licensed
        ? {
            key: "contracting", icon: Building2,
            label: "Get contracted",
            detail: "One secure link, your NPN, and the contracting desk handles the carriers.",
            href: "/start-contracting", cta: "Open contracting",
            done: data.contracted,
          }
        : {
            key: "license", icon: ShieldCheck,
            label: "Get licensed",
            detail: "Course, exam, fingerprints, state license. We walk you through every step.",
            href: "/get-licensed", cta: "Open the licensing roadmap",
            done: Boolean(p.received_license),
          },
      {
        key: "writing", icon: Phone,
        label: "Start writing",
        detail: "Dial, present, close. Your first deal is the finish line of onboarding.",
        href: "/dashboard/call-center", cta: "Open the call center",
        done: Boolean(p.closed_first_deal),
      },
    ];
    return list;
  }, [data]);

  const current = phases.find((ph) => !ph.done) ?? null;
  const settled = !data || !data.isAgent || SETTLED_STAGES.has(data.stage) || Boolean(data.progress?.closed_first_deal);
  const visible = !settled && current !== null;

  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (visible && !hasSeen(agentId)) setOpen(true);
  }, [visible, agentId]);

  if (!visible || !current) return null;

  const stepIndex = phases.findIndex((ph) => ph.key === current.key) + 1;
  const Icon = current.icon;
  const close = () => { markSeen(agentId); setOpen(false); };

  return (
    <>
      <Card className="border-primary/40 bg-primary/5 p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-primary/30 bg-white dark:bg-card">
            <Icon className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary">Start here · step {stepIndex} of {phases.length}</p>
            <p className="text-base font-bold leading-tight text-foreground">{current.label}</p>
            <p className="text-xs text-muted-foreground">{current.detail}</p>
          </div>
          <div className="flex flex-wrap gap-2 sm:ml-auto">
            <Button asChild size="sm" onClick={() => markSeen(agentId)}>
              <Link to={current.href}>{current.cta} <ArrowRight className="ml-1.5 h-4 w-4" /></Link>
            </Button>
            <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
              <Compass className="mr-1.5 h-4 w-4" /> Full guide
            </Button>
          </div>
        </div>
      </Card>

      <Dialog open={open} onOpenChange={(next) => { if (!next) close(); else setOpen(true); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Welcome to {BRAND.shortName}, {data?.firstName}.</DialogTitle>
            <DialogDescription>
              Four phases, in order. You are on step {stepIndex}. Do that one now; the rest unlock as you go.
            </DialogDescription>
          </DialogHeader>
          <ol className="space-y-2">
            {phases.map((ph, i) => {
              const isCurrent = ph.key === current.key;
              const PhIcon = ph.icon;
              return (
                <li
                  key={ph.key}
                  className={cn(
                    "flex items-start gap-3 rounded-md border p-3",
                    ph.done && "border-emerald-500/30 bg-emerald-500/5",
                    isCurrent && "border-primary/50 bg-primary/5",
                    !ph.done && !isCurrent && "border-border/60 opacity-70",
                  )}
                >
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-bold">
                    {ph.done ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : isCurrent ? i + 1 : <Circle className="h-3 w-3 text-muted-foreground" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className={cn("text-sm font-semibold", ph.done && "text-muted-foreground line-through")}>
                      <PhIcon className="mr-1.5 inline h-3.5 w-3.5 align-[-2px]" />{ph.label}
                    </p>
                    <p className="text-xs text-muted-foreground">{ph.detail}</p>
                  </div>
                  {isCurrent && <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-primary-foreground">now</span>}
                </li>
              );
            })}
          </ol>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" onClick={close}>I'll look around first</Button>
            <Button asChild onClick={close}>
              <Link to={current.href}>{current.cta} <ArrowRight className="ml-1.5 h-4 w-4" /></Link>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
