import { AlertTriangle, CircleCheck, Circle, Clock, HelpCircle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatTimeAgo } from "@/lib/dateUtils";
import type { Milestone, TeamPerson } from "@/lib/teamContracting";

/**
 * One badge per person on the roster row, and compact milestone chips. Colour is never the only signal: every state
 * has an icon and words. "Done" here means ticked by hand on the My Team checklist; it never claims a carrier
 * confirmed anything.
 */
export function RowBadges({ p, className }: { p: TeamPerson; className?: string }) {
  if (!p.p1 && !p.due_soon && !p.needs_review && !p.license_review) return null;
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-1", className)}>
      {p.p1 ? (
        <span className="inline-flex items-center gap-1 rounded-full border border-red-500/60 bg-red-500/15 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-red-700 dark:text-red-300"
          title={`Priority 1: ${p.overdue_labels ?? "contracting"} overdue`}>
          <AlertTriangle className="h-3 w-3" aria-hidden /> P1 · Contracting overdue
        </span>
      ) : p.due_soon ? (
        <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/60 bg-amber-500/15 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-amber-700 dark:text-amber-300"
          title="A contracting milestone is about to be overdue">
          <Clock className="h-3 w-3" aria-hidden /> Contracting due soon
        </span>
      ) : null}
      {p.needs_review ? (
        <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground" title={p.review_reason ?? undefined}>
          <HelpCircle className="h-3 w-3" aria-hidden /> Timing needs review
        </span>
      ) : null}
      {p.license_review ? (
        <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground" title={p.review_reason ?? undefined}>
          <HelpCircle className="h-3 w-3" aria-hidden /> Licence needs review
        </span>
      ) : null}
    </span>
  );
}

function chipTone(state: Milestone["state"]): string {
  switch (state) {
    case "done": return "border-emerald-500/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
    case "overdue": return "border-red-500/60 bg-red-500/15 text-red-700 dark:text-red-300 font-bold";
    case "due_soon": return "border-amber-500/60 bg-amber-500/15 text-amber-700 dark:text-amber-300";
    default: return "border-border bg-muted/40 text-muted-foreground";
  }
}

export function stateWord(m: Milestone): string {
  switch (m.state) {
    case "done": return "done";
    case "overdue": return m.days_late && m.days_late > 0 ? `overdue ${m.days_late} ${m.days_late === 1 ? "day" : "days"}` : "overdue";
    case "due_soon": {
      const left = (m.days_until_overdue ?? 1) - 1;
      return left <= 0 ? "due today" : `due in ${left} ${left === 1 ? "day" : "days"}`;
    }
    case "not_due_yet": return "not due yet";
    case "not_tracked": return "older hire, not tracked";
    case "policy_pending": return "timing rule not confirmed";
    case "unknown": return "timing needs review";
    case "not_applicable": return "not applicable";
  }
}

function Icon({ state }: { state: Milestone["state"] }) {
  if (state === "done") return <CircleCheck className="h-3 w-3" aria-hidden />;
  if (state === "overdue") return <AlertTriangle className="h-3 w-3" aria-hidden />;
  if (state === "due_soon") return <Clock className="h-3 w-3" aria-hidden />;
  return <Circle className="h-3 w-3" aria-hidden />;
}

/** Four small chips in the row itself, so nobody has to expand a row to see where a person stands. */
export function MilestoneChips({ p }: { p: TeamPerson }) {
  if (p.milestones.length === 0) return null;
  return (
    <span className="mt-1 flex flex-wrap items-center gap-1" role="list" aria-label="Contracting milestones">
      {p.milestones.map((m) => (
        <span key={m.key} role="listitem" title={`${m.label}: ${stateWord(m)}`} aria-label={`${m.label}: ${stateWord(m)}`}
          className={cn("inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[11px] font-semibold", chipTone(m.state))}>
          <Icon state={m.state} /> {m.label}
        </span>
      ))}
    </span>
  );
}

/** The expanded checklist: tap a milestone to tick or untick it, with who ticked it and when. */
export function MilestoneChecklist({ p, canEdit, onToggle, isPending }: {
  p: TeamPerson;
  canEdit: boolean;
  onToggle: (agentId: string, milestone: string, currentlyDone: boolean, name: string) => void;
  isPending: (agentId: string, milestone: string) => boolean;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {p.milestones.map((m) => {
          const busy = isPending(p.agent_id, m.key);
          const body = (
            <>
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Icon state={m.state} />}
              <span>{m.label}</span>
              <span className="font-normal opacity-90">· {stateWord(m)}</span>
            </>
          );
          const cls = cn("inline-flex min-h-[36px] items-center gap-1.5 rounded-full border px-3 py-1 text-[13px] font-semibold transition", chipTone(m.state));
          return canEdit ? (
            <button key={m.key} type="button" disabled={busy} aria-pressed={m.done}
              onClick={() => onToggle(p.agent_id, m.key, m.done, p.display_name)}
              aria-label={`${m.label} for ${p.display_name}: ${stateWord(m)}. ${m.done ? "Tap to reopen" : "Tap to mark done"}`}
              className={cn(cls, "hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60")}>
              {body}
            </button>
          ) : (
            <span key={m.key} className={cls}>{body}</span>
          );
        })}
      </div>
      <ul className="space-y-0.5 text-[12px] text-muted-foreground">
        {p.milestones.filter((m) => m.done).map((m) => (
          <li key={m.key}>
            {m.label}: checked by hand{m.checked_by_name ? ` by ${m.checked_by_name}` : ""}{m.checked_at ? `, ${formatTimeAgo(m.checked_at)}` : ""}.
          </li>
        ))}
        {!canEdit ? <li>You can see this checklist but not change it.</li> : null}
      </ul>
    </div>
  );
}
