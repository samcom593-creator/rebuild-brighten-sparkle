import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format, isToday, isBefore, startOfWeek, addDays, getHours, getMinutes } from "date-fns";
import { motion } from "framer-motion";
import {
  Calendar, Video, Phone, MapPin, Clock, Plus, Download,
  AlertTriangle, CheckCircle2, CalendarPlus, ExternalLink, Search, User, RefreshCw,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { InterviewScheduler } from "@/components/dashboard/InterviewScheduler";
import { Skeleton } from "@/components/ui/skeleton";
import { BackgroundGlow } from "@/components/ui/BackgroundGlow";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useSoundEffects } from "@/hooks/useSoundEffects";

type InterviewRow = {
  id: string;
  interview_date: string;
  interview_type: string;
  meeting_link: string | null;
  notes: string | null;
  status: string;
  application_id: string;
  applications: { first_name: string; last_name: string; email: string } | null;
};

type LeadResult = {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  status: string;
};

type PipelineEvent = {
  id: string;
  date: string;
  kind: "follow_up" | "test_date" | "seminar" | "licensing" | "contracting" | "onboarding" | "draft_date" | "post_test_follow_up";
  title: string;
  subtitle: string;
};

const typeIcons: Record<string, typeof Video> = {
  video: Video,
  phone: Phone,
  in_person: MapPin,
};

const typeLabels: Record<string, string> = {
  video: "Video",
  phone: "Phone",
  in_person: "In Person",
};

function buildCalendarUrl(params: {
  title: string;
  startDate: Date;
  durationMinutes: number;
  description: string;
  location?: string;
}): string {
  const start = format(params.startDate, "yyyyMMdd'T'HHmmss");
  const endDate = new Date(params.startDate.getTime() + params.durationMinutes * 60000);
  const end = format(endDate, "yyyyMMdd'T'HHmmss");
  const url = new URL("https://calendar.google.com/calendar/render");
  url.searchParams.set("action", "TEMPLATE");
  url.searchParams.set("text", params.title);
  url.searchParams.set("dates", `${start}/${end}`);
  url.searchParams.set("details", params.description);
  if (params.location) url.searchParams.set("location", params.location);
  return url.toString();
}

// ─── Add New Applicant Form (shown when search yields no results) ───
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
      toast.success(`${form.first_name} ${form.last_name} added!`);
      onCreated(data as LeadResult);
    } catch (err: any) {
      toast.error(err.message || "Failed to add applicant");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground text-center py-2">No leads found</p>
      <form onSubmit={handleSubmit} className="space-y-2 border border-border rounded-lg p-3">
        <p className="text-xs font-medium text-foreground flex items-center gap-1.5">
          <Plus className="h-3.5 w-3.5 text-primary" />
          Add New Applicant
        </p>
        <div className="grid grid-cols-2 gap-2">
          <Input placeholder="First Name *" value={form.first_name} onChange={e => setForm(p => ({ ...p, first_name: e.target.value }))} required />
          <Input placeholder="Last Name *" value={form.last_name} onChange={e => setForm(p => ({ ...p, last_name: e.target.value }))} required />
        </div>
        <Input placeholder="Email *" type="email" value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} required />
        <Input placeholder="Phone" value={form.phone} onChange={e => setForm(p => ({ ...p, phone: e.target.value }))} />
        <Input placeholder="Instagram Handle" value={form.instagram_handle} onChange={e => setForm(p => ({ ...p, instagram_handle: e.target.value }))} />
        <Button type="submit" size="sm" className="w-full" disabled={saving}>
          {saving ? "Adding..." : "Add & Schedule"}
        </Button>
      </form>
    </div>
  );
}

export default function CalendarPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { playSound } = useSoundEffects();
  const [filter, setFilter] = useState<"upcoming" | "past" | "all">("upcoming");
  const [viewMode, setViewMode] = useState<"list" | "week">("list");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<LeadResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedLead, setSelectedLead] = useState<LeadResult | null>(null);
  const [schedulerOpen, setSchedulerOpen] = useState(false);
  const [autoPopulating, setAutoPopulating] = useState(false);

  const { data: interviews, isLoading } = useQuery({
    queryKey: ["calendar-interviews", user?.id],
    queryFn: async () => {
      // interview_events is the live booking truth table (Calendly-fed) — the old
      // scheduled_interviews table has been dead since May, so the calendar showed
      // 2 stale interviews and hid every real upcoming booked call. Pull the real
      // events (recent + upcoming) and map them into the InterviewRow shape.
      const { data, error } = await supabase
        .from("interview_events" as any)
        .select("id, scheduled_at, call_track, event_type_name, calendly_event_uri, notes, canceled_at, confirmed_at, outcome, application_id, invitee_name, invitee_email")
        .gte("scheduled_at", new Date(Date.now() - 60 * 86_400_000).toISOString())
        .order("scheduled_at", { ascending: true });
      if (error) throw error;
      return ((data || []) as any[]).map((r) => {
        const parts = String(r.invitee_name ?? "").trim().split(/\s+/);
        const status = r.canceled_at ? "cancelled"
          : r.outcome ? String(r.outcome)
          : r.confirmed_at ? "confirmed"
          : "scheduled";
        return {
          id: r.id,
          interview_date: r.scheduled_at,
          interview_type: r.call_track || r.event_type_name || "interview",
          meeting_link: r.calendly_event_uri ?? null,
          notes: r.notes ?? null,
          status,
          application_id: r.application_id ?? "",
          applications: {
            first_name: parts[0] || r.invitee_email || "Applicant",
            last_name: parts.slice(1).join(" "),
            email: r.invitee_email ?? "",
          },
        } as InterviewRow;
      });
    },
    enabled: !!user,
    staleTime: 60_000,
  });

  const { data: pipelineEvents } = useQuery({
    queryKey: ["calendar-pipeline-events", user?.id],
    queryFn: async (): Promise<PipelineEvent[]> => {
      const [{ data: apps }, { data: seminars }, { data: autoEvents }] = await Promise.all([
        supabase
          .from("applications")
          .select("id, first_name, last_name, email, status, next_action_at, next_action_type, test_scheduled_date, exam_scheduled_at, course_purchased_at, course_started_at, licensed_at, contracted_at, start_date")
          .is("terminated_at", null)
          .limit(750),
        supabase
          .from("seminar_registrations")
          .select("id, first_name, last_name, email, seminar_date, attended")
          .limit(500),
        supabase
          .from("calendar_events")
          .select("id, title, starts_at, metadata, status")
          .eq("source", "schedule-auto-populate")
          .in("status", ["scheduled", "reminder"])
          .gte("starts_at", new Date(Date.now() - 86_400_000).toISOString())
          .lte("starts_at", addDays(new Date(), 60).toISOString())
          .order("starts_at", { ascending: true })
          .limit(300),
      ]);

      const events: PipelineEvent[] = [];
      for (const app of (apps ?? []) as any[]) {
        const name = `${app.first_name ?? ""} ${app.last_name ?? ""}`.trim() || app.email || "Applicant";
        if (app.next_action_at) {
          events.push({
            id: `follow-${app.id}`,
            date: app.next_action_at,
            kind: "follow_up",
            title: `Follow-up: ${name}`,
            subtitle: app.next_action_type || app.status || "Next action",
          });
        }
        const testDate = app.test_scheduled_date || app.exam_scheduled_at;
        if (testDate) {
          events.push({
            id: `test-${app.id}`,
            date: testDate,
            kind: "test_date",
            title: `Test date: ${name}`,
            subtitle: app.status || "Licensing",
          });
        }
        if (app.course_purchased_at || app.course_started_at) {
          events.push({
            id: `license-${app.id}`,
            date: app.course_started_at || app.course_purchased_at,
            kind: "licensing",
            title: `Licensing: ${name}`,
            subtitle: app.course_started_at ? "Course started" : "Course purchased",
          });
        }
        if (app.contracted_at) {
          events.push({
            id: `contract-${app.id}`,
            date: app.contracted_at,
            kind: "contracting",
            title: `Contracted: ${name}`,
            subtitle: "Contracting milestone",
          });
        }
        if (app.start_date) {
          events.push({
            id: `start-${app.id}`,
            date: app.start_date,
            kind: "onboarding",
            title: `Start date: ${name}`,
            subtitle: "Onboarding",
          });
        }
      }
      for (const seminar of (seminars ?? []) as any[]) {
        if (!seminar.seminar_date) continue;
        const name = `${seminar.first_name ?? ""} ${seminar.last_name ?? ""}`.trim() || seminar.email || "Seminar registrant";
        events.push({
          id: `seminar-${seminar.id}`,
          date: seminar.seminar_date,
          kind: "seminar",
          title: `Seminar: ${name}`,
          subtitle: seminar.attended === true ? "Attended" : seminar.attended === false ? "Registered" : "Registered",
        });
      }
      for (const event of (autoEvents ?? []) as any[]) {
        if (!event.starts_at) continue;
        const meta = event.metadata && typeof event.metadata === "object" && !Array.isArray(event.metadata)
          ? event.metadata as Record<string, any>
          : {};
        const kind = meta.kind === "draft_date" ? "draft_date" : "post_test_follow_up";
        events.push({
          id: `auto-${event.id}`,
          date: event.starts_at,
          kind,
          title: event.title || (kind === "draft_date" ? "Draft check" : "Post-test follow-up"),
          subtitle: kind === "draft_date"
            ? [meta.carrier_name, meta.policy_status, meta.policy_label].filter(Boolean).join(" · ") || "Policy draft"
            : [`Day ${meta.follow_up_day ?? "?"} after test`, meta.license_progress].filter(Boolean).join(" · ") || "Post-test follow-up",
        });
      }
      return events.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()).slice(0, 120);
    },
    enabled: !!user,
    staleTime: 60_000,
  });

  const now = new Date();

  const filtered = useMemo(() => {
    if (!interviews) return [];
    return interviews.filter((iv) => {
      const date = new Date(iv.interview_date);
      if (filter === "upcoming") return !isBefore(date, now) || isToday(date);
      if (filter === "past") return isBefore(date, now) && !isToday(date);
      return true;
    });
  }, [interviews, filter]);

  const grouped = useMemo(() => {
    const groups: Record<string, InterviewRow[]> = {};
    for (const iv of filtered) {
      const date = new Date(iv.interview_date);
      const key = isToday(date) ? "Today" : format(date, "EEEE, MMM d");
      if (!groups[key]) groups[key] = [];
      groups[key].push(iv);
    }
    return groups;
  }, [filtered]);

  // Week view data
  const weekDays = useMemo(() => {
    const weekStart = startOfWeek(new Date(), { weekStartsOn: 0 });
    return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  }, []);

  const weekInterviews = useMemo(() => {
    if (!interviews) return new Map<string, InterviewRow[]>();
    const map = new Map<string, InterviewRow[]>();
    for (const iv of interviews) {
      const dateKey = format(new Date(iv.interview_date), "yyyy-MM-dd");
      if (!map.has(dateKey)) map.set(dateKey, []);
      map.get(dateKey)!.push(iv);
    }
    return map;
  }, [interviews]);


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
    } catch { setSearchResults([]); }
    finally { setSearching(false); }
  };

  const handleSelectLead = (lead: LeadResult) => {
    setSelectedLead(lead);
    setSearchOpen(false);
    setSearchQuery("");
    setSearchResults([]);
    setSchedulerOpen(true);
  };

  const handleAutoPopulate = async () => {
    setAutoPopulating(true);
    try {
      const { data, error } = await supabase.functions.invoke("schedule-auto-populate", {
        body: { lookahead_days: 45, email_managers: true },
      });
      if (error) throw error;
      const inserted = (data as any)?.inserted?.total ?? 0;
      const drafts = (data as any)?.inserted?.draft_dates ?? 0;
      const followUps = (data as any)?.inserted?.post_test_follow_ups ?? 0;
      toast.success(
        inserted > 0
          ? `Auto-filled ${inserted} schedule item${inserted === 1 ? "" : "s"} (${drafts} drafts, ${followUps} follow-ups)`
          : "Schedule auto-fill is already current"
      );
      queryClient.invalidateQueries({ queryKey: ["calendar-pipeline-events"] });
    } catch (err: any) {
      toast.error(err?.message || "Schedule auto-fill failed");
    } finally {
      setAutoPopulating(false);
    }
  };

  const handleNoShow = async (iv: InterviewRow) => {
    // iv.id is now an interview_events id — record the no-show as an outcome there.
    await supabase.from("interview_events" as any).update({ outcome: "no_show", outcome_at: new Date().toISOString() } as any).eq("id", iv.id);
    try {
      const { logLeadActivity } = await import("@/lib/logLeadActivity");
      logLeadActivity({
        leadId: iv.application_id,
        type: "interview_no_show",
        title: "Interview marked as no-show",
        details: { interview_id: iv.id },
      });
    } catch {} // empty-catch-allow:best-effort-fallback
    toast.success("Marked as no-show");
    playSound("error");
    queryClient.invalidateQueries({ queryKey: ["calendar-interviews"] });
  };

  const handleCalendarLink = (iv: InterviewRow) => {
    const name = iv.applications ? `${iv.applications.first_name} ${iv.applications.last_name}` : "Applicant";
    const url = buildCalendarUrl({
      title: `Interview: ${name} - Apex Financial`,
      startDate: new Date(iv.interview_date),
      durationMinutes: 30,
      description: `Type: ${typeLabels[iv.interview_type] || iv.interview_type}\n${iv.meeting_link ? `Link: ${iv.meeting_link}` : ""}\n${iv.notes || ""}`,
      location: iv.meeting_link || undefined,
    });
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const handleExportIcs = (iv: InterviewRow) => {
    const name = iv.applications ? `${iv.applications.first_name} ${iv.applications.last_name}` : "Applicant";
    const start = new Date(iv.interview_date);
    const end = new Date(start.getTime() + 30 * 60000);
    const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
    const icsContent = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//APEX Financial//Calendar//EN",
      "BEGIN:VEVENT",
      `DTSTART:${fmt(start)}`,
      `DTEND:${fmt(end)}`,
      `SUMMARY:Interview: ${name} - Apex Financial`,
      `DESCRIPTION:Type: ${typeLabels[iv.interview_type] || iv.interview_type}\\n${iv.notes || ""}`,
      iv.meeting_link ? `URL:${iv.meeting_link}` : "",
      "END:VEVENT",
      "END:VCALENDAR",
    ].filter(Boolean).join("\r\n");
    const blob = new Blob([icsContent], { type: "text/calendar" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `interview-${name.replace(/\s+/g, "-").toLowerCase()}.ics`;
    link.click();
    URL.revokeObjectURL(link.href);
    toast.success("Downloaded .ics file — open it to add to Apple Calendar");
  };

  const todayCount = interviews?.filter((iv) => isToday(new Date(iv.interview_date))).length || 0;
  const overdueCount = interviews?.filter((iv) => isBefore(new Date(iv.interview_date), now) && iv.status === "scheduled" && !isToday(new Date(iv.interview_date))).length || 0;
  const upcomingPipelineEvents = (pipelineEvents ?? []).filter((event) => !isBefore(new Date(event.date), now)).slice(0, 12);

  // Hero metrics
  const weekStartHero = useMemo(() => startOfWeek(new Date(), { weekStartsOn: 0 }), []);
  const weekEndHero = useMemo(() => addDays(weekStartHero, 7), [weekStartHero]);

  const weekEventCount = useMemo(() => {
    if (!interviews) return 0;
    return interviews.filter((iv) => {
      const d = new Date(iv.interview_date);
      return d >= weekStartHero && d < weekEndHero;
    }).length;
  }, [interviews, weekStartHero, weekEndHero]);

  // Open slots: count business-hour slots (9am-5pm, 30-min) today with no scheduled interview
  const openSlotsToday = useMemo(() => {
    if (!interviews) return 16;
    const todaysInterviews = interviews.filter((iv) => isToday(new Date(iv.interview_date)));
    const takenSlots = new Set<string>();
    for (const iv of todaysInterviews) {
      const d = new Date(iv.interview_date);
      const h = getHours(d);
      const m = getMinutes(d) >= 30 ? 30 : 0;
      takenSlots.add(`${h}:${m}`);
    }
    let open = 0;
    for (let h = 9; h < 17; h++) {
      for (const m of [0, 30]) {
        if (!takenSlots.has(`${h}:${m}`)) open++;
      }
    }
    return open;
  }, [interviews]);

  // Calendly sync status: derive from calendar_events presence in next 60d window
  const { data: calendlySyncStatus } = useQuery({
    queryKey: ["calendar-calendly-sync", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("calendar_events")
        .select("id, starts_at, source")
        .gte("starts_at", new Date(Date.now() - 7 * 86_400_000).toISOString())
        .order("starts_at", { ascending: false })
        .limit(1);
      if (error) return { live: false, lastSync: null as string | null };
      const last = data?.[0];
      if (!last) return { live: false, lastSync: null };
      return { live: true, lastSync: last.starts_at };
    },
    enabled: !!user,
    staleTime: 5 * 60_000,
  });

  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* Premium Header */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative overflow-hidden rounded-md border border-primary/20 bg-white dark:bg-card p-6 "
      >
        <BackgroundGlow accent="blue" intensity="subtle" />
        <div className="relative z-10 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-md bg-primary/20">
              <Calendar className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">Calendar</h1>
              <p className="text-sm text-muted-foreground mt-0.5">
                {todayCount > 0 ? `${todayCount} interview${todayCount > 1 ? "s" : ""} today` : "No interviews today"}
                {overdueCount > 0 && <span className="text-rose-400 ml-2">• {overdueCount} overdue</span>}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {todayCount > 0 && (
              <Badge variant="outline" className="text-xs bg-emerald-500/10 text-emerald-400 border-emerald-500/30">
                {todayCount} today
              </Badge>
            )}
            {overdueCount > 0 && (
              <Badge variant="outline" className="text-xs bg-rose-500/10 text-rose-400 border-rose-500/30">
                {overdueCount} overdue
              </Badge>
            )}
            <Button onClick={handleAutoPopulate} variant="outline" size="sm" disabled={autoPopulating}>
              <RefreshCw className={cn("h-4 w-4 mr-1", autoPopulating && "animate-spin")} />
              Auto-fill
            </Button>
            <Button onClick={() => setSearchOpen(true)} size="sm">
              <Plus className="h-4 w-4 mr-1" />
              Schedule
            </Button>
          </div>
        </div>
      </motion.div>

      {/* Canonical v6 §31 Premium Hero — emerald (production/calendar) */}
      <div className="relative overflow-hidden rounded-3xl border border-emerald-500/25 bg-gradient-to-br from-slate-950 via-slate-900 to-emerald-950 text-white shadow-[0_0_48px_-12px_hsl(168_70%_45%/0.25)]">
        <div className="absolute -top-24 -right-24 h-72 w-72 rounded-full bg-emerald-500/15 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-32 -left-24 h-80 w-80 rounded-full bg-emerald-500/10 blur-3xl pointer-events-none" />
        <div className="relative p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2.5">
              <span className="relative flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
              </span>
              <p className="text-[11px] uppercase tracking-[0.32em] font-bold text-emerald-300">CALENDAR FLOW · LIVE</p>
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <p className="text-[10px] uppercase tracking-widest text-white/40 mb-1">TODAY</p>
              <p className="text-[28px] leading-none font-black tabular-nums text-white">{todayCount}</p>
              <p className="text-[10px] text-white/40 tabular-nums">{todayCount === 1 ? "interview" : "interviews"}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-widest text-white/40 mb-1">THIS WEEK</p>
              <p className="text-[28px] leading-none font-black tabular-nums text-white">{weekEventCount}</p>
              <p className="text-[10px] text-white/40 tabular-nums">scheduled</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-widest text-white/40 mb-1">OPEN SLOTS</p>
              <p className="text-[28px] leading-none font-black tabular-nums text-white">{openSlotsToday}</p>
              <p className="text-[10px] text-white/40 tabular-nums">today · 9a–5p</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-widest text-white/40 mb-1">CALENDLY SYNC</p>
              <p className={cn(
                "text-[28px] leading-none font-black tabular-nums",
                calendlySyncStatus?.live ? "text-emerald-300" : "text-white/60"
              )}>
                {calendlySyncStatus?.live ? "LIVE" : "—"}
              </p>
              <p className="text-[10px] text-white/40 tabular-nums">
                {calendlySyncStatus?.lastSync
                  ? `last ${format(new Date(calendlySyncStatus.lastSync), "MMM d")}`
                  : "feed quiet — push to sync"}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* View Toggle + Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as any)}>
          <TabsList>
            <TabsTrigger value="list">List</TabsTrigger>
            <TabsTrigger value="week">Week</TabsTrigger>
          </TabsList>
        </Tabs>
        {viewMode === "list" && (
          <Tabs value={filter} onValueChange={(v) => setFilter(v as any)}>
            <TabsList>
              <TabsTrigger value="upcoming">Upcoming</TabsTrigger>
              <TabsTrigger value="past">Past</TabsTrigger>
              <TabsTrigger value="all">All</TabsTrigger>
            </TabsList>
          </Tabs>
        )}
      </div>

      <Card>
        <CardContent className="p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <p className="font-semibold">Pipeline Dates</p>
              <p className="text-xs text-muted-foreground">Follow-ups, test dates, seminar schedules, policy draft checks, licensing, contracting, and onboarding events.</p>
            </div>
            <Badge variant="outline" className="text-[10px]">{upcomingPipelineEvents.length} upcoming</Badge>
          </div>
          {upcomingPipelineEvents.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Pipeline calendar is open — book test dates, follow-ups and licensing checks so nothing slips.</p>
          ) : (
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              {upcomingPipelineEvents.map((event) => (
                <div key={event.id} className="rounded-lg border border-border/70 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm font-medium">{event.title}</p>
                    <Badge variant="secondary" className="text-[10px] capitalize">{event.kind.replace(/_/g, " ")}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{format(new Date(event.date), "EEE, MMM d")} · {event.subtitle}</p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Week View */}
      {viewMode === "week" ? (
        <div className="border border-border rounded-md overflow-hidden">
          <div className="grid grid-cols-7 border-b border-border bg-muted/50">
            {weekDays.map((day) => (
              <div
                key={day.toISOString()}
                className={cn(
                  "px-2 py-2.5 text-center text-xs font-medium",
                  isToday(day) && "bg-primary/10 text-primary font-bold"
                )}
              >
                <div>{format(day, "EEE")}</div>
                <div className="text-lg font-bold">{format(day, "d")}</div>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 min-h-[400px]">
            {weekDays.map((day) => {
              const dateKey = format(day, "yyyy-MM-dd");
              const dayInterviews = weekInterviews.get(dateKey) || [];
              return (
                <div
                  key={dateKey}
                  className={cn(
                    "border-r border-border last:border-r-0 p-1.5 space-y-1",
                    isToday(day) && "bg-primary/5"
                  )}
                >
                  {dayInterviews.map((iv) => {
                    const date = new Date(iv.interview_date);
                    const TypeIcon = typeIcons[iv.interview_type] || Calendar;
                    const name = iv.applications
                      ? `${iv.applications.first_name} ${iv.applications.last_name}`
                      : "—";
                    return (
                      <div
                        key={iv.id}
                        className={cn(
                          "rounded-md px-1.5 py-1 text-[10px] border cursor-default",
                          iv.status === "completed" && "bg-emerald-500/10 border-emerald-500/30",
                          iv.status === "no_show" && "bg-amber-500/10 border-amber-500/30 opacity-70",
                          iv.status === "scheduled" && "bg-primary/10 border-primary/30"
                        )}
                      >
                        <div className="flex items-center gap-1">
                          <TypeIcon className="h-3 w-3 shrink-0 text-muted-foreground" />
                          <span className="font-medium truncate">{format(date, "h:mm a")}</span>
                        </div>
                        <p className="truncate text-muted-foreground">{name}</p>
                      </div>
                    );
                  })}
                  {dayInterviews.length === 0 && (
                    <div className="h-full flex items-center justify-center text-[10px] text-muted-foreground opacity-50">—</div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <>
          {/* Interview List */}
          {isLoading ? (
            <div className="space-y-3">
              {/* stable-key-allow:skeleton */}
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-20 w-full rounded-md" />)}
            </div>
          ) : Object.keys(grouped).length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <Calendar className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
                <p className="text-muted-foreground">Calendar's clear — every booked interview is a hire in motion. Schedule the next one.</p>
                <Button variant="outline" size="sm" className="mt-3" onClick={() => setSearchOpen(true)}>
                  Schedule one now
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-6">
              {Object.entries(grouped).map(([dateLabel, items]) => (
                <div key={dateLabel}>
                  <h3 className="text-sm font-semibold text-muted-foreground mb-2 flex items-center gap-2">
                    <Clock className="h-3.5 w-3.5" />
                    {dateLabel}
                  </h3>
                  <div className="space-y-2">
                    {items.map((iv) => {
                      const date = new Date(iv.interview_date);
                      const isPast = isBefore(date, now) && !isToday(date);
                      const isOverdue = isPast && iv.status === "scheduled";
                      const TypeIcon = typeIcons[iv.interview_type] || Calendar;
                      const name = iv.applications
                        ? `${iv.applications.first_name} ${iv.applications.last_name}`
                        : "—";

                      return (
                        <Card
                          key={iv.id}
                          className={cn(
                            "transition-all hover:shadow-md",
                            isOverdue && "border-rose-500/30 bg-rose-500/5",
                            iv.status === "completed" && "border-emerald-500/30 bg-emerald-500/5",
                            iv.status === "no_show" && "border-amber-500/30 bg-amber-500/5 opacity-70"
                          )}
                        >
                          <CardContent className="p-4 flex items-center gap-4">
                            <div className={cn(
                              "p-2 rounded-lg shrink-0",
                              iv.interview_type === "video" && "bg-info/10 text-info",
                              iv.interview_type === "phone" && "bg-emerald-500/10 text-emerald-400",
                              iv.interview_type === "in_person" && "bg-violet-500/10 text-violet-400",
                            )}>
                              <TypeIcon className="h-5 w-5" />
                            </div>

                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="font-medium truncate">{name}</span>
                                {iv.status === "completed" && (
                                  <Badge variant="outline" className="text-[10px] bg-emerald-500/10 text-emerald-400 border-emerald-500/30">
                                    <CheckCircle2 className="h-2.5 w-2.5 mr-0.5" /> Done
                                  </Badge>
                                )}
                                {iv.status === "no_show" && (
                                  <Badge variant="outline" className="text-[10px] bg-amber-500/10 text-amber-400 border-amber-500/30">
                                    No-Show
                                  </Badge>
                                )}
                                {isOverdue && (
                                  <Badge variant="outline" className="text-[10px] bg-rose-500/10 text-rose-400 border-rose-500/30">
                                    <AlertTriangle className="h-2.5 w-2.5 mr-0.5" /> Overdue
                                  </Badge>
                                )}
                              </div>
                              <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                                <span>{format(date, "h:mm a")}</span>
                                <span>{typeLabels[iv.interview_type] || iv.interview_type}</span>
                                {iv.notes && <span className="truncate max-w-[150px]">{iv.notes}</span>}
                              </div>
                            </div>

                            <div className="flex items-center gap-1.5 shrink-0">
                              {iv.meeting_link && (
                                <Button variant="ghost" size="icon" aria-label="Open meeting link" title="Open meeting link" className="h-8 w-8" onClick={() => window.open(iv.meeting_link!, "_blank", "noopener,noreferrer")}>
                                  <ExternalLink className="h-3.5 w-3.5" />
                                </Button>
                              )}
                              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleCalendarLink(iv)} title="Add to Google Calendar">
                                <CalendarPlus className="h-3.5 w-3.5" />
                              </Button>
                              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleExportIcs(iv)} title="Download .ics (Apple Calendar)">
                                <Download className="h-3.5 w-3.5" />
                              </Button>
                              {isOverdue && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  aria-label="Mark as no-show"
                                  className="h-8 w-8 text-rose-400 hover:text-rose-300 hover:bg-rose-500/10"
                                  onClick={() => handleNoShow(iv)}
                                >
                                  <AlertTriangle className="h-3.5 w-3.5" />
                                </Button>
                              )}
                            </div>
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Lead Search Dialog */}
      <Dialog open={searchOpen} onOpenChange={setSearchOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Search className="h-4 w-4 text-primary" />
              Find Lead to Schedule
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              placeholder="Search by name, email, or phone..."
              value={searchQuery}
              onChange={(e) => handleSearch(e.target.value)}
              autoFocus
            />
            {searching && <p className="text-xs text-muted-foreground">Searching...</p>}
            {searchResults.length > 0 && (
              <div className="space-y-1 max-h-64 overflow-y-auto">
                {searchResults.map((lead) => (
                  <button
                    key={lead.id}
                    onClick={() => handleSelectLead(lead)}
                    className="w-full flex items-center gap-3 p-3 rounded-lg border border-border hover:bg-muted/50 transition-colors text-left"
                  >
                    <div className="p-1.5 rounded-full bg-primary/10">
                      <User className="h-3.5 w-3.5 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{lead.first_name} {lead.last_name}</p>
                      <p className="text-xs text-muted-foreground truncate">{lead.email}</p>
                    </div>
                    <Badge variant="outline" className="text-[10px] shrink-0">{lead.status}</Badge>
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

      {/* Scheduler dialog with selected lead */}
      {schedulerOpen && selectedLead && (
        <InterviewScheduler
          open={schedulerOpen}
          onOpenChange={(open) => {
            setSchedulerOpen(open);
            if (!open) setSelectedLead(null);
          }}
          applicationId={selectedLead.id}
          applicantName={`${selectedLead.first_name} ${selectedLead.last_name}`}
          applicantEmail={selectedLead.email}
          onScheduled={() => {
            queryClient.invalidateQueries({ queryKey: ["calendar-interviews"] });
            setSchedulerOpen(false);
            setSelectedLead(null);
          }}
        />
      )}
    </div>
  );
}
