import { personInitials } from "@/lib/personInitials";
import { useCallback, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowRight, BookOpen, ChevronDown, CircleHelp, ClipboardList, Clock, Download, GraduationCap, Handshake, Instagram, Mail, MessageSquare, Phone, RefreshCw, Search, SlidersHorizontal, UserX, X } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { PageHeader } from "@/components/ui/page-header";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { RevealList } from "@/components/ui/delight/Reveal";
import { TonePill } from "@/components/ui/delight/ToneBubble";
import { FilterChip } from "@/components/recruiting/FilterChip";
import { GrowScoreboard } from "@/components/recruiting/GrowScoreboard";
import { JourneyBar } from "@/components/recruiting/JourneyBar";
import { RecruitingWorkspaceNav } from "@/components/recruiting/RecruitingWorkspaceNav";
import { STATUS_TONE } from "@/components/recruiting/StatusPill";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LicenseProgressSelector } from "@/components/dashboard/LicenseProgressSelector";
import { formatSince } from "@/components/pipeline/worklist/worklistFormat";
import { cn } from "@/lib/utils";
import { contactLinkProps, formatPhoneDisplay, phoneHref, smsHref } from "@/lib/phone";
import { markNoLongerWithUs } from "@/lib/noLongerWithUs";
import { celebrate, type CelebrationOrigin } from "@/lib/celebrate";
import { OFF_LADDER_STAGES, stageLabel } from "@/lib/hireLadder";
import {
  RECRUIT_STEPS,
  STEP_COUNT,
  appliedWords,
  formatCalendarDay,
  licenseWords,
  recruitStep,
  stepDays,
  xcelFeed,
  xcelMatchesFilter,
  xcelStatus,
  type JourneyRow,
  type RecruitStep,
  type RecruitStepKey,
  type XcelFilter,
  type XcelStatus,
} from "@/lib/recruitJourney";
import { TONE_CLASS, hireRungTone, licenseStatusTone, recruitStepTone, xcelTone, type Tone } from "@/lib/tones";
import { playSoundEffect } from "@/hooks/useSoundEffects";
import { useAuth } from "@/hooks/useAuth";
import { useConfirm } from "@/hooks/useConfirm";
import { buildExceptionQueue, type OnboardingFacts } from "@/lib/onboardingExceptions";
import { ExpectedStartControl } from "@/components/onboarding/ExpectedStartControl";
import { useOnboardingExceptionFacts } from "@/components/onboarding/useOnboardingExceptionFacts";

/**
 * Recruit Stages (2026-09-30). Sam: "fix the licensing tracking so I can see
 * where recruits are at ... make it way easier to change and edit stages on
 * that page, I shouldn't have to go to the agent's profile. Remove all
 * clutter ... make that page perfect."
 *
 * One list, every recruit, one stage each, on the Next Step Engine's 19-stage
 * ladder. Everything a recruiting day needs happens on the row: change the
 * stage (set_recruit_stage stamps or clears the evidence so it sticks), call or
 * text, set licensing on a hired-but-unlicensed agent, undo a slip. Bulk-select
 * moves or closes many at once (set_recruit_stage_bulk), because 700 of the 870
 * active recruits measured 60+ days in their stage when this shipped.
 *
 * "Stalled" from the engine fires at 24-48h and so tags ~97% of rows; the page
 * grades idle time instead (7d / 21d / 60d) so the flag means something.
 *
 * Recruit tracking (OVERHAUL-recruits, 2026-10-29). Sam: "a progress bar with each applicant,
 * adding color, seeing what stages they're on." Every person is one row with the date they
 * applied, a seven-step bar (applied, contacted, interview, licensing, licensed, contracted,
 * first deal) filled to their step in that step's tone, the step in words beside it, licensed
 * or not, and their Xcel pre-licensing purchase: a badge when they bought it, a "has not bought
 * Xcel yet" nudge when they should have, and "possible match" when only the name matches.
 * src/lib/recruitJourney.ts owns every one of those definitions; the chips, the tiles, the
 * sections and the rows all count through it, so a number is always the rows a tap shows.
 * The step colours replace the hire-ladder rung colours of the 2026-10-28 colour layer, so one
 * row carries one stage vocabulary; an off-ladder onboarding flag (needs follow-up, inactive)
 * still says itself in the hot tone beside the name, because it is a call to act.
 * A move that went through is marked from the control pressed: up to Producing the full burst,
 * any other step a pop, a bulk move one success note, and anything that closes or removes stays
 * quiet. Nothing plays on load or on an error.
 */
type Row = JourneyRow & {
  person_type: "applicant" | "agent";
  application_id: string | null;
  agent_id: string | null;
  display_name: string;
  phone: string | null;
  email: string | null;
  state: string | null;
  stage_key: string;
  stage_name: string;
  order_index: number;
  entered_at: string;
  days_in_stage: number;
  is_stalled: boolean;
  next_action_label: string | null;
  manager_name: string | null;
  license_status: string | null;
  license_progress: string | null;
  npn: string | null;
  last_contacted_at: string | null;
  manual_stage_key: string | null;
  status: string;
  instagram: string | null;
  link_sent_at: string | null;
  link_used_at: string | null;
  last_sign_in_at: string | null;
  resident_state: string | null;
};
type Stage = { stage_key: string; order_index: number; display_name: string; is_terminal: boolean | null; retired_at: string | null };
type IdleFilter = "all" | "7" | "21" | "60";
type LinkFilter = "all" | "not_sent" | "sent" | "clicked";
/** One row as the page reads it: the person, their step, days on it, and their Xcel badge. */
type Person = { r: Row; step: RecruitStep; days: number; xcel: XcelStatus };
/** A list section: a step, or the people with no step (closed, or a stage the page has no step for). */
type GroupKey = RecruitStepKey | "other" | "closed";

// Stages the operator cannot know first-hand; Next skips them, the dropdown keeps them.
const DERIVED_ONLY = new Set(["watched_vsl", "completed_application"]);
const PAGE = 40;
const personKey = (r: Row) => r.application_id ?? r.agent_id ?? r.display_name;
const igUrl = (h: string) => `https://instagram.com/${encodeURIComponent(h)}`;
const linkState = (r: Row): LinkFilter => (r.link_used_at || r.last_sign_in_at ? "clicked" : r.link_sent_at ? "sent" : "not_sent");

// The Next Step Engine's steps at which a hire is producing: a move onto one of them is the
// full celebration (src/lib/celebrate.ts), any other move the small pop.
const PRODUCING_STAGES = new Set(["first_appointment", "first_deal", "first_10k_week"]);

/** Two initials for the bubble beside a name. */
const initialsOf = personInitials;

/** An off-ladder onboarding flag on a hire ("Needs follow-up", "Inactive"): act now, in its own words. */
function flagOf(facts: OnboardingFacts | undefined): string | null {
  const stage = (facts?.onboarding_stage ?? "").trim().toLowerCase();
  return stage && OFF_LADDER_STAGES.has(stage) ? stageLabel(stage) : null;
}

const groupLabel = (key: GroupKey): string =>
  key === "closed" ? "Closed" : key === "other" ? "Other steps" : RECRUIT_STEPS.find((s) => s.key === key)?.label ?? key;
const groupTone = (key: GroupKey): Tone => (key === "closed" || key === "other" ? "slate" : recruitStepTone(key));
const groupOf = (p: Person): GroupKey => p.step.key ?? (p.r.status === "active" ? "other" : "closed");
const GROUP_ORDER: readonly GroupKey[] = [...RECRUIT_STEPS.map((s) => s.key), "other", "closed"];

// What a finished move means (src/lib/celebrate.ts): up to Producing is the full burst, any
// other step the small pop, and a close is quiet. Called only after set_recruit_stage came
// back without an error and the person landed where they were sent, from the control pressed.
function stageMoved(toStage: string, origin: CelebrationOrigin): void {
  if (toStage === "closed_lost") return;
  void celebrate(PRODUCING_STAGES.has(toStage) ? "hire" : "save", origin);
}

// Red means one thing on this page: the action that removes a person. Time on a step is
// a warning, and the words ("70 days on this step") carry the meaning at every tier
// (Grow review 2026-10-28, finding 19).
function heatClass(days: number) {
  if (days >= 60) return "text-warning font-semibold";
  if (days >= 21) return "text-warning font-medium";
  if (days >= 7) return "text-foreground font-medium";
  return "text-muted-foreground";
}

// index.css gives every <button> min-height:44px under 640px, which turned a 20px
// checkbox into a tall pill. !min-h-0 keeps the box square; the ::before pseudo-element
// gives it the 44px tap target the screen contract asks for without moving anything.
// inset is measured from the padding edge, inside the 1px border, so 14px each side
// makes a 46px square (measured in headless chromium: 12px gave 42px). !min-w-0 answers the
// touch rule in delight.css that gives every button a 44px minimum width as well: without it a
// phone drew the 20px box as a 44x20 pill (seen in the 390px touch screenshots, 2026-10-29).
const CHECKBOX = "relative h-5 w-5 !min-h-0 !min-w-0 before:absolute before:-inset-3.5 before:content-['']";
// A quiet link for data that is missing or changeable (state, Instagram): muted words with
// an underline, never red. 44px tall so it is tappable. SENTENCE_LINK sits inside a 20px
// line of text and is pulled back with -my-3 so the line does not grow to 44px.
const QUIET_LINK = "inline-flex min-h-11 items-center text-sm text-muted-foreground underline underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)]";
// A two-letter state is 17-22px wide, so the same ::before trick as the checkbox widens its
// tap area by 14px each side (45-50px) without moving a word of the sentence (2026-10-28).
// !min-w-0 for the same touch rule as the checkbox: it left a 20px hole after "AZ" on a phone.
const SENTENCE_LINK = cn(QUIET_LINK, "relative -my-3 !min-w-0 before:absolute before:inset-y-0 before:-inset-x-3.5 before:content-['']");

/** " · " whose second space does not break, so a wrapped line starts with the dot and the fact together. */
const SEP = " · ";

const XCEL_LABELS: Record<XcelFilter, string> = { all: "Any", bought: "Bought Xcel", possible: "Possible match", missing: "Has not bought yet" };

/**
 * "What the steps mean": the seven steps, each with its bar and one sentence, the source of
 * "licensed", and the Xcel matching rule. Opened by a tap, never hidden behind a hover.
 */
function StepsLegend({ reportDay, className }: { reportDay: string | null; className?: string }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" className={cn("h-11 gap-1.5 px-3 text-sm text-muted-foreground hover:text-foreground", className)}>
          <CircleHelp className="h-4 w-4" aria-hidden="true" /> What the steps mean
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="max-h-[var(--radix-popover-content-available-height)] w-[24rem] max-w-[calc(100vw-2rem)] space-y-4 overflow-y-auto p-4">
        <ol className="space-y-3">
          {RECRUIT_STEPS.map((s, i) => {
            const tone = recruitStepTone(s.key);
            return (
              <li key={s.key} className="flex gap-3">
                <JourneyBar index={i + 1} tone={tone} className="mt-1.5 w-16" />
                <span className="min-w-0 text-sm leading-5">
                  <span className={cn("font-semibold", TONE_CLASS[tone].text)}>{s.label}.</span>{" "}
                  <span className="text-muted-foreground">{s.means}</span>
                </span>
              </li>
            );
          })}
        </ol>
        <div className="space-y-2 border-t border-border pt-3 text-sm leading-5 text-muted-foreground">
          <p><span className="font-semibold text-foreground">Licensed or not</span> is what an applicant said on the form, or the license on a hire's agent record.</p>
          <p>
            <span className="font-semibold text-foreground">Xcel</span> purchases are matched by email first, then phone. A match on the name alone says "Possible Xcel match", never bought.
            {reportDay ? ` The newest Xcel report is from ${reportDay}.` : ""}
          </p>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default function RecruitPipeline() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const askConfirm = useConfirm();
  const { isAdmin, isManager } = useAuth();
  const canRemove = !!(isAdmin || isManager);
  const [searchParams] = useSearchParams();
  // ?q= deep link (the onboarding queue's "Update license" button lands here).
  const [search, setSearch] = useState(() => searchParams.get("q") ?? "");
  const [stepFilter, setStepFilter] = useState<RecruitStepKey | null>(null);
  const [idle, setIdle] = useState<IdleFilter>("all");
  const [link, setLink] = useState<LinkFilter>("all");
  const [xcelFilter, setXcelFilter] = useState<XcelFilter>("all");
  const [managerFilter, setManagerFilter] = useState<string>("all");
  const [showClosed, setShowClosed] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkStage, setBulkStage] = useState<string>("");
  const [igEditing, setIgEditing] = useState<string | null>(null);
  const [stateEditing, setStateEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // Each row's stage select, by person, so a move picked there can celebrate from the control
  // that was pressed (Radix hands onValueChange the value alone, not the trigger).
  const stageTriggers = useRef(new Map<string, HTMLButtonElement>());

  const stagesQuery = useQuery({
    queryKey: ["next-step-stages"],
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("next_step_stages" as never)
        .select("stage_key, order_index, display_name, is_terminal, retired_at")
        .order("order_index");
      if (error) throw error;
      return (data ?? []) as unknown as Stage[];
    },
  });
  const rowsQuery = useQuery({
    queryKey: ["recruit-pipeline"],
    staleTime: 30_000,
    refetchInterval: 120_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("recruit_pipeline_list" as never);
      if (error) throw error;
      return (data ?? []) as unknown as Row[];
    },
  });

  // Expected start + open onboarding items per hired agent, from the same
  // facts the No Hire Left Behind queue reads. A failure here never hides the
  // recruit list; the agent rows say "unknown" instead of zero.
  const factsQuery = useOnboardingExceptionFacts({ realtime: false });
  const factsByAgent = useMemo(() => {
    const m = new Map<string, { facts: OnboardingFacts; open: number; blocking: number }>();
    for (const f of factsQuery.data ?? []) m.set(f.agent_id, { facts: f, open: 0, blocking: 0 });
    for (const q of buildExceptionQueue(factsQuery.data ?? [])) {
      const cur = m.get(q.facts.agent_id);
      if (cur) { cur.open = q.exceptions.length; cur.blocking = q.exceptions.filter((e) => e.blocking).length; }
    }
    return m;
  }, [factsQuery.data]);
  const hiresWithOpenItems = useMemo(() => Array.from(factsByAgent.values()).filter((v) => v.open > 0).length, [factsByAgent]);

  // Retired stages (the seminar pair) stay in the table for history but are
  // never shown, offered, or derived.
  const stages = useMemo(() => (stagesQuery.data ?? []).filter((s) => !s.retired_at), [stagesQuery.data]);
  const all = useMemo(() => rowsQuery.data ?? [], [rowsQuery.data]);
  const stageName = useCallback((key: string) => stages.find((s) => s.stage_key === key)?.display_name ?? key, [stages]);
  // First agent stage; everything below it is applicant territory.
  const agentFloor = useMemo(() => stages.find((s) => s.stage_key === "hired_unlicensed")?.order_index ?? stages.find((s) => s.stage_key === "hired")?.order_index ?? 12, [stages]);

  // One clock per load (the moment the list arrived), so a row cannot change step between two
  // renders of the same data, and an interview that passes mid-session moves on the next load.
  const now = rowsQuery.dataUpdatedAt || Date.now();
  const feed = useMemo(() => xcelFeed(all, now), [all, now]);
  const people = useMemo<Person[]>(
    () => all.map((r) => {
      const step = recruitStep(r, now);
      return { r, step, days: stepDays(r, step, now), xcel: xcelStatus(r, step, feed, now) };
    }),
    [all, now, feed],
  );

  const managers = useMemo(
    () => Array.from(new Set(all.map((r) => r.manager_name).filter((m): m is string => !!m))).sort(),
    [all],
  );

  // Every filter except the step chips and the Xcel choice. The chips count over the people who
  // pass these and the Xcel choice; the Xcel choices count over the people who pass these and the
  // chosen step. So the number on a chip or a choice is always the rows a tap on it shows.
  const passesBase = useCallback((p: Person) => {
    const r = p.r;
    const q = search.trim().toLowerCase();
    const minDays = idle === "all" ? 0 : Number(idle);
    if (!showClosed && r.status !== "active") return false;
    if (p.days < minDays) return false;
    if (link !== "all" && (r.person_type !== "agent" || linkState(r) !== link)) return false;
    if (managerFilter === "none" ? !!r.manager_name : managerFilter !== "all" && r.manager_name !== managerFilter) return false;
    if (q && !`${r.display_name} ${r.manager_name ?? ""} ${r.phone ?? ""} ${r.email ?? ""} ${r.stage_name} ${p.step.label} ${r.instagram ?? ""} ${r.resident_state ?? ""}`.toLowerCase().includes(q)) return false;
    return true;
  }, [search, idle, link, managerFilter, showClosed]);
  const based = useMemo(() => people.filter(passesBase), [people, passesBase]);
  const unstepped = useMemo(() => based.filter((p) => xcelMatchesFilter(p.xcel.kind, xcelFilter)), [based, xcelFilter]);
  const visible = useMemo(() => (stepFilter ? unstepped.filter((p) => p.step.key === stepFilter) : unstepped), [unstepped, stepFilter]);

  const stepCounts = useMemo(() => {
    const m = new Map<RecruitStepKey, number>();
    for (const p of unstepped) if (p.step.key) m.set(p.step.key, (m.get(p.step.key) ?? 0) + 1);
    return m;
  }, [unstepped]);
  const xcelCounts = useMemo(() => {
    const m: Record<XcelFilter, number> = { all: 0, bought: 0, possible: 0, missing: 0 };
    for (const p of based) {
      if (stepFilter && p.step.key !== stepFilter) continue;
      m.all += 1;
      if (p.xcel.kind === "bought" || p.xcel.kind === "possible" || p.xcel.kind === "missing") m[p.xcel.kind] += 1;
    }
    return m;
  }, [based, stepFilter]);

  const optionsFor = useCallback(
    (r: Row) =>
      stages.filter((s) =>
        r.person_type === "applicant"
          ? s.order_index < agentFloor || s.stage_key === "closed_lost"
          : s.order_index >= agentFloor && s.stage_key !== "closed_lost"),
    [stages, agentFloor],
  );
  const nextStageFor = useCallback(
    (r: Row) => {
      const ladder = optionsFor(r).filter((s) => s.stage_key !== "closed_lost");
      const i = ladder.findIndex((s) => s.stage_key === r.stage_key);
      if (i < 0) return null;
      return ladder.slice(i + 1).find((s) => !DERIVED_ONLY.has(s.stage_key)) ?? null;
    },
    [optionsFor],
  );

  const refresh = useCallback(() => qc.invalidateQueries({ queryKey: ["recruit-pipeline"] }), [qc]);

  // `origin` is the control the person pressed, read before the write; it never reaches the RPC,
  // whose arguments are the same four as before. An undo is a correction and stays quiet.
  const setStage = useCallback(
    async (r: Row, toStage: string, opts?: { silentUndo?: boolean; origin?: CelebrationOrigin }) => {
      if (toStage === r.stage_key) return;
      setBusy(personKey(r));
      const { data, error } = await supabase.rpc("set_recruit_stage" as never, {
        p_application_id: r.application_id,
        p_agent_id: r.agent_id,
        p_to_stage: toStage,
        p_reason: null,
      } as never);
      setBusy(null);
      if (error) { toast.error(`${r.display_name}: ${error.message}`); return; }
      const res = (data ?? {}) as { ok?: boolean; final?: string; matched?: boolean; message?: string | null };
      if (res.ok === false) { toast.error(res.message ?? "Not changed."); return; }
      const finalName = stageName(res.final ?? toStage);
      if (res.matched === false) toast.warning(`${r.display_name}: ${res.message ?? `kept at ${finalName}`}`);
      else if (opts?.silentUndo) toast.success(`${r.display_name} back at ${finalName}`);
      else {
        const before = r.stage_key;
        toast.success(`${r.display_name} → ${finalName}`, {
          action: { label: "Undo", onClick: () => void setStage({ ...r, stage_key: res.final ?? toStage }, before, { silentUndo: true }) },
        });
        stageMoved(res.final ?? toStage, opts?.origin);
      }
      await refresh();
    },
    [refresh, stageName],
  );

  const selectedRows = useMemo(() => visible.filter((p) => selected.has(personKey(p.r))).map((p) => p.r), [visible, selected]);
  const bulkOptions = useMemo(() => {
    if (selectedRows.length === 0) return [] as Stage[];
    const hasApplicant = selectedRows.some((r) => r.person_type === "applicant");
    const hasAgent = selectedRows.some((r) => r.person_type === "agent");
    return stages.filter((s) => {
      if (s.stage_key === "closed_lost") return !hasAgent;
      if (hasApplicant && s.order_index >= agentFloor) return false;
      if (hasAgent && s.order_index < agentFloor) return false;
      return true;
    });
  }, [selectedRows, stages, agentFloor]);

  const bulkMove = useCallback(
    async (toStage: string) => {
      if (selectedRows.length === 0 || !toStage) return;
      setBusy("bulk");
      const peopleToMove = selectedRows.map((r) => ({ application_id: r.application_id, agent_id: r.agent_id }));
      const { data, error } = await supabase.rpc("set_recruit_stage_bulk" as never, { p_people: peopleToMove, p_to_stage: toStage, p_reason: null } as never);
      setBusy(null);
      if (error) { toast.error(`Bulk move failed: ${error.message}`); return; }
      const res = (data ?? {}) as { moved?: number; kept?: number; refused?: number; failed?: number; messages?: string[] };
      const name = stageName(toStage);
      const parts = [`${res.moved ?? 0} moved to ${name}`];
      if (res.kept) parts.push(`${res.kept} kept where evidence puts them`);
      if (res.refused) parts.push(`${res.refused} refused`);
      if (res.failed) parts.push(`${res.failed} failed`);
      const partly = (res.refused ?? 0) + (res.failed ?? 0) > 0;
      (partly ? toast.warning : toast.success)(parts.join(" · "), {
        description: res.messages?.slice(0, 2).join(" "),
      });
      // One note for the whole group once everyone asked for moved, never one per person; a
      // close is quiet, and a move that was partly refused is the warning alone.
      if (!partly && (res.moved ?? 0) > 0 && toStage !== "closed_lost") playSoundEffect("success");
      setSelected(new Set()); setBulkStage("");
      await refresh();
    },
    [selectedRows, stageName, refresh],
  );

  // Closing many people at once is destructive, so it is two steps like every other
  // destructive action on the page.
  const bulkClose = useCallback(async () => {
    const n = selectedRows.length;
    if (n === 0) return;
    const ok = await askConfirm({
      title: `Close ${n} ${n === 1 ? "person" : "people"}?`,
      description: "They move to Closed / dropped and leave the active list.",
      confirmText: `Close ${n}`,
      tone: "danger",
    });
    if (!ok) return;
    await bulkMove("closed_lost");
  }, [askConfirm, bulkMove, selectedRows.length]);

  const saveInstagram = useCallback(
    async (r: Row, handle: string) => {
      const { data, error } = await supabase.rpc("set_recruit_instagram" as never, {
        p_application_id: r.application_id, p_agent_id: r.agent_id, p_handle: handle,
      } as never);
      setIgEditing(null);
      if (error) { toast.error(`${r.display_name}: ${error.message}`); return; }
      const saved = (data as { instagram?: string | null } | null)?.instagram;
      toast.success(saved ? `${r.display_name}: Instagram @${saved}` : `${r.display_name}: Instagram cleared`);
      await refresh();
    },
    [refresh],
  );

  // "No longer with us" for an agent: confirm, deactivate (they leave the roster
  // and this page on the next derive), log it, send the door-is-open email.
  const removeAgent = useCallback(
    async (r: Row) => {
      if (!r.agent_id) return;
      const ok = await askConfirm({
        title: `${r.display_name} is no longer with us?`,
        description: "They'll be set inactive and removed from your roster and this page, which also ends their team access. We'll email them that the door is still open.",
        confirmText: "Remove and send email",
        tone: "danger",
      });
      if (!ok) return;
      setBusy(personKey(r));
      const out = await markNoLongerWithUs({ agentId: r.agent_id, displayName: r.display_name });
      setBusy(null);
      if (!out.ok || out.emailFailed) toast.error(out.message);
      else toast.success(out.message);
      await refresh();
    },
    [askConfirm, refresh],
  );

  const saveState = useCallback(
    async (r: Row, state: string) => {
      const { data, error } = await supabase.rpc("set_recruit_state" as never, {
        p_application_id: r.application_id, p_agent_id: r.agent_id, p_state: state,
      } as never);
      setStateEditing(null);
      if (error) { toast.error(`${r.display_name}: ${error.message}`); return; }
      toast.success(`${r.display_name}: state ${(data as { state?: string } | null)?.state ?? "cleared"}`);
      await refresh();
    },
    [refresh],
  );

  const toggle = (r: Row) =>
    setSelected((prev) => { const n = new Set(prev); const k = personKey(r); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const toggleMany = (rows: Row[], on: boolean) =>
    setSelected((prev) => { const n = new Set(prev); for (const r of rows) { if (on) n.add(personKey(r)); else n.delete(personKey(r)); } return n; });

  const downloadCsv = () => {
    if (visible.length === 0) { toast.error("Nothing to download."); return; }
    const cols: [string, (p: Person) => string | number | null][] = [
      ["name", (p) => p.r.display_name], ["type", (p) => p.r.person_type], ["step", (p) => p.step.label], ["stage", (p) => p.r.stage_name],
      ["days_on_step", (p) => Math.round(p.days)], ["applied_on", (p) => p.r.applied_at?.slice(0, 10) ?? null],
      ["interview_on", (p) => p.r.interview_at?.slice(0, 10) ?? null], ["manager", (p) => p.r.manager_name],
      ["phone", (p) => formatPhoneDisplay(p.r.phone)], ["email", (p) => p.r.email], ["instagram", (p) => p.r.instagram], ["state", (p) => p.r.resident_state],
      ["license_status", (p) => p.r.license_status], ["license_progress", (p) => p.r.license_progress], ["npn", (p) => p.r.npn],
      ["xcel", (p) => p.xcel.label ?? (p.xcel.kind === "unknown" ? "not checked" : "")], ["xcel_matched_by", (p) => p.xcel.matchedBy],
      ["xcel_enrolled_on", (p) => p.r.xcel_enrolled_on ?? null], ["xcel_pct", (p) => (p.r.xcel_pct ?? null) as number | string | null], ["xcel_course", (p) => p.r.xcel_course ?? null],
      ["last_contact", (p) => p.r.last_contacted_at?.slice(0, 10) ?? null],
      ["link_sent", (p) => p.r.link_sent_at?.slice(0, 10) ?? null], ["link_clicked", (p) => (p.r.link_used_at ?? p.r.last_sign_in_at)?.slice(0, 10) ?? null],
    ];
    const cell = (v: string | number | null | undefined) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const csv = [cols.map((c) => c[0]).join(","), ...visible.map((p) => cols.map((c) => cell(c[1](p))).join(","))].join("\r\n");
    const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url; a.download = `recruits-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    toast.success(`Downloaded ${visible.length} recruits.`);
  };

  const active = people.filter((p) => p.r.status === "active");
  const idle7 = active.filter((p) => p.days >= 7).length;
  const needXcel = active.filter((p) => p.xcel.kind === "missing").length;

  if (rowsQuery.isLoading || stagesQuery.isLoading) return <PageSkeleton />;

  // A failed read is a dash and a reason, never a zero: the tiles go blank, the stage
  // chips (whose counts would all read 0) are withheld, and the list says what failed
  // with a Retry (Grow review 2026-10-28, finding 5).
  const numbersUnknown = rowsQuery.isError;
  const listFailed = rowsQuery.isError || stagesQuery.isError;
  const failReason = ((rowsQuery.error ?? stagesQuery.error) as { message?: unknown } | null)?.message;
  const failText = typeof failReason === "string" && failReason ? failReason : null;
  const retrying = rowsQuery.isFetching || stagesQuery.isFetching;
  const retryLoad = () => {
    if (rowsQuery.isError) void rowsQuery.refetch();
    if (stagesQuery.isError) void stagesQuery.refetch();
  };
  // "Has not bought Xcel" is only as true as the report it is read from, so the number waits for a fresh one.
  const xcelKnown = !numbersUnknown && (feed.state === "fresh" || feed.state === "empty");
  const reportDay = formatCalendarDay(feed.reportOn, now);
  const xcelNotice = numbersUnknown ? null
    : feed.state === "unavailable" ? "Xcel purchases did not come with this list, so nobody is marked bought or not bought."
    : feed.state === "none" ? "No Xcel report has arrived yet, so nobody is marked as not having bought it."
    : feed.state === "stale" ? `Xcel's daily report has not arrived since ${reportDay ?? "an unreadable date"}, so "Has not bought Xcel yet" is hidden until it does.`
    : null;

  // A chosen chip wears its step's tint and hairline (the words stay in the foreground colour);
  // All keeps the page's plain "switched on" tint.
  const chip = (on: boolean, tone: Tone | null = null) =>
    cn(
      "inline-flex h-11 items-center gap-2 rounded-lg border px-3.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)]",
      on
        ? tone
          ? cn(TONE_CLASS[tone].soft, TONE_CLASS[tone].border, "text-foreground")
          : "border-primary/60 bg-primary/15 text-foreground"
        : "border-border bg-card text-foreground hover:bg-muted/50",
    );
  const IDLE_LABELS: Record<IdleFilter, string> = { all: "Any", "7": "7+ days", "21": "21+ days", "60": "60+ days" };
  const LINK_LABELS: Record<LinkFilter, string> = { all: "Any", not_sent: "Not sent", sent: "Sent, not clicked", clicked: "Clicked" };
  const filterCount = [idle !== "all", link !== "all", xcelFilter !== "all", managerFilter !== "all", showClosed].filter(Boolean).length;
  const clearOthers = () => { setStepFilter(null); setLink("all"); setManagerFilter("all"); setShowClosed(false); setSearch(""); };
  // A number opens exactly the people it counts (active recruits by idle time): every other filter clears.
  const onlyIdle = (k: IdleFilter) => {
    clearOthers(); setIdle(k); setXcelFilter("all");
    playSoundEffect("tick");
  };
  const onlyNeedXcel = () => {
    clearOthers(); setIdle("all"); setXcelFilter("missing");
    playSoundEffect("tick");
  };
  const othersOff = !stepFilter && link === "all" && managerFilter === "all" && !showClosed && !search;
  const tileOn = (k: IdleFilter) => idle === k && xcelFilter === "all" && othersOff;
  // A step chip moves one filter: a tick, from the shared sounds.
  const pickStep = (key: RecruitStepKey | null) => { setStepFilter(key); playSoundEffect("tick"); };

  const groups = (() => {
    const by = new Map<GroupKey, Person[]>();
    for (const p of visible) {
      const g = groupOf(p);
      const list = by.get(g);
      if (list) list.push(p); else by.set(g, [p]);
    }
    return GROUP_ORDER.filter((g) => by.has(g)).map((g) => ({
      key: g,
      people: (by.get(g) ?? []).sort((a, b) => a.days - b.days || a.r.order_index - b.r.order_index),
    }));
  })();

  // Grow redesign (2026-10-28): the subtitle's sentence of counts became four numbers,
  // the strip of segmented toggles became one Filters button with removable chips, and
  // the CSV export sits with the filters it exports. The header carries no button at
  // all: this page has no single primary action, every action lives on a row.
  return (
    <div className="page-enter w-full space-y-5 pb-28">
      <RecruitingWorkspaceNav />
      <PageHeader
        title="New hires"
        subtitle="Every recruit, from application to first deal."
        icon={<GraduationCap />}
        tone="good"
        // No gold button here on purpose: there is no one thing this page exists to do.
        // Declaring null also turns off the legacy inference, so nothing can be promoted.
        primaryAction={null}
      />

      {/* In progress is the Hired rung's gold, the time stuck the warning tone of
          src/components/recruiting/StatusPill.tsx (never red on this page), Need Xcel the
          "needs a nudge" tone, and Open onboarding the Onboarding rung's royal. */}
      <GrowScoreboard
        label="New hire numbers"
        notice={numbersUnknown ? (
          <span className="text-destructive">The recruit list did not load, so the numbers are hidden rather than shown as 0.</span>
        ) : xcelNotice ? <span>{xcelNotice}</span> : null}
        tiles={[
          { label: "In progress", value: numbersUnknown ? null : active.length, hint: "Everyone still on the way", onSelect: () => onlyIdle("all"), active: tileOn("all"), tone: hireRungTone(0), icon: <Handshake /> },
          { label: "Stuck 7+ days", value: numbersUnknown ? null : idle7, hint: "Same step a week or more", onSelect: () => onlyIdle("7"), active: tileOn("7"), emphasis: true, tone: STATUS_TONE.warning, icon: <Clock /> },
          {
            label: "Need Xcel",
            value: xcelKnown ? needXcel : null,
            hint: "Talked to us, no course yet",
            definition: "Not licensed, past Applied, and no Xcel pre-licensing purchase matched by email or phone. Opens exactly those people.",
            onSelect: () => onlyNeedXcel(),
            active: xcelFilter === "missing" && idle === "all" && othersOff,
            emphasis: true,
            tone: xcelTone("missing"),
            icon: <BookOpen />,
          },
          {
            label: "Open onboarding",
            value: factsQuery.isSuccess ? hiresWithOpenItems : null,
            hint: "Hires with an open step",
            definition: "Hires with at least one open onboarding requirement. Opens the onboarding queue (No Hire Left Behind).",
            onSelect: () => navigate("/dashboard/onboarding-ladder"),
            tone: hireRungTone(1),
            icon: <ClipboardList />,
          },
        ]}
      />

      {!listFailed && (
        // The chips rise once, in order. Each step carries a dot in its tone, the same tone as the
        // bar on every row at that step, and takes that tint when chosen; the word says what it is.
        <nav aria-label="Stages" className="apex-rise-list flex flex-wrap gap-2">
          <button type="button" onClick={() => pickStep(null)} className={chip(!stepFilter)} aria-pressed={!stepFilter}>
            All <span className="tabular-nums text-muted-foreground">{unstepped.length}</span>
          </button>
          {RECRUIT_STEPS.filter((s) => (stepCounts.get(s.key) ?? 0) > 0 || stepFilter === s.key).map((s) => {
            const tone = recruitStepTone(s.key);
            const on = stepFilter === s.key;
            return (
              <button
                key={s.key}
                type="button"
                aria-pressed={on}
                onClick={() => pickStep(on ? null : s.key)}
                className={chip(on, tone)}
                title={s.means}
              >
                <span aria-hidden="true" className={cn("h-2 w-2 shrink-0 rounded-full", TONE_CLASS[tone].dot)} />
                {s.label} <span className="tabular-nums text-muted-foreground">{stepCounts.get(s.key) ?? 0}</span>
              </button>
            );
          })}
        </nav>
      )}

      <div className="space-y-3">
        <div className="flex gap-2">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, manager, phone or stage" aria-label="Search new hires" className="h-12 border-border bg-card pl-11 text-base" />
          </div>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className="h-12 shrink-0 border-border bg-card px-4 text-base">
                <SlidersHorizontal className="h-5 w-5" /> Filters{filterCount > 0 ? ` (${filterCount})` : ""}
              </Button>
            </PopoverTrigger>
            {/* Capped to the room Radix measures under the button and scrolls inside, so the
                export at its foot is reachable on a short screen instead of running off it. */}
            <PopoverContent align="end" className="max-h-[var(--radix-popover-content-available-height)] w-[22rem] max-w-[calc(100vw-2rem)] space-y-5 overflow-y-auto p-4">
              <fieldset>
                <legend className="mb-2 text-sm font-semibold text-foreground">Xcel pre-licensing</legend>
                <div className="flex flex-wrap gap-1.5">
                  {(["all", "bought", "possible", "missing"] as XcelFilter[]).map((k) => (
                    <Button key={k} className="h-11 gap-1.5 px-3" variant={xcelFilter === k ? "secondary" : "ghost"} aria-pressed={xcelFilter === k} onClick={() => setXcelFilter(k)} disabled={k === "missing" && !xcelKnown}>
                      {XCEL_LABELS[k]} <span className="tabular-nums text-muted-foreground">{k === "missing" && !xcelKnown ? "—" : xcelCounts[k]}</span>
                    </Button>
                  ))}
                </div>
              </fieldset>
              <fieldset>
                <legend className="mb-2 text-sm font-semibold text-foreground">Time on the same step</legend>
                <div className="flex flex-wrap gap-1.5">
                  {(["all", "7", "21", "60"] as IdleFilter[]).map((k) => (
                    <Button key={k} className="h-11 px-3" variant={idle === k ? "secondary" : "ghost"} aria-pressed={idle === k} onClick={() => setIdle(k)}>{IDLE_LABELS[k]}</Button>
                  ))}
                </div>
              </fieldset>
              <fieldset>
                <legend className="mb-2 text-sm font-semibold text-foreground">Portal login link <span className="font-normal text-muted-foreground">(hired agents)</span></legend>
                <div className="flex flex-wrap gap-1.5">
                  {(["all", "not_sent", "sent", "clicked"] as LinkFilter[]).map((k) => (
                    <Button key={k} className="h-11 px-3" variant={link === k ? "secondary" : "ghost"} aria-pressed={link === k} onClick={() => setLink(k)}>{LINK_LABELS[k]}</Button>
                  ))}
                </div>
              </fieldset>
              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-foreground">Manager</span>
                <select
                  aria-label="Filter by manager"
                  value={managerFilter}
                  onChange={(e) => setManagerFilter(e.target.value)}
                  className="h-11 w-full rounded-lg border border-border bg-card px-3 text-sm text-foreground focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)]"
                >
                  <option value="all">All managers</option>
                  <option value="none">Unassigned</option>
                  {managers.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </label>
              <Button variant={showClosed ? "secondary" : "outline"} className="h-11" aria-pressed={showClosed} onClick={() => setShowClosed((v) => !v)}>
                {showClosed ? "Showing closed people" : "Show closed people too"}
              </Button>
              <div className="border-t border-border pt-4">
                <Button variant="outline" className="h-11 w-full gap-1.5" onClick={downloadCsv} disabled={listFailed}>
                  <Download className="h-4 w-4" /> Download this list (CSV)
                </Button>
              </div>
            </PopoverContent>
          </Popover>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span>
            {listFailed ? "People did not load" : (
              <><span className="font-medium text-foreground">{visible.length.toLocaleString()}</span> shown</>
            )}
          </span>
          {stepFilter && <FilterChip label={`Step: ${groupLabel(stepFilter)}`} onRemove={() => setStepFilter(null)} />}
          {xcelFilter !== "all" && <FilterChip label={`Xcel: ${XCEL_LABELS[xcelFilter]}`} onRemove={() => setXcelFilter("all")} />}
          {idle !== "all" && <FilterChip label={`Stuck ${IDLE_LABELS[idle]}`} onRemove={() => setIdle("all")} />}
          {link !== "all" && <FilterChip label={`Link: ${LINK_LABELS[link]}`} onRemove={() => setLink("all")} />}
          {managerFilter !== "all" && <FilterChip label={`Manager: ${managerFilter === "none" ? "Unassigned" : managerFilter}`} onRemove={() => setManagerFilter("all")} />}
          {showClosed && <FilterChip label="Including closed" onRemove={() => setShowClosed(false)} />}
          {!listFailed && <StepsLegend reportDay={reportDay} className="ml-auto" />}
        </div>

      </div>

      {/* One block for the bulk bar and the list, so the bar's sticky reach is the whole list: a sticky
          element travels only within its parent, and it used to sit in the toolbar above, whose bottom
          edge is where the list begins, so it scrolled away the moment the list did. The page root's
          children are pinned relative by .page-enter > * (index.css), so the bar cannot be one of them.
          Its top clears the 60px header (fixed on phones, sticky on desktop) plus the notch. */}
      <div className="space-y-5">
        {selectedRows.length > 0 && (
          // Sticky so it stays in reach after ticking people far down the page.
          <div className="sticky top-[calc(3.75rem+env(safe-area-inset-top,0px)+0.5rem)] z-10 flex flex-wrap items-center gap-2 rounded-lg border border-primary/40 bg-card px-4 py-3">
            <span className="text-sm font-medium">{selectedRows.length} selected</span>
            <Select value={bulkStage} onValueChange={setBulkStage}>
              <SelectTrigger className="h-11 w-full text-sm sm:w-60" aria-label="Move selected to stage"><SelectValue placeholder="Move to stage…" /></SelectTrigger>
              <SelectContent>
                {bulkOptions.map((o) => (
                  <SelectItem key={o.stage_key} value={o.stage_key} className="min-h-11">
                    {o.stage_key === "closed_lost" ? "Closed / dropped" : o.display_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button className="h-12 px-5" disabled={!bulkStage || busy === "bulk"} onClick={() => void bulkMove(bulkStage)}>
              {busy === "bulk" ? "Moving…" : "Move"}
            </Button>
            {bulkOptions.some((o) => o.stage_key === "closed_lost") && (
              <Button variant="outline" className="h-11 text-destructive hover:text-destructive" disabled={busy === "bulk"} onClick={() => void bulkClose()}>
                Close all {selectedRows.length}
              </Button>
            )}
            <Button variant="ghost" className="h-11 gap-1" onClick={() => setSelected(new Set())}><X className="h-4 w-4" aria-hidden="true" /> Clear</Button>
          </div>
        )}

      {listFailed ? (
        <div role="alert" className="rounded-xl border border-border bg-card p-10 text-center">
          <p className="text-base text-destructive">
            {rowsQuery.isError ? "The recruit list" : "The stage ladder"} did not load{failText ? `: ${failText}` : ""}. Nothing is shown in its place.
          </p>
          <Button variant="outline" className="mt-4 h-11" onClick={retryLoad} disabled={retrying}>
            <RefreshCw className="h-4 w-4" /> {retrying ? "Retrying…" : "Retry"}
          </Button>
        </div>
      ) : visible.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-8 text-center text-base text-muted-foreground">
          {all.length === 0 ? "Nobody is on the way yet. New applications land here." : "Nobody matches these filters."}
        </p>
      ) : (
        <div role="region" aria-label="People" className="space-y-5">
          {groups.map(({ key: g, people: full }) => {
              const open = expanded.has(g) || !!search || !!stepFilter || idle !== "all" || link !== "all" || xcelFilter !== "all";
              const list = open ? full : full.slice(0, PAGE);
              const fullRows = full.map((p) => p.r);
              const allSelected = fullRows.every((r) => selected.has(personKey(r)));
              const someSelected = !allSelected && fullRows.some((r) => selected.has(personKey(r)));
              const gTone = groupTone(g);
              const gLabel = groupLabel(g);
              return (
                <section key={g} className="space-y-1.5">
                  <div className="flex items-center gap-3 pt-2">
                    <Checkbox
                      aria-label={`Select everyone at ${gLabel}`}
                      checked={allSelected ? true : someSelected ? "indeterminate" : false}
                      onCheckedChange={(v) => toggleMany(fullRows, v === true)}
                      className={CHECKBOX}
                    />
                    <span aria-hidden="true" className={cn("h-2.5 w-2.5 shrink-0 rounded-full", TONE_CLASS[gTone].dot)} />
                    <h2 className="text-lg font-semibold leading-6">{gLabel}</h2>
                    <span className="text-sm tabular-nums text-muted-foreground">{full.length}</span>
                  </div>
                  {/* The rows rise once, one after the other, on first paint. */}
                  <RevealList as="ul" className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
                    {list.map((p) => {
                      const { r, step, xcel } = p;
                      const name = r.display_name;
                      const key = personKey(r);
                      const tel = phoneHref(r.phone);
                      const sms = smsHref(r.phone);
                      const next = nextStageFor(r);
                      const options = optionsFor(r);
                      // A person whose current step is not on their ladder (an agent record still
                      // on an applicant step) keeps their step's name in the box and gets no
                      // invented next step, instead of a blank box and a false "Last step".
                      const onLadder = options.some((s) => s.stage_key === r.stage_key);
                      const isBusy = busy === key || busy === "bulk";
                      const days = Math.round(p.days);
                      const contact = r.person_type === "applicant" && r.last_contacted_at ? formatSince(r.last_contacted_at) : null;
                      const isSel = selected.has(key);
                      const info = r.person_type === "agent" && r.agent_id ? factsByAgent.get(r.agent_id) : undefined;
                      const showMore = canRemove && r.person_type === "agent" && !!r.agent_id;
                      const tone = step.key ? recruitStepTone(step.key) : "slate";
                      const bubble = TONE_CLASS[tone];
                      const lic = licenseWords(r);
                      const flag = flagOf(info?.facts);
                      const applied = appliedWords(r, now);
                      return (
                        <li
                          key={key}
                          className={cn(
                            // Phone: the tick box and bubble in a narrow first column, the person beside them,
                            // then the contact line and the actions each on a full line. Tablet: the actions
                            // sit on their own line under the person. Wide: the person keeps a real column and
                            // the controls stack in one 32rem column beside it, reach on top and the stage
                            // under it. Four columns squeezed a hire's person column to about 210px, because
                            // a hire's stage controls alone are 600px wide (screenshots, 2026-10-29).
                            "grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-3 px-4 py-4 sm:grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)] sm:gap-x-4 xl:grid-cols-[auto_minmax(0,1fr)_minmax(0,32rem)] xl:gap-x-6",
                            isSel && "bg-primary/[0.06]",
                          )}
                        >
                          <div className="flex items-center gap-3 xl:row-span-2">
                            <Checkbox aria-label={`Select ${name}`} checked={isSel} onCheckedChange={() => toggle(r)} className={CHECKBOX} />
                            {/* The person's initials in the colour of their step. Decoration: the name sits beside it
                                and the step is said in words under it, so it is hidden from assistive technology. */}
                            <span aria-hidden="true" className={cn("relative inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border text-sm font-bold", bubble.soft, bubble.text, bubble.border)}>
                              {initialsOf(name)}
                            </span>
                          </div>
                          <div className="min-w-0 space-y-2 xl:row-span-2">
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
                              <span className="line-clamp-2 min-w-0 text-base font-semibold [overflow-wrap:anywhere]">{name}</span>
                              {lic && <TonePill tone={licenseStatusTone(lic.key)} className="whitespace-nowrap">{lic.label}</TonePill>}
                              {flag && <TonePill tone="hot" className="whitespace-nowrap">{flag}</TonePill>}
                            </div>
                            {/* The bar and the step in words: the bar shows how far, the words say where. */}
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                              <JourneyBar index={step.index} tone={tone} className="w-28 sm:w-36" />
                              <span className="text-sm leading-5">
                                {step.index ? <span className="sr-only">{`Step ${step.index} of ${STEP_COUNT}: `}</span> : null}
                                <span className={cn("font-semibold", bubble.text)}>{step.label}</span>
                                {step.detail ? <span className="text-muted-foreground">{SEP}{step.detail}</span> : null}
                              </span>
                            </div>
                            {/* Xcel on its own line when there is something to say: the badge, then the enrollment and progress. */}
                            {xcel.label && (
                              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                <TonePill tone={xcelTone(xcel.kind)} dot className="whitespace-nowrap">{xcel.label}</TonePill>
                                {xcel.detail && <span className={cn("text-sm leading-5", xcel.kind === "bought" ? "text-foreground" : "text-muted-foreground")}>Xcel {xcel.detail}</span>}
                              </div>
                            )}
                            {/* Each short fact stays on one line, and a separator travels with the fact after it. */}
                            <div className="text-sm leading-5 text-muted-foreground">
                              {applied && <><span className={cn("whitespace-nowrap", r.applied_at && "text-foreground")}>{applied}</span>{SEP}</>}
                              {r.manager_name ? `under ${r.manager_name}` : "unassigned"}
                              {SEP}
                              {r.resident_state ? (
                                <button type="button" className={cn(SENTENCE_LINK, "font-medium text-foreground")} title="Resident state (tap to change)" onClick={() => setStateEditing(key)} aria-label={`Change state for ${name}, now ${r.resident_state}`}>{r.resident_state}</button>
                              ) : (
                                <button type="button" className={SENTENCE_LINK} onClick={() => setStateEditing(key)} aria-label={`Add state for ${name}`}>Add state</button>
                              )}
                              {SEP}
                              <span className={cn("whitespace-nowrap", heatClass(p.days))}>{days} {days === 1 ? "day" : "days"} on this step</span>
                              {contact && <>{SEP}<span className="whitespace-nowrap">last contact {contact}</span></>}
                              {r.person_type === "agent" && (
                                <>
                                  {SEP}
                                  {linkState(r) === "clicked" ? (
                                    <span className="text-foreground">login link clicked {formatSince(r.link_used_at ?? r.last_sign_in_at)}</span>
                                  ) : linkState(r) === "sent" ? (
                                    <span className="font-medium text-foreground">login link sent {formatSince(r.link_sent_at)}, not clicked</span>
                                  ) : (
                                    <span className="whitespace-nowrap">login link not sent</span>
                                  )}
                                </>
                              )}
                            </div>
                            {stateEditing === key && (
                              <div className="flex flex-wrap items-center gap-2">
                                <Input
                                  autoFocus
                                  maxLength={2}
                                  placeholder="WI"
                                  aria-label={`State for ${name}`}
                                  className="h-11 w-20 text-center text-base uppercase"
                                  onBlur={(e) => { const v = e.target.value.trim(); if (v) void saveState(r, v); else setStateEditing(null); }}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") { const v = (e.target as HTMLInputElement).value.trim(); if (v) void saveState(r, v); else setStateEditing(null); }
                                    if (e.key === "Escape") setStateEditing(null);
                                  }}
                                />
                                <span className="text-sm text-muted-foreground">Two letters. Enter saves, Esc cancels.</span>
                              </div>
                            )}
                          </div>
                          <div className="col-span-2 flex flex-wrap items-center gap-2 text-sm sm:col-span-1 xl:col-start-3">
                            {tel ? (
                              <>
                                <span className="whitespace-nowrap tabular-nums">{formatPhoneDisplay(r.phone)}</span>
                                <Button asChild variant="outline" className="h-11 px-3">
                                  <a href={tel} {...contactLinkProps(tel)} aria-label={`Call ${name}`}><Phone className="h-4 w-4" /> Call</a>
                                </Button>
                                <Button asChild variant="outline" className="h-11 px-3">
                                  <a href={sms ?? undefined} {...contactLinkProps(sms)} aria-label={`Text ${name}`}><MessageSquare className="h-4 w-4" /> Text</a>
                                </Button>
                              </>
                            ) : r.email ? (
                              <a href={`mailto:${r.email}`} className={cn(QUIET_LINK, "max-w-full gap-1.5 truncate")}>
                                <Mail className="h-4 w-4 shrink-0" aria-hidden="true" /> {r.email}
                              </a>
                            ) : (
                              <span className="inline-flex min-h-11 items-center text-sm text-muted-foreground">No phone or email</span>
                            )}
                            {r.instagram ? (
                              <Button asChild variant="outline" className="h-11 gap-1.5 px-3">
                                <a href={igUrl(r.instagram)} target="_blank" rel="noopener noreferrer" aria-label={`Instagram ${name}`}>
                                  <Instagram className="h-4 w-4" /> @{r.instagram}
                                </a>
                              </Button>
                            ) : igEditing === key ? (
                              <Input
                                autoFocus
                                placeholder="@handle"
                                aria-label={`Instagram handle for ${name}`}
                                className="h-11 w-44 text-base"
                                onBlur={(e) => { const v = e.target.value.trim(); if (v) void saveInstagram(r, v); else setIgEditing(null); }}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") { const v = (e.target as HTMLInputElement).value.trim(); if (v) void saveInstagram(r, v); else setIgEditing(null); }
                                  if (e.key === "Escape") setIgEditing(null);
                                }}
                              />
                            ) : (
                              <button type="button" className={cn(QUIET_LINK, "gap-1.5")} onClick={() => setIgEditing(key)} aria-label={`Add Instagram for ${name}`}>
                                <Instagram className="h-4 w-4" aria-hidden="true" /> Add Instagram
                              </button>
                            )}
                            {/* A hire who still needs the license: set where they are on it from here. */}
                            {r.person_type === "agent" && r.license_status !== "licensed" && (
                              <LicenseProgressSelector
                                agentId={r.agent_id ?? undefined}
                                currentProgress={(r.license_progress || "unlicensed") as never}
                                onProgressUpdated={() => void refresh()}
                                className="h-11 text-sm"
                              />
                            )}
                            {r.person_type === "agent" && r.agent_id && (info ? (
                              <>
                                <ExpectedStartControl facts={info.facts} />
                                {info.open > 0 && (
                                  <Link
                                    to="/dashboard/onboarding-ladder"
                                    className={cn(QUIET_LINK, info.blocking > 0 && "font-medium text-warning hover:text-warning")}
                                    title="Open the onboarding queue"
                                  >
                                    {info.open} open {info.open === 1 ? "item" : "items"}{info.blocking > 0 ? ` (${info.blocking} blocking)` : ""}
                                  </Link>
                                )}
                              </>
                            ) : factsQuery.isError ? (
                              // Outside the live onboarding population (paused, departed, placeholder)
                              // nothing is drawn; when the facts failed to load, say so rather than hide it.
                              <span className="inline-flex min-h-11 items-center text-sm text-muted-foreground">Start date unknown (did not load)</span>
                            ) : null)}
                          </div>
                          <div className="col-span-2 flex flex-wrap items-center gap-2 sm:col-start-2 xl:col-span-1 xl:col-start-3">
                            <Select value={r.stage_key} onValueChange={(v) => void setStage(r, v, { origin: stageTriggers.current.get(key) ?? null })} disabled={isBusy}>
                              <SelectTrigger
                                aria-label={`Stage for ${name}`}
                                // On a phone the box shares its line with "Move to" when both fit and takes what is
                                // left; a long "Move to" wraps under it instead of squeezing it. The minimum is
                                // important-flagged because the touch rule in delight.css sets a 44px min-width on
                                // every combobox and outranks a plain utility.
                                className="h-11 !min-w-[9.5rem] flex-1 text-sm sm:w-[220px] sm:flex-none"
                                // aria-label sits first: check:control-labels reads the tag up to the first ">",
                                // and the arrow in this ref would otherwise hide the label from it.
                                ref={(el) => { if (el) stageTriggers.current.set(key, el); else stageTriggers.current.delete(key); }}
                              >
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {!onLadder && <SelectItem value={r.stage_key} disabled className="min-h-11">{r.stage_name}</SelectItem>}
                                {options.map((o) => (
                                  <SelectItem key={o.stage_key} value={o.stage_key} className="min-h-11">
                                    {o.stage_key === "closed_lost" ? "Closed / dropped" : o.display_name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            {next ? (
                              // The button is read before the write so the bubbles rise from it.
                              <Button variant="outline" className="h-11 gap-1.5 px-3" disabled={isBusy} onClick={(e) => { const origin = e.currentTarget; void setStage(r, next.stage_key, { origin }); }}>
                                Move to {next.display_name} <ArrowRight className="h-4 w-4" aria-hidden="true" />
                              </Button>
                            ) : (
                              <Button variant="outline" className="h-11 px-3" disabled>{onLadder ? "Last step" : "No next step"}</Button>
                            )}
                            {showMore && (
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="outline" className="h-11 px-3" aria-label={`More for ${name}`} disabled={isBusy}>
                                    More <ChevronDown className="h-4 w-4" aria-hidden="true" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="w-56">
                                  {/* Two steps: this opens the confirm dialog, nothing happens until it is accepted. */}
                                  <DropdownMenuItem className="min-h-11 gap-2 text-destructive focus:text-destructive" onSelect={() => void removeAgent(r)}>
                                    <UserX className="h-4 w-4" aria-hidden="true" /> No longer with us
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            )}
                          </div>
                        </li>
                      );
                    })}
                    {full.length > list.length && (
                      <li>
                        <button
                          type="button"
                          className="min-h-11 w-full px-4 py-2 text-center text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)]"
                          onClick={() => setExpanded((prev) => new Set(prev).add(g))}
                        >
                          Show all {full.length} in {gLabel}
                        </button>
                      </li>
                    )}
                  </RevealList>
                </section>
              );
            })}
        </div>
      )}
      </div>
    </div>
  );
}
