import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  format, parseISO, startOfMonth, endOfMonth, startOfWeek, endOfWeek,
  addMonths, addWeeks, addDays, eachDayOfInterval, isSameMonth,
} from "date-fns";
import {
  Calendar as CalendarIcon, Plus, ChevronLeft, ChevronRight,
  AlertTriangle, Search, User, RefreshCw, CalendarDays,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { InterviewScheduler } from "@/components/dashboard/InterviewScheduler";
import { Skeleton } from "@/components/ui/skeleton";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { PageHeader } from "@/components/ui/page-header";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as DayCalendar } from "@/components/ui/calendar";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useSoundEffects } from "@/hooks/useSoundEffects";
import { AgendaList } from "@/components/calendar/AgendaList";
import { ProviderHealthPanel } from "@/components/calendar/ProviderHealthPanel";
import { TimeZoneSelect } from "@/components/calendar/TimeZoneSelect";
import { ConflictNotice, useOwnerConflicts } from "@/components/calendar/ConflictNotice";
import { CancelInterviewDialog, RescheduleInterviewDialog } from "@/components/calendar/InterviewEventDialogs";
import {
  type CalendarView, DEFAULT_CALENDAR_PREFS, loadCalendarPrefs, saveCalendarPrefs,
} from "@/components/calendar/calendarPrefs";
import { disposeInterview, fetchAgendaRows, fetchWindowRows } from "@/components/calendar/calendarApi";
import { type CalendarItem, groupByDay, mergeAgenda } from "@/lib/calendarAgenda";
import {
  BUSINESS_TZ, dateKeyInZone, isValidTimeZone, timeValueInZone, formatClock, zonedWallTimeToUtc,
} from "@/lib/calendarTime";

/* ─────────────────────────────────────────────────────────────────────────────
 * Calendar — one event model (redesign section 7).
 *
 * Two server feeds, merged without duplicates by src/lib/calendarAgenda.ts:
 *   v_calendar_agenda (security_invoker view) — every EDITABLE appointment:
 *     interview_events (Calendly + staff-booked interviews, onboarding calls)
 *     and calendar_events (appointments, draft dates, post-test follow-ups),
 *     with time zone, owner, meeting link, status and reminder state.
 *   calendar_window(p_from, p_to) — the read-only date markers (milestones,
 *     policy effective dates, callbacks, birthdays, applicant next actions).
 * Both are read page by page past PostgREST's 1000-row cap; headline numbers
 * still come from calendar_window_counts, never from an array length.
 *
 * Writes go to the SAME records Pipeline uses:
 *   book / reschedule / cancel an interview → book_interview_event /
 *     reschedule_interview_event / cancel_interview_event (RPCs; reminders for
 *     the old time are superseded server-side; history rows written)
 *   no-show → cc_dispose_interview (the Follow-Ups disposition writer)
 *   appointment → calendar_events (own rows), cancel = status 'cancelled'
 *     with a reason, never a DELETE.
 *
 * Time: day buckets are business days in America/Phoenix; every timed row
 * prints its OWN zone (event_tz) plus the viewer's local time when different.
 * Calendly-owned bookings are moved/canceled with Calendly's own links, because
 * the 15-minute Calendly reconcile overwrites in-app edits to them.
 * ────────────────────────────────────────────────────────────────────────── */

type KindMeta = {
  key: string;
  label: string;
  dot: string;
  source: string;
};

/** The kinds the calendar shows, in the vocabulary an operator uses. */
const KINDS: KindMeta[] = [
  { key: "appointment", label: "Appointment", dot: "bg-primary", source: "calendar_events" },
  { key: "interview", label: "Interview", dot: "bg-sky-500", source: "interview_events" },
  { key: "onboarding_call", label: "Onboarding call", dot: "bg-primary", source: "interview_events" },
  { key: "birthday", label: "Birthday", dot: "bg-pink-500", source: "agentlink_clients.date_of_birth" },
  // `emerald`/`teal` are remapped onto the brand gold ramp in tailwind.config.ts;
  // `green-*` is left alone, which is why it is used here.
  { key: "policy_effective", label: "Policy Starting Soon", dot: "bg-green-500", source: "agentlink_book.effective_date" },
  { key: "draft_date", label: "Draft Date", dot: "bg-orange-500", source: "calendar_events (auto-fill)" },
  { key: "follow_up", label: "Follow-Up", dot: "bg-violet-500", source: "applications.next_action_at" },
  { key: "callback", label: "Callback", dot: "bg-cyan-500", source: "agentlink_clients.callback_date" },
  { key: "milestone", label: "Milestone", dot: "bg-red-500", source: "applications milestones" },
];
const KIND_KEYS = KINDS.map((k) => k.key);
const KIND_BY_KEY: Record<string, KindMeta> = Object.fromEntries(KINDS.map((k) => [k.key, k]));

/**
 * Event names carried over from the reference calendar that NO table on this
 * database publishes a date for. Named so an operator is told they have no
 * feed rather than assuming the calendar is complete. Nothing is invented.
 */
const UNFED_KINDS = ["Beneficiary Check-In", "Lapse Follow-Up", "Policy Anniversary"];

const fmtKey = (d: Date) => format(d, "yyyy-MM-dd");
const AGENDA_DAYS = 14;

/** The days a view paints. Month view draws a 6-week grid. */
function rangeFor(date: Date, view: CalendarView): { from: Date; to: Date } {
  if (view === "month") {
    return {
      from: startOfWeek(startOfMonth(date), { weekStartsOn: 0 }),
      to: endOfWeek(endOfMonth(date), { weekStartsOn: 0 }),
    };
  }
  if (view === "week") {
    return { from: startOfWeek(date, { weekStartsOn: 0 }), to: endOfWeek(date, { weekStartsOn: 0 }) };
  }
  if (view === "agenda") return { from: date, to: addDays(date, AGENDA_DAYS - 1) };
  return { from: date, to: date };
}

function stepAnchor(anchor: Date, view: CalendarView, dir: 1 | -1): Date {
  if (view === "month") return addMonths(anchor, dir);
  if (view === "week") return addWeeks(anchor, dir);
  if (view === "agenda") return addDays(anchor, dir * AGENDA_DAYS);
  return addDays(anchor, dir);
}

/** Today's business-day key, regardless of where the browser is. */
function businessTodayKey(): string {
  return dateKeyInZone(new Date(), BUSINESS_TZ);
}

// ─── Add New Applicant (shown when the lead search finds nobody) ───
type LeadResult = { id: string; first_name: string; last_name: string; email: string; phone: string; status: string };

function AddNewApplicantForm({ onCreated }: { onCreated: (lead: LeadResult) => void }) {
  const [form, setForm] = useState({ first_name: "", last_name: "", email: "", phone: "", instagram_handle: "" });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.first_name || !form.last_name || !form.email) {
      toast.error("First name, last name, and email are required");
      return;
    }
    setSaving(true);
    try {
      const { data, error } = await supabase.from("applications").insert({
        first_name: form.first_name,
        last_name: form.last_name,
        email: form.email,
        phone: form.phone || null,
        instagram_handle: form.instagram_handle || null,
        status: "new" as never,
      }).select("id, first_name, last_name, email, phone, status").single();
      if (error) throw error;
      toast.success(`${form.first_name} ${form.last_name} added`);
      onCreated(data as LeadResult);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to add applicant");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <p className="py-2 text-center text-sm text-muted-foreground">No leads found</p>
      <form onSubmit={handleSubmit} className="space-y-2 rounded-lg border border-border p-3">
        <p className="flex items-center gap-1.5 text-xs font-medium text-foreground">
          <Plus className="h-3.5 w-3.5 text-primary" /> Add New Applicant
        </p>
        <div className="grid grid-cols-2 gap-2">
          <Input placeholder="First Name *" value={form.first_name} onChange={(e) => setForm((p) => ({ ...p, first_name: e.target.value }))} required />
          <Input placeholder="Last Name *" value={form.last_name} onChange={(e) => setForm((p) => ({ ...p, last_name: e.target.value }))} required />
        </div>
        <Input placeholder="Email *" type="email" value={form.email} onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))} required />
        <Input placeholder="Phone" value={form.phone} onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))} />
        <Input placeholder="Instagram Handle" value={form.instagram_handle} onChange={(e) => setForm((p) => ({ ...p, instagram_handle: e.target.value }))} />
        <Button type="submit" size="sm" className="w-full" disabled={saving}>
          {saving ? "Adding..." : "Add & Schedule"}
        </Button>
      </form>
    </div>
  );
}

// ─── Event chip inside a grid cell ───
function EventChip({ item, onClick }: { item: CalendarItem; onClick: () => void }) {
  const meta = KIND_BY_KEY[item.kind];
  return (
    <button
      type="button"
      onClick={onClick}
      title={item.title}
      className={cn(
        "flex w-full items-center gap-1 rounded px-1 py-[1px] text-left text-[10px] leading-tight transition-colors hover:bg-muted",
        item.status === "canceled" && "text-muted-foreground line-through",
      )}
    >
      <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", meta?.dot ?? "bg-muted-foreground")} />
      {!item.allDay && (
        <span className="shrink-0 tabular-nums text-muted-foreground">
          {formatClock(item.startsAt, BUSINESS_TZ).replace(":00", "")}
        </span>
      )}
      <span className="truncate">{item.title}</span>
    </button>
  );
}

type ApptForm = { title: string; person: string; date: string; time: string; duration: string; zone: string; link: string; notes: string };

export default function CalendarPage() {
  const { user, isAdmin, isManager, isVaManager, isVa } = useAuth();
  const isStaff = isAdmin || isManager || isVaManager || isVa;
  const queryClient = useQueryClient();
  const { playSound } = useSoundEffects();

  const todayKey = useMemo(() => businessTodayKey(), []);
  const [anchor, setAnchor] = useState<Date>(() => parseISO(businessTodayKey()));
  const [view, setView] = useState<CalendarView>(DEFAULT_CALENDAR_PREFS.view);
  const [activeKinds, setActiveKinds] = useState<string[]>([]); // [] = every kind
  const [showCanceled, setShowCanceled] = useState(false);
  const [selectedDay, setSelectedDay] = useState<string>(todayKey);
  const [jumpOpen, setJumpOpen] = useState(false);
  const [providersOpen, setProvidersOpen] = useState(false);

  // ── remembered view + filters, per user (localStorage, never required) ──
  const prefsLoadedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!user?.id || prefsLoadedFor.current === user.id) return;
    prefsLoadedFor.current = user.id;
    const prefs = loadCalendarPrefs(user.id, KIND_KEYS);
    setView(prefs.view);
    setActiveKinds(prefs.kinds);
    setShowCanceled(prefs.showCanceled);
  }, [user?.id]);
  useEffect(() => {
    if (!user?.id || prefsLoadedFor.current !== user.id) return;
    saveCalendarPrefs(user.id, { view, kinds: activeKinds, showCanceled });
  }, [user?.id, view, activeKinds, showCanceled]);

  // create / edit appointment (calendar_events)
  const [apptOpen, setApptOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [apptForm, setApptForm] = useState<ApptForm>({ title: "", person: "", date: todayKey, time: "09:00", duration: "30", zone: BUSINESS_TZ, link: "", notes: "" });
  const [savingAppt, setSavingAppt] = useState(false);
  const [apptCancel, setApptCancel] = useState<CalendarItem | null>(null);
  const [apptCancelReason, setApptCancelReason] = useState("");
  const [cancelingAppt, setCancelingAppt] = useState(false);

  // interview actions
  const [rescheduleItem, setRescheduleItem] = useState<CalendarItem | null>(null);
  const [cancelItem, setCancelItem] = useState<CalendarItem | null>(null);

  // interview scheduling (lead search → InterviewScheduler)
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<LeadResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedLead, setSelectedLead] = useState<LeadResult | null>(null);
  const [schedulerOpen, setSchedulerOpen] = useState(false);
  const [autoPopulating, setAutoPopulating] = useState(false);

  // ── visible range ───────────────────────────────────────────────────────
  const range = useMemo(() => rangeFor(anchor, view), [anchor, view]);
  const fromKey = fmtKey(range.from);
  const toKey = fmtKey(range.to);

  const periodLabel = view === "month"
    ? format(anchor, "MMMM yyyy")
    : view === "day"
      ? format(anchor, "EEEE, MMMM d, yyyy")
      : `${format(range.from, "MMM d")} – ${format(range.to, "MMM d, yyyy")}`;

  // ── counts: aggregated in Postgres, never an array length ───────────────
  const { data: counts } = useQuery({
    queryKey: ["calendar-window-counts", fromKey, toKey],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("calendar_window_counts" as never, { p_from: fromKey, p_to: toKey } as never);
      if (error) throw error;
      return (data ?? []) as { kind: string; n: number }[];
    },
    enabled: !!user,
    staleTime: 60_000,
  });

  const countByKind = useMemo(() => {
    const map: Record<string, number> = {};
    for (const row of counts ?? []) map[row.kind] = Number(row.n);
    return map;
  }, [counts]);

  const countedTotal = useMemo(() => {
    const keys = activeKinds.length ? activeKinds : KIND_KEYS;
    return keys.reduce((sum, k) => sum + (countByKind[k] ?? 0), 0);
  }, [countByKind, activeKinds]);

  // ── the events: window markers + the editable agenda ────────────────────
  const windowQuery = useQuery({
    queryKey: ["calendar-window", fromKey, toKey],
    queryFn: () => fetchWindowRows(fromKey, toKey, null),
    enabled: !!user,
    staleTime: 30_000,
  });
  const agendaQuery = useQuery({
    queryKey: ["calendar-agenda", fromKey, toKey],
    queryFn: () => fetchAgendaRows(fromKey, toKey),
    enabled: !!user,
    staleTime: 30_000,
  });

  const items = useMemo(() => mergeAgenda(
    windowQuery.data?.rows,
    agendaQuery.isError ? null : agendaQuery.data?.rows,
    { kinds: activeKinds, showCanceled, viewerUserId: user?.id ?? null },
  ), [windowQuery.data, agendaQuery.data, agendaQuery.isError, activeKinds, showCanceled, user?.id]);
  const byDay = useMemo(() => groupByDay(items), [items]);
  const isLoading = windowQuery.isLoading || agendaQuery.isLoading;
  const truncated = !!windowQuery.data?.truncated || !!agendaQuery.data?.truncated;

  const gridDays = useMemo(
    () => eachDayOfInterval({ start: range.from, end: range.to }),
    [range.from, range.to],
  );
  const dayKeys = useMemo(() => gridDays.map(fmtKey), [gridDays]);

  // Owner names for the agenda (profiles RLS decides what resolves).
  const ownerIds = useMemo(() => {
    const ids = new Set<string>();
    for (const item of items) {
      const id = item.agenda?.owner_user_id;
      if (id && id !== user?.id) ids.add(id);
    }
    return Array.from(ids).sort();
  }, [items, user?.id]);
  const { data: ownerNames } = useQuery({
    queryKey: ["calendar-owner-names", ownerIds.join(",")],
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("user_id, full_name").in("user_id", ownerIds);
      if (error) return {} as Record<string, string>;
      const map: Record<string, string> = {};
      for (const row of (data ?? []) as { user_id: string; full_name: string | null }[]) {
        if (row.full_name && !map[row.user_id]) map[row.user_id] = row.full_name;
      }
      return map;
    },
    enabled: ownerIds.length > 0,
    staleTime: 5 * 60_000,
  });

  // ── today / next-30 KPIs, both server-counted ───────────────────────────
  const { data: todayCounts } = useQuery({
    queryKey: ["calendar-window-counts-today", todayKey],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("calendar_window_counts" as never, { p_from: todayKey, p_to: todayKey } as never);
      if (error) throw error;
      return (data ?? []) as { kind: string; n: number }[];
    },
    enabled: !!user,
    staleTime: 60_000,
  });
  const { data: next30Counts } = useQuery({
    queryKey: ["calendar-window-counts-next30", todayKey],
    queryFn: async () => {
      const to = fmtKey(addDays(parseISO(todayKey), 30));
      const { data, error } = await supabase.rpc("calendar_window_counts" as never, { p_from: todayKey, p_to: to } as never);
      if (error) throw error;
      return (data ?? []) as { kind: string; n: number }[];
    },
    enabled: !!user,
    staleTime: 60_000,
  });
  const sumCounts = (rows?: { kind: string; n: number }[]) => (rows ?? []).reduce((s, r) => s + Number(r.n), 0);

  // ── navigation ──────────────────────────────────────────────────────────
  /** Move the anchor and keep the selected day on screen with it. */
  const stepTo = useCallback((next: Date, nextView: CalendarView) => {
    const r = rangeFor(next, nextView);
    const from = fmtKey(r.from);
    const to = fmtKey(r.to);
    setAnchor(next);
    setSelectedDay((cur) => {
      if (cur >= from && cur <= to) return cur;
      const today = businessTodayKey();
      if (today >= from && today <= to) return today;
      return nextView === "month" ? fmtKey(startOfMonth(next)) : from;
    });
  }, []);

  const step = useCallback((dir: 1 | -1) => stepTo(stepAnchor(anchor, view, dir), view), [anchor, view, stepTo]);

  const changeView = useCallback((mode: CalendarView) => {
    setView(mode);
    stepTo(mode === "day" || mode === "agenda" ? parseISO(selectedDay) : anchor, mode);
  }, [anchor, selectedDay, stepTo]);

  const goToday = useCallback(() => {
    const key = businessTodayKey();
    setAnchor(parseISO(key));
    setSelectedDay(key);
  }, []);

  const pickDay = useCallback((key: string) => {
    setSelectedDay(key);
    if (view === "day") setAnchor(parseISO(key));
  }, [view]);

  const toggleKind = useCallback((key: string) => {
    setActiveKinds((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  }, []);

  const invalidateCalendar = useCallback(() => {
    for (const key of ["calendar-window", "calendar-agenda", "calendar-window-counts", "calendar-window-counts-today",
      "calendar-window-counts-next30", "calendar-provider-health", "calendar-owner-conflicts"]) {
      queryClient.invalidateQueries({ queryKey: [key] });
    }
  }, [queryClient]);

  // ── appointment create / edit / cancel (calendar_events) ────────────────
  const openCreate = (dayKey?: string) => {
    setEditingId(null);
    setApptForm({ title: "", person: "", date: dayKey ?? selectedDay, time: "09:00", duration: "30", zone: BUSINESS_TZ, link: "", notes: "" });
    setApptOpen(true);
  };

  const openEdit = async (item: CalendarItem) => {
    if (!item.refId) return;
    const { data, error: readError } = await supabase
      .from("calendar_events")
      .select("id, title, starts_at, ends_at, metadata")
      .eq("id", item.refId)
      .maybeSingle();
    if (readError || !data) {
      toast.error("Could not load that appointment");
      return;
    }
    const meta = (data.metadata && typeof data.metadata === "object" && !Array.isArray(data.metadata)
      ? data.metadata : {}) as Record<string, unknown>;
    const zone = isValidTimeZone(meta.event_tz as string) ? (meta.event_tz as string) : BUSINESS_TZ;
    const startsMs = new Date(data.starts_at).getTime();
    const endsMs = data.ends_at ? new Date(data.ends_at).getTime() : startsMs + 30 * 60000;
    setEditingId(data.id);
    setApptForm({
      title: data.title ?? "",
      person: typeof meta.person_name === "string" ? meta.person_name : "",
      date: dateKeyInZone(data.starts_at, zone),
      time: timeValueInZone(data.starts_at, zone),
      duration: String(Math.max(15, Math.round((endsMs - startsMs) / 60000))),
      zone,
      link: typeof meta.meeting_link === "string" ? meta.meeting_link : "",
      notes: typeof meta.notes === "string" ? meta.notes : "",
    });
    setApptOpen(true);
  };

  const apptSlot = useMemo(() => {
    if (!apptForm.date || !apptForm.time) return null;
    try {
      const start = zonedWallTimeToUtc(apptForm.date, apptForm.time, apptForm.zone);
      return { start, end: new Date(Date.parse(start) + Number(apptForm.duration) * 60000).toISOString() };
    } catch {
      return null;
    }
  }, [apptForm.date, apptForm.time, apptForm.zone, apptForm.duration]);
  const apptConflicts = useOwnerConflicts({
    ownerUserId: apptOpen ? user?.id : null,
    startsAt: apptSlot?.start ?? null,
    endsAt: apptSlot?.end ?? null,
    excludeKey: editingId ? `cal:${editingId}` : null,
  });

  const saveAppointment = async () => {
    if (!apptForm.title.trim()) { toast.error("Give the appointment a title"); return; }
    if (!apptSlot) { toast.error("Pick a valid date and time"); return; }
    const link = apptForm.link.trim();
    if (link && !/^https:\/\/\S+$/i.test(link)) { toast.error("Meeting link must be an https:// URL"); return; }
    setSavingAppt(true);
    try {
      const metadata = {
        person_name: apptForm.person.trim() || null,
        notes: apptForm.notes.trim() || null,
        event_tz: apptForm.zone,
        meeting_link: link || null,
      };
      if (editingId) {
        const { error: updateError } = await supabase
          .from("calendar_events")
          .update({ title: apptForm.title.trim(), starts_at: apptSlot.start, ends_at: apptSlot.end, metadata } as never)
          .eq("id", editingId);
        if (updateError) throw updateError;
        toast.success("Appointment updated");
      } else {
        const { error: insertError } = await supabase
          .from("calendar_events")
          .insert({
            title: apptForm.title.trim(),
            starts_at: apptSlot.start,
            ends_at: apptSlot.end,
            source: "apex",
            status: "scheduled",
            user_id: user?.id ?? null,
            metadata,
          } as never);
        if (insertError) throw insertError;
        toast.success("Appointment created");
      }
      playSound("success");
      setApptOpen(false);
      setSelectedDay(dateKeyInZone(apptSlot.start, BUSINESS_TZ));
      invalidateCalendar();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Could not save the appointment");
      playSound("error");
    } finally {
      setSavingAppt(false);
    }
  };

  /** Soft cancel: the row stays, with status 'cancelled' and the reason. */
  const cancelAppointment = async () => {
    if (!apptCancel?.refId || !apptCancelReason.trim()) return;
    setCancelingAppt(true);
    try {
      const { data, error: readError } = await supabase
        .from("calendar_events")
        .select("id, metadata")
        .eq("id", apptCancel.refId)
        .maybeSingle();
      if (readError || !data) throw new Error(readError?.message ?? "Appointment not found");
      const meta = (data.metadata && typeof data.metadata === "object" && !Array.isArray(data.metadata)
        ? data.metadata : {}) as Record<string, unknown>;
      const { error: updateError } = await supabase
        .from("calendar_events")
        .update({
          status: "cancelled",
          metadata: { ...meta, cancel_reason: apptCancelReason.trim(), canceled_at: new Date().toISOString(), canceled_by: user?.id ?? null },
        } as never)
        .eq("id", apptCancel.refId);
      if (updateError) throw updateError;
      toast.success("Appointment canceled — kept on record");
      setApptCancel(null);
      setApptCancelReason("");
      invalidateCalendar();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Could not cancel the appointment");
    } finally {
      setCancelingAppt(false);
    }
  };

  // ── interview actions ───────────────────────────────────────────────────
  /** Same disposition writer as Follow-Ups, so applications.status moves too. */
  const markNoShow = async (item: CalendarItem) => {
    if (!item.refId) return;
    try {
      await disposeInterview(item.refId, "no_show");
      toast.success("Marked as no-show");
      playSound("error");
      invalidateCalendar();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Could not record the no-show");
    }
  };

  const agendaActions = {
    onReschedule: (item: CalendarItem) => setRescheduleItem(item),
    onCancel: (item: CalendarItem) => setCancelItem(item),
    onNoShow: markNoShow,
    onEditAppointment: openEdit,
    onCancelAppointment: (item: CalendarItem) => { setApptCancel(item); setApptCancelReason(""); },
  };

  const handleAutoPopulate = async () => {
    setAutoPopulating(true);
    try {
      const { data, error: fnError } = await supabase.functions.invoke("schedule-auto-populate", {
        body: { lookahead_days: 45, email_managers: true },
      });
      if (fnError) throw fnError;
      const result = data as {
        inserted?: { total?: number; draft_dates?: number; post_test_follow_ups?: number };
        email_summary?: { sent?: number };
      } | null;
      const inserted = result?.inserted?.total ?? 0;
      const drafts = result?.inserted?.draft_dates ?? 0;
      const followUps = result?.inserted?.post_test_follow_ups ?? 0;
      // This function notifies the owning manager about each NEW item it books. Say so.
      const mailed = result?.email_summary?.sent ?? 0;
      toast.success(inserted > 0
        ? `Auto-filled ${inserted} schedule item${inserted === 1 ? "" : "s"} (${drafts} drafts, ${followUps} follow-ups)${mailed > 0 ? ` · ${mailed} manager email${mailed === 1 ? "" : "s"} sent` : ""}`
        : "Schedule auto-fill is already current — nothing new to book, no email sent");
      invalidateCalendar();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Schedule auto-fill failed");
    } finally {
      setAutoPopulating(false);
    }
  };

  const handleSearch = async (query: string) => {
    setSearchQuery(query);
    if (query.length < 2) { setSearchResults([]); return; }
    setSearching(true);
    try {
      const { data } = await supabase
        .from("applications")
        .select("id, first_name, last_name, email, phone, status")
        .or(`first_name.ilike.%${query}%,last_name.ilike.%${query}%,email.ilike.%${query}%,phone.ilike.%${query}%`)
        .is("terminated_at", null)
        .limit(10);
      setSearchResults((data || []) as LeadResult[]);
    } catch { setSearchResults([]); } // empty-catch-allow:best-effort-fallback
    finally { setSearching(false); }
  };

  const handleSelectLead = (lead: LeadResult) => {
    setSelectedLead(lead);
    setSearchOpen(false);
    setSearchQuery("");
    setSearchResults([]);
    setSchedulerOpen(true);
  };

  if (!user) return <PageSkeleton />;

  // ── render ──────────────────────────────────────────────────────────────
  const weekdayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const listDays = view === "day" ? [fmtKey(anchor)] : dayKeys;
  const selectedDayCount = byDay.get(selectedDay)?.length ?? 0;

  return (
    <div className="space-y-5 p-4 md:p-6">
      <PageHeader
        eyebrow="Clients"
        eyebrowIcon={<CalendarIcon className="h-4 w-4" />}
        title="Calendar"
        subtitle="Interviews, onboarding calls, appointments and client dates — one record each, times shown in their own zone."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={goToday}>Today</Button>
            <div className="flex items-center">
              <Button variant="outline" size="icon" className="h-8 w-8 rounded-r-none" aria-label="Previous period" onClick={() => step(-1)}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="icon" className="h-8 w-8 rounded-l-none border-l-0" aria-label="Next period" onClick={() => step(1)}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
            <div className="flex items-center rounded-md border border-border p-0.5" role="group" aria-label="Calendar view">
              {(["agenda", "day", "week", "month"] as CalendarView[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={view === mode}
                  onClick={() => changeView(mode)}
                  className={cn(
                    "rounded px-3 py-1 text-xs font-medium capitalize transition-colors",
                    view === mode ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {mode}
                </button>
              ))}
            </div>
            <Popover open={jumpOpen} onOpenChange={setJumpOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" size="icon" className="h-8 w-8" aria-label="Jump to date">
                  <CalendarDays className="h-4 w-4" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="end">
                <DayCalendar
                  mode="single"
                  selected={parseISO(selectedDay)}
                  onSelect={(d) => {
                    if (!d) return;
                    setAnchor(d);
                    setSelectedDay(fmtKey(d));
                    setJumpOpen(false);
                  }}
                  initialFocus
                />
              </PopoverContent>
            </Popover>
            <Button variant="outline" size="sm" onClick={() => setSearchOpen(true)}>
              <Search className="mr-1 h-4 w-4" />Schedule interview
            </Button>
            <Button size="sm" onClick={() => openCreate()}>
              <Plus className="mr-1 h-4 w-4" />Appointment
            </Button>
          </div>
        }
      />

      {/* KPI strip — numbers aggregated server-side by calendar_window_counts */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          {
            label: "In view",
            value: countedTotal.toLocaleString(),
            note: fromKey === toKey
              ? format(range.from, "EEE, MMM d")
              : `${format(range.from, "MMM d")} – ${format(range.to, "MMM d, yyyy")}`,
          },
          { label: "Today", value: sumCounts(todayCounts).toLocaleString(), note: format(parseISO(todayKey), "EEE, MMM d") },
          { label: "Next 30 days", value: sumCounts(next30Counts).toLocaleString(), note: "all event kinds" },
        ].map((metric) => (
          <Card key={metric.label}>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">{metric.label}</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">{metric.value}</p>
              <p className="truncate text-xs text-muted-foreground">{metric.note}</p>
            </CardContent>
          </Card>
        ))}
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Booking sources</p>
            <button
              type="button"
              className="mt-1 text-left text-sm font-medium text-primary underline-offset-2 hover:underline"
              aria-expanded={providersOpen}
              onClick={() => setProvidersOpen((v) => !v)}
            >
              {providersOpen ? "Hide provider status" : "Calendly, Google, reminders"}
            </button>
            <p className="truncate text-xs text-muted-foreground">read from sync logs, not assumed</p>
          </CardContent>
        </Card>
      </div>

      {providersOpen && <ProviderHealthPanel enabled={isStaff} />}
      {providersOpen && !isStaff && (
        <p className="text-xs text-muted-foreground">Booking-provider status is visible to scheduling staff.</p>
      )}

      {/* Period label + filters */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-xl font-semibold">{periodLabel}</h2>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <Switch checked={showCanceled} onCheckedChange={setShowCanceled} aria-label="Show canceled events" />
            Show canceled
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
          <button
            type="button"
            onClick={() => setActiveKinds([])}
            aria-pressed={activeKinds.length === 0}
            className={cn(
              "rounded-full border px-2.5 py-1 font-medium transition-colors",
              activeKinds.length === 0 ? "border-primary/40 bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground",
            )}
          >
            All kinds
          </button>
          {KINDS.map((kind) => {
            const on = activeKinds.includes(kind.key);
            const n = countByKind[kind.key] ?? 0;
            return (
              <button
                key={kind.key}
                type="button"
                onClick={() => toggleKind(kind.key)}
                aria-pressed={on}
                title={`Source: ${kind.source}`}
                className={cn(
                  "flex items-center gap-2 rounded-full border px-2.5 py-1 transition-colors",
                  on ? "border-primary/40 bg-primary/10 text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
                  n === 0 && !on && "opacity-50",
                )}
              >
                <span className={cn("h-2.5 w-2.5 rounded-full", kind.dot)} />
                {kind.label}
                <span className="tabular-nums text-muted-foreground">{n}</span>
              </button>
            );
          })}
        </div>
      </div>

      {truncated && (
        <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-xs text-foreground">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
          <span>
            This range holds more rows than the page reads at once ({countedTotal.toLocaleString()} counted). Filter by kind or
            switch to a shorter view to see every row. The counts above are complete.
          </span>
        </div>
      )}

      {(windowQuery.isError || agendaQuery.isError) && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            {agendaQuery.isError
              ? `Appointments feed did not answer (${agendaQuery.error instanceof Error ? agendaQuery.error.message : "unknown error"}); interviews are shown read-only from the date feed.`
              : `Date feed did not answer (${windowQuery.error instanceof Error ? windowQuery.error.message : "unknown error"}).`}
            {" "}Nothing is being guessed in its place.
          </span>
        </div>
      )}

      {/* ── Main view ────────────────────────────────────────────────────── */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-2 p-4" aria-busy="true">
              {/* stable-key-allow:skeleton */}
              {["s1", "s2", "s3", "s4", "s5"].map((id) => <Skeleton key={id} className="h-12 w-full rounded-md" />)}
            </div>
          ) : view === "agenda" || view === "day" ? (
            <AgendaList
              days={listDays}
              itemsByDay={byDay}
              todayKey={todayKey}
              viewerUserId={user.id}
              ownerNames={ownerNames ?? {}}
              actions={agendaActions}
              emptyText={view === "day"
                ? `Nothing on ${format(anchor, "EEEE, MMMM d")}${activeKinds.length ? " for the selected kinds" : ""}.`
                : `Nothing in the next ${AGENDA_DAYS} days${activeKinds.length ? " for the selected kinds" : ""}.`}
            />
          ) : (
            <>
              <div className="grid grid-cols-7 border-b border-border">
                {weekdayLabels.map((label) => (
                  <div key={label} className="px-2 py-2 text-xs font-medium text-muted-foreground">{label}</div>
                ))}
              </div>
              <div className={cn("grid grid-cols-7", view === "week" && "min-h-[420px]")}>
                {gridDays.map((day) => {
                  const key = fmtKey(day);
                  const rows = byDay.get(key) ?? [];
                  const outside = view === "month" && !isSameMonth(day, anchor);
                  const isToday = key === todayKey;
                  const cap = view === "week" ? 12 : 3;
                  return (
                    <div
                      key={key}
                      role="button"
                      tabIndex={0}
                      aria-label={`${format(day, "EEEE, MMMM d")}: ${rows.length} event${rows.length === 1 ? "" : "s"}`}
                      onClick={() => pickDay(key)}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pickDay(key); } }}
                      onDoubleClick={() => openCreate(key)}
                      className={cn(
                        "min-h-[104px] cursor-pointer border-b border-r border-border p-1.5 text-left align-top transition-colors last:border-r-0 hover:bg-muted/40 focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)]",
                        view === "week" && "min-h-[420px]",
                        outside && "bg-muted/20",
                        selectedDay === key && "bg-primary/5 ring-1 ring-inset ring-primary/40",
                      )}
                    >
                      <div className="mb-1 flex items-center justify-between">
                        <span className={cn(
                          "inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-xs tabular-nums",
                          outside ? "text-muted-foreground/50" : "text-foreground",
                          isToday && "bg-primary/15 font-semibold text-primary ring-1 ring-primary/50",
                        )}>
                          {format(day, "d")}
                        </span>
                        {rows.length > 0 && (
                          <span className="text-[10px] tabular-nums text-muted-foreground">{rows.length}</span>
                        )}
                      </div>
                      <div className="space-y-0.5">
                        {rows.slice(0, cap).map((item) => (
                          <EventChip key={item.key} item={item} onClick={() => pickDay(key)} />
                        ))}
                        {rows.length > cap && (
                          <span className="block px-1 text-[10px] text-muted-foreground">+{rows.length - cap} more</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* ── Selected day detail (week / month) ───────────────────────────── */}
      {(view === "week" || view === "month") && (
        <Card>
          <CardContent className="p-0">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2.5">
              <div>
                <p className="font-semibold">{format(parseISO(selectedDay), "EEEE, MMMM d, yyyy")}</p>
                <p className="text-xs text-muted-foreground">
                  {selectedDay === todayKey ? "Today · " : ""}
                  {selectedDayCount} event{selectedDayCount === 1 ? "" : "s"} in view
                </p>
              </div>
              <Button size="sm" variant="outline" onClick={() => openCreate(selectedDay)}>
                <Plus className="mr-1 h-3.5 w-3.5" />Appointment
              </Button>
            </div>
            <AgendaList
              days={[selectedDay]}
              itemsByDay={byDay}
              todayKey={todayKey}
              viewerUserId={user.id}
              ownerNames={ownerNames ?? {}}
              actions={agendaActions}
              emptyText={`Nothing on this day${activeKinds.length ? " for the selected kinds" : ""}.`}
            />
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 text-[11px] text-muted-foreground">
        <p>
          No feed yet: {UNFED_KINDS.join(" · ")} — no table publishes those dates, so the calendar does not invent them.
        </p>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs"
          onClick={handleAutoPopulate}
          disabled={autoPopulating}
          title="Book upcoming policy draft checks and post-test follow-ups. Emails the owning manager about each NEW item it books."
        >
          <RefreshCw className={cn("mr-1 h-3.5 w-3.5", autoPopulating && "animate-spin")} />Auto-fill draft dates (emails managers)
        </Button>
      </div>

      {/* ── Create / edit appointment ────────────────────────────────────── */}
      <Dialog open={apptOpen} onOpenChange={setApptOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit appointment" : "New appointment"}</DialogTitle>
            <DialogDescription>Saved on your calendar in the time zone you pick.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label htmlFor="appt-title" className="text-xs font-medium text-muted-foreground">Title *</label>
              <Input id="appt-title" className="mt-1" placeholder="e.g. Policy review — Charles Kimes"
                value={apptForm.title} onChange={(e) => setApptForm((p) => ({ ...p, title: e.target.value }))} />
            </div>
            <div>
              <label htmlFor="appt-person" className="text-xs font-medium text-muted-foreground">Person</label>
              <Input id="appt-person" className="mt-1" placeholder="Who is this with?"
                value={apptForm.person} onChange={(e) => setApptForm((p) => ({ ...p, person: e.target.value }))} />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label htmlFor="appt-date" className="text-xs font-medium text-muted-foreground">Date *</label>
                <Input id="appt-date" type="date" className="mt-1"
                  value={apptForm.date} onChange={(e) => setApptForm((p) => ({ ...p, date: e.target.value }))} />
              </div>
              <div>
                <label htmlFor="appt-time" className="text-xs font-medium text-muted-foreground">Start</label>
                <Input id="appt-time" type="time" className="mt-1"
                  value={apptForm.time} onChange={(e) => setApptForm((p) => ({ ...p, time: e.target.value }))} />
              </div>
              <div>
                <label htmlFor="appt-duration" className="text-xs font-medium text-muted-foreground">Length</label>
                <Select value={apptForm.duration} onValueChange={(v) => setApptForm((p) => ({ ...p, duration: v }))}>
                  <SelectTrigger id="appt-duration" aria-label="Appointment length" className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["15", "30", "45", "60", "90"].map((m) => (
                      <SelectItem key={m} value={m}>{m} min</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <label htmlFor="appt-zone" className="text-xs font-medium text-muted-foreground">Time zone</label>
              <TimeZoneSelect id="appt-zone" className="mt-1" value={apptForm.zone} ariaLabel="Appointment time zone"
                onChange={(zone) => setApptForm((p) => ({ ...p, zone }))} />
            </div>
            <div>
              <label htmlFor="appt-link" className="text-xs font-medium text-muted-foreground">Meeting link</label>
              <Input id="appt-link" className="mt-1" placeholder="https://…"
                value={apptForm.link} onChange={(e) => setApptForm((p) => ({ ...p, link: e.target.value }))} />
            </div>
            <ConflictNotice conflicts={apptConflicts.data} isLoading={apptConflicts.isFetching} isError={apptConflicts.isError} />
            <div>
              <label htmlFor="appt-notes" className="text-xs font-medium text-muted-foreground">Notes</label>
              <Textarea id="appt-notes" rows={2} className="mt-1" placeholder="Anything worth remembering"
                value={apptForm.notes} onChange={(e) => setApptForm((p) => ({ ...p, notes: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setApptOpen(false)}>Close</Button>
            <Button onClick={saveAppointment} disabled={savingAppt || !apptForm.title.trim()}>
              {savingAppt ? "Saving…" : editingId ? "Save changes" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Cancel appointment (soft) ────────────────────────────────────── */}
      <Dialog open={!!apptCancel} onOpenChange={(open) => { if (!open) setApptCancel(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Cancel {apptCancel?.title ?? "appointment"}</DialogTitle>
            <DialogDescription>The appointment stays on record as canceled, with your reason.</DialogDescription>
          </DialogHeader>
          <div>
            <label htmlFor="appt-cancel-reason" className="text-xs font-medium text-muted-foreground">Reason *</label>
            <Textarea id="appt-cancel-reason" rows={2} className="mt-1" value={apptCancelReason}
              onChange={(e) => setApptCancelReason(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setApptCancel(null)}>Keep it</Button>
            <Button variant="destructive" onClick={cancelAppointment} disabled={cancelingAppt || !apptCancelReason.trim()}>
              {cancelingAppt ? "Canceling…" : "Cancel appointment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <RescheduleInterviewDialog
        item={rescheduleItem}
        viewerUserId={user.id}
        open={!!rescheduleItem}
        onOpenChange={(open) => { if (!open) setRescheduleItem(null); }}
        onDone={invalidateCalendar}
      />
      <CancelInterviewDialog
        item={cancelItem}
        open={!!cancelItem}
        onOpenChange={(open) => { if (!open) setCancelItem(null); }}
        onDone={invalidateCalendar}
      />

      {/* ── Lead search → interview scheduler ────────────────────────────── */}
      <Dialog open={searchOpen} onOpenChange={setSearchOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Search className="h-4 w-4 text-primary" /> Find lead to schedule
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Input placeholder="Search by name, email, or phone..." value={searchQuery}
              onChange={(e) => handleSearch(e.target.value)} autoFocus />
            {searching && <p className="text-xs text-muted-foreground">Searching...</p>}
            {searchResults.length > 0 && (
              <div className="max-h-64 space-y-1 overflow-y-auto">
                {searchResults.map((lead) => (
                  <button key={lead.id} type="button" onClick={() => handleSelectLead(lead)}
                    className="flex w-full items-center gap-3 rounded-lg border border-border p-3 text-left transition-colors hover:bg-muted/50">
                    <div className="rounded-full bg-primary/10 p-1.5">
                      <User className="h-3.5 w-3.5 text-primary" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{lead.first_name} {lead.last_name}</p>
                      <p className="truncate text-xs text-muted-foreground">{lead.email}</p>
                    </div>
                    <Badge variant="outline" className="shrink-0 text-[10px]">{lead.status}</Badge>
                  </button>
                ))}
              </div>
            )}
            {searchQuery.length >= 2 && !searching && searchResults.length === 0 && (
              <AddNewApplicantForm onCreated={handleSelectLead} />
            )}
          </div>
        </DialogContent>
      </Dialog>

      {schedulerOpen && selectedLead && (
        <InterviewScheduler
          open={schedulerOpen}
          onOpenChange={(open) => { setSchedulerOpen(open); if (!open) setSelectedLead(null); }}
          applicationId={selectedLead.id}
          applicantName={`${selectedLead.first_name} ${selectedLead.last_name}`}
          applicantEmail={selectedLead.email}
          onScheduled={invalidateCalendar}
        />
      )}
    </div>
  );
}
