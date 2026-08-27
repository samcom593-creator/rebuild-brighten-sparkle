import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, isPast, differenceInCalendarDays } from "date-fns";
import {
  Building2, CalendarClock, CheckCircle2, ChevronDown, Instagram, Mail,
  MessageSquare, Phone, RefreshCw, RotateCcw, Search, UserCheck, UserX,
  Copy, ExternalLink, Link2, Send,
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
import { phoneHref, smsHref } from "@/lib/phone";
import { instagramProfileLink } from "@/lib/instagram";
import { promoteApplicationToAgent } from "@/lib/hireToOnboarding";
import { resolveBrand } from "@/config/brand";
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

function availableActions(row: Applicant, role: ActorRole | undefined) {
  // A terminal hire without an application cannot create the canonical agent
  // account. Keep the interview actionable, but never offer a half-hire that
  // strands onboarding. Staff can repair the identity/application link first.
  const actions = (LEGAL_BY_STAGE[row.stage] ?? []).filter((action) => action !== "hire" || Boolean(row.application_id));
  return role === "va" ? actions.filter((action) => VA_ACTIONS.has(action)) : actions;
}

function externalLinkProps(href: string | null) {
  return href?.startsWith("https://")
    ? { target: "_blank" as const, rel: "noopener noreferrer" }
    : {};
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
  if (row.stage === "rescheduled") return { tone: "text-warning", dot: "bg-warning", label: "Rescheduled", timing: appointment ? format(appointment, "EEE MMM d · h:mma") : "set a new time" };
  if (appointment && isPast(appointment) && OPEN.includes(row.stage)) {
    const days = Math.abs(differenceInCalendarDays(now, appointment));
    return { tone: "text-destructive", dot: "bg-destructive", label: "Overdue", timing: `${days} day${days === 1 ? "" : "s"} · needs action` };
  }
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
  const [sendingGap, setSendingGap] = useState<string | null>(null);
  const [pending, setPending] = useState<{ row: Applicant; action: PendingAction } | null>(null);
  const [appointmentAt, setAppointmentAt] = useState("");
  const [reason, setReason] = useState("");
  const [hireNpn, setHireNpn] = useState("");
  const [saving, setSaving] = useState(false);

  const pipeline = useQuery<PipelineResponse>({
    queryKey: ["interviews-pipeline"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("interviews-pipeline");
      if (error) throw error;
      return data as PipelineResponse;
    },
    staleTime: 60_000,
    refetchInterval: 60_000,
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
    refetchInterval: 60_000,
  });
  const onboardingUpcoming = onboarding.data?.calls.filter((call) => call.bucket === "upcoming").length ?? 0;

  const sendBookingLink = async (gap: OnboardingGap) => {
    setSendingGap(gap.agent_id);
    try {
      const { data, error } = await supabase.rpc("admin_enqueue_onboarding_call" as never, { p_agent_id: gap.agent_id } as never);
      if (error) throw error;
      const receipt = data as unknown as { enqueued: boolean; reason: string };
      if (receipt.enqueued) toast.success(`Booking link queued for ${gap.display_name ?? "agent"} · goes out at the 9:30 AM Central send`);
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
  const filtered = term
    ? source.filter((row) => [row.name, row.company, row.email, row.phone, row.instagram].some((value) => (value ?? "").toLowerCase().includes(term)))
    : source;
  const groups = useMemo(() => [
    { key: "overdue", title: "Overdue", sub: "appointment passed, still open", danger: true, rows: filtered.filter((row) => row.appointment_at && isPast(new Date(row.appointment_at)) && OPEN.includes(row.stage) && row.stage !== "interview_complete") },
    { key: "upcoming", title: "Upcoming", sub: "confirmed and scheduled", rows: filtered.filter((row) => row.appointment_at && !isPast(new Date(row.appointment_at)) && OPEN.includes(row.stage)) },
    { key: "other", title: "Needs a decision or time", sub: "interviewed, unscheduled, or closed", rows: filtered.filter((row) => !((row.appointment_at && isPast(new Date(row.appointment_at)) && OPEN.includes(row.stage) && row.stage !== "interview_complete") || (row.appointment_at && !isPast(new Date(row.appointment_at)) && OPEN.includes(row.stage)))) },
  ].filter((group) => group.rows.length > 0), [filtered]);

  // Reloads and shared links keep the view: ?tab= is already honored on load,
  // so switching writes it back without adding history entries.
  const switchTab = (next: Tab) => {
    setTab(next);
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
                      {callHref && <Button asChild size="icon" aria-label={`Call ${name}`} className="h-11 w-11 sm:h-9 sm:w-9"><a href={callHref} {...externalLinkProps(callHref)}><Phone className="h-4 w-4" /></a></Button>}
                      {textHref && <Button asChild size="icon" variant="outline" aria-label={`Text ${name}`} className="h-11 w-11 sm:h-9 sm:w-9"><a href={textHref} {...externalLinkProps(textHref)}><MessageSquare className="h-4 w-4" /></a></Button>}
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

  const renderActiveHires = () => {
    if (pipeline.isLoading) {
      // stable-key-allow:static-active-hire-skeleton — fixed placeholders never reorder or hold state.
      return <div className="space-y-2">{Array.from({ length: 4 }).map((_, index) => <div key={index} className="h-24 animate-pulse rounded-xl border border-border bg-muted/20" />)}</div>;
    }
    if (!pipeline.data) {
      return <div role="alert" className="rounded-xl border border-destructive/30 p-8 text-center text-sm text-destructive">The canonical hire roster is unavailable; no hire count should be read as zero. <button className="underline" onClick={() => pipeline.refetch()}>Retry</button></div>;
    }
    const visibleHires = term
      ? activeHires.filter((hire) => [hire.display_name, hire.email, hire.phone, hire.license_status, hire.onboarding_stage].some((value) => (value ?? "").toLowerCase().includes(term)))
      : activeHires;
    if (!visibleHires.length) {
      return <div role="status" className="rounded-xl border border-border p-10 text-center text-sm text-muted-foreground">{term ? `No active hires match “${query.trim()}”.` : "No canonical active hires have been added this month."}</div>;
    }
    return (
      <section aria-labelledby="active-hires-heading" className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 id="active-hires-heading" className="text-base font-black">Active hires · this month</h2>
            <p className="text-xs text-muted-foreground">Licensed and unlicensed hires from the canonical team roster, including Add Agent and one-link intake.</p>
          </div>
          <Badge variant="outline" className="border-success/30 bg-success/5 text-success">{visibleHires.length} people</Badge>
        </div>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {visibleHires.map((hire) => {
            const callHref = phoneHref(hire.phone);
            const textHref = smsHref(hire.phone);
            const stage = (hire.onboarding_stage ?? "onboarding").replace(/_/g, " ");
            return (
              <article key={hire.agent_id} className="rounded-xl border border-border bg-card p-4 shadow-sm transition-colors hover:border-primary/30">
                <div className="flex items-start gap-3">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-success/20 bg-success/10 text-sm font-black text-success">{initials(hire.display_name)}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate font-bold">{hire.display_name}</p>
                      <Badge variant="outline" className={hire.license_status === "licensed" ? "border-success/30 text-success" : "border-warning/30 text-warning"}>{hire.license_status}</Badge>
                    </div>
                    <p className="mt-1 text-xs capitalize text-muted-foreground">Next · {stage} · hired {format(new Date(hire.hired_at), "MMM d")}</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {callHref && <Button asChild size="icon" aria-label={`Call ${hire.display_name}`} className="h-10 w-10"><a href={callHref}><Phone className="h-4 w-4" /></a></Button>}
                      {textHref && <Button asChild size="icon" variant="outline" aria-label={`Text ${hire.display_name}`} className="h-10 w-10"><a href={textHref}><MessageSquare className="h-4 w-4" /></a></Button>}
                      {hire.email && <Button asChild size="icon" variant="outline" aria-label={`Email ${hire.display_name}`} className="h-10 w-10"><a href={`mailto:${hire.email}`}><Mail className="h-4 w-4" /></a></Button>}
                      <Button asChild size="sm" variant="outline" className="h-10"><a href={`/dashboard/profile?agentId=${hire.agent_id}`}><ExternalLink className="h-4 w-4" /> Open profile</a></Button>
                    </div>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </section>
    );
  };

  const activeGeneratedAt = tab === "onboarding" ? onboarding.data?.generatedAt : pipeline.data?.generatedAt;
  const refreshing = tab === "onboarding" ? onboarding.isFetching : pipeline.isFetching;
  const refreshActiveTab = () => {
    if (tab === "onboarding") void onboarding.refetch();
    else void pipeline.refetch();
  };

  return (
    <div className="page-enter mx-auto w-full max-w-6xl space-y-5 px-4 pb-24 sm:px-6">
      <RecruitingWorkspaceNav />
      <RecruitingCommandHero
        eyebrow="Recruiting · Interview command"
        title="Turn every booked call into a decision."
        subtitle="See what is next, recover what slipped, record the outcome, and launch a hire into onboarding without leaving this workspace."
        statusLabel={pipeline.isError ? "Last good snapshot" : "Live interview queue"}
        updatedLabel={activeGeneratedAt ? format(new Date(activeGeneratedAt), "h:mm a") : null}
        actions={
          <Button size="sm" variant="outline" className="h-10 border-white/15 bg-white/[0.04] text-white hover:bg-white/10 hover:text-white" onClick={refreshActiveTab} disabled={refreshing}>
            <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} /> Refresh queue
          </Button>
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

      {shareUrl && (
        <div className="rounded-lg border border-primary/30 bg-primary/5 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-sm font-semibold"><Link2 className="h-4 w-4 text-primary" /> Candidate booking link</p>
              <p className="mt-1 text-xs text-muted-foreground">Send one link. The candidate enters their details, lands in this queue, and receives an email confirmation when delivery succeeds.</p>
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

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:w-80">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={tab === "onboarding" || tab === "hired" ? "Search agent, phone, email, license, or stage" : "Search name, company, Instagram, phone, or email"} className="h-11 pl-8 sm:h-9" aria-label="Search interviews" />
        </div>
        <div className="flex max-w-full gap-1.5 overflow-x-auto rounded-xl border border-border bg-card/70 p-1.5 shadow-sm">
          {TABS.map(([key, label]) => (
            <Button key={key} type="button" size="sm" variant={tab === key ? "default" : "outline"} onClick={() => switchTab(key)} aria-pressed={tab === key} className="h-11 shrink-0 sm:h-9">
              {label}{key === "overdue" && overdue.length ? ` ${overdue.length}` : ""}{key === "onboarding" && onboardingUpcoming ? ` ${onboardingUpcoming}` : ""}
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
              <div className="space-y-2.5">
                {group.rows.map((row) => {
                  const status = statusOf(row, now);
                  const actions = availableActions(row, pipeline.data?.role);
                  const instagram = instagramProfileLink(row.instagram);
                  const personName = row.name || "Unnamed";
                  const callHref = phoneHref(row.phone);
                  const textHref = smsHref(row.phone);
                  const applicationNeededForHire = pipeline.data?.role !== "va"
                    && !row.application_id
                    && (LEGAL_BY_STAGE[row.stage] ?? []).includes("hire");
                  return (
                    <div key={row.id} className="group grid grid-cols-1 gap-3 rounded-xl border border-border bg-gradient-to-r from-card to-card/70 p-3.5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md sm:p-4 md:grid-cols-[185px_minmax(0,1fr)_auto] md:items-center">
                      <div className="rounded-lg border border-border/70 bg-background/45 p-3 text-xs">
                        <p className={`inline-flex items-center gap-1.5 font-semibold ${status.tone}`}><span className={`h-2 w-2 rounded-full ${status.dot}`} />{status.label}</p>
                        <p className="mt-1.5 leading-relaxed text-muted-foreground">{status.timing}</p>
                      </div>
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-sm font-black text-primary">{initials(row.name)}</span>
                        <div className="min-w-0">
                          <p className="truncate text-base font-bold">{personName}</p>
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                            {row.company && <span className="inline-flex items-center gap-1"><Building2 className="h-3 w-3" />{row.company}</span>}
                            {instagram && (
                              <a
                                href={instagram.href}
                                target="_blank"
                                rel="noopener noreferrer"
                                aria-label={`Open @${instagram.handle} on Instagram`}
                                className="inline-flex items-center gap-1 transition-colors hover:text-foreground hover:underline"
                              >
                                <Instagram className="h-3 w-3" />@{instagram.handle}
                              </a>
                            )}
                            {row.va_name && <span>Owner · {row.va_name}</span>}
                            {row.identity_conflict && <Badge variant="outline" className="border-destructive/30 text-[10px] text-destructive">Identity conflict · review</Badge>}
                            <Badge variant="outline" className="text-[10px]">{STAGE_META[row.stage]?.label ?? row.stage}</Badge>
                          </div>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 md:justify-end">
                        {callHref && <Button asChild size="icon" aria-label={`Call ${personName}`} className="h-11 w-11 sm:h-9 sm:w-9"><a href={callHref} {...externalLinkProps(callHref)}><Phone className="h-4 w-4" /></a></Button>}
                        {textHref && <Button asChild size="icon" variant="outline" aria-label={`Text ${personName}`} className="h-11 w-11 sm:h-9 sm:w-9"><a href={textHref} {...externalLinkProps(textHref)}><MessageSquare className="h-4 w-4" /></a></Button>}
                        {row.email && <Button asChild size="icon" variant="outline" aria-label={`Email ${personName}`} className="h-11 w-11 sm:h-9 sm:w-9"><a href={`mailto:${row.email}`}><Mail className="h-4 w-4" /></a></Button>}
                        {row.stage === "hired" && row.application_id ? (
                          row.onboarding_status === "ready_to_promote" ? (
                            <Button size="sm" variant="outline" className="h-11 sm:h-9" onClick={() => choosePromotion(row)}><UserCheck className="h-4 w-4" /> Start onboarding</Button>
                          ) : (
                            <PromoteApplicantButton applicationId={row.application_id} applicantName={row.name ?? undefined} label="Open agent" />
                          )
                        ) : actions.length ? (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild><Button className="h-11 gap-1.5 sm:h-9">{actionPrompt(row)} <ChevronDown className="h-4 w-4" /></Button></DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              {actions.map((action) => <DropdownMenuItem key={action} onSelect={() => chooseAction(row, action)}>{ACTION_LABEL[action]}</DropdownMenuItem>)}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        ) : null}
                        {applicationNeededForHire && <Badge variant="outline" className="border-warning/30 text-warning">Application link needed to hire</Badge>}
                        {row.stage === "hired" && !row.application_id && <Badge variant="outline" className="border-warning/30 text-warning">Application link needed</Badge>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}

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
