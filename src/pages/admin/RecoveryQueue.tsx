import { useMemo, useState, useCallback, KeyboardEvent } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Phone, Mail, MessageSquare, ChevronRight, Flame, AlertTriangle, GraduationCap,
  CheckCircle2, Trophy, Calendar, BookOpen, Ghost, RefreshCw, Search, ArrowRight,
  MapPin, PhoneOff, CheckCheck, Zap, Filter, ExternalLink, Clock, PlayCircle,
  ChevronDown, X,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { usePageTitle } from "@/hooks/usePageTitle";
import { PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { AnimatedCounter } from "@/components/ui/animated-counter";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ApplicationDetailSheet } from "@/components/dashboard/ApplicationDetailSheet";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

// ---------- Types ----------
interface Row {
  application_id: string;
  name: string;
  phone: string | null;
  email: string | null;
  state: string | null;
  license_status: string | null;
  license_progress: string | null;
  course_purchased: string | null;
  exam_scheduled: string | null;
  exam_passed: string | null;
  licensed_date: string | null;
  assigned_agent_id: string | null;
  last_contacted_at: string | null;
  cohort: string;
  days_since_touch: number | null;
}

type CohortKey =
  | "A_WAITING_ON_LICENSE"
  | "B_PASSED_TEST_NO_LIC_YET"
  | "C_TEST_SCHEDULED"
  | "D_FINISHED_COURSE_NO_EXAM"
  | "E_BOUGHT_NEVER_STARTED"
  | "F_COURSE_IN_PROGRESS"
  | "G_UNLICENSED_STARTER";

type Priority = "critical" | "hot" | "today" | "stale" | "watch" | "low";
type SortKey = "priority" | "closest" | "stale" | "recent" | "newest" | "alpha";

// ---------- Cohort meta ----------
const COHORT_META: Record<CohortKey, {
  label: string;
  short: string;
  help: string;
  action: string;
  icon: React.ComponentType<{ className?: string }>;
  accent: string; // text color
  bar: string; // urgency accent bar
  ring: string; // active ring
  weight: number;
}> = {
  A_WAITING_ON_LICENSE: {
    label: "Waiting on License",
    short: "Waiting",
    help: "Passed exam. Chase state issuance today.",
    action: "Confirm license issued",
    icon: CheckCircle2,
    accent: "text-teal-300",
    bar: "bg-teal-400",
    ring: "ring-teal-400/70",
    weight: 1,
  },
  B_PASSED_TEST_NO_LIC_YET: {
    label: "Passed Test",
    short: "Passed",
    help: "Passed but progress not flipped. Move to waiting on license.",
    action: "Move to waiting on license",
    icon: Trophy,
    accent: "text-teal-300",
    bar: "bg-teal-400",
    ring: "ring-teal-400/70",
    weight: 2,
  },
  C_TEST_SCHEDULED: {
    label: "Test Scheduled",
    short: "Scheduled",
    help: "Push day of exam. Confirm they show up.",
    action: "Confirm exam attendance",
    icon: Calendar,
    accent: "text-amber-300",
    bar: "bg-amber-400",
    ring: "ring-amber-400/70",
    weight: 3,
  },
  D_FINISHED_COURSE_NO_EXAM: {
    label: "Finished Course",
    short: "Finished",
    help: "Course done. Book the state exam now.",
    action: "Push exam scheduling",
    icon: GraduationCap,
    accent: "text-yellow-300",
    bar: "bg-yellow-400",
    ring: "ring-yellow-400/70",
    weight: 4,
  },
  E_BOUGHT_NEVER_STARTED: {
    label: "Bought Never Started",
    short: "Bought",
    help: "Paid but never opened the course. Re-engage or dispose.",
    action: "Reactivate course access",
    icon: AlertTriangle,
    accent: "text-rose-300",
    bar: "bg-rose-400",
    ring: "ring-rose-400/70",
    weight: 5,
  },
  F_COURSE_IN_PROGRESS: {
    label: "Course In Progress",
    short: "In Progress",
    help: "Studying. Nudge every three to five days.",
    action: "Nudge on course progress",
    icon: BookOpen,
    accent: "text-sky-300",
    bar: "bg-sky-400",
    ring: "ring-sky-400/70",
    weight: 6,
  },
  G_UNLICENSED_STARTER: {
    label: "Unlicensed Starter",
    short: "Starter",
    help: "Applied but no course purchased. Sell the value.",
    action: "Sell pre licensing course",
    icon: Ghost,
    accent: "text-slate-300",
    bar: "bg-slate-400",
    ring: "ring-slate-400/70",
    weight: 7,
  },
};

const COHORT_ORDER: CohortKey[] = [
  "A_WAITING_ON_LICENSE",
  "B_PASSED_TEST_NO_LIC_YET",
  "C_TEST_SCHEDULED",
  "D_FINISHED_COURSE_NO_EXAM",
  "F_COURSE_IN_PROGRESS",
  "E_BOUGHT_NEVER_STARTED",
  "G_UNLICENSED_STARTER",
];

const PRIORITY_META: Record<Priority, { label: string; tone: string; ring: string }> = {
  critical: { label: "Critical", tone: "bg-rose-500/15 text-rose-300 border-rose-500/40", ring: "before:bg-rose-400" },
  hot:      { label: "Hot",      tone: "bg-amber-500/15 text-amber-300 border-amber-500/40", ring: "before:bg-amber-400" },
  today:    { label: "Today",    tone: "bg-teal-500/15 text-teal-300 border-teal-500/40",   ring: "before:bg-teal-400" },
  stale:    { label: "Stale",    tone: "bg-orange-500/15 text-orange-300 border-orange-500/40", ring: "before:bg-orange-400" },
  watch:    { label: "Watch",    tone: "bg-slate-500/15 text-slate-300 border-slate-500/40", ring: "before:bg-slate-500" },
  low:      { label: "Low",      tone: "bg-slate-500/10 text-slate-400 border-slate-500/30", ring: "before:bg-slate-600" },
};

const LICENSE_STAGES: { key: string; label: string }[] = [
  { key: "unlicensed", label: "Unlicensed" },
  { key: "course_purchased", label: "Course Purchased" },
  { key: "finished_course", label: "Finished Course" },
  { key: "test_scheduled", label: "Test Scheduled" },
  { key: "passed_test", label: "Passed Test" },
  { key: "fingerprints_done", label: "Fingerprints Done" },
  { key: "waiting_on_license", label: "Waiting on License" },
  { key: "licensed", label: "Licensed" },
];

// ---------- Helpers ----------
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
function smsHref(raw: string | null): string {
  if (!raw) return "#";
  const digits = raw.replace(/\D/g, "");
  return `sms:${digits.startsWith("1") ? "+" : "+1"}${digits}`;
}
function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (isNaN(then)) return null;
  const diff = then - Date.now();
  return Math.round(diff / 86400000);
}
function derivePriority(r: Row): Priority {
  const cohort = r.cohort as CohortKey;
  const stale = r.days_since_touch ?? 0;
  const untilExam = daysUntil(r.exam_scheduled);
  if (cohort === "A_WAITING_ON_LICENSE" || cohort === "B_PASSED_TEST_NO_LIC_YET") {
    if (stale > 3) return "critical";
    return "critical";
  }
  if (cohort === "C_TEST_SCHEDULED" && untilExam !== null && untilExam <= 7 && untilExam >= -1) {
    return "critical";
  }
  if (cohort === "C_TEST_SCHEDULED" || cohort === "D_FINISHED_COURSE_NO_EXAM") return "hot";
  if (stale >= 30 && (cohort === "E_BOUGHT_NEVER_STARTED" || cohort === "F_COURSE_IN_PROGRESS")) return "stale";
  if (cohort === "E_BOUGHT_NEVER_STARTED" || cohort === "F_COURSE_IN_PROGRESS") return "watch";
  if (cohort === "G_UNLICENSED_STARTER" && stale >= 60) return "low";
  return "low";
}
function proximityScore(r: Row): number {
  // Lower = closer to licensed
  const cohort = r.cohort as CohortKey;
  const w = COHORT_META[cohort]?.weight ?? 9;
  return w * 1000 - (r.days_since_touch ?? 0);
}
function priorityScore(r: Row): number {
  const p = derivePriority(r);
  const rank: Record<Priority, number> = { critical: 0, hot: 1, today: 2, stale: 3, watch: 4, low: 5 };
  return rank[p] * 10000 + (COHORT_META[r.cohort as CohortKey]?.weight ?? 9) * 100 - (r.days_since_touch ?? 0);
}
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  return (parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "");
}
function relTime(iso: string | null): string {
  if (!iso) return "never";
  const then = new Date(iso).getTime();
  if (isNaN(then)) return "never";
  const diff = Date.now() - then;
  const d = Math.round(diff / 86400000);
  if (d <= 0) return "today";
  if (d === 1) return "1 day ago";
  if (d < 30) return `${d} days ago`;
  const m = Math.round(d / 30);
  return m === 1 ? "1 month ago" : `${m} months ago`;
}

// ---------- Row card ----------
function PriorityBadge({ p }: { p: Priority }) {
  const m = PRIORITY_META[p];
  return (
    <span className={cn("inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide", m.tone)}>
      {m.label}
    </span>
  );
}

function CohortBadge({ cohort }: { cohort: CohortKey }) {
  const meta = COHORT_META[cohort];
  const Icon = meta.icon;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/[0.04] px-1.5 py-0.5 text-[10px] font-medium", meta.accent)}>
      <Icon className="h-2.5 w-2.5" />
      {meta.short}
    </span>
  );
}

function MilestoneChip({ date, label, done }: { date: string | null; label: string; done: boolean }) {
  if (!date && !done) return null;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn(
          "inline-flex items-center gap-1 rounded border px-1 py-0.5 text-[10px]",
          done ? "border-teal-500/40 bg-teal-500/10 text-teal-300" : "border-slate-500/30 bg-slate-500/10 text-slate-400"
        )}>
          <span className={cn("h-1.5 w-1.5 rounded-full", done ? "bg-teal-400" : "bg-slate-500")} />
          {label}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top">
        {date ? `${label}: ${new Date(date).toLocaleDateString()}` : label}
      </TooltipContent>
    </Tooltip>
  );
}

interface RowActionsProps {
  row: Row;
  onOpen: () => void;
  onMarkContacted: () => void;
  onMarkPhoneBad: () => void;
  onSetStage: (stage: string) => void;
  onLogTel: () => void;
  onLogSms: () => void;
  onLogEmail: () => void;
}

function RowActions({ row, onOpen, onMarkContacted, onMarkPhoneBad, onSetStage, onLogTel, onLogSms, onLogEmail }: RowActionsProps) {
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  return (
    <div className="flex items-center gap-1" onClick={stop}>
      <Tooltip>
        <TooltipTrigger asChild>
          <a
            href={telHref(row.phone)}
            aria-label={row.phone ? `Call ${row.name}` : "No phone on file"}
            onClick={row.phone ? onLogTel : (e) => e.preventDefault()}
            className={cn(
              "inline-flex h-9 w-9 items-center justify-center rounded-lg border border-teal-500/40 bg-teal-500/15 text-teal-300 transition-colors",
              row.phone ? "hover:bg-teal-500/25" : "opacity-40 cursor-not-allowed"
            )}
          >
            <Phone className="h-4 w-4" />
          </a>
        </TooltipTrigger>
        <TooltipContent>Call {formatPhone(row.phone) || "no phone"}</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <a
            href={smsHref(row.phone)}
            aria-label={row.phone ? `Text ${row.name}` : "No phone on file"}
            onClick={row.phone ? onLogSms : (e) => e.preventDefault()}
            className={cn(
              "inline-flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-slate-200 transition-colors",
              row.phone ? "hover:bg-white/[0.08]" : "opacity-40 cursor-not-allowed"
            )}
          >
            <MessageSquare className="h-4 w-4" />
          </a>
        </TooltipTrigger>
        <TooltipContent>Send SMS</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <a
            href={row.email ? `mailto:${row.email}` : "#"}
            aria-label={row.email ? `Email ${row.name}` : "No email on file"}
            onClick={row.email ? onLogEmail : (e) => e.preventDefault()}
            className={cn(
              "inline-flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-slate-200 transition-colors",
              row.email ? "hover:bg-white/[0.08]" : "opacity-40 cursor-not-allowed"
            )}
          >
            <Mail className="h-4 w-4" />
          </a>
        </TooltipTrigger>
        <TooltipContent>Email {row.email || "(no email)"}</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label="Mark contacted"
            onClick={onMarkContacted}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-slate-200 hover:bg-white/[0.08] transition-colors"
          >
            <CheckCheck className="h-4 w-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent>Mark contacted</TooltipContent>
      </Tooltip>

      <Popover>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label="Change license stage"
                onClick={stop}
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-slate-200 hover:bg-white/[0.08] transition-colors"
              >
                <ChevronDown className="h-4 w-4" />
              </button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent>Advance stage</TooltipContent>
        </Tooltip>
        {/* palette-allow:apex-panel-dark — matches AppShell popover surface tone */}
        <PopoverContent align="end" className="w-56 p-1 bg-[#0B1118] border-white/10" onClick={stop}>
          <div className="px-2 py-1.5 text-[10px] uppercase tracking-wide text-slate-500">Set license stage</div>
          {LICENSE_STAGES.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => onSetStage(s.key)}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors",
                row.license_progress === s.key
                  ? "bg-teal-500/15 text-teal-200"
                  : "text-slate-300 hover:bg-white/[0.06]"
              )}
            >
              <div className={cn("h-1.5 w-1.5 rounded-full", row.license_progress === s.key ? "bg-teal-400" : "bg-slate-600")} />
              {s.label}
            </button>
          ))}
          <div className="mt-1 border-t border-white/10 pt-1">
            <button
              type="button"
              onClick={onMarkPhoneBad}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-rose-300 hover:bg-rose-500/10"
            >
              <PhoneOff className="h-3.5 w-3.5" />
              Mark phone bad
            </button>
          </div>
        </PopoverContent>
      </Popover>

      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label="Open details"
            onClick={onOpen}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-slate-200 hover:bg-white/[0.08] transition-colors"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent>Open details</TooltipContent>
      </Tooltip>
    </div>
  );
}

// ---------- Manager avatar (batched) ----------
interface Profile { id: string; first_name: string | null; last_name: string | null; display_name: string | null; avatar_url: string | null; }
function useManagerProfiles(ids: string[]) {
  return useQuery({
    queryKey: ["recovery-queue-managers", ids.slice().sort().join(",")],
    enabled: ids.length > 0,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, first_name, last_name, display_name, avatar_url")
        .in("id", ids);
      if (error) throw error;
      const map: Record<string, Profile> = {};
      (data ?? []).forEach((p: any) => { map[p.id] = p; });
      return map;
    },
  });
}

function ManagerAvatar({ profile }: { profile?: Profile }) {
  const name = profile?.display_name || [profile?.first_name, profile?.last_name].filter(Boolean).join(" ") || "";
  const initials = name ? initialsOf(name).toUpperCase() : "";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-white/10 bg-white/[0.06] text-[10px] font-semibold text-slate-200">
          {initials || "?"}
        </div>
      </TooltipTrigger>
      <TooltipContent>{name ? `Assigned: ${name}` : "Assigned manager"}</TooltipContent>
    </Tooltip>
  );
}

// ---------- Main page ----------
export default function RecoveryQueue() {
  usePageTitle("License Push · APEX");
  const qc = useQueryClient();
  const [openId, setOpenId] = useState<string | null>(null);
  const [openAgentId, setOpenAgentId] = useState<string | null>(null);
  const [stageFilter, setStageFilter] = useState<CohortKey | null>(null);
  const [priorityChip, setPriorityChip] = useState<"today" | "critical" | null>(null);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("priority");
  const [powerHour, setPowerHour] = useState(false);

  const { data: rows = [], isLoading, isError, refetch, isFetching } = useQuery<Row[]>({
    queryKey: ["v_hot_licensing_prospects"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_hot_licensing_prospects" as any)
        .select("*")
        .order("days_since_touch", { ascending: false });
      if (error) throw error;
      return (data as unknown as Row[]) ?? [];
    },
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });

  // Manager profiles batched from visible rows
  const managerIds = useMemo(() => {
    const s = new Set<string>();
    rows.forEach((r) => { if (r.assigned_agent_id) s.add(r.assigned_agent_id); });
    return Array.from(s);
  }, [rows]);
  const { data: managerMap = {} } = useManagerProfiles(managerIds);

  const invalidate = useCallback(() => {
    qc.invalidateQueries({ queryKey: ["v_hot_licensing_prospects"] });
  }, [qc]);

  // ---------- Mutations ----------
  const markContacted = useMutation({
    mutationFn: async (row: Row) => {
      const { error } = await supabase.rpc("unified_mark_contacted" as any, {
        p_id: row.application_id,
        p_source: "applied",
      });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Marked contacted"); invalidate(); },
    onError: (e) => toast.error(`Update failed: ${String(e)}`),
  });

  const setStage = useMutation({
    mutationFn: async ({ row, stage }: { row: Row; stage: string }) => {
      const { error } = await supabase.rpc("unified_set_license_progress" as any, {
        p_id: row.application_id,
        p_progress: stage,
        p_source: "applied",
      });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Stage updated"); invalidate(); },
    onError: (e) => toast.error(`Stage update failed: ${String(e)}`),
  });

  const markPhoneBad = useMutation({
    mutationFn: async (row: Row) => {
      const { error } = await supabase.rpc("unified_mark_phone_bad" as any, {
        p_id: row.application_id,
        p_source: "applied",
        p_reason: "user_marked_bad",
      });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Phone marked bad"); invalidate(); },
    onError: (e) => toast.error(`Mark bad failed: ${String(e)}`),
  });

  const logAttempt = useCallback((id: string, channel: "call" | "sms" | "email") => {
    void supabase
      .rpc("log_contact_attempt" as any, {
        p_application_id: id,
        p_channel: channel,
        p_outcome: "initiated",
      })
      .then(() => undefined)
      // empty-catch-allow:fire-and-forget telemetry — must not block navigation
      .catch(() => undefined);
  }, []);

  // ---------- Filtering + sorting ----------
  const cohortCounts = useMemo(() => {
    const c: Record<CohortKey, number> = {
      A_WAITING_ON_LICENSE: 0, B_PASSED_TEST_NO_LIC_YET: 0, C_TEST_SCHEDULED: 0,
      D_FINISHED_COURSE_NO_EXAM: 0, E_BOUGHT_NEVER_STARTED: 0, F_COURSE_IN_PROGRESS: 0,
      G_UNLICENSED_STARTER: 0,
    };
    rows.forEach((r) => { if (r.cohort in c) c[r.cohort as CohortKey]++; });
    return c;
  }, [rows]);

  const insights = useMemo(() => {
    const urgent = rows.filter((r) => derivePriority(r) === "critical").length;
    const closest = rows.filter((r) =>
      r.cohort === "A_WAITING_ON_LICENSE" || r.cohort === "B_PASSED_TEST_NO_LIC_YET"
    ).length;
    const longest = rows.filter((r) => (r.days_since_touch ?? 0) >= 30).length;
    const followupDue = rows.filter((r) => (r.days_since_touch ?? 0) >= 3 && (r.days_since_touch ?? 0) <= 7).length;
    return { urgent, closest, longest, followupDue };
  }, [rows]);

  const filtered = useMemo(() => {
    let list = rows.slice();
    if (stageFilter) list = list.filter((r) => r.cohort === stageFilter);
    if (priorityChip === "today") list = list.filter((r) => (r.days_since_touch ?? 0) >= 3 && (r.days_since_touch ?? 0) <= 7);
    if (priorityChip === "critical") list = list.filter((r) => derivePriority(r) === "critical");
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((r) => {
        const managerName = r.assigned_agent_id
          ? [managerMap[r.assigned_agent_id]?.first_name, managerMap[r.assigned_agent_id]?.last_name].filter(Boolean).join(" ").toLowerCase()
          : "";
        return (
          r.name?.toLowerCase().includes(q) ||
          r.email?.toLowerCase().includes(q) ||
          r.phone?.toLowerCase().includes(q) ||
          r.state?.toLowerCase().includes(q) ||
          managerName.includes(q)
        );
      });
    }
    switch (sort) {
      case "priority":
        list.sort((a, b) => priorityScore(a) - priorityScore(b));
        break;
      case "closest":
        list.sort((a, b) => proximityScore(a) - proximityScore(b));
        break;
      case "stale":
        list.sort((a, b) => (b.days_since_touch ?? 0) - (a.days_since_touch ?? 0));
        break;
      case "recent":
        list.sort((a, b) => (a.days_since_touch ?? 0) - (b.days_since_touch ?? 0));
        break;
      case "newest":
        list.sort((a, b) => (a.days_since_touch ?? 0) - (b.days_since_touch ?? 0));
        break;
      case "alpha":
        list.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
        break;
    }
    return list;
  }, [rows, stageFilter, priorityChip, search, sort, managerMap]);

  // ---------- Power Hour ----------
  const startPowerHour = useCallback(() => {
    setPowerHour(true);
    setStageFilter("A_WAITING_ON_LICENSE");
    setSort("priority");
    const sorted = rows
      .filter((r) => r.cohort === "A_WAITING_ON_LICENSE")
      .sort((a, b) => priorityScore(a) - priorityScore(b));
    if (sorted.length === 0) {
      toast.info("No critical rows for Power Hour");
      setPowerHour(false);
      return;
    }
    setOpenId(sorted[0].application_id);
    setOpenAgentId(sorted[0].assigned_agent_id ?? null);
    toast.success(`Power Hour started · ${sorted.length} critical`);
  }, [rows]);

  const nextInQueue = useCallback(() => {
    if (!openId) return;
    const idx = filtered.findIndex((r) => r.application_id === openId);
    const next = filtered[idx + 1];
    if (next) {
      setOpenId(next.application_id);
      setOpenAgentId(next.assigned_agent_id ?? null);
    } else {
      setOpenId(null);
      setOpenAgentId(null);
      toast.success("Queue clear");
      setPowerHour(false);
    }
  }, [filtered, openId]);

  const openRow = useCallback((r: Row) => {
    setOpenId(r.application_id);
    setOpenAgentId(r.assigned_agent_id ?? null);
  }, []);

  const onRowKey = (e: KeyboardEvent<HTMLDivElement>, r: Row) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openRow(r);
    }
  };

  const resetFilters = () => {
    setStageFilter(null);
    setPriorityChip(null);
    setSearch("");
    setSort("priority");
  };

  const activeFilterCount = (stageFilter ? 1 : 0) + (priorityChip ? 1 : 0) + (search ? 1 : 0);

  return (
    <TooltipProvider delayDuration={200}>
      <div className="page-enter mx-auto w-full max-w-7xl space-y-4 px-4 pb-24 sm:px-6">
        {/* Header */}
        <PageHeader
          eyebrow="License Recovery"
          eyebrowIcon={<Flame className="h-3 w-3" />}
          title="License Push"
          subtitle="Prioritized recovery queue for applicants closest to licensing and production."
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <Button
                onClick={startPowerHour}
                className="h-9 gap-1.5 bg-teal-500 text-slate-950 hover:bg-teal-400"
              >
                <PlayCircle className="h-4 w-4" />
                Start Power Hour
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => refetch()}
                className="h-9 gap-1.5 border-white/10 bg-white/[0.04] hover:bg-white/[0.08]"
              >
                <RefreshCw className={cn("h-4 w-4", isFetching && "animate-spin")} />
                Refresh
              </Button>
            </div>
          }
        />

        {/* Insight chips */}
        <div className="flex flex-wrap items-center gap-2">
          <InsightChip icon={<Zap className="h-3 w-3" />} label="Urgent today" value={insights.urgent} tone="rose" onClick={() => setPriorityChip((p) => p === "critical" ? null : "critical")} active={priorityChip === "critical"} />
          <InsightChip icon={<CheckCircle2 className="h-3 w-3" />} label="Closest to licensed" value={insights.closest} tone="teal" onClick={() => setStageFilter((s) => s === "A_WAITING_ON_LICENSE" ? null : "A_WAITING_ON_LICENSE")} active={stageFilter === "A_WAITING_ON_LICENSE"} />
          <InsightChip icon={<Clock className="h-3 w-3" />} label="Longest stale" value={insights.longest} tone="amber" onClick={() => setSort("stale")} active={sort === "stale"} />
          <InsightChip icon={<Filter className="h-3 w-3" />} label="Follow ups due" value={insights.followupDue} tone="sky" onClick={() => setPriorityChip((p) => p === "today" ? null : "today")} active={priorityChip === "today"} />
        </div>

        {/* Status metric grid */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3 lg:grid-cols-7">
          {COHORT_ORDER.map((c) => {
            const meta = COHORT_META[c];
            const Icon = meta.icon;
            const active = stageFilter === c;
            const count = cohortCounts[c];
            return (
              <button
                key={c}
                type="button"
                aria-pressed={active}
                onClick={() => setStageFilter((s) => s === c ? null : c)}
                className={cn(
                  "group relative flex flex-col justify-between rounded-2xl border border-white/10 bg-white/[0.04] p-3 text-left transition-all hover:bg-white/[0.08] focus:outline-none focus-visible:shadow-[var(--apex-focus-ring)]",
                  active && cn("ring-2", meta.ring, "bg-white/[0.07]"),
                )}
              >
                <div className={cn("absolute inset-x-3 top-0 h-0.5 rounded-full opacity-70", meta.bar)} />
                <div className="flex items-start justify-between">
                  <div className={cn("inline-flex h-7 w-7 items-center justify-center rounded-lg border border-white/10 bg-black/30", meta.accent)}>
                    <Icon className="h-3.5 w-3.5" />
                  </div>
                  <span className="text-[10px] uppercase tracking-wide text-slate-500">{meta.short}</span>
                </div>
                <div className="mt-2">
                  <div className="text-2xl font-semibold text-slate-100">
                    <AnimatedCounter value={count} duration={0.4} />
                  </div>
                  <div className="mt-0.5 text-[11px] font-medium text-slate-300">{meta.label}</div>
                  <div className="mt-1 text-[10px] leading-tight text-slate-500">{meta.help}</div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Toolbar */}
        <div className="sticky top-0 z-20 -mx-4 border-y border-white/10 bg-black/60 px-4 py-3 backdrop-blur-md sm:-mx-6 sm:px-6">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name, phone, email, state, manager"
                className="h-9 border-white/10 bg-white/[0.04] pl-9 text-sm text-slate-100 placeholder:text-slate-500 focus-visible:ring-teal-400/70"
              />
            </div>

            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="h-9 gap-1.5 border-white/10 bg-white/[0.04] hover:bg-white/[0.08]">
                  <Filter className="h-3.5 w-3.5" />
                  Sort
                  <span className="ml-1 text-slate-400">
                    {sort === "priority" ? "Highest priority"
                      : sort === "closest" ? "Closest to licensed"
                      : sort === "stale" ? "Most stale"
                      : sort === "recent" ? "Least recently contacted"
                      : sort === "newest" ? "Newest"
                      : "Alphabetical"}
                  </span>
                </Button>
              </PopoverTrigger>
              {/* palette-allow:apex-panel-dark — matches AppShell popover surface tone */}
              <PopoverContent align="end" className="w-56 p-1 bg-[#0B1118] border-white/10">
                {([
                  ["priority", "Highest priority"],
                  ["closest", "Closest to licensed"],
                  ["stale", "Most stale"],
                  ["recent", "Least recently contacted"],
                  ["newest", "Newest"],
                  ["alpha", "Alphabetical"],
                ] as [SortKey, string][]).map(([k, label]) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setSort(k)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors",
                      sort === k ? "bg-teal-500/15 text-teal-200" : "text-slate-300 hover:bg-white/[0.06]"
                    )}
                  >
                    <div className={cn("h-1.5 w-1.5 rounded-full", sort === k ? "bg-teal-400" : "bg-slate-600")} />
                    {label}
                  </button>
                ))}
              </PopoverContent>
            </Popover>

            <FilterChip
              active={priorityChip === "today"}
              label="Due Today"
              onClick={() => setPriorityChip((p) => p === "today" ? null : "today")}
            />
            <FilterChip
              active={priorityChip === "critical"}
              label="Critical Only"
              onClick={() => setPriorityChip((p) => p === "critical" ? null : "critical")}
            />
            {activeFilterCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={resetFilters}
                className="h-8 gap-1 text-slate-400 hover:text-slate-100"
              >
                <X className="h-3.5 w-3.5" />
                Reset
              </Button>
            )}

            <div className="ml-auto text-xs text-slate-500">
              {filtered.length} of {rows.length}
              {powerHour && <span className="ml-2 rounded bg-teal-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-teal-300">POWER HOUR</span>}
            </div>
          </div>
        </div>

        {/* Content */}
        {isLoading && <SkeletonList />}
        {isError && !isLoading && (
          <EmptyState
            icon={<AlertTriangle className="h-6 w-6" />}
            title="Could not load the queue"
            description="Something went wrong pulling the licensing prospects view."
            actions={<Button onClick={() => refetch()} className="bg-teal-500 text-slate-950 hover:bg-teal-400">Retry</Button>}
            variant="warning"
          />
        )}
        {!isLoading && !isError && filtered.length === 0 && (
          <EmptyState
            icon={<CheckCircle2 className="h-6 w-6" />}
            title={rows.length === 0 ? "Queue is clear" : "No matches for these filters"}
            description={rows.length === 0
              ? "No applicants currently in the licensing recovery queue. Ship a win somewhere else."
              : "Adjust filters to see more applicants."}
            actions={rows.length > 0
              ? <Button onClick={resetFilters} variant="outline" className="border-white/10 bg-white/[0.04] hover:bg-white/[0.08]">Reset filters</Button>
              : undefined}
            variant="success"
          />
        )}

        {!isLoading && !isError && filtered.length > 0 && (
          <div className="space-y-2">
            {filtered.map((r) => {
              const cohort = r.cohort as CohortKey;
              const meta = COHORT_META[cohort];
              const priority = derivePriority(r);
              const pMeta = PRIORITY_META[priority];
              const stale = r.days_since_touch ?? 0;
              const untilExam = daysUntil(r.exam_scheduled);
              const manager = r.assigned_agent_id ? managerMap[r.assigned_agent_id] : undefined;
              const isPri = priority === "critical" || priority === "hot";
              return (
                <div
                  key={r.application_id}
                  role="button"
                  tabIndex={0}
                  aria-label={`Open details for ${r.name}`}
                  onClick={() => openRow(r)}
                  onKeyDown={(e) => onRowKey(e, r)}
                  className={cn(
                    "group relative cursor-pointer rounded-xl border border-white/10 bg-white/[0.03] p-3 backdrop-blur transition-colors hover:border-white/20 hover:bg-white/[0.05] focus:outline-none focus-visible:shadow-[var(--apex-focus-ring)] sm:p-4",
                    isPri && cn(
                      "before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:rounded-full",
                      pMeta.ring
                    ),
                  )}
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
                    {/* Left */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <div className="truncate text-sm font-semibold text-slate-100">{r.name}</div>
                        {r.state && (
                          <span className="inline-flex items-center gap-0.5 text-[11px] text-slate-400">
                            <MapPin className="h-3 w-3" />
                            {r.state}
                          </span>
                        )}
                        {manager && <ManagerAvatar profile={manager} />}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <CohortBadge cohort={cohort} />
                        <PriorityBadge p={priority} />
                        <span className={cn(
                          "inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px]",
                          stale >= 30 ? "border-rose-500/40 bg-rose-500/10 text-rose-300"
                            : stale >= 7 ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
                            : "border-white/10 bg-white/[0.04] text-slate-400"
                        )}>
                          Stale {stale}d
                        </span>
                        {untilExam !== null && cohort === "C_TEST_SCHEDULED" && (
                          <span className="inline-flex items-center gap-1 rounded-md border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-200">
                            <Calendar className="h-2.5 w-2.5" />
                            Exam {untilExam >= 0 ? `in ${untilExam}d` : `${Math.abs(untilExam)}d ago`}
                          </span>
                        )}
                        <MilestoneChip date={r.course_purchased} label="Course" done={!!r.course_purchased} />
                        <MilestoneChip date={r.exam_scheduled} label="Exam" done={!!r.exam_scheduled} />
                        <MilestoneChip date={r.exam_passed} label="Passed" done={!!r.exam_passed} />
                        <MilestoneChip date={r.licensed_date} label="Licensed" done={!!r.licensed_date} />
                      </div>
                      <div className="mt-2 flex items-center gap-1.5 text-xs text-slate-300">
                        <ArrowRight className={cn("h-3 w-3", meta.accent)} />
                        <span>{meta.action}</span>
                        {r.phone && (
                          <span className="ml-2 text-slate-500">·</span>
                        )}
                        {r.phone && (
                          <span className="text-slate-400">{formatPhone(r.phone)}</span>
                        )}
                      </div>
                    </div>

                    {/* Right actions */}
                    <RowActions
                      row={r}
                      onOpen={() => openRow(r)}
                      onMarkContacted={() => markContacted.mutate(r)}
                      onMarkPhoneBad={() => markPhoneBad.mutate(r)}
                      onSetStage={(stage) => setStage.mutate({ row: r, stage })}
                      onLogTel={() => logAttempt(r.application_id, "call")}
                      onLogSms={() => logAttempt(r.application_id, "sms")}
                      onLogEmail={() => logAttempt(r.application_id, "email")}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Detail drawer + Power Hour Next button injected via CRM footer via Link */}
        <ApplicationDetailSheet
          open={!!openId}
          onOpenChange={(v) => {
            if (!v) {
              setOpenId(null);
              setOpenAgentId(null);
              if (powerHour) setPowerHour(false);
            }
          }}
          applicationId={openId ?? undefined}
          agentId={openAgentId ?? undefined}
          onRefresh={invalidate}
        />

        {/* Floating Power Hour next-applicant control */}
        {openId && powerHour && (
          // palette-allow:apex-panel-dark — floating power-hour dock matches popover surface
          <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-full border border-teal-500/40 bg-[#0B1118]/95 px-3 py-2 shadow-lg backdrop-blur">
            <span className="text-[11px] uppercase tracking-wide text-teal-300">Power Hour</span>
            <Button
              size="sm"
              onClick={nextInQueue}
              className="h-8 gap-1 bg-teal-500 text-slate-950 hover:bg-teal-400"
            >
              Next applicant
              <ArrowRight className="h-3.5 w-3.5" />
            </Button>
            {openId && (
              <Button
                asChild
                size="sm"
                variant="outline"
                className="h-8 gap-1 border-white/10 bg-white/[0.04] hover:bg-white/[0.08]"
              >
                <Link to={`/dashboard/applicants?id=${openId}`} onClick={(e) => e.stopPropagation()}>
                  <ExternalLink className="h-3.5 w-3.5" />
                  CRM
                </Link>
              </Button>
            )}
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}

// ---------- Small components ----------
function InsightChip({ icon, label, value, tone, onClick, active }: {
  icon: React.ReactNode;
  label: string;
  value: number;
  tone: "teal" | "rose" | "amber" | "sky";
  onClick?: () => void;
  active?: boolean;
}) {
  const toneMap = {
    teal: "text-teal-300 border-teal-500/40 bg-teal-500/10",
    rose: "text-rose-300 border-rose-500/40 bg-rose-500/10",
    amber: "text-amber-300 border-amber-500/40 bg-amber-500/10",
    sky: "text-sky-300 border-sky-500/40 bg-sky-500/10",
  }[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
        toneMap,
        // palette-allow:apex-canvas-dark — matches AppShell body canvas beneath toolbar
        active ? "ring-2 ring-offset-1 ring-offset-[#05070A] ring-white/20" : "hover:brightness-110"
      )}
    >
      {icon}
      <span className="opacity-90">{label}</span>
      <span className="font-semibold">{value}</span>
    </button>
  );
}

function FilterChip({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
        active
          ? "border-teal-500/50 bg-teal-500/15 text-teal-200"
          : "border-white/10 bg-white/[0.04] text-slate-300 hover:bg-white/[0.08]"
      )}
    >
      {label}
    </button>
  );
}

function SkeletonList() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-4 w-40 bg-white/10" />
              <Skeleton className="h-3 w-64 bg-white/10" />
              <Skeleton className="h-3 w-52 bg-white/10" />
            </div>
            <div className="flex gap-1">
              <Skeleton className="h-9 w-9 rounded-lg bg-white/10" />
              <Skeleton className="h-9 w-9 rounded-lg bg-white/10" />
              <Skeleton className="h-9 w-9 rounded-lg bg-white/10" />
              <Skeleton className="h-9 w-9 rounded-lg bg-white/10" />
              <Skeleton className="h-9 w-9 rounded-lg bg-white/10" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
