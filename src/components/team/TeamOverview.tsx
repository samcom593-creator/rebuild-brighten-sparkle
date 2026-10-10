import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp, RefreshCw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useTeamFacts } from "@/hooks/useTeamFacts";
import { useContractReview } from "@/hooks/useContractReview";
import { accessSummary, workdaysSummary, type PersonFacts, type StageKey } from "@/lib/teamStage";
import { levelText } from "@/lib/contractReview";
import type { RosterRow } from "@/lib/teamRoster";
import { StageBadge, StageSelect } from "@/components/team/StageBadge";
import { WorkdaysEditor } from "@/components/team/WorkdaysEditor";
import { OverFiveKBadge } from "@/components/team/OverFiveKBadge";

type StageFilter = "all" | StageKey | "unset";

/**
 * Overview: one row per person with the facts a manager runs the week from. Stage (badge + selector), work commitment,
 * access, and where contracting stands. Everything saves on the spot; nothing here is production or a penalty.
 */
export function TeamOverview({ rows, className }: { rows: RosterRow[]; className?: string }) {
  const facts = useTeamFacts(true);
  const review = useContractReview(true);
  const [editingWorkdays, setEditingWorkdays] = useState(false);
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState<StageFilter>("all");
  const [openId, setOpenId] = useState<string | null>(null);

  const byId = useMemo(() => new Map(rows.map((r) => [r.agent_id, r] as const)), [rows]);
  const marks = useMemo(() => new Map((review.roster?.agents ?? []).map((a) => [a.agent_id, a] as const)), [review.roster]);
  const people = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (facts.facts?.people ?? [])
      .map((p) => ({ p, r: byId.get(p.agent_id) }))
      .filter(({ p, r }) => {
        if (stageFilter === "unset" ? p.stage !== null : stageFilter !== "all" && p.stage !== stageFilter) return false;
        if (!q) return true;
        return `${r?.full_name ?? ""} ${r?.email ?? ""}`.toLowerCase().includes(q);
      })
      .sort((a, b) => (a.r?.full_name ?? "").localeCompare(b.r?.full_name ?? ""));
  }, [facts.facts, byId, search, stageFilter]);

  if (!facts.canRead) return <p className={cn("rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground", className)}>The team overview is for admins, managers and the team that supports them.</p>;
  if (facts.query.isLoading) return <div className={cn("space-y-2", className)} aria-busy="true" aria-label="Loading the team overview">{["a", "b", "c", "d"].map((k) => <Skeleton key={k} className="h-16 w-full" />)}</div>;
  if (facts.query.isError || !facts.facts) {
    return (
      <div role="alert" className={cn("space-y-2 rounded-lg border border-destructive/40 bg-destructive/5 p-4", className)}>
        <p className="text-sm font-semibold text-foreground">The team overview did not load.</p>
        <p className="text-sm text-muted-foreground">Nobody is shown as unplaced or unscheduled until it loads.</p>
        <Button type="button" size="sm" variant="outline" className="h-10 gap-1.5" onClick={() => void facts.query.refetch()}><RefreshCw className="h-4 w-4" aria-hidden /> Try again</Button>
      </div>
    );
  }
  const c = facts.facts.counts;

  return (
    <section aria-label="Team overview" className={cn("space-y-3", className)}>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-foreground">Overview</h2>
          <p className="text-sm text-muted-foreground">{c.people} people · {c.stage_unset} with no stage set · {c.schedule_unset} with no schedule set.</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[12rem] flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input disabled={editingWorkdays} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name or email" aria-label="Search the overview" className="h-10 pl-9" />
        </div>
        <select disabled={editingWorkdays} aria-label="Stage filter" value={stageFilter} onChange={(e) => setStageFilter(e.target.value as StageFilter)}
          className="h-10 rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)]">
          <option value="all">All stages</option>
          <option value="online_training">Online training</option>
          <option value="training">Training</option>
          <option value="released_in_field">Released in field</option>
          <option value="unset">Stage not set</option>
        </select>
      </div>

      <ul aria-label="People" className="list-none space-y-2">
        {people.length === 0 ? <li className="p-6 text-center text-sm text-muted-foreground" role="status">Nobody matches.</li> : null}
        {people.map(({ p, r }) => {
          const name = r?.full_name ?? "Name not on file";
          const acc = accessSummary(p.access);
          const m = marks.get(p.agent_id);
          const open = openId === p.agent_id;
          return (
            <li key={p.agent_id} className="rounded-xl border border-border bg-card p-4">
              <div className="grid gap-x-4 gap-y-2 2xl:grid-cols-[minmax(0,1.6fr)_minmax(10rem,1fr)_minmax(10rem,1fr)_minmax(8rem,0.9fr)_auto] 2xl:items-center sm:grid-cols-2">
                <div className="min-w-0">
                  <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                    <p className="truncate text-sm font-semibold text-foreground">{name}</p>
                    <StageBadge stage={p.stage} />
                    {r ? <OverFiveKBadge row={r} /> : null}
                  </div>
                  <p className="truncate text-xs text-muted-foreground">{r?.email ?? "No email on file"}</p>
                </div>
                <div>
                  <span className="block text-xs text-muted-foreground 2xl:hidden">Stage</span>
                  <StageSelect name={name} stage={p.stage} canEdit={facts.canEdit} saving={facts.isPending(p.agent_id, "stage")} onChange={(s) => void facts.setStage(p.agent_id, name, s)} />
                </div>
                <div className="text-sm">
                  <span className="block text-xs text-muted-foreground 2xl:hidden">Work days</span>
                  <span className={p.schedule_set ? "text-foreground" : "text-muted-foreground"}>{workdaysSummary(p.schedule_set ? p.weekdays ?? [] : null)}</span>
                </div>
                <div className="text-sm">
                  <span className="block text-xs text-muted-foreground 2xl:hidden">Access</span>
                  <span className={cn(acc.tone === "ok" ? "text-foreground" : "text-muted-foreground")}>{acc.text}</span>
                  {m ? <span className="block text-xs text-muted-foreground">{m.marked_count} of 4 carriers · level {levelText(m.level)}</span> : null}
                </div>
                <Button type="button" variant="outline" size="sm" className="h-10 gap-1 md:h-9" aria-expanded={open} disabled={editingWorkdays} onClick={() => setOpenId(open ? null : p.agent_id)}>
                  {open ? <>Close <ChevronUp className="h-4 w-4" aria-hidden /></> : <>Work days <ChevronDown className="h-4 w-4" aria-hidden /></>}
                </Button>
              </div>
              {open ? (
                <div className="mt-3 rounded-md border border-border bg-muted/30 p-3">
                  <WorkdaysEditor name={name} weekdays={p.weekdays} scheduleSet={p.schedule_set} nextSchedule={p.next_schedule} canEdit={facts.canEdit}
                    saving={facts.isPending(p.agent_id, "workdays")} onEditingChange={setEditingWorkdays} onSave={(days, from) => facts.setWorkdays(p.agent_id, name, days, from)} />
                  <p className="mt-2 text-xs text-muted-foreground">{editingWorkdays ? "Save or discard your workday edits before closing or switching people." : "A work commitment is a plan, not attendance."}</p>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
