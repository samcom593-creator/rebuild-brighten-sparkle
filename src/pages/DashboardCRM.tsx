import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Users, Search, RefreshCw, Clock, AlertTriangle, ChevronDown, ChevronRight,
  Mail, Phone, UserX, Filter, Mic, BookOpen, GraduationCap, Briefcase,
  Instagram, X, Send, CheckSquare, EyeOff, Link2, Eye, FileText,
  CheckCircle2, KeyRound, Copy, StickyNote, ClipboardCheck, Circle, CircleCheck,
} from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { OnboardingTracker } from "@/components/dashboard/OnboardingTracker";
import { AddAgentModal } from "@/components/dashboard/AddAgentModal";
import { AttendanceGrid } from "@/components/dashboard/AttendanceGrid";
import { AgentNotes } from "@/components/dashboard/AgentNotes";
import { DeactivateAgentDialog } from "@/components/dashboard/DeactivateAgentDialog";
import { InstagramPromptDialog } from "@/components/dashboard/InstagramPromptDialog";
import { BulkStageActions, AgentSelectCheckbox } from "@/components/crm/BulkStageActions";
import { cn } from "@/lib/utils";
import { BackgroundGlow } from "@/components/ui/BackgroundGlow";
import { Database } from "@/integrations/supabase/types";
import { ResendLicensingButton } from "@/components/callcenter/ResendLicensingButton";
import { InterviewRecorder } from "@/components/dashboard/InterviewRecorder";
import { LicenseProgressSelector } from "@/components/dashboard/LicenseProgressSelector";
import { ApplicationDetailSheet } from "@/components/dashboard/ApplicationDetailSheet";
import { AgentQuickEditDialog } from "@/components/dashboard/AgentQuickEditDialog";
import { useSoundEffects } from "@/hooks/useSoundEffects";
import { differenceInDays } from "date-fns";

type AttendanceStatus = Database["public"]["Enums"]["attendance_status"];
type PerformanceTier = Database["public"]["Enums"]["performance_tier"];
type OnboardingStage = Database["public"]["Enums"]["onboarding_stage"];

interface Manager { id: string; name: string; }

interface AgentCRM {
  id: string; userId: string; name: string; applicationId?: string;
  email: string; phone?: string; avatarUrl?: string; instagramHandle?: string;
  onboardingStage: OnboardingStage; attendanceStatus: AttendanceStatus;
  performanceTier: PerformanceTier; fieldTrainingStartedAt?: string; startDate?: string;
  onboardingCompletedAt?: string;
  totalEarnings: number; hasTrainingCourse: boolean; hasDialerLogin: boolean; hasDiscordAccess: boolean;
  potentialRating: number; evaluationResult?: string | null;
  isDeactivated: boolean; isInactive: boolean; managerId?: string; managerName?: string;
  weekly10kBadges: number; sortOrder: number;
  weeklyALP: number; weeklyPresentations: number; weeklyDeals: number; weeklyClosingRate: number;
  monthlyALP: number; monthlyDeals: number; prevWeekALP: number;
  lastContactedAt: string | null; standardPaid: boolean; premiumPaid: boolean;
  licenseProgress: string | null; testScheduledDate: string | null; agentLicenseStatus: string;
}

const attendanceColors: Record<AttendanceStatus, string> = {
  good: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
  warning: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
  critical: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20",
};
const attendanceLabels: Record<AttendanceStatus, string> = { good: "Good", warning: "Warning", critical: "Critical" };

const AVATAR_COLORS = [
  "from-primary to-cyan-500", "from-violet-500 to-purple-500", "from-rose-500 to-pink-500",
  "from-amber-500 to-orange-500", "from-emerald-500 to-teal-500", "from-blue-500 to-indigo-500",
  "from-fuchsia-500 to-pink-500", "from-cyan-500 to-blue-500",
];
const getAvatarColor = (name: string) => {
  const hash = name.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
};

const getTimeAgo = (dateString: string): string => {
  const date = new Date(dateString);
  const diffMs = Date.now() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffHours / 24);
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

const isStaleAgent = (agent: AgentCRM): boolean => {
  if (!agent.lastContactedAt) {
    // Agents with no contact date are stale only if they've been around (have activity or are not brand new)
    return true;
  }
  const daysSince = (Date.now() - new Date(agent.lastContactedAt).getTime()) / (1000 * 60 * 60 * 24);
  return daysSince >= 6;
};

const getContactInfo = (agent: AgentCRM) => {
  if (!agent.lastContactedAt) {
    return { label: "Never", color: "text-red-500 dark:text-red-400" };
  }
  const days = (Date.now() - new Date(agent.lastContactedAt).getTime()) / (1000 * 60 * 60 * 24);
  if (days < 3) return { label: getTimeAgo(agent.lastContactedAt), color: "text-emerald-600 dark:text-emerald-400" };
  if (days < 6) return { label: getTimeAgo(agent.lastContactedAt), color: "text-amber-600 dark:text-amber-400" };
  return { label: getTimeAgo(agent.lastContactedAt), color: "text-red-500 dark:text-red-400" };
};

const SECTIONS = [
  { key: "applied", label: "Applied", icon: Users, stages: ["applied"] as OnboardingStage[], accent: "border-l-blue-500", headerBg: "bg-blue-500/5", iconColor: "text-blue-500" },
  { key: "meeting_attendance", label: "Meeting Attendance", icon: ClipboardCheck, stages: ["meeting_attendance"] as OnboardingStage[], accent: "border-l-purple-500", headerBg: "bg-purple-500/5", iconColor: "text-purple-500" },
  { key: "pre_licensed", label: "Pre-Licensed", icon: GraduationCap, stages: ["pre_licensed", "onboarding", "training_online"] as OnboardingStage[], accent: "border-l-yellow-500", headerBg: "bg-yellow-500/5", iconColor: "text-yellow-500" },
  { key: "transfer", label: "Transfer", icon: Users, stages: ["transfer"] as OnboardingStage[], accent: "border-l-orange-500", headerBg: "bg-orange-500/5", iconColor: "text-orange-500" },
  { key: "in_training", label: "In-Field Training", icon: GraduationCap, stages: ["in_field_training"] as OnboardingStage[], accent: "border-l-teal-500", headerBg: "bg-teal-500/5", iconColor: "text-teal-500" },
  { key: "below_10k", label: "Below $10K", icon: AlertTriangle, stages: ["below_10k"] as OnboardingStage[], accent: "border-l-red-500", headerBg: "bg-red-500/5", iconColor: "text-red-500" },
  { key: "live", label: "Live", icon: Briefcase, stages: ["live", "evaluated"] as OnboardingStage[], accent: "border-l-emerald-500", headerBg: "bg-emerald-500/5", iconColor: "text-emerald-500" },
  { key: "needs_followup", label: "Needs Follow-Up", icon: AlertTriangle, stages: ["need_followup"] as OnboardingStage[], accent: "border-l-amber-500", headerBg: "bg-amber-500/5", iconColor: "text-amber-500" },
  { key: "inactive", label: "Inactive", icon: UserX, stages: ["inactive"] as OnboardingStage[], accent: "border-l-gray-500", headerBg: "bg-gray-500/5", iconColor: "text-gray-500" },
];

const UNLICENSED_COLUMNS = [
  { key: "unlicensed", label: "Course Not Purchased", progress: ["unlicensed"] },
  { key: "course_purchased", label: "Course Purchased", progress: ["course_purchased"] },
  { key: "finished_course", label: "Course Finished", progress: ["finished_course"] },
  { key: "test_scheduled", label: "Test Scheduled", progress: ["test_scheduled", "passed_test"] },
  { key: "waiting_on_license", label: "Waiting on License", progress: ["fingerprints_done", "waiting_on_license"] },
];

// ─── Contact buttons row ─────────────────────────────────────────────────
function ContactActions({ agent, onViewApp, onRecord, onEditLogin, onDeactivate, onAgentUpdate, currentAgentId }: {
  agent: AgentCRM; onViewApp: (id: string) => void; onRecord: (a: AgentCRM) => void;
  onEditLogin: (a: AgentCRM) => void; onDeactivate: (a: AgentCRM) => void;
  onAgentUpdate: (id: string, updates: Partial<AgentCRM>) => void; currentAgentId: string | null;
}) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {agent.phone && (
        <Button variant="outline" size="sm" className="h-7 text-xs gap-1" asChild>
          <a href={`tel:${agent.phone}`}><Phone className="h-3 w-3" /> Call</a>
        </Button>
      )}
      {agent.email && (
        <Button variant="outline" size="sm" className="h-7 text-xs gap-1" asChild>
          <a href={`mailto:${agent.email}`}><Mail className="h-3 w-3" /> Email</a>
        </Button>
      )}
      {agent.instagramHandle && (
        <Button variant="outline" size="sm" className="h-7 text-xs gap-1" asChild>
          <a href={`https://instagram.com/${agent.instagramHandle.replace('@', '')}`} target="_blank" rel="noopener noreferrer">
            <Instagram className="h-3 w-3" /> IG
          </a>
        </Button>
      )}
      <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => onViewApp(agent.id)}>
        <FileText className="h-3 w-3" /> App
      </Button>
      {agent.userId && (
        <>
          <Button variant="outline" size="sm" className="h-7 text-xs gap-1"
            onClick={async () => {
              try {
                const { data, error } = await supabase.functions.invoke("send-agent-portal-login", { body: { agentId: agent.id } });
                if (error) throw error;
                if (data?.success === false) throw new Error(data.error || "Failed");
                toast.success(`Portal login sent to ${agent.email}`);
              } catch (err: any) { toast.error(err.message || "Failed to send"); }
            }}>
            <Send className="h-3 w-3" /> Portal
          </Button>
          <Button variant="outline" size="sm" className="h-7 text-xs gap-1"
            onClick={() => { navigator.clipboard.writeText(`${window.location.origin}/login`); toast.success("Login link copied!"); }}>
            <Copy className="h-3 w-3" /> Link
          </Button>
          <Button variant="outline" size="sm" className="h-7 text-xs gap-1 border-amber-500/30 text-amber-600 dark:text-amber-400 hover:bg-amber-500/10"
            onClick={() => onEditLogin(agent)}>
            <KeyRound className="h-3 w-3" /> Login
          </Button>
        </>
      )}
      <div className="flex-1" />
      <Button variant="ghost" size="sm" className="h-7 text-xs gap-1 text-amber-600 dark:text-amber-400 hover:bg-amber-500/10"
        onClick={async () => {
          try {
            await supabase.from("agents").update({ is_inactive: true }).eq("id", agent.id);
            onAgentUpdate(agent.id, { isInactive: true });
            toast.success(`${agent.name} hidden`);
          } catch { toast.error("Failed"); }
        }}>
        <EyeOff className="h-3 w-3" /> Hide
      </Button>
      <Button variant="ghost" size="sm" className="h-7 text-xs gap-1 text-destructive hover:bg-destructive/10"
        onClick={() => onDeactivate(agent)}>
        <X className="h-3 w-3" /> Remove
      </Button>
    </div>
  );
}

// ─── ONBOARDING Expanded Row ──────────────────────────────────────────────
function OnboardingExpandedRow({ agent, onRefresh, onStageUpdate, onGoLive, onDeactivate, onViewApp, onRecord, onEditLogin, onAgentUpdate, playSound, sendingCourseLogin, setSendingCourseLogin, currentAgentId }: any) {
  return (
    <div className="overflow-hidden animate-in fade-in-0 slide-in-from-top-1 duration-200">
      <div className="px-4 py-3 border-t border-border space-y-3 rounded-b-lg bg-card/80 backdrop-blur-sm shadow-inner border-l-2 border-l-primary">
        <ContactActions agent={agent} onViewApp={onViewApp} onRecord={onRecord} onEditLogin={onEditLogin} onDeactivate={onDeactivate} onAgentUpdate={onAgentUpdate} currentAgentId={currentAgentId} />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-3">
            {/* License status badge */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground w-16">License:</span>
              <Badge variant="outline" className={cn("text-xs", agent.agentLicenseStatus === "licensed" ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20" : "bg-muted text-muted-foreground")}>
                {agent.agentLicenseStatus === "licensed" ? "Licensed" : "Unlicensed"}
              </Badge>
            </div>
            {/* License Progress selector */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground w-16">Progress:</span>
              <LicenseProgressSelector
                applicationId={agent.applicationId || agent.id}
                agentId={agent.userId ? agent.id : undefined}
                currentProgress={(agent.licenseProgress || "unlicensed") as any}
                testScheduledDate={agent.testScheduledDate}
                onProgressUpdated={onRefresh}
                className="h-6 text-xs"
              />
              {agent.licenseProgress !== "licensed" && (
                <ResendLicensingButton recipientEmail={agent.email} recipientName={agent.name} licenseStatus="unlicensed" />
              )}
            </div>
            {/* Course progress dots */}
            <div className="space-y-1">
              <p className="text-[10px] text-muted-foreground font-medium">Course Progress</p>
              <div className="flex items-center gap-1">
                {["unlicensed", "course_purchased", "finished_course", "test_scheduled", "licensed"].map((step, i) => {
                  const progress = agent.licenseProgress || "unlicensed";
                  const steps = ["unlicensed", "course_purchased", "finished_course", "test_scheduled", "licensed"];
                  const currentIdx = steps.indexOf(progress);
                  const isComplete = i <= currentIdx;
                  return (
                    <div key={step} className="flex items-center gap-1">
                      <div className={cn("h-2.5 w-2.5 rounded-full border", isComplete ? "bg-primary border-primary" : "bg-muted border-border")} />
                      {i < 4 && <div className={cn("h-0.5 w-4", isComplete ? "bg-primary" : "bg-border")} />}
                    </div>
                  );
                })}
              </div>
              <p className="text-[10px] text-muted-foreground capitalize">{(agent.licenseProgress || "unlicensed").replace(/_/g, " ")}</p>
            </div>
            {/* Resend course login */}
            <Button variant="outline" size="sm" className="w-full h-7 text-xs gap-1.5"
              disabled={sendingCourseLogin === agent.id}
              onClick={async () => {
                setSendingCourseLogin(agent.id);
                try {
                  const { data, error } = await supabase.functions.invoke("send-course-enrollment-email", { body: { agentId: agent.id } });
                  if (error) throw error;
                  if (data?.success === false) throw new Error(data.error || "Failed");
                  toast.success(`Course login sent to ${agent.name}`);
                  playSound("success");
                } catch { toast.error("Failed to send"); }
                finally { setSendingCourseLogin(null); }
              }}>
              {sendingCourseLogin === agent.id ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
              Resend Course Login
            </Button>
            {/* Onboarding stage tracker */}
            <OnboardingTracker agentId={agent.id} agentName={agent.name} currentStage={agent.onboardingStage}
              onStageUpdate={() => onStageUpdate(agent.id)} onGoLive={() => onGoLive(agent)} readOnly={false} />
          </div>
          <div className="space-y-3">
            <AgentNotes agentId={agent.id} onNoteAdded={() => {}} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── IN-FIELD TRAINING Expanded Row ───────────────────────────────────────
function TrainingExpandedRow({ agent, onRefresh, onStageUpdate, onGoLive, onDeactivate, onViewApp, onRecord, onEditLogin, onAgentUpdate, currentAgentId }: any) {
  return (
    <div className="overflow-hidden animate-in fade-in-0 slide-in-from-top-1 duration-200">
      <div className="px-4 py-3 border-t border-border space-y-3 rounded-b-lg bg-card/80 backdrop-blur-sm shadow-inner border-l-2 border-l-amber-500">
        <ContactActions agent={agent} onViewApp={onViewApp} onRecord={onRecord} onEditLogin={onEditLogin} onDeactivate={onDeactivate} onAgentUpdate={onAgentUpdate} currentAgentId={currentAgentId} />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-2">
            <p className="text-xs font-semibold text-muted-foreground">📋 Attendance</p>
            <AttendanceGrid agentId={agent.id} type="training" label="Training" onMarkAbsent={() => {}} />
            <AttendanceGrid agentId={agent.id} type="onboarded_meeting" label="Meetings" onMarkAbsent={() => {}} />
          </div>
          <div className="space-y-2">
            <p className="text-xs font-semibold text-muted-foreground">📝 Homework</p>
            <AttendanceGrid agentId={agent.id} type="daily_sale" label="Homework" onMarkAbsent={() => {}} />
            <OnboardingTracker agentId={agent.id} agentName={agent.name} currentStage={agent.onboardingStage}
              onStageUpdate={() => onStageUpdate(agent.id)} onGoLive={() => onGoLive(agent)} readOnly={false} />
            <AgentNotes agentId={agent.id} onNoteAdded={() => {}} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── LIVE Expanded Row ────────────────────────────────────────────────────
function LiveExpandedRow({ agent, onRefresh, onDeactivate, onViewApp, onRecord, onEditLogin, onAgentUpdate, currentAgentId }: any) {
  return (
    <div className="overflow-hidden animate-in fade-in-0 slide-in-from-top-1 duration-200">
      <div className="px-4 py-3 border-t border-border space-y-3 rounded-b-lg bg-card/80 backdrop-blur-sm shadow-inner border-l-2 border-l-emerald-500">
        <ContactActions agent={agent} onViewApp={onViewApp} onRecord={onRecord} onEditLogin={onEditLogin} onDeactivate={onDeactivate} onAgentUpdate={onAgentUpdate} currentAgentId={currentAgentId} />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-2">
            {/* Production stats */}
            <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-emerald-500/5 border border-emerald-500/10">
              <div>
                <p className="text-[10px] text-muted-foreground">Week ALP</p>
                <p className="text-sm font-bold text-emerald-600 dark:text-emerald-400">${agent.weeklyALP.toLocaleString()}</p>
              </div>
              <div className="w-px h-8 bg-border" />
              <div>
                <p className="text-[10px] text-muted-foreground">Prev Week</p>
                <p className="text-sm font-bold">${agent.prevWeekALP.toLocaleString()}</p>
              </div>
              <div className="w-px h-8 bg-border" />
              <div>
                <p className="text-[10px] text-muted-foreground">Deals</p>
                <p className="text-sm font-bold">{agent.weeklyDeals}</p>
              </div>
            </div>
            <p className="text-xs font-semibold text-muted-foreground">📋 Attendance</p>
            <AttendanceGrid agentId={agent.id} type="onboarded_meeting" label="Meeting" onMarkAbsent={() => {}} />
            <AttendanceGrid agentId={agent.id} type="daily_sale" label="Sold" onMarkAbsent={() => {}} />
          </div>
          <div className="space-y-2">
            <AgentNotes agentId={agent.id} onNoteAdded={() => {}} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── NEEDS FOLLOW-UP Expanded Row ─────────────────────────────────────────
function FollowUpExpandedRow({ agent, onRefresh, onDeactivate, onViewApp, onRecord, onEditLogin, onAgentUpdate, onStageUpdate, onGoLive, currentAgentId }: any) {
  const daysSinceContact = agent.lastContactedAt ? Math.floor((Date.now() - new Date(agent.lastContactedAt).getTime()) / (1000 * 60 * 60 * 24)) : null;
  return (
    <div className="overflow-hidden animate-in fade-in-0 slide-in-from-top-1 duration-200">
      <div className="px-4 py-3 border-t border-border space-y-3 rounded-b-lg bg-card/80 backdrop-blur-sm shadow-inner border-l-2 border-l-red-500">
        <ContactActions agent={agent} onViewApp={onViewApp} onRecord={onRecord} onEditLogin={onEditLogin} onDeactivate={onDeactivate} onAgentUpdate={onAgentUpdate} currentAgentId={currentAgentId} />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-xs bg-red-500/10 text-red-500 border-red-500/20">
                <Clock className="h-3 w-3 mr-1" />
                {daysSinceContact !== null ? `${daysSinceContact}d since contact` : "Never contacted"}
              </Badge>
              <Badge variant="outline" className="text-xs">
                Stage: {agent.onboardingStage.replace(/_/g, " ")}
              </Badge>
            </div>
            <OnboardingTracker agentId={agent.id} agentName={agent.name} currentStage={agent.onboardingStage}
              onStageUpdate={() => onStageUpdate(agent.id)} onGoLive={() => onGoLive(agent)} readOnly={false} />
          </div>
          <div className="space-y-2">
            <AgentNotes agentId={agent.id} onNoteAdded={() => {}} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Inline Notes Quick Input ─────────────────────────────────────────────
function InlineNotesButton({ agent }: { agent: AgentCRM }) {
  const [open, setOpen] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [saving, setSaving] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [latestNote, setLatestNote] = useState<string | null>(null);
  const ref = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  // Fetch latest note on mount
  React.useEffect(() => {
    supabase.from("agent_notes").select("note").eq("agent_id", agent.id).order("created_at", { ascending: false }).limit(1)
      .then(({ data }) => { if (data?.[0]) setLatestNote(data[0].note); });
  }, [agent.id]);

  // Close on outside click
  React.useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Auto-focus input when opened
  React.useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  const handleSubmit = async () => {
    if (!noteText.trim() || saving) return;
    setSaving(true);
    try {
      const { error } = await supabase.from("agent_notes").insert({ agent_id: agent.id, note: noteText.trim() });
      if (error) throw error;
      setLatestNote(noteText.trim());
      setNoteText("");
      setShowSuccess(true);
      setTimeout(() => setShowSuccess(false), 1200);
    } catch { toast.error("Failed to save note"); }
    finally { setSaving(false); }
  };

  return (
    <div className="relative flex items-center gap-1" ref={ref} onClick={e => e.stopPropagation()}>
      {latestNote && !open && (
        <span className="text-[9px] text-muted-foreground truncate max-w-[80px]" title={latestNote}>
          {latestNote.slice(0, 20)}{latestNote.length > 20 ? "…" : ""}
        </span>
      )}
      <Button variant="ghost" size="sm" className={cn("h-6 w-6 p-0 transition-colors", showSuccess && "text-emerald-500")} onClick={() => setOpen(!open)}>
        {showSuccess ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 animate-in zoom-in-50 duration-300" /> : <StickyNote className="h-3.5 w-3.5 text-muted-foreground hover:text-primary" />}
      </Button>
      {open && (
        <div className="absolute right-0 top-8 z-50 w-[320px] bg-card border border-border rounded-xl shadow-xl p-3 animate-in fade-in-0 slide-in-from-top-2 duration-150">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold">Notes — {agent.name}</span>
            <Button variant="ghost" size="sm" className="h-5 w-5 p-0" onClick={() => setOpen(false)}>
              <X className="h-3 w-3" />
            </Button>
          </div>
          {/* Quick add input */}
          <div className="flex gap-1.5 mb-2">
            <Input
              ref={inputRef}
              value={noteText}
              onChange={e => setNoteText(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") handleSubmit(); }}
              placeholder="Quick note… (Enter to save)"
              className="h-7 text-xs flex-1"
              disabled={saving}
            />
            <Button size="sm" className="h-7 px-2 text-xs" onClick={handleSubmit} disabled={!noteText.trim() || saving}>
              {saving ? <RefreshCw className="h-3 w-3 animate-spin" /> : "Add"}
            </Button>
          </div>
          <AgentNotes agentId={agent.id} onNoteAdded={() => {}} />
        </div>
      )}
    </div>
  );
}

export default function DashboardCRM() {
  const { user, isAdmin, isManager, isLoading: authLoading } = useAuth();
  const { playSound } = useSoundEffects();
  const queryClient = useQueryClient();
  const [agents, setAgents] = useState<AgentCRM[]>([]);
  const [managers, setManagers] = useState<Manager[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [managerFilter, setManagerFilter] = useState<string>("all");
  const [showDeactivated, setShowDeactivated] = useState(false);
  const [showInactive, setShowInactive] = useState(false);
  const [deactivateAgent, setDeactivateAgent] = useState<AgentCRM | null>(null);
  const [instagramPromptAgent, setInstagramPromptAgent] = useState<AgentCRM | null>(null);
  const [sendingBulkLogins, setSendingBulkLogins] = useState(false);
  const [bulkMode, setBulkMode] = useState(false);
  const [selectedAgents, setSelectedAgents] = useState<Set<string>>(new Set());
  const [sendingCourseLogin, setSendingCourseLogin] = useState<string | null>(null);
  const [recorderAgent, setRecorderAgent] = useState<AgentCRM | null>(null);
  const [viewAppTarget, setViewAppTarget] = useState<{ agentId?: string; applicationId?: string } | null>(null);
  const [expandedAgentId, setExpandedAgentId] = useState<string | null>(null);
  const [editLoginAgent, setEditLoginAgent] = useState<AgentCRM | null>(null);
  const [activeStageTab, setActiveStageTab] = useState<string>("meeting_attendance");
  const [currentAgentId, setCurrentAgentId] = useState<string | null>(null);
  const [meetingAttendance, setMeetingAttendance] = useState<Map<string, "present" | "absent" | "unmarked">>(new Map());
  const [searchParams] = useSearchParams();

  const focusAgentId = searchParams.get('focusAgentId');
  useEffect(() => {
    if (focusAgentId && agents.length > 0) {
      setExpandedAgentId(focusAgentId);
      setTimeout(() => {
        const el = document.getElementById(`agent-row-${focusAgentId}`);
        if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); playSound("whoosh"); }
      }, 500);
    }
  }, [focusAgentId, agents.length]);

  const fetchAgentsQuery = useCallback(async () => {
    try {
      const { data: managerRoles } = await supabase.from("user_roles").select("user_id").eq("role", "manager");
      if (!managerRoles?.length) return;
      const managerUserIds = managerRoles.map(r => r.user_id);
      const { data: managerAgents } = await supabase.from("agents").select("id, user_id").in("user_id", managerUserIds).eq("status", "active");
      if (!managerAgents?.length) return;
      const { data: profiles } = await supabase.from("profiles").select("user_id, full_name").in("user_id", managerUserIds);
      const profileMap = new Map(profiles?.map(p => [p.user_id, p.full_name]) || []);
      setManagers(managerAgents.map(a => ({ id: a.id, name: profileMap.get(a.user_id) || "Unknown" })));
    } catch (error) { console.error("Error fetching managers:", error); }
    try {
      const { data: currentAgent } = await supabase.from("agents").select("id").eq("user_id", user!.id).maybeSingle();
      if (!currentAgent && !isAdmin) { return []; }
      if (currentAgent) setCurrentAgentId(currentAgent.id);

      let query = supabase.from("agents").select("*").eq("status", "active").order("sort_order", { ascending: true, nullsFirst: false });
      if (isManager && !isAdmin) query = query.eq("invited_by_manager_id", currentAgent?.id);

      const { data: agentData, error } = await query;
      if (error) throw error;
      if (!agentData?.length) { return []; }

      const userIds = agentData.map(a => a.user_id).filter(Boolean);
      const managerIds = [...new Set(agentData.map(a => a.invited_by_manager_id).filter(Boolean))];
      const liveAgentIds = agentData.filter(a => a.onboarding_stage === "evaluated").map(a => a.id);
      const allAgentIds = agentData.map(a => a.id);

      const today = new Date();
      const dayOfWeek = today.getDay();
      const weekStart = new Date(today);
      weekStart.setDate(today.getDate() - dayOfWeek);
      const weekStartStr = `${weekStart.getFullYear()}-${String(weekStart.getMonth() + 1).padStart(2, '0')}-${String(weekStart.getDate()).padStart(2, '0')}`;
      const monthStartStr = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().split("T")[0];

      // Previous week range
      const prevWeekEnd = new Date(weekStart);
      prevWeekEnd.setDate(prevWeekEnd.getDate() - 1);
      const prevWeekStart = new Date(prevWeekEnd);
      prevWeekStart.setDate(prevWeekStart.getDate() - 6);
      const prevWeekStartStr = `${prevWeekStart.getFullYear()}-${String(prevWeekStart.getMonth() + 1).padStart(2, '0')}-${String(prevWeekStart.getDate()).padStart(2, '0')}`;
      const prevWeekEndStr = `${prevWeekEnd.getFullYear()}-${String(prevWeekEnd.getMonth() + 1).padStart(2, '0')}-${String(prevWeekEnd.getDate()).padStart(2, '0')}`;

      const [profilesResult, managerAgentsResult, monthlyProductionResult, prevWeekProductionResult, appContactsResult, appLicenseResult, paymentsResult] = await Promise.all([
        supabase.from("profiles").select("user_id, full_name, email, phone, avatar_url, instagram_handle").in("user_id", userIds),
        managerIds.length > 0 ? supabase.from("agents").select("id, user_id").in("id", managerIds) : Promise.resolve({ data: [] as any[] }),
        liveAgentIds.length > 0 ? supabase.from("daily_production").select("agent_id, aop, presentations, deals_closed, production_date").in("agent_id", liveAgentIds).gte("production_date", monthStartStr) : Promise.resolve({ data: [] as any[] }),
        liveAgentIds.length > 0 ? supabase.from("daily_production").select("agent_id, aop").in("agent_id", liveAgentIds).gte("production_date", prevWeekStartStr).lte("production_date", prevWeekEndStr) : Promise.resolve({ data: [] as any[] }),
        supabase.from("applications").select("assigned_agent_id, last_contacted_at").in("assigned_agent_id", allAgentIds).not("last_contacted_at", "is", null).order("last_contacted_at", { ascending: false }),
        supabase.from("applications").select("id, email, license_progress, test_scheduled_date").is("terminated_at", null),
        supabase.from("lead_payment_tracking").select("agent_id, tier, paid").eq("week_start", weekStartStr).eq("paid", true),
      ]);

      const profileMapData = new Map(profilesResult.data?.map(p => [p.user_id, p]) || []);

      let managerProfileMap = new Map<string, string>();
      const managerAgentsData = managerAgentsResult.data;
      if (managerAgentsData?.length) {
        const mUserIds = managerAgentsData.map((a: any) => a.user_id).filter(Boolean);
        const { data: mProfiles } = await supabase.from("profiles").select("user_id, full_name").in("user_id", mUserIds);
        const userToName = new Map(mProfiles?.map(p => [p.user_id, p.full_name]) || []);
        managerAgentsData.forEach((ma: any) => { if (ma.user_id) managerProfileMap.set(ma.id, userToName.get(ma.user_id) || "Unknown"); });
      }

      const weeklyProductionMap = new Map<string, { aop: number; presentations: number; deals: number }>();
      const monthlyProductionMap = new Map<string, number>();
      const monthlyDealsMap = new Map<string, number>();
      for (const prod of monthlyProductionResult.data || []) {
        monthlyProductionMap.set(prod.agent_id, (monthlyProductionMap.get(prod.agent_id) || 0) + (Number(prod.aop) || 0));
        monthlyDealsMap.set(prod.agent_id, (monthlyDealsMap.get(prod.agent_id) || 0) + (prod.deals_closed || 0));
        if (prod.production_date >= weekStartStr) {
          const e = weeklyProductionMap.get(prod.agent_id) || { aop: 0, presentations: 0, deals: 0 };
          weeklyProductionMap.set(prod.agent_id, { aop: e.aop + (Number(prod.aop) || 0), presentations: e.presentations + (prod.presentations || 0), deals: e.deals + (prod.deals_closed || 0) });
        }
      }

      // Previous week ALP
      const prevWeekALPMap = new Map<string, number>();
      for (const prod of prevWeekProductionResult.data || []) {
        prevWeekALPMap.set(prod.agent_id, (prevWeekALPMap.get(prod.agent_id) || 0) + (Number(prod.aop) || 0));
      }

      const lastContactMap = new Map<string, string>();
      for (const app of appContactsResult.data || []) {
        if (app.assigned_agent_id && app.last_contacted_at && !lastContactMap.has(app.assigned_agent_id)) lastContactMap.set(app.assigned_agent_id, app.last_contacted_at);
      }

      const progressOrder = ["unlicensed","course_purchased","finished_course","test_scheduled","passed_test","fingerprints_done","waiting_on_license","licensed"];
      const emailLicenseMap = new Map<string, { progress: string | null; testDate: string | null; appId: string }>();
      for (const app of appLicenseResult.data || []) {
        const appEmail = app.email?.toLowerCase().trim();
        if (!appEmail) continue;
        const current = emailLicenseMap.get(appEmail);
        const newIdx = progressOrder.indexOf(app.license_progress || "unlicensed");
        const curIdx = current ? progressOrder.indexOf(current.progress || "unlicensed") : -1;
        if (newIdx > curIdx) emailLicenseMap.set(appEmail, { progress: app.license_progress, testDate: app.test_scheduled_date, appId: app.id });
      }

      const paymentMap = new Map<string, { standard: boolean; premium: boolean }>();
      paymentsResult.data?.forEach((p: any) => {
        const e = paymentMap.get(p.agent_id) || { standard: false, premium: false };
        if (p.tier === "standard") e.standard = true;
        if (p.tier === "premium") e.premium = true;
        paymentMap.set(p.agent_id, e);
      });

      const crmAgents: AgentCRM[] = agentData.map((agent, index) => {
        const profile = profileMapData.get(agent.user_id);
        const ws = weeklyProductionMap.get(agent.id) || { aop: 0, presentations: 0, deals: 0 };
        const pay = paymentMap.get(agent.id) || { standard: false, premium: false };
        const emailKey = profile?.email?.toLowerCase().trim() || "";
        const licenseEntry = emailLicenseMap.get(emailKey);
        return {
          id: agent.id, userId: agent.user_id || "", name: profile?.full_name || agent.display_name || "Unknown Agent",
          applicationId: licenseEntry?.appId || undefined,
          email: profile?.email || "", phone: profile?.phone || undefined, avatarUrl: profile?.avatar_url || undefined,
          instagramHandle: profile?.instagram_handle || undefined, onboardingStage: agent.onboarding_stage || "onboarding",
          attendanceStatus: agent.attendance_status || "good", performanceTier: agent.performance_tier || "below_10k",
          fieldTrainingStartedAt: agent.field_training_started_at || undefined, startDate: agent.start_date || undefined,
          onboardingCompletedAt: agent.onboarding_completed_at || undefined,
          totalEarnings: Number(agent.total_earnings) || 0, hasTrainingCourse: agent.has_training_course || false,
          hasDialerLogin: agent.has_dialer_login || false, hasDiscordAccess: agent.has_discord_access || false,
          potentialRating: agent.potential_rating || 0, evaluationResult: agent.evaluation_result,
          isDeactivated: agent.is_deactivated || false, isInactive: (agent as any).is_inactive || false,
          managerId: agent.invited_by_manager_id || undefined, managerName: agent.invited_by_manager_id ? managerProfileMap.get(agent.invited_by_manager_id) : undefined,
          weekly10kBadges: agent.weekly_10k_badges || 0, sortOrder: agent.sort_order ?? index,
          weeklyALP: ws.aop, weeklyPresentations: ws.presentations, weeklyDeals: ws.deals,
          weeklyClosingRate: ws.presentations > 0 ? Math.round((ws.deals / ws.presentations) * 100) : 0,
          monthlyALP: monthlyProductionMap.get(agent.id) || 0, monthlyDeals: monthlyDealsMap.get(agent.id) || 0,
          prevWeekALP: prevWeekALPMap.get(agent.id) || 0,
          lastContactedAt: lastContactMap.get(agent.id) || null, standardPaid: pay.standard, premiumPaid: pay.premium,
          licenseProgress: licenseEntry?.progress || null, testScheduledDate: licenseEntry?.testDate || null,
          agentLicenseStatus: agent.license_status || "unlicensed",
        };
      });

      let appQuery = supabase.from("applications")
        .select("id, first_name, last_name, email, phone, license_status, license_progress, test_scheduled_date, status, instagram_handle, started_training")
        .is("terminated_at", null).neq("license_status", "licensed").in("status", ["approved", "contracting"]);
      if (isManager && !isAdmin && currentAgent) appQuery = appQuery.eq("assigned_agent_id", currentAgent.id);

      const { data: unlicensedApplicants } = await appQuery;
      const existingEmails = new Set(crmAgents.map(a => a.email?.toLowerCase()).filter(Boolean));
      const newApplicants: AgentCRM[] = (unlicensedApplicants || [])
        .filter(app => !existingEmails.has(app.email?.toLowerCase()))
        .map((app, index) => ({
          id: app.id, userId: "", name: `${app.first_name} ${app.last_name}`.trim(), applicationId: app.id, email: app.email || "",
          phone: app.phone || undefined, avatarUrl: undefined, instagramHandle: app.instagram_handle || undefined,
          onboardingStage: "onboarding" as OnboardingStage, attendanceStatus: "good" as AttendanceStatus,
          performanceTier: "below_10k" as PerformanceTier, fieldTrainingStartedAt: undefined, startDate: undefined,
          totalEarnings: 0, hasTrainingCourse: app.started_training || false, hasDialerLogin: false, hasDiscordAccess: false,
          potentialRating: 0, evaluationResult: null, isDeactivated: false, isInactive: false, managerId: undefined,
          managerName: undefined, weekly10kBadges: 0, sortOrder: crmAgents.length + index,
          weeklyALP: 0, weeklyPresentations: 0, weeklyDeals: 0, weeklyClosingRate: 0,
          monthlyALP: 0, monthlyDeals: 0, prevWeekALP: 0,
          lastContactedAt: null, standardPaid: false, premiumPaid: false,
          licenseProgress: app.license_progress || null, testScheduledDate: app.test_scheduled_date || null,
          agentLicenseStatus: app.license_status || "unlicensed",
        }));

      return [...crmAgents, ...newApplicants];
    } catch (error) { console.error("Error fetching CRM agents:", error); toast.error("Failed to load agents"); return []; }
  }, [user?.id, isAdmin, isManager]);

  const fetchManagersQuery = useCallback(async () => {
    try {
      const { data: managerRoles } = await supabase.from("user_roles").select("user_id").eq("role", "manager");
      if (!managerRoles?.length) return [];
      const managerUserIds = managerRoles.map(r => r.user_id);
      const { data: managerAgents } = await supabase.from("agents").select("id, user_id").in("user_id", managerUserIds).eq("status", "active");
      if (!managerAgents?.length) return [];
      const { data: profiles } = await supabase.from("profiles").select("user_id, full_name").in("user_id", managerUserIds);
      const profileMap = new Map(profiles?.map(p => [p.user_id, p.full_name]) || []);
      return managerAgents.map(a => ({ id: a.id, name: profileMap.get(a.user_id) || "Unknown" }));
    } catch (error) { console.error("Error fetching managers:", error); return []; }
  }, []);

  const { data: agentsData, isLoading: agentsLoading } = useQuery({
    queryKey: ["crm-agents", user?.id, isAdmin, isManager],
    queryFn: fetchAgentsQuery,
    enabled: !authLoading && !!user,
    staleTime: 60000,
  });

  const { data: managersData } = useQuery({
    queryKey: ["crm-managers"],
    queryFn: fetchManagersQuery,
    enabled: !authLoading && !!user && isAdmin,
    staleTime: 120000,
  });

  useEffect(() => { if (agentsData) setAgents(agentsData); }, [agentsData]);
  useEffect(() => { if (managersData) setManagers(managersData); }, [managersData]);

  // Fetch today's meeting attendance
  const todayStr = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }, []);

  useEffect(() => {
    if (!agents.length) return;
    const fetchAttendance = async () => {
      const agentIds = agents.map(a => a.id);
      const { data } = await supabase.from("agent_attendance")
        .select("agent_id, status")
        .in("agent_id", agentIds)
        .eq("attendance_date", todayStr)
        .eq("attendance_type", "agency_meeting" as any);
      const map = new Map<string, "present" | "absent" | "unmarked">();
      data?.forEach(r => map.set(r.agent_id, r.status as any));
      setMeetingAttendance(map);
    };
    fetchAttendance();
  }, [agents, todayStr]);

  const toggleMeetingAttendance = async (agentId: string) => {
    const current = meetingAttendance.get(agentId) || "unmarked";
    const next = current === "present" ? "absent" : "present";
    setMeetingAttendance(prev => { const m = new Map(prev); m.set(agentId, next); return m; });
    try {
      await supabase.from("agent_attendance").upsert({
        agent_id: agentId,
        attendance_date: todayStr,
        attendance_type: "agency_meeting" as any,
        status: next as any,
        marked_by: user?.id,
      }, { onConflict: "agent_id,attendance_date,attendance_type" as any });
    } catch { toast.error("Failed to save attendance"); }
  };

  const loading = agentsLoading;
  const fetchAgents = useCallback(() => { queryClient.invalidateQueries({ queryKey: ["crm-agents"] }); }, [queryClient]);

  const handleOptimisticStageUpdate = async (agentId: string) => {
    try {
      const { data } = await supabase.from("agents").select("onboarding_stage, onboarding_completed_at, field_training_started_at").eq("id", agentId).maybeSingle();
      if (data) setAgents(prev => prev.map(a => a.id === agentId ? { ...a, onboardingStage: data.onboarding_stage || a.onboardingStage, fieldTrainingStartedAt: data.field_training_started_at || a.fieldTrainingStartedAt, onboardingCompletedAt: data.onboarding_completed_at || a.onboardingCompletedAt } : a));
    } catch (err) { console.error("Error refreshing agent stage:", err); }
  };

  const handleBulkSendPortalLogins = async () => {
    if (!confirm(`Send portal login emails to all active agents?`)) return;
    setSendingBulkLogins(true);
    try {
      const { data, error } = await supabase.functions.invoke("send-bulk-portal-logins");
      if (error) throw error;
      toast.success(`Sent ${data?.results?.sent || 0} portal login emails!`);
    } catch { toast.error("Failed to send"); }
    finally { setSendingBulkLogins(false); }
  };

  const onAgentUpdate = (id: string, updates: Partial<AgentCRM>) => {
    setAgents(prev => prev.map(a => a.id === id ? { ...a, ...updates } : a));
  };

  const activeAgents = agents.filter(a => {
    if (!showDeactivated && a.isDeactivated) return false;
    if (!showInactive && a.isInactive) return false;
    return true;
  });

  const filteredAgents = activeAgents.filter(a => {
    const matchesSearch = !searchTerm || a.name.toLowerCase().includes(searchTerm.toLowerCase()) || a.email.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesManager = managerFilter === "all" || a.managerId === managerFilter;
    return matchesSearch && matchesManager;
  });

  const getAgentsForSection = (section: typeof SECTIONS[number]) => {
    if (section.key === "meeting_attendance") {
      return [...filteredAgents].filter(a => a.agentLicenseStatus === "licensed").sort((a, b) => a.name.localeCompare(b.name));
    }
    if (section.key === "needs_followup") {
      return filteredAgents.filter(a => {
        const isNotLive = !["evaluated", "live"].includes(a.onboardingStage);
        const daysSinceContact = a.lastContactedAt ? (Date.now() - new Date(a.lastContactedAt).getTime()) / (1000 * 60 * 60 * 24) : 999;
        return isNotLive && daysSinceContact >= 6;
      }).sort((a, b) => {
        if (!a.lastContactedAt && !b.lastContactedAt) return a.sortOrder - b.sortOrder;
        if (!a.lastContactedAt) return -1;
        if (!b.lastContactedAt) return 1;
        return new Date(a.lastContactedAt).getTime() - new Date(b.lastContactedAt).getTime();
      });
    }
    if (section.key === "inactive") {
      return filteredAgents.filter(a => a.onboardingStage === "inactive" || a.isInactive);
    }
    if (section.key === "pre_licensed") {
      return filteredAgents.filter(a => a.agentLicenseStatus !== "licensed" && section.stages.includes(a.onboardingStage));
    }
    if (section.key === "live") {
      return filteredAgents.filter(a => section.stages.includes(a.onboardingStage) && a.agentLicenseStatus === "licensed").sort((a, b) => b.weeklyALP - a.weeklyALP);
    }
    return filteredAgents.filter(a => section.stages.includes(a.onboardingStage)).sort((a, b) => {
      if (!a.lastContactedAt && !b.lastContactedAt) return a.sortOrder - b.sortOrder;
      if (!a.lastContactedAt) return -1;
      if (!b.lastContactedAt) return 1;
      return new Date(a.lastContactedAt).getTime() - new Date(b.lastContactedAt).getTime();
    });
  };

  const unlicensedAgents = filteredAgents.filter(a => a.agentLicenseStatus !== "licensed");
  const getUnlicensedForColumn = (progressValues: string[]) =>
    unlicensedAgents.filter(a => progressValues.includes(a.licenseProgress || "unlicensed"));

  const duplicateAgentIds = useMemo(() => {
    const emailCount = new Map<string, number>();
    activeAgents.forEach(a => { if (a.email) { const k = a.email.toLowerCase().trim(); emailCount.set(k, (emailCount.get(k) || 0) + 1); } });
    const dupeIds = new Set<string>();
    activeAgents.forEach(a => { if (a.email && (emailCount.get(a.email.toLowerCase().trim()) || 0) > 1) dupeIds.add(a.id); });
    return dupeIds;
  }, [activeAgents]);

  const meetingAgents = filteredAgents.filter(a => a.agentLicenseStatus === "licensed");
  const meetingPresentCount = Array.from(meetingAttendance.entries()).filter(([id, v]) => v === "present" && meetingAgents.some(a => a.id === id)).length;
  const appliedCount = filteredAgents.filter(a => a.onboardingStage === "applied").length;
  const onboardingCount = filteredAgents.filter(a => ["onboarding", "training_online"].includes(a.onboardingStage)).length;
  const preLicensedCount = filteredAgents.filter(a => a.agentLicenseStatus !== "licensed" && ["pre_licensed", "onboarding", "training_online"].includes(a.onboardingStage)).length;
  const transferCount = filteredAgents.filter(a => a.onboardingStage === "transfer").length;
  const trainingCount = filteredAgents.filter(a => a.onboardingStage === "in_field_training").length;
  const below10kCount = filteredAgents.filter(a => a.onboardingStage === "below_10k").length;
  const liveCount = filteredAgents.filter(a => ["evaluated", "live"].includes(a.onboardingStage) && a.agentLicenseStatus === "licensed").length;
  const needsFollowUpCount = getAgentsForSection(SECTIONS.find(s => s.key === "needs_followup")!).length;
  const inactiveCount = filteredAgents.filter(a => a.onboardingStage === "inactive" || a.isInactive).length;
  const staleCount = filteredAgents.filter(isStaleAgent).length;

  // Section-specific table headers
  const getTableHeaders = (sectionKey: string) => {
    switch (sectionKey) {
      case "meeting_attendance":
        return (<><TableHead className="w-[220px]">Agent</TableHead><TableHead className="w-[100px]">Mentor</TableHead><TableHead className="w-[80px] text-center">Present</TableHead><TableHead className="w-[80px] text-center">Homework</TableHead><TableHead className="w-[100px] text-right">Week ALP</TableHead><TableHead className="w-[100px] text-right">Month ALP</TableHead><TableHead className="w-8" /></>);
      case "onboarding":
        return (<><TableHead className="w-[220px]">Agent</TableHead><TableHead className="w-[90px]">Status</TableHead><TableHead className="w-[120px]">Course Progress</TableHead><TableHead className="w-8"><StickyNote className="h-3 w-3" /></TableHead><TableHead className="w-8" /></>);
      case "pre_licensed":
        return (<><TableHead className="w-[220px]">Agent</TableHead><TableHead className="w-[120px]">License Stage</TableHead><TableHead className="w-[90px]">Contact</TableHead><TableHead className="w-8"><StickyNote className="h-3 w-3" /></TableHead><TableHead className="w-8" /></>);
      case "in_training":
        return (<><TableHead className="w-[220px]">Agent</TableHead><TableHead className="w-[90px]">Attendance</TableHead><TableHead className="w-[90px]">Days Training</TableHead><TableHead className="w-8"><StickyNote className="h-3 w-3" /></TableHead><TableHead className="w-8" /></>);
      case "live":
        return (<><TableHead className="w-[220px]">Agent</TableHead><TableHead className="w-[100px] text-right">Week ALP</TableHead><TableHead className="w-[100px] text-right">Prev Week</TableHead><TableHead className="w-[60px] text-right">Deals</TableHead><TableHead className="w-[80px]">Attend.</TableHead><TableHead className="w-[80px]">Days Live</TableHead><TableHead className="w-8"><StickyNote className="h-3 w-3" /></TableHead><TableHead className="w-8" /></>);
      case "needs_followup":
        return (<><TableHead className="w-[220px]">Agent</TableHead><TableHead className="w-[100px]">Last Activity</TableHead><TableHead className="w-[80px]">Days Stale</TableHead><TableHead className="w-[90px]">Contact</TableHead><TableHead className="w-8"><StickyNote className="h-3 w-3" /></TableHead><TableHead className="w-8" /></>);
      case "applied":
      case "transfer":
      case "below_10k":
      case "inactive":
        return (<><TableHead className="w-[220px]">Agent</TableHead><TableHead className="w-[120px]">Stage</TableHead><TableHead className="w-[90px]">Contact</TableHead><TableHead className="w-8"><StickyNote className="h-3 w-3" /></TableHead><TableHead className="w-8" /></>);
      default:
        return null;
    }
  };

  // Section-specific table cells
  const getTableCells = (sectionKey: string, agent: AgentCRM) => {
    const contact = getContactInfo(agent);
    switch (sectionKey) {
      case "meeting_attendance": {
        const status = meetingAttendance.get(agent.id) || "unmarked";
        const isPresent = status === "present";
        const isTrainee = agent.onboardingStage === "in_field_training";
        const isLive = agent.onboardingStage === "evaluated" && agent.agentLicenseStatus === "licensed";
        return (<>
          <TableCell className="py-3">
            <span className="text-xs text-muted-foreground">{agent.managerName?.split(" ")[0] || "—"}</span>
          </TableCell>
          <TableCell className="py-3 text-center" onClick={e => e.stopPropagation()}>
            <button onClick={() => toggleMeetingAttendance(agent.id)} className="focus:outline-none transition-transform hover:scale-110">
              {isPresent ? (
                <CircleCheck className="h-6 w-6 text-emerald-500 fill-emerald-500/20" />
              ) : (
                <Circle className={cn("h-6 w-6", status === "absent" ? "text-red-500" : "text-muted-foreground/40")} />
              )}
            </button>
          </TableCell>
          <TableCell className="py-3 text-center">
            {isTrainee ? <Circle className="h-5 w-5 text-muted-foreground/30 mx-auto" /> : <span className="text-xs text-muted-foreground">—</span>}
          </TableCell>
          <TableCell className="py-3 text-right">
            {isLive ? <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">{agent.weeklyALP > 0 ? `$${agent.weeklyALP.toLocaleString()}` : "—"}</span> : <span className="text-xs text-muted-foreground">—</span>}
          </TableCell>
          <TableCell className="py-3 text-right">
            {isLive ? <span className="text-xs font-semibold">{agent.monthlyALP > 0 ? `$${agent.monthlyALP.toLocaleString()}` : "—"}</span> : <span className="text-xs text-muted-foreground">—</span>}
          </TableCell>
        </>);
      }
      case "onboarding": {
        const progressLabels: Record<string, string> = {
          unlicensed: "Not Started", course_purchased: "In Course", finished_course: "Finished",
          test_scheduled: "Test Sched.", passed_test: "Passed", fingerprints_done: "Fingerprints",
          waiting_on_license: "Waiting", licensed: "Licensed",
        };
        return (<>
          <TableCell className="py-2">
            <Badge variant="outline" className={cn("text-[10px]", agent.agentLicenseStatus === "licensed" ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20" : "bg-muted text-muted-foreground")}>
              {agent.agentLicenseStatus === "licensed" ? "Licensed" : "Unlicensed"}
            </Badge>
          </TableCell>
          <TableCell className="py-2">
            <span className="text-[10px] font-medium">{progressLabels[agent.licenseProgress || "unlicensed"] || "—"}</span>
          </TableCell>
          <TableCell className="py-2"><InlineNotesButton agent={agent} /></TableCell>
        </>);
      }
      case "pre_licensed": {
        const progressLabels: Record<string, string> = {
          unlicensed: "Not Started", course_purchased: "In Course", finished_course: "Finished",
          test_scheduled: "Test Sched.", passed_test: "Passed", fingerprints_done: "Fingerprints",
          waiting_on_license: "Waiting", licensed: "Licensed",
        };
        return (<>
          <TableCell className="py-2">
            <Badge variant="outline" className="text-[10px] bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/20">
              {progressLabels[agent.licenseProgress || "unlicensed"] || "—"}
            </Badge>
          </TableCell>
          <TableCell className="py-2"><span className={cn("text-xs font-medium", contact.color)}>{contact.label}</span></TableCell>
          <TableCell className="py-2"><InlineNotesButton agent={agent} /></TableCell>
        </>);
      }
      case "in_training": {
        const daysInTraining = agent.fieldTrainingStartedAt ? differenceInDays(new Date(), new Date(agent.fieldTrainingStartedAt)) : null;
        const trainingColor = daysInTraining === null ? "bg-muted text-muted-foreground" : daysInTraining < 14 ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20" : daysInTraining < 30 ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20" : "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20";
        return (<>
          <TableCell className="py-3">
            <Badge variant="outline" className={cn("text-[10px]", attendanceColors[agent.attendanceStatus])}>{attendanceLabels[agent.attendanceStatus]}</Badge>
          </TableCell>
          <TableCell className="py-3">
            <Badge variant="outline" className={cn("text-[10px] font-bold tabular-nums", trainingColor)}>
              {daysInTraining !== null ? `${daysInTraining}d` : "—"}
            </Badge>
          </TableCell>
          <TableCell className="py-3"><InlineNotesButton agent={agent} /></TableCell>
        </>);
      }
      case "live": {
        const daysLive = agent.onboardingCompletedAt ? differenceInDays(new Date(), new Date(agent.onboardingCompletedAt)) : null;
        return (<>
          <TableCell className="py-3 text-right"><span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">{agent.weeklyALP > 0 ? `$${agent.weeklyALP.toLocaleString()}` : "—"}</span></TableCell>
          <TableCell className="py-3 text-right"><span className="text-xs">{agent.prevWeekALP > 0 ? `$${agent.prevWeekALP.toLocaleString()}` : "—"}</span></TableCell>
          <TableCell className="py-3 text-right"><span className="text-xs font-semibold">{agent.weeklyDeals > 0 ? agent.weeklyDeals : "—"}</span></TableCell>
          <TableCell className="py-3">
            <Badge variant="outline" className={cn("text-[10px]", attendanceColors[agent.attendanceStatus])}>{attendanceLabels[agent.attendanceStatus]}</Badge>
          </TableCell>
          <TableCell className="py-3">
            <Badge variant="outline" className="text-[10px] font-bold tabular-nums bg-muted/50">{daysLive !== null ? `${daysLive}d` : "—"}</Badge>
          </TableCell>
          <TableCell className="py-3"><InlineNotesButton agent={agent} /></TableCell>
        </>);
      }
      case "needs_followup": {
        const daysSince = agent.lastContactedAt ? Math.floor((Date.now() - new Date(agent.lastContactedAt).getTime()) / (1000 * 60 * 60 * 24)) : null;
        return (<>
          <TableCell className="py-2"><span className="text-xs">{agent.lastContactedAt ? getTimeAgo(agent.lastContactedAt) : "Never"}</span></TableCell>
          <TableCell className="py-2">
            <Badge variant="outline" className="text-[10px] bg-red-500/10 text-red-500 border-red-500/20">{daysSince !== null ? `${daysSince}d` : "∞"}</Badge>
          </TableCell>
          <TableCell className="py-2"><span className={cn("text-xs font-medium", contact.color)}>{contact.label}</span></TableCell>
          <TableCell className="py-2"><InlineNotesButton agent={agent} /></TableCell>
        </>);
      }
      default: return null;
    }
  };

  // Render the correct expanded row based on section
  const renderExpandedRow = (sectionKey: string, agent: AgentCRM) => {
    const commonProps = {
      agent, onRefresh: fetchAgents, onStageUpdate: handleOptimisticStageUpdate,
      onGoLive: setInstagramPromptAgent, onDeactivate: setDeactivateAgent,
      onViewApp: (id: string) => { const a = agents.find(ag => ag.id === id); setViewAppTarget({ agentId: id, applicationId: a?.applicationId }); },
      onRecord: setRecorderAgent, onEditLogin: setEditLoginAgent,
      onAgentUpdate, playSound, sendingCourseLogin, setSendingCourseLogin, currentAgentId,
    };
    switch (sectionKey) {
      case "meeting_attendance": return <OnboardingExpandedRow {...commonProps} />;
      case "onboarding": return <OnboardingExpandedRow {...commonProps} />;
      case "pre_licensed": return <OnboardingExpandedRow {...commonProps} />;
      case "in_training": return <TrainingExpandedRow {...commonProps} />;
      case "live": return <LiveExpandedRow {...commonProps} />;
      case "needs_followup": return <FollowUpExpandedRow {...commonProps} />;
      default: return null;
    }
  };

  if (authLoading) {
    return <div className="flex items-center justify-center h-64"><RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <>
      <div className="space-y-4 page-enter relative">
        <BackgroundGlow accent="teal" intensity="subtle" />
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 relative z-10">
          <div>
            <h1 className="text-2xl font-bold gradient-text">Agent CRM</h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              {filteredAgents.length} agents · {staleCount > 0 && <span className="text-red-500 font-medium">{staleCount} need follow-up</span>}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {(isAdmin || isManager) && (
              <Button variant={bulkMode ? "secondary" : "outline"} size="sm" className="gap-1.5" onClick={() => { setBulkMode(!bulkMode); setSelectedAgents(new Set()); }}>
                <CheckSquare className="h-3.5 w-3.5" /> {bulkMode ? "Exit Bulk" : "Bulk Actions"}
              </Button>
            )}
            {isAdmin && (
              <Button onClick={handleBulkSendPortalLogins} variant="outline" size="sm" className="gap-1.5" disabled={sendingBulkLogins}>
                <Mail className="h-3.5 w-3.5" /> {sendingBulkLogins ? "Sending..." : "Email All Logins"}
              </Button>
            )}
            <AddAgentModal onAgentAdded={fetchAgents} />
            <Button variant="outline" size="sm" className="gap-1.5"
              onClick={() => { navigator.clipboard.writeText("https://rebuild-brighten-sparkle.lovable.app/daily-checkin"); toast.success("Check-in link copied! Paste into WhatsApp 📋"); }}>
              <Link2 className="h-3.5 w-3.5" /> Check-In Link
            </Button>
            <Button onClick={fetchAgents} variant="outline" size="sm" className="gap-1.5">
              <RefreshCw className="h-3.5 w-3.5" /> Refresh
            </Button>
          </div>
        </div>

        {bulkMode && (
          <BulkStageActions
            agents={filteredAgents.map(a => ({ id: a.id, name: a.name, onboardingStage: a.onboardingStage }))}
            selectedIds={selectedAgents} onSelectionChange={setSelectedAgents}
            onBulkUpdate={() => { fetchAgents(); setSelectedAgents(new Set()); }}
            isEnabled={bulkMode} onToggle={() => { setBulkMode(false); setSelectedAgents(new Set()); }}
          />
        )}

        <div className="grid grid-cols-2 sm:grid-cols-6 gap-2.5">
          {[
            { label: "Present Today", count: meetingPresentCount, icon: ClipboardCheck, color: "text-sky-500", borderColor: "border-t-sky-500", bgGlow: "bg-sky-500/5" },
            { label: "Onboarding", count: onboardingCount, icon: BookOpen, color: "text-primary", borderColor: "border-t-primary", bgGlow: "bg-primary/5" },
            { label: "Pre-Licensed", count: preLicensedCount, icon: GraduationCap, color: "text-violet-500", borderColor: "border-t-violet-500", bgGlow: "bg-violet-500/5" },
            { label: "In Training", count: trainingCount, icon: GraduationCap, color: "text-amber-500", borderColor: "border-t-amber-500", bgGlow: "bg-amber-500/5" },
            { label: "Live", count: liveCount, icon: Briefcase, color: "text-emerald-500", borderColor: "border-t-emerald-500", bgGlow: "bg-emerald-500/5" },
            { label: "Needs F/U", count: needsFollowUpCount, icon: AlertTriangle, color: "text-red-500", borderColor: "border-t-red-500", bgGlow: "bg-red-500/5" },
          ].map(s => (
            <div key={s.label} className={cn("flex items-center gap-3 px-4 py-3.5 rounded-xl border border-border/60 bg-card/80 backdrop-blur-sm shadow-sm border-t-2 transition-all hover:-translate-y-0.5 hover:shadow-md cursor-default", s.borderColor, s.bgGlow)}>
              <div className="p-2 rounded-lg bg-background/60"><s.icon className={cn("h-5 w-5", s.color)} /></div>
              <div>
                <p className="text-2xl font-extrabold leading-none tabular-nums">{s.count}</p>
                <p className="text-[11px] text-muted-foreground font-semibold mt-0.5">{s.label}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="flex flex-col sm:flex-row gap-2 flex-wrap p-3 rounded-xl bg-card/50 backdrop-blur-sm border border-border/40">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input placeholder="Search agents..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-8 h-8 text-sm" />
          </div>
          {isAdmin && managers.length > 0 && (
            <Select value={managerFilter} onValueChange={setManagerFilter}>
              <SelectTrigger className="w-[160px] h-8 text-sm"><Filter className="h-3.5 w-3.5 mr-1.5" /><SelectValue placeholder="All Managers" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Managers</SelectItem>
                {managers.map(m => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          <Button variant={showDeactivated ? "secondary" : "outline"} size="sm" onClick={() => setShowDeactivated(!showDeactivated)} className="gap-1.5 h-8">
            <UserX className="h-3.5 w-3.5" /> {showDeactivated ? "Deactivated ✓" : "Deactivated"}
          </Button>
          <Button variant={showInactive ? "secondary" : "outline"} size="sm" onClick={() => setShowInactive(!showInactive)} className="gap-1.5 h-8">
            <Eye className="h-3.5 w-3.5" /> {showInactive ? "Inactive ✓" : "Inactive"}
          </Button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-64"><RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" /></div>
        ) : (
          <>
          <Tabs value={activeStageTab} onValueChange={(v) => { setActiveStageTab(v); playSound("click"); }} className="space-y-3">
            <TabsList className="w-full justify-start flex-wrap h-auto gap-1.5 p-1.5 bg-muted/60">
              {SECTIONS.map(section => {
                const count = getAgentsForSection(section).length;
                const Icon = section.icon;
                return (
                  <TabsTrigger key={section.key} value={section.key} className="gap-1.5 text-xs font-semibold data-[state=active]:bg-background data-[state=active]:shadow-md px-3 py-2">
                    <Icon className={cn("h-3.5 w-3.5", section.iconColor)} />
                    {section.label}
                    <Badge variant="outline" className={cn("text-[10px] h-5 px-1.5 font-bold", section.headerBg, section.iconColor, "border-current/20")}>{count}</Badge>
                  </TabsTrigger>
                );
              })}
            </TabsList>

            {SECTIONS.map(section => {
              const sectionAgents = getAgentsForSection(section);

              // Pre-Licensed tab renders as 5-column pipeline
              if (section.key === "pre_licensed") {
                return (
                  <TabsContent key={section.key} value={section.key}>
                    {sectionAgents.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-10 gap-2">
                        <div className={cn("p-3 rounded-full", section.headerBg)}>
                          <Users className={cn("h-6 w-6", section.iconColor, "opacity-50")} />
                        </div>
                        <p className="text-sm text-muted-foreground">No unlicensed agents</p>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                        {UNLICENSED_COLUMNS.map(col => {
                          const colAgents = sectionAgents.filter(a => col.progress.includes(a.licenseProgress || "unlicensed"));
                          const colColors: Record<string, string> = {
                            unlicensed: "border-t-red-500 bg-red-500/3",
                            course_purchased: "border-t-amber-500 bg-amber-500/3",
                            finished_course: "border-t-blue-500 bg-blue-500/3",
                            test_scheduled: "border-t-violet-500 bg-violet-500/3",
                            waiting_on_license: "border-t-emerald-500 bg-emerald-500/3",
                          };
                          return (
                            <div key={col.key} className={cn("rounded-xl border border-border overflow-hidden border-t-3", colColors[col.key])}>
                              <div className="px-3 py-2.5 bg-muted/30 border-b border-border flex items-center justify-between">
                                <span className="text-xs font-bold tracking-wide">{col.label}</span>
                                <Badge variant="outline" className="text-[10px] h-5 font-bold tabular-nums">{colAgents.length}</Badge>
                              </div>
                              <div className="p-2 space-y-2 overflow-y-auto" style={{ maxHeight: "calc(100vh - 220px)" }}>
                                {colAgents.length === 0 ? (
                                  <p className="text-xs text-muted-foreground text-center py-6 italic">No agents here</p>
                                ) : colAgents.map(agent => (
                                  <div key={agent.id}
                                    className="rounded-lg border border-border/60 bg-card hover:bg-muted/30 transition-colors group overflow-hidden">
                                    {/* Agent Header */}
                                    <div className="flex items-center gap-2.5 p-2.5 cursor-pointer"
                                      onClick={() => { setViewAppTarget({ agentId: agent.userId ? agent.id : undefined, applicationId: agent.applicationId || agent.id }); playSound("click"); }}>
                                      <div className={cn("h-8 w-8 rounded-full bg-gradient-to-br flex items-center justify-center text-white text-xs font-bold shrink-0 ring-2 ring-background shadow-sm", getAvatarColor(agent.name))}>
                                        {agent.name.charAt(0).toUpperCase()}
                                      </div>
                                      <div className="min-w-0 flex-1">
                                        <p className="text-sm font-semibold truncate leading-tight">{agent.name}</p>
                                        {agent.managerId && agent.managerName && agent.managerId !== currentAgentId && (
                                          <Badge variant="outline" className="text-[9px] h-4 px-1.5 font-semibold bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20 mt-0.5">{agent.managerName.split(" ")[0]}</Badge>
                                        )}
                                      </div>
                                    </div>
                                    {/* Contact Row */}
                                    <div className="flex items-center gap-1 px-2.5 pb-1">
                                      {agent.phone && (
                                        <a href={`tel:${agent.phone}`} onClick={e => e.stopPropagation()} className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20 transition-colors">
                                          <Phone className="h-2.5 w-2.5" /> Call
                                        </a>
                                      )}
                                      <a href={`mailto:${agent.email}`} onClick={e => e.stopPropagation()} className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium bg-blue-500/10 text-blue-600 dark:text-blue-400 hover:bg-blue-500/20 transition-colors">
                                        <Mail className="h-2.5 w-2.5" /> Email
                                      </a>
                                      {agent.instagramHandle && (
                                        <a href={`https://instagram.com/${agent.instagramHandle.replace('@', '')}`} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium bg-pink-500/10 text-pink-600 dark:text-pink-400 hover:bg-pink-500/20 transition-colors">
                                          <Instagram className="h-2.5 w-2.5" />
                                        </a>
                                      )}
                                    </div>
                                    {/* Phone number visible */}
                                    {agent.phone && (
                                      <p className="text-[10px] text-muted-foreground px-2.5 pb-1 select-all cursor-text font-mono">{agent.phone}</p>
                                    )}
                                    {/* License Progress Selector */}
                                    <div className="px-2.5 pb-2" onClick={e => e.stopPropagation()}>
                                      <LicenseProgressSelector
                                        applicationId={agent.applicationId || agent.id}
                                        agentId={agent.userId ? agent.id : undefined}
                                        currentProgress={(agent.licenseProgress || "unlicensed") as any}
                                        testScheduledDate={agent.testScheduledDate}
                                        onProgressUpdated={fetchAgents}
                                        className="h-6 text-[10px] w-full"
                                      />
                                    </div>
                                    {/* Inline Quick Note */}
                                    <div className="px-2.5 pb-2" onClick={e => e.stopPropagation()}>
                                      <InlineNotesButton agent={agent} />
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </TabsContent>
                );
              }

              return (
                <TabsContent key={section.key} value={section.key}>
                  {sectionAgents.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-10 gap-2">
                      <div className={cn("p-3 rounded-full", section.headerBg)}>
                        <Users className={cn("h-6 w-6", section.iconColor, "opacity-50")} />
                      </div>
                      <p className="text-sm text-muted-foreground">No agents in this stage yet</p>
                    </div>
                  ) : (
                    <div className={cn("rounded-xl border border-border overflow-x-auto", section.accent, "border-l-4")}>
                      <Table className="min-w-[900px]">
                        <TableHeader>
                          <TableRow className="hover:bg-transparent">
                            {bulkMode && <TableHead className="w-8" />}
                            {getTableHeaders(section.key)}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {sectionAgents.map(agent => {
                            const isExpanded = expandedAgentId === agent.id;
                            return (
                              <React.Fragment key={agent.id}>
                                <TableRow
                                  id={`agent-row-${agent.id}`}
                                  className={cn(
                                    "cursor-pointer transition-all duration-150 hover:bg-muted/40",
                                    isExpanded && "bg-muted/50",
                                    !isExpanded && "even:bg-muted/15",
                                    isStaleAgent(agent) && !isExpanded && "bg-red-500/[0.04] hover:bg-red-500/[0.08] border-l-2 border-l-red-500/40",
                                    agent.isDeactivated && "opacity-50"
                                  )}
                                  onClick={() => { setExpandedAgentId(isExpanded ? null : agent.id); playSound(isExpanded ? "click" : "whoosh"); }}
                                >
                                  {bulkMode && (
                                    <TableCell className="py-2" onClick={e => e.stopPropagation()}>
                                      <AgentSelectCheckbox agentId={agent.id} isSelected={selectedAgents.has(agent.id)}
                                        onToggle={(id) => { const s = new Set(selectedAgents); s.has(id) ? s.delete(id) : s.add(id); setSelectedAgents(s); }}
                                        isEnabled={bulkMode} />
                                    </TableCell>
                                  )}
                                  <TableCell className="py-2">
                                    <div className="flex items-center gap-2 min-w-0">
                                      <div className="relative shrink-0">
                                        <div className={cn("h-7 w-7 rounded-full bg-gradient-to-br flex items-center justify-center text-white text-xs font-bold ring-2 ring-background shadow-sm", getAvatarColor(agent.name))}>
                                          {agent.name.charAt(0).toUpperCase()}
                                        </div>
                                        {isStaleAgent(agent) && (
                                          <div className={cn("absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-background bg-red-500")} />
                                        )}
                                      </div>
                                      <div className="min-w-0">
                                        <p className="font-medium text-xs truncate">{agent.name}</p>
                                        <div className="flex items-center gap-1 mt-0.5">
                                          {duplicateAgentIds.has(agent.id) && <Badge variant="outline" className="text-[8px] h-3.5 px-1 bg-amber-500/10 text-amber-500 border-amber-500/20">Dupe</Badge>}
                                          {agent.managerId && agent.managerName && agent.managerId !== currentAgentId && (
                                            <Badge variant="outline" className="text-[11px] h-4.5 px-2 font-bold bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20">{agent.managerName.split(" ")[0]}</Badge>
                                          )}
                                        </div>
                                        <p className="text-[10px] text-muted-foreground truncate">{agent.email}</p>
                                        {agent.phone && <p className="text-[10px] text-muted-foreground select-all cursor-text" onClick={e => e.stopPropagation()}>{agent.phone}</p>}
                                      </div>
                                    </div>
                                  </TableCell>
                                  {getTableCells(section.key, agent)}
                                  <TableCell className="py-2">
                                    <div className={`transition-transform duration-150 ${isExpanded ? 'rotate-90' : ''}`}>
                                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                                    </div>
                                  </TableCell>
                                </TableRow>
                                {isExpanded && (
                                  <tr><td colSpan={20} className="p-0">{renderExpandedRow(section.key, agent)}</td></tr>
                                )}
                              </React.Fragment>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </TabsContent>
              );
            })}
          </Tabs>

          
          </>
        )}
      </div>

      <ApplicationDetailSheet open={!!viewAppTarget} onOpenChange={(o) => !o && setViewAppTarget(null)} applicationId={viewAppTarget?.applicationId} agentId={viewAppTarget?.agentId} onRefresh={fetchAgents} />
      <DeactivateAgentDialog open={!!deactivateAgent} onOpenChange={(o) => !o && setDeactivateAgent(null)} agentId={deactivateAgent?.id || ""} agentName={deactivateAgent?.name || ""} currentManagerId={deactivateAgent?.managerId} onComplete={fetchAgents} />
      <InstagramPromptDialog open={!!instagramPromptAgent} onOpenChange={(o) => !o && setInstagramPromptAgent(null)} agentId={instagramPromptAgent?.id || ""} agentName={instagramPromptAgent?.name || ""} onComplete={fetchAgents} />
      {recorderAgent && user && (
        <InterviewRecorder applicationId={recorderAgent.id} agentId={recorderAgent.id} applicantName={recorderAgent.name} onClose={() => setRecorderAgent(null)} onTranscriptionSaved={fetchAgents} />
      )}
      {editLoginAgent && (
        <AgentQuickEditDialog open={!!editLoginAgent} onOpenChange={(o) => !o && setEditLoginAgent(null)} agentId={editLoginAgent.id} currentName={editLoginAgent.name} onUpdate={fetchAgents} />
      )}
    </>
  );
}
