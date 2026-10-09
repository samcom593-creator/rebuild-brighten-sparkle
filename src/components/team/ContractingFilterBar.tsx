import { CONTRACTING_FILTERS, type ContractingFilter, type TeamContractingStatus } from "@/lib/teamContracting";
import { cn } from "@/lib/utils";

/**
 * Compact contracting filters for the roster. Each chip shows the person count from the SAME server payload, so a
 * count cannot disagree with the urgent section. When any narrowing filter is on, the bar says how many rows are
 * shown out of the whole authorised roster.
 */
export function ContractingFilterBar({ status, filter, onFilter, milestone, onMilestone, shown, rosterTotal, narrowed }: {
  status: TeamContractingStatus;
  filter: ContractingFilter;
  onFilter: (f: ContractingFilter) => void;
  milestone: string;
  onMilestone: (m: string) => void;
  shown: number;
  rosterTotal: number;
  narrowed: boolean;
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
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Contracting filter">
        {CONTRACTING_FILTERS.map((f) => {
          const n = count(f.key);
          const active = filter === f.key;
          return (
            <button key={f.key} type="button" aria-pressed={active} onClick={() => onFilter(f.key)}
              className={cn("inline-flex min-h-[36px] items-center gap-1.5 rounded-full border px-3 text-xs font-semibold",
                active ? "border-primary bg-primary/10 text-foreground ring-1 ring-primary/60" : "border-border bg-card text-muted-foreground hover:text-foreground")}>
              {f.label}{n !== null ? <span className="tabular-nums opacity-80">{n}</span> : null}
            </button>
          );
        })}
        {filter === "p1" || filter === "due_soon" ? (
          <select value={milestone} onChange={(e) => onMilestone(e.target.value)} aria-label="Milestone"
            className="min-h-[36px] rounded-full border border-border bg-background px-3 text-xs font-semibold text-foreground">
            <option value="all">Any milestone</option>
            {Object.entries(status.policy).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        ) : null}
      </div>
      {narrowed ? (
        <p className="text-xs text-muted-foreground" role="status">
          Showing <b className="text-foreground">{shown}</b> of {rosterTotal} on the roster. {c.p1_people} {c.p1_people === 1 ? "person needs" : "people need"} contact now across your whole roster, whatever is filtered.
        </p>
      ) : null}
    </div>
  );
}
