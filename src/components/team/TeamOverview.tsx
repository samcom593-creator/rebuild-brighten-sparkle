import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp, RefreshCw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useTeamFacts } from "@/hooks/useTeamFacts";
import { useContractReview } from "@/hooks/useContractReview";
import { STAGES, accessSummary, workdaysSummary, type PersonFacts, type StageKey } from "@/lib/teamStage";
import type { RosterRow } from "@/lib/teamRoster";
import { StageSelect } from "@/components/team/StageBadge";
import { WorkdaysEditor } from "@/components/team/WorkdaysEditor";
import { OverFiveKBadge } from "@/components/team/OverFiveKBadge";

type Filter = "all" | StageKey | "unset" | "no_schedule" | "no_login";
type Person = { p: PersonFacts; r: RosterRow | undefined; name: string };

const GROUPS: Array<{ key: StageKey | "unset"; label: string }> = [
  { key: "unset", label: "Stage not set" },
  ...STAGES.map((s) => ({ key: s.key, label: s.label })),
];

type Facts = ReturnType<typeof useTeamFacts>;
type Mark = { agent_id: string; marked_count: number };

function OverviewRow({ x, facts, mark, open, onToggle, editingWorkdays, setEditingWorkdays, onOpenPerson }: {
  x: Person; facts: Facts; mark: Mark | undefined; open: boolean; onToggle: () => void;
  editingWorkdays: boolean; setEditingWorkdays: (v: boolean) => void; onOpenPerson?: (agentId: string) => void;
}) {
  const { p, r, name } = x;
  const acc = accessSummary(p.access);
  const m = mark;
  return (
    <li className="rounded-lg border border-border bg-card px-3 py-2">
      <div className="grid items-center gap-x-3 gap-y-1.5 sm:grid-cols-2 xl:grid-cols-[minmax(0,1.5fr)_minmax(9rem,0.9fr)_minmax(9rem,0.9fr)_minmax(7rem,0.8fr)_auto]">
        <div className="flex min-w-0 items-center gap-1.5">
          {onOpenPerson ? (
            <button type="button" onClick={() => onOpenPerson(p.agent_id)} className="min-w-0 truncate text-left text-sm font-semibold text-foreground hover:underline" aria-label={`Open ${name}`}>{name}</button>
          ) : <span className="min-w-0 truncate text-sm font-semibold text-foreground">{name}</span>}
          {r ? <OverFiveKBadge row={r} /> : null}
        </div>
        <div>
          <StageSelect name={name} stage={p.stage} canEdit={facts.canEdit} saving={facts.isPending(p.agent_id, "stage")} onChange={(s) => void facts.setStage(p.agent_id, name, s)} />
        </div>
        <p className={cn("text-sm", p.schedule_set ? "text-foreground" : "text-amber-700 dark:text-amber-400")}>{workdaysSummary(p.schedule_set ? p.weekdays ?? [] : null)}</p>
        <p className="text-sm">
          <span className={cn(acc.tone === "ok" ? "text-muted-foreground" : "text-amber-700 dark:text-amber-400")}>{acc.text}</span>
          {m && m.marked_count > 0 ? <span className="block text-xs text-muted-foreground">{m.marked_count} of 4 carriers confirmed</span> : null}
        </p>
        <Button type="button" variant="ghost" size="sm" className="h-9 justify-self-start gap-1 px-2 text-xs xl:justify-self-end" aria-expanded={open} disabled={editingWorkdays} onClick={onToggle}>
          {open ? <>Close <ChevronUp className="h-4 w-4" aria-hidden /></> : <>Work days <ChevronDown className="h-4 w-4" aria-hidden /></>}
        </Button>
      </div>
      {open ? (
        <div className="mt-2 rounded-md border border-border bg-muted/30 p-3">
          <WorkdaysEditor name={name} weekdays={p.weekdays} scheduleSet={p.schedule_set} nextSchedule={p.next_schedule} canEdit={facts.canEdit}
            saving={facts.isPending(p.agent_id, "workdays")} onEditingChange={setEditingWorkdays} onSave={(days, from) => facts.setWorkdays(p.agent_id, name, days, from)} />
          <p className="mt-2 text-xs text-muted-foreground">{editingWorkdays ? "Save or discard your workday edits before closing or switching people." : "A work commitment is a plan, not attendance."}</p>
        </div>
      ) : null}
    </li>
  );
}

/**
 * Overview: the people a manager runs the week from, grouped by stage so the ones who still need placing come first.
 * Each row is one line: name (tap for the person's card), stage, work days, access. Everything saves on the spot; the
 * chips up top are filters, not categories, and "no schedule" / "no login" surface the gaps without a report.
 */
export function TeamOverview({ rows, onOpenPerson, className }: { rows: RosterRow[]; onOpenPerson?: (agentId: string) => void; className?: string }) {
  const facts = useTeamFacts(true);
  const review = useContractReview(true);
  const [editingWorkdays, setEditingWorkdays] = useState(false);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const byId = useMemo(() => new Map(rows.map((r) => [r.agent_id, r] as const)), [rows]);
  const marks = useMemo(() => new Map((review.roster?.agents ?? []).map((a) => [a.agent_id, a] as const)), [review.roster]);
  const everyone = useMemo<Person[]>(() => (facts.facts?.people ?? [])
    .map((p) => { const r = byId.get(p.agent_id); return { p, r, name: r?.full_name ?? "Name not on file" }; })
    .sort((a, b) => a.name.localeCompare(b.name)), [facts.facts, byId]);
  const counts = useMemo(() => ({
    unset: everyone.filter((x) => x.p.stage === null).length,
    no_schedule: everyone.filter((x) => !x.p.schedule_set).length,
    no_login: everyone.filter((x) => !x.p.access.has_login).length,
    stage: Object.fromEntries(STAGES.map((s) => [s.key, everyone.filter((x) => x.p.stage === s.key).length])) as Record<StageKey, number>,
  }), [everyone]);
  const people = useMemo(() => {
    const q = search.trim().toLowerCase();
    return everyone.filter(({ p, r, name }) => {
      if (filter === "unset" && p.stage !== null) return false;
      if (filter === "no_schedule" && p.schedule_set) return false;
      if (filter === "no_login" && p.access.has_login) return false;
      if (filter !== "all" && filter !== "unset" && filter !== "no_schedule" && filter !== "no_login" && p.stage !== filter) return false;
      if (!q) return true;
      return `${name} ${r?.email ?? ""}`.toLowerCase().includes(q);
    });
  }, [everyone, search, filter]);

  if (!facts.canRead) return <p className={cn("rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground", className)}>The team overview is for admins, managers and the team that supports them.</p>;
  if (facts.query.isLoading) return <div className={cn("space-y-2", className)} aria-busy="true" aria-label="Loading the team overview">{["a", "b", "c", "d"].map((k) => <Skeleton key={k} className="h-12 w-full" />)}</div>;
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
  const chips: Array<{ key: Filter; label: string; n: number; tone?: "warn" }> = [
    { key: "all", label: "Everyone", n: everyone.length },
    { key: "unset", label: "Stage not set", n: counts.unset, tone: "warn" },
    ...STAGES.map((s) => ({ key: s.key as Filter, label: s.label, n: counts.stage[s.key] })),
    { key: "no_schedule", label: "No schedule", n: counts.no_schedule, tone: "warn" },
    { key: "no_login", label: "No login", n: counts.no_login, tone: "warn" },
  ];
  const grouped = filter === "all"
    ? GROUPS.map((g) => ({ ...g, items: people.filter((x) => (g.key === "unset" ? x.p.stage === null : x.p.stage === g.key)) })).filter((g) => g.items.length > 0)
    : [{ key: "filtered", label: chips.find((ch) => ch.key === filter)?.label ?? "People", items: people }];
  const toggleGroup = (k: string) => setCollapsed((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  return (
    <section aria-label="Team overview" className={cn("space-y-3", className)}>
      <div>
        <h2 className="text-base font-semibold text-foreground">Overview</h2>
        <p className="text-sm text-muted-foreground">{c.people} people · {c.stage_unset} with no stage set · {c.schedule_unset} with no schedule set.</p>
      </div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter people">
        {chips.map((ch) => (
          <button key={ch.key} type="button" aria-pressed={filter === ch.key} disabled={editingWorkdays} onClick={() => setFilter(ch.key)}
            className={cn("inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-sm transition-colors",
              filter === ch.key ? "border-primary/60 bg-primary/10 text-foreground" : "border-border bg-card text-muted-foreground hover:text-foreground",
              ch.tone === "warn" && ch.n > 0 && filter !== ch.key && "text-amber-700 dark:text-amber-400")}>
            {ch.label} <span className="tabular-nums">{ch.n}</span>
          </button>
        ))}
      </div>
      <div className="relative sm:max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input disabled={editingWorkdays} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name or email" aria-label="Search the overview" className="h-10 pl-9" />
      </div>

      {people.length === 0 ? <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground" role="status">Nobody matches.</p> : null}
      {grouped.map((g) => {
        const isCollapsed = collapsed.has(g.key);
        return (
          <div key={g.key}>
            {grouped.length > 1 ? (
              <button type="button" className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground" aria-expanded={!isCollapsed} onClick={() => toggleGroup(g.key)}>
                {g.label} · {g.items.length} <ChevronDown className={cn("h-4 w-4 transition-transform", isCollapsed && "-rotate-90")} aria-hidden />
              </button>
            ) : null}
            {isCollapsed ? null : <ul aria-label={g.label} className="list-none space-y-1.5">{g.items.map((x) => <OverviewRow key={x.p.agent_id} x={x} facts={facts} mark={marks.get(x.p.agent_id)} open={openId === x.p.agent_id} onToggle={() => setOpenId(openId === x.p.agent_id ? null : x.p.agent_id)} editingWorkdays={editingWorkdays} setEditingWorkdays={setEditingWorkdays} onOpenPerson={onOpenPerson} />)}</ul>}
          </div>
        );
      })}
    </section>
  );
}
