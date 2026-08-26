import { useState, useMemo, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  format, parseISO, startOfMonth, endOfMonth, startOfWeek, endOfWeek,
  addMonths, addWeeks, addDays, eachDayOfInterval, isSameMonth,
} from "date-fns";
import {
  Calendar as CalendarIcon, Plus, Download, ChevronLeft, ChevronRight,
  AlertTriangle, CalendarPlus, ExternalLink, Search, User, RefreshCw,
  Pencil, Trash2, CalendarDays, Cake, FileSignature, PhoneCall, Flag, Video, Award,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { InterviewScheduler } from "@/components/dashboard/InterviewScheduler";
import { Skeleton } from "@/components/ui/skeleton";
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
import { resolveBrand } from "@/config/brand";

/* ─────────────────────────────────────────────────────────────────────────────
 * APEX Calendar
 *
 * Every row on this page comes from two server-side functions:
 *   calendar_window(p_from date, p_to date, p_kinds text[])  → the events
 *   calendar_window_counts(p_from date, p_to date)           → the headline counts
 *
 * Why that matters: the previous version of this page ran four independent
 * client queries (applications / seminar_registrations / calendar_events /
 * interview_events), each with its own .limit(), then sorted the union by date
 * ASC and kept `.slice(0, 120)` — the OLDEST 120 rows. On a book with 1,700+
 * historic policy dates that slice never reached the present, so "upcoming"
 * rendered empty while the DB held hundreds of live events.
 *
 * Two rules this page holds:
 *   1. A headline number is NEVER `someArray.length`. PostgREST caps a result
 *      set at 1000 rows (measured: a 2026-08-01→2026-12-31 window whose true
 *      total is 1,110 returns exactly 1000), so an array length silently
 *      becomes a lie the moment a range gets busy. Counts come from
 *      calendar_window_counts, which aggregates in Postgres. When the fetched
 *      rows fall short of the counted total the page SAYS SO rather than
 *      quietly drawing a partial month.
 *   2. Dates are bucketed on the `event_date` STRING the RPC returns, never on
 *      `new Date(event_date)`. The RPC already resolved every timestamp in
 *      America/Phoenix; re-parsing "2026-08-20" in a browser west of UTC lands
 *      on the 19th and shifts the whole grid back a day.
 * ────────────────────────────────────────────────────────────────────────── */

const PHOENIX_TZ = "America/Phoenix";
const BRAND = resolveBrand();
/** Arizona does not observe DST, so its offset is a constant. */
const PHOENIX_OFFSET = "-07:00";

type ViewMode = "day" | "week" | "month";

type CalendarEventRow = {
  event_id: string;
  event_date: string;      // YYYY-MM-DD, already resolved in America/Phoenix
  event_at: string;        // ISO timestamptz
  kind: string;
  title: string;
  subtitle: string | null;
  person_name: string | null;
  status: string | null;
  ref_id: string | null;
  link: string | null;
};

type KindMeta = {
  key: string;
  label: string;
  dot: string;
  chip: string;
  icon: typeof CalendarIcon;
  source: string;
};

/**
 * The eight kinds calendar_window actually emits, in the vocabulary the page
 * shows an operator. "Policy Starting Soon" is the policy effective date out of
 * agentlink_book — same event, the name Sam's team uses for it.
 */
const KINDS: KindMeta[] = [
  { key: "appointment", label: "Appointment", dot: "bg-primary", chip: "bg-primary/10 text-primary border-primary/30", icon: CalendarDays, source: "calendar_events" },
  { key: "interview", label: "Interview", dot: "bg-sky-500", chip: "bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/30", icon: Video, source: "interview_events" },
  { key: "onboarding_call", label: "Onboarding call", dot: "bg-primary", chip: "bg-primary/10 text-primary border-primary/30", icon: Video, source: "interview_events" },
  { key: "birthday", label: "Birthday", dot: "bg-pink-500", chip: "bg-pink-500/10 text-pink-600 dark:text-pink-400 border-pink-500/30", icon: Cake, source: "agentlink_clients.date_of_birth" },
  // NB: `emerald` and `teal` are remapped onto the APEX gold ramp in
  // tailwind.config.ts, so bg-emerald-500 renders GOLD and would be
  // indistinguishable from Appointment. `green-*` is deliberately left alone by
  // that remap, which is why it is used here.
  { key: "policy_effective", label: "Policy Starting Soon", dot: "bg-green-500", chip: "bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/30", icon: FileSignature, source: "agentlink_book.effective_date" },
  { key: "draft_date", label: "Draft Date", dot: "bg-orange-500", chip: "bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/30", icon: FileSignature, source: "calendar_events (auto-fill)" },
  { key: "follow_up", label: "Follow-Up", dot: "bg-violet-500", chip: "bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/30", icon: Flag, source: "applications.next_action_at" },
  { key: "callback", label: "Callback", dot: "bg-cyan-500", chip: "bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border-cyan-500/30", icon: PhoneCall, source: "agentlink_clients.callback_date" },
  // red, not rose: rose-500 and pink-500 are one hue-step apart and were
  // indistinguishable against Birthday at the 6px dot size the grid uses.
  { key: "milestone", label: "Milestone", dot: "bg-red-500", chip: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/30", icon: Award, source: "applications milestones" },
];

const KIND_BY_KEY: Record<string, KindMeta> = Object.fromEntries(KINDS.map((k) => [k.key, k]));

/**
 * Event names carried over from the reference calendar that NO table on this
 * database publishes a date for. They are named here on purpose: an operator
 * who expects a Beneficiary Check-In to appear should be told it has no feed,
 * not left to assume the calendar is complete. Nothing is invented to fill them.
 */
const UNFED_KINDS = ["Beneficiary Check-In", "Lapse Follow-Up", "Policy Anniversary"];

/** Internal feed tokens that land in `subtitle` for appointments. A machine
 *  token is not a description, so it is suppressed rather than rendered. */
const INTERNAL_SOURCE_TOKENS = new Set(["apex", "siri", "schedule-auto-populate", "calendly", "apex-calendar"]);

const fmtKey = (d: Date) => format(d, "yyyy-MM-dd");

/**
 * The days a given view actually PAINTS. Month view draws a 6-week grid, so it
 * shows leading/trailing days of the neighbouring months — the window queried
 * and counted is that whole grid, not the calendar month. Shared by the range
 * memo and by navigation so the two can never disagree about what is on screen.
 */
function rangeFor(date: Date, view: ViewMode): { from: Date; to: Date } {
  if (view === "month") {
    return {
      from: startOfWeek(startOfMonth(date), { weekStartsOn: 0 }),
      to: endOfWeek(endOfMonth(date), { weekStartsOn: 0 }),
    };
  }
  if (view === "week") {
    return { from: startOfWeek(date, { weekStartsOn: 0 }), to: endOfWeek(date, { weekStartsOn: 0 }) };
  }
  return { from: date, to: date };
}

/** Today's date key in Phoenix, regardless of where the browser is. */
function phoenixTodayKey(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: PHOENIX_TZ, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

/** "9:00 AM" for a timestamptz, rendered in Phoenix. */
function phoenixTime(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: PHOENIX_TZ, hour: "numeric", minute: "2-digit",
  }).format(new Date(iso));
}

/** All-day rows land on Phoenix midnight; do not print a meaningless "12:00 AM". */
function isAllDay(row: CalendarEventRow): boolean {
  return phoenixTime(row.event_at) === "12:00 AM";
}

function subtitleFor(row: CalendarEventRow): string | null {
  if (!row.subtitle) return null;
  if (row.kind === "appointment" && INTERNAL_SOURCE_TOKENS.has(row.subtitle)) return null;
  return row.subtitle;
}

function buildCalendarUrl(params: {
  title: string; startDate: Date; durationMinutes: number; description: string; location?: string;
}): string {
  const start = format(params.startDate, "yyyyMMdd'T'HHmmss");
  const end = format(new Date(params.startDate.getTime() + params.durationMinutes * 60000), "yyyyMMdd'T'HHmmss");
  const url = new URL("https://calendar.google.com/calendar/render");
  url.searchParams.set("action", "TEMPLATE");
  url.searchParams.set("text", params.title);
  url.searchParams.set("dates", `${start}/${end}`);
  url.searchParams.set("details", params.description);
  if (params.location) url.searchParams.set("location", params.location);
  return url.toString();
}

function downloadIcs(row: CalendarEventRow) {
  const start = new Date(row.event_at);
  const end = new Date(start.getTime() + 30 * 60000);
  const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
  const ics = [
    "BEGIN:VCALENDAR", "VERSION:2.0", `PRODID:-//${BRAND.legalName}//Calendar//EN`, "BEGIN:VEVENT",
    `DTSTART:${stamp(start)}`,
    `DTEND:${stamp(end)}`,
    `SUMMARY:${row.title}`,
    `DESCRIPTION:${[KIND_BY_KEY[row.kind]?.label ?? row.kind, subtitleFor(row)].filter(Boolean).join(" — ")}`,
    row.link ? `URL:${row.link}` : "",
    "END:VEVENT", "END:VCALENDAR",
  ].filter(Boolean).join("\r\n");
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([ics], { type: "text/calendar" }));
  link.download = `${row.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "event"}.ics`;
  link.click();
  URL.revokeObjectURL(link.href);
  toast.success("Downloaded .ics — open it to add to Apple Calendar");
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
        status: "new" as any,
      }).select("id, first_name, last_name, email, phone, status").single();
      if (error) throw error;
      toast.success(`${form.first_name} ${form.last_name} added`);
      onCreated(data as LeadResult);
    } catch (err: any) {
      toast.error(err.message || "Failed to add applicant");
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
function EventChip({ row, onClick, compact }: { row: CalendarEventRow; onClick: () => void; compact?: boolean }) {
  const meta = KIND_BY_KEY[row.kind];
  return (
    <button
      type="button"
      onClick={onClick}
      title={`${row.title}${subtitleFor(row) ? ` — ${subtitleFor(row)}` : ""}`}
      className={cn(
        "flex w-full items-center gap-1 rounded px-1 py-0.5 text-left text-[10px] leading-tight transition-colors hover:bg-muted",
        compact && "py-[1px]",
      )}
    >
      <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", meta?.dot ?? "bg-muted-foreground")} />
      {!isAllDay(row) && <span className="shrink-0 tabular-nums text-muted-foreground">{phoenixTime(row.event_at).replace(":00", "")}</span>}
      <span className="truncate">{row.title}</span>
    </button>
  );
}

export default function CalendarPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { playSound } = useSoundEffects();

  const todayKey = useMemo(() => phoenixTodayKey(), []);
  const [anchor, setAnchor] = useState<Date>(() => parseISO(phoenixTodayKey()));
  const [view, setView] = useState<ViewMode>("month");
  const [activeKinds, setActiveKinds] = useState<string[]>([]); // [] = every kind
  const [selectedDay, setSelectedDay] = useState<string>(todayKey);
  const [jumpOpen, setJumpOpen] = useState(false);

  // create / edit appointment
  const [apptOpen, setApptOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [apptForm, setApptForm] = useState({ title: "", person: "", date: todayKey, time: "09:00", duration: "30", notes: "" });
  const [savingAppt, setSavingAppt] = useState(false);
  const [deletingAppt, setDeletingAppt] = useState(false);

  // interview scheduling
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<LeadResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedLead, setSelectedLead] = useState<LeadResult | null>(null);
  const [schedulerOpen, setSchedulerOpen] = useState(false);
  const [autoPopulating, setAutoPopulating] = useState(false);

  // ── visible range, derived from the view ────────────────────────────────
  const range = useMemo(() => rangeFor(anchor, view), [anchor, view]);

  const fromKey = fmtKey(range.from);
  const toKey = fmtKey(range.to);

  const periodLabel = view === "month"
    ? format(anchor, "MMMM yyyy")
    : view === "week"
      ? `${format(range.from, "MMM d")} – ${format(range.to, "MMM d, yyyy")}`
      : format(anchor, "EEEE, MMMM d, yyyy");

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
    const keys = activeKinds.length ? activeKinds : KINDS.map((k) => k.key);
    return keys.reduce((sum, k) => sum + (countByKind[k] ?? 0), 0);
  }, [countByKind, activeKinds]);

  // ── the events themselves ───────────────────────────────────────────────
  const kindsParam = activeKinds.length ? [...activeKinds].sort() : null;

  const { data: events, isLoading, isError, error } = useQuery({
    queryKey: ["calendar-window", fromKey, toKey, kindsParam?.join(",") ?? "all"],
    queryFn: async () => {
      const { data, error: rpcError } = await supabase.rpc("calendar_window" as never, {
        p_from: fromKey, p_to: toKey, p_kinds: kindsParam,
      } as never);
      if (rpcError) throw rpcError;
      return (data ?? []) as CalendarEventRow[];
    },
    enabled: !!user,
    staleTime: 30_000,
  });

  /** PostgREST hard-caps a result set at 1000 rows. If the server counted more
   *  than we received, the grid is incomplete and must say so. */
  const truncated = !!events && countedTotal > events.length;

  const byDay = useMemo(() => {
    const map = new Map<string, CalendarEventRow[]>();
    for (const row of events ?? []) {
      // bucket on the RPC's Phoenix date string — never re-parse it as a Date
      const list = map.get(row.event_date);
      if (list) list.push(row);
      else map.set(row.event_date, [row]);
    }
    return map;
  }, [events]);

  const gridDays = useMemo(
    () => eachDayOfInterval({ start: range.from, end: range.to }),
    [range.from, range.to],
  );

  const selectedDayEvents = byDay.get(selectedDay) ?? [];

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

  // Sync freshness reads created_at — when the feed last WROTE a row. Ordering
  // on starts_at instead would let a September booking read as "synced Sep 20"
  // and make a live feed look stale. Do not change this operand.
  const { data: calendarSyncStatus } = useQuery({
    queryKey: ["calendar-sync-freshness", user?.id],
    queryFn: async () => {
      const { data, error: syncError } = await supabase
        .from("calendar_events")
        .select("id, created_at")
        .order("created_at", { ascending: false })
        .limit(1);
      if (syncError) return { live: false, lastSync: null as string | null };
      const last = data?.[0];
      if (!last?.created_at) return { live: false, lastSync: null };
      const fresh = Date.now() - new Date(last.created_at).getTime() < 7 * 86_400_000;
      return { live: fresh, lastSync: last.created_at };
    },
    enabled: !!user,
    staleTime: 5 * 60_000,
  });

  // ── navigation ──────────────────────────────────────────────────────────
  /**
   * Move the anchor, then pull the selected day onto the screen with it.
   * Without this the detail card below the grid keeps describing a day from the
   * month you just navigated away from — it renders "0 events" for a date that
   * is no longer painted, which reads as data loss rather than navigation.
   */
  const stepTo = useCallback((next: Date, nextView: ViewMode) => {
    const r = rangeFor(next, nextView);
    const from = fmtKey(r.from);
    const to = fmtKey(r.to);
    setAnchor(next);
    setSelectedDay((cur) => {
      if (cur >= from && cur <= to) return cur;                 // still visible
      const today = phoenixTodayKey();
      if (today >= from && today <= to) return today;           // prefer today
      return nextView === "month" ? fmtKey(startOfMonth(next)) : from;
    });
  }, []);

  const step = useCallback((dir: 1 | -1) => {
    const next = view === "month" ? addMonths(anchor, dir) : view === "week" ? addWeeks(anchor, dir) : addDays(anchor, dir);
    stepTo(next, view);
  }, [anchor, view, stepTo]);

  const changeView = useCallback((mode: ViewMode) => {
    setView(mode);
    // Day view is anchored on the selected day, so switching to it must follow
    // the selection rather than stay on whatever month the grid was showing.
    stepTo(mode === "day" ? parseISO(selectedDay) : anchor, mode);
  }, [anchor, selectedDay, stepTo]);

  const goToday = useCallback(() => {
    const key = phoenixTodayKey();
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

  // ── appointment create / edit / delete (calendar_events) ────────────────
  const openCreate = (dayKey?: string) => {
    setEditingId(null);
    setApptForm({ title: "", person: "", date: dayKey ?? selectedDay, time: "09:00", duration: "30", notes: "" });
    setApptOpen(true);
  };

  const openEdit = async (row: CalendarEventRow) => {
    if (!row.ref_id) return;
    const { data, error: readError } = await supabase
      .from("calendar_events")
      .select("id, title, starts_at, ends_at, metadata")
      .eq("id", row.ref_id)
      .maybeSingle();
    if (readError || !data) {
      toast.error("Could not load that appointment");
      return;
    }
    const meta = (data.metadata && typeof data.metadata === "object" && !Array.isArray(data.metadata)
      ? data.metadata : {}) as Record<string, unknown>;
    const startsMs = new Date(data.starts_at).getTime();
    const endsMs = data.ends_at ? new Date(data.ends_at).getTime() : startsMs + 30 * 60000;
    setEditingId(data.id);
    setApptForm({
      title: data.title ?? "",
      person: typeof meta.person_name === "string" ? meta.person_name : "",
      date: row.event_date,
      time: new Intl.DateTimeFormat("en-GB", { timeZone: PHOENIX_TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(data.starts_at)),
      duration: String(Math.max(15, Math.round((endsMs - startsMs) / 60000))),
      notes: typeof meta.notes === "string" ? meta.notes : "",
    });
    setApptOpen(true);
  };

  const invalidateCalendar = () => {
    queryClient.invalidateQueries({ queryKey: ["calendar-window"] });
    queryClient.invalidateQueries({ queryKey: ["calendar-window-counts"] });
    queryClient.invalidateQueries({ queryKey: ["calendar-window-counts-today"] });
    queryClient.invalidateQueries({ queryKey: ["calendar-window-counts-next30"] });
    queryClient.invalidateQueries({ queryKey: ["calendar-sync-freshness"] });
  };

  const saveAppointment = async () => {
    if (!apptForm.title.trim()) { toast.error("Give the appointment a title"); return; }
    if (!apptForm.date) { toast.error("Pick a date"); return; }
    setSavingAppt(true);
    try {
      // Phoenix has no DST, so a fixed -07:00 offset is exact all year.
      const startsAt = `${apptForm.date}T${apptForm.time}:00${PHOENIX_OFFSET}`;
      const endsAt = new Date(new Date(startsAt).getTime() + Number(apptForm.duration) * 60000).toISOString();
      const metadata = {
        person_name: apptForm.person.trim() || null,
        notes: apptForm.notes.trim() || null,
      };

      if (editingId) {
        const { error: updateError } = await supabase
          .from("calendar_events")
          .update({ title: apptForm.title.trim(), starts_at: startsAt, ends_at: endsAt, metadata } as never)
          .eq("id", editingId);
        if (updateError) throw updateError;
        toast.success("Appointment updated");
      } else {
        const { error: insertError } = await supabase
          .from("calendar_events")
          .insert({
            title: apptForm.title.trim(),
            starts_at: startsAt,
            ends_at: endsAt,
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
      setSelectedDay(apptForm.date);
      invalidateCalendar();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Could not save the appointment");
      playSound("error");
    } finally {
      setSavingAppt(false);
    }
  };

  const deleteAppointment = async () => {
    if (!editingId) return;
    setDeletingAppt(true);
    try {
      const { error: deleteError } = await supabase.from("calendar_events").delete().eq("id", editingId);
      if (deleteError) throw deleteError;
      toast.success("Appointment deleted");
      setApptOpen(false);
      invalidateCalendar();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Could not delete the appointment");
    } finally {
      setDeletingAppt(false);
    }
  };

  // ── interview actions ───────────────────────────────────────────────────
  const markNoShow = async (row: CalendarEventRow) => {
    if (!row.ref_id) return;
    const { error: updateError } = await supabase
      .from("interview_events" as never)
      .update({ outcome: "no_show", outcome_at: new Date().toISOString() } as never)
      .eq("id", row.ref_id);
    if (updateError) { toast.error(updateError.message); return; }
    toast.success("Marked as no-show");
    playSound("error");
    invalidateCalendar();
  };

  const addToGoogle = (row: CalendarEventRow) => {
    window.open(buildCalendarUrl({
      title: row.title,
      startDate: new Date(row.event_at),
      durationMinutes: 30,
      description: [KIND_BY_KEY[row.kind]?.label ?? row.kind, subtitleFor(row)].filter(Boolean).join(" — "),
      location: row.link || undefined,
    }), "_blank", "noopener,noreferrer");
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
      // This function notifies the owning manager about each NEW item it books.
      // Say so — a button that quietly sends mail is a button nobody can trust.
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

  // ── render ──────────────────────────────────────────────────────────────
  const weekdayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  return (
    <div className="space-y-6 p-4 md:p-6">
      <PageHeader
        eyebrow="Clients"
        eyebrowIcon={<CalendarIcon className="h-4 w-4" />}
        title="Calendar"
        subtitle="Auto-generated insurance events and your appointments, in one view."
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
            <div className="flex items-center rounded-md border border-border p-0.5">
              {(["day", "week", "month"] as ViewMode[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
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
            <Button
              variant="outline"
              size="sm"
              onClick={handleAutoPopulate}
              disabled={autoPopulating}
              title="Book upcoming policy draft checks and post-test follow-ups. Emails the owning manager about each NEW item it books."
            >
              <RefreshCw className={cn("mr-1 h-4 w-4", autoPopulating && "animate-spin")} />Auto-fill
            </Button>
            <Button size="sm" onClick={() => openCreate()}>
              <Plus className="mr-1 h-4 w-4" />Create
            </Button>
          </div>
        }
      />

      {/* KPI strip — every number aggregated server-side by calendar_window_counts */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          {
            label: "In view",
            value: countedTotal.toLocaleString(),
            // NOT periodLabel. Month view paints a 6-week grid, so "August 2026"
            // would label a number that also counts Jul 26–31 and Sep 1–5. The
            // note states the window actually counted.
            note: fromKey === toKey
              ? format(range.from, "EEE, MMM d")
              : `${format(range.from, "MMM d")} – ${format(range.to, "MMM d, yyyy")}`,
          },
          { label: "Today", value: sumCounts(todayCounts).toLocaleString(), note: format(parseISO(todayKey), "EEE, MMM d") },
          { label: "Next 30 days", value: sumCounts(next30Counts).toLocaleString(), note: "all event kinds" },
          {
            label: "Calendar sync",
            value: calendarSyncStatus?.live ? "Live" : calendarSyncStatus?.lastSync ? "Stale" : "—",
            note: calendarSyncStatus?.lastSync
              ? `last write ${format(new Date(calendarSyncStatus.lastSync), "MMM d")}`
              : "no feed on file",
          },
        ].map((metric) => (
          <Card key={metric.label}>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">{metric.label}</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">{metric.value}</p>
              <p className="truncate text-xs text-muted-foreground">{metric.note}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Period label + kind filters */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h2 className="text-xl font-semibold">{periodLabel}</h2>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
          <button
            type="button"
            onClick={() => setActiveKinds([])}
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
        <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Showing {events?.length.toLocaleString()} of {countedTotal.toLocaleString()} events — the API returns at most 1,000 rows per
            request. Filter by kind, or switch to Week or Day, to see the rest. Nothing has been dropped from the counts above.
          </span>
        </div>
      )}

      {isError && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>Calendar feed did not answer: {error instanceof Error ? error.message : "unknown error"}. Nothing is being guessed in its place.</span>
        </div>
      )}

      {/* ── Grid ─────────────────────────────────────────────────────────── */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-2 p-4">
              {/* stable-key-allow:skeleton */}
              {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-16 w-full rounded-md" />)}
            </div>
          ) : view === "day" ? (
            <DayAgenda
              dayKey={fmtKey(anchor)}
              rows={byDay.get(fmtKey(anchor)) ?? []}
              todayKey={todayKey}
              onCreate={() => openCreate(fmtKey(anchor))}
              onSelect={(row) => pickDay(row.event_date)}
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
                    <button
                      key={key}
                      type="button"
                      onClick={() => pickDay(key)}
                      onDoubleClick={() => openCreate(key)}
                      className={cn(
                        "min-h-[104px] border-b border-r border-border p-1.5 text-left align-top transition-colors last:border-r-0 hover:bg-muted/40",
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
                        {rows.slice(0, cap).map((row) => (
                          <EventChip key={row.event_id} row={row} compact={view === "month"} onClick={() => pickDay(key)} />
                        ))}
                        {rows.length > cap && (
                          <span className="block px-1 text-[10px] text-muted-foreground">+{rows.length - cap} more</span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {!isLoading && (events?.length ?? 0) === 0 && view !== "day" && (
            <div className="border-t border-border py-10 text-center">
              <p className="text-sm text-muted-foreground">
                No events this {view} — enjoy the quiet! Or{" "}
                <button type="button" className="text-primary underline underline-offset-2" onClick={() => openCreate()}>
                  create an appointment
                </button>.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Selected day detail ──────────────────────────────────────────── */}
      <Card>
        <CardContent className="p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="font-semibold">{format(parseISO(selectedDay), "EEEE, MMMM d, yyyy")}</p>
              <p className="text-xs text-muted-foreground">
                {selectedDay === todayKey ? "Today · " : ""}
                {selectedDayEvents.length} event{selectedDayEvents.length === 1 ? "" : "s"} in view
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setSearchOpen(true)}>
                <Search className="mr-1 h-3.5 w-3.5" />Schedule interview
              </Button>
              <Button size="sm" onClick={() => openCreate(selectedDay)}>
                <Plus className="mr-1 h-3.5 w-3.5" />Appointment
              </Button>
            </div>
          </div>

          {selectedDayEvents.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Nothing on this day{activeKinds.length ? " for the selected kinds" : ""}. Book something and it lands here.
            </p>
          ) : (
            <div className="space-y-2">
              {selectedDayEvents.map((row) => {
                const meta = KIND_BY_KEY[row.kind];
                const Icon = meta?.icon ?? CalendarIcon;
                const isAppointment = row.kind === "appointment";
                const isInterview = row.kind === "interview" || row.kind === "onboarding_call";
                const past = row.event_date < todayKey;
                return (
                  <div key={row.event_id} className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-3">
                    <div className={cn("shrink-0 rounded-lg border p-2", meta?.chip ?? "border-border")}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate font-medium">{row.title}</span>
                        <Badge variant="outline" className="text-[10px]">{meta?.label ?? row.kind}</Badge>
                        {row.status && row.status !== "birthday" && row.status !== "milestone" && (
                          <Badge variant="secondary" className="text-[10px] capitalize">{row.status.replace(/_/g, " ")}</Badge>
                        )}
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                        <span>{isAllDay(row) ? "All day" : phoenixTime(row.event_at)}</span>
                        {subtitleFor(row) && <span className="truncate">{subtitleFor(row)}</span>}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      {row.link && (
                        <Button variant="ghost" size="icon" className="h-8 w-8" title="Open meeting link" aria-label="Open meeting link"
                          onClick={() => window.open(row.link!, "_blank", "noopener,noreferrer")}>
                          <ExternalLink className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      <Button variant="ghost" size="icon" className="h-8 w-8" title="Add to Google Calendar" aria-label="Add to Google Calendar"
                        onClick={() => addToGoogle(row)}>
                        <CalendarPlus className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8" title="Download .ics" aria-label="Download .ics"
                        onClick={() => downloadIcs(row)}>
                        <Download className="h-3.5 w-3.5" />
                      </Button>
                      {isAppointment && (
                        <Button variant="ghost" size="icon" className="h-8 w-8" title="Edit appointment" aria-label="Edit appointment"
                          onClick={() => openEdit(row)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      {isInterview && past && row.status === "scheduled" && (
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" title="Mark as no-show" aria-label="Mark as no-show"
                          onClick={() => markNoShow(row)}>
                          <AlertTriangle className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <p className="mt-4 border-t border-border pt-3 text-[11px] text-muted-foreground">
            No feed yet: {UNFED_KINDS.join(" · ")} — no table on this database publishes those dates, so the calendar does not
            invent them. They appear the day a source does.
          </p>
        </CardContent>
      </Card>

      {/* ── Create / edit appointment ────────────────────────────────────── */}
      <Dialog open={apptOpen} onOpenChange={setApptOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit appointment" : "New appointment"}</DialogTitle>
            <DialogDescription>Saved to the shared calendar in America/Phoenix time.</DialogDescription>
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
                  <SelectTrigger id="appt-duration" className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["15", "30", "45", "60", "90"].map((m) => (
                      <SelectItem key={m} value={m}>{m} min</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <label htmlFor="appt-notes" className="text-xs font-medium text-muted-foreground">Notes</label>
              <Textarea id="appt-notes" rows={2} className="mt-1" placeholder="Anything worth remembering"
                value={apptForm.notes} onChange={(e) => setApptForm((p) => ({ ...p, notes: e.target.value }))} />
            </div>
          </div>
          <DialogFooter className="gap-2 sm:justify-between">
            {editingId ? (
              <Button variant="ghost" className="text-destructive" onClick={deleteAppointment} disabled={deletingAppt}>
                <Trash2 className="mr-1 h-4 w-4" />{deletingAppt ? "Deleting…" : "Delete"}
              </Button>
            ) : <span />}
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setApptOpen(false)}>Cancel</Button>
              <Button onClick={saveAppointment} disabled={savingAppt || !apptForm.title.trim()}>
                {savingAppt ? "Saving…" : editingId ? "Save changes" : "Create"}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
                  <button key={lead.id} onClick={() => handleSelectLead(lead)}
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
          onScheduled={() => {
            invalidateCalendar();
            setSchedulerOpen(false);
            setSelectedLead(null);
          }}
        />
      )}
    </div>
  );
}

// ─── Day view ───
function DayAgenda({ dayKey, rows, todayKey, onCreate, onSelect }: {
  dayKey: string;
  rows: CalendarEventRow[];
  todayKey: string;
  onCreate: () => void;
  onSelect: (row: CalendarEventRow) => void;
}) {
  if (rows.length === 0) {
    return (
      <div className="py-16 text-center">
        <CalendarIcon className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          Nothing on {format(parseISO(dayKey), "EEEE, MMMM d")}{dayKey === todayKey ? " — enjoy the quiet!" : "."}
        </p>
        <Button variant="outline" size="sm" className="mt-3" onClick={onCreate}>Create an appointment</Button>
      </div>
    );
  }
  return (
    <div className="divide-y divide-border">
      {rows.map((row) => {
        const meta = KIND_BY_KEY[row.kind];
        const Icon = meta?.icon ?? CalendarIcon;
        return (
          <button key={row.event_id} type="button" onClick={() => onSelect(row)}
            className="flex w-full items-center gap-3 p-3 text-left transition-colors hover:bg-muted/40">
            <span className="w-20 shrink-0 text-xs tabular-nums text-muted-foreground">
              {isAllDay(row) ? "All day" : phoenixTime(row.event_at)}
            </span>
            <span className={cn("shrink-0 rounded-lg border p-2", meta?.chip ?? "border-border")}>
              <Icon className="h-4 w-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{row.title}</span>
              {subtitleFor(row) && <span className="block truncate text-xs text-muted-foreground">{subtitleFor(row)}</span>}
            </span>
            <Badge variant="outline" className="shrink-0 text-[10px]">{meta?.label ?? row.kind}</Badge>
          </button>
        );
      })}
    </div>
  );
}
