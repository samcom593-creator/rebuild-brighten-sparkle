import { useState, useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Search, Phone, Mail, MapPin, Clock, Activity, MessageSquare,
  FileText, User, Star, Filter, X,
} from "lucide-react";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { logLeadActivity } from "@/lib/logLeadActivity";
import { cn } from "@/lib/utils";
import { formatDistanceToNow, format } from "date-fns";
import { toast } from "sonner";

interface Lead {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  city: string | null;
  state: string | null;
  created_at: string;
  last_contacted_at: string | null;
  contacted_at: string | null;
  license_status: string;
  license_progress: string | null;
  test_scheduled_date: string | null;
  notes: string | null;
  assigned_agent_id: string | null;
  referral_source: string | null;
}

interface LeadDetailSheetProps {
  lead: Lead | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRefresh: () => void;
}

const ACTIVITY_TYPE_ICONS: Record<string, React.ElementType> = {
  call_connected: Phone,
  call_no_answer: Phone,
  call_voicemail: Phone,
  call_wrong_number: Phone,
  email_sent: Mail,
  note_added: MessageSquare,
  stage_changed: Activity,
  calendly_link_sent: FileText,
  interview_scheduled: Clock,
  followup_completed: Clock,
  suggestion_applied: Star,
};

const ACTIVITY_TYPE_COLORS: Record<string, string> = {
  call_connected: "text-emerald-400",
  call_no_answer: "text-muted-foreground",
  call_voicemail: "text-amber-400",
  call_wrong_number: "text-rose-400",
  email_sent: "text-blue-400",
  note_added: "text-purple-400",
  stage_changed: "text-pink-400",
  calendly_link_sent: "text-pink-400",
  interview_scheduled: "text-blue-400",
  followup_completed: "text-emerald-400",
  suggestion_applied: "text-amber-400",
};

const FILTER_OPTIONS = [
  { value: "all", label: "All" },
  { value: "call", label: "Calls" },
  { value: "email", label: "Emails" },
  { value: "note", label: "Notes" },
  { value: "stage", label: "Stage Changes" },
];

export function LeadDetailSheet({ lead, open, onOpenChange, onRefresh }: LeadDetailSheetProps) {
  const [noteText, setNoteText] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const [timelineSearch, setTimelineSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");

  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState({
    first_name: "", last_name: "", email: "", phone: "",
    city: "", state: "", referral_source: "", license_progress: "", test_scheduled_date: "",
  });
  const [savingEdit, setSavingEdit] = useState(false);

  // Reset note text and edit form when lead changes
  useEffect(() => {
    if (lead) {
      setNoteText(lead.notes || "");
      setEditForm({
        first_name: lead.first_name || "",
        last_name: lead.last_name || "",
        email: lead.email || "",
        phone: lead.phone || "",
        city: lead.city || "",
        state: lead.state || "",
        referral_source: lead.referral_source || "",
        license_progress: lead.license_progress || "unlicensed",
        test_scheduled_date: lead.test_scheduled_date || "",
      });
      setIsEditing(false);
    }
  }, [lead?.id]);

  // Fetch full activity timeline
  const { data: activities, refetch: refetchActivities } = useQuery({
    queryKey: ["lead-detail-timeline", lead?.id],
    queryFn: async () => {
      if (!lead) return [];
      const { data } = await supabase
        .from("lead_activity")
        .select("*")
        .eq("lead_id", lead.id)
        .order("created_at", { ascending: false });
      return data || [];
    },
    enabled: !!lead && open,
    staleTime: 30_000,
  });

  const filteredActivities = useMemo(() => {
    if (!activities) return [];
    return activities.filter((a) => {
      // Type filter
      if (typeFilter === "call" && !a.activity_type.startsWith("call_")) return false;
      if (typeFilter === "email" && a.activity_type !== "email_sent") return false;
      if (typeFilter === "note" && a.activity_type !== "note_added") return false;
      if (typeFilter === "stage" && a.activity_type !== "stage_changed") return false;
      // Search
      if (timelineSearch) {
        const q = timelineSearch.toLowerCase();
        return (
          a.title.toLowerCase().includes(q) ||
          a.activity_type.toLowerCase().includes(q) ||
          (a.actor_name && a.actor_name.toLowerCase().includes(q))
        );
      }
      return true;
    });
  }, [activities, typeFilter, timelineSearch]);

  const handleSaveNote = async () => {
    if (!lead || !noteText.trim()) return;
    setSavingNote(true);
    try {
      await supabase
        .from("applications")
        .update({ notes: noteText })
        .eq("id", lead.id);
      logLeadActivity({
        leadId: lead.id,
        type: "note_added",
        title: "Note updated",
        details: { note_preview: noteText.slice(0, 140) },
      });
      toast.success("Note saved!");
      refetchActivities();
      onRefresh();
    } catch {
      toast.error("Failed to save note");
    } finally {
      setSavingNote(false);
    }
  };

  const handleSaveEdit = async () => {
    if (!lead) return;
    setSavingEdit(true);
    try {
      const { error } = await supabase
        .from("applications")
        .update({
          first_name: editForm.first_name,
          last_name: editForm.last_name,
          email: editForm.email,
          phone: editForm.phone || null,
          city: editForm.city || null,
          state: editForm.state || null,
          referral_source: editForm.referral_source || null,
          license_progress: (editForm.license_progress || null) as any,
          test_scheduled_date: editForm.test_scheduled_date || null,
        })
        .eq("id", lead.id);
      if (error) throw error;
      logLeadActivity({
        leadId: lead.id,
        type: "note_added",
        title: "Lead info updated",
        details: { fields_updated: Object.keys(editForm) },
      });
      toast.success("Lead info saved!");
      setIsEditing(false);
      onRefresh();
    } catch {
      toast.error("Failed to save changes");
    } finally {
      setSavingEdit(false);
    }
  };

  if (!lead) return null;

  const fullName = `${lead.first_name} ${lead.last_name}`.trim();
  const location = [lead.city, lead.state].filter(Boolean).join(", ");
  const lastContact = lead.last_contacted_at || lead.contacted_at;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[380px] sm:w-[440px] p-0 flex flex-col">
        <SheetHeader className="p-4 pb-2 border-b border-border/50">
          <SheetTitle className="text-lg">{fullName}</SheetTitle>
          <SheetDescription className="flex flex-wrap gap-2 items-center">
            {location && (
              <span className="inline-flex items-center gap-1 text-xs">
                <MapPin className="h-3 w-3" /> {location}
              </span>
            )}
            <Badge variant="outline" className="text-[10px]">
              {lead.license_progress || "unlicensed"}
            </Badge>
          </SheetDescription>
          {/* Quick contact row */}
          <div className="flex gap-2 pt-1">
            {lead.phone && (
              <a href={`tel:${lead.phone}`} className="text-xs text-emerald-400 hover:underline flex items-center gap-1">
                <Phone className="h-3 w-3" /> {lead.phone}
              </a>
            )}
            {lead.email && (
              <a href={`mailto:${lead.email}`} className="text-xs text-blue-400 hover:underline flex items-center gap-1">
                <Mail className="h-3 w-3" /> {lead.email}
              </a>
            )}
          </div>
        </SheetHeader>

        <Tabs defaultValue="timeline" className="flex-1 flex flex-col min-h-0">
          <TabsList className="mx-4 mt-2 grid grid-cols-3">
            <TabsTrigger value="timeline" className="text-xs gap-1">
              <Activity className="h-3 w-3" /> Timeline
            </TabsTrigger>
            <TabsTrigger value="notes" className="text-xs gap-1">
              <MessageSquare className="h-3 w-3" /> Notes
            </TabsTrigger>
            <TabsTrigger value="info" className="text-xs gap-1">
              <User className="h-3 w-3" /> Info
            </TabsTrigger>
          </TabsList>

          {/* Timeline Tab */}
          <TabsContent value="timeline" className="flex-1 flex flex-col min-h-0 px-4 pb-4">
            {/* Search + filter */}
            <div className="flex gap-2 mb-2">
              <div className="relative flex-1">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                <Input
                  placeholder="Search activity…"
                  value={timelineSearch}
                  onChange={(e) => setTimelineSearch(e.target.value)}
                  className="pl-7 h-7 text-xs"
                />
              </div>
              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                className="h-7 text-xs rounded-md border border-input bg-background px-2 text-foreground"
              >
                {FILTER_OPTIONS.map((f) => (
                  <option key={f.value} value={f.value}>{f.label}</option>
                ))}
              </select>
            </div>

            <ScrollArea className="flex-1">
              <div className="space-y-2">
                {filteredActivities.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-8">No activity found</p>
                ) : (
                  filteredActivities.map((a) => {
                    const Icon = ACTIVITY_TYPE_ICONS[a.activity_type] || Activity;
                    const color = ACTIVITY_TYPE_COLORS[a.activity_type] || "text-muted-foreground";
                    return (
                      <div key={a.id} className="flex gap-2 items-start">
                        <div className={cn("mt-0.5 shrink-0", color)}>
                          <Icon className="h-3.5 w-3.5" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium leading-tight">{a.title}</p>
                          <div className="flex items-center gap-2 mt-0.5">
                            {a.actor_name && (
                              <span className="text-[10px] text-muted-foreground">{a.actor_name}</span>
                            )}
                            <span className="text-[10px] text-muted-foreground">
                              {formatDistanceToNow(new Date(a.created_at), { addSuffix: true })}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </ScrollArea>
          </TabsContent>

          {/* Notes Tab */}
          <TabsContent value="notes" className="flex-1 flex flex-col px-4 pb-4">
            <Textarea
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              placeholder="Add notes about this lead…"
              className="flex-1 min-h-[120px] text-xs resize-none"
            />
            <Button
              size="sm"
              onClick={handleSaveNote}
              disabled={savingNote}
              className="mt-2 text-xs"
            >
              {savingNote ? "Saving…" : "Save Note"}
            </Button>
          </TabsContent>

          {/* Info Tab */}
          <TabsContent value="info" className="flex-1 flex flex-col px-4 pb-4">
            <div className="flex justify-end mb-2">
              {!isEditing ? (
                <Button variant="outline" size="sm" className="text-xs" onClick={() => setIsEditing(true)}>
                  Edit
                </Button>
              ) : (
                <Button variant="ghost" size="sm" className="text-xs" onClick={() => {
                  setIsEditing(false);
                  if (lead) setEditForm({
                    first_name: lead.first_name || "", last_name: lead.last_name || "",
                    email: lead.email || "", phone: lead.phone || "",
                    city: lead.city || "", state: lead.state || "",
                    referral_source: lead.referral_source || "",
                    license_progress: lead.license_progress || "unlicensed",
                    test_scheduled_date: lead.test_scheduled_date || "",
                  });
                }}>
                  Cancel
                </Button>
              )}
            </div>

            <div className="space-y-3 text-xs flex-1">
              {isEditing ? (
                <>
                  <EditRow label="First Name" value={editForm.first_name} onChange={(v) => setEditForm({ ...editForm, first_name: v })} />
                  <EditRow label="Last Name" value={editForm.last_name} onChange={(v) => setEditForm({ ...editForm, last_name: v })} />
                  <EditRow label="Email" value={editForm.email} onChange={(v) => setEditForm({ ...editForm, email: v })} />
                  <EditRow label="Phone" value={editForm.phone} onChange={(v) => setEditForm({ ...editForm, phone: v })} />
                  <EditRow label="City" value={editForm.city} onChange={(v) => setEditForm({ ...editForm, city: v })} />
                  <EditRow label="State" value={editForm.state} onChange={(v) => setEditForm({ ...editForm, state: v })} />
                  <EditRow label="Referral Source" value={editForm.referral_source} onChange={(v) => setEditForm({ ...editForm, referral_source: v })} />
                  <div className="flex justify-between items-center py-1.5 border-b border-border/30">
                    <span className="text-muted-foreground">License Progress</span>
                    <select
                      value={editForm.license_progress}
                      onChange={(e) => setEditForm({ ...editForm, license_progress: e.target.value })}
                      className="h-7 text-xs rounded-md border border-input bg-background px-2 text-foreground max-w-[180px]"
                    >
                      {["unlicensed","course_purchased","finished_course","test_scheduled","passed_test","fingerprints_done","waiting_on_license","licensed"].map((v) => (
                        <option key={v} value={v}>{v.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())}</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex justify-between items-center py-1.5 border-b border-border/30">
                    <span className="text-muted-foreground">Test Scheduled</span>
                    <input
                      type="date"
                      value={editForm.test_scheduled_date}
                      onChange={(e) => setEditForm({ ...editForm, test_scheduled_date: e.target.value })}
                      className="h-7 text-xs rounded-md border border-input bg-background px-2 text-foreground"
                    />
                  </div>
                </>
              ) : (
                <>
                  <InfoRow label="Name" value={fullName} />
                  <InfoRow label="Email" value={lead.email} />
                  <InfoRow label="Phone" value={lead.phone} />
                  <InfoRow label="Location" value={location || "—"} />
                  <InfoRow label="License Status" value={lead.license_status} />
                  <InfoRow label="License Progress" value={lead.license_progress || "unlicensed"} />
                  <InfoRow label="Referral Source" value={lead.referral_source || "—"} />
                  <InfoRow label="Created" value={format(new Date(lead.created_at), "PPP")} />
                  <InfoRow
                    label="Last Contacted"
                    value={lastContact ? formatDistanceToNow(new Date(lastContact), { addSuffix: true }) : "Never"}
                  />
                  {lead.test_scheduled_date && (
                    <InfoRow label="Test Scheduled" value={format(new Date(lead.test_scheduled_date), "PPP")} />
                  )}
                </>
              )}
            </div>

            {isEditing && (
              <Button size="sm" onClick={handleSaveEdit} disabled={savingEdit} className="mt-3 text-xs w-full">
                {savingEdit ? "Saving…" : "Save Changes"}
              </Button>
            )}
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-center py-1.5 border-b border-border/30">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-right max-w-[200px] truncate">{value}</span>
    </div>
  );
}

function EditRow({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex justify-between items-center py-1.5 border-b border-border/30">
      <span className="text-muted-foreground">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-7 text-xs rounded-md border border-input bg-background px-2 text-foreground max-w-[180px] w-full text-right"
      />
    </div>
  );
}
