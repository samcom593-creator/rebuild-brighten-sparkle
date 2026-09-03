import { Phone, Mail, Clock, Eye, Calendar, Target, Zap, Flame, TrendingUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { contactLinkProps, phoneHref } from "@/lib/phone";
import { formatDistanceToNow, differenceInDays, differenceInHours } from "date-fns";
import { SCORE_THRESHOLDS } from "@/lib/apexConfig";
import { ApplicationDetailSheet } from "@/components/dashboard/ApplicationDetailSheet";
import { ResendLicensingButton } from "@/components/callcenter/ResendLicensingButton";
import { useState, useMemo, memo } from "react";

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

// ─── Stage progression order (0 = start, 8 = done) ───────────────────────────
const STAGE_ORDER: Record<string, number> = {
  new_applicant:       0,
  unlicensed:          1,
  course_purchased:    2,
  finished_course:     3,
  test_scheduled:      4,
  passed_test:         5,
  fingerprints_done:   6,
  waiting_on_license:  7,
  licensed:            8,
};

const STAGE_LABELS: Record<string, string> = {
  unlicensed:          "Unlicensed",
  course_purchased:    "Course Purchased",
  finished_course:     "Finished Course",
  test_scheduled:      "Test Scheduled",
  passed_test:         "Passed Test",
  fingerprints_done:   "Fingerprints Done",
  waiting_on_license:  "Waiting on License",
  licensed:            "Licensed",
};

// ─── Next recommended action per stage ───────────────────────────────────────
const NEXT_ACTION: Record<string, string> = {
  unlicensed:         "📞 Call & invite to course",
  course_purchased:   "✅ Check course progress",
  finished_course:    "📅 Schedule state exam",
  test_scheduled:     "🎯 Send exam prep tips",
  passed_test:        "🖐 Submit fingerprints",
  fingerprints_done:  "📄 Verify license app",
  waiting_on_license: "⏳ Follow up with state",
  licensed:           "🚀 Onboard & write first deal",
};

function getContactBadge(app: PipelineCardData, now: Date) {
  const last = app.last_contacted_at || app.contacted_at;
  if (!last) {
    return { label: "Never contacted", color: "bg-red-500/20 text-red-400 border-red-500/30 animate-pulse" };
  }
  const lastDate = new Date(last);
  const hours = differenceInHours(now, lastDate);
  if (hours > 48) {
    return {
      label: `${Math.max(0, Math.floor(hours / 24))}d ago`,
      color: "bg-amber-500/20 text-amber-400 border-amber-500/30",
    };
  }
  return {
    label: formatDistanceToNow(lastDate, { addSuffix: true }),
    color: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  };
}

function getScoreColor(score: number | null | undefined) {
  if (!score) return "bg-muted text-muted-foreground border-border";
  if (score >= SCORE_THRESHOLDS.medium) return "bg-emerald-500/20 text-emerald-400 border-emerald-500/30";
  if (score >= SCORE_THRESHOLDS.low)    return "bg-amber-500/20 text-amber-400 border-amber-500/30";
  return "bg-red-500/20 text-red-400 border-red-500/30";
}

// ─── Mini stage progress bar (0–8 steps) ─────────────────────────────────────
function StageProgressBar({ stage }: { stage: string | null | undefined }) {
  const step  = STAGE_ORDER[stage ?? ""] ?? 0;
  const total = 8;
  const pct   = Math.round((step / total) * 100);
  const isLicensed = stage === "licensed";

  return (
    <div className="mt-1.5 mb-2">
      <div className="flex items-center justify-between mb-0.5">
        <span className="text-[9px] text-muted-foreground/60">Progress</span>
        <span className="text-[9px] text-muted-foreground/60">{pct}%</span>
      </div>
      <div className="h-1 bg-muted/40 rounded-full overflow-hidden">
        <div
          className={cn(
            "h-full rounded-full transition-all duration-500",
            isLicensed ? "bg-emerald-500" : step >= 5 ? "bg-violet-500" : step >= 3 ? "bg-amber-500" : "bg-primary"
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

interface PipelineCardProps {
  app: PipelineCardData;
  onClick: (app: PipelineCardData) => void;
  onSchedule?: (app: PipelineCardData) => void;
  isDragging?: boolean;
}

export const PipelineCard = memo(function PipelineCard({ app, onClick, onSchedule, isDragging }: PipelineCardProps) {
  const [sheet, setSheet] = useState(false);

  const { contactBadge, hoursStale, daysInStage } = useMemo(() => {
    const now = new Date();
    const last = app.last_contacted_at || app.contacted_at;
    return {
      contactBadge: getContactBadge(app, now),
      hoursStale: last ? differenceInHours(now, new Date(last)) : 9999,
      daysInStage: differenceInDays(now, new Date(app.created_at)),
    };
  }, [app.last_contacted_at, app.contacted_at, app.created_at]);
  const isAtRisk     = hoursStale >= 48 && app.license_status !== "licensed";
  const isHot        = (app.lead_score ?? 0) >= SCORE_THRESHOLDS.medium;
  const nextAction   = NEXT_ACTION[app.license_progress ?? ""] ?? null;
  const isLicensed   = app.license_status === "licensed";

  return (
    <>
      <div
        className={cn(
          "bg-card border rounded-md p-3 shadow-sm transition-all duration-150 group",
          "hover:shadow-md hover:border-primary/30 .5",
          isDragging && "opacity-40 rotate-1",
          isAtRisk && !isLicensed && "border-red-500/30",
          isLicensed && "border-emerald-500/30"
        )}
      >
        {/* ── Header: name + score ──────────────────────────────────────── */}
        <div className="flex items-start justify-between gap-2 mb-1">
          <p className="font-semibold text-sm text-foreground leading-tight truncate">
            {app.first_name} {app.last_name}
          </p>
          <div className="flex items-center gap-1 shrink-0">
            {isAtRisk && !isLicensed && (
              <span title="At risk — no contact 48h+" className="inline-flex">
                <Flame className="h-3 w-3 text-red-400 animate-pulse" />
              </span>
            )}
            {isHot && !isAtRisk && (
              <span title="Hot lead" className="inline-flex">
                <Zap className="h-3 w-3 text-amber-400" />
              </span>
            )}
            {app.lead_score != null && (
              <Badge variant="outline" className={cn("text-[9px] px-1.5 py-0", getScoreColor(app.lead_score))}>
                <Target className="h-2.5 w-2.5 mr-0.5" />
                {app.lead_score}
              </Badge>
            )}
          </div>
        </div>

        {/* ── Contact freshness + stage badge ───────────────────────────── */}
        <div className="flex items-center gap-1.5 flex-wrap mb-1">
          <Badge variant="outline" className={cn("text-[10px]", contactBadge.color)}>
            <Clock className="h-2.5 w-2.5 mr-1" />
            {contactBadge.label}
          </Badge>
          {app.license_progress && !isLicensed && (
            <Badge variant="outline" className="text-[10px] bg-muted/50 text-muted-foreground border-border">
              {STAGE_LABELS[app.license_progress] || app.license_progress}
            </Badge>
          )}
          {isLicensed && (
            <Badge className="text-[10px] bg-emerald-500/20 text-emerald-400 border-emerald-500/30">
              🏆 Licensed
            </Badge>
          )}
        </div>

        {/* ── Stage progress bar ────────────────────────────────────────── */}
        <StageProgressBar stage={app.license_progress} />

        {/* ── Contact info ──────────────────────────────────────────────── */}
        <div className="space-y-0.5 text-xs text-muted-foreground mb-1.5">
          <div className="flex items-center gap-1.5 truncate">
            <Mail className="h-3 w-3 flex-shrink-0" />
            <span className="truncate">{app.email}</span>
          </div>
          {phoneHref(app.phone) && (
            <div className="flex items-center gap-1.5">
              <Phone className="h-3 w-3 flex-shrink-0" />
              <span>{app.phone}</span>
            </div>
          )}
        </div>

        {/* ── Days in pipeline + manager ────────────────────────────────── */}
        <div className="flex items-center gap-2 mb-1.5">
          <span className="text-[9px] text-muted-foreground/50 flex items-center gap-0.5">
            <TrendingUp className="h-2.5 w-2.5" />
            {daysInStage}d in pipeline
          </span>
          {app.assigned_manager_name && (
            <span className="text-[9px] text-muted-foreground/50 truncate">
              👤 {app.assigned_manager_name}
            </span>
          )}
        </div>

        {/* ── Next recommended action ───────────────────────────────────── */}
        {nextAction && !isLicensed && (
          <div className="flex items-center gap-1 text-[10px] text-info mb-2 truncate">
            <span>{nextAction}</span>
          </div>
        )}

        {/* ── Last activity ─────────────────────────────────────────────── */}
        {app.last_activity_title && (
          <div className="text-[9px] text-muted-foreground/50 truncate mb-2 italic">
            {app.last_activity_title}
          </div>
        )}

        {/* ── Actions ───────────────────────────────────────────────────── */}
        <div className="flex items-center gap-1 flex-wrap">
          <Button variant="ghost" size="sm"
            className="h-7 text-[11px] flex-1 min-w-[40px] text-muted-foreground hover:text-foreground"
            onClick={(e) => { e.stopPropagation(); onClick(app); }}
          >
            View
          </Button>
          <Button variant="ghost" size="icon"
            className="h-7 w-7 text-primary hover:text-primary/80 hover:bg-primary/10"
            onClick={(e) => { e.stopPropagation(); setSheet(true); }}
            title="Application Detail"
          >
            <Eye className="h-3.5 w-3.5" />
          </Button>
          {onSchedule && (
            <Button variant="ghost" size="icon"
              className="h-7 w-7 text-info hover:text-info hover:bg-info/10"
              onClick={(e) => { e.stopPropagation(); onSchedule(app); }}
              title="Schedule Interview"
            >
              <Calendar className="h-3.5 w-3.5" />
            </Button>
          )}
          {app.phone && (
            <Button variant="ghost" size="icon"
            aria-label="Call contact"
              className="h-7 w-7 text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10"
              asChild onClick={(e) => e.stopPropagation()}
            >
              <a href={phoneHref(app.phone)!} {...contactLinkProps(phoneHref(app.phone)!)}><Phone className="h-3.5 w-3.5" /></a>
            </Button>
          )}
          <Button variant="ghost" size="icon"
          aria-label="Email contact"
            className="h-7 w-7 text-info hover:text-info hover:bg-info/10"
            asChild onClick={(e) => e.stopPropagation()}
          >
            <a href={`mailto:${app.email}`}><Mail className="h-3.5 w-3.5" /></a>
          </Button>
          {!isLicensed && (
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

      <ApplicationDetailSheet open={sheet} onOpenChange={setSheet} applicationId={app.id} />
    </>
  );
});
