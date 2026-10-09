import { ChevronRight, SkipForward } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { levelText, missingIntake, type ReviewAgent, type ReviewCarrier } from "@/lib/contractReview";
import { CarrierCircle } from "@/components/contracting-review/CarrierCircle";

/** One grid for the header and every row, so the headings and the circles line up exactly. */
const GRID = "md:grid md:grid-cols-[minmax(0,1.8fr)_repeat(4,minmax(4.25rem,1fr))_minmax(5.5rem,0.8fr)_auto] md:items-center md:gap-3";

export function ReviewHeader({ carriers }: { carriers: readonly ReviewCarrier[] }) {
  return (
    // Visual headings only: every circle carries its carrier name in its own accessible label.
    <div aria-hidden="true" className={cn("hidden border-b border-border px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground", GRID)}>
      <div>Agent</div>
      {carriers.map((c) => <div key={c.key} className="text-center">{c.label}</div>)}
      <div>Placement level</div>
      <div className="text-right">Details</div>
    </div>
  );
}

export function ReviewRow({ agent, carriers, current, canEdit, isSaving, onToggle, onOpen, onNext }: {
  agent: ReviewAgent;
  carriers: readonly ReviewCarrier[];
  current: boolean;
  canEdit: boolean;
  isSaving: (agentId: string, what: string) => boolean;
  onToggle: (agent: ReviewAgent, carrier: ReviewCarrier, confirmed: boolean) => void;
  onOpen: (agentId: string) => void;
  onNext: (agentId: string) => void;
}) {
  const missing = missingIntake(agent.profile);
  return (
    <li
      id={`review-row-${agent.agent_id}`}
      aria-current={current ? "true" : undefined}
      className={cn("border-b border-border px-3 py-3 last:border-b-0", GRID, current ? "bg-primary/5 ring-1 ring-inset ring-primary/40" : "")}
    >
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-foreground">{agent.display_name}</p>
        <p className="truncate text-xs text-muted-foreground">{agent.email ?? "No email on file"}</p>
        {missing.length > 0 ? (
          <p className="mt-0.5 text-[11px] text-muted-foreground">Profile: {5 - missing.length} of 5 fields filled</p>
        ) : null}
      </div>
      {/* Phone: a 2x2 block of labelled circles. md and up: the circles become the table's own columns. */}
      <div className="mt-2 grid grid-cols-2 gap-1 md:contents">
        {carriers.map((c) => (
          <div key={c.key} className="flex justify-center md:text-center">
            <CarrierCircle carrier={c} mark={agent.marks[c.key] ?? null} canEdit={canEdit} saving={isSaving(agent.agent_id, c.key)} onToggle={(v) => onToggle(agent, c, v)} showLabel />
          </div>
        ))}
      </div>
      <div className="mt-2 text-sm md:mt-0">
        <span className="text-xs text-muted-foreground md:hidden">Placement level: </span>
        <span className={cn("tabular-nums", agent.level ? "font-medium text-foreground" : "text-muted-foreground")}>{levelText(agent.level)}</span>
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 md:mt-0 md:justify-end">
        <Button type="button" variant="ghost" size="sm" className="h-10 gap-1 text-muted-foreground md:hidden" aria-label={`Go to the next unreviewed person after ${agent.display_name}`} onClick={() => onNext(agent.agent_id)}>
          <SkipForward className="h-4 w-4" aria-hidden /> Next unreviewed
        </Button>
        <Button type="button" variant="outline" size="sm" className="h-10 gap-1 md:h-9" onClick={() => onOpen(agent.agent_id)} aria-label={`Details for ${agent.display_name}`}>
          Details <ChevronRight className="h-4 w-4" aria-hidden />
        </Button>
      </div>
    </li>
  );
}
