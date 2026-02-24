import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format, isToday, isBefore } from "date-fns";
import {
  Calendar, Video, Phone, MapPin, Clock, Plus,
  AlertTriangle, CheckCircle2, CalendarPlus, ExternalLink, Search, User,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { InterviewScheduler } from "@/components/dashboard/InterviewScheduler";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

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
  const [filter, setFilter] = useState<"upcoming" | "past" | "all">("upcoming");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<LeadResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedLead, setSelectedLead] = useState<LeadResult | null>(null);
  const [schedulerOpen, setSchedulerOpen] = useState(false);

  const { data: interviews, isLoading } = useQuery({
    queryKey: ["calendar-interviews", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("scheduled_interviews")
        .select("id, interview_date, interview_type, meeting_link, notes, status, application_id, applications!inner(first_name, last_name, email)")
        .order("interview_date", { ascending: true });
      if (error) throw error;
      return (data || []) as unknown as InterviewRow[];
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

  const handleNoShow = async (iv: InterviewRow) => {
    await supabase.from("scheduled_interviews").update({ status: "no_show" }).eq("id", iv.id);
    try {
      const { logLeadActivity } = await import("@/lib/logLeadActivity");
      logLeadActivity({
        leadId: iv.application_id,
        type: "interview_no_show",
        title: "Interview marked as no-show",
        details: { interview_id: iv.id },
      });
    } catch {}
    toast.success("Marked as no-show");
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
    window.open(url, "_blank");
  };

  const todayCount = interviews?.filter((iv) => isToday(new Date(iv.interview_date))).length || 0;
  const overdueCount = interviews?.filter((iv) => isBefore(new Date(iv.interview_date), now) && iv.status === "scheduled" && !isToday(new Date(iv.interview_date))).length || 0;

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Calendar className="h-6 w-6 text-primary" />
            Calendar
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {todayCount > 0 ? `${todayCount} interview${todayCount > 1 ? "s" : ""} today` : "No interviews today"}
            {overdueCount > 0 && <span className="text-rose-400 ml-2">• {overdueCount} overdue</span>}
          </p>
        </div>
        <Button onClick={() => setSearchOpen(true)} size="sm">
          <Plus className="h-4 w-4 mr-1" />
          Schedule
        </Button>
      </div>

      {/* Filters */}
      <Tabs value={filter} onValueChange={(v) => setFilter(v as any)}>
        <TabsList>
          <TabsTrigger value="upcoming">Upcoming</TabsTrigger>
          <TabsTrigger value="past">Past</TabsTrigger>
          <TabsTrigger value="all">All</TabsTrigger>
        </TabsList>
      </Tabs>

      {/* Interview List */}
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-20 w-full rounded-xl" />)}
        </div>
      ) : Object.keys(grouped).length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Calendar className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground">No interviews found</p>
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
                    : "Unknown";

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
                          iv.interview_type === "video" && "bg-blue-500/10 text-blue-400",
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
                            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => window.open(iv.meeting_link!, "_blank")}>
                              <ExternalLink className="h-3.5 w-3.5" />
                            </Button>
                          )}
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleCalendarLink(iv)}>
                            <CalendarPlus className="h-3.5 w-3.5" />
                          </Button>
                          {isOverdue && (
                            <Button
                              variant="ghost"
                              size="icon"
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
