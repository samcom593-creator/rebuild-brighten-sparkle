import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  Phone, Mail, Instagram, MapPin, Clock, FileText,
  Building2, GraduationCap, Calendar, CheckCircle, X,
} from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

interface ApplicationDetailSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  applicationId?: string;
  agentId?: string;
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

export function ApplicationDetailSheet({
  open,
  onOpenChange,
  applicationId,
  agentId,
}: ApplicationDetailSheetProps) {
  const { data: application, isLoading } = useQuery({
    queryKey: ["application-detail", applicationId, agentId],
    queryFn: async () => {
      let query = supabase.from("applications").select("*");
      if (applicationId) query = query.eq("id", applicationId);
      else if (agentId) query = query.eq("assigned_agent_id", agentId);
      const { data } = await query.is("terminated_at", null).order("created_at", { ascending: false }).limit(1).maybeSingle();
      return data;
    },
    enabled: open && !!(applicationId || agentId),
    staleTime: 30_000,
  });

  const app = application;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-lg p-0">
        <SheetHeader className="p-6 pb-4">
          <SheetTitle className="text-lg">
            {isLoading ? "Loading…" : app ? `${app.first_name} ${app.last_name}` : "Application Not Found"}
          </SheetTitle>
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
                <Badge variant="outline" className="text-xs">
                  {app.status}
                </Badge>
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
                <div className="space-y-2">
                  <a href={`mailto:${app.email}`} className="flex items-center gap-3 text-sm hover:text-primary transition-colors">
                    <Mail className="h-4 w-4 text-muted-foreground" />
                    {app.email}
                  </a>
                  {app.phone && (
                    <a href={`tel:${app.phone}`} className="flex items-center gap-3 text-sm hover:text-primary transition-colors">
                      <Phone className="h-4 w-4 text-muted-foreground" />
                      {app.phone}
                    </a>
                  )}
                  {app.instagram_handle && (
                    <a
                      href={`https://instagram.com/${app.instagram_handle.replace("@", "")}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-3 text-sm hover:text-primary transition-colors"
                    >
                      <Instagram className="h-4 w-4 text-pink-400" />
                      @{app.instagram_handle.replace("@", "")}
                    </a>
                  )}
                  {(app.city || app.state) && (
                    <div className="flex items-center gap-3 text-sm text-muted-foreground">
                      <MapPin className="h-4 w-4" />
                      {[app.city, app.state].filter(Boolean).join(", ")}
                    </div>
                  )}
                </div>
              </div>

              <Separator />

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

              {/* NIPR / Licensed States */}
              {(app.nipr_number || (app.licensed_states && app.licensed_states.length > 0)) && (
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
              {app.notes && (
                <>
                  <Separator />
                  <div className="space-y-2.5">
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Notes</h4>
                    <p className="text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed bg-muted/30 rounded-lg p-3">
                      {app.notes}
                    </p>
                  </div>
                </>
              )}

              {/* Quick Actions */}
              <Separator />
              <div className="flex flex-wrap gap-2">
                {app.phone && (
                  <Button variant="outline" size="sm" asChild>
                    <a href={`tel:${app.phone}`}>
                      <Phone className="h-3.5 w-3.5 mr-1.5" /> Call
                    </a>
                  </Button>
                )}
                <Button variant="outline" size="sm" asChild>
                  <a href={`mailto:${app.email}`}>
                    <Mail className="h-3.5 w-3.5 mr-1.5" /> Email
                  </a>
                </Button>
              </div>
            </div>
          </ScrollArea>
        )}
      </SheetContent>
    </Sheet>
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
