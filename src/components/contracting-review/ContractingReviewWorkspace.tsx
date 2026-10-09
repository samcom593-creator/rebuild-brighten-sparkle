import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw, Search, SkipForward } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useContractReview } from "@/hooks/useContractReview";
import {
  REVIEW_FILTERS, nextToReview, reviewCounts, teamOptions, visibleAgents,
  type ReviewAgent, type ReviewCarrier, type ReviewFilter,
} from "@/lib/contractReview";
import { ReviewHeader, ReviewRow } from "@/components/contracting-review/ReviewRows";
import { ReviewDetailsDrawer } from "@/components/contracting-review/ReviewDetailsDrawer";

const PAGE = 50;

/**
 * The one contracting review. My Team and the Contracts page both render THIS component, so they read and update the
 * same records and cannot disagree.
 *
 * Working rules, all deliberate:
 *  - Default view is "Needs review" (at least one circle still Not yet reviewed).
 *  - The person you are working on stays on screen after their last circle is marked, until you move on.
 *  - Search, filters, the page size and the scroll position belong to this component and survive opening a drawer.
 *  - A failed or short read shows an error. It is never drawn as an empty list or as "everyone is unmarked".
 *  - There is no "mark everyone complete".
 */
export function ContractingReviewWorkspace({ className }: { className?: string }) {
  const review = useContractReview(true);
  const { roster, query, canRead, canEdit } = review;
  const [filter, setFilter] = useState<ReviewFilter>("needs_review");
  const [search, setSearch] = useState("");
  const [managerId, setManagerId] = useState("all");
  const [shown, setShown] = useState(PAGE);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const carriers: readonly ReviewCarrier[] = roster?.carriers ?? [];
  const n = carriers.length;
  const agents = roster?.agents ?? [];
  const counts = useMemo(() => reviewCounts(agents, n), [agents, n]);
  const teams = useMemo(() => teamOptions(agents), [agents]);
  const pinned = useMemo(() => new Set(currentId ? [currentId] : []), [currentId]);
  const visible = useMemo(() => visibleAgents(agents, { filter, search, managerId }, n, pinned), [agents, filter, search, managerId, n, pinned]);
  const rows = visible.slice(0, shown);

  // A new search, filter or team starts a fresh list: the page size resets and nobody stays pinned from the old one.
  useEffect(() => { setShown(PAGE); }, [filter, search, managerId]);

  const focusPerson = useCallback((id: string) => {
    setCurrentId(id);
    // The person must be in the rendered window before it can be scrolled to.
    const at = visibleAgents(agents, { filter, search, managerId }, n, new Set([id])).findIndex((a) => a.agent_id === id);
    if (at >= shown) setShown(at + 1);
    window.setTimeout(() => {
      const el = document.getElementById(`review-row-${id}`);
      // Not every environment implements scrollIntoView (test DOMs do not); the jump is a convenience, never a failure.
      if (el && typeof el.scrollIntoView === "function") el.scrollIntoView({ block: "center", behavior: "auto" });
      el?.querySelector<HTMLButtonElement>("button[data-circle]:not(:disabled)")?.focus({ preventScroll: true });
    }, 30);
  }, [agents, filter, search, managerId, n, shown]);

  const onToggle = useCallback((a: ReviewAgent, c: ReviewCarrier, confirmed: boolean) => {
    setCurrentId(a.agent_id);
    void review.setCircle(a.agent_id, c, confirmed);
  }, [review]);

  const nextAfter = useCallback((id: string | null): ReviewAgent | null => {
    // Order is the same as the list on screen, but only people who still need review qualify.
    const order = visibleAgents(agents, { filter: "needs_review", search, managerId }, n, new Set(id ? [id] : []));
    return nextToReview(order, id, n);
  }, [agents, search, managerId, n]);

  const goNext = useCallback((id: string | null) => {
    const next = nextAfter(id);
    if (!next) { setCurrentId(null); return false; }
    focusPerson(next.agent_id);
    return true;
  }, [nextAfter, focusPerson]);

  const drawerAgent = drawerId ? agents.find((a) => a.agent_id === drawerId) : undefined;
  const nextForDrawer = drawerId ? nextAfter(drawerId) : null;

  if (!canRead) {
    return <p className={cn("rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground", className)}>The contracting review is for admins, managers and the team that supports them.</p>;
  }
  if (query.isLoading) {
    return (
      <div className={cn("space-y-2", className)} aria-busy="true" aria-label="Loading the contracting review">
        <Skeleton className="h-10 w-full" />
        {Array.from({ length: 6 }, (_, i) => `sk${i}`).map((k) => <Skeleton key={k} className="h-16 w-full" />)}
      </div>
    );
  }
  if (query.isError || !roster) {
    return (
      <div role="alert" className={cn("space-y-2 rounded-lg border border-destructive/40 bg-destructive/5 p-4", className)}>
        <p className="text-sm font-semibold text-foreground">The contracting review did not load.</p>
        <p className="text-sm text-muted-foreground">Nobody is shown as unmarked until it loads. {query.error instanceof Error ? query.error.message : ""}</p>
        <Button type="button" size="sm" variant="outline" className="h-10 gap-1.5" onClick={() => void query.refetch()}><RefreshCw className="h-4 w-4" aria-hidden /> Try again</Button>
      </div>
    );
  }

  const countFor = (f: ReviewFilter): number => (f === "needs_review" ? counts.needsReview : f === "partial" ? counts.partial : counts.allFour);

  return (
    <section aria-label="Contracting review" className={cn("space-y-3", className)}>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-foreground">Contracting review</h2>
          <p className="text-sm text-muted-foreground">
            {counts.needsReview === 0 ? "Every active agent has all four circles confirmed." : `${counts.needsReview} of ${counts.total} agents still have a circle to review.`}
            {" "}Confirm a circle after you have checked it in the carrier&apos;s portal.
          </p>
        </div>
        <Button type="button" size="sm" className="h-10 gap-1.5" onClick={() => { if (!goNext(currentId)) { /* nobody left */ } }} disabled={counts.needsReview === 0}>
          <SkipForward className="h-4 w-4" aria-hidden /> Next unreviewed
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[12rem] flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, email or NPN" aria-label="Search agents" className="h-10 pl-9" />
        </div>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Show">
          {REVIEW_FILTERS.map((f) => (
            <button key={f.key} type="button" aria-pressed={filter === f.key} onClick={() => { setFilter(f.key); setCurrentId(null); }}
              className={cn("inline-flex min-h-[40px] items-center gap-1.5 rounded-full border px-3 text-sm font-medium focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)]",
                filter === f.key ? "border-primary bg-primary/10 text-foreground ring-1 ring-primary/60" : "border-border bg-card text-muted-foreground hover:text-foreground")}>
              {f.label}<span className="tabular-nums opacity-80">{countFor(f.key)}</span>
            </button>
          ))}
        </div>
        {teams.length > 1 ? (
          <select aria-label="Team" value={managerId} onChange={(e) => { setManagerId(e.target.value); setCurrentId(null); }}
            className="h-10 rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)]">
            <option value="all">All teams</option>
            {teams.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.count})</option>)}
          </select>
        ) : null}
      </div>

      {!canEdit ? <p className="text-xs text-muted-foreground">View only. Admins and managers confirm carriers.</p> : null}

      <div className="rounded-lg border border-border bg-card">
        <ReviewHeader carriers={carriers} />
        {visible.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground" role="status">
            {agents.length === 0 ? "There are no active agents to review." : filter === "needs_review" && !search && managerId === "all" ? "Nobody needs review. Every active agent has all four circles confirmed." : "Nobody matches these filters."}
          </p>
        ) : (
          <ul ref={listRef} aria-label="Agents to review" className="list-none">
            {rows.map((a) => (
              <ReviewRow key={a.agent_id} agent={a} carriers={carriers} current={a.agent_id === currentId} canEdit={canEdit}
                isSaving={review.isPending} onToggle={onToggle} onOpen={(id) => { setCurrentId(id); setDrawerId(id); }} onNext={(id) => goNext(id)} />
            ))}
          </ul>
        )}
      </div>

      {visible.length > rows.length ? (
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">Showing {rows.length} of {visible.length}</p>
          <Button type="button" variant="outline" size="sm" className="h-10" onClick={() => setShown((s) => s + PAGE)}>Show more</Button>
        </div>
      ) : visible.length > 0 ? <p className="text-xs text-muted-foreground">Showing all {visible.length}.</p> : null}

      <ReviewDetailsDrawer
        open={!!drawerAgent} onOpenChange={(o) => { if (!o) setDrawerId(null); }} agent={drawerAgent} carriers={carriers} canEdit={canEdit}
        isSaving={review.isPending} onToggle={onToggle} onSaveProfile={review.saveProfile} onSetLevel={review.setLevel}
        hasNext={!!nextForDrawer}
        onSaveAndNext={(id) => { const next = nextAfter(id); if (!next) { setDrawerId(null); return; } setCurrentId(next.agent_id); setDrawerId(next.agent_id); }}
      />
    </section>
  );
}
