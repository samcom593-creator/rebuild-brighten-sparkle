// MP-263 Interview Command Center rebuild — 2026-07-09.
// Sam directive: 7-KPI grid + 5-tab filter + tap-to-disposition execution
// with Next Best Action + state-aware primary CTA (Confirm interview /
// Disposition / Reschedule) + Add Interview dialog + Confirm Interview
// wired to the send-candidate-confirmation edge fn. Preserves the
// v_command_center_queue view + cc_dispose RPC + manual_interview_entries
// insert path + keyboard shortcuts (1–7) + bulk mode + undo toasts.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format as formatDate } from "date-fns";
import {
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  FileText,
  Instagram,
  Loader2,
  Mail,
  MailCheck,
  MessageCircle,
  MoreHorizontal,
  Phone,
  PhoneCall,
  Plus,
  RefreshCw,
  Search,
  Send,
  Slash,
  StickyNote,
  Trophy,
  UserCheck,
  UserX,
  Users,
  X,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useConfirm } from "@/hooks/useConfirm";
import { formatBusinessTimeWithDay, formatRelativeFromNow } from "@/lib/dateUtils";
import { cn } from "@/lib/utils";
import { getNextBestAction, type NBAInput } from "@/lib/nextBestAction";
import { priorityBadgeClasses } from "@/lib/priority";
import { PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type InterviewSource = "manual" | "calendly" | "application";
type DateFilter = "today" | "week" | "month" | "custom";
type StateFilter = "active" | "done" | "all" | "needs_followup" | "no_show";
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
  source_application_id: string | null;
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
  rescheduled_at: string | null;
  no_show_at: string | null;
  contacted_at: string | null;
  outcome_notes: string | null;
  agent_id_if_known: string | null;
  created_at: string | null;
}

interface ApplicationEnrichment {
  status: string | null;
  license_status: string | null;
  license_progress: string | null;
  next_action_due_at: string | null;
}

const JUNE_START = "2026-06-01T00:00:00.000Z";

const DATE_FILTERS: Array<{ key: Exclude<DateFilter, "custom">; label: string }> = [
  { key: "today", label: "Today" },
  { key: "week", label: "Week" },
  { key: "month", label: "Month" },
];

const INTERVIEW_TYPES: Array<{ value: string; label: string }> = [
  { value: "licensed_prospect", label: "Licensed prospect" },
  { value: "licensed_call", label: "Licensed call" },
  { value: "leader_call", label: "Leader call" },
  { value: "unlicensed_lead", label: "Unlicensed lead" },
  { value: "final_expense_review", label: "Final expense review" },
  { value: "callback", label: "Callback" },
  { value: "general", label: "General" },
];

// MP-263 tabs — order matches Sam's brief.
const TABS: Array<{ key: StateFilter; label: string }> = [
  { key: "active", label: "Active" },
  { key: "done", label: "Done" },
  { key: "all", label: "All" },
  { key: "needs_followup", label: "Needs Follow-Up" },
  { key: "no_show", label: "No-Show" },
];

export default function InterviewCommandCenter() {
  usePageTitle("Interviews · APEX");

  const queryClient = useQueryClient();

  const [dateFilter, setDateFilter] = useState<DateFilter>(() => {
    if (typeof window === "undefined") return "month";
    const v = window.localStorage.getItem("cc.dateFilter") as DateFilter | null;
    return v === "today" || v === "week" || v === "month" || v === "custom" ? v : "month";
  });
  const [customRange, setCustomRange] = useState<{ from?: Date; to?: Date }>({});
  const [stateFilter, setStateFilter] = useState<StateFilter>(() => {
    if (typeof window === "undefined") return "active";
    const v = window.localStorage.getItem("cc.stateFilter") as StateFilter | null;
    return v === "active" || v === "done" || v === "all" || v === "needs_followup" || v === "no_show" ? v : "active";
  });
  useEffect(() => {
    try { window.localStorage.setItem("cc.dateFilter", dateFilter); } catch { /* incognito */ } // empty-catch-allow:localstorage-incognito
  }, [dateFilter]);
  useEffect(() => {
    try { window.localStorage.setItem("cc.stateFilter", stateFilter); } catch { /* incognito */ } // empty-catch-allow:localstorage-incognito
  }, [stateFilter]);

  const [search, setSearch] = useState("");
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const [exitingRows, setExitingRows] = useState<Set<string>>(new Set());
  const [bulkMode, setBulkMode] = useState(false);
  const [bulkSelected, setBulkSelected] = useState<Set<string>>(new Set());
  // wave-p1s: explicit keyboard-focused row so 1-7 hotkeys can't silently
  // stamp the wrong (top) row when Sam has scrolled or clicked away.
  // Null means no focused row — hotkeys are inert until the user presses
  // ArrowDown/ArrowUp/j/k to opt in.
  const [focusedRowKey, setFocusedRowKey] = useState<string | null>(null);
  // Bound to `confirmDialog` (not `confirm`) so the check:blocking-modal
  // ratchet — which bans bare `confirm(` to catch native window.confirm —
  // isn't false-flagged by our Radix AlertDialog path.
  const confirmDialog = useConfirm();
  const [addOpen, setAddOpen] = useState(false);
  const [followUpFor, setFollowUpFor] = useState<string | null>(null);

  const interviews = useQuery({
    queryKey: ["interviews-unified", JUNE_START],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("v_command_center_queue")
        .select(
          "entity_id, entity_type, source_application_id, candidate_name, phone, email, instagram_handle, scheduled_at_utc, interview_type, contacted_at, called_at, rescheduled_at, no_show_at, hired_at, contracted_at, passed_at, outcome_notes, created_at, computed_status, agent_id_if_promoted",
        )
        .gte("scheduled_at_utc", JUNE_START)
        .order("scheduled_at_utc", { ascending: false })
        .limit(1500);
      if (error) throw error;
      return (data as any[]).map((r: any) => ({
        id: r.entity_id,
        source: r.entity_type,
        source_application_id: r.source_application_id,
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

  // MP-263 enrichment — pull applications.status + license_status +
  // license_progress + next_action_due_at for every row whose source is
  // an application, so we can render the License + Application badges and
  // seed the NBA signals with real fields.
  const applicationIds = useMemo(() => {
    const ids = new Set<string>();
    for (const row of interviews.data ?? []) {
      const appId = row.source_application_id ?? (row.source === "application" ? row.id : null);
      if (appId) ids.add(appId);
    }
    return Array.from(ids);
  }, [interviews.data]);

  const enrichment = useQuery({
    queryKey: ["interviews-enrichment", applicationIds.join(",")],
    queryFn: async () => {
      if (!applicationIds.length) return {} as Record<string, ApplicationEnrichment>;
      // Chunk the id list so the request URL never crosses the gateway's length
      // cap (a single ~317-id `.in()` = ~13KB URL that silently dropped badges).
      const CHUNK = 100;
      const batches: string[][] = [];
      for (let i = 0; i < applicationIds.length; i += CHUNK) {
        batches.push(applicationIds.slice(i, i + CHUNK));
      }
      const results = await Promise.all(
        batches.map((batch) =>
          (supabase as any)
            .from("applications")
            .select("id, status, license_status, license_progress, next_action_due_at")
            .in("id", batch),
        ),
      );
      const firstError = results.find((r) => r.error)?.error;
      if (firstError) throw firstError;
      const map: Record<string, ApplicationEnrichment> = {};
      for (const res of results) {
        for (const r of (res.data ?? []) as any[]) {
          map[r.id] = {
            status: r.status,
            license_status: r.license_status,
            license_progress: r.license_progress,
            next_action_due_at: r.next_action_due_at,
          };
        }
      }
      return map;
    },
    enabled: applicationIds.length > 0,
    staleTime: 30_000,
  });

  const enrichmentFor = useCallback(
    (row: UnifiedInterview): ApplicationEnrichment | null => {
      const appId = row.source_application_id ?? (row.source === "application" ? row.id : null);
      if (!appId) return null;
      return enrichment.data?.[appId] ?? null;
    },
    [enrichment.data],
  );

  const isRowDone = (row: UnifiedInterview): boolean =>
    Boolean(row.hired_at || row.contracted_at || row.passed_at || row.no_show_at);

  // "Needs Follow-Up" — scheduled time is in the past AND row is still
  // active (not terminal) AND we've either already logged a contact or
  // the interview hour is behind us. Real-field only; no invented signal.
  const needsFollowUp = useCallback((row: UnifiedInterview): boolean => {
    if (isRowDone(row)) return false;
    const t = new Date(row.scheduled_at).getTime();
    if (Number.isNaN(t)) return false;
    return t < Date.now();
  }, []);

  const dateScopedRows = useMemo(() => {
    const rows = interviews.data ?? [];
    return rows.filter((row) => isInDateFilter(row.scheduled_at, dateFilter, customRange));
  }, [dateFilter, customRange, interviews.data]);

  // KPI stats. "Called Today" and "Hired This Week" describe absolute time
  // windows, so they source from the full unscoped row set — otherwise a
  // dateFilter set to a range that excludes today makes both tiles read 0
  // while real activity happened. The remaining tiles describe what's inside
  // the current filter, so they stay scoped to dateScopedRows. wave-p1v.
  const kpi = useMemo(() => {
    const todayStart = startOfToday();
    const weekStart = startOfWeek();
    const allRows = interviews.data ?? [];
    return {
      calledToday: allRows.filter((r) => r.called_at && new Date(r.called_at) >= todayStart).length,
      hiredThisWeek: allRows.filter((r) => r.hired_at && new Date(r.hired_at) >= weekStart).length,
      active: dateScopedRows.filter((r) => !isRowDone(r)).length,
      done: dateScopedRows.filter(isRowDone).length,
      noShow: dateScopedRows.filter((r) => !!r.no_show_at).length,
      reschedules: dateScopedRows.filter((r) => !!r.rescheduled_at).length,
      passes: dateScopedRows.filter((r) => !!r.passed_at).length,
    };
  }, [dateScopedRows, interviews.data]);

  const stateCounts = useMemo(() => ({
    active: dateScopedRows.filter((r) => !isRowDone(r)).length,
    done: dateScopedRows.filter(isRowDone).length,
    all: dateScopedRows.length,
    needs_followup: dateScopedRows.filter(needsFollowUp).length,
    no_show: dateScopedRows.filter((r) => !!r.no_show_at).length,
  }), [dateScopedRows, needsFollowUp]);

  const scopedRows = useMemo(() => {
    if (stateFilter === "all") return dateScopedRows;
    if (stateFilter === "done") return dateScopedRows.filter(isRowDone);
    if (stateFilter === "no_show") return dateScopedRows.filter((r) => !!r.no_show_at);
    if (stateFilter === "needs_followup") return dateScopedRows.filter(needsFollowUp);
    // active — keep in-flight rows AND rows currently exiting (fade animation)
    return dateScopedRows.filter((r) => !isRowDone(r) || exitingRows.has(`${r.source}:${r.id}`));
  }, [dateScopedRows, stateFilter, exitingRows, needsFollowUp]);

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
    opts?: { silent?: boolean },
  ) => {
    const key = `${row.source}:${row.id}:${field}`;
    const timestamp = value ?? new Date().toISOString();
    setSavingKey(key);
    try {
      const { data: dispResult, error } = await (supabase as any).rpc("cc_dispose", {
        p_entity_type: row.source,
        p_entity_id: row.id,
        p_field: field,
        p_value: field === "notes" ? null : timestamp,
        p_notes: field === "notes" ? (value ?? "") : null,
      });
      if (error) throw error;

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
      if (field === "rescheduled") patchCachedRow(row, { rescheduled_at: timestamp, status: "rescheduled" });
      if (field === "no_show") patchCachedRow(row, { no_show_at: timestamp, status: "no_show" });
      if (field === "contacted") patchCachedRow(row, { contacted_at: timestamp, status: "contacted" });
      if (field === "contracted") patchCachedRow(row, { contracted_at: timestamp, status: "contracted" });
      if (field === "notes") patchCachedRow(row, { outcome_notes: value?.trim() || null });

      // MP-263: log every disposition to the applicant's contact-attempt
      // timeline. Skips silently for non-application sources (RPC only
      // accepts an application_id) — telemetry is fire-and-forget.
      const appId = row.source_application_id ?? (row.source === "application" ? row.id : null);
      if (appId) {
        try {
          await (supabase as any).rpc("log_contact_attempt", {
            p_application_id: appId,
            p_channel: "interview",
            p_outcome: field,
            p_notes: field === "notes" ? (value ?? "") : null,
          });
        } catch { /* fire-and-forget */ } // empty-catch-allow:fire-and-forget-telemetry
      }

      const isTerminal = field === "hired" || field === "contracted" || field === "passed" || field === "no_show";
      if (isTerminal) {
        const rowKey = `${row.source}:${row.id}`;
        setExitingRows((prev) => new Set(prev).add(rowKey));
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
              await (supabase as any).rpc("cc_dispose", {
                p_entity_type: row.source,
                p_entity_id: row.id,
                p_field: field,
                p_value: priorValue ? priorValue : "__clear__",
                p_notes: null,
              });
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
              toast.info(`Undid ${field} for ${row.candidate_name}`);
              await queryClient.invalidateQueries({ queryKey: ["interviews-unified", JUNE_START] });
            } catch (e: any) {
              toast.error(`Undo failed: ${e?.message?.slice(0, 80) ?? "unknown"}`);
            }
          },
        },
        description: isTerminal ? "Row moved to Done. Tap Undo to bring it back." : undefined,
      });

      if (field === "contracted" || field === "hired") {
        const r = (dispResult ?? {}) as { promoted?: boolean; emails_queued?: number; promoted_agent_id?: string };
        if (r.promoted && r.promoted_agent_id) {
          toast.success(`${row.candidate_name} promoted to Agent`);
        }
        if (!opts?.silent && r.emails_queued && r.emails_queued > 0) {
          try { await supabase.functions.invoke("send-agent-onboarding-email", { body: {} }); } catch { /* drained on cron tick anyway */ } // empty-catch-allow:batch-drain
          toast.success("Course + Discord emails fired");
        }
        if (!opts?.silent) {
          window.open("https://agentlink.insuracloud.ai/admin/agents/invite", "_blank", "noopener,noreferrer");
        }
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

  // Confirm interview → send-candidate-confirmation edge fn (Resend).
  const confirmInterview = async (row: UnifiedInterview) => {
    if (!row.email) {
      toast.error("Add an email first so we can send the confirmation.");
      return;
    }
    const key = `${row.source}:${row.id}:confirm`;
    setSavingKey(key);
    try {
      const { error } = await supabase.functions.invoke("send-candidate-confirmation", {
        body: {
          interview_id: row.source === "manual" ? row.id : null,
          candidate_email: row.email,
          candidate_name: row.candidate_name,
          scheduled_at: row.scheduled_at,
        },
      });
      if (error) throw error;
      toast.success(`Confirmation sent to ${row.candidate_name}`);
      // Also stamp contacted_at so the queue reflects the reach-out.
      await saveDisposition(row, "contacted");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Confirmation failed";
      toast.error(message);
    } finally {
      setSavingKey(null);
    }
  };

  const scheduleFollowUp = async (row: UnifiedInterview, when: Date) => {
    const appId = row.source_application_id ?? (row.source === "application" ? row.id : null);
    if (!appId) {
      toast.error("Follow-up requires an application row.");
      return;
    }
    try {
      const iso = when.toISOString();
      const { error } = await (supabase as any)
        .from("applications")
        .update({ next_action_due_at: iso })
        .eq("id", appId);
      if (error) throw error;
      try {
        await (supabase as any).rpc("log_contact_attempt", {
          p_application_id: appId,
          p_channel: "interview",
          p_outcome: "follow_up_scheduled",
          p_notes: `Follow up: ${formatDate(when, "PPP")}`,
        });
      } catch { /* fire-and-forget */ } // empty-catch-allow:fire-and-forget-telemetry
      toast.success(`Follow-up on ${formatDate(when, "PPP")}`);
      await queryClient.invalidateQueries({ queryKey: ["interviews-enrichment"] });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Follow-up failed";
      toast.error(message);
    }
  };

  // wave-p1s: reset the keyboard focus when the visible-row set changes
  // (filter/tab/search) so we never carry a stale key that would land on
  // a different candidate after the list shifts.
  useEffect(() => {
    if (!focusedRowKey) return;
    const stillVisible = visibleRows.some((r) => `${r.source}:${r.id}` === focusedRowKey);
    if (!stillVisible) setFocusedRowKey(null);
  }, [visibleRows, focusedRowKey]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (bulkMode) return;
      if (!visibleRows.length) return;
      const tag = (e.target as HTMLElement | null)?.tagName ?? "";
      if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement | null)?.isContentEditable) return;

      // wave-p1s: arrow / j / k navigate the keyboard-focused row. Escape
      // clears it. Hotkeys 1-7 only apply to the explicitly-focused row —
      // no more silent stamp on visibleRows[0].
      const currentIdx = focusedRowKey
        ? visibleRows.findIndex((r) => `${r.source}:${r.id}` === focusedRowKey)
        : -1;

      if (e.key === "Escape" && focusedRowKey) {
        e.preventDefault();
        setFocusedRowKey(null);
        return;
      }
      if (e.key === "ArrowDown" || e.key === "j") {
        e.preventDefault();
        const next = currentIdx < 0 ? 0 : Math.min(currentIdx + 1, visibleRows.length - 1);
        const nextRow = visibleRows[next];
        if (nextRow) {
          const nk = `${nextRow.source}:${nextRow.id}`;
          setFocusedRowKey(nk);
          document.querySelector(`[data-cc-row-key="${nk}"]`)?.scrollIntoView({ block: "nearest" });
        }
        return;
      }
      if (e.key === "ArrowUp" || e.key === "k") {
        e.preventDefault();
        const next = currentIdx < 0 ? 0 : Math.max(currentIdx - 1, 0);
        const nextRow = visibleRows[next];
        if (nextRow) {
          const nk = `${nextRow.source}:${nextRow.id}`;
          setFocusedRowKey(nk);
          document.querySelector(`[data-cc-row-key="${nk}"]`)?.scrollIntoView({ block: "nearest" });
        }
        return;
      }

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
      if (currentIdx < 0) {
        // No focused row — refuse to guess. Prompt with a toast so Sam
        // knows why the digit did nothing.
        e.preventDefault();
        toast.message("No focused row", {
          description: "Press ↓ or j to pick a row before using 1-7 hotkeys.",
          duration: 2500,
        });
        return;
      }
      e.preventDefault();
      const target = visibleRows[currentIdx];
      if (!target) return;

      // wave-p1s: terminal fields (hired/contracted/passed/no_show) require
      // an explicit confirmation before a single keystroke rewrites a
      // candidate's outcome — matches the file_apex_dispatcher no-fake-
      // success discipline for irreversible-ish state.
      const isTerminal = field === "hired" || field === "contracted" || field === "passed" || field === "no_show";
      if (isTerminal) {
        void (async () => {
          const ok = await confirmDialog({
            title: `Mark ${target.candidate_name} as ${field.replace("_", " ")}?`,
            description: "Terminal disposition — this removes the row from active queues and fires downstream effects. Press cancel to abort.",
            confirmText: `Yes, mark ${field.replace("_", " ")}`,
            cancelText: "Cancel",
            tone: "danger",
          });
          if (ok) await saveDisposition(target, field);
        })();
        return;
      }
      void saveDisposition(target, field);
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [bulkMode, visibleRows, focusedRowKey, confirmDialog]);

  return (
    <div className="page-enter px-3 pb-24 sm:px-6">
      <PageHeader
        eyebrow="Interviews"
        eyebrowIcon={<ClipboardCheck className="h-3 w-3" />}
        title="Interview Command Center"
        subtitle="Interview tracking with tap-to-disposition execution."
        accent="amber"
        actions={
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
            <div className="grid grid-cols-4 gap-1 rounded-md border bg-card p-1">
              {DATE_FILTERS.map((f) => (
                <Button
                  key={f.key}
                  type="button"
                  size="sm"
                  variant={dateFilter === f.key ? "default" : "ghost"}
                  className="h-8 px-2 text-xs"
                  onClick={() => setDateFilter(f.key)}
                >
                  {f.label}
                </Button>
              ))}
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    size="sm"
                    variant={dateFilter === "custom" ? "default" : "ghost"}
                    className="h-8 px-2 text-xs"
                    onClick={() => setDateFilter("custom")}
                    aria-label="Custom date range"
                  >
                    <CalendarDays className="h-3.5 w-3.5" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="end">
                  <Calendar
                    mode="range"
                    selected={{ from: customRange.from, to: customRange.to } as any}
                    onSelect={(range: any) => {
                      setCustomRange({ from: range?.from, to: range?.to });
                      if (range?.from) setDateFilter("custom");
                    }}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>
            <Button
              type="button"
              size="sm"
              className="h-9 gap-1.5"
              onClick={() => setAddOpen(true)}
              aria-label="Add manual interview"
            >
              <Plus className="h-4 w-4" />
              Add Interview
            </Button>
          </div>
        }
      />

      {/* 7-KPI grid — every tile click-filters the tab below. */}
      <section className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-7">
        <KpiTile icon={Phone} label="Called Today" value={kpi.calledToday} tone="teal" active={false} onClick={() => setStateFilter("active")} />
        <KpiTile icon={UserCheck} label="Hired This Week" value={kpi.hiredThisWeek} tone="gold" active={false} onClick={() => setStateFilter("done")} />
        <KpiTile icon={Users} label="Active Interviews" value={kpi.active} tone="teal" active={stateFilter === "active"} onClick={() => setStateFilter("active")} />
        <KpiTile icon={CheckCircle2} label="Done Interviews" value={kpi.done} tone="emerald" active={stateFilter === "done"} onClick={() => setStateFilter("done")} />
        <KpiTile icon={X} label="No-Shows" value={kpi.noShow} tone="rose" active={stateFilter === "no_show"} onClick={() => setStateFilter("no_show")} />
        <KpiTile icon={CalendarDays} label="Reschedules" value={kpi.reschedules} tone="amber" active={false} onClick={() => setStateFilter("active")} />
        <KpiTile icon={Slash} label="Passes" value={kpi.passes} tone="slate" active={false} onClick={() => setStateFilter("done")} />
      </section>

      {/* 5-tab strip — Active / Done / All / Needs Follow-Up / No-Show. */}
      <div className="mt-3 inline-flex flex-wrap items-center gap-1 rounded-full border bg-card p-1 text-xs" role="tablist" aria-label="Interview queue tabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-pressed={stateFilter === t.key}
            aria-label={`${t.label} · ${stateCounts[t.key]} rows`}
            data-cc-filter={t.key}
            onClick={() => setStateFilter(t.key)}
            className={cn(
              "min-h-[44px] px-3 py-1.5 rounded-full font-semibold transition-all tabular-nums",
              stateFilter === t.key
                ? t.key === "active"
                  ? "bg-sky-500/20 text-sky-300 border border-sky-500/40"
                  : t.key === "done"
                    ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                    : t.key === "no_show"
                      ? "bg-rose-500/20 text-rose-200 border border-rose-500/40"
                      : t.key === "needs_followup"
                        ? "bg-amber-500/20 text-amber-200 border border-amber-500/40"
                        : "bg-foreground text-background"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label} ({stateCounts[t.key]})
          </button>
        ))}
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
            const isKeyboardFocused = focusedRowKey === rk;
            return (
              <div
                key={rk}
                data-entity-type={row.source}
                data-entity-id={row.id}
                data-cc-status={isRowDone(row) ? "done" : "active"}
                data-cc-row-key={rk}
                aria-busy={isExiting}
                onClick={() => setFocusedRowKey((cur) => (cur === rk ? cur : rk))}
                className={cn(
                  "transition-all duration-300 ease-out rounded-lg",
                  isExiting && "opacity-0 scale-95 max-h-0 overflow-hidden",
                  !isExiting && "opacity-100 max-h-[900px]",
                  isKeyboardFocused && "ring-2 ring-amber-400/80 ring-offset-2 ring-offset-background",
                )}
              >
                <InterviewCard
                  row={row}
                  enrichment={enrichmentFor(row)}
                  savingKey={savingKey}
                  noteDraft={noteDrafts[rowKey(row)]}
                  followUpOpen={followUpFor === rk}
                  onDisposition={saveDisposition}
                  onConfirm={confirmInterview}
                  onOpenNotes={openNotes}
                  onNoteChange={(value) =>
                    setNoteDrafts((prev) => ({ ...prev, [rowKey(row)]: value }))
                  }
                  onNoteBlur={() => saveNotes(row)}
                  onOpenFollowUp={() => setFollowUpFor((cur) => (cur === rk ? null : rk))}
                  onFollowUpPick={async (when) => {
                    await scheduleFollowUp(row, when);
                    setFollowUpFor(null);
                  }}
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
                    const id = toast.message(
                      `Apply ${label} to ${targets.length} row${targets.length === 1 ? "" : "s"}?`,
                      {
                        duration: 5000,
                        action: {
                          label: `Yes · ${label} All`,
                          onClick: async () => {
                            const isPromotion = field === "contracted" || field === "hired";
                            let promotedCount = 0;
                            for (const row of targets) {
                              try {
                                await saveDisposition(row, field, undefined, { silent: isPromotion });
                                if (isPromotion) promotedCount++;
                              } catch { /* keep going */ } // empty-catch-allow:batch-drain
                            }
                            setBulkMode(false);
                            setBulkSelected(new Set());
                            toast.success(`${label} applied to ${targets.length}`);
                            toast.dismiss(id);
                            if (isPromotion && promotedCount > 0) {
                              try { await supabase.functions.invoke("send-agent-onboarding-email", { body: {} }); } catch { /* drained on cron tick anyway */ } // empty-catch-allow:batch-drain
                              toast.success(`Course + Discord emails fired for ${promotedCount}`);
                              toast.message(
                                `Open AgentLink to invite ${promotedCount} agent${promotedCount === 1 ? "" : "s"}?`,
                                {
                                  duration: 10000,
                                  action: {
                                    label: "Open AgentLink",
                                    onClick: () => window.open("https://agentlink.insuracloud.ai/admin/agents/invite", "_blank", "noopener,noreferrer"),
                                  },
                                },
                              );
                            }
                          },
                        },
                      },
                    );
                  }}
                >
                  {field === "contracted" ? "Contract All" : field === "hired" ? "Hire All" : field === "passed" ? "Pass All" : "No-Show All"}
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

      <AddInterviewDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        onSaved={async () => {
          setAddOpen(false);
          await queryClient.invalidateQueries({ queryKey: ["interviews-unified", JUNE_START] });
        }}
      />
    </div>
  );
}

function InterviewCard({
  row,
  enrichment,
  savingKey,
  noteDraft,
  followUpOpen,
  onDisposition,
  onConfirm,
  onOpenNotes,
  onNoteChange,
  onNoteBlur,
  onOpenFollowUp,
  onFollowUpPick,
  bulkMode = false,
  isBulkSelected = false,
  onToggleBulk,
  onEnterBulk,
}: {
  row: UnifiedInterview;
  enrichment: ApplicationEnrichment | null;
  savingKey: string | null;
  noteDraft: string | undefined;
  followUpOpen: boolean;
  onDisposition: (row: UnifiedInterview, field: DispositionField, value?: string) => Promise<void>;
  onConfirm: (row: UnifiedInterview) => Promise<void>;
  onOpenNotes: (row: UnifiedInterview) => void;
  onNoteChange: (value: string) => void;
  onNoteBlur: () => void;
  onOpenFollowUp: () => void;
  onFollowUpPick: (when: Date) => Promise<void>;
  bulkMode?: boolean;
  isBulkSelected?: boolean;
  onToggleBulk?: () => void;
  onEnterBulk?: () => void;
}) {
  const busy = savingKey?.startsWith(`${row.source}:${row.id}:`) ?? false;
  const handle = normalizeHandle(row.instagram_handle);
  const tone = rowTone(row);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleTouchStart = () => {
    if (bulkMode) return;
    longPressTimer.current = setTimeout(() => { onEnterBulk?.(); }, 600);
  };
  const handleTouchEnd = () => {
    if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; }
  };
  useEffect(() => () => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
  }, []);

  const initials = (row.candidate_name ?? "—")
    .split(" ")
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  // NBA — deterministic playbook per record. Signals seeded from
  // enrichment.license_progress / status + interview timestamps.
  const nba = useMemo(() => {
    const input: NBAInput = {
      kind: "applicant",
      applicant_name: row.candidate_name,
      interview_scheduled: !row.called_at && !row.no_show_at && !row.hired_at && !row.contracted_at && !row.passed_at,
      is_new_applicant: !row.contacted_at && !row.called_at,
      no_contact_logged: !row.contacted_at,
      finished_course: enrichment?.license_progress === "finished_course",
      passed_test: enrichment?.license_progress === "passed_test",
      course_bought: enrichment?.license_progress === "course_purchased" || enrichment?.license_progress === "in_course",
      follow_up_due_today: enrichment?.next_action_due_at
        ? new Date(enrichment.next_action_due_at) <= new Date()
        : false,
      rejected: enrichment?.status === "rejected",
    };
    return getNextBestAction(input);
  }, [row, enrichment]);
  const nbaBadge = priorityBadgeClasses(nba.priority);

  // Primary CTA — state-aware: scheduled + not contacted → Confirm;
  // scheduled hour is past + not called → Reschedule; anything past
  // Contacted / Called → Disposition.
  const scheduledMs = new Date(row.scheduled_at).getTime();
  const isPastScheduled = !Number.isNaN(scheduledMs) && scheduledMs < Date.now();
  const primary = pickPrimaryCta(row, isPastScheduled);

  const licenseBadge = licenseBadgeFor(enrichment);
  const applicationBadge = applicationBadgeFor(row, enrichment);

  // Extracted so terminal-row primary + non-terminal secondary reuse identical popover body
  // without duplicating 30 lines of JSX. Only one Popover instance renders per row per branch,
  // so no Radix ref/id collision.
  const dispositionMenuChildren = (
    <>
      <div className="grid grid-cols-2 gap-1.5">
        <DispositionButton active={!!row.contacted_at} disabled={busy} icon={MessageCircle} label="Contacted" tone="sky" onClick={() => onDisposition(row, "contacted")} />
        <DispositionButton active={!!row.called_at} disabled={busy} icon={PhoneCall} label="Called" tone="emerald" onClick={() => onDisposition(row, "called")} />
        <DispositionButton active={!!row.rescheduled_at} disabled={busy} icon={Clock} label="Reschedule" tone="violet" onClick={() => onDisposition(row, "rescheduled")} />
        <DispositionButton active={!!row.no_show_at} disabled={busy} icon={UserX} label="No-Show" tone="rose" onClick={() => onDisposition(row, "no_show")} />
        <DispositionButton active={!!row.hired_at} disabled={busy} icon={Trophy} label="Hired" tone="amber" onClick={() => onDisposition(row, "hired")} />
        <DispositionButton active={!!row.contracted_at} disabled={busy} icon={CheckCircle2} label="Contracted" tone="emerald" onClick={() => onDisposition(row, "contracted")} />
        <DispositionButton active={!!row.passed_at} disabled={busy} icon={XCircle} label="Pass" tone="slate" onClick={() => onDisposition(row, "passed")} />
        <DispositionButton active={noteDraft !== undefined || !!row.outcome_notes} disabled={busy} icon={StickyNote} label="Notes" tone="sky" onClick={() => onOpenNotes(row)} />
      </div>
      <div className="mt-2 border-t border-border/50 pt-2">
        <Popover open={followUpOpen} onOpenChange={onOpenFollowUp}>
          <PopoverTrigger asChild>
            <Button type="button" variant="ghost" size="sm" className="w-full justify-start gap-2 text-xs" aria-label="Schedule follow-up date">
              <CalendarDays className="h-3.5 w-3.5" />
              Schedule follow-up date
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="single"
              selected={undefined}
              onSelect={(d: Date | undefined) => { if (d) onFollowUpPick(d); }}
              initialFocus
            />
          </PopoverContent>
        </Popover>
      </div>
    </>
  );

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
      <div className="pointer-events-none absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 bg-gradient-to-br from-white/[0.02] to-transparent" />
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
              <Badge variant="outline" className={cn("shrink-0 text-[10px] uppercase tracking-wider font-bold", licenseBadge.className)}>
                {licenseBadge.text}
              </Badge>
              <Badge variant="outline" className={cn("shrink-0 text-[10px] uppercase tracking-wider font-bold", applicationBadge.className)}>
                {applicationBadge.text}
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
                  Contracted
                </Badge>
              )}
              {row.hired_at && !row.contracted_at && (
                <Badge variant="outline" className="border-amber-500/40 bg-amber-500/15 text-[11px] text-amber-200 font-bold">
                  Hired
                </Badge>
              )}
              {row.no_show_at && (
                <Badge variant="outline" className="border-rose-500/40 bg-rose-500/15 text-[11px] text-rose-200 font-bold">
                  No-show
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

      {/* NBA row */}
      <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-border/50 bg-background/40 px-3 py-2">
        <Badge variant="outline" className={cn("text-[10px] uppercase tracking-wider font-bold", nbaBadge.className)}>
          {nbaBadge.text}
        </Badge>
        <span className="text-xs font-semibold text-foreground">{nba.action}</span>
        <span className="text-xs text-muted-foreground truncate">— {nba.reason}</span>
      </div>

      {/* Contact icon row — compact tel:/mailto:/IG chips */}
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

      {/* Primary CTA + disposition popover — on terminal rows (hired/contracted/passed),
          primary key is "edit_disposition" and the button IS the disposition-menu opener.
          Non-terminal rows keep the confirm/reschedule/called-log fast path + secondary menu. */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {primary.key === "edit_disposition" ? (
          <Popover>
            <PopoverTrigger asChild>
              <Button
                type="button"
                className="h-11 min-h-[44px] flex-1 gap-1.5"
                disabled={busy}
                data-cc-primary={primary.key}
                aria-label={`${primary.label} ${row.candidate_name}`}
                onClick={(e) => e.stopPropagation()}
              >
                <ClipboardCheck className="h-4 w-4" />
                {primary.label}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-64 p-2">{dispositionMenuChildren}</PopoverContent>
          </Popover>
        ) : (
          <>
            <Button
              type="button"
              className="h-11 min-h-[44px] flex-1 gap-1.5"
              disabled={busy}
              data-cc-primary={primary.key}
              aria-label={`${primary.label} ${row.candidate_name}`}
              onClick={(e) => {
                e.stopPropagation();
                if (primary.key === "confirm") return onConfirm(row);
                if (primary.key === "reschedule") return onDisposition(row, "rescheduled");
                onDisposition(row, "called");
              }}
            >
              {primary.key === "confirm" && <MailCheck className="h-4 w-4" />}
              {primary.key === "disposition" && <PhoneCall className="h-4 w-4" />}
              {primary.key === "reschedule" && <Clock className="h-4 w-4" />}
              {primary.label}
            </Button>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 min-h-[44px] gap-1.5"
                  disabled={busy}
                  aria-label={`Disposition menu for ${row.candidate_name}`}
                  onClick={(e) => e.stopPropagation()}
                >
                  <MoreHorizontal className="h-4 w-4" />
                  Disposition
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-64 p-2">{dispositionMenuChildren}</PopoverContent>
            </Popover>
          </>
        )}
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
    </article>
  );
}

function pickPrimaryCta(
  row: UnifiedInterview,
  isPast: boolean,
): { key: "confirm" | "disposition" | "reschedule" | "edit_disposition"; label: string } {
  // Terminal rows (hired/contracted/passed): primary opens the disposition menu so a click
  // never silently regresses a completed candidate back to called_at. Same disease class
  // as the 465 InsuraCloud + 198 AgentLink fake-success rows — a label must match its action.
  if (row.hired_at || row.contracted_at || row.passed_at) return { key: "edit_disposition", label: "Update disposition" };
  if (row.no_show_at) return { key: "reschedule", label: "Reschedule" };
  if (!row.contacted_at && !row.called_at && !isPast) return { key: "confirm", label: "Confirm interview" };
  if (isPast && !row.called_at) return { key: "reschedule", label: "Reschedule" };
  return { key: "disposition", label: "Disposition" };
}

function licenseBadgeFor(e: ApplicationEnrichment | null): { text: string; className: string } {
  if (!e) return { text: "Unknown", className: "border-slate-500/30 bg-slate-500/10 text-slate-300" };
  if (e.license_status === "licensed") return { text: "Licensed", className: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" };
  if (e.license_progress === "passed_test" || e.license_progress === "waiting_on_license") return { text: "Pending", className: "border-amber-500/40 bg-amber-500/10 text-amber-300" };
  return { text: "Unlicensed", className: "border-slate-500/30 bg-slate-500/10 text-slate-300" };
}

function applicationBadgeFor(row: UnifiedInterview, e: ApplicationEnrichment | null): { text: string; className: string } {
  const status = e?.status ?? row.status ?? row.interview_type;
  const text = typeLabel(status);
  const s = (status ?? "").toLowerCase();
  if (s.includes("contract")) return { text, className: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" };
  if (s.includes("hire")) return { text, className: "border-amber-500/40 bg-amber-500/10 text-amber-300" };
  if (s.includes("reject") || s.includes("no_show") || s.includes("no-show")) return { text, className: "border-rose-500/40 bg-rose-500/10 text-rose-200" };
  if (s.includes("interview") || s.includes("scheduled")) return { text, className: "border-sky-500/40 bg-sky-500/10 text-sky-300" };
  return { text, className: "border-slate-500/30 bg-slate-500/10 text-slate-300" };
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
      aria-pressed={active}
      aria-label={`${label}${active ? " (already set)" : ""}`}
      data-cc-action={label.toLowerCase().replace(/[^a-z0-9]/g, "-")}
      className={cn("min-h-[44px] h-11 gap-1 px-1 text-[11px] sm:text-xs", active && activeTone)}
      onClick={(e) => {
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
  href: string | null;
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

function KpiTile({
  icon: Icon,
  label,
  value,
  tone,
  active,
  onClick,
}: {
  icon: React.ElementType;
  label: string;
  value: number;
  tone: "teal" | "gold" | "emerald" | "rose" | "amber" | "slate";
  active: boolean;
  onClick: () => void;
}) {
  const tones = {
    teal: "border-teal-500/25 bg-teal-500/10 text-teal-300",
    gold: "border-amber-500/25 bg-amber-500/10 text-amber-300",
    emerald: "border-emerald-500/25 bg-emerald-500/10 text-emerald-300",
    rose: "border-rose-500/25 bg-rose-500/10 text-rose-200",
    amber: "border-amber-500/25 bg-amber-500/10 text-amber-300",
    slate: "border-slate-500/25 bg-slate-500/10 text-slate-200",
  };
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Filter by ${label} · ${value}`}
      className={cn(
        "rounded-md border p-3 text-left transition-all hover:-translate-y-0.5 hover:shadow-lg",
        tones[tone],
        active && "ring-2 ring-teal-400/70",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-muted-foreground">{label}</span>
        <Icon className="h-4 w-4 shrink-0" />
      </div>
      <div className="mt-1 text-2xl font-black tabular-nums text-foreground">{value}</div>
    </button>
  );
}

function InterviewSkeleton() {
  return (
    <section className="mt-4 grid gap-3 xl:grid-cols-2">
      {Array.from({ length: 6 }).map((_, index) => (
        // stable-key-allow:skeleton-loader-static-length-array
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

function AddInterviewDialog({
  open,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSaved: () => Promise<void> | void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [ig, setIg] = useState("");
  const [when, setWhen] = useState("");
  const [type, setType] = useState<string>("general");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setName(""); setEmail(""); setPhone(""); setIg(""); setWhen(""); setType("general"); setNotes("");
  };

  const submit = async () => {
    if (!name.trim() || !when) {
      toast.error("Name and scheduled time are required.");
      return;
    }
    const iso = new Date(when).toISOString();
    if (Number.isNaN(new Date(when).getTime())) {
      toast.error("Invalid scheduled time.");
      return;
    }
    setSaving(true);
    try {
      const { error } = await (supabase as any)
        .from("manual_interview_entries")
        .insert({
          candidate_name: name.trim(),
          email: email.trim() || null,
          phone: phone.trim() || null,
          instagram_handle: ig.trim().replace(/^@+/, "") || null,
          scheduled_at: iso,
          interview_type: type,
          notes: notes.trim() || null,
        });
      if (error) throw error;
      toast.success("Interview added");
      reset();
      await onSaved();
    } catch (err: any) {
      toast.error(err?.message ?? "Add failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add Interview</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div>
            <Label htmlFor="add-name" className="text-xs">Candidate name</Label>
            <Input id="add-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="Full name" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="add-email" className="text-xs">Email</Label>
              <Input id="add-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="candidate@example.com" />
            </div>
            <div>
              <Label htmlFor="add-phone" className="text-xs">Phone</Label>
              <Input id="add-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+1 555 000 1234" />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="add-ig" className="text-xs">Instagram</Label>
              <Input id="add-ig" value={ig} onChange={(e) => setIg(e.target.value)} placeholder="@handle" />
            </div>
            <div>
              <Label htmlFor="add-when" className="text-xs">Scheduled time</Label>
              <Input id="add-when" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
            </div>
          </div>
          <div>
            <Label htmlFor="add-type" className="text-xs">Interview type</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger id="add-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {INTERVIEW_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="add-notes" className="text-xs">Notes</Label>
            <Textarea id="add-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Context, referral source, etc." />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={submit} disabled={saving} className="gap-1.5">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function rowTone(row: UnifiedInterview) {
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

const CHICAGO = "America/Chicago";

function chicagoYMD(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: CHICAGO,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function chicagoStartOfWeekYMD(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
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
  const ymd = chicagoYMD(new Date());
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

function isInDateFilter(
  value: string,
  filter: DateFilter,
  customRange: { from?: Date; to?: Date },
): boolean {
  const candidate = new Date(value);
  if (Number.isNaN(candidate.getTime())) return false;
  const cYMD = chicagoYMD(candidate);
  const todayYMD = chicagoYMD(new Date());

  if (filter === "today") return cYMD === todayYMD;

  if (filter === "week") {
    const weekStartYMD = chicagoStartOfWeekYMD(todayYMD);
    return cYMD >= weekStartYMD;
  }

  if (filter === "month") {
    const monthStartYMD = todayYMD.slice(0, 7) + "-01";
    return cYMD >= monthStartYMD;
  }

  // custom
  if (customRange.from) {
    const fromYMD = chicagoYMD(customRange.from);
    if (cYMD < fromYMD) return false;
  }
  if (customRange.to) {
    const toYMD = chicagoYMD(customRange.to);
    if (cYMD > toYMD) return false;
  }
  return true;
}
