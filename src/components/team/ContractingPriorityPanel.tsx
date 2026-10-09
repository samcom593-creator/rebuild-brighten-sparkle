import { useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ArrowUpRight, CalendarClock, ChevronDown, Loader2, Phone, PhoneOff, RefreshCw, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { startPhoneCall } from "@/lib/phone";
import { formatTimeAgo } from "@/lib/dateUtils";
import { cn } from "@/lib/utils";
import {
  BLOCKER_LABEL, OUTCOME_LABEL, WAITING_ON_LABEL, basisShortLabel, confirmClockBasis, logContactOutcome,
  nextActionFor, plural, priorityOne, reasonSentence, type TeamContractingStatus, type TeamPerson,
} from "@/lib/teamContracting";
import { MilestoneChips } from "@/components/team/ContractingBadges";
import { ContractingFollowupDialog } from "@/components/team/ContractingFollowupDialog";
import type { useTeamContracting } from "@/lib/teamContracting";

type Query = ReturnType<typeof useTeamContracting>;
export type ContactLookup = (agentId: string) => { phone: string | null; email: string | null };

const INITIAL_SHOWN = 8;

const BASIS_OPTIONS: { key: string; label: string; hint: string }[] = [
  { key: "hired", label: "Day they were hired", hint: "Day 0 is the day the agent record was created." },
  { key: "hired_or_licensed", label: "Day hired, or the day they got licensed if later", hint: "Matches the No-Hire-Left-Behind rule." },
  { key: "expected_start", label: "Day they start (Expected start from Recruit Pipeline)", hint: "Only people with an Expected start date can be timed." },
  { key: "contracting_request", label: "Day the contracting request was filed", hint: "Only people with a contracting request can be timed." },
];

function policyLine(status: TeamContractingStatus): string {
  const entries = Object.values(status.policy);
  const byDay = new Map<number, string[]>();
  for (const p of entries) byDay.set(p.red_day, [...(byDay.get(p.red_day) ?? []), p.label]);
  return [...byDay.entries()].sort((a, b) => a[0] - b[0]).map(([d, labels]) => `${labels.join(" and ")} red from day ${d}`).join(" · ");
}

function TimingBanner({ status, q }: { status: TeamContractingStatus; q: Query }) {
  const { isAdmin } = useAuth();
  const [choice, setChoice] = useState("hired_or_licensed");
  const [busy, setBusy] = useState(false);
  const activateRule = async () => {
    setBusy(true);
    const r = await confirmClockBasis(choice);
    setBusy(false);
    if (!r.ok) { toast.error(`Could not save the timing rule: ${r.error?.slice(0, 140)}`); return; }
    toast.success("Timing rule confirmed. Urgency is now on.");
    await q.refetch();
  };
  return (
    <div className="rounded-xl border border-amber-500/50 bg-amber-500/10 p-4" role="status">
      <p className="flex items-center gap-2 text-sm font-bold text-amber-800 dark:text-amber-200">
        <ShieldAlert className="h-4 w-4" aria-hidden /> Contracting urgency is off: the timing rule is not confirmed yet
      </p>
      <p className="mt-1 text-sm text-amber-900/80 dark:text-amber-100/80">
        Nobody is shown as overdue until the day the clock starts is confirmed. {status.counts.eligible_people} eligible people are waiting on that choice.
      </p>
      {isAdmin ? (
        <div className="mt-3 space-y-2">
          {BASIS_OPTIONS.map((o) => (
            <label key={o.key} className="flex cursor-pointer items-start gap-2 text-sm text-foreground">
              <input type="radio" name="clock-basis" value={o.key} checked={choice === o.key} onChange={() => setChoice(o.key)} className="mt-1 h-4 w-4" />
              <span><b>{o.label}</b><br /><span className="text-muted-foreground">{o.hint}</span></span>
            </label>
          ))}
          <Button size="sm" onClick={() => void activateRule()} disabled={busy}>{busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Confirm and turn urgency on</Button>
        </div>
      ) : <p className="mt-2 text-sm text-muted-foreground">An admin needs to confirm it.</p>}
    </div>
  );
}

function Entry({ p, status, contact, q, onPlan }: { p: TeamPerson; status: TeamContractingStatus; contact: ReturnType<ContactLookup>; q: Query; onPlan: (p: TeamPerson) => void }) {
  const [called, setCalled] = useState(false);
  const [logging, setLogging] = useState(false);
  const hasPhone = Boolean(contact.phone);
  const action = nextActionFor(p, hasPhone);
  const profile = `/dashboard/profile?agentId=${p.agent_id}`;

  const log = async (outcome: keyof typeof OUTCOME_LABEL) => {
    setLogging(true);
    const r = await logContactOutcome(p.agent_id, outcome);
    setLogging(false);
    if (!r.ok) { toast.error(`Contact not recorded: ${r.error?.slice(0, 140)}`); return; }
    toast.success(`Recorded: ${OUTCOME_LABEL[outcome]} · ${p.display_name}`);
    setCalled(false);
    await q.refetch();
  };

  const f = p.followup;
  return (
    <li className="rounded-xl border border-red-500/40 bg-background/50 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-foreground">
            <span className="mr-2 inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-red-600 px-1.5 text-xs font-bold text-white" aria-label={`Rank ${p.p1_rank}`}>{p.p1_rank}</span>
            <Link to={profile} className="underline decoration-dotted underline-offset-2 hover:text-primary">{p.display_name}</Link>
          </p>
          <p className="mt-1 text-sm font-medium text-red-700 dark:text-red-200">{reasonSentence(p, basisShortLabel(status.basis.key))} · contact now</p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {action.kind === "call" ? (
            <button type="button" onClick={() => { startPhoneCall(contact.phone); setCalled(true); }}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-full bg-red-600 px-4 text-sm font-semibold text-white" aria-label={`Call ${p.display_name}`}>
              <Phone className="h-4 w-4" aria-hidden /> Call
            </button>
          ) : (
            <Link to={profile} className="inline-flex min-h-[40px] items-center gap-1.5 rounded-full bg-red-600 px-4 text-sm font-semibold text-white" aria-label={`${action.label}: ${p.display_name}`}>
              <ArrowUpRight className="h-4 w-4" aria-hidden /> {action.label}
            </Link>
          )}
          <button type="button" onClick={() => onPlan(p)} className="inline-flex min-h-[40px] items-center gap-1.5 rounded-full border border-red-500/50 px-4 text-sm font-semibold text-red-700 dark:text-red-200">
            <CalendarClock className="h-4 w-4" aria-hidden /> Follow-up
          </button>
        </div>
      </div>

      <MilestoneChips p={p} />

      <p className="mt-2 text-xs text-muted-foreground">
        Owner: <b className="text-foreground">{p.owner.name}</b>{p.owner.source === "manager" ? " (their manager)" : p.owner.source === "unassigned" ? " (nobody assigned)" : ""}
        {f.waiting_on ? ` · ${WAITING_ON_LABEL[f.waiting_on] ?? f.waiting_on}` : ""}
        {f.blocker && f.blocker !== "none" ? ` · Blocker: ${BLOCKER_LABEL[f.blocker] ?? f.blocker}` : ""}
      </p>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {f.last_at ? <>Last contact: <b className="text-foreground">{OUTCOME_LABEL[f.last_outcome ?? ""] ?? "logged"}</b>, {formatTimeAgo(f.last_at)}</> : "Never contacted"}
        {" · "}
        {f.next_on ? <>Next follow-up: <b className={cn(f.due_now ? "text-red-700 dark:text-red-300" : "text-foreground")}>{f.next_on}{f.due_now ? " (due)" : ""}</b></> : <b className="text-red-700 dark:text-red-300">No follow-up scheduled</b>}
        {f.next_action ? ` · ${f.next_action}` : ""}
      </p>
      {!hasPhone ? (
        <p className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-amber-700 dark:text-amber-300"><PhoneOff className="h-3.5 w-3.5" aria-hidden /> Phone missing. Open the profile to add one.</p>
      ) : null}

      {called ? (
        <div className="mt-2 rounded-lg border border-border bg-muted/40 p-2" role="group" aria-label="Record what happened">
          <p className="text-xs text-muted-foreground">Calling does not record a contact. What happened?</p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {Object.entries(OUTCOME_LABEL).map(([k, v]) => (
              <button key={k} type="button" disabled={logging} onClick={() => void log(k as keyof typeof OUTCOME_LABEL)}
                className="min-h-[36px] rounded-full border border-border bg-background px-3 text-xs font-semibold hover:border-primary disabled:opacity-60">{v}</button>
            ))}
            <button type="button" onClick={() => setCalled(false)} className="min-h-[36px] px-2 text-xs text-muted-foreground underline">Skip</button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => setCalled(true)} className="mt-1.5 text-xs font-semibold text-muted-foreground underline underline-offset-2 hover:text-foreground">Log a contact</button>
      )}
    </li>
  );
}

/**
 * "Priority 1 — Contact now." Everyone with at least one overdue milestone, one entry per person however many
 * milestones are late, ranked by the server. It always shows the complete authorised list: the roster filters below
 * do not narrow it, so a filter can never hide an urgent person. Rendered only from a successful, complete read.
 */
export function ContractingPriorityPanel({ q, contactFor }: { q: Query; contactFor: ContactLookup }) {
  const { isAdmin, isManager, isVaManager, isVa } = useAuth();
  const [showAll, setShowAll] = useState(false);
  const [plan, setPlan] = useState<TeamPerson | null>(null);

  if (!(isAdmin || isManager || isVaManager || isVa)) return null;
  if (q.isLoading) return <div className="h-16 animate-pulse rounded-2xl bg-muted/30" aria-label="Loading contracting status" />;
  if (q.isError || !q.data) {
    return (
      <div className="rounded-2xl border border-amber-500/50 bg-amber-500/10 p-4" role="alert">
        <p className="flex items-center gap-2 text-sm font-bold text-amber-800 dark:text-amber-200"><AlertTriangle className="h-4 w-4" aria-hidden /> Contracting status unavailable</p>
        <p className="mt-1 text-sm text-muted-foreground">The contracting data could not be read. Nothing is being guessed in its place: no one is shown as overdue or as all clear.</p>
        <Button size="sm" variant="outline" className="mt-2" onClick={() => void q.refetch()}><RefreshCw className="mr-1.5 h-3.5 w-3.5" />Retry</Button>
      </div>
    );
  }

  const status = q.data;
  if (!status.basis.confirmed) return <TimingBanner status={status} q={q} />;

  const list = priorityOne(status.people);
  const shown = showAll ? list : list.slice(0, INITIAL_SHOWN);
  const c = status.counts;

  return (
    <section aria-label="Priority 1: contact now" className={cn("rounded-2xl border-2 p-4", list.length > 0 ? "border-red-500/60 bg-red-500/10" : "border-emerald-500/40 bg-emerald-500/10")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-lg font-extrabold text-foreground">
          {list.length > 0 ? <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400" aria-hidden /> : null}
          Priority 1 — Contact now ({list.length})
        </h2>
        <button type="button" onClick={() => void q.refetch()} className="inline-flex min-h-[36px] items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground" aria-label="Refresh contracting status">
          {q.isFetching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Refresh
        </button>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Clock: {status.basis.label}. Day 0 is the start day, counted in Phoenix calendar days as of {status.as_of}. {policyLine(status)}.{" "}
        {plural(c.followup_due_people, "person")} {c.followup_due_people === 1 ? "has" : "have"} a follow-up due or none set. {c.due_soon_people > 0 ? `${plural(c.due_soon_people, "more person", "more people")} due soon.` : ""}
      </p>
      {status.checkoff_events_ever === 0 && list.length > 0 ? (
        <p className="mt-1 text-xs text-amber-800 dark:text-amber-200">Nothing has ever been ticked on this checklist, so everyone starts unchecked. Tick what is already done and the flags clear.</p>
      ) : null}

      {list.length === 0 ? (
        <p className="mt-3 text-sm font-medium text-emerald-800 dark:text-emerald-200">Nobody is overdue on contracting. Complete read: {plural(c.eligible_people, "eligible person", "eligible people")} checked.</p>
      ) : (
        <>
          <ul className="mt-3 space-y-2">
            {shown.map((p) => <Entry key={p.agent_id} p={p} status={status} contact={contactFor(p.agent_id)} q={q} onPlan={setPlan} />)}
          </ul>
          {list.length > INITIAL_SHOWN ? (
            <button type="button" onClick={() => setShowAll((v) => !v)} aria-expanded={showAll} className="mt-3 inline-flex min-h-[40px] items-center gap-1.5 text-sm font-semibold text-foreground">
              <ChevronDown className={cn("h-4 w-4 transition-transform", showAll && "rotate-180")} />
              {showAll ? "Show fewer" : `Show all ${list.length}`}
            </button>
          ) : null}
        </>
      )}
      <ContractingFollowupDialog person={plan} queryKey={q.queryKey} onClose={() => setPlan(null)} />
    </section>
  );
}
