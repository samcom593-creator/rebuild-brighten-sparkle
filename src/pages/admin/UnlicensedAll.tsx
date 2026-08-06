import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Phone,
  PhoneOff,
  Mail,
  Filter,
  ArrowUpDown,
  UserPlus,
  CheckCircle2,
  Flame,
  Users,
  Ghost,
  UserCheck,
  UserMinus,
  ListChecks,
  MapPin,
  Sparkles,
  Instagram,
  FileSpreadsheet,
  ClipboardCheck,
  ArrowRight,
  Loader2,
  Trophy,
  ShieldOff,
  CalendarClock,
  Play,
  X,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { usePageTitle } from "@/hooks/usePageTitle";
import { PageHeader } from "@/components/ui/page-header";
import { GlassCard } from "@/components/ui/glass-card";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { RecoveryBatchDrawer, type RecoveryBatchRow } from "@/components/unlicensed/RecoveryBatchDrawer";
import { SuppressionDialog, type SuppressionTarget } from "@/components/unlicensed/SuppressionDialog";
import { APPLICATION_RECORD_TYPE } from "@/shared/api/applicationRecordType";

// Row from v_unlicensed_all — now UNION of applications + aged_leads
interface UnlicensedRow {
  id: string;
  source: "applied" | "aged_lead";
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  state: string | null;
  license_status: string | null;
  license_progress: string | null;
  created_at: string;
  last_contacted_at: string | null;
  next_action_due_at: string | null;
  assigned_va_id: string | null;
  assigned_va_at: string | null;
  next_touch_by: string | null;
  phone_bad_at: string | null;
  days_since_touch: number | null;
  days_since_applied: number | null;
  assigned_va_email: string | null;
  instagram_handle?: string | null;
  xcel_overall_pct?: number | null;
  xcel_final_exam_score?: number | null;
  xcel_state_license_number?: string | null;
}

// Row from v_xcel_person_progress — merged in client-side by email.
interface XcelProgressRow {
  email: string | null;
  overall_pct_max: number | null;
  final_exam_score_max: number | null;
  national_producer_number: string | null;
}

// Every stage Sam actually uses — order matches the licensing funnel.
// Tapping the stage badge cycles to the next one (which fires the RPC).
// Tones are the three theme-paired severity tokens plus neutral. The dark-only
// -300 weights this list used to carry were invisible on the white light card.
const STAGES: Array<{ key: string; label: string; tone: string }> = [
  { key: "unlicensed",         label: "unlicensed",         tone: "border-border text-muted-foreground" },
  { key: "course_purchased",   label: "course purchased",   tone: "border-rose-500/35 text-rose-600 dark:text-rose-400" },
  { key: "in_course",          label: "in course",          tone: "border-amber-500/35 text-amber-600 dark:text-amber-400" },
  { key: "finished_course",    label: "finished course",    tone: "border-amber-500/35 text-amber-600 dark:text-amber-400" },
  { key: "test_scheduled",     label: "test scheduled",     tone: "border-amber-500/35 text-amber-600 dark:text-amber-400" },
  { key: "passed_test",        label: "passed test",        tone: "border-emerald-500/35 text-emerald-600 dark:text-emerald-400" },
  { key: "waiting_on_license", label: "waiting on license", tone: "border-emerald-500/35 text-emerald-600 dark:text-emerald-400" },
];
function stageMeta(k: string | null) {
  return STAGES.find((s) => s.key === (k ?? "unlicensed")) ?? STAGES[0];
}

interface VaOption {
  user_id: string;
  role: string;
  email: string | null;
  display_name: string | null;
}

type FilterKey = "all" | "unassigned" | "ghosted_30" | "by_stage";
type SortKey = "newest" | "ghosted_longest" | "alpha";

const PROGRESS_TONE: Record<string, string> = {
  waiting_on_license: "bg-emerald-500/15 text-emerald-300 border-emerald-500/40",
  passed_test: "bg-emerald-500/15 text-emerald-300 border-emerald-500/40",
  test_scheduled: "bg-amber-500/15 text-amber-300 border-amber-500/40",
  finished_course: "bg-amber-500/15 text-amber-300 border-amber-500/40",
  in_course: "bg-sky-500/15 text-sky-300 border-sky-500/40",
  course_started: "bg-sky-500/15 text-sky-300 border-sky-500/40",
  bought_not_started: "bg-rose-500/15 text-rose-300 border-rose-500/40",
  not_started: "bg-slate-500/15 text-slate-300 border-slate-500/40",
};

function formatPhone(raw: string | null): string {
  if (!raw) return "";
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return raw;
}

function telHref(raw: string | null): string {
  if (!raw) return "#";
  const digits = raw.replace(/\D/g, "");
  return `tel:${digits.startsWith("1") ? "+" : "+1"}${digits}`;
}

function fullName(r: UnlicensedRow): string {
  return [r.first_name, r.last_name].filter(Boolean).join(" ") || "(unknown)";
}

// Severity on the numeral + a dot, never a filled tile. Theme-paired so the
// same row reads correctly on the white light card and the graphite dark card.
function ghostTone(days: number | null): { text: string; dot: string; border: string } {
  const d = days ?? 0;
  if (d < 7) return { text: "text-emerald-600 dark:text-emerald-400", dot: "bg-emerald-500", border: "" };
  if (d < 30) return { text: "text-amber-600 dark:text-amber-400", dot: "bg-amber-500", border: "" };
  return { text: "text-rose-600 dark:text-rose-400", dot: "bg-rose-500", border: "border-rose-500/35" };
}

function prettyProgress(p: string | null): string {
  if (!p) return "unlicensed";
  return p.replaceAll("_", " ");
}

export default function UnlicensedAll() {
  usePageTitle("Unlicensed Queue · APEX");
  const qc = useQueryClient();

  const [filter, setFilter] = useState<FilterKey>("all");
  const [stageFilter, setStageFilter] = useState<string>("all");
  const [sort, setSort] = useState<SortKey>("ghosted_longest");

  // MP-257: recovery batch + suppression + bulk selection state
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchQueue, setBatchQueue] = useState<RecoveryBatchRow[]>([]);
  const [batchStart, setBatchStart] = useState(0);
  const [suppressOpen, setSuppressOpen] = useState(false);
  const [suppressTarget, setSuppressTarget] = useState<SuppressionTarget | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [bulkFollowUp, setBulkFollowUp] = useState<Date | undefined>(undefined);
  const [bulkVaId, setBulkVaId] = useState<string>("");
  const [bulkRunning, setBulkRunning] = useState(false);
  // Render window — this list can be 1,000+ rows (~122,000px DOM wall). Mount
  // the first N; "Show more" reveals the rest. Selection/batch still use `filtered`.
  const [visibleCount, setVisibleCount] = useState(100);

  const { data: rows = [], isLoading } = useQuery<UnlicensedRow[]>({
    queryKey: ["v_unlicensed_all"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_unlicensed_all" as any)
        .select("*");
      if (error) throw error;
      return (data as unknown as UnlicensedRow[]) ?? [];
    },
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });

  const { data: xcelRows = [] } = useQuery<XcelProgressRow[]>({
    queryKey: ["v_xcel_person_progress"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_xcel_person_progress" as any)
        .select("email, overall_pct_max, final_exam_score_max, national_producer_number");
      if (error) throw error;
      return (data as unknown as XcelProgressRow[]) ?? [];
    },
    staleTime: 60_000,
  });

  const { data: vas = [] } = useQuery<VaOption[]>({
    queryKey: ["vas_and_managers"],
    queryFn: async () => {
      const { data: roleRows, error } = await supabase
        .from("user_roles")
        .select("user_id, role")
        .in("role", ["manager", "va"] as any);
      if (error) throw error;
      // Drop null user_ids — a null in a uuid `.in()` filter 400s the request.
      const ids = Array.from(new Set((roleRows ?? []).map((r: any) => r.user_id).filter(Boolean)));
      if (ids.length === 0) return [];
      // Chunk the id list — the full manager+va set built a URL long enough to
      // 400 the gateway, dropping every name/email on the recovery queue.
      const profMap = new Map<string, { email: string | null; display_name: string | null }>();
      const CHUNK = 100;
      for (let i = 0; i < ids.length; i += CHUNK) {
        // profiles has NO `display_name` column (verified 400) — selecting it
        // 400'd the whole request and left this map empty every time. email +
        // full_name are real; use full_name as the display name.
        const { data: profiles } = await supabase
          .from("profiles")
          .select("id, email, full_name")
          .in("id", ids.slice(i, i + CHUNK));
        (profiles ?? []).forEach((p: any) => {
          profMap.set(p.id, {
            email: p.email ?? null,
            display_name: p.full_name ?? null,
          });
        });
      }
      return (roleRows ?? []).map((r: any) => ({
        user_id: r.user_id,
        role: r.role,
        email: profMap.get(r.user_id)?.email ?? null,
        display_name: profMap.get(r.user_id)?.display_name ?? null,
      })) as VaOption[];
    },
    staleTime: 5 * 60_000,
  });

  const assignVa = useMutation({
    mutationFn: async ({ row, vaId }: { row: UnlicensedRow; vaId: string }) => {
      const { error } = await supabase.rpc("unified_assign_va" as any, {
        p_id: row.id,
        p_va_user_id: vaId,
        p_source: row.source,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("VA assigned");
      qc.invalidateQueries({ queryKey: ["v_unlicensed_all"] });
    },
    onError: (e) => toast.error(`Assign failed: ${String(e)}`),
  });

  const markContacted = useMutation({
    mutationFn: async (row: UnlicensedRow) => {
      const { error } = await supabase.rpc("unified_mark_contacted" as any, {
        p_id: row.id,
        p_source: row.source,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Marked contacted");
      qc.invalidateQueries({ queryKey: ["v_unlicensed_all"] });
    },
    onError: (e) => toast.error(`Update failed: ${String(e)}`),
  });

  const setStage = useMutation({
    mutationFn: async ({ row, progress }: { row: UnlicensedRow; progress: string }) => {
      const { error } = await supabase.rpc("unified_set_license_progress" as any, {
        p_id: row.id,
        p_progress: progress,
        p_source: row.source,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["v_unlicensed_all"] });
    },
    onError: (e) => toast.error(`Stage update failed: ${String(e)}`),
  });

  const passedTest = useMutation({
    mutationFn: async (row: UnlicensedRow) => {
      const { error } = await supabase.rpc("unified_set_license_progress" as any, {
        p_id: row.id, p_progress: "passed_test", p_source: row.source,
      });
      if (error) throw error;
      if (row.source === 'applied') {
        await supabase.rpc("log_contact_attempt" as any, {
          p_application_id: row.id, p_channel: 'stage', p_outcome: 'passed_test', p_notes: null,
          // empty-catch-allow:fire-and-forget stage-transition telemetry
        }).catch(() => {});
      }
    },
    onSuccess: () => { toast.success('Marked passed test'); qc.invalidateQueries({ queryKey: ['v_unlicensed_all'] }); },
    onError: (e) => toast.error(`Failed: ${String(e)}`),
  });

  const markBadPhone = useMutation({
    mutationFn: async (row: UnlicensedRow) => {
      const { error } = await supabase.rpc("unified_mark_phone_bad" as any, {
        p_id: row.id,
        p_source: row.source,
        p_reason: "user_marked_bad",
      });
      if (error) throw error;
      // Fire the "we couldn't reach you" email if this is a real applicant (aged_leads emails don't have the templated flow yet)
      if (row.source === "applied" && row.email) {
        await supabase.functions.invoke("send-couldnt-reach-email", {
          body: { application_id: row.id, reason: "user_marked_bad" },
        });
      }
    },
    onSuccess: (_v, row) => {
      toast.success(
        row.source === "applied" && row.email
          ? `Bad # · emailed ${row.email}`
          : "Marked bad #",
      );
      qc.invalidateQueries({ queryKey: ["v_unlicensed_all"] });
    },
    onError: (e) => toast.error(`Mark bad failed: ${String(e)}`),
  });

  const promoteAged = useMutation({
    mutationFn: async (agedId: string) => {
      const { error } = await supabase.rpc("promote_aged_lead_to_application" as any, {
        p_aged_id: agedId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Converted to applicant");
      qc.invalidateQueries({ queryKey: ["v_unlicensed_all"] });
    },
    onError: (e) => toast.error(`Convert failed: ${String(e)}`),
  });

  // Totals
  const totals = useMemo(() => {
    const total = rows.length;
    const ghosted = rows.filter((r) => (r.days_since_touch ?? 0) >= 30).length;
    const assigned = rows.filter((r) => !!r.assigned_va_id).length;
    const unassigned = total - assigned;
    return { total, ghosted, assigned, unassigned };
  }, [rows]);

  // MP-257: 7-day recovered + suppressed counters. Real fields only; 0 shown as 0.
  const { data: mp257Kpis = { recovered: 0, suppressed: 0 } } = useQuery({
    queryKey: ["mp257_kpis"],
    queryFn: async () => {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

      const { count: recoveredCount } = await supabase
        .from("applications")
        .select("id", { count: "exact", head: true }).eq("record_type", APPLICATION_RECORD_TYPE)
        .eq("license_status", "licensed")
        .gte("licensed_at", sevenDaysAgo);

      const { count: appSuppressed } = await supabase
        .from("applications")
        .select("id", { count: "exact", head: true }).eq("record_type", APPLICATION_RECORD_TYPE)
        .not("terminated_at", "is", null)
        .gte("terminated_at", sevenDaysAgo);

      return {
        recovered: recoveredCount ?? 0,
        suppressed: appSuppressed ?? 0,
      };
    },
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });

  // Distinct progress stages present
  const stageOptions = useMemo(() => {
    const set = new Set<string>();
    rows.forEach((r) => set.add(r.license_progress ?? "unlicensed"));
    return Array.from(set).sort();
  }, [rows]);

  // Merge XCEL progress into rows by lower-cased email.
  const mergedRows = useMemo(() => {
    if (xcelRows.length === 0) return rows;
    const xcelByEmail = new Map<string, XcelProgressRow>();
    xcelRows.forEach((x) => {
      if (x.email) xcelByEmail.set(x.email.toLowerCase(), x);
    });
    return rows.map((r) => {
      const key = r.email?.toLowerCase();
      const x = key ? xcelByEmail.get(key) : undefined;
      if (!x) return r;
      return {
        ...r,
        xcel_overall_pct: x.overall_pct_max,
        xcel_final_exam_score: x.final_exam_score_max,
        xcel_state_license_number: x.national_producer_number,
      } as UnlicensedRow;
    });
  }, [rows, xcelRows]);

  const filtered = useMemo(() => {
    let out = [...mergedRows];
    if (filter === "unassigned") out = out.filter((r) => !r.assigned_va_id);
    else if (filter === "ghosted_30") out = out.filter((r) => (r.days_since_touch ?? 0) >= 30);
    else if (filter === "by_stage" && stageFilter !== "all") {
      out = out.filter((r) => (r.license_progress ?? "unlicensed") === stageFilter);
    }

    if (sort === "newest") {
      out.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    } else if (sort === "ghosted_longest") {
      out.sort((a, b) => (b.days_since_touch ?? 0) - (a.days_since_touch ?? 0));
    } else if (sort === "alpha") {
      out.sort((a, b) => fullName(a).localeCompare(fullName(b)));
    }
    return out;
  }, [mergedRows, filter, stageFilter, sort]);

  // Reset the render window when the filter/sort changes.
  useEffect(() => {
    setVisibleCount(100);
  }, [filter, stageFilter, sort]);

  // Clear stale selections whenever the filtered list shrinks.
  useEffect(() => {
    if (selectedIds.size === 0) return;
    const visible = new Set(filtered.map((r) => `${r.source}:${r.id}`));
    let dirty = false;
    const next = new Set<string>();
    selectedIds.forEach((k) => {
      if (visible.has(k)) next.add(k);
      else dirty = true;
    });
    if (dirty) setSelectedIds(next);
  }, [filtered, selectedIds]);

  const toRecoveryBatchRow = useCallback((r: UnlicensedRow): RecoveryBatchRow => ({
    id: r.id,
    source: r.source,
    first_name: r.first_name,
    last_name: r.last_name,
    email: r.email,
    phone: r.phone,
    state: r.state,
    license_progress: r.license_progress,
    days_since_touch: r.days_since_touch,
    assigned_va_email: r.assigned_va_email,
    instagram_handle: r.instagram_handle ?? null,
    phone_bad_at: r.phone_bad_at,
  }), []);

  // Recovery batch = unassigned + ghosted 30d+, sorted highest priority (longest ghosted first).
  const startRecoveryBatch = useCallback(() => {
    const pool = mergedRows
      .filter((r) => !r.assigned_va_id && (r.days_since_touch ?? 0) >= 30 && !r.phone_bad_at)
      .sort((a, b) => (b.days_since_touch ?? 0) - (a.days_since_touch ?? 0))
      .map(toRecoveryBatchRow);
    if (pool.length === 0) {
      toast.info("No unassigned ghosted 30d+ records. Batch is clear.");
      return;
    }
    setBatchQueue(pool);
    setBatchStart(0);
    setBatchOpen(true);
  }, [mergedRows, toRecoveryBatchRow]);

  const workSelectedInBatch = useCallback(() => {
    if (selectedIds.size === 0) return;
    const pool = filtered
      .filter((r) => selectedIds.has(`${r.source}:${r.id}`))
      .sort((a, b) => (b.days_since_touch ?? 0) - (a.days_since_touch ?? 0))
      .map(toRecoveryBatchRow);
    if (pool.length === 0) return;
    setBatchQueue(pool);
    setBatchStart(0);
    setBatchOpen(true);
  }, [filtered, selectedIds, toRecoveryBatchRow]);

  const toggleSelected = useCallback((key: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const selectAllVisible = useCallback(() => {
    setSelectedIds(new Set(filtered.map((r) => `${r.source}:${r.id}`)));
  }, [filtered]);

  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  const requestSuppress = useCallback((r: RecoveryBatchRow) => {
    setSuppressTarget({
      id: r.id,
      source: r.source,
      first_name: r.first_name,
      last_name: r.last_name,
    });
    setSuppressOpen(true);
  }, []);

  // Bulk actions run sequentially so a mid-run failure doesn't leave a half-applied state.
  const runBulk = useCallback(async (action: "assign_va" | "mark_contacted" | "schedule" | "suppress") => {
    const targets = filtered.filter((r) => selectedIds.has(`${r.source}:${r.id}`));
    if (targets.length === 0) return;
    if (action === "assign_va" && !bulkVaId) {
      toast.error("Pick a VA first");
      return;
    }
    if (action === "schedule" && !bulkFollowUp) {
      toast.error("Pick a follow-up date first");
      return;
    }
    if (action === "suppress") {
      // Bulk suppress hands off to the SuppressionDialog for the first target,
      // then applies the same reason to the rest.
      const first = targets[0];
      requestSuppress(toRecoveryBatchRow(first));
      return;
    }
    setBulkRunning(true);
    let ok = 0;
    let fail = 0;
    for (const r of targets) {
      try {
        if (action === "assign_va") {
          const { error } = await supabase.rpc("unified_assign_va" as any, {
            p_id: r.id, p_va_user_id: bulkVaId, p_source: r.source,
          });
          if (error) throw error;
        } else if (action === "mark_contacted") {
          const { error } = await supabase.rpc("unified_mark_contacted" as any, {
            p_id: r.id, p_source: r.source,
          });
          if (error) throw error;
        } else if (action === "schedule" && bulkFollowUp) {
          const iso = bulkFollowUp.toISOString();
          const table = r.source === "applied" ? "applications" : "aged_leads";
          const { error } = await supabase
            .from(table as any)
            .update({ next_action_due_at: iso } as any)
            .eq("id", r.id);
          if (error) throw error;
        }
        ok++;
      } catch (e) {
        fail++;
        // Continue on failure so a single row does not block the rest.
        // Failures surface in the final toast summary.
      }
    }
    setBulkRunning(false);
    qc.invalidateQueries({ queryKey: ["v_unlicensed_all"] });
    qc.invalidateQueries({ queryKey: ["mp257_kpis"] });
    clearSelection();
    if (fail === 0) toast.success(`Applied to ${ok} records`);
    else toast.warning(`${ok} ok · ${fail} failed`);
  }, [filtered, selectedIds, bulkVaId, bulkFollowUp, qc, clearSelection, requestSuppress, toRecoveryBatchRow]);

  return (
    <div className="page-enter mx-auto w-full max-w-6xl space-y-5 px-4 pb-24 sm:px-6">
      <PageHeader
        eyebrow="License Recovery"
        eyebrowIcon={<Sparkles className="h-4 w-4" />}
        title="Unlicensed Queue"
        subtitle="Every applicant without a license. Route to a VA, work the ghosted 30d+ pile daily."
      />

      {/* MP-257: Start VA Recovery Batch CTA */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="min-w-0 text-xs leading-relaxed text-muted-foreground">
          Batch mode filters to unassigned + ghosted 30d+ and walks them one-by-one with a script.
        </p>
        <Button
          size="sm"
          onClick={startRecoveryBatch}
          className="h-10 w-full shrink-0 sm:h-9 sm:w-auto"
          aria-label="Start VA Recovery Batch"
        >
          <Play className="h-4 w-4" /> Start VA Recovery Batch
        </Button>
      </div>

      {/* Queue snapshot */}
      <GlassCard className="p-4">
        <div className="mb-1 flex items-baseline justify-between gap-2">
          <h3 className="flex min-w-0 items-center gap-2 text-sm font-semibold text-foreground">
            <Users className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="truncate">Queue snapshot</span>
          </h3>
        </div>
        <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
          Ghosted 30d+ is the number that decides the day — every record in it is a paid applicant nobody has spoken to in a month.
        </p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <TotalTile label="Total unlicensed" value={totals.total} icon={<Users className="h-4 w-4" />} tone="text-foreground" />
          <TotalTile label="Ghosted 30d+" value={totals.ghosted} icon={<Ghost className="h-4 w-4" />} tone="text-rose-600 dark:text-rose-400" emphasis />
          <TotalTile label="Assigned" value={totals.assigned} icon={<UserCheck className="h-4 w-4" />} tone="text-emerald-600 dark:text-emerald-400" />
          <TotalTile label="Unassigned" value={totals.unassigned} icon={<UserMinus className="h-4 w-4" />} tone="text-amber-600 dark:text-amber-400" />
          <TotalTile label="Recovered · 7d" value={mp257Kpis.recovered} icon={<Trophy className="h-4 w-4" />} tone="text-emerald-600 dark:text-emerald-400" hint="Applications licensed in last 7 days" />
          <TotalTile label="Suppressed · 7d" value={mp257Kpis.suppressed} icon={<ShieldOff className="h-4 w-4" />} tone="text-rose-600 dark:text-rose-400" hint="Applications terminated in last 7 days" />
        </div>
      </GlassCard>

      {/* Filter + sort bar */}
      <GlassCard className="p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
          <div className="min-w-0 flex-1">
            <div className="mb-2 inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
              <Filter className="h-3.5 w-3.5 shrink-0" /> Filter
            </div>
            <div className="-mx-4 overflow-x-auto pb-1 sm:mx-0">
              <div className="flex min-w-max items-center gap-2 px-4 sm:px-0">
                <FilterPill active={filter === "all"} onClick={() => setFilter("all")}>All</FilterPill>
                <FilterPill active={filter === "unassigned"} onClick={() => setFilter("unassigned")}>Unassigned</FilterPill>
                <FilterPill active={filter === "ghosted_30"} onClick={() => setFilter("ghosted_30")} tone="rose">Ghosted 30d+</FilterPill>
                <FilterPill active={filter === "by_stage"} onClick={() => setFilter("by_stage")}>By stage</FilterPill>
                {filter === "by_stage" && (
                  <Select value={stageFilter} onValueChange={setStageFilter}>
                    <SelectTrigger aria-label="Filter by licensing stage" className="h-10 w-[180px] shrink-0 text-xs sm:h-9">
                      <SelectValue placeholder="Pick a stage" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Every stage</SelectItem>
                      {stageOptions.map((s) => (
                        <SelectItem key={s} value={s}>{prettyProgress(s)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            </div>
          </div>

          <div className="min-w-0 lg:shrink-0">
            <div className="mb-2 inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
              <ArrowUpDown className="h-3.5 w-3.5 shrink-0" /> Sort
            </div>
            <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
              <SelectTrigger aria-label="Sort the queue" className="h-10 w-full text-xs sm:h-9 lg:w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="newest">Newest</SelectItem>
                <SelectItem value="ghosted_longest">Ghosted longest</SelectItem>
                <SelectItem value="alpha">Alphabetical</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </GlassCard>

      {/* MP-257: bulk action bar — appears when any row is selected */}
      {selectedIds.size > 0 && (
        <div className="rounded-lg border border-primary/40 bg-primary/5 p-3 sm:p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-bold tabular-nums text-foreground">
              {selectedIds.size.toLocaleString()}
            </span>
            <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
              selected
            </span>
            {selectedIds.size < filtered.length && (
              <button
                type="button"
                onClick={selectAllVisible}
                className="inline-flex h-10 items-center rounded-sm px-1 text-[11px] font-semibold text-muted-foreground underline decoration-dotted underline-offset-2 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)] sm:h-9"
              >
                Select all {filtered.length.toLocaleString()}
              </button>
            )}
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <Select value={bulkVaId} onValueChange={setBulkVaId}>
                <SelectTrigger aria-label="Pick the VA for the selected records" className="h-10 w-[150px] text-xs sm:h-9">
                  <UserPlus className="mr-1.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <SelectValue placeholder="Assign VA" />
                </SelectTrigger>
                <SelectContent>
                  {vas.length === 0 && (
                    <div className="px-2 py-1.5 text-xs text-muted-foreground">No managers/VAs</div>
                  )}
                  {vas.map((v) => (
                    <SelectItem key={v.user_id} value={v.user_id}>
                      <span className="inline-flex items-center gap-1.5">
                        <span className="rounded-sm border border-border px-1 py-0.5 text-[9px] font-bold uppercase tracking-wide text-muted-foreground">
                          {v.role}
                        </span>
                        {v.display_name || v.email || v.user_id.slice(0, 8)}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                size="sm"
                disabled={bulkRunning || !bulkVaId}
                onClick={() => runBulk("assign_va")}
                className="h-10 sm:h-9"
                aria-label="Assign selected records to VA"
              >
                Assign
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={bulkRunning}
                onClick={() => runBulk("mark_contacted")}
                className="h-10 gap-1.5 px-2.5 text-[11px] hover:border-emerald-500/50 hover:bg-emerald-500/10 hover:text-emerald-600 dark:hover:text-emerald-400 sm:h-9"
                aria-label="Mark selected records contacted"
              >
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0" /> Mark contacted
              </Button>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={bulkRunning}
                    className="h-10 gap-1.5 px-2.5 text-[11px] sm:h-9"
                    aria-label="Pick bulk follow-up date"
                  >
                    <CalendarClock className="h-3.5 w-3.5 shrink-0" />
                    {bulkFollowUp ? format(bulkFollowUp, "MMM d") : "Follow-up"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="end">
                  <Calendar
                    mode="single"
                    selected={bulkFollowUp}
                    onSelect={setBulkFollowUp}
                    initialFocus
                  />
                  <div className="border-t border-border p-2">
                    <Button
                      size="sm"
                      className="h-10 w-full sm:h-9"
                      disabled={!bulkFollowUp || bulkRunning}
                      onClick={() => runBulk("schedule")}
                      aria-label="Confirm bulk follow-up"
                    >
                      Schedule {selectedIds.size}
                    </Button>
                  </div>
                </PopoverContent>
              </Popover>
              <Button
                size="sm"
                variant="outline"
                disabled={bulkRunning}
                onClick={() => runBulk("suppress")}
                className="h-10 gap-1.5 px-2.5 text-[11px] hover:border-rose-500/50 hover:bg-rose-500/10 hover:text-rose-600 dark:hover:text-rose-400 sm:h-9"
                aria-label="Suppress selected records"
              >
                <ShieldOff className="h-3.5 w-3.5 shrink-0" /> Suppress
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={bulkRunning}
                onClick={workSelectedInBatch}
                className="h-10 gap-1.5 px-2.5 text-[11px] sm:h-9"
                aria-label="Work selected records in recovery batch"
              >
                <Play className="h-3.5 w-3.5 shrink-0" /> Work in batch
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={clearSelection}
                className="h-10 gap-1.5 px-2.5 text-[11px] text-muted-foreground sm:h-9"
                aria-label="Clear selection"
              >
                <X className="h-3.5 w-3.5 shrink-0" />
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}

      <GlassCard className="p-4">
        <div className="mb-1 flex items-baseline justify-between gap-2">
          <h3 className="flex min-w-0 items-center gap-2 text-sm font-semibold text-foreground">
            <ListChecks className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="truncate">Unlicensed queue</span>
          </h3>
          <span className="shrink-0 text-sm font-bold tabular-nums text-muted-foreground">
            {filtered.length.toLocaleString()}
          </span>
        </div>
        <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
          Applicants and Excel-imported leads in one pile — the higher the ghosted count on a row, the longer that producer has been paying for a course nobody followed up on.
        </p>

        {isLoading && (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              /* stable-key-allow:skeleton */
              <Skeleton key={i} className="h-[132px] w-full rounded-lg" />
            ))}
          </div>
        )}

        {!isLoading && filtered.length === 0 && (
          <EmptyState
            icon={<Users className="h-7 w-7" />}
            variant="default"
            title="No unlicensed record matches this filter"
            description="Either the pile is genuinely clear or the filter is too narrow — widen it, and confirm v_unlicensed_all is populated."
          />
        )}

        <ul className="space-y-2">
          {filtered.slice(0, visibleCount).map((r) => {
            const days = r.days_since_touch ?? 0;
            const tone = ghostTone(days);
            const stg = stageMeta(r.license_progress);
            const busyStage = setStage.isPending && setStage.variables?.row.id === r.id;
            const busyBad = markBadPhone.isPending && markBadPhone.variables?.id === r.id;
            const busyPromote = promoteAged.isPending && promoteAged.variables === r.id;
            const isBadPhone = !!r.phone_bad_at;
            const selKey = `${r.source}:${r.id}`;
            const isSelected = selectedIds.has(selKey);
            return (
              <li
                key={`${r.source}-${r.id}`}
                className={cn(
                  "rounded-lg border border-border/60 bg-card/60 px-3 py-2.5 transition-colors hover:border-border hover:bg-card",
                  tone.border,
                  isSelected && "border-primary/50 bg-primary/5",
                )}
              >
                <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:gap-3">
                  {/* Identity + inline stage picker */}
                  <div className="flex min-w-0 flex-1 items-start gap-2">
                    <Checkbox
                      checked={isSelected}
                      onCheckedChange={() => toggleSelected(selKey)}
                      aria-label={`Select ${fullName(r)}`}
                      className="mt-0.5 h-5 w-5 shrink-0"
                    />
                    <span aria-hidden className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", tone.dot)} />
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="min-w-0 truncate text-sm font-medium text-foreground">{fullName(r)}</span>
                        {r.state && (
                          <span className="inline-flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground">
                            <MapPin className="h-3 w-3 shrink-0" />{r.state}
                          </span>
                        )}
                        {r.source === "aged_lead" && (
                          <span title="Imported from Excel — hasn't formally applied yet" className="inline-flex shrink-0 items-center gap-1 rounded-sm border border-border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                            <FileSpreadsheet className="h-3 w-3 shrink-0" /> excel
                          </span>
                        )}
                        {r.source === "applied" && (
                          <span title="Filled out the public application" className="inline-flex shrink-0 items-center gap-1 rounded-sm border border-border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                            <ClipboardCheck className="h-3 w-3 shrink-0" /> applied
                          </span>
                        )}
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-2">
                        {/* XCEL course progress — merged in by email from v_xcel_person_progress */}
                        {(r.xcel_overall_pct != null || r.xcel_final_exam_score != null || r.xcel_state_license_number) && (
                          <>
                            <span className="inline-flex shrink-0 items-center gap-1 rounded-sm border border-border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                              <span className="tabular-nums">XCEL {r.xcel_overall_pct ?? 0}%</span>
                              {(r.xcel_final_exam_score ?? 0) >= 70 ? (
                                <CheckCircle2 className="h-3 w-3 shrink-0 text-emerald-600 dark:text-emerald-400" />
                              ) : null}
                              {r.xcel_state_license_number ? (
                                <span className="tabular-nums">· lic {r.xcel_state_license_number}</span>
                              ) : null}
                            </span>
                            {(r.xcel_final_exam_score ?? 0) >= 70 &&
                              r.license_progress !== "passed_test" &&
                              r.license_progress !== "waiting_on_license" && (
                                <span
                                  title="XCEL says they passed — advance the stage"
                                  className="inline-flex shrink-0 items-center gap-1 rounded-sm border border-amber-500/35 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-600 dark:text-amber-400"
                                >
                                  sync ready
                                </span>
                              )}
                          </>
                        )}
                        {/* Tap-to-cycle stage — Sam's #1 gripe */}
                        <Select
                          value={r.license_progress ?? "unlicensed"}
                          onValueChange={(v) => setStage.mutate({ row: r, progress: v })}
                        >
                          <SelectTrigger
                            aria-label={`Licensing stage for ${fullName(r)}`}
                            className={cn(
                              "h-10 w-auto min-w-[150px] shrink-0 px-2 text-[10px] font-bold uppercase tracking-wide sm:h-9",
                              stg.tone,
                              busyStage && "opacity-60",
                            )}
                          >
                            <SelectValue>
                              {busyStage ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : stg.label}
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            {STAGES.map((s) => (
                              <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {isBadPhone && (
                          <span className="inline-flex shrink-0 items-center gap-1 rounded-sm border border-rose-500/35 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-rose-600 dark:text-rose-400">
                            <PhoneOff className="h-3 w-3 shrink-0" /> bad #
                          </span>
                        )}
                        {r.assigned_va_email && (
                          <span className="min-w-0 max-w-[220px] truncate text-[11px] text-muted-foreground">→ {r.assigned_va_email}</span>
                        )}
                      </div>
                    </div>

                    {/* The decision number: how long this record has been ghosted */}
                    <div className="shrink-0 pl-2 text-right">
                      <div className={cn("flex items-center justify-end gap-1 text-sm font-bold tabular-nums", tone.text)}>
                        {days >= 30 && <Flame aria-hidden className="h-3.5 w-3.5 shrink-0" />}
                        <span>{days}d</span>
                      </div>
                      <div className="mt-0.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                        ghosted
                      </div>
                    </div>
                  </div>

                  {/* One-tap contact actions */}
                  <div className="flex flex-wrap items-center gap-2">
                    {r.phone && !isBadPhone && (
                      <a
                        href={telHref(r.phone)}
                        aria-label={`Call ${fullName(r)}`}
                        className="inline-flex h-10 min-w-0 items-center gap-2 rounded-sm border border-border bg-background px-3 text-xs font-semibold tabular-nums text-foreground transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)] sm:h-9"
                        onClick={() => {
                          if (r.source === 'applied') {
                            supabase.rpc("log_contact_attempt" as any, {
                              p_application_id: r.id, p_channel: 'phone', p_outcome: 'attempted', p_notes: null,
                              // empty-catch-allow:fire-and-forget tel-click telemetry — must not block navigation
                            }).catch(() => {});
                          }
                        }}
                      >
                        <Phone className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <span className="truncate">{formatPhone(r.phone)}</span>
                      </a>
                    )}
                    {r.email && (
                      <a
                        href={`mailto:${r.email}`}
                        className="inline-flex h-10 min-w-0 max-w-[220px] items-center gap-2 rounded-sm border border-border bg-background px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/30 hover:text-foreground focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)] sm:h-9"
                        title={r.email}
                        onClick={() => {
                          if (r.source === 'applied') {
                            supabase.rpc("log_contact_attempt" as any, {
                              p_application_id: r.id, p_channel: 'email', p_outcome: 'attempted', p_notes: null,
                              // empty-catch-allow:fire-and-forget mailto-click telemetry — must not block navigation
                            }).catch(() => {});
                          }
                        }}
                      >
                        <Mail className="h-4 w-4 shrink-0" />
                        <span className="truncate">{r.email}</span>
                      </a>
                    )}
                    {r.instagram_handle && (
                      <a
                        href={`https://instagram.com/${r.instagram_handle.replace(/^@+/, "")}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-sm border border-border bg-background text-muted-foreground transition-colors hover:bg-muted/30 hover:text-foreground focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)] sm:h-9 sm:w-9"
                        title={`@${r.instagram_handle.replace(/^@+/, "")}`}
                        aria-label={`Instagram @${r.instagram_handle.replace(/^@+/, "")}`}
                      >
                        <Instagram className="h-4 w-4" />
                      </a>
                    )}
                    {r.phone && !isBadPhone && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-10 w-10 shrink-0 p-0 text-rose-600 hover:bg-rose-500/10 hover:text-rose-600 dark:text-rose-400 dark:hover:text-rose-400 sm:h-9 sm:w-9"
                        title="Mark number bad + email them"
                        aria-label="Mark phone number bad and email them"
                        onClick={() => markBadPhone.mutate(r)}
                        disabled={busyBad}
                      >
                        {busyBad ? <Loader2 className="h-4 w-4 animate-spin" /> : <PhoneOff className="h-4 w-4" />}
                      </Button>
                    )}
                  </div>

                  {/* Assignment + contacted + promote */}
                  <div className="flex flex-wrap items-center gap-2 lg:ml-auto lg:shrink-0 lg:justify-end">
                    <Select
                      value={r.assigned_va_id ?? ""}
                      onValueChange={(v) => v && assignVa.mutate({ row: r, vaId: v })}
                    >
                      <SelectTrigger aria-label={`Assign a VA to ${fullName(r)}`} className="h-10 w-[150px] text-xs sm:h-9">
                        <UserPlus className="mr-1.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <SelectValue placeholder="Assign VA" />
                      </SelectTrigger>
                      <SelectContent>
                        {vas.length === 0 && (
                          <div className="px-2 py-1.5 text-xs text-muted-foreground">No managers/VAs found</div>
                        )}
                        {vas.map((v) => (
                          <SelectItem key={v.user_id} value={v.user_id}>
                            <span className="inline-flex items-center gap-1.5">
                              <span className="rounded-sm border border-border px-1 py-0.5 text-[9px] font-bold uppercase tracking-wide text-muted-foreground">
                                {v.role}
                              </span>
                              {v.display_name || v.email || v.user_id.slice(0, 8)}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    <Button
                      size="sm"
                      variant="outline"
                      className="h-10 gap-1.5 px-2.5 text-[11px] hover:border-emerald-500/50 hover:bg-emerald-500/10 hover:text-emerald-600 dark:hover:text-emerald-400 sm:h-9"
                      onClick={() => markContacted.mutate(r)}
                      disabled={markContacted.isPending}
                    >
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0" /> contacted
                    </Button>

                    <Button size="sm" variant="outline"
                      className="h-10 gap-1.5 px-2.5 text-[11px] hover:border-emerald-500/50 hover:bg-emerald-500/10 hover:text-emerald-600 dark:hover:text-emerald-400 sm:h-9"
                      onClick={() => passedTest.mutate(r)}
                      disabled={passedTest.isPending}
                      aria-label="Mark applicant as passed their test"
                      title="Applicant passed their test — mark and notify manager">
                      <Trophy className="h-3.5 w-3.5 shrink-0" /> passed
                    </Button>

                    {r.source === "aged_lead" && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-10 gap-1.5 px-2.5 text-[11px] sm:h-9"
                        onClick={() => promoteAged.mutate(r.id)}
                        disabled={busyPromote}
                        title="Turn this Excel-imported lead into a real applicant record"
                        aria-label="Convert Excel-imported lead to applicant"
                      >
                        {busyPromote ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" /> : <ArrowRight className="h-3.5 w-3.5 shrink-0" />}
                        convert
                      </Button>
                    )}

                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-10 w-10 shrink-0 p-0 text-rose-600 hover:bg-rose-500/10 hover:text-rose-600 dark:text-rose-400 dark:hover:text-rose-400 sm:h-9 sm:w-9"
                      title="Suppress this record"
                      aria-label={`Suppress ${fullName(r)}`}
                      onClick={() => requestSuppress(toRecoveryBatchRow(r))}
                    >
                      <ShieldOff className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
        {filtered.length > visibleCount && (
          <div className="flex flex-wrap items-center justify-center gap-3 pt-4 text-sm">
            <span className="text-muted-foreground">
              Showing {visibleCount.toLocaleString()} of {filtered.length.toLocaleString()}
            </span>
            <button
              type="button"
              onClick={() => setVisibleCount((n) => n + 200)}
              className="rounded-md border border-border bg-muted/40 px-4 py-1.5 font-medium text-foreground transition hover:bg-muted"
            >
              Show more ({(filtered.length - visibleCount).toLocaleString()} hidden)
            </button>
            <button
              type="button"
              onClick={() => setVisibleCount(filtered.length)}
              className="rounded-md px-3 py-1.5 font-medium text-primary transition hover:underline"
            >
              Show all
            </button>
          </div>
        )}
      </GlassCard>

      <RecoveryBatchDrawer
        open={batchOpen}
        onOpenChange={setBatchOpen}
        queue={batchQueue}
        startIndex={batchStart}
        onRequestSuppress={requestSuppress}
      />

      <SuppressionDialog
        open={suppressOpen}
        onOpenChange={setSuppressOpen}
        target={suppressTarget}
      />

      <div className="pb-2 pt-6 text-center text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
        Hold the Standard · Average is the disease
      </div>
    </div>
  );
}

function TotalTile({
  label,
  value,
  icon,
  tone,
  hint,
  emphasis,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  tone: string;
  hint?: string;
  /** Border-only tint for the tile that is itself in a bad state. */
  emphasis?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-card p-3 sm:p-4",
        emphasis && "border-rose-500/35",
      )}
      title={hint}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0 truncate text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{label}</span>
        <span className="shrink-0 text-muted-foreground">{icon}</span>
      </div>
      <div className={cn("mt-2 text-2xl font-bold leading-none tabular-nums", tone)}>{value.toLocaleString()}</div>
    </div>
  );
}

function FilterPill({
  children,
  active,
  onClick,
  tone,
}: {
  children: React.ReactNode;
  active: boolean;
  onClick: () => void;
  tone?: "rose";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex h-10 shrink-0 items-center rounded-md border px-3 text-xs font-semibold transition-colors sm:h-9",
        "focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)]",
        active
          ? "border-primary/50 bg-primary/5 text-foreground ring-2 ring-primary/60"
          : "border-border bg-background text-muted-foreground hover:bg-muted/30",
        tone === "rose" && "text-rose-600 dark:text-rose-400",
      )}
    >
      {children}
    </button>
  );
}
