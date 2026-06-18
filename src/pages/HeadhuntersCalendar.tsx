// Headhunters · Calendar
//
// Live view of Calendly bookings synced into apex_scheduled_calls.
// Shows applicant name, interview window, host (parsed from summary),
// call_type, and current status. Allow inline status update + outcome note
// via supabase update on apex_scheduled_calls.
//
// Schema verified via bot-sql 2026-06-14:
//   apex_scheduled_calls columns used:
//     id (bigint), prospect_name, prospect_email, prospect_phone,
//     summary, start_at, end_at, call_type, status, outcome,
//     outcome_notes, location, gcal_event_id.
//
// Phoenix tz for today / week windows. No "Unknown" fallback — use "—".

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { formatInTimeZone } from "date-fns-tz";
import { isToday, isThisWeek, isPast } from "date-fns";
import { formatRelativeFromNow } from "@/lib/dateUtils";
import {
  CalendarDays, RefreshCw, Filter, Save, Clock, Phone, Mail, User,
  CheckCircle2, XCircle, AlertCircle, Loader2, Search,
} from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { usePageTitle } from "@/hooks/usePageTitle";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

// 2026-06-17 Sam directive: "with the Calendly link, the CDT time is just
// fucking up my head completely." Calendly is set to America/Chicago; the
// page was hardcoded to America/Phoenix + "MST" label. Switched to Chicago
// + dynamic tz abbr (CDT/CST) + added a "starting in 2h 15m" chip below.
const CAL_TZ = "America/Chicago";

interface ScheduledCallRow {
  id: number;
  gcal_event_id: string | null;
  prospect_name: string | null;
  prospect_phone: string | null;
  prospect_email: string | null;
  summary: string | null;
  location: string | null;
  start_at: string;
  end_at: string | null;
  duration_minutes: number | null;
  call_type: string | null;
  status: string | null;
  outcome: string | null;
  outcome_notes: string | null;
}

const STATUS_OPTIONS = [
  { key: "scheduled",   label: "Scheduled",   color: "bg-sky-500/15 text-sky-300 border-sky-500/30" },
  { key: "completed",   label: "Completed",   color: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" },
  { key: "missed",      label: "Missed",      color: "bg-amber-500/15 text-amber-300 border-amber-500/30" },
  { key: "rescheduled", label: "Rescheduled", color: "bg-indigo-500/15 text-indigo-300 border-indigo-500/30" },
  { key: "no_show",     label: "No-Show",     color: "bg-rose-500/15 text-rose-300 border-rose-500/30" },
  { key: "cancelled",   label: "Cancelled",   color: "bg-slate-500/15 text-slate-300 border-slate-500/30" },
] as const;

const FILTERS = [
  { key: "all",      label: "All" },
  { key: "today",    label: "Today" },
  { key: "upcoming", label: "Upcoming" },
  { key: "week",     label: "This Week" },
  { key: "past",     label: "Past" },
] as const;

type FilterKey = (typeof FILTERS)[number]["key"];

const statusMeta = (s: string | null) =>
  STATUS_OPTIONS.find((o) => o.key === (s ?? "")) ?? STATUS_OPTIONS[0];

// Parse host name from Calendly summary: "Prospect Name and Host Name"
function parseHost(summary: string | null, prospect: string | null): string {
  if (!summary) return "—";
  const lower = summary.toLowerCase();
  const idx = lower.lastIndexOf(" and ");
  if (idx === -1) return "—";
  const host = summary.slice(idx + 5).trim();
  if (!host) return "—";
  if (prospect && host.toLowerCase() === prospect.toLowerCase()) return "—";
  return host;
}

export default function HeadhuntersCalendar() {
  usePageTitle("Headhunters · Calendar · APEX");
  const qc = useQueryClient();
  const [filter, setFilter] = useState<FilterKey>("upcoming");
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draftStatus, setDraftStatus] = useState<string>("scheduled");
  const [draftNote, setDraftNote] = useState<string>("");
  const [savingId, setSavingId] = useState<number | null>(null);

  const calls = useQuery({
    queryKey: ["headhunters-calendar"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("apex_scheduled_calls" as any)
        .select(
          "id, gcal_event_id, prospect_name, prospect_phone, prospect_email, summary, location, start_at, end_at, duration_minutes, call_type, status, outcome, outcome_notes",
        )
        .order("start_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as unknown as ScheduledCallRow[];
    },
    staleTime: 60_000,
  });

  const rows = calls.data ?? [];

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rows.filter((r) => {
      const start = r.start_at ? new Date(r.start_at) : null;
      if (filter !== "all" && start) {
        if (filter === "today" && !isToday(start)) return false;
        if (filter === "upcoming" && !(start.getTime() >= Date.now())) return false;
        if (filter === "week" && !isThisWeek(start, { weekStartsOn: 1 })) return false;
        if (filter === "past" && !isPast(start)) return false;
      }
      if (!term) return true;
      const hay = [
        r.prospect_name,
        r.prospect_email,
        r.prospect_phone,
        r.summary,
        r.call_type,
        r.status,
        r.outcome,
        r.outcome_notes,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(term);
    });
  }, [rows, filter, search]);

  const todayCount = useMemo(
    () => rows.filter((r) => r.start_at && isToday(new Date(r.start_at))).length,
    [rows],
  );
  const upcomingCount = useMemo(
    () => rows.filter((r) => r.start_at && new Date(r.start_at).getTime() >= Date.now()).length,
    [rows],
  );
  const completedCount = useMemo(
    () => rows.filter((r) => r.status === "completed").length,
    [rows],
  );

  const startEdit = (r: ScheduledCallRow) => {
    setEditingId(r.id);
    setDraftStatus(r.status ?? "scheduled");
    setDraftNote(r.outcome_notes ?? "");
  };

  const cancelEdit = () => {
    setEditingId(null);
    setDraftNote("");
  };

  const saveEdit = async (id: number) => {
    setSavingId(id);
    try {
      const { error } = await supabase
        .from("apex_scheduled_calls" as any)
        .update({
          status: draftStatus,
          outcome_notes: draftNote.trim() ? draftNote.trim() : null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", id);
      if (error) throw error;
      toast.success("Interview updated");
      cancelEdit();
      await qc.invalidateQueries({ queryKey: ["headhunters-calendar"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Could not update interview");
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div className="page-enter px-4 sm:px-6 pb-24 space-y-5">
      <PageHeader
        eyebrow="Calendar"
        eyebrowIcon={<CalendarDays className="h-3 w-3" />}
        title="Headhunters · Calendar"
        subtitle="Every Calendly booking from your headhunters funnel. Update status + drop a note inline."
        actions={
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-11">{rows.length} interviews</Badge>
            <Button variant="outline" size="sm" onClick={() => calls.refetch()}>
              <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${calls.isFetching ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        }
      />

      {/* Premium gradient hero (v6 §31 — amber) bg-gradient-card-allow:hero-canonical shadow-glow-allow:hero-canonical */}
      <div className="relative overflow-hidden rounded-3xl border border-amber-500/25 bg-gradient-to-br from-slate-950 via-slate-900 to-amber-950 text-white shadow-[0_0_48px_-12px_hsl(168_70%_45%/0.25)]">
        <div className="absolute -top-24 -right-24 h-72 w-72 rounded-full bg-amber-500/15 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-32 -left-24 h-80 w-80 rounded-full bg-emerald-500/10 blur-3xl pointer-events-none" />
        <div className="relative p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2.5">
              <span className="relative flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75 animate-ping" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-amber-500" />
              </span>
              <p className="text-[11px] uppercase tracking-[0.32em] font-bold text-amber-300">HEADHUNTERS CALENDAR · LIVE</p>
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div>
              <p className="text-[10px] uppercase tracking-widest text-white/40 mb-1">TOTAL INTERVIEWS</p>
              <p className="text-[28px] leading-none font-black tabular-nums text-white">{rows.length}</p>
              <p className="text-[10px] text-white/40 tabular-nums">synced from Calendly</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-widest text-white/40 mb-1">TODAY</p>
              <p className="text-[28px] leading-none font-black tabular-nums text-white">{todayCount}</p>
              <p className="text-[10px] text-white/40 tabular-nums">Phoenix tz</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-widest text-white/40 mb-1">UPCOMING</p>
              <p className="text-[28px] leading-none font-black tabular-nums text-white">{upcomingCount}</p>
              <p className="text-[10px] text-white/40 tabular-nums">future bookings</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-widest text-white/40 mb-1">COMPLETED</p>
              <p className="text-[28px] leading-none font-black tabular-nums text-white">{completedCount}</p>
              <p className="text-[10px] text-white/40 tabular-nums">interviewed</p>
            </div>
          </div>
        </div>
      </div>

      {/* Search + filter bar */}
      <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search name, email, phone, summary…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex gap-1 overflow-x-auto">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-12 font-medium whitespace-nowrap transition-base ${
                filter === f.key
                  ? "bg-amber-500 text-white"
                  : "bg-muted text-foreground hover:bg-muted/80"
              }`}
            >
              <Filter className="h-3 w-3" />
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      {calls.isLoading ? (
        <div className="grid gap-3 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-44" />)}
        </div>
      ) : calls.isError ? (
        <Card>
          <CardContent className="p-6 text-13 text-rose-400 flex items-start gap-3">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <div>
              <p className="font-bold mb-1">Could not load interviews</p>
              <p className="text-12 text-muted-foreground">{(calls.error as any)?.message ?? "Something went wrong with Supabase — refresh to try again."}</p>
            </div>
          </CardContent>
        </Card>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-13 text-muted-foreground">
            <CalendarDays className="h-6 w-6 mx-auto mb-2 opacity-50" />
            Nothing on the board with that filter. New Calendly bookings sync automatically.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {filtered.map((r) => {
            const start = r.start_at ? new Date(r.start_at) : null;
            const end = r.end_at ? new Date(r.end_at) : null;
            const isEditing = editingId === r.id;
            const isSaving = savingId === r.id;
            const meta = statusMeta(r.status);
            const host = parseHost(r.summary, r.prospect_name);
            const dateLabel = start ? formatInTimeZone(start, CAL_TZ, "EEE MMM d") : "—";
            const tzAbbr = start ? formatInTimeZone(start, CAL_TZ, "zzz") : "CT";
            const timeLabel = start
              ? `${formatInTimeZone(start, CAL_TZ, "h:mm a")}${end ? ` – ${formatInTimeZone(end, CAL_TZ, "h:mm a")}` : ""} ${tzAbbr}`
              : "—";
            const relativeLabel = start ? formatRelativeFromNow(start) : "";

            return (
              <Card key={r.id} className="hover:bg-muted/20 transition-base">
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-14 font-bold leading-tight truncate">
                        {r.prospect_name?.trim() || "—"}
                      </p>
                      <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                        <Badge variant="outline" className="text-11 capitalize">
                          {r.call_type ? r.call_type.replace(/_/g, " ") : "—"}
                        </Badge>
                        <Badge variant="outline" className={`text-11 ${meta.color}`}>
                          {meta.label}
                        </Badge>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-12 font-semibold tabular-nums">{dateLabel}</p>
                      <p className="text-11 text-muted-foreground tabular-nums flex items-center gap-1 justify-end">
                        <Clock className="h-3 w-3" /> {timeLabel}
                      </p>
                      {/* 2026-06-17 Sam: kill CDT confusion with explicit "in 2h 15m" chip */}
                      {relativeLabel && relativeLabel !== "—" && (
                        <p className="text-10 mt-0.5 tabular-nums font-semibold text-amber-500 dark:text-amber-400 text-right">
                          {relativeLabel}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-12">
                    <div className="flex items-start gap-1.5 text-muted-foreground">
                      <User className="h-3 w-3 mt-0.5 shrink-0" />
                      <span><span className="text-foreground/70">Host:</span> {host}</span>
                    </div>
                    <div className="flex items-start gap-1.5 text-muted-foreground">
                      <Mail className="h-3 w-3 mt-0.5 shrink-0" />
                      <span className="truncate">{r.prospect_email?.trim() || "—"}</span>
                    </div>
                    <div className="flex items-start gap-1.5 text-muted-foreground">
                      <Phone className="h-3 w-3 mt-0.5 shrink-0" />
                      <span>{r.prospect_phone?.trim() || "—"}</span>
                    </div>
                    <div className="flex items-start gap-1.5 text-muted-foreground">
                      <CalendarDays className="h-3 w-3 mt-0.5 shrink-0" />
                      <span className="truncate">{r.location?.trim() || r.summary?.trim() || "—"}</span>
                    </div>
                  </div>

                  {isEditing ? (
                    <div className="space-y-2 rounded-md border border-amber-500/20 bg-amber-500/5 p-3">
                      <div className="flex items-center gap-2">
                        <Select value={draftStatus} onValueChange={setDraftStatus}>
                          <SelectTrigger className="h-8 text-12 w-full sm:w-44">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {STATUS_OPTIONS.map((o) => (
                              <SelectItem key={o.key} value={o.key} className="text-12">{o.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <Textarea
                        placeholder="Drop a note — what happened on the call?"
                        value={draftNote}
                        onChange={(e) => setDraftNote(e.target.value)}
                        className="min-h-[72px] text-12"
                      />
                      <div className="flex items-center gap-2 justify-end">
                        <Button variant="ghost" size="sm" onClick={cancelEdit} disabled={isSaving}>
                          <XCircle className="h-3.5 w-3.5 mr-1.5" /> Cancel
                        </Button>
                        <Button
                          size="sm"
                          className="bg-emerald-600 hover:bg-emerald-700"
                          onClick={() => saveEdit(r.id)}
                          disabled={isSaving}
                        >
                          {isSaving ? (
                            <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                          ) : (
                            <Save className="h-3.5 w-3.5 mr-1.5" />
                          )}
                          Save
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-12 text-muted-foreground line-clamp-2">
                        {r.outcome_notes?.trim() || "No notes yet."}
                      </p>
                      <Button variant="outline" size="sm" onClick={() => startEdit(r)}>
                        <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" /> Update
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
