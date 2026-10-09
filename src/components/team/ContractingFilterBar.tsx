import { CONTRACTING_FILTERS, type ContractingFilter, type TeamContractingStatus } from "@/lib/teamContracting";
import { cn } from "@/lib/utils";

/**
 * Contracting quick filters for the roster. Each chip shows the person count from the SAME server payload as the
 * Priority 1 section, so a count cannot disagree with the urgent list above it.
 */
export function ContractingFilterBar({ status, filter, onFilter, milestone, onMilestone }: {
  status: TeamContractingStatus;
  filter: ContractingFilter;
  onFilter: (f: ContractingFilter) => void;
  milestone: string;
  onMilestone: (m: string) => void;
}) {
  const c = status.counts;
  const count = (f: ContractingFilter): number | null => {
    switch (f) {
      case "p1": return c.p1_people;
      case "due_soon": return c.due_soon_people;
      case "eligible": return c.eligible_people;
      case "timing_review": return c.timing_review_people;
      default: return null;
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Contracting filter">
      {CONTRACTING_FILTERS.map((f) => {
        const n = count(f.key);
        const active = filter === f.key;
        return (
          <button key={f.key} type="button" aria-pressed={active} onClick={() => onFilter(f.key)}
            className={cn("inline-flex min-h-[40px] items-center gap-1.5 rounded-full border px-3 text-sm font-medium",
              active ? "border-primary bg-primary/10 text-foreground ring-1 ring-primary/60" : "border-border bg-card text-muted-foreground hover:text-foreground")}>
            {f.label}{n !== null ? <span className="tabular-nums opacity-80">{n}</span> : null}
          </button>
        );
      })}
      {filter === "p1" || filter === "due_soon" ? (
        <select value={milestone} onChange={(e) => onMilestone(e.target.value)} aria-label="Milestone"
          className="min-h-[40px] rounded-full border border-border bg-background px-3 text-sm font-medium text-foreground">
          <option value="all">Any milestone</option>
          {Object.entries(status.policy).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
      ) : null}
    </div>
  );
}
