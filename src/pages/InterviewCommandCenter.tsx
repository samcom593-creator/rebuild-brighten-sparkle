import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  FileText,
  Filter,
  Instagram,
  Loader2,
  Mail,
  Phone,
  PhoneCall,
  RefreshCw,
  Search,
  StickyNote,
  Trophy,
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
type DispositionField = "called" | "hired" | "passed" | "notes";

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
  const [dateFilter, setDateFilter] = useState<DateFilter>("month");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [search, setSearch] = useState("");
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});

  const interviews = useQuery({
    queryKey: ["interviews-unified", JUNE_START],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("v_interviews_unified")
        .select(
          "id, source, candidate_name, phone, email, instagram_handle, scheduled_at, interview_type, status, called_at, hired_at, passed_at, contracted_at, outcome_notes, agent_id_if_known, created_at",
        )
        .gte("scheduled_at", JUNE_START)
        .order("scheduled_at", { ascending: false })
        .limit(1500);
      if (error) throw error;
      return (data ?? []) as UnifiedInterview[];
    },
    staleTime: 30_000,
  });

  const scopedRows = useMemo(() => {
    const rows = interviews.data ?? [];
    return rows.filter((row) => {
      if (sourceFilter !== "all" && row.source !== sourceFilter) return false;
      return isInDateFilter(row.scheduled_at, dateFilter);
    });
  }, [dateFilter, interviews.data, sourceFilter]);

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
    const weekStart = startOfWeek(todayStart);
    return {
      total: scopedRows.length,
      calledToday: scopedRows.filter((row) => row.called_at && new Date(row.called_at) >= todayStart).length,
      hiredThisWeek: scopedRows.filter((row) => row.hired_at && new Date(row.hired_at) >= weekStart).length,
      pendingCall: scopedRows.filter((row) => !row.called_at && !row.hired_at && !row.passed_at).length,
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
      const { error } = await (supabase as any).rpc("disposition_interview", {
        p_source: row.source,
        p_id: row.id,
        p_field: field,
        p_value: field === "notes" ? value ?? "" : timestamp,
      });
      if (error) throw error;

      if (field === "called") patchCachedRow(row, { called_at: timestamp, status: "called" });
      if (field === "hired") patchCachedRow(row, { hired_at: timestamp, passed_at: null, status: "hired" });
      if (field === "passed") patchCachedRow(row, { passed_at: timestamp, hired_at: null, status: "passed" });
      if (field === "notes") patchCachedRow(row, { outcome_notes: value?.trim() || null });

      toast.success(successLabel(field));
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
          </div>
        }
      />

      <section className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
        <StatTile icon={CalendarDays} label="Total" value={stats.total} />
        <StatTile icon={PhoneCall} label="Called Today" value={stats.calledToday} tone="emerald" />
        <StatTile icon={Trophy} label="Hired this Week" value={stats.hiredThisWeek} tone="amber" />
        <StatTile icon={CheckCircle2} label="Pending Call" value={stats.pendingCall} tone="sky" />
      </section>

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
          {visibleRows.map((row) => (
            <InterviewCard
              key={`${row.source}:${row.id}`}
              row={row}
              savingKey={savingKey}
              noteDraft={noteDrafts[rowKey(row)]}
              onDisposition={saveDisposition}
              onOpenNotes={openNotes}
              onNoteChange={(value) =>
                setNoteDrafts((prev) => ({ ...prev, [rowKey(row)]: value }))
              }
              onNoteBlur={() => saveNotes(row)}
            />
          ))}
          {!visibleRows.length && (
            <div className="rounded-md border bg-card p-6 text-sm text-muted-foreground">
              No interviews match this view.
            </div>
          )}
        </section>
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
}: {
  row: UnifiedInterview;
  savingKey: string | null;
  noteDraft: string | undefined;
  onDisposition: (row: UnifiedInterview, field: DispositionField, value?: string) => Promise<void>;
  onOpenNotes: (row: UnifiedInterview) => void;
  onNoteChange: (value: string) => void;
  onNoteBlur: () => void;
}) {
  const busy = savingKey?.startsWith(`${row.source}:${row.id}:`) ?? false;
  const handle = normalizeHandle(row.instagram_handle);
  const tone = rowTone(row);

  return (
    <article className={cn("overflow-hidden rounded-md border bg-card p-3 transition-colors sm:p-4", tone.card)}>
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h2 className={cn("min-w-0 truncate text-xl font-black leading-tight", tone.title)}>
              {row.candidate_name}
            </h2>
            <Badge variant="outline" className="shrink-0 text-[11px]">
              {typeLabel(row.interview_type)}
            </Badge>
            <Badge variant="outline" className={cn("shrink-0 text-[11px]", sourceTone(row.source))}>
              {SOURCE_LABEL[row.source]}
            </Badge>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Badge variant="secondary" className="text-[11px]">
              {formatBusinessTimeWithDay(row.scheduled_at)}
            </Badge>
            <Badge variant="outline" className="text-[11px]">
              {formatRelativeFromNow(row.scheduled_at)}
            </Badge>
            {row.contracted_at && (
              <Badge variant="outline" className="border-violet-500/30 bg-violet-500/10 text-[11px] text-violet-300">
                Contracted
              </Badge>
            )}
          </div>
        </div>
        {busy && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />}
      </div>

      <div className="mt-3 grid grid-cols-4 gap-1.5">
        <DispositionButton
          active={!!row.called_at}
          disabled={busy}
          icon={PhoneCall}
          label="Called"
          tone="emerald"
          onClick={() => onDisposition(row, "called")}
        />
        <DispositionButton
          active={!!row.hired_at}
          disabled={busy}
          icon={Trophy}
          label="Hired"
          tone="amber"
          onClick={() => onDisposition(row, "hired")}
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
  tone: "emerald" | "amber" | "slate" | "sky";
  onClick: () => void;
}) {
  const activeTone = {
    emerald: "border-emerald-500/50 bg-emerald-500/15 text-emerald-200",
    amber: "border-amber-500/50 bg-amber-500/15 text-amber-200",
    slate: "border-slate-400/40 bg-slate-500/15 text-slate-200",
    sky: "border-sky-500/50 bg-sky-500/15 text-sky-200",
  }[tone];

  return (
    <Button
      type="button"
      variant="outline"
      disabled={disabled}
      className={cn("h-10 gap-1 px-1 text-[11px] sm:text-xs", active && activeTone)}
      onClick={onClick}
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
  if (row.passed_at) {
    return {
      card: "border-slate-500/25 bg-slate-500/5 opacity-75",
      title: "text-slate-200",
    };
  }
  if (row.hired_at) {
    return {
      card: "border-amber-500/45 bg-amber-500/10",
      title: "text-amber-100",
    };
  }
  if (row.called_at) {
    return {
      card: "border-emerald-500/40 bg-emerald-500/10",
      title: "text-emerald-100",
    };
  }
  return {
    card: "border-border",
    title: "text-foreground",
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

function startOfToday() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}

function startOfWeek(todayStart = startOfToday()) {
  const date = new Date(todayStart);
  const day = date.getDay();
  const diff = day === 0 ? 6 : day - 1;
  date.setDate(date.getDate() - diff);
  return date;
}

function isInDateFilter(value: string, filter: DateFilter) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;

  const todayStart = startOfToday();
  if (filter === "today") {
    const tomorrow = new Date(todayStart);
    tomorrow.setDate(tomorrow.getDate() + 1);
    return date >= todayStart && date < tomorrow;
  }

  if (filter === "week") return date >= startOfWeek(todayStart);

  const monthStart = new Date(todayStart.getFullYear(), todayStart.getMonth(), 1);
  return date >= monthStart;
}
