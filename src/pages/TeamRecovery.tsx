import { useCallback, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowRight, MessageSquare, Phone, PhoneCall, Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/glass-card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { usePageTitle } from "@/hooks/usePageTitle";
import { cn } from "@/lib/utils";
import { formatPhoneDisplay, startPhoneCall, startSmsThread } from "@/lib/phone";
import { StateFilterBar } from "@/components/team/StateFilterBar";
import EthosCallSheet from "@/pages/EthosCallSheet";
import InactiveAgents from "@/pages/InactiveAgents";
import {
  EMPTY_STATE_COUNTS,
  EMPTY_STATE_FILTER,
  RECOVERY_TABS,
  SOURCE_LABEL,
  groupPeopleByState,
  isStateFilterActive,
  mergeStateCounts,
  parseTab,
  type RecoveryPerson,
  type RecoveryTab,
  type StateCountSummary,
  type StateFilter,
} from "@/lib/teamRecovery";

/**
 * /dashboard/team-recovery (MP-TEAM-RECOVERY, 2026-11-27)
 *
 * Sam: "combine team recovery and call sheet ... make it easy to filter states, or agents by states."
 *
 * Contract:
 *   - one page, three tabs: the Ethos call sheet, the inactive-agent recovery queue, and everyone from
 *     both grouped by state. The two lists are the existing pages, mounted here with their own data and
 *     actions untouched; both stay mounted so the shared state bar and the By-state view see both.
 *   - one state filter above the tabs applies to every list. States come from the database
 *     (fn_agent_lead_states, strongest record first); "No state on file" is its own chip so a filter
 *     never silently hides the people nobody has recorded a state for.
 *   - the old routes /dashboard/ethos-call-sheet and /dashboard/inactive-agents redirect here with ?tab=.
 */
export default function TeamRecovery() {
  usePageTitle("Team recovery");
  const [params, setParams] = useSearchParams();
  const tab = parseTab(params.get("tab"));
  const [filter, setFilter] = useState<StateFilter>(EMPTY_STATE_FILTER);
  const [sheetCounts, setSheetCounts] = useState<StateCountSummary>(EMPTY_STATE_COUNTS);
  const [queueCounts, setQueueCounts] = useState<StateCountSummary>(EMPTY_STATE_COUNTS);
  const [sheetPeople, setSheetPeople] = useState<RecoveryPerson[]>([]);
  const [queuePeople, setQueuePeople] = useState<RecoveryPerson[]>([]);

  const onSheetCounts = useCallback((c: StateCountSummary) => setSheetCounts(c), []);
  const onQueueCounts = useCallback((c: StateCountSummary) => setQueueCounts(c), []);
  const onSheetPeople = useCallback((p: RecoveryPerson[]) => setSheetPeople(p), []);
  const onQueuePeople = useCallback((p: RecoveryPerson[]) => setQueuePeople(p), []);

  const counts = useMemo(() => mergeStateCounts(sheetCounts, queueCounts), [sheetCounts, queueCounts]);
  const groups = useMemo(() => groupPeopleByState([...sheetPeople, ...queuePeople], filter), [sheetPeople, queuePeople, filter]);
  const peopleShown = useMemo(() => new Set(groups.flatMap((g) => g.people.map((p) => p.key))).size, [groups]);

  const setTab = (next: string) => {
    const value = parseTab(next) as RecoveryTab;
    const copy = new URLSearchParams(params);
    copy.set("tab", value);
    setParams(copy, { replace: true });
  };

  return (
    <div className="page-enter mx-auto w-full max-w-6xl space-y-5 px-4 pb-24 sm:px-6">
      <PageHeader
        eyebrowIcon={<PhoneCall className="h-4 w-4" />}
        eyebrow="Call sheet and recovery queue, one place"
        title="Team recovery"
        subtitle="Everyone under you who needs a call: contract holders who stopped, licensed agents going quiet. Pick a state to work one licensing region at a time."
        accent="emerald"
      />

      <GlassCard className="p-4">
        <StateFilterBar counts={counts} value={filter} onChange={setFilter} />
        {counts.total === 0 && (
          <p className="text-xs text-muted-foreground">States appear here as the lists load.</p>
        )}
        {isStateFilterActive(filter) && (
          <p className="mt-2 text-xs text-muted-foreground">
            Showing people who can write in {[...filter].filter(Boolean).sort().join(", ") || "no state"}
            {filter.has("") && [...filter].some(Boolean) ? ", plus people with no state on file" : ""}.
            Both lists below and the By-state view follow this filter.
          </p>
        )}
      </GlassCard>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList aria-label="Team recovery views" className="h-auto flex-wrap">
          {RECOVERY_TABS.map((t) => (
            <TabsTrigger key={t.key} value={t.key} className="h-9 px-3 text-sm">
              {t.label}
              {t.key === "call-sheet" && sheetCounts.total > 0 ? <span className="ml-1.5 tabular-nums opacity-70">{sheetCounts.total}</span> : null}
              {t.key === "recovery" && queueCounts.total > 0 ? <span className="ml-1.5 tabular-nums opacity-70">{queueCounts.total}</span> : null}
              {t.key === "by-state" && peopleShown > 0 ? <span className="ml-1.5 tabular-nums opacity-70">{peopleShown}</span> : null}
            </TabsTrigger>
          ))}
        </TabsList>
        <p className="mt-2 text-xs text-muted-foreground">{RECOVERY_TABS.find((t) => t.key === tab)?.hint}</p>

        {/* Both lists stay mounted so the state bar counts and the By-state view cover both sources. */}
        <TabsContent value="call-sheet" forceMount className={cn("mt-4 focus-visible:outline-none", tab !== "call-sheet" && "hidden")}>
          <EthosCallSheet embedded stateFilter={filter} onStateCounts={onSheetCounts} onPeople={onSheetPeople} />
        </TabsContent>
        <TabsContent value="recovery" forceMount className={cn("mt-4 focus-visible:outline-none", tab !== "recovery" && "hidden")}>
          <InactiveAgents embedded stateFilter={filter} onStateCounts={onQueueCounts} onPeople={onQueuePeople} />
        </TabsContent>
        <TabsContent value="by-state" className="mt-4 focus-visible:outline-none">
          <ByStateView groups={groups} filterActive={isStateFilterActive(filter)} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ByStateView({ groups, filterActive }: { groups: ReturnType<typeof groupPeopleByState>; filterActive: boolean }) {
  if (groups.length === 0) {
    return (
      <GlassCard className="p-4">
        <EmptyState
          icon={<Users className="h-7 w-7" />}
          variant="default"
          title={filterActive ? "Nobody in the picked states" : "Nobody to group yet"}
          description={filterActive ? "Clear or widen the state filter above." : "People appear here as the call sheet and the recovery queue load."}
        />
      </GlassCard>
    );
  }
  return (
    <div className="space-y-4">
      {groups.map((g) => (
        <GlassCard key={g.state || "none"} className="p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-base font-semibold text-foreground">
              {g.label}
              <span className="ml-2 text-sm font-normal tabular-nums text-muted-foreground">{g.people.length} {g.people.length === 1 ? "person" : "people"}</span>
            </h3>
          </div>
          <ul className="mt-3 divide-y divide-border/60">
            {g.people.map((p) => (
              <li key={p.key} className="flex flex-col gap-2 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                    {p.href ? (
                      <Link to={p.href} className="truncate text-[15px] font-semibold text-foreground hover:underline">{p.name}</Link>
                    ) : (
                      <span className="truncate text-[15px] font-semibold text-foreground">{p.name}</span>
                    )}
                    <span className="shrink-0 rounded-sm border border-border px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                      {SOURCE_LABEL[p.source]}
                    </span>
                    {p.states.length > 1 && (
                      <span className="shrink-0 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">also {p.states.filter((s) => s !== g.state).join(", ")}</span>
                    )}
                  </div>
                  <p className="truncate text-sm text-muted-foreground">{p.detail}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {p.phone ? (
                    <>
                      <Button
                        type="button"
                        size="sm"
                        className="h-9 gap-1.5 tabular-nums"
                        aria-label={`Call ${p.name} at ${formatPhoneDisplay(p.phone)}`}
                        onClick={() => { if (!startPhoneCall(p.phone)) toast.error(`Cannot dial ${p.phone}`); }}
                      >
                        <Phone className="h-4 w-4" aria-hidden="true" />
                        {formatPhoneDisplay(p.phone)}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-9 gap-1.5"
                        aria-label={`Text ${p.name}`}
                        onClick={() => { if (!startSmsThread(p.phone)) toast.error(`Cannot text ${p.phone}`); }}
                      >
                        <MessageSquare className="h-4 w-4" aria-hidden="true" />
                        Text
                      </Button>
                    </>
                  ) : (
                    <span className="text-xs font-medium text-amber-600 dark:text-amber-400">No phone on file</span>
                  )}
                  {p.href && (
                    <Button asChild size="sm" variant="ghost" className="h-9 gap-1" aria-label={`Open ${p.name}'s profile`}>
                      <Link to={p.href}><ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </GlassCard>
      ))}
    </div>
  );
}
