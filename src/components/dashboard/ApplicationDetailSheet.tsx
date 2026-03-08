import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  Phone, Mail, Instagram, MapPin, FileText,
  Building2, GraduationCap, Calendar, CheckCircle, Pencil, X, Loader2,
  KeyRound, Send, RefreshCw, UserPlus,
} from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { logLeadActivity } from "@/lib/logLeadActivity";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";

interface ApplicationDetailSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  applicationId?: string;
  agentId?: string;
  onRefresh?: () => void;
}

const LICENSE_PROGRESS_LABELS: Record<string, string> = {
  unlicensed: "Unlicensed",
  course_purchased: "Course Purchased",
  finished_course: "Finished Course",
  test_scheduled: "Test Scheduled",
  passed_test: "Passed Test",
  fingerprints_done: "Fingerprints Done",
  waiting_on_license: "Waiting on License",
  licensed: "Licensed",
};

const LICENSE_PROGRESS_OPTIONS = Object.entries(LICENSE_PROGRESS_LABELS);

interface EditForm {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  city: string;
  state: string;
  instagram_handle: string;
  referral_source: string;
  license_progress: string;
  test_scheduled_date: string;
  notes: string;
  carrier: string;
  nipr_number: string;
}

function initForm(app: any): EditForm {
  return {
    first_name: app?.first_name || "",
    last_name: app?.last_name || "",
    email: app?.email || "",
    phone: app?.phone || "",
    city: app?.city || "",
    state: app?.state || "",
    instagram_handle: app?.instagram_handle || "",
    referral_source: app?.referral_source || "",
    license_progress: app?.license_progress || "unlicensed",
    test_scheduled_date: app?.test_scheduled_date || "",
    notes: app?.notes || "",
    carrier: app?.carrier || "",
    nipr_number: app?.nipr_number || "",
  };
}

export function ApplicationDetailSheet({
  open,
  onOpenChange,
  applicationId,
  agentId,
  onRefresh,
}: ApplicationDetailSheetProps) {
  const { isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const [isEditing, setIsEditing] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editForm, setEditForm] = useState<EditForm>(initForm(null));

  // Account management state
  const [acctNewEmail, setAcctNewEmail] = useState("");
  const [acctNewPassword, setAcctNewPassword] = useState("");
  const [acctUpdatingEmail, setAcctUpdatingEmail] = useState(false);
  const [acctResettingPw, setAcctResettingPw] = useState(false);
  const [acctSendingLogin, setAcctSendingLogin] = useState(false);
  const [acctSendingToMgr, setAcctSendingToMgr] = useState(false);

  const { data: application, isLoading } = useQuery({
    queryKey: ["application-detail", applicationId, agentId],
    queryFn: async () => {
      let query = supabase.from("applications").select("*");
      if (applicationId) query = query.eq("id", applicationId);
      else if (agentId) query = query.eq("assigned_agent_id", agentId);
      const { data } = await query.order("created_at", { ascending: false }).limit(1).maybeSingle();
      return data;
    },
    enabled: open && !!(applicationId || agentId),
    staleTime: 30_000,
  });

  const app = application;

  useEffect(() => {
    if (app) {
      setEditForm(initForm(app));
      setIsEditing(false);
    }
  }, [app]);

  const handleCancel = () => {
    setEditForm(initForm(app));
    setIsEditing(false);
  };

  const handleSave = async () => {
    if (!app) return;
    setSavingEdit(true);
    const { error } = await supabase
      .from("applications")
      .update({
        first_name: editForm.first_name.trim(),
        last_name: editForm.last_name.trim(),
        email: editForm.email.trim(),
        phone: editForm.phone.trim() || null,
        city: editForm.city.trim() || null,
        state: editForm.state.trim() || null,
        instagram_handle: editForm.instagram_handle.trim() || null,
        referral_source: editForm.referral_source.trim() || null,
        license_progress: (editForm.license_progress || null) as any,
        test_scheduled_date: editForm.test_scheduled_date || null,
        notes: editForm.notes.trim() || null,
        carrier: editForm.carrier.trim() || null,
        nipr_number: editForm.nipr_number.trim() || null,
      })
      .eq("id", app.id);

    if (error) {
      toast({ title: "Error saving", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Lead info updated" });
      logLeadActivity({ leadId: app.id, type: "note_added", title: "Lead info updated" });
      queryClient.invalidateQueries({ queryKey: ["application-detail", applicationId, agentId] });
      onRefresh?.();
      setIsEditing(false);
    }
    setSavingEdit(false);
  };

  const setField = (key: keyof EditForm, value: string) =>
    setEditForm((prev) => ({ ...prev, [key]: value }));

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-lg p-0">
        <SheetHeader className="p-6 pb-4 flex flex-row items-center justify-between gap-2">
          <SheetTitle className="text-lg">
            {isLoading ? "Loading…" : app ? `${app.first_name} ${app.last_name}` : "Application Not Found"}
          </SheetTitle>
          {app && !isLoading && (
            <Button
              variant={isEditing ? "ghost" : "outline"}
              size="sm"
              onClick={isEditing ? handleCancel : () => setIsEditing(true)}
              className="shrink-0"
            >
              {isEditing ? (
                <><X className="h-3.5 w-3.5 mr-1" /> Cancel</>
              ) : (
                <><Pencil className="h-3.5 w-3.5 mr-1" /> Edit</>
              )}
            </Button>
          )}
        </SheetHeader>

        {isLoading ? (
          <div className="p-6 space-y-3">
            {[1, 2, 3].map(i => <div key={i} className="h-6 bg-muted rounded animate-pulse" />)}
          </div>
        ) : !app ? (
          <div className="p-6 text-sm text-muted-foreground">No application found for this record.</div>
        ) : (
          <ScrollArea className="h-[calc(100vh-100px)]">
            <div className="p-6 pt-0 space-y-5">
              {/* Status Badges */}
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline" className={cn(
                  "text-xs",
                  app.license_status === "licensed"
                    ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                    : "bg-amber-500/10 text-amber-400 border-amber-500/30"
                )}>
                  {app.license_status === "licensed" ? "Licensed" : "Unlicensed"}
                </Badge>
                {app.license_progress && (
                  <Badge variant="outline" className="text-xs bg-primary/10 text-primary border-primary/30">
                    {LICENSE_PROGRESS_LABELS[app.license_progress] || app.license_progress}
                  </Badge>
                )}
                <Badge variant="outline" className="text-xs">{app.status}</Badge>
                {app.started_training && (
                  <Badge variant="outline" className="text-xs bg-blue-500/10 text-blue-400 border-blue-500/30">
                    <GraduationCap className="h-3 w-3 mr-1" /> In Training
                  </Badge>
                )}
              </div>

              <Separator />

              {/* Contact Info */}
              <div className="space-y-2.5">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Contact</h4>
                {isEditing ? (
                  <div className="space-y-2">
                    <EditRow label="First Name" value={editForm.first_name} onChange={(v) => setField("first_name", v)} />
                    <EditRow label="Last Name" value={editForm.last_name} onChange={(v) => setField("last_name", v)} />
                    <EditRow label="Email" value={editForm.email} onChange={(v) => setField("email", v)} type="email" />
                    <EditRow label="Phone" value={editForm.phone} onChange={(v) => setField("phone", v)} type="tel" />
                    <EditRow label="Instagram" value={editForm.instagram_handle} onChange={(v) => setField("instagram_handle", v)} />
                    <EditRow label="City" value={editForm.city} onChange={(v) => setField("city", v)} />
                    <EditRow label="State" value={editForm.state} onChange={(v) => setField("state", v)} />
                  </div>
                ) : (
                  <div className="space-y-2">
                    <a href={`mailto:${app.email}`} className="flex items-center gap-3 text-sm hover:text-primary transition-colors">
                      <Mail className="h-4 w-4 text-muted-foreground" />{app.email}
                    </a>
                    {app.phone && (
                      <a href={`tel:${app.phone}`} className="flex items-center gap-3 text-sm hover:text-primary transition-colors">
                        <Phone className="h-4 w-4 text-muted-foreground" />{app.phone}
                      </a>
                    )}
                    {app.instagram_handle && (
                      <a href={`https://instagram.com/${app.instagram_handle.replace("@", "")}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 text-sm hover:text-primary transition-colors">
                        <Instagram className="h-4 w-4 text-pink-400" />@{app.instagram_handle.replace("@", "")}
                      </a>
                    )}
                    {(app.city || app.state) && (
                      <div className="flex items-center gap-3 text-sm text-muted-foreground">
                        <MapPin className="h-4 w-4" />{[app.city, app.state].filter(Boolean).join(", ")}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <Separator />

              {/* License Progress & Test Date (editable) */}
              {isEditing && (
                <>
                  <div className="space-y-2.5">
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">License</h4>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm text-muted-foreground w-28 shrink-0">Progress</span>
                        <select
                          className="flex-1 h-9 rounded-md border border-input bg-background px-2 text-sm"
                          value={editForm.license_progress}
                          onChange={(e) => setField("license_progress", e.target.value)}
                        >
                          {LICENSE_PROGRESS_OPTIONS.map(([val, label]) => (
                            <option key={val} value={val}>{label}</option>
                          ))}
                        </select>
                      </div>
                      <EditRow label="Test Date" value={editForm.test_scheduled_date} onChange={(v) => setField("test_scheduled_date", v)} type="date" />
                      <EditRow label="Carrier" value={editForm.carrier} onChange={(v) => setField("carrier", v)} />
                      <EditRow label="NIPR" value={editForm.nipr_number} onChange={(v) => setField("nipr_number", v)} />
                      <EditRow label="Referral Source" value={editForm.referral_source} onChange={(v) => setField("referral_source", v)} />
                    </div>
                  </div>
                  <Separator />
                </>
              )}

              {/* Timeline */}
              <div className="space-y-2.5">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Timeline</h4>
                <div className="space-y-1.5 text-sm">
                  <TimelineRow label="Applied" date={app.created_at} />
                  <TimelineRow label="First Contact" date={app.contacted_at} />
                  <TimelineRow label="Last Contact" date={app.last_contacted_at} />
                  <TimelineRow label="Qualified" date={app.qualified_at} />
                  <TimelineRow label="Contracted" date={app.contracted_at} />
                  {app.test_scheduled_date && (
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground flex items-center gap-2">
                        <Calendar className="h-3.5 w-3.5" /> Test Scheduled
                      </span>
                      <span>{app.test_scheduled_date}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Experience */}
              {(app.previous_company || app.years_experience) && (
                <>
                  <Separator />
                  <div className="space-y-2.5">
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Experience</h4>
                    <div className="space-y-1.5 text-sm">
                      {app.previous_company && (
                        <div className="flex items-center gap-3">
                          <Building2 className="h-4 w-4 text-muted-foreground" />
                          <span>{app.previous_company}</span>
                          {app.years_experience ? <span className="text-muted-foreground">({app.years_experience} yrs)</span> : null}
                        </div>
                      )}
                      {app.desired_income && (
                        <div className="text-muted-foreground">
                          Desired Income: <span className="text-foreground font-medium">${Number(app.desired_income).toLocaleString()}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </>
              )}

              {/* NIPR / Licensed States (read-only view) */}
              {!isEditing && (app.nipr_number || (app.licensed_states && app.licensed_states.length > 0)) && (
                <>
                  <Separator />
                  <div className="space-y-2 text-sm">
                    {app.nipr_number && (
                      <div className="flex items-center gap-3">
                        <FileText className="h-4 w-4 text-muted-foreground" />
                        <span className="text-muted-foreground">NIPR:</span>
                        <span className="font-medium">{app.nipr_number}</span>
                      </div>
                    )}
                    {app.licensed_states && app.licensed_states.length > 0 && (
                      <div className="text-muted-foreground">
                        Licensed States: <span className="text-foreground">{app.licensed_states.join(", ")}</span>
                      </div>
                    )}
                  </div>
                </>
              )}

              {/* Notes */}
              <Separator />
              <div className="space-y-2.5">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Notes</h4>
                {isEditing ? (
                  <Textarea
                    value={editForm.notes}
                    onChange={(e) => setField("notes", e.target.value)}
                    rows={4}
                    placeholder="Add notes…"
                    className="text-sm"
                  />
                ) : app.notes ? (
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed bg-muted/30 rounded-lg p-3">
                    {app.notes}
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground italic">No notes yet</p>
                )}
              </div>

              {/* Save / Quick Actions */}
              <Separator />
              {isEditing ? (
                <Button onClick={handleSave} disabled={savingEdit || !editForm.first_name.trim() || !editForm.email.trim()} className="w-full">
                  {savingEdit && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Save Changes
                </Button>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {app.phone && (
                    <Button variant="outline" size="sm" asChild>
                      <a href={`tel:${app.phone}`}><Phone className="h-3.5 w-3.5 mr-1.5" /> Call</a>
                    </Button>
                  )}
                  <Button variant="outline" size="sm" asChild>
                    <a href={`mailto:${app.email}`}><Mail className="h-3.5 w-3.5 mr-1.5" /> Email</a>
                  </Button>
                </div>
              )}
            </div>
          </ScrollArea>
        )}
      </SheetContent>
    </Sheet>
  );
}

function EditRow({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (v: string) => void; type?: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-sm text-muted-foreground w-28 shrink-0">{label}</span>
      <Input className="flex-1 h-9 text-sm" type={type} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function TimelineRow({ label, date }: { label: string; date: string | null | undefined }) {
  if (!date) return null;
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground flex items-center gap-2">
        <CheckCircle className="h-3.5 w-3.5 text-emerald-400" /> {label}
      </span>
      <span className="text-xs">{format(new Date(date), "MMM d, yyyy")}</span>
    </div>
  );
}
