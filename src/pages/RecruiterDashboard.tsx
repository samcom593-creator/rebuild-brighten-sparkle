import { useState, useEffect, useCallback, useMemo, memo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Star, Zap, Flame, Trophy, Phone, Mail, MapPin, Calendar,
  Clock, Search, ChevronRight, GraduationCap, Mic,
  BookOpen, BookCheck, CalendarClock, FileCheck, Fingerprint,
  Award, Users, UserCheck, AlertTriangle, TrendingUp, Sparkles,
  MessageSquare, ChevronDown, ChevronUp, Plus, ExternalLink, AlertCircle,
  Activity, PhoneOff, PhoneCall, PhoneForwarded, PhoneMissed, Ban,
  BarChart3, Percent, Timer, Target, Eye, EyeOff, Lightbulb, Brain,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useSoundEffects } from "@/hooks/useSoundEffects";
import { useIsMobile } from "@/hooks/use-mobile";
import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { LicenseProgressSelector } from "@/components/dashboard/LicenseProgressSelector";
import { ResendLicensingButton } from "@/components/callcenter/ResendLicensingButton";
import { QuickEmailMenu } from "@/components/dashboard/QuickEmailMenu";
import { ConfettiCelebration } from "@/components/dashboard/ConfettiCelebration";
import { ActivityTimeline } from "@/components/recruiter/ActivityTimeline";
import { InterviewScheduler } from "@/components/dashboard/InterviewScheduler";
import { RecruiterAIPanel, LeadAISummary } from "@/components/recruiter/RecruiterAIPanel";
import { LeadDetailSheet } from "@/components/recruiter/LeadDetailSheet";
import { DailyChallenge } from "@/components/recruiter/DailyChallenge";
import { DormantBadge } from "@/components/recruiter/DormantBadge";
import { InterviewRecorder } from "@/components/dashboard/InterviewRecorder";
import { logLeadActivity } from "@/lib/logLeadActivity";
import { cn } from "@/lib/utils";
import { formatDistanceToNow, addDays, addMinutes, subDays, differenceInDays } from "date-fns";
import { toast } from "sonner";
import { Navigate } from "react-router-dom";
import {
  SCORING_WEIGHTS, SCORE_THRESHOLDS, XP_REWARDS, RANK_LEVELS,
  PROGRESS_COLUMNS, SCHEDULING_LINKS, CALL_OUTCOMES as CALL_OUTCOME_DEFS,
  ANIMATION_THRESHOLDS, SUGGESTION_RULES, FOLLOWUP_TIMING,
} from "@/lib/apexConfig";
import { isFeatureEnabled } from "@/lib/featureFlags";

// ─── Constants ────────────────────────────────────────────────────────────────
const AISHA_EMAIL = "kebbeh045@gmail.com";

const UNLICENSED_SCHEDULING_LINK = SCHEDULING_LINKS.unlicensed;
const LICENSED_SCHEDULING_LINK = SCHEDULING_LINKS.licensed;

type SortMode = "stale" | "newest" | "oldest" | "name" | "score";

// ─── Call Outcome Types (add icons to config defs) ────────────────────────────
const CALL_OUTCOME_ICONS: Record<string, React.ElementType> = {
  no_answer: PhoneMissed,
  voicemail: PhoneOff,
  interested: PhoneCall,
  not_interested: PhoneForwarded,
  wrong_number: Ban,
};
const CALL_OUTCOMES = CALL_OUTCOME_DEFS.map((o) => ({
  ...o,
  icon: CALL_OUTCOME_ICONS[o.key] || Phone,
}));

// ─── Lead Scoring (uses config weights) ───────────────────────────────────────
function computeLeadScore(lead: Lead): number {
  let score = SCORING_WEIGHTS.baseScore;
  if (lead.license_progress === "licensed") score += SCORING_WEIGHTS.licensed;
  if (lead.test_scheduled_date) score += SCORING_WEIGHTS.testScheduled;
  const lastContact = lead.last_contacted_at || lead.contacted_at;
  if (lastContact) {
    const hrs = (Date.now() - new Date(lastContact).getTime()) / (1000 * 60 * 60);
    if (hrs <= 48) score += SCORING_WEIGHTS.recentContact48h;
    if (hrs > 72) score += SCORING_WEIGHTS.stalePenalty72h;
  }
  if (lead.notes && lead.notes.trim().split(/\s+/).length >= 3) score += SCORING_WEIGHTS.notesBonus;
  const daysSinceCreated = (Date.now() - new Date(lead.created_at).getTime()) / (1000 * 60 * 60 * 24);
  if (daysSinceCreated <= 7 && lead.contacted_at) score += SCORING_WEIGHTS.newAndContacted7d;
  if (lead.referral_source) score += SCORING_WEIGHTS.referralBonus;
  return Math.max(0, Math.min(100, score));
}

function getScoreBadge(score: number) {
  if (score < SCORE_THRESHOLDS.low) return { label: `${score}`, className: "bg-rose-500/20 text-rose-400 border-rose-500/30" };
  if (score < SCORE_THRESHOLDS.medium) return { label: `${score}`, className: "bg-amber-500/20 text-amber-400 border-amber-500/30" };
  return { label: `${score}`, className: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" };
}

// ─── Auto-Stage Suggestion ────────────────────────────────────────────────────
interface StageSuggestion {
  label: string;
  newProgress: string;
}

function computeStageSuggestion(lead: Lead): StageSuggestion | null {
  if (!isFeatureEnabled("autoStageSuggestions")) return null;
  const now = Date.now();
  const lastActivity = lead.last_contacted_at || lead.contacted_at || lead.created_at;
  const daysSinceActivity = (now - new Date(lastActivity).getTime()) / (1000 * 60 * 60 * 24);

  if (lead.license_progress === "passed_test" && daysSinceActivity >= SUGGESTION_RULES.passedTestStaleDays) {
    return { label: "Move to Final Steps", newProgress: "fingerprints_done" };
  }
  if (lead.license_progress === "waiting_on_license" && daysSinceActivity >= SUGGESTION_RULES.waitingOnLicenseStaleDays) {
    return { label: "Move to Licensed", newProgress: "licensed" };
  }
  if (daysSinceActivity >= SUGGESTION_RULES.coldInactivityDays && computeLeadScore(lead) < SUGGESTION_RULES.coldScoreThreshold) {
    return null; // "Mark as Cold" — no cold stage exists, skip for now
  }
  return null;
}

// ─── Smart Follow-Up ──────────────────────────────────────────────────────────
function computeNextAction(lead: Lead): { dueAt: Date; actionType: string } | null {
  const now = new Date();
  if (!lead.contacted_at && !lead.last_contacted_at) {
    return { dueAt: addMinutes(new Date(lead.created_at), FOLLOWUP_TIMING.initialOutreachDelayMinutes), actionType: "initial_outreach" };
  }
  const lastContact = lead.last_contacted_at || lead.contacted_at;
  if (lastContact) {
    const hrs = (now.getTime() - new Date(lastContact).getTime()) / (1000 * 60 * 60);
    if (hrs >= FOLLOWUP_TIMING.noAnswerRetryHours && (!lead.license_progress || lead.license_progress === "unlicensed")) {
      return { dueAt: now, actionType: "call_followup" };
    }
  }
  if (lead.license_progress === "course_purchased" || lead.license_progress === "finished_course") {
    const contactDate = lead.last_contacted_at || lead.contacted_at;
    if (contactDate) return { dueAt: addDays(new Date(contactDate), FOLLOWUP_TIMING.courseCheckInDays), actionType: "course_checkin" };
  }
  if (lead.license_progress === "test_scheduled" && lead.test_scheduled_date) {
    return { dueAt: subDays(new Date(lead.test_scheduled_date), FOLLOWUP_TIMING.testReminderLeadDays), actionType: "test_reminder" };
  }
  return null;
}

function isOverdue(lead: Lead): boolean {
  const action = computeNextAction(lead);
  return action ? action.dueAt <= new Date() : false;
}

// ─── Types ─────────────────────────────────────────────────────────────────────
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

// ─── Helper functions ──────────────────────────────────────────────────────────
function getLastContactAge(lead: Lead) {
  const ts = lead.last_contacted_at || lead.contacted_at;
  if (!ts) return Infinity;
  return Date.now() - new Date(ts).getTime();
}

function contactBadgeColor(lead: Lead) {
  const age = getLastContactAge(lead);
  if (age === Infinity) return "bg-rose-500/20 text-rose-400 border-rose-500/30";
  const hrs = age / (1000 * 60 * 60);
  if (hrs > 48) return "bg-rose-500/20 text-rose-400 border-rose-500/30";
  if (hrs > 24) return "bg-amber-500/20 text-amber-400 border-amber-500/30";
  return "bg-emerald-500/20 text-emerald-400 border-emerald-500/30";
}

function contactBadgeLabel(lead: Lead) {
  const ts = lead.last_contacted_at || lead.contacted_at;
  if (!ts) return "Never contacted";
  return `Last: ${formatDistanceToNow(new Date(ts), { addSuffix: true })}`;
}

function getRankForXP(xp: number) {
  for (let i = RANK_LEVELS.length - 1; i >= 0; i--) {
    if (xp >= RANK_LEVELS[i].min) return RANK_LEVELS[i];
  }
  return RANK_LEVELS[0];
}

function getNextRankXP(xp: number) {
  for (const level of RANK_LEVELS) {
    if (xp < level.min) return level.min;
  }
  return null;
}

// ─── Performance Metrics ──────────────────────────────────────────────────────
function computeMetrics(leads: Lead[]) {
  const total = leads.length;
  if (total === 0) return { contactRate: 0, licenseRate: 0, avgDaysToLicensed: 0, overdueRate: 0 };

  const contacted = leads.filter((l) => l.last_contacted_at || l.contacted_at).length;
  const licensed = leads.filter((l) => l.license_progress === "licensed").length;
  const overdue = leads.filter(isOverdue).length;

  // Avg days to licensed — from created_at to contacted_at for licensed leads
  const licensedLeads = leads.filter((l) => l.license_progress === "licensed" && l.contacted_at);
  const avgDays = licensedLeads.length > 0
    ? Math.round(licensedLeads.reduce((sum, l) => sum + differenceInDays(new Date(l.contacted_at!), new Date(l.created_at)), 0) / licensedLeads.length)
    : 0;

  return {
    contactRate: Math.round((contacted / total) * 100),
    licenseRate: Math.round((licensed / total) * 100),
    avgDaysToLicensed: avgDays,
    overdueRate: Math.round((overdue / total) * 100),
  };
}

// ─── Sub-components ────────────────────────────────────────────────────────────
function XPBar({ xp }: { xp: number }) {
  const rank = getRankForXP(xp);
  const nextXP = getNextRankXP(xp);
  const prevXP = rank.min;
  const pct = nextXP ? Math.round(((xp - prevXP) / (nextXP - prevXP)) * 100) : 100;

  return (
    <div className="flex items-center gap-3 min-w-0">
      <span className="text-xl">{rank.emoji}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-1">
          <span className={cn("text-xs font-bold", rank.color)}>{rank.label}</span>
          <span className="text-xs text-muted-foreground">{xp} XP{nextXP ? ` / ${nextXP}` : ""}</span>
        </div>
        <div className="h-1.5 bg-muted rounded-full overflow-hidden">
          <motion.div
            className="h-full bg-gradient-to-r from-pink-500 to-purple-500 rounded-full"
            initial={{ width: 0 }}
            animate={{ width: `${pct}%` }}
            transition={{ duration: 0.8, ease: "easeOut" }}
          />
        </div>
      </div>
    </div>
  );
}

function StatBubble({
  icon: Icon,
  label,
  value,
  color,
  delay = 0,
}: {
  icon: React.ElementType;
  label: string;
  value: number | string;
  color: string;
  delay?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay, type: "spring", stiffness: 300, damping: 25 }}
      className={cn(
        "flex items-center gap-1.5 rounded-xl border px-2 py-1 cursor-default",
        color
      )}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span className="text-base font-bold leading-none">{value}</span>
      <span className="text-[10px] text-muted-foreground leading-tight truncate">{label}</span>
    </motion.div>
  );
}

// ─── Metrics Strip ────────────────────────────────────────────────────────────
function MetricsStrip({ leads }: { leads: Lead[] }) {
  const [open, setOpen] = useState(false);
  const metrics = useMemo(() => computeMetrics(leads), [leads]);

  const pills = [
    { icon: Phone, label: "Contact Rate", value: `${metrics.contactRate}%`, color: metrics.contactRate >= 80 ? "text-emerald-400" : metrics.contactRate >= 50 ? "text-amber-400" : "text-rose-400" },
    { icon: Award, label: "License Rate", value: `${metrics.licenseRate}%`, color: metrics.licenseRate >= 30 ? "text-emerald-400" : metrics.licenseRate >= 15 ? "text-amber-400" : "text-rose-400" },
    { icon: Timer, label: "Avg Days to Licensed", value: `${metrics.avgDaysToLicensed}d`, color: "text-blue-400" },
    { icon: AlertTriangle, label: "Overdue", value: `${metrics.overdueRate}%`, color: metrics.overdueRate <= 10 ? "text-emerald-400" : metrics.overdueRate <= 30 ? "text-amber-400" : "text-rose-400" },
  ];

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button className="flex items-center gap-2 w-full text-xs text-muted-foreground hover:text-foreground transition-colors py-1 px-1">
          <BarChart3 className="h-3.5 w-3.5" />
          <span className="font-medium">Performance Metrics</span>
          {open ? <ChevronUp className="h-3 w-3 ml-auto" /> : <ChevronDown className="h-3 w-3 ml-auto" />}
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="flex flex-wrap gap-2 pt-2 pb-1">
          {pills.map((p) => (
            <div
              key={p.label}
              className="flex items-center gap-1.5 rounded-full border border-border/60 bg-card px-3 py-1.5"
            >
              <p.icon className={cn("h-3 w-3", p.color)} />
              <span className="text-[10px] text-muted-foreground">{p.label}</span>
              <span className={cn("text-xs font-bold", p.color)}>{p.value}</span>
            </div>
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

// ─── Memoized LeadCard ────────────────────────────────────────────────────────
const LeadCard = memo(function LeadCard({
  lead,
  agentId,
  onRefresh,
  onXP,
  onCelebrate,
  disableHover,
  onDetailClick,
}: {
  lead: Lead;
  agentId: string | null;
  onRefresh: () => void;
  onXP: (pts: number, label: string) => void;
  onCelebrate: () => void;
  disableHover?: boolean;
  onDetailClick?: (lead: Lead) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [noteText, setNoteText] = useState(lead.notes || "");
  const [savingNote, setSavingNote] = useState(false);
  const [callOutcomeOpen, setCallOutcomeOpen] = useState(false);
  const [showRecorder, setShowRecorder] = useState(false);
  const { playSound } = useSoundEffects();

  const [showTimeline, setShowTimeline] = useState(false);
  const [schedulerOpen, setSchedulerOpen] = useState(false);
  const leadScore = useMemo(() => computeLeadScore(lead), [lead]);
  const scoreBadge = getScoreBadge(leadScore);

  const handleProgressUpdated = useCallback(async (newProgress?: string) => {
    playSound("success");
    const oldProgress = lead.license_progress || "unlicensed";
    logLeadActivity({
      leadId: lead.id,
      type: "stage_changed",
      title: "Stage moved",
      details: { from_stage: oldProgress, to_stage: newProgress },
    });
    if (newProgress === "licensed") {
      onXP(XP_REWARDS.licensed, "🏆 Someone got LICENSED!");
      onCelebrate();
    } else if (newProgress === "test_scheduled") {
      onXP(XP_REWARDS.test_scheduled, "📅 Test scheduled!");
    } else {
      onXP(XP_REWARDS.stage_update, "✨ Stage updated!");
    }
    onRefresh();
  }, [playSound, onXP, onCelebrate, onRefresh, lead.id, lead.license_progress]);

  const handleSaveNote = async () => {
    if (!noteText.trim()) return;
    setSavingNote(true);
    try {
      const { error } = await supabase
        .from("applications")
        .update({ notes: noteText })
        .eq("id", lead.id);
      if (error) throw error;
      logLeadActivity({
        leadId: lead.id,
        type: "note_added",
        title: "Note added",
        details: { note_preview: noteText.slice(0, 140) },
      });
      onXP(XP_REWARDS.note_added, "📝 Note saved!");
      toast.success("Note saved!");
    } catch {
      toast.error("Failed to save note");
    } finally {
      setSavingNote(false);
    }
  };

  const handleCallOutcome = useCallback(async (outcome: typeof CALL_OUTCOMES[number]) => {
    setCallOutcomeOpen(false);
    logLeadActivity({
      leadId: lead.id,
      type: outcome.activityType,
      title: `Call: ${outcome.label}`,
      details: { phone: lead.phone, outcome: outcome.key },
    });
    try {
      await supabase
        .from("applications")
        .update({ last_contacted_at: new Date().toISOString() })
        .eq("id", lead.id);
      onXP(XP_REWARDS.contact, `📞 ${outcome.label}`);
      playSound("success");
      onRefresh();
    } catch {
      console.error("Failed to log contact");
    }
  }, [lead.id, lead.phone, onXP, playSound, onRefresh]);

  const contactColor = contactBadgeColor(lead);
  const contactLabel = contactBadgeLabel(lead);
  const fullName = `${lead.first_name} ${lead.last_name}`.trim();
  const location = [lead.city, lead.state].filter(Boolean).join(", ");

  return (
    <TooltipProvider delayDuration={200}>
      <motion.div
        layout={!disableHover}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95 }}
        whileHover={disableHover ? undefined : { y: -1 }}
        transition={{ type: "spring", stiffness: 300, damping: 25 }}
        className="bg-card border border-border rounded-xl overflow-hidden shadow-sm"
      >
        <div className="p-1.5 space-y-0.5">
          {/* ── Row 1: Name + score ── */}
          <div className="flex items-start justify-between gap-1">
            <p className="font-semibold text-sm leading-tight truncate min-w-0 flex-1 cursor-pointer hover:text-primary transition-colors" title={fullName} onClick={() => onDetailClick?.(lead)}>{fullName}</p>
            <div className="flex items-center gap-1 shrink-0">
              <DormantBadge lastContactedAt={lead.last_contacted_at} contactedAt={lead.contacted_at} createdAt={lead.created_at} />
              {isFeatureEnabled("leadScoring") && (
                <Badge className={cn("text-[9px] border whitespace-nowrap px-1.5 py-0 font-bold", scoreBadge.className)}>
                  {scoreBadge.label}
                </Badge>
              )}
            </div>
          </div>

          {/* ── Row 2: Location + contact freshness ── */}
          <div className="flex items-center justify-between gap-1">
            {location && (
              <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground truncate min-w-0">
                <MapPin className="h-2.5 w-2.5 shrink-0" />
                <span className="truncate">{location}</span>
              </span>
            )}
            <Badge className={cn("text-[9px] border shrink-0 whitespace-nowrap px-1.5 py-0", contactColor)}>
              <Clock className="h-2 w-2 mr-0.5" />
              {contactLabel}
            </Badge>
          </div>

          {/* ── Row 3: Phone + Email (stacked) ── */}
          <div className="space-y-0.5">
            {lead.phone && (
              <a
                href={`tel:${lead.phone}`}
                onClick={() => setCallOutcomeOpen(true)}
                className="block text-[11px] text-emerald-400 hover:text-emerald-300 transition-colors font-medium truncate"
              >
                {lead.phone}
              </a>
            )}
            {lead.email && (
              <span className="block text-[11px] text-muted-foreground truncate">{lead.email}</span>
            )}
          </div>

          {/* ── Row 4: License progress ── */}
          <LicenseProgressSelector
            applicationId={lead.id}
            currentProgress={lead.license_progress as any}
            testScheduledDate={lead.test_scheduled_date}
            onProgressUpdated={() => handleProgressUpdated()}
            className="text-[10px] h-6"
          />

          {/* ── Row 3: Icon-only action buttons (fixed min-height to prevent jitter) ── */}
          <div className="flex items-center gap-0.5 min-h-[24px] flex-wrap">
            {/* Call with outcome popover */}
            <Popover open={callOutcomeOpen} onOpenChange={setCallOutcomeOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-6 w-6 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10"
                >
                  <Phone className="h-3 w-3" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-48 p-1" side="bottom" align="start">
                <p className="text-[10px] font-medium text-muted-foreground px-2 py-1">Call Outcome</p>
                {CALL_OUTCOMES.map((o) => (
                  <button
                    key={o.key}
                    onClick={() => {
                      handleCallOutcome(o);
                      window.open(`tel:${lead.phone}`, "_self");
                    }}
                    className="flex items-center gap-2 w-full px-2 py-1.5 text-xs rounded-md hover:bg-accent transition-colors"
                  >
                    <o.icon className={cn("h-3 w-3", o.color)} />
                    <span>{o.label}</span>
                  </button>
                ))}
              </PopoverContent>
            </Popover>

            {/* Email */}
            <QuickEmailMenu
              applicationId={lead.id}
              agentId={agentId}
              licenseStatus={lead.license_status as any}
              recipientEmail={lead.email}
              recipientName={fullName}
              onEmailSent={() => {
                logLeadActivity({
                  leadId: lead.id,
                  type: "email_sent",
                  title: "Email sent",
                  details: { template: "quick_email" },
                });
                onXP(XP_REWARDS.contact, "📧 Email sent!");
                onRefresh();
              }}
              className="text-xs h-6 w-6 px-0"
            />

            {/* Send licensing instructions */}
            <ResendLicensingButton
              recipientEmail={lead.email}
              recipientName={lead.first_name}
              licenseStatus={lead.license_status as any}
            />

            {/* Book call */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-6 w-6 border-pink-500/30 text-pink-400 hover:bg-pink-500/10"
                  onClick={() => {
                    logLeadActivity({
                      leadId: lead.id,
                      type: "calendly_link_sent",
                      title: "Calendly link sent",
                      details: { link_type: "unlicensed" },
                    });
                    window.open(UNLICENSED_SCHEDULING_LINK, "_blank");
                  }}
                >
                  <CalendarClock className="h-3 w-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent><p>Book a call (Calendly)</p></TooltipContent>
            </Tooltip>

            {/* Schedule Interview (in-app) */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-6 w-6 border-blue-500/30 text-blue-400 hover:bg-blue-500/10"
                  onClick={() => setSchedulerOpen(true)}
                >
                  <Calendar className="h-3 w-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent><p>Schedule interview</p></TooltipContent>
            </Tooltip>

            {/* AI Summary */}
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-pink-400 hover:text-pink-300 hover:bg-pink-500/10"
                >
                  <Brain className="h-3 w-3" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-2" side="bottom" align="start">
                <LeadAISummary lead={lead} />
              </PopoverContent>
            </Popover>

            {/* Activity timeline toggle */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setShowTimeline((v) => !v)}
                  className="h-6 w-6 text-muted-foreground hover:text-foreground"
                >
                  <Activity className="h-3 w-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent><p>{showTimeline ? "Hide activity" : "Activity"}</p></TooltipContent>
            </Tooltip>

            {/* Record & Transcribe */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setShowRecorder((v) => !v)}
                  className={cn("h-6 w-6", showRecorder ? "text-red-400 bg-red-500/10" : "text-muted-foreground hover:text-foreground")}
                >
                  <Mic className="h-3 w-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent><p>{showRecorder ? "Close recorder" : "Record & Transcribe"}</p></TooltipContent>
            </Tooltip>

            {/* Notes toggle */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setExpanded((v) => !v)}
                  className="h-6 w-6 ml-auto text-muted-foreground hover:text-foreground"
                >
                  <MessageSquare className="h-3 w-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent><p>{expanded ? "Hide notes" : "Notes"}</p></TooltipContent>
            </Tooltip>
          </div>
        </div>


        {/* ── Interview Recorder ── */}
        <AnimatePresence>
          {showRecorder && agentId && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              <InterviewRecorder
                applicationId={lead.id}
                agentId={agentId}
                applicantName={fullName}
                onClose={() => setShowRecorder(false)}
                onTranscriptionSaved={() => {
                  onXP(XP_REWARDS.contact, "🎙️ Interview recorded!");
                  onRefresh();
                }}
              />
            </motion.div>
          )}
        </AnimatePresence>

          {/* ── Auto-Stage Suggestion Chip ── */}
          {(() => {
            const suggestion = computeStageSuggestion(lead);
            if (!suggestion) return null;
            return (
              <div className="px-2.5 pb-1">
                <button
                  onClick={async () => {
                    try {
                      await supabase
                        .from("applications")
                        .update({ license_progress: suggestion.newProgress as any })
                        .eq("id", lead.id);
                      logLeadActivity({
                        leadId: lead.id,
                        type: "stage_changed",
                        title: `Suggestion applied: ${suggestion.label}`,
                        details: { from_stage: lead.license_progress, to_stage: suggestion.newProgress },
                      });
                      logLeadActivity({
                        leadId: lead.id,
                        type: "suggestion_applied",
                        title: `Auto-suggestion: ${suggestion.label}`,
                        details: {},
                      });
                      if (suggestion.newProgress === "licensed") {
                        onXP(XP_REWARDS.licensed, "🏆 Licensed via suggestion!");
                        onCelebrate();
                      } else {
                        onXP(XP_REWARDS.stage_update, "✨ Suggestion applied!");
                      }
                      onRefresh();
                    } catch {
                      toast.error("Failed to apply suggestion");
                    }
                  }}
                  className="flex items-center gap-1.5 w-full rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-[10px] font-medium text-amber-400 hover:bg-amber-500/20 transition-colors"
                >
                  <Lightbulb className="h-3 w-3 shrink-0" />
                  <span>Suggested: {suggestion.label}</span>
                  <span className="ml-auto text-[9px] bg-amber-500/20 rounded px-1.5 py-0.5">Apply</span>
                </button>
              </div>
            );
          })()}

        <AnimatePresence>
          {expanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              <div className="px-2.5 pb-2.5 border-t border-border/50 pt-2.5 space-y-2">
                <Textarea
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  placeholder="Add notes about this person..."
                  className="text-xs min-h-[60px] resize-none"
                />
                <Button
                  size="sm"
                  onClick={handleSaveNote}
                  disabled={savingNote}
                  className="w-full text-xs h-7 bg-pink-500/20 text-pink-300 hover:bg-pink-500/30 border-pink-500/30 border"
                >
                  {savingNote ? "Saving..." : "Save Note"}
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Activity Timeline ── */}
        <AnimatePresence>
          {showTimeline && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              <div className="px-2.5 pb-2.5 border-t border-border/50 pt-2.5">
                <p className="text-[10px] font-medium text-muted-foreground mb-1.5 flex items-center gap-1">
                  <Activity className="h-3 w-3" /> Recent Activity
                </p>
                <ActivityTimeline leadId={lead.id} limit={3} compact />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      {/* Interview Scheduler Dialog */}
      <InterviewScheduler
        open={schedulerOpen}
        onOpenChange={setSchedulerOpen}
        applicationId={lead.id}
        applicantName={fullName}
        applicantEmail={lead.email}
        onScheduled={() => {
          logLeadActivity({
            leadId: lead.id,
            type: "interview_scheduled",
            title: "Interview scheduled",
            details: { scheduled_from: "recruiter_hq" },
          });
          onXP(XP_REWARDS.stage_update, "📅 Interview scheduled!");
          onRefresh();
        }}
      />
    </TooltipProvider>
  );
}, (prev, next) => {
  return (
    prev.lead.id === next.lead.id &&
    prev.lead.license_progress === next.lead.license_progress &&
    prev.lead.last_contacted_at === next.lead.last_contacted_at &&
    prev.lead.notes === next.lead.notes &&
    prev.agentId === next.agentId &&
    prev.disableHover === next.disableHover
  );
});

// ─── Main page ─────────────────────────────────────────────────────────────────
export default function RecruiterDashboard() {
  const { user, isAdmin } = useAuth();

  const isAisha = user?.email === AISHA_EMAIL;
  const allowed = isAisha || isAdmin;

  if (!allowed) return <Navigate to="/dashboard" replace />;
  return <RecruiterDashboardInner />;
}

function RecruiterDashboardInner() {
  const { user } = useAuth();
  const { playSound } = useSoundEffects();
  const isMobile = useIsMobile();

  const [leads, setLeads] = useState<Lead[]>([]);
  const [agentId, setAgentId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("stale");
  const [filterStage, setFilterStage] = useState<string>("all");
  const [xp, setXp] = useState(0);
  const [xpToast, setXpToast] = useState<string | null>(null);
  const [confetti, setConfetti] = useState(false);
  const [advancedToday, setAdvancedToday] = useState(0);
  const [focusMode, setFocusMode] = useState(false);
  const [detailLead, setDetailLead] = useState<Lead | null>(null);
  const [mobileColumn, setMobileColumn] = useState<string | null>(null);

  // Fetch leads assigned to Aisha (or all if admin viewing)
  const fetchLeads = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const { data: agentData } = await supabase
        .from("agents")
        .select("id")
        .eq("user_id", user?.id || "")
        .single();

      const myAgentId = agentData?.id || null;
      setAgentId(myAgentId);

      const query = supabase
        .from("applications")
        .select("id, first_name, last_name, email, phone, city, state, created_at, last_contacted_at, contacted_at, license_status, license_progress, test_scheduled_date, notes, assigned_agent_id, referral_source")
        .is("terminated_at", null)
        .neq("license_status", "licensed")
        .in("status", ["reviewing", "contracting", "approved", "new"]);

      // Show ALL unlicensed leads (no agent filter) — Recruiter HQ is access-restricted
      const { data, error } = await query.order("created_at", { ascending: false });
      if (error) throw error;

      // Also fetch contacted aged leads
      const { data: agedData } = await supabase
        .from("aged_leads")
        .select("id, first_name, last_name, email, phone, contacted_at, last_contacted_at, created_at, license_status, notes")
        .eq("status", "contacted");

      const normalizedAged: Lead[] = (agedData || []).map((a) => ({
        id: a.id,
        first_name: a.first_name,
        last_name: a.last_name || "",
        email: a.email || "",
        phone: a.phone || "",
        city: null,
        state: null,
        created_at: a.created_at || new Date().toISOString(),
        last_contacted_at: a.last_contacted_at,
        contacted_at: a.contacted_at,
        license_status: a.license_status || "unlicensed",
        license_progress: "unlicensed",
        test_scheduled_date: null,
        notes: a.notes,
        assigned_agent_id: null,
        referral_source: "aged_lead",
      }));

      // Merge and deduplicate by email
      const allLeads: Lead[] = [...(data || []).map((d) => ({ ...d, license_progress: d.license_progress as string | null }))];
      const existingEmails = new Set(allLeads.map((l) => l.email?.toLowerCase()).filter(Boolean));
      for (const aged of normalizedAged) {
        if (aged.email && !existingEmails.has(aged.email.toLowerCase())) {
          allLeads.push(aged);
          existingEmails.add(aged.email.toLowerCase());
        }
      }

      setLeads(allLeads);
    } catch (err) {
      console.error("RecruiterDashboard fetch error:", err);
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => { fetchLeads(); }, [fetchLeads]);

  // XP system
  useEffect(() => {
    const saved = localStorage.getItem("aisha_xp");
    if (saved) setXp(parseInt(saved, 10) || 0);
    const savedAdvanced = localStorage.getItem("aisha_advanced_today");
    if (savedAdvanced) setAdvancedToday(parseInt(savedAdvanced, 10) || 0);
  }, []);

  const addXP = useCallback((pts: number, label: string) => {
    setXp((prev) => {
      const next = prev + pts;
      localStorage.setItem("aisha_xp", String(next));
      return next;
    });
    setAdvancedToday((prev) => {
      const next = prev + 1;
      localStorage.setItem("aisha_advanced_today", String(next));
      return next;
    });
    setXpToast(`+${pts} XP — ${label}`);
    setTimeout(() => setXpToast(null), 2500);
  }, []);

  const triggerCelebrate = useCallback(() => {
    setConfetti(true);
    playSound("celebrate");
    setTimeout(() => setConfetti(false), 2000);
  }, [playSound]);

  // Computed stats
  const totalLeads = leads.length;
  const needsContact = leads.filter((l) => getLastContactAge(l) > 48 * 3600 * 1000 || getLastContactAge(l) === Infinity).length;
  const inProgress = leads.filter((l) => l.license_progress && l.license_progress !== "unlicensed" && l.license_progress !== "licensed").length;
  const thisMonth = leads.filter((l) => {
    const d = new Date(l.created_at);
    const now = new Date();
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  }).length;

  // Filter + sort + focus mode
  const filtered = useMemo(() => {
    let result = leads
      .filter((l) => {
        const q = search.toLowerCase();
        const name = `${l.first_name} ${l.last_name}`.toLowerCase();
        if (q && !name.includes(q) && !l.email.toLowerCase().includes(q) && !l.phone.includes(q)) return false;
        if (filterStage !== "all") {
          const col = PROGRESS_COLUMNS.find((c) => c.id === filterStage);
          if (col && !(col.values as readonly string[]).includes(l.license_progress || "unlicensed")) return false;
        }
        return true;
      });

    // Focus mode: only urgent leads
    if (focusMode) {
      result = result.filter((l) =>
        isOverdue(l) || computeLeadScore(l) < 40 || getLastContactAge(l) === Infinity
      );
    }

    return result.sort((a, b) => {
      if (sortMode === "score") return computeLeadScore(b) - computeLeadScore(a);
      if (sortMode === "stale") return getLastContactAge(b) - getLastContactAge(a);
      if (sortMode === "newest") return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      if (sortMode === "oldest") return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      return `${a.first_name} ${a.last_name}`.localeCompare(`${b.first_name} ${b.last_name}`);
    });
  }, [leads, search, filterStage, sortMode, focusMode]);

  // Group by column
  const columnLeads = useMemo(() => {
    const cols = PROGRESS_COLUMNS.map((col) => ({
      ...col,
      leads: filtered.filter((l) => (col.values as readonly string[]).includes(l.license_progress || "unlicensed")),
      needsAttention: filtered.filter((l) => (col.values as readonly string[]).includes(l.license_progress || "unlicensed") && (getLastContactAge(l) > 48 * 3600 * 1000 || getLastContactAge(l) === Infinity)).length,
    }));

    // Auto-select mobile column with most needs-attention leads
    if (isMobile && mobileColumn === null && cols.length > 0) {
      const best = cols.reduce((a, b) => (b.needsAttention > a.needsAttention ? b : a), cols[0]);
      // We'll set this in an effect to avoid setState during render
    }

    return cols;
  }, [filtered, isMobile, mobileColumn]);

  // Set default mobile column
  useEffect(() => {
    if (isMobile && mobileColumn === null && columnLeads.length > 0) {
      const best = columnLeads.reduce((a, b) => (b.needsAttention > a.needsAttention ? b : a), columnLeads[0]);
      setMobileColumn(best.id);
    }
  }, [isMobile, mobileColumn, columnLeads]);

  if (loading) {
    return (
      <div className="p-6 space-y-6">
        <div className="h-32 bg-muted animate-pulse rounded-2xl" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[1,2,3,4].map(i => <div key={i} className="h-24 bg-muted animate-pulse rounded-2xl" />)}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          {[1,2,3,4,5].map(i => <div key={i} className="h-64 bg-muted animate-pulse rounded-2xl" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="p-3 md:p-4 space-y-2 max-w-[1800px] mx-auto">
      <ConfettiCelebration trigger={confetti} onComplete={() => setConfetti(false)} />

      {/* XP toast */}
      <AnimatePresence>
        {xpToast && (
          <motion.div
            initial={{ opacity: 0, y: -20, x: "-50%" }}
            animate={{ opacity: 1, y: 0, x: "-50%" }}
            exit={{ opacity: 0, y: -20, x: "-50%" }}
            className="fixed top-20 left-1/2 z-50 bg-gradient-to-r from-pink-500 to-purple-500 text-white px-4 py-2 rounded-full text-sm font-bold shadow-lg pointer-events-none"
          >
            {xpToast}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Header ── */}
      <motion.div
        initial={{ opacity: 0, y: -16 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative overflow-hidden rounded-xl border border-pink-500/20 bg-gradient-to-br from-pink-500/10 via-purple-500/5 to-transparent p-3"
      >
        <div className="flex flex-col md:flex-row md:items-center gap-2">
          <div className="flex-1">
            <div className="flex items-center gap-3">
              <Sparkles className="h-5 w-5 text-pink-400" />
              <h1 className="text-xl font-bold bg-gradient-to-r from-pink-400 to-purple-400 bg-clip-text text-transparent">
                Aisha's Recruiter HQ
              </h1>
              {advancedToday > 0 && (
                <motion.div
                  initial={{ scale: 0.9 }}
                  animate={{ scale: 1 }}
                  transition={{ type: "spring", stiffness: 300, damping: 20 }}
                  className="flex items-center gap-1 bg-amber-500/20 text-amber-400 border border-amber-500/30 rounded-full px-3 py-0.5 text-xs font-bold"
                >
                  <Zap className="h-3 w-3" />
                  {advancedToday} boosts today
                </motion.div>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              Track every unlicensed hire → get them licensed 💪
            </p>
          </div>

          {/* XP Bar */}
          {isFeatureEnabled("xpSystem") && (
            <div className="md:w-48 bg-background/60 rounded-xl p-2 border border-border/50">
              <XPBar xp={xp} />
            </div>
          )}

          {/* Quick scheduling buttons */}
          <div className="flex gap-2 flex-wrap">
            <Button
              variant="outline"
              size="sm"
              asChild
              className="border-pink-500/40 text-pink-400 hover:bg-pink-500/10 text-xs"
            >
              <a href={UNLICENSED_SCHEDULING_LINK} target="_blank" rel="noreferrer">
                <CalendarClock className="h-3.5 w-3.5 mr-1.5" />
                Unlicensed Call Link
                <ExternalLink className="h-3 w-3 ml-1 opacity-60" />
              </a>
            </Button>
            <Button
              variant="outline"
              size="sm"
              asChild
              className="border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10 text-xs"
            >
              <a href={LICENSED_SCHEDULING_LINK} target="_blank" rel="noreferrer">
                <Award className="h-3.5 w-3.5 mr-1.5" />
                Licensed Call Link
                <ExternalLink className="h-3 w-3 ml-1 opacity-60" />
              </a>
            </Button>
          </div>
        </div>

      </motion.div>

      {/* ── Stat bubbles ── */}
      <div className="grid grid-cols-4 gap-1.5">
        <StatBubble icon={Users} label="Total Hired (Unlicensed)" value={totalLeads} color="border border-pink-500/20 bg-pink-500/5 text-pink-400" delay={0} />
        <StatBubble icon={AlertTriangle} label="Needs Contact" value={needsContact} color="border border-rose-500/20 bg-rose-500/5 text-rose-400" delay={0.06} />
        <StatBubble icon={TrendingUp} label="Actively In Progress" value={inProgress} color="border border-purple-500/20 bg-purple-500/5 text-purple-400" delay={0.12} />
        <StatBubble icon={Star} label="New This Month" value={thisMonth} color="border border-amber-500/20 bg-amber-500/5 text-amber-400" delay={0.18} />
      </div>

      {/* ── Performance Metrics Strip ── */}
      {isFeatureEnabled("performanceMetrics") && <MetricsStrip leads={leads} />}

      {/* ── Daily Challenges ── */}
      <DailyChallenge leads={leads} onXP={addXP} />

      {/* ── AI Intelligence Panel ── */}
      <RecruiterAIPanel leads={leads} />

      {/* ── Search / Filter / Sort ── */}
      <GlassCard className="p-2 space-y-1">
        {/* Search bar */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by name, email, or phone…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 text-sm"
          />
        </div>

        {/* Filter by stage + Sort + Focus Mode in one scrollable row */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
          <span className="text-xs text-muted-foreground shrink-0 font-medium">Filter:</span>
          <Button
            variant={filterStage === "all" ? "default" : "outline"}
            size="sm"
            onClick={() => setFilterStage("all")}
            className="text-xs shrink-0 h-7"
          >All</Button>
          {PROGRESS_COLUMNS.map((col) => (
            <Button
              key={col.id}
              variant={filterStage === col.id ? "default" : "outline"}
              size="sm"
              onClick={() => setFilterStage(col.id)}
              className="text-xs shrink-0 h-7"
            >
              {col.emoji} {col.label}
            </Button>
          ))}

          <div className="w-px h-5 bg-border shrink-0 mx-1" />

          <span className="text-xs text-muted-foreground shrink-0 font-medium">Sort:</span>
          <select
            value={sortMode}
            onChange={(e) => setSortMode(e.target.value as SortMode)}
            className="h-7 text-xs rounded-md border border-input bg-background px-2 text-foreground shrink-0 cursor-pointer"
          >
            <option value="stale">Needs Contact First</option>
            <option value="score">Lead Score ↓</option>
            <option value="newest">Newest First</option>
            <option value="oldest">Oldest First</option>
            <option value="name">Name A–Z</option>
          </select>

          <div className="w-px h-5 bg-border shrink-0 mx-1" />

          {/* Focus Mode toggle */}
          <Button
            variant={focusMode ? "default" : "outline"}
            size="sm"
            onClick={() => setFocusMode((v) => !v)}
            className={cn(
              "text-xs shrink-0 h-7 gap-1",
              focusMode && "bg-amber-500/20 text-amber-400 border-amber-500/30 hover:bg-amber-500/30"
            )}
          >
            {focusMode ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
            Focus Mode
          </Button>
        </div>
      </GlassCard>

      {/* ── Focus Mode Banner ── */}
      {focusMode && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2"
        >
          <Target className="h-4 w-4 text-amber-400 shrink-0" />
          <span className="text-sm font-medium text-amber-400">
            Focus Mode — Showing only urgent leads ({filtered.length})
          </span>
        </motion.div>
      )}

      {/* ── Action Required Banner ── */}
      {!focusMode && (() => {
        const overdueLeads = leads.filter(isOverdue);
        if (overdueLeads.length === 0) return null;
        return (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center justify-between gap-3 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-2.5"
          >
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-rose-400 shrink-0" />
              <span className="text-sm font-medium text-rose-400">
                {overdueLeads.length} lead{overdueLeads.length > 1 ? "s" : ""} overdue for follow-up
              </span>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="text-xs h-7 border-rose-500/30 text-rose-400 hover:bg-rose-500/20"
              onClick={async () => {
                const ids = overdueLeads.map((l) => l.id);
                await supabase
                  .from("applications")
                  .update({ last_contacted_at: new Date().toISOString() })
                  .in("id", ids);
                for (const l of overdueLeads) {
                  logLeadActivity({
                    leadId: l.id,
                    type: "followup_completed",
                    title: "Follow-up marked done",
                    details: {},
                  });
                }
                toast.success(`Marked ${ids.length} follow-ups done`);
                fetchLeads(true);
              }}
            >
              Mark All Done
            </Button>
          </motion.div>
        );
      })()}

      {/* ── Mobile Column Picker (segmented tabs) ── */}
      {isMobile && (
        <div className="flex gap-1.5 overflow-x-auto pb-1 sticky top-0 z-10 bg-background/80 backdrop-blur-sm py-2 -mx-4 px-4">
          {columnLeads.map((col) => (
            <button
              key={col.id}
              onClick={() => setMobileColumn(col.id)}
              className={cn(
                "flex items-center gap-1 shrink-0 rounded-full px-3 py-1.5 text-xs font-medium border transition-colors",
                mobileColumn === col.id
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-card border-border text-muted-foreground hover:text-foreground"
              )}
            >
              <span>{col.emoji}</span>
              <span className="hidden sm:inline">{col.label}</span>
              <Badge variant="outline" className="text-[9px] ml-0.5 h-4 px-1 border-current">
                {col.leads.length}
              </Badge>
              {col.needsAttention > 0 && (
                <span className="flex items-center justify-center h-4 w-4 rounded-full bg-rose-500/20 text-rose-400 text-[9px] font-bold">
                  {col.needsAttention}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* ── Kanban columns ── */}
      {isMobile ? (
        // Mobile: show only selected column
        (() => {
          const col = columnLeads.find((c) => c.id === mobileColumn) || columnLeads[0];
          if (!col) return null;
          return (
            <div className={cn("rounded-xl border p-2 min-h-[200px]", col.color)}>
              <div className={cn("flex items-center gap-2 mb-2 font-bold text-sm", col.headerColor)}>
                <span className="text-base">{col.emoji}</span>
                <span>{col.label}</span>
                {col.needsAttention > 0 && (
                  <span className="flex items-center gap-0.5 text-[10px] font-medium text-rose-400 bg-rose-500/15 border border-rose-500/30 rounded-full px-1.5 py-0">
                    <AlertCircle className="h-2.5 w-2.5" />
                    {col.needsAttention}
                  </span>
                )}
                <Badge variant="outline" className={cn("ml-auto text-xs border", col.headerColor.replace("text-", "border-").replace("-400", "-400/40"))}>
                  {col.leads.length}
                </Badge>
              </div>
                <div className="space-y-1.5">
                <AnimatePresence mode="popLayout">
                  {col.leads.length === 0 ? (
                    <motion.p key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-xs text-muted-foreground text-center py-4">
                      No leads here yet ✨
                    </motion.p>
                  ) : (
                    col.leads.map((lead) => (
                      <LeadCard
                        key={lead.id}
                        lead={lead}
                        agentId={agentId}
                        onRefresh={() => fetchLeads(true)}
                        onXP={addXP}
                        onCelebrate={triggerCelebrate}
                        onDetailClick={setDetailLead}
                        disableHover
                      />
                    ))
                  )}
                </AnimatePresence>
              </div>
            </div>
          );
        })()
      ) : (
        // Desktop: full grid with scroll containers
        <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-5 gap-2">
          {columnLeads.map((col, ci) => {
            const isLargeList = col.leads.length >= ANIMATION_THRESHOLDS.disableHoverAboveCards;
            return (
              <motion.div
                key={col.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: ci * 0.06 }}
                className={cn("rounded-xl border p-2 min-h-[200px] flex flex-col", col.color)}
              >
                {/* Column header */}
                <div className={cn("flex items-center gap-2 mb-2 font-bold text-sm shrink-0", col.headerColor)}>
                  <span className="text-base">{col.emoji}</span>
                  <span>{col.label}</span>
                  {col.needsAttention > 0 && (
                    <span className="flex items-center gap-0.5 text-[10px] font-medium text-rose-400 bg-rose-500/15 border border-rose-500/30 rounded-full px-1.5 py-0">
                      <AlertCircle className="h-2.5 w-2.5" />
                      {col.needsAttention}
                    </span>
                  )}
                  <Badge variant="outline" className={cn("ml-auto text-xs border", col.headerColor.replace("text-", "border-").replace("-400", "-400/40"))}>
                    {col.leads.length}
                  </Badge>
                </div>

                {/* Lead cards with max height scroll */}
                <div className="space-y-1.5 max-h-[70vh] overflow-y-auto flex-1 pr-0.5">
                  <AnimatePresence mode="popLayout">
                    {col.leads.length === 0 ? (
                      <motion.p
                        key="empty"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="text-xs text-muted-foreground text-center py-4"
                      >
                        No leads here yet ✨
                      </motion.p>
                    ) : (
                      col.leads.map((lead) => (
                        <LeadCard
                          key={lead.id}
                          lead={lead}
                          agentId={agentId}
                          onRefresh={() => fetchLeads(true)}
                          onXP={addXP}
                          onCelebrate={triggerCelebrate}
                          onDetailClick={setDetailLead}
                          disableHover={isLargeList}
                        />
                      ))
                    )}
                  </AnimatePresence>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Empty state */}
      {filtered.length === 0 && !loading && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="text-center py-16 text-muted-foreground"
        >
          <Sparkles className="h-12 w-12 mx-auto mb-4 text-pink-400/50" />
          <p className="text-lg font-medium">No leads match your search</p>
          <p className="text-sm mt-1">Try adjusting your filters</p>
        </motion.div>
      )}

      {/* ── Lead Detail Sheet (Communication Hub) ── */}
      <LeadDetailSheet
        lead={detailLead}
        open={!!detailLead}
        onOpenChange={(open) => !open && setDetailLead(null)}
        onRefresh={() => fetchLeads(true)}
      />
    </div>
  );
}
