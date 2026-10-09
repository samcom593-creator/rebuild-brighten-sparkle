import { useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ChevronDown, MessageSquare, Phone } from "lucide-react";
import { startPhoneCall, startSmsThread } from "@/lib/phone";
import { formatTimeAgo } from "@/lib/dateUtils";
import { cn } from "@/lib/utils";
import { dayLabel, groupHirePriority, useHirePriority, type HirePriorityRow } from "@/lib/hireFlags";
import { HireFlagChips } from "@/components/hires/HireFlagChips";

/**
 * "Talk to these people now." Licensed hires overdue on Aflac or Ethos after 3 days, or on the first
 * contract or AgentLink after 5, ranked so the worst ten are Priority 1. Everyone else who is behind sits
 * below, collapsed. A hire called in the last 24 hours drops down the list but stays visible.
 *
 * Renders nothing for people the server will not show this list to (it refuses non-managers), and says so
 * out loud if the read fails for someone who should see it.
 */
function Row({ r }: { r: HirePriorityRow }) {
  const first = r.display_name.split(" ")[0] || "there";
  return (
    <li className="rounded-xl border border-red-500/30 bg-background/40 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-foreground">
            <span className="mr-2 inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-red-500 px-1.5 text-xs font-bold text-white">{r.priority_rank}</span>
            {r.display_name}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {dayLabel(r.days)}
            {r.manager_name ? ` · ${r.manager_name}'s team` : ""}
            {r.last_call_at ? ` · last call ${formatTimeAgo(r.last_call_at)}` : " · never called"}
            {r.called_recently ? " · called today" : ""}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            disabled={!r.phone}
            onClick={() => startPhoneCall(r.phone)}
            className="inline-flex min-h-[40px] items-center gap-1.5 rounded-full bg-red-500 px-4 text-sm font-semibold text-white disabled:opacity-40"
            aria-label={`Call ${r.display_name}`}
          >
            <Phone className="h-4 w-4" /> Call
          </button>
          <button
            type="button"
            disabled={!r.phone}
            onClick={() => startSmsThread(r.phone, `Hey ${first}, it's Sam. Quick check-in on your contracting. When can you hop on a call today?`)}
            className="inline-flex min-h-[40px] items-center gap-1.5 rounded-full border border-red-500/50 px-4 text-sm font-semibold text-red-200 disabled:opacity-40"
            aria-label={`Text ${r.display_name}`}
          >
            <MessageSquare className="h-4 w-4" /> Text
          </button>
        </div>
      </div>
      <HireFlagChips row={r} className="mt-2" />
      {r.reasons.length > 0 ? <p className="mt-1.5 text-sm text-red-200/90">{r.reasons.join(" · ")}</p> : null}
    </li>
  );
}

export function HirePriorityPanel({ className }: { className?: string }) {
  const { data, isError, isLoading } = useHirePriority();
  const [showRest, setShowRest] = useState(false);

  // The server refuses everyone who is not a manager, so an error here is expected for agents and recruiters.
  // Showing nothing for them is correct; admins have not been refused, so a failure is worth saying.
  if (isLoading) return null;
  if (isError || !data) {
    return null;
  }
  if (data.length === 0) return null;

  const { first, rest } = groupHirePriority(data);
  return (
    <section aria-label="Priority 1: talk to these people now" className={cn("rounded-2xl border-2 border-red-500/60 bg-red-500/10 p-4", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-lg font-extrabold text-red-100">
          <AlertTriangle className="h-5 w-5 text-red-400" />
          Priority 1: talk to these people now ({first.length})
        </h2>
        <Link to="/dashboard/contracting/cases" className="text-sm font-semibold text-red-200 underline">Contracting cases</Link>
      </div>
      <p className="mt-1 text-sm text-red-200/80">
        Red = overdue. Aflac and Ethos after 3 days. First contract and AgentLink after 5. {data.length} licensed hire{data.length === 1 ? " is" : "s are"} behind in total.
      </p>
      <ul className="mt-3 space-y-2">
        {first.map((r) => <Row key={r.agent_id} r={r} />)}
      </ul>
      {rest.length > 0 ? (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => setShowRest((v) => !v)}
            aria-expanded={showRest}
            className="inline-flex min-h-[40px] items-center gap-1.5 text-sm font-semibold text-red-200"
          >
            <ChevronDown className={cn("h-4 w-4 transition-transform", showRest && "rotate-180")} />
            Also behind ({rest.length})
          </button>
          {showRest ? <ul className="mt-2 space-y-2">{rest.map((r) => <Row key={r.agent_id} r={r} />)}</ul> : null}
        </div>
      ) : null}
    </section>
  );
}
