import React, { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, CheckCircle2, ChevronDown, Loader2, Phone, RefreshCw, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { startPhoneCall } from "@/lib/phone";
import { formatTimeAgo } from "@/lib/dateUtils";
import { cn } from "@/lib/utils";
import {
  BLOCKER_LABEL, OUTCOME_LABEL, WAITING_ON_LABEL, basisShortLabel, confirmClockBasis, followupLine, formatDay,
  nextActionFor, plural, priorityOne, reasonSentence, type ContractingFilter, type TeamContractingStatus, type TeamPerson,
} from "@/lib/teamContracting";
import { ContactOutcomeButtons } from "@/components/team/ContactOutcome";
import type { useTeamContracting } from "@/lib/teamContracting";

type Query = ReturnType<typeof useTeamContracting>;
export type ContactLookup = (agentId: string) => { phone: string | null; email: string | null };

const INITIAL_SHOWN = 5;

const BASIS_OPTIONS: { key: string; label: string; hint: string }[] = [
  { key: "hired", label: "Day they were hired", hint: "Day 0 is the day the agent record was created." },
  { key: "hired_or_licensed", label: "Day hired, or the day they got licensed if later", hint: "Matches the No-Hire-Left-Behind rule." },
  { key: "expected_start", label: "Day they start (Expected start from Recruit Pipeline)", hint: "Only people with an Expected start date can be timed." },
  { key: "contracting_request", label: "Day the contracting request was filed", hint: "Only people with a contracting request can be timed." },
];

function policyLine(status: TeamContractingStatus): string {
  const byDay = new Map<number, string[]>();
  for (const p of Object.values(status.policy)) byDay.set(p.red_day, [...(byDay.get(p.red_day) ?? []), p.label]);
  return [...byDay.entries()].sort((a, b) => a[0] - b[0]).map(([d, labels]) => `${labels.join(" and ")} red from day ${d}`).join(" · ");
}

/** Urgency is off until the clock rule is confirmed. One compact row for an admin to choose and confirm it. */
function TimingBanner({ status, q }: { status: TeamContractingStatus; q: Query }) {
  const { isAdmin } = useAuth();
  const [choice, setChoice] = useState("hired_or_licensed");
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const activateRule = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    const r = await confirmClockBasis(choice);
    inFlight.current = false;
    setBusy(false);
    if (!r.ok) { toast.error(`Could not save the timing rule: ${r.error?.slice(0, 140)}`); return; }
    toast.success("Timing rule confirmed. Urgency is now on.");
    await q.refetch();
  };
  const hint = BASIS_OPTIONS.find((o) => o.key === choice)?.hint;
  return (
    <section aria-label="Contracting timing rule" className="rounded-lg border border-amber-500/50 bg-amber-500/10 px-3 py-3 sm:px-4" role="status">
      <p className="flex items-center gap-2 text-sm font-semibold text-amber-800 dark:text-amber-200">
        <ShieldAlert className="h-4 w-4 shrink-0" aria-hidden /> Contracting urgency is off until the timing rule is confirmed
      </p>
      <p className="mt-0.5 text-sm text-muted-foreground">
        Nobody is shown as overdue yet. {plural(status.counts.eligible_people, "eligible person", "eligible people")} {status.counts.eligible_people === 1 ? "is" : "are"} waiting on this choice.
      </p>
      {isAdmin ? (
        <div className="mt-2 space-y-1">
          <div className="flex flex-wrap items-end gap-2">
            <label className="min-w-0 text-xs text-muted-foreground">Day the clock starts
              <select value={choice} onChange={(e) => setChoice(e.target.value)} className="mt-0.5 block min-h-[40px] w-full max-w-full rounded-md border border-border bg-background px-2 text-sm text-foreground sm:w-[360px]">
                {BASIS_OPTIONS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
              </select>
            </label>
            <Button size="sm" className="h-10" onClick={() => void activateRule()} disabled={busy}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Confirm and turn urgency on
            </Button>
          </div>
          {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
        </div>
      ) : <p className="mt-1 text-sm text-muted-foreground">An admin needs to confirm it.</p>}
    </section>
  );
}

function Entry({ p, status, contact, q, onOpen }: { p: TeamPerson; status: TeamContractingStatus; contact: ReturnType<ContactLookup>; q: Query; onOpen: (agentId: string, section?: "followup") => void }) {
  const [called, setCalled] = useState(false);
  const hasPhone = Boolean(contact.phone);
  const action = nextActionFor(p, hasPhone);
  const f = p.followup;
  const line = followupLine(p);
  const profile = `/dashboard/profile?agentId=${p.agent_id}`;

  // Each part has a stable key, so the line never binds to a position in the list.
  const details: { key: string; node: React.ReactNode }[] = [
    { key: "owner", node: <>Owner <b className="font-semibold text-foreground">{p.owner.name}</b></> },
    { key: "last", node: f.last_at ? <>Last contact <b className="font-semibold text-foreground">{OUTCOME_LABEL[f.last_outcome ?? ""] ?? "logged"}</b>, {formatTimeAgo(f.last_at)}</> : <>Never contacted</> },
    ...(line ? [{ key: "followup", node: <b className={cn("font-semibold", line.tone === "urgent" ? "text-red-700 dark:text-red-300" : line.tone === "warn" ? "text-amber-700 dark:text-amber-300" : "text-foreground")}>{line.text}</b> }] : []),
    ...(f.next_action ? [{ key: "next", node: <>Next: {f.next_action}</> }] : []),
    ...(f.waiting_on ? [{ key: "waiting", node: <>{WAITING_ON_LABEL[f.waiting_on] ?? f.waiting_on}</> }] : []),
    ...(f.blocker && f.blocker !== "none" ? [{ key: "blocker", node: <>Blocker: {BLOCKER_LABEL[f.blocker] ?? f.blocker}</> }] : []),
    ...(!hasPhone ? [{ key: "phone", node: <b className="font-semibold text-amber-700 dark:text-amber-300">No phone on file</b> }] : []),
  ];

  return (
    <li className="rounded-md border border-border/60 border-l-2 border-l-red-500 bg-background/40 px-3 py-2">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-x-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">
            <span className="mr-1.5 text-xs font-bold tabular-nums text-red-700 dark:text-red-300" aria-label={`Rank ${p.p1_rank}`}>#{p.p1_rank}</span>
            <Link to={profile} className="underline decoration-dotted underline-offset-2 hover:text-primary">{p.display_name}</Link>
          </p>
          <p className="text-sm text-red-700 dark:text-red-300">{reasonSentence(p, basisShortLabel(status.basis.key))}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {details.map((d, i) => <span key={d.key}>{i > 0 ? " · " : ""}{d.node}</span>)}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {action.kind === "call" ? (
            <Button size="sm" className="h-10 gap-1.5" onClick={() => { startPhoneCall(contact.phone); setCalled(true); }} aria-label={`Call ${p.display_name}`}>
              <Phone className="h-4 w-4" aria-hidden /> Call
            </Button>
          ) : null}
          <Button size="sm" variant="outline" className="h-10" onClick={() => onOpen(p.agent_id, action.kind === "review_blocker" ? "followup" : undefined)} aria-label={`${action.kind === "review_blocker" ? "Review blocker" : "Open details"} for ${p.display_name}`}>
            {action.kind === "review_blocker" ? "Review blocker" : "Details"}
          </Button>
          {!called ? (
            <button type="button" onClick={() => setCalled(true)} className="inline-flex min-h-[40px] items-center px-1 text-xs font-semibold text-muted-foreground underline underline-offset-2 hover:text-foreground">Record a contact</button>
          ) : null}
        </div>
      </div>
      {called ? (
        <div className="mt-2 rounded-md border border-border bg-muted/40 p-2">
          <p className="mb-1 text-xs text-muted-foreground">Calling does not record a contact. What happened?</p>
          <ContactOutcomeButtons agentId={p.agent_id} name={p.display_name} queryKey={q.queryKey} onLogged={() => setCalled(false)} onSkip={() => setCalled(false)} />
        </div>
      ) : null}
    </li>
  );
}

/**
 * "Priority 1 — Contact now." Everyone with at least one overdue milestone, one entry per person however many
 * milestones are late, ranked by the server. It always shows the complete authorised list: the roster filters below
 * do not narrow it, so a filter can never hide an urgent person. The quiet "no overdue" line is rendered only from a
 * successful, complete read; a failed read is its own state with a Retry.
 */
export function ContractingPriorityPanel({ q, contactFor, onOpenPerson, onShowFilter }: {
  q: Query;
  contactFor: ContactLookup;
  onOpenPerson: (agentId: string, section?: "followup") => void;
  onShowFilter?: (f: ContractingFilter) => void;
}) {
  const { isAdmin, isManager, isVaManager, isVa } = useAuth();
  const [showAll, setShowAll] = useState(false);

  if (!(isAdmin || isManager || isVaManager || isVa)) return null;
  if (q.isLoading) return <div className="h-[84px] animate-pulse rounded-lg bg-muted/30" role="status" aria-label="Loading contracting status" />;
  if (q.isError || !q.data) {
    return (
      <section className="rounded-lg border border-amber-500/50 bg-amber-500/10 px-3 py-3 sm:px-4" role="alert" aria-label="Contracting status unavailable">
        <p className="flex items-center gap-2 text-sm font-semibold text-amber-800 dark:text-amber-200"><AlertTriangle className="h-4 w-4 shrink-0" aria-hidden /> Contracting status unavailable</p>
        <p className="mt-0.5 text-sm text-muted-foreground">The contracting data could not be read. Nothing is being guessed in its place: nobody is shown as overdue or as all clear.</p>
        <Button size="sm" variant="outline" className="mt-2 h-10" onClick={() => void q.refetch()}><RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden />Retry</Button>
      </section>
    );
  }

  const status = q.data;
  if (!status.basis.confirmed) return <TimingBanner status={status} q={q} />;

  const list = priorityOne(status.people);
  const shown = showAll ? list : list.slice(0, INITIAL_SHOWN);
  const c = status.counts;

  if (list.length === 0) {
    return (
      <section aria-label="Priority 1: contact now" className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-border bg-card px-3 py-2.5 sm:px-4">
        <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
        <h2 className="text-sm font-semibold text-foreground">No overdue contracting actions</h2>
        <p className="text-sm text-muted-foreground">
          {plural(c.eligible_people, "eligible person", "eligible people")} checked, as of {formatDay(status.as_of)} (Phoenix).
          {c.due_soon_people > 0 ? <> <button type="button" className="inline p-0 align-baseline font-semibold underline underline-offset-2" onClick={() => onShowFilter?.("due_soon")}>{c.due_soon_people} due soon</button>.</> : null}
          {c.timing_review_people > 0 ? <> <button type="button" className="inline p-0 align-baseline font-semibold underline underline-offset-2" onClick={() => onShowFilter?.("timing_review")}>{c.timing_review_people} need timing review</button>.</> : null}
        </p>
      </section>
    );
  }

  return (
    <section aria-label="Priority 1: contact now" className="rounded-lg border border-border bg-card p-3 sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
          <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-400" aria-hidden />
          Priority 1 — Contact now ({list.length})
        </h2>
        <button type="button" onClick={() => void q.refetch()} className="inline-flex min-h-[36px] items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground" aria-label="Refresh contracting status">
          {q.isFetching ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <RefreshCw className="h-3.5 w-3.5" aria-hidden />} Refresh
        </button>
      </div>
      <p className="mt-0.5 text-xs text-muted-foreground">
        Clock: {status.basis.label}. Day 0 is the start day, in Phoenix calendar days as of {formatDay(status.as_of)}. {policyLine(status)}.
        {c.due_soon_people > 0 ? <> <button type="button" className="inline p-0 align-baseline font-semibold underline underline-offset-2" onClick={() => onShowFilter?.("due_soon")}>{c.due_soon_people} more due soon</button>.</> : null}
        {c.timing_review_people > 0 ? <> <button type="button" className="inline p-0 align-baseline font-semibold underline underline-offset-2" onClick={() => onShowFilter?.("timing_review")}>{c.timing_review_people} need timing review</button>.</> : null}
      </p>
      {status.checkoff_events_ever === 0 ? (
        <p className="mt-1 text-xs text-muted-foreground">Nothing has ever been ticked on this checklist, so everyone starts unchecked. Tick what is already done and the flags clear.</p>
      ) : null}
      <ul className="mt-2 space-y-2">
        {shown.map((p) => <Entry key={p.agent_id} p={p} status={status} contact={contactFor(p.agent_id)} q={q} onOpen={onOpenPerson} />)}
      </ul>
      {list.length > INITIAL_SHOWN ? (
        <button type="button" onClick={() => setShowAll((v) => !v)} aria-expanded={showAll} className="mt-2 inline-flex min-h-[40px] items-center gap-1.5 text-sm font-semibold text-foreground">
          <ChevronDown className={cn("h-4 w-4 transition-transform", showAll && "rotate-180")} aria-hidden />
          {showAll ? "Show fewer" : `Show all ${list.length}`}
        </button>
      ) : null}
    </section>
  );
}
