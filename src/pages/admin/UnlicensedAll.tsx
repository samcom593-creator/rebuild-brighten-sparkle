import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
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
  MapPin,
  Sparkles,
  Instagram,
  FileSpreadsheet,
  ClipboardCheck,
  ArrowRight,
  Loader2,
  Trophy,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { usePageTitle } from "@/hooks/usePageTitle";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

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
const STAGES: Array<{ key: string; label: string; tone: string }> = [
  { key: "unlicensed",         label: "unlicensed",         tone: "bg-slate-500/15 text-slate-300 border-slate-500/40" },
  { key: "course_purchased",   label: "course purchased",   tone: "bg-rose-500/15 text-rose-300 border-rose-500/40" },
  { key: "in_course",          label: "in course",          tone: "bg-sky-500/15 text-sky-300 border-sky-500/40" },
  { key: "finished_course",    label: "finished course",    tone: "bg-amber-500/15 text-amber-300 border-amber-500/40" },
  { key: "test_scheduled",     label: "test scheduled",     tone: "bg-amber-500/15 text-amber-300 border-amber-500/40" },
  { key: "passed_test",        label: "passed test",        tone: "bg-emerald-500/15 text-emerald-300 border-emerald-500/40" },
  { key: "waiting_on_license", label: "waiting on license", tone: "bg-emerald-500/15 text-emerald-300 border-emerald-500/40" },
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

function ghostTone(days: number | null): { badge: string; ring: string; dot: string } {
  const d = days ?? 0;
  if (d < 7) return { badge: "bg-emerald-500/15 text-emerald-300 border-emerald-500/40", ring: "ring-emerald-500/20", dot: "bg-emerald-400" };
  if (d < 30) return { badge: "bg-amber-500/15 text-amber-300 border-amber-500/40", ring: "ring-amber-500/20", dot: "bg-amber-400" };
  return { badge: "bg-rose-500/20 text-rose-200 border-rose-500/50", ring: "ring-rose-500/30", dot: "bg-rose-400" };
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
      const ids = Array.from(new Set((roleRows ?? []).map((r: any) => r.user_id)));
      if (ids.length === 0) return [];
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, email, display_name, full_name")
        .in("id", ids);
      const profMap = new Map<string, { email: string | null; display_name: string | null }>();
      (profiles ?? []).forEach((p: any) => {
        profMap.set(p.id, {
          email: p.email ?? null,
          display_name: p.display_name ?? p.full_name ?? null,
        });
      });
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

  return (
    <div className="page-enter px-4 sm:px-6 pb-24 space-y-5 max-w-6xl mx-auto">
      <PageHeader
        eyebrow="License Recovery"
        eyebrowIcon={<Sparkles className="h-3 w-3" />}
        title="Unlicensed Queue"
        subtitle="Every applicant without a license. Route to a VA, work the ghosted 30d+ pile daily."
      />

      {/* Gradient totals card */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="relative overflow-hidden rounded-2xl border border-white/10 p-5 sm:p-6"
        style={{
          background:
            "linear-gradient(135deg, hsl(20 90% 55% / 0.18) 0%, hsl(340 80% 55% / 0.14) 45%, hsl(260 70% 50% / 0.18) 100%)",
          boxShadow:
            "0 20px 60px -20px hsl(340 80% 30% / 0.45), inset 0 1px 0 hsl(0 0% 100% / 0.06)",
        }}
      >
        <div className="absolute inset-0 pointer-events-none opacity-40" style={{ background: "radial-gradient(circle at 20% 20%, hsl(30 100% 60% / 0.35), transparent 60%)" }} />
        <div className="relative grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          <TotalTile label="Total unlicensed" value={totals.total} icon={<Users className="h-4 w-4" />} tone="text-white" />
          <TotalTile label="Ghosted 30d+" value={totals.ghosted} icon={<Ghost className="h-4 w-4" />} tone="text-rose-300" />
          <TotalTile label="Assigned" value={totals.assigned} icon={<UserCheck className="h-4 w-4" />} tone="text-emerald-300" />
          <TotalTile label="Unassigned" value={totals.unassigned} icon={<UserMinus className="h-4 w-4" />} tone="text-amber-300" />
        </div>
      </motion.div>

      {/* Filter + sort bar */}
      <Card className="border-white/10 bg-white/[0.02] backdrop-blur">
        <CardContent className="p-3 sm:p-4 flex flex-col md:flex-row gap-3 items-stretch md:items-center">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-widest text-slate-500">
              <Filter className="h-3 w-3" /> Filter
            </span>
            <FilterPill active={filter === "all"} onClick={() => setFilter("all")}>All</FilterPill>
            <FilterPill active={filter === "unassigned"} onClick={() => setFilter("unassigned")}>Unassigned</FilterPill>
            <FilterPill active={filter === "ghosted_30"} onClick={() => setFilter("ghosted_30")} tone="rose">Ghosted 30d+</FilterPill>
            <FilterPill active={filter === "by_stage"} onClick={() => setFilter("by_stage")}>By stage</FilterPill>
            {filter === "by_stage" && (
              <Select value={stageFilter} onValueChange={setStageFilter}>
                <SelectTrigger className="h-8 text-xs w-[180px] bg-white/5 border-white/10">
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

          <div className="md:ml-auto flex items-center gap-2">
            <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-widest text-slate-500">
              <ArrowUpDown className="h-3 w-3" /> Sort
            </span>
            <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
              <SelectTrigger className="h-8 text-xs w-[180px] bg-white/5 border-white/10">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="newest">Newest</SelectItem>
                <SelectItem value="ghosted_longest">Ghosted longest</SelectItem>
                <SelectItem value="alpha">Alphabetical</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full rounded-xl" />
          ))}
        </div>
      )}

      {!isLoading && filtered.length === 0 && (
        <Card className="border-white/10 bg-white/[0.02]">
          <CardContent className="p-10 text-center text-sm text-slate-400">
            No applicants match this filter. That's a good problem — or check that v_unlicensed_all is populated.
          </CardContent>
        </Card>
      )}

      <AnimatePresence initial={false}>
        <div className="space-y-2">
          {filtered.map((r, idx) => {
            const days = r.days_since_touch ?? 0;
            const tone = ghostTone(days);
            const stg = stageMeta(r.license_progress);
            const busyStage = setStage.isPending && setStage.variables?.row.id === r.id;
            const busyBad = markBadPhone.isPending && markBadPhone.variables?.id === r.id;
            const busyPromote = promoteAged.isPending && promoteAged.variables === r.id;
            const isBadPhone = !!r.phone_bad_at;
            return (
              <motion.div
                key={`${r.source}-${r.id}`}
                layout
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.22, delay: Math.min(idx, 12) * 0.015 }}
              >
                <div
                  className={cn(
                    "group relative overflow-hidden rounded-xl border border-white/10 p-3 sm:p-4",
                    "bg-white/[0.03] backdrop-blur-xl ring-1",
                    tone.ring,
                    "hover:border-white/20 transition-colors",
                  )}
                  style={{ boxShadow: "inset 0 1px 0 hsl(0 0% 100% / 0.05), 0 8px 30px -12px hsl(222 60% 0% / 0.55)" }}
                >
                  <div className="flex flex-col lg:flex-row lg:items-center gap-3">
                    {/* Identity + inline stage picker */}
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <div className={cn("h-2.5 w-2.5 rounded-full shrink-0 animate-pulse", tone.dot)} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-sm sm:text-base truncate text-slate-100">{fullName(r)}</span>
                          {r.state && (
                            <span className="inline-flex items-center gap-1 text-[11px] text-slate-400">
                              <MapPin className="h-3 w-3" />{r.state}
                            </span>
                          )}
                          {r.source === "aged_lead" && (
                            <span title="Imported from Excel — hasn't formally applied yet" className="inline-flex items-center gap-1 text-[10px] bg-violet-500/20 text-violet-300 border border-violet-500/30 rounded-full px-1.5 py-0.5">
                              <FileSpreadsheet className="h-2.5 w-2.5" /> excel
                            </span>
                          )}
                          {r.source === "applied" && (
                            <span title="Filled out the public application" className="inline-flex items-center gap-1 text-[10px] bg-sky-500/20 text-sky-300 border border-sky-500/30 rounded-full px-1.5 py-0.5">
                              <ClipboardCheck className="h-2.5 w-2.5" /> applied
                            </span>
                          )}
                        </div>
                        <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                          {/* XCEL course progress — merged in by email from v_xcel_person_progress */}
                          {(r.xcel_overall_pct != null || r.xcel_final_exam_score != null || r.xcel_state_license_number) && (
                            <>
                              <Badge
                                variant="outline"
                                className="text-[10px] uppercase bg-indigo-500/15 text-indigo-200 border-indigo-500/40 gap-1"
                              >
                                <span>XCEL {r.xcel_overall_pct ?? 0}%</span>
                                {(r.xcel_final_exam_score ?? 0) >= 70 ? (
                                  <CheckCircle2 className="h-3 w-3 text-emerald-300" />
                                ) : null}
                                {r.xcel_state_license_number ? (
                                  <span>· lic {r.xcel_state_license_number}</span>
                                ) : null}
                              </Badge>
                              {(r.xcel_final_exam_score ?? 0) >= 70 &&
                                r.license_progress !== "passed_test" &&
                                r.license_progress !== "waiting_on_license" && (
                                  <Badge
                                    variant="outline"
                                    className="text-[10px] uppercase bg-amber-500/15 text-amber-200 border-amber-500/40"
                                    title="XCEL says they passed — advance the stage"
                                  >
                                    sync ready
                                  </Badge>
                                )}
                            </>
                          )}
                          {/* Tap-to-cycle stage — Sam's #1 gripe */}
                          <Select
                            value={r.license_progress ?? "unlicensed"}
                            onValueChange={(v) => setStage.mutate({ row: r, progress: v })}
                          >
                            <SelectTrigger className={cn("h-7 text-[10px] uppercase tracking-wide w-auto min-w-[150px] px-2 border", stg.tone, busyStage && "opacity-60")}>
                              <SelectValue>
                                {busyStage ? <Loader2 className="h-3 w-3 animate-spin" /> : stg.label}
                              </SelectValue>
                            </SelectTrigger>
                            <SelectContent>
                              {STAGES.map((s) => (
                                <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Badge variant="outline" className={cn("text-[10px]", tone.badge)}>{days}d ghosted</Badge>
                          {isBadPhone && (
                            <Badge variant="outline" className="text-[10px] bg-rose-500/15 text-rose-300 border-rose-500/30 gap-1">
                              <PhoneOff className="h-2.5 w-2.5" /> bad #
                            </Badge>
                          )}
                          {r.assigned_va_email && (
                            <span className="text-[10px] text-emerald-300/80 truncate">→ {r.assigned_va_email}</span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* One-tap contact actions */}
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {r.phone && !isBadPhone && (
                        <a
                          href={telHref(r.phone)}
                          className="inline-flex items-center gap-1.5 text-xs bg-emerald-500 hover:bg-emerald-600 text-white px-2.5 py-1.5 rounded-md font-medium transition-colors"
                          onClick={() => {
                            if (r.source === 'applied') {
                              supabase.rpc("log_contact_attempt" as any, {
                                p_application_id: r.id, p_channel: 'phone', p_outcome: 'attempted', p_notes: null,
                                // empty-catch-allow:fire-and-forget tel-click telemetry — must not block navigation
                              }).catch(() => {});
                            }
                          }}
                        >
                          <Phone className="h-3 w-3" />{formatPhone(r.phone)}
                        </a>
                      )}
                      {r.email && (
                        <a
                          href={`mailto:${r.email}`}
                          className="inline-flex items-center gap-1.5 text-xs bg-white/5 hover:bg-white/10 text-slate-200 border border-white/10 px-2.5 py-1.5 rounded-md font-medium max-w-[200px] truncate"
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
                          <Mail className="h-3 w-3 shrink-0" />
                          <span className="truncate">{r.email}</span>
                        </a>
                      )}
                      {r.instagram_handle && (
                        <a
                          href={`https://instagram.com/${r.instagram_handle.replace(/^@+/, "")}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-pink-400 hover:text-pink-300 border border-pink-500/30 bg-pink-500/10 rounded-md px-2 py-1.5"
                          title={`@${r.instagram_handle.replace(/^@+/, "")}`}
                          aria-label={`Instagram @${r.instagram_handle.replace(/^@+/, "")}`}
                        >
                          <Instagram className="h-3 w-3" />
                        </a>
                      )}
                      {r.phone && !isBadPhone && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 w-8 p-0 text-rose-400 hover:text-rose-300 hover:bg-rose-500/10"
                          title="Mark number bad + email them"
                          aria-label="Mark phone number bad and email them"
                          onClick={() => markBadPhone.mutate(r)}
                          disabled={busyBad}
                        >
                          {busyBad ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PhoneOff className="h-3.5 w-3.5" />}
                        </Button>
                      )}
                    </div>

                    {/* Assignment + contacted + promote */}
                    <div className="flex items-center gap-2 lg:ml-auto">
                      <Select
                        value={r.assigned_va_id ?? ""}
                        onValueChange={(v) => v && assignVa.mutate({ row: r, vaId: v })}
                      >
                        <SelectTrigger className="h-8 w-[150px] text-xs bg-white/5 border-white/10">
                          <UserPlus className="h-3 w-3 mr-1.5" />
                          <SelectValue placeholder="Assign VA" />
                        </SelectTrigger>
                        <SelectContent>
                          {vas.length === 0 && (
                            <div className="px-2 py-1.5 text-xs text-slate-500">No managers/VAs found</div>
                          )}
                          {vas.map((v) => (
                            <SelectItem key={v.user_id} value={v.user_id}>
                              <span className="inline-flex items-center gap-1.5">
                                <span className={cn("rounded px-1 py-0.5 text-[9px] uppercase tracking-wide",
                                  v.role === "manager" ? "bg-amber-500/20 text-amber-300" : "bg-sky-500/20 text-sky-300")}>
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
                        className="h-8 text-xs border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20"
                        onClick={() => markContacted.mutate(r)}
                        disabled={markContacted.isPending}
                      >
                        <CheckCircle2 className="h-3 w-3 mr-1.5" /> contacted
                      </Button>

                      <Button size="sm" variant="outline"
                        className="h-8 text-xs border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20"
                        onClick={() => passedTest.mutate(r)}
                        disabled={passedTest.isPending}
                        aria-label="Mark applicant as passed their test"
                        title="Applicant passed their test — mark and notify manager">
                        <Trophy className="h-3 w-3 mr-1.5" /> passed
                      </Button>

                      {r.source === "aged_lead" && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 text-xs border-violet-500/40 bg-violet-500/10 text-violet-300 hover:bg-violet-500/20"
                          onClick={() => promoteAged.mutate(r.id)}
                          disabled={busyPromote}
                          title="Turn this Excel-imported lead into a real applicant record"
                          aria-label="Convert Excel-imported lead to applicant"
                        >
                          {busyPromote ? <Loader2 className="h-3 w-3 mr-1.5 animate-spin" /> : <ArrowRight className="h-3 w-3 mr-1.5" />}
                          convert
                        </Button>
                      )}
                    </div>
                  </div>

                  {days >= 30 && (
                    <div className="pointer-events-none absolute inset-y-0 left-0 w-1" style={{ background: "linear-gradient(180deg, hsl(0 80% 60%), hsl(340 80% 55%))" }} />
                  )}
                  {days >= 30 && <Flame className="pointer-events-none absolute top-2 right-2 h-3.5 w-3.5 text-rose-400/70" />}
                </div>
              </motion.div>
            );
          })}
        </div>
      </AnimatePresence>

      <div className="text-center text-[10px] text-slate-500 uppercase tracking-widest pt-6 pb-2">
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
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  tone: string;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 backdrop-blur-lg p-3 sm:p-4">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-widest text-slate-300/80">{label}</span>
        <span className="text-slate-300/70">{icon}</span>
      </div>
      <div className={cn("mt-1.5 text-2xl sm:text-3xl font-bold tabular-nums", tone)}>{value}</div>
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
      className={cn(
        "h-8 px-3 rounded-full text-xs font-medium border transition-colors",
        active
          ? tone === "rose"
            ? "bg-rose-500/25 text-rose-100 border-rose-500/50"
            : "bg-amber-400/20 text-amber-200 border-amber-400/50"
          : "bg-white/5 text-slate-300 border-white/10 hover:bg-white/10",
      )}
    >
      {children}
    </button>
  );
}
