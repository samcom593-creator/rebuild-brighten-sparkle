import { useState } from "react";
import { Phone, Mail, Clock, Eye, Calendar, AlertCircle, CheckCircle, Loader2, GraduationCap, Target, Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import { SCORE_THRESHOLDS } from "@/lib/apexConfig";
import { ApplicationDetailSheet } from "@/components/dashboard/ApplicationDetailSheet";
import { ResendLicensingButton } from "@/components/callcenter/ResendLicensingButton";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface PipelineCardData {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  license_progress: string | null;
  license_status: string;
  last_contacted_at?: string | null;
  contacted_at?: string | null;
  created_at: string;
  assigned_agent_id?: string | null;
  lead_score?: number | null;
  next_action_type?: string | null;
  assigned_manager_name?: string | null;
  last_activity_title?: string | null;
}

function getContactBadge(app: PipelineCardData) {
  const last = app.last_contacted_at || app.contacted_at;
  if (!last) {
    return { label: "Never contacted", color: "bg-red-500/20 text-red-400 border-red-500/30 animate-pulse" };
  }
  const hoursAgo = (Date.now() - new Date(last).getTime()) / (1000 * 60 * 60);
  if (hoursAgo > 48) {
    return { label: `${Math.floor(hoursAgo / 24)}d ago`, color: "bg-amber-500/20 text-amber-400 border-amber-500/30" };
  }
  return {
    label: formatDistanceToNow(new Date(last), { addSuffix: true }),
    color: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  };
}

function getScoreColor(score: number | null | undefined) {
  if (!score) return "bg-muted text-muted-foreground border-border";
  if (score >= SCORE_THRESHOLDS.medium) return "bg-emerald-500/20 text-emerald-400 border-emerald-500/30";
  if (score >= SCORE_THRESHOLDS.low) return "bg-amber-500/20 text-amber-400 border-amber-500/30";
  return "bg-red-500/20 text-red-400 border-red-500/30";
}

const STAGE_LABELS: Record<string, string> = {
  unlicensed: "Unlicensed",
  course_purchased: "Course Purchased",
  finished_course: "Finished Course",
  test_scheduled: "Test Scheduled",
  passed_test: "Passed Test",
  fingerprints_done: "Fingerprints Done",
  waiting_on_license: "Waiting on License",
  licensed: "Licensed",
};

interface PipelineCardProps {
  app: PipelineCardData;
  onClick: (app: PipelineCardData) => void;
  onSchedule?: (app: PipelineCardData) => void;
  isDragging?: boolean;
}

export function PipelineCard({ app, onClick, onSchedule, isDragging }: PipelineCardProps) {
  const contactBadge = getContactBadge(app);
  const [showAppSheet, setShowAppSheet] = useState(false);

  return (
    <>
      <div
        className={cn(
          "bg-card border border-border rounded-xl p-3 shadow-sm hover:shadow-md hover:border-primary/30 transition-all",
          isDragging && "opacity-40"
        )}
      >
        {/* Header: name + score */}
        <div className="flex items-start justify-between gap-2 mb-1.5">
          <p className="font-semibold text-sm text-foreground leading-tight truncate">
            {app.first_name} {app.last_name}
          </p>
          {app.lead_score != null && (
            <Badge variant="outline" className={cn("text-[9px] px-1.5 py-0 shrink-0", getScoreColor(app.lead_score))}>
              <Target className="h-2.5 w-2.5 mr-0.5" />
              {app.lead_score}
            </Badge>
          )}
        </div>

        {/* Contact freshness + stage badge */}
        <div className="flex items-center gap-1.5 flex-wrap mb-2">
          <Badge variant="outline" className={cn("text-[10px]", contactBadge.color)}>
            <Clock className="h-2.5 w-2.5 mr-1" />
            {contactBadge.label}
          </Badge>
          {app.license_progress && (
            <Badge variant="outline" className="text-[10px] bg-muted/50 text-muted-foreground border-border">
              {STAGE_LABELS[app.license_progress] || app.license_progress}
            </Badge>
          )}
        </div>

        {/* Contact info */}
        <div className="space-y-0.5 text-xs text-muted-foreground mb-2">
          <div className="flex items-center gap-1.5 truncate">
            <Mail className="h-3 w-3 flex-shrink-0" />
            <span className="truncate">{app.email}</span>
          </div>
          {app.phone && (
            <div className="flex items-center gap-1.5">
              <Phone className="h-3 w-3 flex-shrink-0" />
              <span>{app.phone}</span>
            </div>
          )}
        </div>

        {/* Manager name */}
        {app.assigned_manager_name && (
          <div className="text-[10px] text-muted-foreground mb-1.5 truncate">
            👤 {app.assigned_manager_name}
          </div>
        )}

        {/* Next action */}
        {app.next_action_type && (
          <div className="flex items-center gap-1 text-[10px] text-blue-400 mb-1.5">
            <Zap className="h-2.5 w-2.5" />
            <span className="truncate">{app.next_action_type}</span>
          </div>
        )}

        {/* Last activity */}
        {app.last_activity_title && (
          <div className="text-[10px] text-muted-foreground/70 truncate mb-2 italic">
            {app.last_activity_title}
          </div>
        )}

        {/* Actions — standardised h-8 w-8 touch targets */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-xs flex-1 min-w-[48px] text-muted-foreground hover:text-foreground"
            onClick={(e) => { e.stopPropagation(); onClick(app); }}
          >
            View
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-primary hover:text-primary/80 hover:bg-primary/10"
            onClick={(e) => { e.stopPropagation(); setShowAppSheet(true); }}
            title="View Application"
          >
            <Eye className="h-4 w-4" />
          </Button>
          {onSchedule && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-blue-400 hover:text-blue-300 hover:bg-blue-500/10"
              onClick={(e) => { e.stopPropagation(); onSchedule(app); }}
              title="Schedule Interview"
            >
              <Calendar className="h-4 w-4" />
            </Button>
          )}
          {app.phone && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10"
              asChild
              onClick={(e) => e.stopPropagation()}
            >
              <a href={`tel:${app.phone}`}>
                <Phone className="h-4 w-4" />
              </a>
            </Button>
          )}
          {/* Email button */}
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-sky-400 hover:text-sky-300 hover:bg-sky-500/10"
            asChild
            onClick={(e) => e.stopPropagation()}
          >
            <a href={`mailto:${app.email}`}>
              <Mail className="h-4 w-4" />
            </a>
          </Button>
          {/* Send coursework / licensing button */}
          {app.license_status !== "licensed" && (
            <div onClick={(e) => e.stopPropagation()}>
              <ResendLicensingButton
                recipientEmail={app.email}
                recipientName={`${app.first_name} ${app.last_name}`}
                licenseStatus={app.license_status as "licensed" | "unlicensed" | "pending"}
              />
            </div>
          )}
        </div>
      </div>

      <ApplicationDetailSheet
        open={showAppSheet}
        onOpenChange={setShowAppSheet}
        applicationId={app.id}
      />
    </>
  );
}