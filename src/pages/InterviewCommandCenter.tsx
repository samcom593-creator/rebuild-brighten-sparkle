import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  FileText,
  Filter,
  Instagram,
  Loader2,
  Mail,
  MessageCircle,
  Phone,
  PhoneCall,
  RefreshCw,
  Search,
  StickyNote,
  Trophy,
  UserX,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { usePageTitle } from "@/hooks/usePageTitle";
import { formatBusinessTimeWithDay, formatRelativeFromNow } from "@/lib/dateUtils";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type InterviewSource = "manual" | "calendly" | "application";
type SourceFilter = InterviewSource | "all";
type DateFilter = "today" | "week" | "month";
// 2026-06-18 Sam directive: 'I click contract and the row just stays there'.
// Default view is now ACTIVE only — pending/contacted/called/rescheduled rows.
// Dispositioned terminal states (hired/contracted/passed/no_show) move to Done
// pill. All shows everything. Tap counts shows the breakdown live.
type StateFilter = "active" | "done" | "all";
type DispositionField =
  | "called"
  | "hired"
  | "passed"
  | "contracted"
  | "rescheduled"
  | "no_show"
  | "contacted"
  | "notes";

interface UnifiedInterview {
  id: string;
  source: InterviewSource;
  candidate_name: string;
  phone: string | null;
  email: string | null;
  instagram_handle: string | null;
  scheduled_at: string;
  interview_type: string | null;
  status: string | null;
  called_at: string | null;
  hired_at: string | null;
  passed_at: string | null;
  contracted_at: string | null;
  // 2026-06-17 Sam directive: "another type of Hired Pass Called · more info"
  rescheduled_at: string | null;
  no_show_at: string | null;
  contacted_at: string | null;
  outcome_notes: string | null;
  agent_id_if_known: string | null;
  created_at: string | null;
}

const JUNE_START = "2026-06-01T00:00:00.000Z";

const DATE_FILTERS: Array<{ key: DateFilter; label: string }> = [
  { key: "today", label: "Today" },
  { key: "week", label: "Week" },
  { key: "month", label: "Month" },
];

const SOURCE_OPTIONS: Array<{ key: SourceFilter; label: string }> = [
  { key: "all", label: "All sources" },
  { key: "manual", label: "Manual" },
  { key: "calendly", label: "Calendly" },
  { key: "application", label: "Application" },
];

const SOURCE_LABEL: Record<InterviewSource, string> = {
  manual: "Manual",
  calendly: "Calendly",
  application: "Application",
};

export default function InterviewCommandCenter() {
  usePageTitle("Interviews · APEX");

  const queryClient = useQueryClient();
  // MP-214 v5 P2: persist filter preferences so a page reload keeps
  // Sam's mental model intact. Default is still 'active' / 'month' / 'all'.
  const [dateFilter, setDateFilter] = useState<DateFilter>(() => {
    if (typeof window === "undefined") return "month";
    const v = window.localStorage.getItem("cc.dateFilter") as DateFilter | null;
    return v === "today" || v === "week" || v === "month" ? v : "month";
  });
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>(() => {
    if (typeof window === "undefined") return "all";
    const v = window.localStorage.getItem("cc.sourceFilter") as SourceFilter | null;
    return v === "manual" || v === "calendly" || v === "application" || v === "all" ? v : "all";
  });
  const [stateFilter, setStateFilter] = useState<StateFilter>(() => {
    if (typeof window === "undefined") return "active";
    const v = window.localStorage.getItem("cc.stateFilter") as StateFilter | null;
    return v === "active" || v === "done" || v === "all" ? v : "active";
  });
  useEffect(() => {
    try { window.localStorage.setItem("cc.dateFilter", dateFilter); } catch { /* incognito */ }
  }, [dateFilter]);
  useEffect(() => {
    try { window.localStorage.setItem("cc.sourceFilter", sourceFilter); } catch { /* incognito */ }
  }, [sourceFilter]);
  useEffect(() => {
    try { window.localStorage.setItem("cc.stateFilter", stateFilter); } catch { /* incognito */ }
  }, [stateFilter]);
  const [search, setSearch] = useState("");
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  // 2026-06-18 MP-214: per-row exit animation. When a row is dispositioned to
  // a terminal state, it stays mounted for 280ms with opacity 0 + height 0
  // so React can animate the collapse before the state filter hides it.
  const [exitingRows, setExitingRows] = useState<Set<string>>(new Set());
  // 2026-06-18 MP-214: bulk select mode. Long-press any row → enter bulk
  // mode → tap to add/remove → sticky bottom bar applies the dispo to all.
  const [bulkMode, setBulkMode] = useState(false);
  const [bulkSelected, setBulkSelected] = useState<Set<string>>(new Set());

  // MP-214 canonical view. Tested live (Noor Shams roundtrip 2026-06-18).
  // No fallback — if this query fails, the error surface is the right
  // signal vs a silently-degrading dead path.
  const interviews = useQuery({
    queryKey: ["interviews-unified", JUNE_START],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("v_command_center_queue")
        .select(
          "entity_id, entity_type, candidate_name, phone, email, instagram_handle, scheduled_at_utc, interview_type, contacted_at, called_at, rescheduled_at, no_show_at, hired_at, contracted_at, passed_at, outcome_notes, created_at, computed_status, agent_id_if_promoted",
        )
        .gte("scheduled_at_utc", JUNE_START)
        .order("scheduled_at_utc", { ascending: false })
        .limit(1500);
      if (error) throw error;
      return (data as any[]).map((r: any) => ({
        id: r.entity_id,
        source: r.entity_type,
        candidate_name: r.candidate_name,
        phone: r.phone,
        email: r.email,
        instagram_handle: r.instagram_handle,
        scheduled_at: r.scheduled_at_utc,
        interview_type: r.interview_type,
        status: r.computed_status,
        called_at: r.called_at,
        hired_at: r.hired_at,
        passed_at: r.passed_at,
        contracted_at: r.contracted_at,
        rescheduled_at: r.rescheduled_at,
        no_show_at: r.no_show_at,
        contacted_at: r.contacted_at,
        outcome_notes: r.outcome_notes,
        agent_id_if_known: r.agent_id_if_promoted,
        created_at: r.created_at,
      })) as UnifiedInterview[];
    },
    staleTime: 30_000,
  });

  // 2026-06-18 Sam directive: 'I click contract and it just stays there'.
  // A row is DONE when any terminal field is set: hired_at, contracted_at,
  // passed_at, no_show_at. Otherwise it's ACTIVE (still in the queue).
  const isRowDone = (row: UnifiedInterview): boolean =>
    Boolean(row.hired_at || row.contracted_at || row.passed_at || row.no_show_at);

  const dateScopedRows = useMemo(() => {
    const rows = interviews.data ?? [];
    return rows.filter((row) => {
      if (sourceFilter !== "all" && row.source !== sourceFilter) return false;
      return isInDateFilter(row.scheduled_at, dateFilter);
    });
  }, [dateFilter, interviews.data, sourceFilter]);

  // Counts shown on the state pills (live — react to disposition cache patches).
  const stateCounts = useMemo(() => ({
    active: dateScopedRows.filter((r) => !isRowDone(r)).length,
    done: dateScopedRows.filter(isRowDone).length,
    all: dateScopedRows.length,
  }), [dateScopedRows]);

  // MP-214 v5: count distinct sources present in the current date scope so
  // we can suppress the source filter when there's no real choice.
  const sourcesPresent = useMemo(() => {
    const seen = new Set<InterviewSource>();
    for (const row of dateScopedRows) seen.add(row.source);
    return seen.size;
  }, [dateScopedRows]);

  const scopedRows = useMemo(() => {
    if (stateFilter === "all") return dateScopedRows;
    if (stateFilter === "done") return dateScopedRows.filter(isRowDone);
    // For Active: keep rows that are still active OR currently exiting
    // (so the fade-out animation can play before they vanish).
    return dateScopedRows.filter((r) => !isRowDone(r) || exitingRows.has(`${r.source}:${r.id}`));
  }, [dateScopedRows, stateFilter, exitingRows]);

  const visibleRows = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return scopedRows;
    return scopedRows.filter((row) =>
      [
        row.candidate_name,
        row.email,
        row.phone,
        row.instagram_handle,
        row.interview_type,
        row.status,
        row.outcome_notes,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(term),
    );
  }, [scopedRows, search]);

  const stats = useMemo(() => {
    const todayStart = startOfToday();
    const weekStart = startOfWeek();
    return {
      calledToday: scopedRows.filter((row) => row.called_at && new Date(row.called_at) >= todayStart).length,
      hiredThisWeek: scopedRows.filter((row) => row.hired_at && new Date(row.hired_at) >= weekStart).length,
    };
  }, [scopedRows]);

  const patchCachedRow = (row: UnifiedInterview, patch: Partial<UnifiedInterview>) => {
    queryClient.setQueryData<UnifiedInterview[]>(["interviews-unified", JUNE_START], (current) =>
      (current ?? []).map((item) =>
        item.source === row.source && item.id === row.id ? { ...item, ...patch } : item,
      ),
    );
  };

  const saveDisposition = async (
    row: UnifiedInterview,
    field: DispositionField,
    value?: string,
  ) => {
    const key = `${row.source}:${row.id}:${field}`;
    const timestamp = value ?? new Date().toISOString();
    setSavingKey(key);
    try {
      // For application source the row.id is `application:<uuid>` — unwrap for the RPC.
      const realId = row.source === "application" && typeof row.id === "string" && row.id.startsWith("application:")
        ? row.id.slice("application:".length)
        : row.source === "calendly" && typeof row.id === "string" && row.id.startsWith("calendly:")
          ? row.id.slice("calendly:".length)
          : row.id;
      // MP-214 v5 (Codex hardening): single round-trip via cc_dispose.
      // The RPC owns the disposition update + auto-promote chain +
      // course/Discord queue + (in v5) the Calendly source_app_id derivation.
      // Replaces the previous client-side chain that was 3 round-trips + a
      // partial-failure risk between them.
      const { data: dispResult, error } = await (supabase as any).rpc("cc_dispose", {
        p_entity_type: row.source,
        p_entity_id: row.id,
        p_field: field,
        p_value: field === "notes" ? null : timestamp,
        p_notes: field === "notes" ? (value ?? "") : null,
      });
      if (error) throw error;

      // Snapshot the prior field value for Undo. If Sam taps the Undo
      // toast within 6s, we re-fire disposition_interview with the
      // ORIGINAL value (or null) so the row pops back into Active.
      const priorValue =
        field === "called" ? row.called_at :
        field === "hired" ? row.hired_at :
        field === "passed" ? row.passed_at :
        field === "rescheduled" ? row.rescheduled_at :
        field === "no_show" ? row.no_show_at :
        field === "contacted" ? row.contacted_at :
        field === "contracted" ? row.contracted_at :
        field === "notes" ? row.outcome_notes :
        null;

      if (field === "called") patchCachedRow(row, { called_at: timestamp, status: "called" });
      if (field === "hired") patchCachedRow(row, { hired_at: timestamp, passed_at: null, status: "hired" });
      if (field === "passed") patchCachedRow(row, { passed_at: timestamp, hired_at: null, status: "passed" });
      // 2026-06-17 Sam directive: extended dispositions.
      if (field === "rescheduled") patchCachedRow(row, { rescheduled_at: timestamp, status: "rescheduled" });
      if (field === "no_show") patchCachedRow(row, { no_show_at: timestamp, status: "no_show" });
      if (field === "contacted") patchCachedRow(row, { contacted_at: timestamp, status: "contacted" });
      if (field === "contracted") patchCachedRow(row, { contracted_at: timestamp, status: "contracted" });
      if (field === "notes") patchCachedRow(row, { outcome_notes: value?.trim() || null });

      // 2026-06-18 MP-214: terminal disposition → fade row out over 280ms
      // before the state filter removes it. Pure CSS via the exitingRows set.
      const isTerminal = field === "hired" || field === "contracted" || field === "passed" || field === "no_show";
      if (isTerminal) {
        const rowKey = `${row.source}:${row.id}`;
        setExitingRows((prev) => new Set(prev).add(rowKey));
        // Remove from exitingRows after the animation so the filter takes over.
        setTimeout(() => {
          setExitingRows((prev) => {
            const next = new Set(prev);
            next.delete(rowKey);
            return next;
          });
        }, 320);
      }
      toast.success(successLabel(field), {
        duration: 6000,
        action: {
          label: "Undo",
          onClick: async () => {
            try {
              // MP-214 v5: cc_dispose with __clear__ nulls the timestamp.
              // If priorValue had a non-null value, restore that; else clear.
              await (supabase as any).rpc("cc_dispose", {
                p_entity_type: row.source,
                p_entity_id: row.id,
                p_field: field,
                p_value: priorValue ? priorValue : "__clear__",
                p_notes: null,
              });
              // Reverse the cache patch
              const reverse: Partial<UnifiedInterview> = {};
              if (field === "called") reverse.called_at = priorValue as string | null;
              if (field === "hired") reverse.hired_at = priorValue as string | null;
              if (field === "passed") reverse.passed_at = priorValue as string | null;
              if (field === "rescheduled") reverse.rescheduled_at = priorValue as string | null;
              if (field === "no_show") reverse.no_show_at = priorValue as string | null;
              if (field === "contacted") reverse.contacted_at = priorValue as string | null;
              if (field === "contracted") reverse.contracted_at = priorValue as string | null;
              if (field === "notes") reverse.outcome_notes = priorValue as string | null;
              patchCachedRow(row, reverse);
              toast.info(`↩️ Undid ${field} for ${row.candidate_name}`);
              await queryClient.invalidateQueries({ queryKey: ["interviews-unified", JUNE_START] });
            } catch (e: any) {
              toast.error(`Undo failed: ${e?.message?.slice(0, 80) ?? "unknown"}`);
            }
          },
        },
        description: isTerminal ? "Row moved to ✅ Done. Tap Undo to bring it back." : undefined,
      });

      // MP-214 v5: cc_dispose already did the promote + queue atomically.
      // The result tells us what happened. Surface to Sam + open AgentLink.
      if (field === "contracted" || field === "hired") {
        const r = (dispResult ?? {}) as { promoted?: boolean; emails_queued?: number; promoted_agent_id?: string };
        if (r.promoted && r.promoted_agent_id) {
          toast.success(`${row.candidate_name} promoted to Agent`);
        }
        if (r.emails_queued && r.emails_queued > 0) {
          // Drain the queue immediately
          try { await supabase.functions.invoke("send-agent-onboarding-email", { body: {} }); } catch { /* drained on cron tick anyway */ }
          toast.success("Course + Discord emails fired");
        }
        // Open AgentLink invite for Sam to finish the AgentLink-side contracting flow.
        window.open("https://agentlink.insuracloud.ai/admin/agents/invite", "_blank", "noopener,noreferrer");
      }

      await queryClient.invalidateQueries({ queryKey: ["interviews-unified", JUNE_START] });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Update failed";
      toast.error(message);
    } finally {
      setSavingKey(null);
    }
  };

  const openNotes = (row: UnifiedInterview) => {
    setNoteDrafts((prev) => ({ ...prev, [rowKey(row)]: row.outcome_notes ?? "" }));
  };

  const saveNotes = async (row: UnifiedInterview) => {
    const key = rowKey(row);
    const draft = noteDrafts[key] ?? "";
    if ((row.outcome_notes ?? "") === draft.trim()) {
      setNoteDrafts((prev) => omitKey(prev, key));
      return;
    }
    await saveDisposition(row, "notes", draft);
    setNoteDrafts((prev) => omitKey(prev, key));
  };

  // MP-214 v5 P2: keyboard shortcuts for rapid triage. Sam's mental model
  // is 'the top row IS the next one' — like Tinder for recruits. Pressing
  // 1-7 disposes the top visible row in Active mode and the next row rises.
  // Skip when:
  //   - Bulk mode is active (kbd applies to selection then)
  //   - Sam is typing in an input/textarea (no disposing during note edit)
  //   - No visible rows
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (bulkMode) return;
      if (!visibleRows.length) return;
      const tag = (e.target as HTMLElement | null)?.tagName ?? "";
      if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement | null)?.isContentEditable) return;
      const map: Record<string, DispositionField | undefined> = {
        "1": "contacted",
        "2": "called",
        "3": "rescheduled",
        "4": "no_show",
        "5": "hired",
        "6": "contracted",
        "7": "passed",
      };
      const field = map[e.key];
      if (!field) return;
      e.preventDefault();
      const target = visibleRows[0];
      if (target) saveDisposition(target, field);
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [bulkMode, visibleRows]);

  return (
    <div className="page-enter px-3 pb-24 sm:px-6">
      <PageHeader
        eyebrow="Interviews"
        eyebrowIcon={<ClipboardCheck className="h-3 w-3" />}
        title="Interview Command Center"
        subtitle="June interviews with tap-to-disposition tracking."
        accent="amber"
        actions={
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
            <div className="grid grid-cols-3 gap-1 rounded-md border bg-card p-1">
              {DATE_FILTERS.map((filter) => (
                <Button
                  key={filter.key}
                  type="button"
                  size="sm"
                  variant={dateFilter === filter.key ? "default" : "ghost"}
                  className="h-8 px-2 text-xs"
                  onClick={() => setDateFilter(filter.key)}
                >
                  {filter.label}
                </Button>
              ))}
            </div>
            {/* MP-214 v5: only show the source filter when >1 source is
                populated. With Calendly at 0 (referrer filter) the dropdown
                offered no choice that mattered — pure UI noise. */}
            {sourcesPresent > 1 && (
              <Select value={sourceFilter} onValueChange={(value) => setSourceFilter(value as SourceFilter)}>
                <SelectTrigger className="h-10 w-full sm:w-[168px]" aria-label="Source filter">
                  <Filter className="mr-2 h-4 w-4 text-muted-foreground" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SOURCE_OPTIONS.map((option) => (
                    <SelectItem key={option.key} value={option.key}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        }
      />

      {/* MP-214 cleanup: dropped Total (= All pill) + Pending Call (= Active pill).
          Kept Called Today (productivity signal) + Hired this Week (brag metric).
          Every tile must earn its pixel. */}
      <section className="mt-4 grid grid-cols-2 gap-2">
        <StatTile icon={PhoneCall} label="Called Today" value={stats.calledToday} tone="emerald" />
        <StatTile icon={Trophy} label="Hired this Week" value={stats.hiredThisWeek} tone="amber" />
      </section>

      {/* 2026-06-18 Sam directive: 'I click contract and it stays there'.
          Active / Done / All pills with live counts so dispositioned rows
          visibly LEAVE the active queue as Sam taps through. Default is
          Active — terminal states (hired/contracted/passed/no_show) hide. */}
      <div className="mt-3 inline-flex items-center gap-1 rounded-full border bg-card p-1 text-xs" role="tablist" aria-label="Queue state filter">
        {(["active", "done", "all"] as const).map((key) => {
          const labelText = key === "active" ? "Active" : key === "done" ? "Done" : "All";
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-pressed={stateFilter === key}
              aria-label={`${labelText} interviews · ${stateCounts[key]} rows`}
              data-cc-filter={key}
              onClick={() => setStateFilter(key)}
              className={cn(
                "min-h-[44px] px-3 py-1.5 rounded-full font-semibold transition-all tabular-nums",
                stateFilter === key
                  ? key === "active"
                    ? "bg-sky-500/20 text-sky-300 border border-sky-500/40"
                    : key === "done"
                      ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                      : "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {key === "active" ? "🔥 Active" : key === "done" ? "✅ Done" : "All"} ({stateCounts[key]})
            </button>
          );
        })}
      </div>

      <div className="mt-4 flex items-center gap-2 rounded-md border bg-card px-3 py-2">
        <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search name, phone, email, IG"
          className="h-9 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0"
          onClick={() => interviews.refetch()}
          aria-label="Refresh interviews"
        >
          <RefreshCw className={cn("h-4 w-4", interviews.isFetching && "animate-spin")} />
        </Button>
      </div>

      {interviews.isLoading ? (
        <InterviewSkeleton />
      ) : interviews.isError ? (
        <div className="mt-4 rounded-md border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-200">
          Could not load interviews.
        </div>
      ) : (
        <section className="mt-4 grid gap-3 xl:grid-cols-2">
          {visibleRows.map((row) => {
            const rk = `${row.source}:${row.id}`;
            const isExiting = exitingRows.has(rk);
            const isBulkSelected = bulkSelected.has(rk);
            return (
              <div
                key={rk}
                data-entity-type={row.source}
                data-entity-id={row.id}
                data-cc-status={row.hired_at || row.contracted_at || row.passed_at || row.no_show_at ? "done" : "active"}
                aria-busy={isExiting}
                className={cn(
                  "transition-all duration-300 ease-out",
                  isExiting && "opacity-0 scale-95 max-h-0 overflow-hidden",
                  !isExiting && "opacity-100 max-h-[800px]",
                )}
              >
                <InterviewCard
                  row={row}
                  savingKey={savingKey}
                  noteDraft={noteDrafts[rowKey(row)]}
                  onDisposition={saveDisposition}
                  onOpenNotes={openNotes}
                  onNoteChange={(value) =>
                    setNoteDrafts((prev) => ({ ...prev, [rowKey(row)]: value }))
                  }
                  onNoteBlur={() => saveNotes(row)}
                  bulkMode={bulkMode}
                  isBulkSelected={isBulkSelected}
                  onToggleBulk={() => {
                    setBulkSelected((prev) => {
                      const next = new Set(prev);
                      if (next.has(rk)) next.delete(rk); else next.add(rk);
                      return next;
                    });
                  }}
                  onEnterBulk={() => {
                    if (!bulkMode) {
                      setBulkMode(true);
                      setBulkSelected(new Set([rk]));
                    }
                  }}
                />
              </div>
            );
          })}
          {!visibleRows.length && (
            <div className="rounded-md border bg-card p-6 text-sm text-muted-foreground">
              No interviews match this view.
            </div>
          )}
        </section>
      )}

      {/* 2026-06-18 MP-214: sticky bulk action bar. Long-press any row enters
          bulk mode → tap others to add → tap a dispo to apply to all. */}
      {bulkMode && (
        <div
          className="fixed bottom-0 left-0 right-0 z-40 border-t border-violet-500/30 bg-card/95 backdrop-blur-md shadow-2xl"
          style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        >
          <div className="mx-auto max-w-5xl flex flex-wrap items-center gap-2 px-3 py-3 sm:px-6">
            <Badge variant="outline" className="bg-violet-500/20 text-violet-300 border-violet-500/40 text-sm font-bold">
              {bulkSelected.size} selected
            </Badge>
            <div className="flex-1 min-w-0 flex flex-wrap gap-1">
              {(["contracted", "hired", "passed", "no_show"] as DispositionField[]).map((field) => (
                <Button
                  key={field}
                  size="sm"
                  variant="outline"
                  className="min-h-[44px] h-11 text-xs gap-1"
                  disabled={!bulkSelected.size}
                  aria-label={`Apply ${field === "no_show" ? "No-Show" : field} to ${bulkSelected.size} selected interviews`}
                  data-cc-bulk={field}
                  onClick={() => {
                    const targets = visibleRows.filter((r) => bulkSelected.has(`${r.source}:${r.id}`));
                    if (!targets.length) return;
                    const label = field === "no_show" ? "No-Show" : field[0].toUpperCase() + field.slice(1);
                    // MP-214 v5 (Codex P1): non-blocking toast confirm.
                    // window.confirm() blocks the main thread on mobile and
                    // ignores Sam's typed-out reason — bad UX. Toast confirm
                    // gives him a 5s window to undo, and stays inline.
                    const id = toast.message(
                      `Apply ${label} to ${targets.length} row${targets.length === 1 ? "" : "s"}?`,
                      {
                        duration: 5000,
                        action: {
                          label: `Yes · ${label} All`,
                          onClick: async () => {
                            for (const row of targets) {
                              try { await saveDisposition(row, field); } catch { /* keep going */ }
                            }
                            setBulkMode(false);
                            setBulkSelected(new Set());
                            toast.success(`✅ ${label} applied to ${targets.length}`);
                            toast.dismiss(id);
                          },
                        },
                      },
                    );
                  }}
                >
                  {field === "contracted" ? "✅ Contract" : field === "hired" ? "🎯 Hire" : field === "passed" ? "Pass" : "🚫 No-Show"} All
                </Button>
              ))}
            </div>
            <Button
              size="sm"
              variant="ghost"
              className="h-8 text-xs"
              onClick={() => { setBulkMode(false); setBulkSelected(new Set()); }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function InterviewCard({
  row,
  savingKey,
  noteDraft,
  onDisposition,
  onOpenNotes,
  onNoteChange,
  onNoteBlur,
  bulkMode = false,
  isBulkSelected = false,
  onToggleBulk,
  onEnterBulk,
}: {
  row: UnifiedInterview;
  savingKey: string | null;
  noteDraft: string | undefined;
  onDisposition: (row: UnifiedInterview, field: DispositionField, value?: string) => Promise<void>;
  onOpenNotes: (row: UnifiedInterview) => void;
  onNoteChange: (value: string) => void;
  onNoteBlur: () => void;
  bulkMode?: boolean;
  isBulkSelected?: boolean;
  onToggleBulk?: () => void;
  onEnterBulk?: () => void;
}) {
  const busy = savingKey?.startsWith(`${row.source}:${row.id}:`) ?? false;
  const handle = normalizeHandle(row.instagram_handle);
  const tone = rowTone(row);
  // MP-214 v5: useRef holds the timer across renders so closures can't
  // orphan it (Codex flagged the prior plain-object pattern as render-loss).
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleTouchStart = () => {
    if (bulkMode) return;
    longPressTimer.current = setTimeout(() => { onEnterBulk?.(); }, 600);
  };
  const handleTouchEnd = () => {
    if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; }
  };
  // Clear timer on unmount so a long-press doesn't fire after navigation.
  useEffect(() => () => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
  }, []);

  // 2026-06-18 UI polish: avatar from initials, bigger header, hover lift.
  const initials = (row.candidate_name ?? "—")
    .split(" ")
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <article
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onTouchMove={handleTouchEnd}
      onClick={bulkMode ? onToggleBulk : undefined}
      className={cn(
        "group relative overflow-hidden rounded-2xl border bg-card p-4 sm:p-5 transition-all duration-200",
        "hover:shadow-xl hover:-translate-y-0.5 hover:border-opacity-100",
        tone.card,
        bulkMode && "cursor-pointer",
        isBulkSelected && "ring-2 ring-violet-500 ring-offset-2 ring-offset-background",
      )}
    >
      {/* subtle glow on hover */}
      <div className="pointer-events-none absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 bg-gradient-to-br from-white/[0.02] to-transparent" />
      {/* 2026-06-18 MP-214: bulk-mode checkbox indicator (top-right). */}
      {bulkMode && (
        <div className={cn(
          "absolute top-3 right-3 z-10 h-6 w-6 rounded-full border-2 flex items-center justify-center transition-colors",
          isBulkSelected
            ? "bg-violet-500 border-violet-500 text-white"
            : "border-muted-foreground/40 bg-card",
        )}>
          {isBulkSelected && <CheckCircle2 className="h-4 w-4" />}
        </div>
      )}

      <div className="relative flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex items-start gap-3 flex-1">
          {/* Initials avatar */}
          <div className={cn(
            "shrink-0 h-11 w-11 rounded-full ring-2 ring-background flex items-center justify-center font-black tabular-nums text-base select-none",
            tone.avatarBg ?? "bg-gradient-to-br from-slate-700 to-slate-800 text-slate-100",
          )}>
            {initials || "—"}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h2 className={cn("min-w-0 truncate text-xl sm:text-2xl font-black leading-tight tracking-tight", tone.title)}>
                {row.candidate_name}
              </h2>
              <Badge variant="outline" className="shrink-0 text-[10px] uppercase tracking-wider font-bold">
                {typeLabel(row.interview_type)}
              </Badge>
              <Badge variant="outline" className={cn("shrink-0 text-[10px] uppercase tracking-wider font-bold", sourceTone(row.source))}>
                {SOURCE_LABEL[row.source]}
              </Badge>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Badge variant="secondary" className="text-[11px] font-mono tabular-nums">
                {formatBusinessTimeWithDay(row.scheduled_at)}
              </Badge>
              <Badge variant="outline" className="text-[11px] font-semibold text-amber-400 border-amber-400/30 bg-amber-400/5">
                {formatRelativeFromNow(row.scheduled_at)}
              </Badge>
              {row.contracted_at && (
                <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/15 text-[11px] text-emerald-300 font-bold">
                  ✅ Contracted
                </Badge>
              )}
              {row.hired_at && !row.contracted_at && (
                <Badge variant="outline" className="border-amber-500/40 bg-amber-500/15 text-[11px] text-amber-200 font-bold">
                  🎯 Hired
                </Badge>
              )}
              {row.no_show_at && (
                <Badge variant="outline" className="border-rose-500/40 bg-rose-500/15 text-[11px] text-rose-200 font-bold">
                  🚫 No-show
                </Badge>
              )}
              {row.passed_at && (
                <Badge variant="outline" className="border-slate-500/40 bg-slate-500/15 text-[11px] text-slate-300 font-bold">
                  Pass
                </Badge>
              )}
            </div>
          </div>
        </div>
        {busy && (
          <div className="shrink-0 flex items-center gap-1.5 text-muted-foreground text-xs">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>saving…</span>
          </div>
        )}
      </div>

      {/* 2026-06-17 Sam directive: extended dispositions — Contacted (initial
          outreach before Called) · Called · Hired · Contracted · Rescheduled ·
          No-Show · Pass · Notes. */}
      <div className="mt-3 grid grid-cols-4 sm:grid-cols-4 gap-1.5">
        <DispositionButton
          active={!!row.contacted_at}
          disabled={busy}
          icon={MessageCircle}
          label="Contacted"
          tone="sky"
          onClick={() => onDisposition(row, "contacted")}
        />
        <DispositionButton
          active={!!row.called_at}
          disabled={busy}
          icon={PhoneCall}
          label="Called"
          tone="emerald"
          onClick={() => onDisposition(row, "called")}
        />
        <DispositionButton
          active={!!row.rescheduled_at}
          disabled={busy}
          icon={Clock}
          label="Reschd"
          tone="violet"
          onClick={() => onDisposition(row, "rescheduled")}
        />
        <DispositionButton
          active={!!row.no_show_at}
          disabled={busy}
          icon={UserX}
          label="No-show"
          tone="rose"
          onClick={() => onDisposition(row, "no_show")}
        />
      </div>
      <div className="mt-1.5 grid grid-cols-4 sm:grid-cols-4 gap-1.5">
        <DispositionButton
          active={!!row.hired_at}
          disabled={busy}
          icon={Trophy}
          label="Hired"
          tone="amber"
          onClick={() => onDisposition(row, "hired")}
        />
        <DispositionButton
          active={!!row.contracted_at}
          disabled={busy}
          icon={CheckCircle2}
          label="Contracted"
          tone="emerald"
          onClick={() => onDisposition(row, "contracted")}
        />
        <DispositionButton
          active={!!row.passed_at}
          disabled={busy}
          icon={XCircle}
          label="Pass"
          tone="slate"
          onClick={() => onDisposition(row, "passed")}
        />
        <DispositionButton
          active={noteDraft !== undefined || !!row.outcome_notes}
          disabled={busy}
          icon={StickyNote}
          label="Notes"
          tone="sky"
          onClick={() => onOpenNotes(row)}
        />
      </div>

      {noteDraft !== undefined && (
        <Textarea
          value={noteDraft}
          onChange={(event) => onNoteChange(event.target.value)}
          onBlur={onNoteBlur}
          placeholder="Result, objection, next call, or hiring note"
          className="mt-3 min-h-[84px]"
          autoFocus
        />
      )}

      {row.outcome_notes && noteDraft === undefined && (
        <div className="mt-3 rounded-md border bg-background/70 p-3 text-sm text-muted-foreground">
          <FileText className="mr-2 inline h-3.5 w-3.5" />
          {row.outcome_notes}
        </div>
      )}

      <div className="mt-3 flex min-w-0 flex-wrap gap-2">
        <ContactLink
          icon={Mail}
          label={row.email || "No email"}
          href={row.email ? `mailto:${row.email}` : null}
        />
        <ContactLink
          icon={Phone}
          label={row.phone || "No phone"}
          href={row.phone ? `tel:${phoneHref(row.phone)}` : null}
        />
        <ContactLink
          icon={Instagram}
          label={handle ? `@${handle}` : "No IG"}
          href={handle ? `https://instagram.com/${handle}` : null}
        />
      </div>
    </article>
  );
}

function DispositionButton({
  active,
  disabled,
  icon: Icon,
  label,
  tone,
  onClick,
}: {
  active: boolean;
  disabled: boolean;
  icon: React.ElementType;
  label: string;
  tone: "emerald" | "amber" | "slate" | "sky" | "violet" | "rose";
  onClick: () => void;
}) {
  const activeTone = {
    emerald: "border-emerald-500/50 bg-emerald-500/15 text-emerald-200",
    amber: "border-amber-500/50 bg-amber-500/15 text-amber-200",
    slate: "border-slate-400/40 bg-slate-500/15 text-slate-200",
    sky: "border-sky-500/50 bg-sky-500/15 text-sky-200",
    violet: "border-violet-500/50 bg-violet-500/15 text-violet-200",
    rose: "border-rose-500/50 bg-rose-500/15 text-rose-200",
  }[tone];

  return (
    <Button
      type="button"
      variant="outline"
      disabled={disabled}
      // MP-214 v5: 44px Apple HIG minimum tap target. aria-pressed signals
      // disposition state to screen readers. data-cc-action lets the
      // upcoming Playwright smoke pin specific buttons by intent.
      aria-pressed={active}
      aria-label={`${label}${active ? " (already set)" : ""}`}
      data-cc-action={label.toLowerCase().replace(/[^a-z0-9]/g, "-")}
      className={cn("min-h-[44px] h-11 gap-1 px-1 text-[11px] sm:text-xs", active && activeTone)}
      onClick={(e) => {
        // Prevent the parent row from interpreting this tap as bulk-select toggle.
        e.stopPropagation();
        onClick();
      }}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate">{label}</span>
    </Button>
  );
}

function ContactLink({
  icon: Icon,
  label,
  href,
}: {
  icon: React.ElementType;
  label: string;
  href: string;
} | {
  icon: React.ElementType;
  label: string;
  href: null;
}) {
  const className =
    "inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-md border bg-background/70 px-2.5 py-1.5 text-xs text-muted-foreground";
  const content = (
    <>
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span className="min-w-0 truncate">{label}</span>
    </>
  );

  if (!href) return <span className={cn(className, "opacity-60")}>{content}</span>;

  return (
    <a href={href} target={href.startsWith("http") ? "_blank" : undefined} rel="noopener noreferrer" className={className}>
      {content}
    </a>
  );
}

function StatTile({
  icon: Icon,
  label,
  value,
  tone = "slate",
}: {
  icon: React.ElementType;
  label: string;
  value: number;
  tone?: "slate" | "emerald" | "amber" | "sky";
}) {
  const tones = {
    slate: "border-slate-500/20 bg-slate-500/5 text-slate-300",
    emerald: "border-emerald-500/25 bg-emerald-500/10 text-emerald-300",
    amber: "border-amber-500/25 bg-amber-500/10 text-amber-300",
    sky: "border-sky-500/25 bg-sky-500/10 text-sky-300",
  };

  return (
    <div className={cn("rounded-md border p-3", tones[tone])}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-muted-foreground">{label}</span>
        <Icon className="h-4 w-4 shrink-0" />
      </div>
      <div className="mt-1 text-2xl font-black tabular-nums text-foreground">{value}</div>
    </div>
  );
}

function InterviewSkeleton() {
  return (
    <section className="mt-4 grid gap-3 xl:grid-cols-2">
      {Array.from({ length: 6 }).map((_, index) => (
        <div key={index} className="rounded-md border bg-card p-4">
          <Skeleton className="h-6 w-2/3" />
          <div className="mt-3 grid grid-cols-4 gap-1.5">
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
          </div>
          <Skeleton className="mt-3 h-8 w-full" />
        </div>
      ))}
    </section>
  );
}

function rowTone(row: UnifiedInterview) {
  // 2026-06-18 polish: extended tones include avatar background gradient.
  if (row.no_show_at) {
    return {
      card: "border-rose-500/40 bg-gradient-to-br from-rose-500/10 to-rose-500/5",
      title: "text-rose-100",
      avatarBg: "bg-gradient-to-br from-rose-500 to-rose-700 text-white shadow-rose-500/40 shadow-md",
    };
  }
  if (row.passed_at) {
    return {
      card: "border-slate-500/25 bg-slate-500/5 opacity-75",
      title: "text-slate-200",
      avatarBg: "bg-gradient-to-br from-slate-600 to-slate-800 text-slate-200",
    };
  }
  if (row.contracted_at) {
    return {
      card: "border-emerald-500/55 bg-gradient-to-br from-emerald-500/15 to-emerald-500/5",
      title: "text-emerald-50",
      avatarBg: "bg-gradient-to-br from-emerald-400 to-emerald-700 text-white shadow-emerald-500/40 shadow-md",
    };
  }
  if (row.hired_at) {
    return {
      card: "border-amber-500/45 bg-gradient-to-br from-amber-500/10 to-amber-500/5",
      title: "text-amber-100",
      avatarBg: "bg-gradient-to-br from-amber-400 to-amber-700 text-white shadow-amber-500/40 shadow-md",
    };
  }
  if (row.rescheduled_at && !row.called_at) {
    return {
      card: "border-violet-500/40 bg-gradient-to-br from-violet-500/10 to-violet-500/5",
      title: "text-violet-100",
      avatarBg: "bg-gradient-to-br from-violet-500 to-violet-700 text-white",
    };
  }
  if (row.called_at) {
    return {
      card: "border-emerald-500/40 bg-gradient-to-br from-emerald-500/10 to-emerald-500/5",
      title: "text-emerald-100",
      avatarBg: "bg-gradient-to-br from-emerald-500 to-emerald-700 text-white",
    };
  }
  if (row.contacted_at) {
    return {
      card: "border-sky-500/40 bg-gradient-to-br from-sky-500/10 to-sky-500/5",
      title: "text-sky-100",
      avatarBg: "bg-gradient-to-br from-sky-500 to-sky-700 text-white",
    };
  }
  return {
    card: "border-border bg-gradient-to-br from-card/80 to-card/40",
    title: "text-foreground",
    avatarBg: "bg-gradient-to-br from-amber-400 via-amber-500 to-amber-600 text-amber-950 shadow-md shadow-amber-500/30",
  };
}

function sourceTone(source: InterviewSource) {
  if (source === "manual") return "border-cyan-500/30 bg-cyan-500/10 text-cyan-300";
  if (source === "calendly") return "border-sky-500/30 bg-sky-500/10 text-sky-300";
  return "border-amber-500/30 bg-amber-500/10 text-amber-300";
}

function successLabel(field: DispositionField) {
  if (field === "called") return "Marked called";
  if (field === "hired") return "Marked hired";
  if (field === "passed") return "Marked passed";
  if (field === "contracted") return "Marked contracted";
  if (field === "rescheduled") return "Marked rescheduled";
  if (field === "no_show") return "Marked no-show";
  if (field === "contacted") return "Marked contacted";
  return "Notes saved";
}

function typeLabel(value: string | null) {
  if (!value) return "Interview";
  return value
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function rowKey(row: UnifiedInterview) {
  return `${row.source}:${row.id}`;
}

function omitKey<T>(record: Record<string, T>, key: string) {
  const next = { ...record };
  delete next[key];
  return next;
}

function normalizeHandle(value: string | null) {
  return (value ?? "").trim().replace(/^@+/, "");
}

function phoneHref(value: string) {
  return value.replace(/[^\d+]/g, "");
}

// MP-214 v5 (Codex P0): date filters MUST use America/Chicago, not browser
// local time. APEX is Chicago-based — Sam triages from anywhere (Phoenix
// during flights, Atlanta with family, etc), and 'Today' must mean the
// Chicago calendar day or hires-this-week sits on the wrong row.
const CHICAGO = "America/Chicago";

// Return Chicago calendar date as YYYY-MM-DD. Lexicographically comparable.
function chicagoYMD(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: CHICAGO,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

// Return the Chicago YMD of the Monday on or before the given Chicago YMD.
function chicagoStartOfWeekYMD(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  // Compute weekday at noon Chicago (avoid DST midnight ambiguity).
  const probe = new Date(Date.UTC(y, m - 1, d, 18, 0, 0));
  const dayName = new Intl.DateTimeFormat("en-US", {
    timeZone: CHICAGO,
    weekday: "short",
  }).format(probe);
  const offset = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 }[dayName] ?? 0;
  const monday = new Date(Date.UTC(y, m - 1, d - offset, 18, 0, 0));
  return chicagoYMD(monday);
}

function startOfToday(): Date {
  // Kept for stats compute (uses Date comparison via UTC). Returns the UTC
  // instant corresponding to Chicago-midnight today.
  const ymd = chicagoYMD(new Date());
  const [y, m, d] = ymd.split("-").map(Number);
  // 00:00 Chicago is 05:00 UTC (CDT) or 06:00 UTC (CST). DST-aware via probe.
  const probe = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const offsetStr = new Intl.DateTimeFormat("en-US", {
    timeZone: CHICAGO,
    timeZoneName: "shortOffset",
  })
    .formatToParts(probe)
    .find((p) => p.type === "timeZoneName")
    ?.value.replace(/^GMT/, "");
  const offsetMin = -(offsetStr ? offsetStr.split(":").reduce((acc, n, i) => acc + Number(n) * (i === 0 ? 60 : 1), 0) : -360);
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0) + offsetMin * 60_000);
}

function startOfWeek(): Date {
  const ymd = chicagoStartOfWeekYMD(chicagoYMD(new Date()));
  const [y, m, d] = ymd.split("-").map(Number);
  const probe = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const offsetStr = new Intl.DateTimeFormat("en-US", {
    timeZone: CHICAGO,
    timeZoneName: "shortOffset",
  })
    .formatToParts(probe)
    .find((p) => p.type === "timeZoneName")
    ?.value.replace(/^GMT/, "");
  const offsetMin = -(offsetStr ? offsetStr.split(":").reduce((acc, n, i) => acc + Number(n) * (i === 0 ? 60 : 1), 0) : -360);
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0) + offsetMin * 60_000);
}

function isInDateFilter(value: string, filter: DateFilter): boolean {
  const candidate = new Date(value);
  if (Number.isNaN(candidate.getTime())) return false;
  const cYMD = chicagoYMD(candidate);
  const todayYMD = chicagoYMD(new Date());

  if (filter === "today") return cYMD === todayYMD;

  if (filter === "week") {
    const weekStartYMD = chicagoStartOfWeekYMD(todayYMD);
    return cYMD >= weekStartYMD;
  }

  // month
  const monthStartYMD = todayYMD.slice(0, 7) + "-01";
  return cYMD >= monthStartYMD;
}
