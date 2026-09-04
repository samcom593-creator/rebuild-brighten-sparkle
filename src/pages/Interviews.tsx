import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { format, isPast, differenceInCalendarDays } from "date-fns";
import {
  ArrowLeft, ArrowRight, Building2, CalendarClock, CheckCircle2, ChevronDown, Instagram, Mail,
  MessageSquare, Phone, RefreshCw, RotateCcw, Search, UserCheck, UserX,
  Copy, ExternalLink, Link2, Send, SlidersHorizontal, Sparkles, Zap,
} from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { RecruitingWorkspaceNav } from "@/components/recruiting/RecruitingWorkspaceNav";
import { RecruitingCommandHero } from "@/components/recruiting/RecruitingCommandHero";
import { PromoteApplicantButton } from "@/components/applicants/PromoteApplicantButton";
import { phoneHref, smsHref, contactLinkProps } from "@/lib/phone";
import { instagramProfileLink } from "@/lib/instagram";
import { promoteApplicationToAgent } from "@/lib/hireToOnboarding";
import { resolveBrand } from "@/config/brand";
import { HireLaunchBoard } from "@/components/hires/HireLaunchBoard";
import {
  formatPhoenix, gapEmailState, inviteReceipt, onboardingBucketMeta,
  type OnboardingCall, type OnboardingGap,
} from "@/lib/onboardingCalls";

type ActorRole = "executive" | "recruiter" | "va";
const BRAND = resolveBrand();
type InterviewAction =
  | "confirm" | "qualified" | "follow_up" | "hire" | "not_hired"
  | "unqualified" | "no_show" | "reschedule" | "cancel" | "reopen";
type PendingAction = InterviewAction | "promote";
type Applicant = {
  id: string; name: string | null; phone: string | null; email: string | null;
  instagram: string | null; company: string | null; appointment_at: string | null;
  stage: string; interview_result: string | null; unqualified_reason: string | null;
  notes: string | null; reschedule_count: number | null; va_name: string | null;
  recruiter_name: string | null; version: number; created_at: string | null; updated_at: string | null;
  application_id: string | null; onboarding_status: string;
  application_license_status: string | null; application_npn: string | null;
  identity_conflict: boolean;
};
type PipelineResponse = {
  applicants: Applicant[]; counts: Record<string, number>; total: number;
  activeHires: ActiveHire[];
  role: ActorRole; generatedAt: string;
};
type ActiveHire = {
  agent_id: string; display_name: string; email: string | null; phone: string | null;
  license_status: string; onboarding_stage: string | null; hired_at: string;
  contracted_at: string | null; first_deal_at: string | null; source_application_id: string | null;
};
type OnboardingTruth = {
  licensed_active_agents: number; licensed_active_without_onboarding_call: number;
  onboarding_calls_future_open: number; onboarding_calls_past_undispositioned: number;
  booking_emails_queued: number; booking_emails_sent: number; booking_emails_dead: number;
  invites_queued: number; invites_sent: number; invites_failed: number;
  invite_recipients: string | null; scheduling_url: string | null;
};
type OnboardingResponse = {
  calls: OnboardingCall[]; truth: OnboardingTruth | null; gaps: OnboardingGap[];
  role: ActorRole; generatedAt: string;
};
type Tab = "open" | "overdue" | "upcoming" | "hired" | "all" | "onboarding";
type SortMode = "priority" | "appointment" | "newest";
type HireFilter = "all" | "licensed" | "unlicensed" | "needs_action";
const TABS: ReadonlyArray<readonly [Tab, string]> = [
  ["open", "Open"], ["overdue", "Overdue"], ["upcoming", "Upcoming"], ["hired", "Active hires"], ["onboarding", "Onboarding"], ["all", "History"],
];
function initialTab(): Tab {
  const requested = new URLSearchParams(window.location.search).get("tab");
  return TABS.some(([key]) => key === requested) ? (requested as Tab) : "open";
}

const STAGE_META: Record<string, { label: string }> = {
  appointment_set: { label: "Appointment set" }, confirmed: { label: "Confirmed" },
  rescheduled: { label: "Rescheduled" }, no_show: { label: "No-show" },
  interview_complete: { label: "Interview complete" }, hired: { label: "Hired" },
  not_hired: { label: "Not hired" }, unqualified: { label: "Unqualified" }, canceled: { label: "Canceled" },
};
const OPEN = ["appointment_set", "confirmed", "rescheduled", "no_show", "interview_complete"];
const LEGAL_BY_STAGE: Record<string, InterviewAction[]> = {
  appointment_set: ["confirm", "no_show", "reschedule", "cancel"],
  confirmed: ["qualified", "follow_up", "hire", "not_hired", "unqualified", "no_show", "reschedule"],
  rescheduled: ["confirm", "qualified", "follow_up", "hire", "not_hired", "unqualified", "no_show", "cancel"],
  interview_complete: ["hire", "not_hired", "follow_up", "unqualified"],
  no_show: ["reschedule", "unqualified", "cancel"],
  canceled: ["reschedule"], hired: ["reopen"], not_hired: ["reopen"], unqualified: ["reopen"],
};
const VA_ACTIONS = new Set<InterviewAction>(["confirm", "no_show", "reschedule", "cancel"]);
const ACTION_LABEL: Record<InterviewAction, string> = {
  confirm: "Confirm appointment", qualified: "Qualified", follow_up: "Follow up", hire: "Hire",
  not_hired: "Not hired", unqualified: "Unqualify", no_show: "No-show", reschedule: "Reschedule",
  cancel: "Cancel", reopen: "Reopen",
};
const PENDING_ACTION_LABEL: Record<PendingAction, string> = {
  ...ACTION_LABEL,
  promote: "Start onboarding",
};

function initials(name: string | null) {
  if (!name) return "?";
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("");
}

const INTERVIEW_RAIL = ["Booked", "Confirmed", "Interviewed", "Hired"] as const;
const SORT_LABEL: Record<SortMode, string> = { priority: "Priority", appointment: "Appointment time", newest: "Newest" };

function interviewRailStep(row: Applicant) {
  if (row.stage === "hired") return 3;
  if (["interview_complete", "not_hired", "unqualified"].includes(row.stage)) return 2;
  if (["confirmed", "rescheduled", "no_show"].includes(row.stage)) return 1;
  return 0;
}

function hireRailStep(hire: ActiveHire) {
  const stage = (hire.onboarding_stage ?? "").toLowerCase();
  if (hire.first_deal_at || /(field|active|production|ready)/.test(stage)) return 3;
  if (/(training|onboard|contract)/.test(stage)) return 2;
  if (hire.license_status === "licensed") return 1;
  return 0;
}

function availableActions(row: Applicant, role: ActorRole | undefined) {
  // A terminal hire without an application cannot create the canonical agent
  // account. Keep the interview actionable, but never offer a half-hire that
  // strands onboarding. Staff can repair the identity/application link first.
  const actions = (LEGAL_BY_STAGE[row.stage] ?? []).filter((action) => action !== "hire" || Boolean(row.application_id));
  return role === "va" ? actions.filter((action) => VA_ACTIONS.has(action)) : actions;
}

function actionPrompt(row: Applicant) {
  switch (row.stage) {
    case "appointment_set": return "Confirm";
    case "confirmed": case "rescheduled": return "Record outcome";
    case "interview_complete": return "Make decision";
    case "no_show": case "canceled": return "Rebook";
    default: return "Reopen";
  }
}

function statusOf(row: Applicant, now: Date) {
  const appointment = row.appointment_at ? new Date(row.appointment_at) : null;
  if (row.stage === "hired") {
    const timing = !row.application_id ? "application link needed"
      : row.onboarding_status === "contracted" ? "contracted"
      : row.onboarding_status === "hired" ? "onboarding started"
      : "ready for onboarding";
    return { tone: "text-success", dot: "bg-success", label: "Hired", timing };
  }
  if (row.stage === "interview_complete") return { tone: "text-primary", dot: "bg-primary", label: "Interviewed", timing: "record the decision" };
  if (row.stage === "no_show") return { tone: "text-warning", dot: "bg-warning", label: "No-show", timing: "follow up or reschedule" };
  // Overdue is decided before the rescheduled special-case: the Overdue group
  // already admits a rescheduled row whose new time has passed, so its badge
  // must say so too — not "Rescheduled · <a time that is already gone>".
  if (appointment && isPast(appointment) && OPEN.includes(row.stage)) {
    const days = Math.abs(differenceInCalendarDays(now, appointment));
    return { tone: "text-destructive", dot: "bg-destructive", label: "Overdue", timing: `${days} day${days === 1 ? "" : "s"} · needs action` };
  }
  if (row.stage === "rescheduled") return { tone: "text-warning", dot: "bg-warning", label: "Rescheduled", timing: appointment ? format(appointment, "EEE MMM d · h:mma") : "set a new time" };
  if (appointment) return { tone: "text-primary", dot: "bg-primary", label: row.stage === "confirmed" ? "Confirmed" : "Up next", timing: format(appointment, "EEE MMM d · h:mma") };
  return { tone: "text-muted-foreground", dot: "bg-muted-foreground", label: STAGE_META[row.stage]?.label ?? row.stage, timing: "no time set" };
}

async function invokeAction(row: Applicant, action: InterviewAction, appointmentAt: string, reason: string) {
  const { data, error } = await supabase.functions.invoke("interviews-pipeline", {
    body: {
      id: row.id,
      action,
      expectedVersion: row.version,
      appointmentAt: appointmentAt ? new Date(appointmentAt).toISOString() : undefined,
      reason: reason.trim() || undefined,
    },
  });
  if (error) {
    let message = error.message;
    let conflict = false;
    const context = (error as { context?: Response }).context;
    if (context) {
      conflict = context.status === 409;
      // empty-catch-allow:http-error-body — original functions error remains the fallback message.
      const payload = await context.clone().json().catch(() => null) as { error?: string } | null;
      message = payload?.error || message;
    }
    const failure = new Error(message) as Error & { conflict?: boolean };
    failure.conflict = conflict;
    throw failure;
  }
  if (data?.error) throw new Error(data.error);
  return data as { receipt: { persistedAt: string; warning: string | null } };
}

export default function Interviews() {
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<Tab>(initialTab);
  const [sortMode, setSortMode] = useState<SortMode>("priority");
  const [hireFilter, setHireFilter] = useState<HireFilter>("all");
  const [focusIndex, setFocusIndex] = useState(0);
  const [sendingGap, setSendingGap] = useState<string | null>(null);
  const [pending, setPending] = useState<{ row: Applicant; action: PendingAction } | null>(null);
  const [appointmentAt, setAppointmentAt] = useState("");
  const [reason, setReason] = useState("");
  const [hireNpn, setHireNpn] = useState("");
  const [saving, setSaving] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const pipeline = useQuery<PipelineResponse>({
    queryKey: ["interviews-pipeline"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("interviews-pipeline");
      if (error) throw error;
      return data as PipelineResponse;
    },
    staleTime: 60_000,
    // 60s -> 5min. These read realtime-covered tables and a one-minute poll on
    // a page left open all day is what produced 11+ hours of database time
    // across the platform's top RPCs.
    refetchInterval: 300_000,
    refetchOnWindowFocus: true,
    placeholderData: (previous) => previous,
  });

  const shareToken = useQuery({
    queryKey: ["assistant-interview-share-token"],
    queryFn: async () => {
      const { data, error } = await supabase.from("assistant_share_tokens" as never)
        .select("token,label,last_used_at").eq("is_active", true).limit(1).maybeSingle();
      if (error) throw error;
      return data as unknown as { token: string; label: string; last_used_at: string | null } | null;
    },
    staleTime: 5 * 60_000,
  });
  const shareUrl = shareToken.data?.token
    ? `${window.location.origin}/assistant/interviews?t=${shareToken.data.token}`
    : null;

  // Onboarding calls: Calendly "APEX Onboarding Call" bookings + the invite
  // receipt for the onboarding team + licensed hires with no call yet.
  const onboarding = useQuery<OnboardingResponse>({
    queryKey: ["interviews-pipeline", "onboarding-calls"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("interviews-pipeline", { body: { list: "onboarding_calls" } });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data as OnboardingResponse;
    },
    staleTime: 60_000,
    // 60s -> 5min. These read realtime-covered tables and a one-minute poll on
    // a page left open all day is what produced 11+ hours of database time
    // across the platform's top RPCs.
    refetchInterval: 300_000,
    refetchOnWindowFocus: true,
    placeholderData: (previous) => previous,
  });
  // The tab badge counts WORK on that tab (upcoming calls + licensed hires still
  // needing a booking), not just calendar rows — otherwise it reads "0" beside
  // a KPI tile saying 26 hires have no onboarding call.
  const onboardingUpcoming = onboarding.data?.calls.filter((call) => call.bucket === "upcoming").length ?? 0;
  const onboardingWork = onboardingUpcoming + (onboarding.data?.gaps.length ?? 0);

  const sendBookingLink = async (gap: OnboardingGap) => {
    setSendingGap(gap.agent_id);
    try {
      const { data, error } = await supabase.rpc("admin_enqueue_onboarding_call" as never, { p_agent_id: gap.agent_id } as never);
      if (error) throw error;
      const receipt = data as unknown as { enqueued: boolean; reason: string };
      if (receipt.enqueued) toast.success(`Booking link queued for ${gap.display_name ?? "agent"} · goes out at the 10:00 AM Central send`);
      else toast.warning(`Not queued: ${receipt.reason.replace(/_/g, " ")}`);
      await onboarding.refetch();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not queue the booking link");
    } finally {
      setSendingGap(null);
    }
  };

  const now = new Date();
  const applicants = pipeline.data?.applicants ?? [];
  const activeHires = pipeline.data?.activeHires ?? [];
  const overdue = applicants.filter((row) => row.appointment_at && isPast(new Date(row.appointment_at)) && OPEN.includes(row.stage) && row.stage !== "interview_complete");
  const upcoming = applicants.filter((row) => row.appointment_at && !isPast(new Date(row.appointment_at)) && OPEN.includes(row.stage));
  const openAll = applicants.filter((row) => OPEN.includes(row.stage));
  const needsDecision = applicants.filter((row) => row.stage === "interview_complete").length;
  const source = tab === "overdue" ? overdue : tab === "upcoming" ? upcoming : tab === "all" ? applicants : tab === "hired" ? [] : openAll;
  const term = query.trim().toLowerCase();
  const matching = term
    ? source.filter((row) => [row.name, row.company, row.email, row.phone, row.instagram].some((value) => (value ?? "").toLowerCase().includes(term)))
    : source;
  const filtered = [...matching].sort((left, right) => {
    if (sortMode === "newest") return new Date(right.created_at ?? 0).getTime() - new Date(left.created_at ?? 0).getTime();
    if (sortMode === "appointment") return new Date(left.appointment_at ?? "9999-12-31").getTime() - new Date(right.appointment_at ?? "9999-12-31").getTime();
    const priority = (row: Applicant) => row.appointment_at && isPast(new Date(row.appointment_at)) && OPEN.includes(row.stage)
      ? 0 : row.stage === "interview_complete" ? 1 : row.stage === "no_show" ? 2 : row.appointment_at ? 3 : 4;
    return priority(left) - priority(right)
      || new Date(left.appointment_at ?? left.updated_at ?? 0).getTime() - new Date(right.appointment_at ?? right.updated_at ?? 0).getTime();
  });
  const groups = useMemo(() => [
    { key: "overdue", title: "Overdue", sub: "appointment passed, still open", danger: true, rows: filtered.filter((row) => row.appointment_at && isPast(new Date(row.appointment_at)) && OPEN.includes(row.stage) && row.stage !== "interview_complete") },
    { key: "upcoming", title: "Upcoming", sub: "confirmed and scheduled", rows: filtered.filter((row) => row.appointment_at && !isPast(new Date(row.appointment_at)) && OPEN.includes(row.stage)) },
    { key: "other", title: "Needs a decision or time", sub: "interviewed, unscheduled, or closed", rows: filtered.filter((row) => !((row.appointment_at && isPast(new Date(row.appointment_at)) && OPEN.includes(row.stage) && row.stage !== "interview_complete") || (row.appointment_at && !isPast(new Date(row.appointment_at)) && OPEN.includes(row.stage)))) },
  ].filter((group) => group.rows.length > 0), [filtered]);

  // MP-430: the queue rendered every candidate card at once — 304 rows made the
  // page 53,000 px tall in a screenshot, and the Overdue group alone scrolled
  // for screens. Each group shows its first page; the rest sit behind one
  // button that says how many are hidden. Nothing is filtered out, so the
  // counts in the badges stay the truth.
  const GROUP_PAGE = 8;
  const [shownByGroup, setShownByGroup] = useState<Record<string, number>>({});
  const shownFor = (key: string) => shownByGroup[key] ?? GROUP_PAGE;
  const showMore = (key: string) => setShownByGroup((prev) => ({ ...prev, [key]: shownFor(key) + 12 }));
  const priorityPool = [
    ...overdue,
    ...applicants.filter((row) => row.stage === "interview_complete"),
    ...applicants.filter((row) => row.stage === "no_show"),
    ...upcoming,
    ...openAll,
  ].filter((row, index, rows) => rows.findIndex((candidate) => candidate.id === row.id) === index);
  const safeFocusIndex = Math.min(focusIndex, Math.max(0, priorityPool.length - 1));
  const priorityCandidate = priorityPool.length ? priorityPool[safeFocusIndex] : null;

  // Reloads and shared links keep the view: ?tab= is already honored on load,
  // so switching writes it back without adding history entries.
  const switchTab = (next: Tab) => {
    setTab(next);
    setFocusIndex(0);
    const url = new URL(window.location.href);
    if (next === "open") url.searchParams.delete("tab");
    else url.searchParams.set("tab", next);
    window.history.replaceState(null, "", url.toString());
  };

  const chooseAction = (row: Applicant, action: InterviewAction) => {
    setPending({ row, action });
    setAppointmentAt("");
    setReason("");
    setHireNpn(row.application_npn ?? "");
  };
  const choosePromotion = (row: Applicant) => {
    setPending({ row, action: "promote" });
    setAppointmentAt("");
    setReason("");
    setHireNpn(row.application_npn ?? "");
  };
  const saveAction = async () => {
    if (!pending) return;
    setSaving(true);
    try {
      const selected = pending;
      if (selected.action === "promote") {
        if (!selected.row.application_id) throw new Error(`Link the ${BRAND.shortName} application before starting onboarding.`);
        const hire = await promoteApplicationToAgent(selected.row.application_id, { npn: hireNpn });
        if (hire.partial) toast.warning(hire.message);
        else toast.success("Agent account created · onboarding started");
        setPending(null);
        await pipeline.refetch();
        return;
      }
      const result = await invokeAction(selected.row, selected.action, appointmentAt, reason);
      const receiptTime = format(new Date(result.receipt.persistedAt), "h:mm a");
      if (result.receipt.warning) toast.warning(result.receipt.warning);
      else toast.success(`${PENDING_ACTION_LABEL[selected.action]} saved · ${receiptTime}`);

      // "Hire" is the action, not the first half of a two-click workflow.
      // Immediately create the canonical account and let add-agent start the
      // correct licensed/unlicensed onboarding path.
      if (selected.action === "hire") {
        if (!selected.row.application_id) {
          toast.warning("Hire saved, but no matching APEX application exists. Add the person with Add Agent to start onboarding.");
        } else {
          try {
            const hire = await promoteApplicationToAgent(selected.row.application_id, { npn: hireNpn });
            if (hire.partial) toast.warning(hire.message);
            else toast.success("Agent account created · onboarding started");
          } catch (promoteError) {
            // The hire itself persisted; only account creation failed. Keeping
            // the dialog open invites a second hire write against a version
            // that no longer exists — close it and retry from the row.
            toast.error(`Hire saved, but the agent account was not created: ${promoteError instanceof Error ? promoteError.message : "unknown error"}. Retry from the row's Start onboarding button.`);
          }
        }
      }
      setPending(null);
      await pipeline.refetch();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Interview update failed");
      if ((error as { conflict?: boolean } | null)?.conflict) {
        // The row changed under this dialog; its saved version is gone, so a
        // retry can only fail. Close and show the queue as it now is.
        setPending(null);
        await pipeline.refetch();
      }
    } finally {
      setSaving(false);
    }
  };

  const renderOnboarding = () => {
    if (onboarding.isLoading) {
      // stable-key-allow:static-onboarding-skeleton — fixed three placeholders never reorder or hold state.
      return <div className="space-y-2">{Array.from({ length: 3 }).map((_, index) => <div key={index} className="h-24 animate-pulse rounded-lg border border-border bg-muted/20" />)}</div>;
    }
    if (!onboarding.data) {
      return <div role="alert" className="rounded-lg border border-destructive/30 p-8 text-center text-sm text-destructive">Onboarding calls are unavailable; nothing here should be read as zero. <button className="underline" onClick={() => onboarding.refetch()}>Retry</button></div>;
    }
    const { calls, truth, gaps } = onboarding.data;
    const visible = term
      ? calls.filter((call) => [call.invitee_name, call.agent_display_name, call.invitee_email, call.invitee_phone].some((value) => (value ?? "").toLowerCase().includes(term)))
      : calls;
    const callGroups = [
      { key: "upcoming", title: "Upcoming", sub: "on the calendar · onboarding team invited", danger: false, rows: visible.filter((call) => call.bucket === "upcoming") },
      { key: "overdue", title: "Overdue", sub: "call time passed, no outcome logged", danger: true, rows: visible.filter((call) => call.bucket === "overdue") },
      { key: "history", title: "Completed or canceled", sub: "history", danger: false, rows: visible.filter((call) => call.bucket === "completed" || call.bucket === "canceled") },
    ].filter((group) => group.rows.length > 0);
    const tiles = [
      { label: "Upcoming onboarding calls", value: truth?.onboarding_calls_future_open, detail: `booked on ${BRAND.shortName} Onboarding Call`, tone: "text-primary" },
      { label: "Licensed hires without a call", value: truth?.licensed_active_without_onboarding_call, detail: `${truth?.booking_emails_queued ?? 0} booking links queued · ${truth?.booking_emails_sent ?? 0} sent`, tone: "text-warning" },
      { label: "Onboarding-team invites sent", value: truth?.invites_sent, detail: `${truth?.invites_queued ?? 0} queued · ${truth?.invites_failed ?? 0} failed · ${truth?.invite_recipients ?? "no recipient set"}`, tone: "text-success" },
    ];
    return (
      <div className="space-y-6">
        {onboarding.isError && <div role="alert" className="rounded-lg border border-warning/30 bg-warning/5 p-3 text-sm text-warning">Refresh failed. Showing the last successful onboarding snapshot from {format(new Date(onboarding.data.generatedAt), "h:mm a")}. <button className="underline" onClick={() => onboarding.refetch()}>Retry</button></div>}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {tiles.map((item) => <div key={item.label} className="rounded-lg border border-border bg-card p-4"><p className={`text-3xl font-bold tabular-nums ${item.tone}`}>{typeof item.value === "number" ? item.value.toLocaleString() : "—"}</p><p className="mt-1 text-sm font-semibold">{item.label}</p><p className="text-xs text-muted-foreground">{item.detail}</p></div>)}
        </div>
        {truth?.scheduling_url && (
          <p className="text-xs text-muted-foreground">Booking calendar: <a className="underline" href={truth.scheduling_url} target="_blank" rel="noopener noreferrer">{truth.scheduling_url}</a> · every newly licensed hire gets one single-use link automatically; nothing is mass-sent.</p>
        )}
        {callGroups.length === 0 && (
          <div role="status" className="rounded-lg border border-border p-10 text-center text-sm text-muted-foreground">{term ? `No onboarding calls match “${query.trim()}”.` : <>No onboarding calls captured yet. A booking on the {BRAND.shortName} Onboarding Call calendar appears here within 15 minutes.</>}</div>
        )}
        {callGroups.map((group) => (
          <section key={group.key} aria-labelledby={`onboarding-group-${group.key}`}>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <h2 id={`onboarding-group-${group.key}`} className={`text-sm font-bold ${group.danger ? "text-destructive" : "text-foreground"}`}>{group.title}</h2>
              <span className="text-xs text-muted-foreground">{group.sub}</span>
              <Badge variant="outline">{group.rows.length}</Badge>
            </div>
            <div className="overflow-hidden rounded-lg border border-border bg-card">
              {group.rows.map((row, index) => {
                const meta = onboardingBucketMeta(row.bucket);
                const receipt = inviteReceipt(row.invites);
                const name = row.invitee_name || row.agent_display_name || row.invitee_email || "No name on file";
                const callHref = phoneHref(row.invitee_phone);
                const textHref = smsHref(row.invitee_phone);
                return (
                  <div key={row.id} className={`grid grid-cols-1 gap-3 p-4 md:grid-cols-[175px_minmax(0,1fr)_auto] md:items-center ${index ? "border-t border-border" : ""}`}>
                    <div className="text-xs">
                      <p className={`inline-flex items-center gap-1.5 font-semibold ${meta.tone}`}><span className={`h-2 w-2 rounded-full ${meta.dot}`} />{meta.label}</p>
                      <p className="mt-1 text-muted-foreground">{formatPhoenix(row.scheduled_at)} Phoenix</p>
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{name}</p>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                        <Badge variant="outline" className="text-[10px]">Onboarding call</Badge>
                        {row.agent_id && row.agent_display_name && <span>Agent · {row.agent_display_name}</span>}
                        {!row.agent_id && <span className="text-warning">No agent row matched</span>}
                        <span className={receipt.tone} title={receipt.detail ?? undefined}>{receipt.label}</span>
                        {row.canceled_at && row.cancel_reason && <span>{row.cancel_reason}</span>}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 md:justify-end">
                      {callHref && <Button asChild size="icon" aria-label={`Call ${name}`} className="h-11 w-11 sm:h-9 sm:w-9"><a href={callHref} {...contactLinkProps(callHref)}><Phone className="h-4 w-4" /></a></Button>}
                      {textHref && <Button asChild size="icon" variant="outline" aria-label={`Text ${name}`} className="h-11 w-11 sm:h-9 sm:w-9"><a href={textHref} {...contactLinkProps(textHref)}><MessageSquare className="h-4 w-4" /></a></Button>}
                      {row.invitee_email && <Button asChild size="icon" variant="outline" aria-label={`Email ${name}`} className="h-11 w-11 sm:h-9 sm:w-9"><a href={`mailto:${row.invitee_email}`}><Mail className="h-4 w-4" /></a></Button>}
                      {row.bucket === "upcoming" && row.reschedule_url && <Button asChild size="sm" variant="outline" className="h-11 sm:h-9"><a href={row.reschedule_url} target="_blank" rel="noopener noreferrer"><ExternalLink className="h-4 w-4" /> Reschedule</a></Button>}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
        {gaps.length > 0 && (
          <section aria-labelledby="onboarding-gaps">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <h2 id="onboarding-gaps" className="text-sm font-bold text-warning">Licensed hires without an onboarding call</h2>
              <span className="text-xs text-muted-foreground">counted, never mass-sent · send a booking link one person at a time</span>
              <Badge variant="outline">{gaps.length}</Badge>
            </div>
            <div className="overflow-hidden rounded-lg border border-border bg-card">
              {gaps.map((gap, index) => {
                const state = gapEmailState(gap);
                return (
                  <div key={gap.agent_id} className={`flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between ${index ? "border-t border-border" : ""}`}>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{gap.display_name || "Unnamed agent"}</p>
                      <p className={`text-xs ${state.tone}`}>{state.label}{gap.licensed_at ? ` · licensed ${formatPhoenix(gap.licensed_at)}` : ""}</p>
                    </div>
                    {state.canSend && (
                      <Button size="sm" variant="outline" className="h-11 shrink-0 sm:h-9" disabled={sendingGap === gap.agent_id} onClick={() => void sendBookingLink(gap)}>
                        {sendingGap === gap.agent_id ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Send booking link
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}
      </div>
    );
  };

  // MP-356: the launch board was a read-only rail over this month's hires
  // only. It now lives in HireLaunchBoard, reads v_hire_launch_board (every
  // active hire, not just this month's — 15 mid-process people were invisible
  // here), and every step on every card is a control that writes.
  const renderActiveHires = () => {
    if (pipeline.isLoading) {
      // stable-key-allow:static-active-hire-skeleton — fixed placeholders never reorder or hold state.
      return <div className="space-y-2">{Array.from({ length: 4 }).map((_, index) => <div key={index} className="h-24 animate-pulse rounded-xl border border-border bg-muted/20" />)}</div>;
    }
    if (!pipeline.data) {
      return <div role="alert" className="rounded-xl border border-destructive/30 p-8 text-center text-sm text-destructive">The canonical hire roster is unavailable; no hire count should be read as zero. <button className="underline" onClick={() => pipeline.refetch()}>Retry</button></div>;
    }
    return <HireLaunchBoard searchTerm={query} />;
  };

  const activeGeneratedAt = tab === "onboarding" ? onboarding.data?.generatedAt : pipeline.data?.generatedAt;
  const refreshing = tab === "onboarding" ? onboarding.isFetching : pipeline.isFetching;
  const stageCounts = pipeline.data?.counts ?? {};
  const operatingFunnel = [
    { label: "Needs contact", value: (stageCounts.appointment_set ?? 0) + (stageCounts.no_show ?? 0), detail: "Booked or missed", target: "open" as Tab },
    { label: "Confirmed", value: (stageCounts.confirmed ?? 0) + (stageCounts.rescheduled ?? 0), detail: "Ready for interview", target: "upcoming" as Tab },
    { label: "Decision due", value: stageCounts.interview_complete ?? 0, detail: "Hire or close", target: "open" as Tab },
    { label: "Active hires MTD", value: activeHires.length, detail: "Canonical roster", target: "hired" as Tab },
  ];
  const funnelPeak = Math.max(1, ...operatingFunnel.map((item) => item.value));
  const refreshActiveTab = () => {
    if (tab === "onboarding") void onboarding.refetch();
    else void pipeline.refetch();
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable;
      if (event.key === "/" && !typing) {
        event.preventDefault();
        searchRef.current?.focus();
      }
      if (!typing && priorityPool.length > 1 && (event.key === "j" || event.key === "k")) {
        event.preventDefault();
        setFocusIndex((current) => event.key === "j"
          ? (current + 1) % priorityPool.length
          : (current - 1 + priorityPool.length) % priorityPool.length);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [priorityPool.length]);

  return (
    <div className="page-enter mx-auto w-full max-w-6xl space-y-5 px-4 pb-24 sm:px-6">
      <RecruitingWorkspaceNav />
      <RecruitingCommandHero
        eyebrow="Recruiting operations · live"
        title="Interview Control Room"
        subtitle="One operating screen to contact the next candidate, recover missed calls, make hiring decisions, and launch every new hire into the right onboarding path."
        statusLabel={pipeline.isError ? "Last good snapshot" : "Live interview queue"}
        updatedLabel={activeGeneratedAt ? format(new Date(activeGeneratedAt), "h:mm a") : null}
        actions={
          <>
            {shareUrl && <Button size="sm" className="h-10 bg-[#C9A961] font-bold text-black hover:bg-[#C9A961]/90" onClick={async () => { try { await navigator.clipboard.writeText(shareUrl); toast.success("Candidate link copied"); } catch { toast.error("Copy failed"); } }}><Link2 className="h-4 w-4" /> Copy candidate link</Button>}
            <Button size="sm" variant="outline" className="h-10 border-border bg-white/[0.04] text-foreground hover:bg-white/10 hover:text-white" onClick={refreshActiveTab} disabled={refreshing}>
              <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} /> Refresh live data
            </Button>
          </>
        }
        metrics={[
          {
            label: "Needs attention",
            value: pipeline.data ? overdue.length + needsDecision : null,
            detail: pipeline.data ? `${overdue.length} overdue · ${needsDecision} awaiting a decision` : "Waiting for interview truth",
            icon: RotateCcw,
            tone: "bad",
            active: tab === "overdue",
            onClick: () => switchTab("overdue"),
          },
          {
            label: "Upcoming calls",
            value: pipeline.data ? upcoming.length : null,
            detail: "Confirmed and scheduled ahead",
            icon: CalendarClock,
            tone: "info",
            active: tab === "upcoming",
            onClick: () => switchTab("upcoming"),
          },
          {
            label: "Decisions due",
            value: pipeline.data ? needsDecision : null,
            detail: "Interview completed; hire or close the loop",
            icon: CheckCircle2,
            tone: "warn",
            active: tab === "open" && needsDecision > 0,
            onClick: () => switchTab("open"),
          },
          {
            label: "Active hires",
            value: pipeline.data ? activeHires.length : null,
            detail: "Canonical licensed + unlicensed hires this month",
            icon: UserCheck,
            tone: "good",
            active: tab === "hired",
            onClick: () => switchTab("hired"),
          },
          {
            label: "Onboarding gaps",
            value: onboarding.data?.truth?.licensed_active_without_onboarding_call ?? null,
            detail: "Licensed hires still needing a booking",
            icon: Send,
            tone: "gold",
            active: tab === "onboarding",
            onClick: () => switchTab("onboarding"),
          },
        ]}
      />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px] xl:items-start">
      <aside className="order-1 space-y-4 xl:order-2 xl:sticky xl:top-4">
      {priorityCandidate && tab !== "hired" && tab !== "onboarding" && (
        <section aria-labelledby="priority-candidate" className="overflow-hidden rounded-2xl border border-[#C9A961]/35 bg-card text-foreground dark:bg-[#0A0A0A] dark:text-white shadow-[0_20px_55px_rgba(0,0,0,0.2)]">
          <div className="p-5">
            <div className="flex items-center justify-between gap-3">
              <p className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-[#C9A961]"><Zap className="h-3.5 w-3.5 fill-[#C9A961]" /> Work next</p>
              {priorityPool.length > 1 && <div className="flex items-center gap-1"><span className="mr-1 text-[10px] text-white/35">{safeFocusIndex + 1}/{priorityPool.length}</span><Button size="icon" variant="ghost" className="h-8 w-8 text-foreground hover:bg-white/10 hover:text-white" aria-label="Previous priority candidate" onClick={() => setFocusIndex((safeFocusIndex - 1 + priorityPool.length) % priorityPool.length)}><ArrowLeft className="h-4 w-4" /></Button><Button size="icon" variant="ghost" className="h-8 w-8 text-foreground hover:bg-white/10 hover:text-white" aria-label="Next priority candidate" onClick={() => setFocusIndex((safeFocusIndex + 1) % priorityPool.length)}><ArrowRight className="h-4 w-4" /></Button></div>}
            </div>
            <div className="mt-4 flex min-w-0 items-center gap-3">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-[#C9A961]/30 bg-[#C9A961]/10 text-base font-black text-[#C9A961]">{initials(priorityCandidate.name)}</span>
              <div className="min-w-0"><h2 id="priority-candidate" className="truncate text-lg font-black">{priorityCandidate.name || "Unnamed candidate"}</h2><p className="mt-0.5 truncate text-xs text-white/45">{priorityCandidate.phone || priorityCandidate.email || "Contact details missing"}</p></div>
            </div>
            <div className="mt-4 rounded-xl border border-border bg-white/[0.04] p-3">
              <p className="text-xs font-bold">{statusOf(priorityCandidate, now).label}</p><p className="mt-0.5 text-[11px] text-white/45">{statusOf(priorityCandidate, now).timing}</p>
              <div className="mt-3 grid grid-cols-4 gap-1" aria-label={`Interview progress: ${INTERVIEW_RAIL[interviewRailStep(priorityCandidate)]}`}>
                {INTERVIEW_RAIL.map((label, index) => <div key={label}><div className={`h-1 rounded-full ${index <= interviewRailStep(priorityCandidate) ? "bg-[#C9A961]" : "bg-foreground/10"}`} /><p className={`mt-1 truncate text-[8px] font-bold uppercase ${index <= interviewRailStep(priorityCandidate) ? "text-foreground/65" : "text-foreground/20"}`}>{label}</p></div>)}
              </div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              {phoneHref(priorityCandidate.phone) && <Button asChild className="h-11 bg-[#C9A961] font-bold text-black hover:bg-[#C9A961]/90"><a href={phoneHref(priorityCandidate.phone)!} {...contactLinkProps(phoneHref(priorityCandidate.phone))}><Phone className="h-4 w-4" /> Call</a></Button>}
              {smsHref(priorityCandidate.phone) && <Button asChild variant="outline" className="h-11 border-border bg-foreground/5 text-foreground hover:bg-white/10 hover:text-white"><a href={smsHref(priorityCandidate.phone)!} {...contactLinkProps(smsHref(priorityCandidate.phone))}><MessageSquare className="h-4 w-4" /> Text</a></Button>}
              {availableActions(priorityCandidate, pipeline.data?.role).length > 0 && <Button className="col-span-2 h-11 bg-card font-bold text-foreground hover:bg-white/90" onClick={() => chooseAction(priorityCandidate, availableActions(priorityCandidate, pipeline.data?.role)[0])}>{ACTION_LABEL[availableActions(priorityCandidate, pipeline.data?.role)[0]]} <ArrowRight className="h-4 w-4" /></Button>}
            </div>
            <p className="mt-3 text-center text-[9px] uppercase tracking-wide text-white/25">J / K moves through priority candidates</p>
          </div>
        </section>
      )}

      <section aria-labelledby="live-funnel-heading" className="rounded-2xl border border-border/80 bg-card p-4 shadow-sm">
        <div>
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary">Live recruiting pulse</p>
            <h2 id="live-funnel-heading" className="mt-1 text-lg font-black">Where the work is now</h2>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Tap a stage to open the exact people behind it.</p>
          </div>
          <div className="mt-4 grid min-w-0 grid-cols-2 gap-2">
            {operatingFunnel.map((item, index) => <button key={item.label} type="button" className="group rounded-xl border border-border/70 bg-muted/20 p-3 text-left transition-colors hover:border-primary/35 hover:bg-primary/5" onClick={() => switchTab(item.target)}>
              <div className="flex items-center justify-between gap-2"><span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{item.label}</span><span className="text-xl font-black tabular-nums">{pipeline.data ? item.value : "—"}</span></div>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted"><div className={`h-full rounded-full ${index === operatingFunnel.length - 1 ? "bg-success" : "bg-primary"}`} style={{ width: pipeline.data ? `${Math.max(item.value ? 8 : 0, Math.round((item.value / funnelPeak) * 100))}%` : "0%" }} /></div>
              <p className="mt-1.5 text-[10px] text-muted-foreground">{item.detail}</p>
            </button>)}
          </div>
        </div>
      </section>

      {shareUrl && (
        <div className="rounded-2xl border border-border/80 bg-card p-4 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-sm font-black"><Link2 className="h-4 w-4 text-primary" /> One-link candidate intake</p>
              <p className="mt-1 text-xs text-muted-foreground">Send it once. Their details, interview booking, and follow-up record land in this control room automatically.</p>
              <p className="mt-2 truncate font-mono text-[11px] text-muted-foreground">{shareUrl}</p>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button variant="outline" onClick={async () => {
                try {
                  await navigator.clipboard.writeText(shareUrl);
                  toast.success("Candidate link copied");
                } catch {
                  toast.error("Copy failed. Open the link and copy it from the address bar.");
                }
              }}><Copy className="h-4 w-4" /> Copy link</Button>
              <Button asChild><a href={shareUrl} target="_blank" rel="noopener noreferrer"><ExternalLink className="h-4 w-4" /> Open</a></Button>
            </div>
          </div>
        </div>
      )}

      </aside>
      <main className="order-2 min-w-0 space-y-4 xl:order-1">

      <div className="sticky top-2 z-20 flex flex-col gap-3 rounded-2xl border border-border/80 bg-background/90 p-3 shadow-lg backdrop-blur-xl lg:flex-row lg:items-center lg:justify-between">
        <div className="relative w-full lg:w-96">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={tab === "onboarding" || tab === "hired" ? "Search agent, phone, email, license, or stage" : "Search every candidate, phone, email, or Instagram"} className="h-11 rounded-xl border-border/80 bg-card pl-9 pr-10" aria-label="Search interviews" />
          <kbd className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded border border-border bg-muted px-1.5 py-0.5 text-[9px] font-bold text-muted-foreground">/</kbd>
        </div>
        {/* Wrap, never scroll: at 1500px the main column is ~800px wide and a scrolling strip hid Active hires / Onboarding / History with no affordance. */}
        <div className="flex max-w-full flex-wrap items-center gap-1.5">
          {tab !== "hired" && tab !== "onboarding" && <DropdownMenu>
            <DropdownMenuTrigger asChild><Button type="button" size="sm" variant="outline" className="h-11 shrink-0 rounded-xl"><SlidersHorizontal className="h-4 w-4" /> {SORT_LABEL[sortMode]} <ChevronDown className="h-3.5 w-3.5" /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="start">{(Object.entries(SORT_LABEL) as Array<[SortMode, string]>).map(([key, label]) => <DropdownMenuItem key={key} onSelect={() => setSortMode(key)}>{label}{sortMode === key && <CheckCircle2 className="ml-auto h-4 w-4 text-primary" />}</DropdownMenuItem>)}</DropdownMenuContent>
          </DropdownMenu>}
          {TABS.map(([key, label]) => (
            <Button key={key} type="button" size="sm" variant={tab === key ? "default" : "ghost"} onClick={() => switchTab(key)} aria-pressed={tab === key} className={`h-11 shrink-0 rounded-xl px-3 ${tab === key ? "shadow-md" : "text-muted-foreground"}`}>
              {label}
              <span className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] tabular-nums ${tab === key ? "bg-black/15" : "bg-muted"}`}>
                {key === "open" ? openAll.length : key === "overdue" ? overdue.length : key === "upcoming" ? upcoming.length : key === "hired" ? activeHires.length : key === "onboarding" ? onboardingWork : applicants.length}
              </span>
            </Button>
          ))}
        </div>
      </div>

      {tab !== "onboarding" && pipeline.isError && pipeline.data && (
        <div role="alert" className="rounded-lg border border-warning/30 bg-warning/5 p-3 text-sm text-warning">Refresh failed. Showing the last successful interview snapshot from {format(new Date(pipeline.data.generatedAt), "h:mm a")}. <button className="underline" onClick={() => pipeline.refetch()}>Retry</button></div>
      )}

      {tab === "onboarding" ? (
        renderOnboarding()
      ) : tab === "hired" ? (
        renderActiveHires()
      ) : pipeline.isLoading ? (
        // stable-key-allow:static-interview-skeleton — fixed five placeholders never reorder or hold state.
        <div className="space-y-2">{Array.from({ length: 5 }).map((_, index) => <div key={index} className="h-24 animate-pulse rounded-lg border border-border bg-muted/20" />)}</div>
      ) : pipeline.isError && !pipeline.data ? (
        <div role="alert" className="rounded-lg border border-destructive/30 p-8 text-center text-sm text-destructive">The interview queue is unavailable; no count above should be treated as zero. <button className="underline" onClick={() => pipeline.refetch()}>Retry</button></div>
      ) : filtered.length === 0 ? (
        <div role="status" className="rounded-lg border border-border p-10 text-center text-sm text-muted-foreground">{term ? `No interviews match “${query.trim()}”.` : "Nothing in this view. A booking appears here as soon as it enters the interview pipeline."}</div>
      ) : (
        <div className="space-y-6">
          {groups.map((group) => (
            <section key={group.key} aria-labelledby={`interview-group-${group.key}`}>
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <h2 id={`interview-group-${group.key}`} className={`text-base font-black ${group.danger ? "text-destructive" : "text-foreground"}`}>{group.title}</h2>
                <Badge variant="outline" className={group.danger ? "border-destructive/30 bg-destructive/5 text-destructive" : "border-primary/25 bg-primary/5 text-primary"}>{group.rows.length} waiting</Badge>
                <span className="text-xs text-muted-foreground">{group.sub}</span>
              </div>
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                {group.rows.slice(0, shownFor(group.key)).map((row) => {
                  const status = statusOf(row, now);
                  const actions = availableActions(row, pipeline.data?.role);
                  const instagram = instagramProfileLink(row.instagram);
                  const personName = row.name || "Unnamed";
                  const callHref = phoneHref(row.phone);
                  const textHref = smsHref(row.phone);
                  const applicationNeededForHire = pipeline.data?.role !== "va"
                    && !row.application_id
                    && (LEGAL_BY_STAGE[row.stage] ?? []).includes("hire");
                  const railStep = interviewRailStep(row);
                  return (
                    <article key={row.id} className={`group overflow-hidden rounded-2xl border bg-card shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-xl ${group.danger ? "border-destructive/25 hover:border-destructive/45" : "border-border/80 hover:border-[#C9A961]/35"}`}>
                      <div className={`h-1 ${group.danger ? "bg-gradient-to-r from-destructive via-destructive/60 to-transparent" : "bg-gradient-to-r from-[#C9A961] via-[#C9A961]/70 to-transparent"}`} />
                      <div className="p-4 sm:p-5">
                      <div className="flex min-w-0 items-start gap-3">
                        <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border text-sm font-black ${group.danger ? "border-destructive/20 bg-destructive/10 text-destructive" : "border-primary/20 bg-primary/10 text-primary"}`}>{initials(row.name)}</span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0"><p className="truncate text-base font-black">{personName}</p><p className="mt-0.5 truncate text-[11px] text-muted-foreground">{row.email || row.phone || "Contact details missing"}</p></div>
                            <Badge variant="outline" className={`shrink-0 ${group.danger ? "border-destructive/30 bg-destructive/5 text-destructive" : `${status.tone} border-border`}`}><span className={`mr-1.5 h-1.5 w-1.5 rounded-full ${status.dot}`} />{status.label}</Badge>
                          </div>
                          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                            {row.company && <span className="inline-flex items-center gap-1"><Building2 className="h-3 w-3" />{row.company}</span>}
                            {instagram && <a href={instagram.href} target="_blank" rel="noopener noreferrer" onClick={(event) => event.stopPropagation()} aria-label={`Open @${instagram.handle} on Instagram`} title={`Open @${instagram.handle} on Instagram`} className="inline-flex items-center gap-1 rounded-full border border-pink-500/30 bg-pink-500/10 px-2 py-0.5 font-semibold text-pink-400 transition-colors hover:bg-pink-500/20 hover:underline"><Instagram className="h-3 w-3 shrink-0" />@{instagram.handle}</a>}
                            {(row.recruiter_name || row.va_name) && <span>Owner · {row.recruiter_name || row.va_name}</span>}
                            {row.identity_conflict && <Badge variant="outline" className="border-destructive/30 text-[10px] text-destructive">Identity conflict</Badge>}
                          </div>
                        </div>
                      </div>

                      {row.notes && <div className="mt-3 rounded-lg border border-border/60 bg-background/35 px-3 py-2"><p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground"><span className="font-bold text-foreground">Latest context · </span>{row.notes}</p></div>}

                      <div className="mt-4 rounded-xl border border-border/70 bg-muted/20 p-3">
                        <div className="flex items-center justify-between gap-3"><p className="text-[9px] font-bold uppercase tracking-[0.16em] text-muted-foreground">Current mission</p><p className={`text-xs font-bold ${status.tone}`}>{status.timing}</p></div>
                        <div className="mt-3 grid grid-cols-4 gap-1.5" aria-label={`Interview progress: ${INTERVIEW_RAIL[railStep]}`}>
                          {INTERVIEW_RAIL.map((label, index) => <div key={label}><div className={`h-1.5 rounded-full ${index <= railStep ? group.danger ? "bg-destructive" : "bg-[#C9A961]" : "bg-muted"}`} /><p className={`mt-1.5 truncate text-[9px] font-bold uppercase tracking-wide ${index <= railStep ? "text-foreground" : "text-muted-foreground/55"}`}>{label}</p></div>)}
                        </div>
                      </div>

                      <div className="mt-4 flex flex-wrap items-center gap-2">
                        {callHref && <Button asChild size="icon" aria-label={`Call ${personName}`} className="h-11 w-11 sm:h-9 sm:w-9"><a href={callHref} {...contactLinkProps(callHref)}><Phone className="h-4 w-4" /></a></Button>}
                        {textHref && <Button asChild size="icon" variant="outline" aria-label={`Text ${personName}`} className="h-11 w-11 sm:h-9 sm:w-9"><a href={textHref} {...contactLinkProps(textHref)}><MessageSquare className="h-4 w-4" /></a></Button>}
                        {row.email && <Button asChild size="icon" variant="outline" aria-label={`Email ${personName}`} className="h-11 w-11 sm:h-9 sm:w-9"><a href={`mailto:${row.email}`}><Mail className="h-4 w-4" /></a></Button>}
                        {instagram && <Button asChild size="icon" variant="outline" aria-label={`Open Instagram for ${personName}`} title={`Open @${instagram.handle} on Instagram`} className="h-11 w-11 border-pink-500/30 text-pink-400 hover:bg-pink-500/10 hover:text-pink-400 sm:h-9 sm:w-9"><a href={instagram.href} target="_blank" rel="noopener noreferrer" onClick={(event) => event.stopPropagation()}><Instagram className="h-4 w-4" /></a></Button>}
                        <div className="min-w-0 flex-1" />
                        {row.stage === "hired" && row.application_id ? (
                          row.onboarding_status === "ready_to_promote" ? (
                            <Button size="sm" variant="outline" className="h-11 sm:h-9" onClick={() => choosePromotion(row)}><UserCheck className="h-4 w-4" /> Start onboarding</Button>
                          ) : (
                            <PromoteApplicantButton applicationId={row.application_id} applicantName={row.name ?? undefined} label="Open agent" />
                          )
                        ) : actions.length ? (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild><Button className="h-11 min-w-[138px] gap-1.5 font-bold sm:h-9">{actionPrompt(row)} <ChevronDown className="h-4 w-4" /></Button></DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              {actions.map((action) => <DropdownMenuItem key={action} onSelect={() => chooseAction(row, action)}>{ACTION_LABEL[action]}</DropdownMenuItem>)}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        ) : null}
                        {applicationNeededForHire && <Badge variant="outline" className="border-warning/30 text-warning">Application link needed to hire</Badge>}
                        {row.stage === "hired" && !row.application_id && <Badge variant="outline" className="border-warning/30 text-warning">Application link needed</Badge>}
                      </div>
                      </div>
                    </article>
                  );
                })}
              </div>
              {group.rows.length > shownFor(group.key) && (
                <div className="mt-3 flex justify-center">
                  <Button type="button" variant="outline" size="sm" onClick={() => showMore(group.key)}>
                    Show {Math.min(12, group.rows.length - shownFor(group.key))} more · {group.rows.length - shownFor(group.key)} hidden
                  </Button>
                </div>
              )}
            </section>
          ))}
        </div>
      )}

      </main>
      </div>

      <Dialog open={Boolean(pending)} onOpenChange={(open) => { if (!open && !saving) setPending(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{pending ? PENDING_ACTION_LABEL[pending.action] : "Update interview"}</DialogTitle>
            <DialogDescription>{pending?.row.name || "Candidate"} · {pending?.action === "promote" ? "this creates or opens the canonical agent account and starts the correct onboarding path." : "this writes the decision to the shared interview record and activity history."}</DialogDescription>
          </DialogHeader>
          {pending?.action === "reschedule" && <div className="space-y-2"><Label htmlFor="interview-reschedule-at">New appointment time</Label><Input id="interview-reschedule-at" type="datetime-local" min={format(new Date(), "yyyy-MM-dd'T'HH:mm")} value={appointmentAt} onChange={(event) => setAppointmentAt(event.target.value)} /></div>}
          {pending?.action === "unqualified" && <div className="space-y-2"><Label htmlFor="interview-unqualified-reason">Reason</Label><Textarea id="interview-unqualified-reason" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Why this candidate is not qualified" /></div>}
          {(pending?.action === "hire" || pending?.action === "promote") && <div className="space-y-3 rounded-lg border border-success/30 bg-success/5 p-3 text-sm"><div><p className="flex items-center gap-2 font-semibold text-success"><UserCheck className="h-4 w-4" /> {pending.action === "hire" ? "Hire and start onboarding" : "Start onboarding"}</p><p className="mt-1 text-muted-foreground">Saving creates the agent account and automatically starts the correct contracting or licensing path.</p></div>{pending.row.application_license_status === "licensed" && <div className="space-y-1.5"><Label htmlFor="interview-hire-npn">NPN *</Label><Input id="interview-hire-npn" inputMode="numeric" maxLength={10} value={hireNpn} onChange={(event) => setHireNpn(event.target.value.replace(/\D+/g, "").slice(0, 10))} placeholder="5–10 digit NPN" /><p className="text-xs text-muted-foreground">Format is checked here; registry verification remains a separate NIPR receipt.</p></div>}</div>}
          {pending?.action === "not_hired" && <p className="flex items-center gap-2 text-sm text-muted-foreground"><UserX className="h-4 w-4" /> The candidate remains in history and can be reopened.</p>}
          {pending?.action === "reopen" && <p className="flex items-center gap-2 text-sm text-muted-foreground"><RotateCcw className="h-4 w-4" /> This returns the interview to Confirmed with its outcome pending.</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPending(null)} disabled={saving}>Cancel</Button>
            <Button onClick={() => void saveAction()} disabled={saving || (pending?.action === "reschedule" && (!appointmentAt || new Date(appointmentAt).getTime() <= Date.now())) || (pending?.action === "unqualified" && !reason.trim()) || ((pending?.action === "hire" || pending?.action === "promote") && pending.row.application_license_status === "licensed" && !/^\d{5,10}$/.test(hireNpn))}>
              {saving ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />} Save with receipt
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
