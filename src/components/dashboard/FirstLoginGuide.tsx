import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowRight, BookOpenCheck, CalendarCheck, Check, Circle, Compass, Phone, ShieldCheck, UserRoundCheck, Building2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { resolveBrand } from "@/config/brand";
import { supabase } from "@/integrations/supabase/client";
import { TRAINING_ROUTES } from "@/lib/trainingRoutes";
import { claimOnboardingPopup } from "@/lib/onboardingPopupGate";
import { cn } from "@/lib/utils";

import { CONTRACTING_PROFILE_PATH } from "@/lib/contractingLinks";
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
 *      out the phases and one primary button for the current phase.
 *   2. A compact "Start here" card pinned above the stepper: step N of M, one
 *      action, and a button that reopens the full guide.
 *
 * Both disappear once the agent is settled (live / evaluated) or has closed a
 * deal. Training is deliberately an early step for everyone, licensed or not:
 * the course is the job, and it can run alongside licensing.
 *
 * WP6 (2026-11-10): every step is computed from facts via the own-row RPC
 * public.my_activation_state(). Licensed hires get a "Book your onboarding
 * call" step: that call is where contracting gets set up, and only 2 of 20
 * licensed hires since 09-10 booked it from the one email they got. Agents
 * cannot read agent_onboarding_queue or interview_events under RLS, which is
 * why the guide could never show it before. If the RPC is unavailable the
 * guide falls back to the de45caab direct reads (profile, training rows,
 * license, first deal) and simply omits the call step.
 */

const BRAND = resolveBrand();
// 'producing' is not an onboarding_stage enum value; that branch was dead code.
const SETTLED_STAGES = new Set(["live", "evaluated"]);

type Phase = {
  key: "setup" | "onboarding_call" | "training" | "license" | "contracting" | "writing";
  label: string;
  detail: string;
  /** null = nothing to click (for example no booking link configured). */
  href: string | null;
  /** Opens in a new tab (a Calendly booking page), not an in-app route. */
  external?: boolean;
  cta: string;
  done: boolean;
  icon: typeof Compass;
};

type OnboardingCall = { booked: boolean; at: string | null; url: string | null };

type GuideData = {
  isAgent: boolean;
  firstName: string;
  stage: string;
  licensed: boolean;
  contracted: boolean;
  /** The agent's own contracting profile is in; staff confirm each carrier. */
  contractingSubmitted: boolean;
  /** Facts the system already records. The getting_started_progress checkboxes
   *  stay as a manual override, but nothing writes them automatically: on
   *  2026-11-10 all 58 agents who could see this guide were stuck on "step 1 of 4"
   *  (43 had a complete profile, 7 had passed a training module, 5 had closed a deal). */
  profileComplete: boolean;
  trainingStarted: boolean;
  requiredPassed: number | null;
  requiredTotal: number | null;
  firstDeal: boolean;
  /** null when the facts RPC was unavailable: the step is omitted, not guessed. */
  onboardingCall: OnboardingCall | null;
  progress: Record<string, string | null> | null;
};

type ActivationStateRow = {
  agent_id: string;
  first_name: string | null;
  onboarding_stage: string | null;
  license_status: string | null;
  profile_complete: boolean | null;
  training_started: boolean | null;
  required_passed: number | null;
  required_total: number | null;
  contracting_done: boolean | null;
  contracting_profile_submitted: boolean | null;
  onboarding_call_booked: boolean | null;
  onboarding_call_at: string | null;
  onboarding_booking_url: string | null;
  first_deal_at: string | null;
  manual_overrides: Record<string, string | null> | null;
};

const CONTRACT_OVERRIDES = ["contracted_with_carriers", "contracted_ahl_sent", "contracted_ethos_sent", "contracted_chubb_sent"] as const;
const PHASE_COUNT_WORD: Record<number, string> = { 3: "Three", 4: "Four", 5: "Five", 6: "Six" };

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

/** Primary path: one own-row RPC. Returns null when it cannot answer. */
async function readFacts(agentId: string): Promise<GuideData | null> {
  const client = supabase as unknown as { rpc?: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message?: string } | null }> };
  if (typeof client.rpc !== "function") return null;
  const { data, error } = await client.rpc("my_activation_state", { p_agent_id: agentId });
  if (error) {
    console.warn("[first-login-guide] my_activation_state unavailable; using direct reads", error.message);
    return null;
  }
  const row = (Array.isArray(data) ? data[0] : data) as ActivationStateRow | undefined;
  if (!row) return null;
  const overrides = row.manual_overrides ?? {};
  return {
    isAgent: true,
    firstName: String(row.first_name ?? "").trim() || "there",
    stage: String(row.onboarding_stage ?? ""),
    licensed: row.license_status === "licensed",
    contracted: Boolean(row.contracting_done || CONTRACT_OVERRIDES.some((k) => overrides[k])),
    contractingSubmitted: Boolean(row.contracting_profile_submitted),
    profileComplete: Boolean(row.profile_complete),
    trainingStarted: Boolean(row.training_started),
    requiredPassed: typeof row.required_passed === "number" ? row.required_passed : null,
    requiredTotal: typeof row.required_total === "number" ? row.required_total : null,
    firstDeal: Boolean(row.first_deal_at),
    onboardingCall: {
      booked: Boolean(row.onboarding_call_booked),
      at: row.onboarding_call_at ?? null,
      url: row.onboarding_booking_url && /^https:\/\//.test(row.onboarding_booking_url) ? row.onboarding_booking_url : null,
    },
    progress: overrides,
  };
}

/** Fallback (de45caab): direct reads the agent can make under RLS. */
async function readTables(agentId: string): Promise<GuideData> {
  const [agentRes, progressRes, trainingRes] = await Promise.all([
    (supabase as any).from("agents").select("display_name, onboarding_stage, license_status, contracted_at, first_deal_at, user_id").eq("id", agentId).limit(1),
    (supabase as any).from("getting_started_progress").select("*").eq("agent_id", agentId).limit(1),
    (supabase as any).from("onboarding_progress").select("module_id").eq("agent_id", agentId).limit(1),
  ]);
  const agent = (agentRes.data ?? [])[0] ?? null;
  const progress = (progressRes.data ?? [])[0] ?? null;
  let profileComplete = false;
  if (agent?.user_id) {
    const profileRes = await (supabase as any).from("profiles").select("full_name, phone").eq("user_id", agent.user_id).limit(1);
    const profile = (profileRes.data ?? [])[0] ?? null;
    profileComplete = Boolean(String(profile?.full_name ?? "").trim() && String(profile?.phone ?? "").trim());
  }
  return {
    isAgent: Boolean(agent),
    firstName: String(agent?.display_name ?? "").trim().split(" ")[0] || "there",
    stage: String(agent?.onboarding_stage ?? ""),
    licensed: agent?.license_status === "licensed",
    contracted: Boolean(agent?.contracted_at || CONTRACT_OVERRIDES.some((k) => progress?.[k])),
    contractingSubmitted: false,
    profileComplete,
    trainingStarted: (trainingRes.data ?? []).length > 0,
    requiredPassed: null,
    requiredTotal: null,
    firstDeal: Boolean(agent?.first_deal_at),
    onboardingCall: null,
    progress,
  };
}

function formatCallTime(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function buildPhases(data: GuideData): Phase[] {
  const p = data.progress ?? {};
  const list: Phase[] = [
    {
      key: "setup", icon: UserRoundCheck,
      label: "Set up your account",
      detail: "Name, phone, state and a photo so the team can reach you. Five minutes.",
      href: "/dashboard/profile", cta: "Finish my profile",
      done: data.profileComplete || Boolean(p.completed_profile || p.added_phone_number),
    },
  ];

  if (data.licensed && data.onboardingCall) {
    const call = data.onboardingCall;
    const when = formatCallTime(call.at);
    list.push({
      key: "onboarding_call", icon: CalendarCheck,
      label: "Book your onboarding call",
      detail: call.booked
        ? when ? `Booked for ${when}.` : "Booked."
        : call.url
          ? "30 minutes with the team: contracting, your systems and your first-week plan. Pick a time that works."
          : "30 minutes with the team: contracting, your systems and your first-week plan. Reply to your welcome email to get a time.",
      href: call.url, external: true, cta: "Book my call",
      done: call.booked,
    });
  }

  const required = data.requiredTotal && data.requiredTotal > 0
    ? ` ${data.requiredPassed ?? 0} of ${data.requiredTotal} required modules passed.`
    : "";
  list.push({
    key: "training", icon: BookOpenCheck,
    label: "Start your training",
    detail: `The course is the job. Open module 1 today; everything else runs alongside it.${required}`,
    // Licensed hires go straight to the required course (where onboarding_progress
    // lives); the root redirects to the extra-practice library.
    href: data.licensed ? TRAINING_ROUTES.fieldCourse : TRAINING_ROUTES.root, cta: "Start training",
    done: data.trainingStarted || Boolean(p.completed_first_training),
  });

  list.push(
    data.licensed
      ? {
          key: "contracting", icon: Building2,
          label: "Get contracted",
          detail: data.contractingSubmitted && !data.contracted
            ? "Your contracting profile is in. Your team confirms each carrier with you."
            : "Add your NPN, name, email and resident state once. Your team then confirms each carrier with you.",
          href: CONTRACTING_PROFILE_PATH, cta: "Complete contracting profile",
          // The agent's part is the profile; carrier confirmations are staff work
          // and must not hold the guide on this step (audit ACTIVATION-3 verifier).
          done: data.contracted || data.contractingSubmitted,
        }
      : {
          key: "license", icon: ShieldCheck,
          label: "Get licensed",
          detail: "Course, exam, fingerprints, state license. We walk you through every step.",
          href: "/get-licensed", cta: "Open the licensing roadmap",
          done: data.licensed || Boolean(p.received_license),
        },
  );

  list.push({
    key: "writing", icon: Phone,
    label: "Start writing",
    detail: "Dial, present, close. Your first deal is the finish line of onboarding.",
    href: "/dashboard/call-center", cta: "Open the call center",
    done: data.firstDeal || Boolean(p.closed_first_deal),
  });
  return list;
}

function PhaseAction({ phase, onClick, size }: { phase: Phase; onClick: () => void; size?: "sm" }) {
  if (!phase.href) return null;
  if (phase.external) {
    return (
      <Button asChild size={size} onClick={onClick}>
        <a href={phase.href} target="_blank" rel="noopener noreferrer">{phase.cta} <ArrowRight className="ml-1.5 h-4 w-4" /></a>
      </Button>
    );
  }
  return (
    <Button asChild size={size} onClick={onClick}>
      <Link to={phase.href}>{phase.cta} <ArrowRight className="ml-1.5 h-4 w-4" /></Link>
    </Button>
  );
}

export function FirstLoginGuide({ agentId }: { agentId: string }) {
  const { data } = useQuery({
    queryKey: ["first-login-guide", agentId],
    staleTime: 60_000,
    queryFn: async (): Promise<GuideData> => {
      try {
        const facts = await readFacts(agentId);
        if (facts) return facts;
      } catch (e) {
        console.warn("[first-login-guide] facts RPC threw; using direct reads", e);
      }
      return readTables(agentId);
    },
  });

  const phases = useMemo<Phase[]>(() => (data ? buildPhases(data) : []), [data]);

  const current = phases.find((ph) => !ph.done) ?? null;
  const settled = !data || !data.isAgent || SETTLED_STAGES.has(data.stage) || data.firstDeal || Boolean(data.progress?.closed_first_deal);
  const visible = !settled && current !== null;

  const [open, setOpen] = useState(false);
  useEffect(() => {
    // One onboarding pop-up per session (src/lib/onboardingPopupGate.ts): stacked with the
    // profile-picture prompt it froze Post a Deal until both were closed.
    if (visible && !hasSeen(agentId) && claimOnboardingPopup("first-login-guide")) setOpen(true);
  }, [visible, agentId]);

  if (!visible || !current) return null;

  const stepIndex = phases.findIndex((ph) => ph.key === current.key) + 1;
  const Icon = current.icon;
  const close = () => { markSeen(agentId); setOpen(false); };
  const countWord = PHASE_COUNT_WORD[phases.length] ?? String(phases.length);

  return (
    <>
      <Card className="border-primary/40 bg-primary/5 p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-primary/30 bg-white dark:bg-card">
            <Icon className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-primary">Start here · step {stepIndex} of {phases.length}</p>
            <p className="text-base font-bold leading-tight text-foreground">{current.label}</p>
            <p className="text-xs text-muted-foreground">{current.detail}</p>
          </div>
          <div className="flex flex-wrap gap-2 sm:ml-auto">
            <PhaseAction phase={current} size="sm" onClick={() => markSeen(agentId)} />
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
              {countWord} phases, in order. You are on step {stepIndex}. Do that one now; the rest unlock as you go.
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
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[12px] font-bold">
                    {ph.done ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : isCurrent ? i + 1 : <Circle className="h-3 w-3 text-muted-foreground" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className={cn("text-sm font-semibold", ph.done && "text-muted-foreground line-through")}>
                      <PhIcon className="mr-1.5 inline h-3.5 w-3.5 align-[-2px]" />{ph.label}
                    </p>
                    <p className="text-xs text-muted-foreground">{ph.detail}</p>
                  </div>
                  {isCurrent && <span className="rounded-full bg-primary px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-primary-foreground">now</span>}
                </li>
              );
            })}
          </ol>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" onClick={close}>I'll look around first</Button>
            <PhaseAction phase={current} onClick={close} />
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
