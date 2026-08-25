import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, isPast, differenceInCalendarDays } from "date-fns";
import {
  Building2, CalendarClock, CheckCircle2, ChevronDown, Instagram, Mail,
  MessageSquare, Phone, RefreshCw, RotateCcw, Search, UserCheck, UserX,
  Copy, ExternalLink, Link2,
} from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { RecruitingWorkspaceNav } from "@/components/recruiting/RecruitingWorkspaceNav";
import { PromoteApplicantButton } from "@/components/applicants/PromoteApplicantButton";
import { phoneHref, smsHref } from "@/lib/phone";
import { promoteApplicationToAgent } from "@/lib/hireToOnboarding";

type ActorRole = "executive" | "recruiter" | "va";
type InterviewAction =
  | "confirm" | "qualified" | "follow_up" | "hire" | "not_hired"
  | "unqualified" | "no_show" | "reschedule" | "cancel" | "reopen";
type Applicant = {
  id: string; name: string | null; phone: string | null; email: string | null;
  instagram: string | null; company: string | null; appointment_at: string | null;
  stage: string; interview_result: string | null; unqualified_reason: string | null;
  notes: string | null; reschedule_count: number | null; va_name: string | null;
  recruiter_name: string | null; version: number; created_at: string | null; updated_at: string | null;
  application_id: string | null; onboarding_status: string;
  application_license_status: string | null; application_npn: string | null;
};
type PipelineResponse = {
  applicants: Applicant[]; counts: Record<string, number>; total: number;
  role: ActorRole; generatedAt: string;
};

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

function initials(name: string | null) {
  if (!name) return "?";
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("");
}

function availableActions(row: Applicant, role: ActorRole | undefined) {
  const actions = LEGAL_BY_STAGE[row.stage] ?? [];
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
    const context = (error as { context?: Response }).context;
    if (context) {
      // empty-catch-allow:http-error-body — original functions error remains the fallback message.
      const payload = await context.clone().json().catch(() => null) as { error?: string } | null;
      message = payload?.error || message;
    }
    throw new Error(message);
  }
  if (data?.error) throw new Error(data.error);
  return data as { receipt: { persistedAt: string; warning: string | null } };
}

export default function Interviews() {
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<"open" | "overdue" | "upcoming" | "all">("open");
  const [pending, setPending] = useState<{ row: Applicant; action: InterviewAction } | null>(null);
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

  const now = new Date();
  const applicants = pipeline.data?.applicants ?? [];
  const overdue = applicants.filter((row) => row.appointment_at && isPast(new Date(row.appointment_at)) && OPEN.includes(row.stage) && row.stage !== "interview_complete");
  const upcoming = applicants.filter((row) => row.appointment_at && !isPast(new Date(row.appointment_at)) && OPEN.includes(row.stage));
  const openAll = applicants.filter((row) => OPEN.includes(row.stage));
  const needsDecision = applicants.filter((row) => row.stage === "interview_complete").length;
  const source = tab === "overdue" ? overdue : tab === "upcoming" ? upcoming : tab === "all" ? applicants : openAll;
  const term = query.trim().toLowerCase();
  const filtered = term
    ? source.filter((row) => [row.name, row.company, row.email, row.phone, row.instagram].some((value) => (value ?? "").toLowerCase().includes(term)))
    : source;
  const groups = useMemo(() => [
    { key: "overdue", title: "Overdue", sub: "appointment passed, still open", danger: true, rows: filtered.filter((row) => row.appointment_at && isPast(new Date(row.appointment_at)) && OPEN.includes(row.stage) && row.stage !== "interview_complete") },
    { key: "upcoming", title: "Upcoming", sub: "confirmed and scheduled", rows: filtered.filter((row) => row.appointment_at && !isPast(new Date(row.appointment_at)) && OPEN.includes(row.stage)) },
    { key: "other", title: "Needs a decision or time", sub: "interviewed, unscheduled, or closed", rows: filtered.filter((row) => !((row.appointment_at && isPast(new Date(row.appointment_at)) && OPEN.includes(row.stage) && row.stage !== "interview_complete") || (row.appointment_at && !isPast(new Date(row.appointment_at)) && OPEN.includes(row.stage)))) },
  ].filter((group) => group.rows.length > 0), [filtered]);

  const chooseAction = (row: Applicant, action: InterviewAction) => {
    setPending({ row, action });
    setAppointmentAt("");
    setReason("");
    setHireNpn(row.application_npn ?? "");
  };
  const saveAction = async () => {
    if (!pending) return;
    setSaving(true);
    try {
      const selected = pending;
      const result = await invokeAction(selected.row, selected.action, appointmentAt, reason);
      const receiptTime = format(new Date(result.receipt.persistedAt), "h:mm a");
      if (result.receipt.warning) toast.warning(result.receipt.warning);
      else toast.success(`${ACTION_LABEL[selected.action]} saved · ${receiptTime}`);

      // "Hire" is the action, not the first half of a two-click workflow.
      // Immediately create the canonical account and let add-agent start the
      // correct licensed/unlicensed onboarding path.
      if (selected.action === "hire") {
        if (!selected.row.application_id) {
          toast.warning("Hire saved, but no matching APEX application exists. Add the person with Add Agent to start onboarding.");
        } else {
          const hire = await promoteApplicationToAgent(selected.row.application_id, { npn: hireNpn });
          if (hire.partial) toast.warning(hire.message);
          else toast.success("Agent account created · onboarding started");
        }
      }
      setPending(null);
      await pipeline.refetch();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Interview update failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page-enter mx-auto w-full max-w-6xl space-y-5 px-4 pb-24 sm:px-6">
      <RecruitingWorkspaceNav />
      <PageHeader
        eyebrow="Recruiting · Interviews"
        eyebrowIcon={<CalendarClock className="h-3 w-3" />}
        title="Interviews"
        subtitle={<>One queue from appointment to decision{pipeline.data && <> · updated {format(new Date(pipeline.data.generatedAt), "h:mm a")}</>}</>}
        actions={<Button size="sm" variant="outline" onClick={() => pipeline.refetch()} disabled={pipeline.isFetching}><RefreshCw className={`h-4 w-4 ${pipeline.isFetching ? "animate-spin" : ""}`} /> Refresh</Button>}
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {[
          { label: "Needs attention", value: overdue.length + needsDecision, detail: `${overdue.length} overdue · ${needsDecision} decisions`, tone: "text-destructive" },
          { label: "Upcoming", value: upcoming.length, detail: "scheduled ahead", tone: "text-primary" },
          { label: "Hired", value: pipeline.data?.counts.hired ?? 0, detail: "onboarding handoff", tone: "text-success" },
        ].map((item) => <div key={item.label} className="rounded-lg border border-border bg-card p-4"><p className={`text-3xl font-bold tabular-nums ${item.tone}`}>{item.value.toLocaleString()}</p><p className="mt-1 text-sm font-semibold">{item.label}</p><p className="text-xs text-muted-foreground">{item.detail}</p></div>)}
      </div>

      {shareUrl && (
        <div className="rounded-lg border border-primary/30 bg-primary/5 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-sm font-semibold"><Link2 className="h-4 w-4 text-primary" /> Candidate booking link</p>
              <p className="mt-1 text-xs text-muted-foreground">Send one link. The candidate enters their details, lands in this queue, and receives an email confirmation when delivery succeeds.</p>
              <p className="mt-2 truncate font-mono text-[11px] text-muted-foreground">{shareUrl}</p>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button variant="outline" onClick={async () => { await navigator.clipboard.writeText(shareUrl); toast.success("Candidate link copied"); }}><Copy className="h-4 w-4" /> Copy link</Button>
              <Button asChild><a href={shareUrl} target="_blank" rel="noopener noreferrer"><ExternalLink className="h-4 w-4" /> Open</a></Button>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:w-80">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name, company, phone, or email" className="h-11 pl-8 sm:h-9" aria-label="Search interviews" />
        </div>
        <div className="flex max-w-full gap-1.5 overflow-x-auto pb-1">
          {([['open', 'Open'], ['overdue', 'Overdue'], ['upcoming', 'Upcoming'], ['all', 'All']] as const).map(([key, label]) => (
            <Button key={key} type="button" size="sm" variant={tab === key ? "default" : "outline"} onClick={() => setTab(key)} aria-pressed={tab === key} className="h-11 shrink-0 sm:h-9">
              {label}{key === "overdue" && overdue.length ? ` ${overdue.length}` : ""}
            </Button>
          ))}
        </div>
      </div>

      {pipeline.isLoading ? (
        // stable-key-allow:static-interview-skeleton — fixed five placeholders never reorder or hold state.
        <div className="space-y-2">{Array.from({ length: 5 }).map((_, index) => <div key={index} className="h-24 animate-pulse rounded-lg border border-border bg-muted/20" />)}</div>
      ) : pipeline.isError ? (
        <div className="rounded-lg border border-destructive/30 p-8 text-center text-sm text-destructive">The interview queue is unavailable; no count above should be treated as zero. <button className="underline" onClick={() => pipeline.refetch()}>Retry</button></div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-border p-10 text-center text-sm text-muted-foreground">Nothing in this view. A booking appears here as soon as it enters the interview pipeline.</div>
      ) : (
        <div className="space-y-6">
          {groups.map((group) => (
            <section key={group.key} aria-labelledby={`interview-group-${group.key}`}>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <h2 id={`interview-group-${group.key}`} className={`text-sm font-bold ${group.danger ? "text-destructive" : "text-foreground"}`}>{group.title}</h2>
                <span className="text-xs text-muted-foreground">{group.sub}</span>
                <Badge variant="outline">{group.rows.length} waiting</Badge>
              </div>
              <div className="overflow-hidden rounded-lg border border-border bg-card">
                {group.rows.map((row, index) => {
                  const status = statusOf(row, now);
                  const actions = availableActions(row, pipeline.data?.role);
                  return (
                    <div key={row.id} className={`grid grid-cols-1 gap-3 p-4 md:grid-cols-[175px_minmax(0,1fr)_auto] md:items-center ${index ? "border-t border-border" : ""}`}>
                      <div className="text-xs">
                        <p className={`inline-flex items-center gap-1.5 font-semibold ${status.tone}`}><span className={`h-2 w-2 rounded-full ${status.dot}`} />{status.label}</p>
                        <p className="mt-1 text-muted-foreground">{status.timing}</p>
                      </div>
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">{initials(row.name)}</span>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold">{row.name || "Unnamed"}</p>
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                            {row.company && <span className="inline-flex items-center gap-1"><Building2 className="h-3 w-3" />{row.company}</span>}
                            {row.instagram && <span className="inline-flex items-center gap-1"><Instagram className="h-3 w-3" />{row.instagram.replace(/^@?/, "@")}</span>}
                            {row.va_name && <span>Owner · {row.va_name}</span>}
                            <Badge variant="outline" className="text-[10px]">{STAGE_META[row.stage]?.label ?? row.stage}</Badge>
                          </div>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 md:justify-end">
                        {phoneHref(row.phone) && <Button asChild size="icon" aria-label={`Call ${row.name}`} className="h-11 w-11 sm:h-9 sm:w-9"><a href={phoneHref(row.phone)!} target={phoneHref(row.phone)!.startsWith("https://") ? "_blank" : undefined} rel={phoneHref(row.phone)!.startsWith("https://") ? "noopener noreferrer" : undefined}><Phone className="h-4 w-4" /></a></Button>}
                        {smsHref(row.phone) && <Button asChild size="icon" variant="outline" aria-label={`Text ${row.name}`} className="h-11 w-11 sm:h-9 sm:w-9"><a href={smsHref(row.phone)!} target={smsHref(row.phone)!.startsWith("https://") ? "_blank" : undefined} rel={smsHref(row.phone)!.startsWith("https://") ? "noopener noreferrer" : undefined}><MessageSquare className="h-4 w-4" /></a></Button>}
                        {row.email && <Button asChild size="icon" variant="outline" aria-label={`Email ${row.name}`} className="h-11 w-11 sm:h-9 sm:w-9"><a href={`mailto:${row.email}`}><Mail className="h-4 w-4" /></a></Button>}
                        {row.stage === "hired" && row.application_id ? (
                          <PromoteApplicantButton
                            applicationId={row.application_id}
                            applicantName={row.name ?? undefined}
                            label={row.onboarding_status === "ready_to_promote" ? "Start onboarding" : "Open agent"}
                          />
                        ) : actions.length ? (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild><Button className="h-11 gap-1.5 sm:h-9">{actionPrompt(row)} <ChevronDown className="h-4 w-4" /></Button></DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              {actions.map((action) => <DropdownMenuItem key={action} onSelect={() => chooseAction(row, action)}>{ACTION_LABEL[action]}</DropdownMenuItem>)}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        ) : null}
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
            <DialogTitle>{pending ? ACTION_LABEL[pending.action] : "Update interview"}</DialogTitle>
            <DialogDescription>{pending?.row.name} · this writes the decision to the shared interview record and activity history.</DialogDescription>
          </DialogHeader>
          {pending?.action === "reschedule" && <div className="space-y-2"><Label htmlFor="interview-reschedule-at">New appointment time</Label><Input id="interview-reschedule-at" type="datetime-local" value={appointmentAt} onChange={(event) => setAppointmentAt(event.target.value)} /></div>}
          {pending?.action === "unqualified" && <div className="space-y-2"><Label htmlFor="interview-unqualified-reason">Reason</Label><Textarea id="interview-unqualified-reason" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Why this candidate is not qualified" /></div>}
          {pending?.action === "hire" && <div className="space-y-3 rounded-lg border border-success/30 bg-success/5 p-3 text-sm"><div><p className="flex items-center gap-2 font-semibold text-success"><UserCheck className="h-4 w-4" /> Hire and start onboarding</p><p className="mt-1 text-muted-foreground">Saving creates the agent account and automatically starts the correct contracting or licensing path.</p></div>{pending.row.application_license_status === "licensed" && <div className="space-y-1.5"><Label htmlFor="interview-hire-npn">NPN *</Label><Input id="interview-hire-npn" inputMode="numeric" value={hireNpn} onChange={(event) => setHireNpn(event.target.value)} placeholder="5–10 digit NPN" /><p className="text-xs text-muted-foreground">Required to start contracting without a broken handoff.</p></div>}</div>}
          {pending?.action === "not_hired" && <p className="flex items-center gap-2 text-sm text-muted-foreground"><UserX className="h-4 w-4" /> The candidate remains in history and can be reopened.</p>}
          {pending?.action === "reopen" && <p className="flex items-center gap-2 text-sm text-muted-foreground"><RotateCcw className="h-4 w-4" /> This returns the interview to Confirmed with its outcome pending.</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPending(null)} disabled={saving}>Cancel</Button>
            <Button onClick={() => void saveAction()} disabled={saving || (pending?.action === "reschedule" && !appointmentAt) || (pending?.action === "unqualified" && !reason.trim()) || (pending?.action === "hire" && pending.row.application_license_status === "licensed" && !/^\d{5,10}$/.test(hireNpn.replace(/\D+/g, "")))}>
              {saving ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />} Save with receipt
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
