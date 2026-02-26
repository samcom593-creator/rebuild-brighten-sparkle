import { useState, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { differenceInDays } from "date-fns";
import {
  Users,
  Search,
  RefreshCw,
  CheckCircle2,
  Clock,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Mail,
  Phone,
  UserX,
  Filter,
  Mic,
  BookOpen,
  GraduationCap,
  Briefcase,
  Instagram,
  X,
  Send,
  CheckSquare,
  EyeOff,
  Eye,
  FileText,
} from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DashboardLayout } from "@/components/dashboard/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { OnboardingTracker } from "@/components/dashboard/OnboardingTracker";
import { AddAgentModal } from "@/components/dashboard/AddAgentModal";
import { AgentChecklist } from "@/components/dashboard/AgentChecklist";
import { AttendanceGrid } from "@/components/dashboard/AttendanceGrid";
import { StarRating } from "@/components/dashboard/StarRating";
import { AgentNotes } from "@/components/dashboard/AgentNotes";
import { EvaluationButtons } from "@/components/dashboard/EvaluationButtons";
import { PerformanceBadges } from "@/components/dashboard/PerformanceBadges";
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
import { useSoundEffects } from "@/hooks/useSoundEffects";

type AttendanceStatus = Database["public"]["Enums"]["attendance_status"];
type PerformanceTier = Database["public"]["Enums"]["performance_tier"];
type OnboardingStage = Database["public"]["Enums"]["onboarding_stage"];

interface Manager {
  id: string;
  name: string;
}

interface AgentCRM {
  id: string;
  userId: string;
  name: string;
  email: string;
  phone?: string;
  avatarUrl?: string;
  instagramHandle?: string;
  onboardingStage: OnboardingStage;
  attendanceStatus: AttendanceStatus;
  performanceTier: PerformanceTier;
  fieldTrainingStartedAt?: string;
  startDate?: string;
  totalEarnings: number;
  hasTrainingCourse: boolean;
  hasDialerLogin: boolean;
  hasDiscordAccess: boolean;
  potentialRating: number;
  evaluationResult?: string | null;
  isDeactivated: boolean;
  isInactive: boolean;
  managerId?: string;
  managerName?: string;
  weekly10kBadges: number;
  sortOrder: number;
  weeklyALP: number;
  weeklyPresentations: number;
  weeklyDeals: number;
  weeklyClosingRate: number;
  monthlyALP: number;
  monthlyDeals: number;
  lastContactedAt: string | null;
  standardPaid: boolean;
  premiumPaid: boolean;
  licenseProgress: string | null;
  testScheduledDate: string | null;
  agentLicenseStatus: string;
}

const attendanceColors: Record<AttendanceStatus, string> = {
  good: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
  warning: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
  critical: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20",
};

const attendanceLabels: Record<AttendanceStatus, string> = {
  good: "Good",
  warning: "Warning",
  critical: "Critical",
};

const AVATAR_COLORS = [
  "from-primary to-cyan-500",
  "from-violet-500 to-purple-500",
  "from-rose-500 to-pink-500",
  "from-amber-500 to-orange-500",
  "from-emerald-500 to-teal-500",
  "from-blue-500 to-indigo-500",
  "from-fuchsia-500 to-pink-500",
  "from-cyan-500 to-blue-500",
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
  if (!agent.lastContactedAt) return true;
  return (Date.now() - new Date(agent.lastContactedAt).getTime()) / 3600000 >= 48;
};

const getContactInfo = (agent: AgentCRM) => {
  if (!agent.lastContactedAt) return { label: "Never", color: "text-red-500 dark:text-red-400" };
  const h = (Date.now() - new Date(agent.lastContactedAt).getTime()) / 3600000;
  if (h < 24) return { label: getTimeAgo(agent.lastContactedAt), color: "text-emerald-600 dark:text-emerald-400" };
  if (h < 48) return { label: getTimeAgo(agent.lastContactedAt), color: "text-amber-600 dark:text-amber-400" };
  return { label: getTimeAgo(agent.lastContactedAt), color: "text-red-500 dark:text-red-400" };
};

const SECTIONS = [
  { key: "onboarding", label: "Onboarding", icon: BookOpen, stages: ["onboarding", "training_online"] as OnboardingStage[], accent: "border-l-primary", headerBg: "bg-primary/5", iconColor: "text-primary" },
  { key: "in_training", label: "In-Field Training", icon: GraduationCap, stages: ["in_field_training"] as OnboardingStage[], accent: "border-l-amber-500", headerBg: "bg-amber-500/5", iconColor: "text-amber-500" },
  { key: "live", label: "Live", icon: Briefcase, stages: ["evaluated"] as OnboardingStage[], accent: "border-l-emerald-500", headerBg: "bg-emerald-500/5", iconColor: "text-emerald-500" },
];

// ── Expanded Agent Row Detail ──
function AgentExpandedRow({
  agent,
  onRefresh,
  onStageUpdate,
  onGoLive,
  onDeactivate,
  onViewApp,
  onRecord,
  onAgentUpdate,
  playSound,
  sendingCourseLogin,
  setSendingCourseLogin,
  currentAgentId,
}: {
  agent: AgentCRM;
  onRefresh: () => void;
  onStageUpdate: (id: string) => void;
  onGoLive: (a: AgentCRM) => void;
  onDeactivate: (a: AgentCRM) => void;
  onViewApp: (id: string) => void;
  onRecord: (a: AgentCRM) => void;
  onAgentUpdate: (id: string, updates: Partial<AgentCRM>) => void;
  playSound: (s: "success" | "error" | "whoosh" | "click" | "celebrate") => void;
  sendingCourseLogin: string | null;
  setSendingCourseLogin: (id: string | null) => void;
  currentAgentId: string | null;
}) {
  const daysInTraining = agent.fieldTrainingStartedAt
    ? differenceInDays(new Date(), new Date(agent.fieldTrainingStartedAt))
    : null;
  const evaluationDue = daysInTraining !== null && daysInTraining >= 7 && !agent.evaluationResult;
  const isLive = agent.onboardingStage === "evaluated";
  const isOnboarding = ["onboarding", "training_online"].includes(agent.onboardingStage);

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.2 }}
      className="overflow-hidden"
    >
      <div className={cn(
        "px-4 py-3 border-t border-border space-y-3 rounded-b-lg",
        "bg-card/80 backdrop-blur-sm shadow-inner",
        isOnboarding && "border-l-2 border-l-primary",
        agent.onboardingStage === "in_field_training" && "border-l-2 border-l-amber-500",
        isLive && "border-l-2 border-l-emerald-500"
      )}>
        {/* Top action bar */}
        <div className="flex items-center gap-2 flex-wrap">
          {agent.phone && (
            <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5" asChild>
              <a href={`tel:${agent.phone}`}><Phone className="h-3 w-3" /> Call</a>
            </Button>
          )}
          {agent.email && (
            <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5" asChild>
              <a href={`mailto:${agent.email}`}><Mail className="h-3 w-3" /> Email</a>
            </Button>
          )}
          {agent.instagramHandle && (
            <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5" asChild>
              <a href={`https://instagram.com/${agent.instagramHandle.replace('@', '')}`} target="_blank" rel="noopener noreferrer">
                <Instagram className="h-3 w-3" /> {agent.instagramHandle}
              </a>
            </Button>
          )}
          <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5" onClick={() => onRecord(agent)}>
            <Mic className="h-3 w-3" /> Record
          </Button>
          <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5" onClick={() => onViewApp(agent.id)}>
            <FileText className="h-3 w-3" /> Application
          </Button>
          {agent.userId && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs gap-1.5"
              onClick={async () => {
                try {
                  await supabase.functions.invoke("send-agent-portal-login", { body: { agentId: agent.id } });
                  toast.success(`Portal login sent to ${agent.email}`);
                } catch { toast.error("Failed to send"); }
              }}
            >
              <Send className="h-3 w-3" /> Portal Login
            </Button>
          )}
          <div className="flex-1" />
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs gap-1.5 text-amber-600 dark:text-amber-400 hover:bg-amber-500/10"
            onClick={async () => {
              try {
                await supabase.from("agents").update({ is_inactive: true }).eq("id", agent.id);
                onAgentUpdate(agent.id, { isInactive: true });
                toast.success(`${agent.name} hidden`);
              } catch { toast.error("Failed"); }
            }}
          >
            <EyeOff className="h-3 w-3" /> Hide
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs gap-1.5 text-destructive hover:bg-destructive/10"
            onClick={() => onDeactivate(agent)}
          >
            <X className="h-3 w-3" /> Remove
          </Button>
        </div>

        {/* Two-column detail grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {/* Left column */}
          <div className="space-y-3">
            {/* Star Rating */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground w-16">Rating:</span>
              <StarRating
                agentId={agent.id}
                rating={agent.potentialRating}
                onUpdate={(newRating?: number) => { if (newRating !== undefined) onAgentUpdate(agent.id, { potentialRating: newRating }); }}
                size="sm"
              />
            </div>

            {/* License Progress */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground w-16">License:</span>
              <LicenseProgressSelector
                applicationId={agent.id}
                currentProgress={(agent.licenseProgress || "unlicensed") as any}
                testScheduledDate={agent.testScheduledDate}
                onProgressUpdated={onRefresh}
                className="h-6 text-xs"
              />
              {agent.licenseProgress !== "licensed" && isOnboarding && (
                <ResendLicensingButton
                  recipientEmail={agent.email}
                  recipientName={agent.name}
                  licenseStatus="unlicensed"
                />
              )}
            </div>

            {/* Onboarding Stage */}
            <OnboardingTracker
              agentId={agent.id}
              agentName={agent.name}
              currentStage={agent.onboardingStage}
              onStageUpdate={() => onStageUpdate(agent.id)}
              onGoLive={() => onGoLive(agent)}
              readOnly={false}
            />

            {/* Checklist */}
            <AgentChecklist
              agentId={agent.id}
              hasTrainingCourse={agent.hasTrainingCourse}
              hasDialerLogin={agent.hasDialerLogin}
              hasDiscordAccess={agent.hasDiscordAccess}
              onOptimisticToggle={(agentId, field, newValue) => {
                const fieldMap: Record<string, string> = {
                  has_training_course: "hasTrainingCourse",
                  has_dialer_login: "hasDialerLogin",
                  has_discord_access: "hasDiscordAccess",
                };
                const key = fieldMap[field];
                if (key) onAgentUpdate(agentId, { [key]: newValue } as any);
              }}
            />

            {/* Course actions for onboarding agents */}
            {isOnboarding && (
              <Button
                variant="outline"
                size="sm"
                className="w-full h-7 text-xs gap-1.5"
                disabled={sendingCourseLogin === agent.id}
                onClick={async () => {
                  setSendingCourseLogin(agent.id);
                  try {
                    await supabase.functions.invoke("send-course-enrollment-email", { body: { agentId: agent.id } });
                    toast.success(`Course login sent to ${agent.name}`);
                    playSound("success");
                  } catch { toast.error("Failed to send"); }
                  finally { setSendingCourseLogin(null); }
                }}
              >
                {sendingCourseLogin === agent.id ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                Resend Course Login
              </Button>
            )}
          </div>

          {/* Right column */}
          <div className="space-y-3">
            {/* Performance badges for live agents */}
            {isLive && agent.weekly10kBadges > 0 && (
              <PerformanceBadges agentId={agent.id} badgeCount={agent.weekly10kBadges} onUpdate={onRefresh} />
            )}

            {/* Attendance */}
            {agent.onboardingStage === "in_field_training" && (
              <div className="space-y-1.5">
                <AttendanceGrid agentId={agent.id} type="training" label="Homework" onMarkAbsent={() => {}} />
                <AttendanceGrid agentId={agent.id} type="onboarded_meeting" label="Meetings" onMarkAbsent={() => {}} />
              </div>
            )}
            {isLive && (
              <div className="space-y-1.5">
                <AttendanceGrid agentId={agent.id} type="onboarded_meeting" label="Meeting" onMarkAbsent={() => {}} />
                <AttendanceGrid agentId={agent.id} type="daily_sale" label="Sold" onMarkAbsent={() => {}} />
              </div>
            )}

            {/* Evaluation */}
            {(evaluationDue || agent.evaluationResult) && (
              <div className="flex items-center gap-2">
                {daysInTraining !== null && (
                  <Badge variant="outline" className={cn("text-xs", evaluationDue && "bg-amber-500/10 text-amber-500 border-amber-500/20")}>
                    <Clock className="h-3 w-3 mr-1" /> {daysInTraining}d {evaluationDue && "- Eval Due!"}
                  </Badge>
                )}
                <EvaluationButtons
                  agentId={agent.id}
                  agentName={agent.name}
                  currentResult={agent.evaluationResult}
                  onEvaluated={onRefresh}
                />
              </div>
            )}

            {/* Attendance status */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Attendance:</span>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className={cn("h-6 text-xs gap-1", attendanceColors[agent.attendanceStatus])}>
                    {attendanceLabels[agent.attendanceStatus]}
                    <ChevronDown className="h-3 w-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem onClick={async () => {
                    await supabase.from("agents").update({ attendance_status: "good" }).eq("id", agent.id);
                    onAgentUpdate(agent.id, { attendanceStatus: "good" });
                    toast.success("Updated");
                  }}>
                    <CheckCircle2 className="h-4 w-4 mr-2 text-emerald-500" /> Good
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={async () => {
                    await supabase.from("agents").update({ attendance_status: "warning" }).eq("id", agent.id);
                    onAgentUpdate(agent.id, { attendanceStatus: "warning" });
                    toast.success("Updated");
                  }}>
                    <AlertTriangle className="h-4 w-4 mr-2 text-amber-500" /> Warning
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={async () => {
                    await supabase.from("agents").update({ attendance_status: "critical" }).eq("id", agent.id);
                    onAgentUpdate(agent.id, { attendanceStatus: "critical" });
                    toast.success("Updated");
                  }}>
                    <AlertTriangle className="h-4 w-4 mr-2 text-red-500" /> Critical
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            {/* Week + Month ALP for live agents */}
            {isLive && (
              <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-primary/5 border border-primary/10">
                <div>
                  <p className="text-[10px] text-muted-foreground">Week ALP</p>
                  <p className="text-sm font-bold text-primary">${agent.weeklyALP.toLocaleString()}</p>
                </div>
                <div className="w-px h-8 bg-border" />
                <div>
                  <p className="text-[10px] text-muted-foreground">Month ALP</p>
                  <p className="text-sm font-bold">${agent.monthlyALP.toLocaleString()}</p>
                </div>
                {agent.weeklyClosingRate > 0 && (
                  <>
                    <div className="w-px h-8 bg-border" />
                    <div>
                      <p className="text-[10px] text-muted-foreground">Close %</p>
                      <p className={cn("text-sm font-bold", agent.weeklyClosingRate >= 30 ? "text-primary" : "text-foreground")}>{agent.weeklyClosingRate}%</p>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Notes */}
            <AgentNotes agentId={agent.id} onNoteAdded={() => {}} />
          </div>
        </div>
      </div>
    </motion.div>
  );
}


export default function DashboardCRM() {
  const { user, isAdmin, isManager, isLoading: authLoading } = useAuth();
  const { playSound } = useSoundEffects();
  const [agents, setAgents] = useState<AgentCRM[]>([]);
  const [managers, setManagers] = useState<Manager[]>([]);
  const [loading, setLoading] = useState(true);
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
  const [viewAppAgentId, setViewAppAgentId] = useState<string | null>(null);
  const [expandedAgentId, setExpandedAgentId] = useState<string | null>(null);
  const [openSections, setOpenSections] = useState<Set<string>>(new Set(["onboarding", "in_training", "live"]));
  const currentAgentIdRef = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && user) {
      fetchAgents();
      if (isAdmin) fetchManagers();
    }
  }, [user?.id, authLoading, isAdmin]);

  const fetchManagers = async () => {
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
  };

  const fetchAgents = async () => {
    setLoading(true);
    try {
      const { data: currentAgent } = await supabase.from("agents").select("id").eq("user_id", user!.id).single();
      if (!currentAgent && !isAdmin) { setLoading(false); return; }
      if (currentAgent) currentAgentIdRef[1](currentAgent.id);

      let query = supabase.from("agents").select("*").eq("status", "active").order("sort_order", { ascending: true, nullsFirst: false });
      if (isManager && !isAdmin) query = query.eq("invited_by_manager_id", currentAgent?.id);

      const { data: agentData, error } = await query;
      if (error) throw error;
      if (!agentData?.length) { setAgents([]); setLoading(false); return; }

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

      const [profilesResult, managerAgentsResult, monthlyProductionResult, appContactsResult, appLicenseResult, paymentsResult] = await Promise.all([
        supabase.from("profiles").select("user_id, full_name, email, phone, avatar_url, instagram_handle").in("user_id", userIds),
        managerIds.length > 0 ? supabase.from("agents").select("id, user_id").in("id", managerIds) : Promise.resolve({ data: [] as any[] }),
        liveAgentIds.length > 0 ? supabase.from("daily_production").select("agent_id, aop, presentations, deals_closed, production_date").in("agent_id", liveAgentIds).gte("production_date", monthStartStr) : Promise.resolve({ data: [] as any[] }),
        supabase.from("applications").select("assigned_agent_id, last_contacted_at").in("assigned_agent_id", allAgentIds).not("last_contacted_at", "is", null).order("last_contacted_at", { ascending: false }),
        supabase.from("applications").select("assigned_agent_id, license_progress, test_scheduled_date").in("assigned_agent_id", allAgentIds).is("terminated_at", null),
        supabase.from("lead_payment_tracking").select("agent_id, tier, paid").eq("week_start", weekStartStr).eq("paid", true),
      ]);

      const profileMap = new Map(profilesResult.data?.map(p => [p.user_id, p]) || []);

      let managerProfileMap = new Map<string, string>();
      const managerAgents = managerAgentsResult.data;
      if (managerAgents?.length) {
        const mUserIds = managerAgents.map((a: any) => a.user_id).filter(Boolean);
        const { data: mProfiles } = await supabase.from("profiles").select("user_id, full_name").in("user_id", mUserIds);
        const userToName = new Map(mProfiles?.map(p => [p.user_id, p.full_name]) || []);
        managerAgents.forEach((ma: any) => { if (ma.user_id) managerProfileMap.set(ma.id, userToName.get(ma.user_id) || "Unknown"); });
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

      const lastContactMap = new Map<string, string>();
      for (const app of appContactsResult.data || []) {
        if (app.assigned_agent_id && app.last_contacted_at && !lastContactMap.has(app.assigned_agent_id)) lastContactMap.set(app.assigned_agent_id, app.last_contacted_at);
      }

      const licenseProgressMap = new Map<string, { progress: string | null; testDate: string | null }>();
      for (const app of appLicenseResult.data || []) {
        if (app.assigned_agent_id && !licenseProgressMap.has(app.assigned_agent_id)) licenseProgressMap.set(app.assigned_agent_id, { progress: app.license_progress, testDate: app.test_scheduled_date });
      }

      const paymentMap = new Map<string, { standard: boolean; premium: boolean }>();
      paymentsResult.data?.forEach((p: any) => {
        const e = paymentMap.get(p.agent_id) || { standard: false, premium: false };
        if (p.tier === "standard") e.standard = true;
        if (p.tier === "premium") e.premium = true;
        paymentMap.set(p.agent_id, e);
      });

      const crmAgents: AgentCRM[] = agentData.map((agent, index) => {
        const profile = profileMap.get(agent.user_id);
        const ws = weeklyProductionMap.get(agent.id) || { aop: 0, presentations: 0, deals: 0 };
        const pay = paymentMap.get(agent.id) || { standard: false, premium: false };
        return {
          id: agent.id, userId: agent.user_id || "", name: profile?.full_name || agent.display_name || "Unknown Agent",
          email: profile?.email || "", phone: profile?.phone || undefined, avatarUrl: profile?.avatar_url || undefined,
          instagramHandle: profile?.instagram_handle || undefined, onboardingStage: agent.onboarding_stage || "onboarding",
          attendanceStatus: agent.attendance_status || "good", performanceTier: agent.performance_tier || "below_10k",
          fieldTrainingStartedAt: agent.field_training_started_at || undefined, startDate: agent.start_date || undefined,
          totalEarnings: Number(agent.total_earnings) || 0, hasTrainingCourse: agent.has_training_course || false,
          hasDialerLogin: agent.has_dialer_login || false, hasDiscordAccess: agent.has_discord_access || false,
          potentialRating: agent.potential_rating || 0, evaluationResult: agent.evaluation_result,
          isDeactivated: agent.is_deactivated || false, isInactive: (agent as any).is_inactive || false,
          managerId: agent.invited_by_manager_id || undefined, managerName: agent.invited_by_manager_id ? managerProfileMap.get(agent.invited_by_manager_id) : undefined,
          weekly10kBadges: agent.weekly_10k_badges || 0, sortOrder: agent.sort_order ?? index,
          weeklyALP: ws.aop, weeklyPresentations: ws.presentations, weeklyDeals: ws.deals,
          weeklyClosingRate: ws.presentations > 0 ? Math.round((ws.deals / ws.presentations) * 100) : 0,
          monthlyALP: monthlyProductionMap.get(agent.id) || 0, monthlyDeals: monthlyDealsMap.get(agent.id) || 0,
          lastContactedAt: lastContactMap.get(agent.id) || null, standardPaid: pay.standard, premiumPaid: pay.premium,
          licenseProgress: licenseProgressMap.get(agent.id)?.progress || null, testScheduledDate: licenseProgressMap.get(agent.id)?.testDate || null,
          agentLicenseStatus: agent.license_status || "unlicensed",
        };
      });

      // Fetch unlicensed applicants
      let appQuery = supabase.from("applications")
        .select("id, first_name, last_name, email, phone, license_status, license_progress, test_scheduled_date, status, instagram_handle, started_training")
        .is("terminated_at", null).neq("license_status", "licensed").in("status", ["approved", "contracting"]);
      if (isManager && !isAdmin && currentAgent) appQuery = appQuery.eq("assigned_agent_id", currentAgent.id);

      const { data: unlicensedApplicants } = await appQuery;
      const existingEmails = new Set(crmAgents.map(a => a.email?.toLowerCase()).filter(Boolean));
      const newApplicants: AgentCRM[] = (unlicensedApplicants || [])
        .filter(app => !existingEmails.has(app.email?.toLowerCase()))
        .map((app, index) => ({
          id: app.id, userId: "", name: `${app.first_name} ${app.last_name}`.trim(), email: app.email || "",
          phone: app.phone || undefined, avatarUrl: undefined, instagramHandle: app.instagram_handle || undefined,
          onboardingStage: "onboarding" as OnboardingStage, attendanceStatus: "good" as AttendanceStatus,
          performanceTier: "below_10k" as PerformanceTier, fieldTrainingStartedAt: undefined, startDate: undefined,
          totalEarnings: 0, hasTrainingCourse: app.started_training || false, hasDialerLogin: false, hasDiscordAccess: false,
          potentialRating: 0, evaluationResult: null, isDeactivated: false, isInactive: false, managerId: undefined,
          managerName: undefined, weekly10kBadges: 0, sortOrder: crmAgents.length + index,
          weeklyALP: 0, weeklyPresentations: 0, weeklyDeals: 0, weeklyClosingRate: 0,
          monthlyALP: 0, monthlyDeals: 0, lastContactedAt: null, standardPaid: false, premiumPaid: false,
          licenseProgress: app.license_progress || null, testScheduledDate: app.test_scheduled_date || null,
          agentLicenseStatus: app.license_status || "unlicensed",
        }));

      setAgents([...crmAgents, ...newApplicants]);
    } catch (error) { console.error("Error fetching CRM agents:", error); toast.error("Failed to load agents"); }
    finally { setLoading(false); }
  };

  const handleOptimisticStageUpdate = async (agentId: string) => {
    try {
      const { data } = await supabase.from("agents").select("onboarding_stage, onboarding_completed_at, field_training_started_at").eq("id", agentId).single();
      if (data) setAgents(prev => prev.map(a => a.id === agentId ? { ...a, onboardingStage: data.onboarding_stage || a.onboardingStage, fieldTrainingStartedAt: data.field_training_started_at || a.fieldTrainingStartedAt } : a));
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

  // Filtering
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

  const getAgentsForSection = (stages: OnboardingStage[]) =>
    filteredAgents.filter(a => stages.includes(a.onboardingStage)).sort((a, b) => {
      if (!a.lastContactedAt && !b.lastContactedAt) return a.sortOrder - b.sortOrder;
      if (!a.lastContactedAt) return -1;
      if (!b.lastContactedAt) return 1;
      return new Date(a.lastContactedAt).getTime() - new Date(b.lastContactedAt).getTime();
    });

  const duplicateAgentIds = useMemo(() => {
    const emailCount = new Map<string, number>();
    activeAgents.forEach(a => { if (a.email) { const k = a.email.toLowerCase().trim(); emailCount.set(k, (emailCount.get(k) || 0) + 1); } });
    const dupeIds = new Set<string>();
    activeAgents.forEach(a => { if (a.email && (emailCount.get(a.email.toLowerCase().trim()) || 0) > 1) dupeIds.add(a.id); });
    return dupeIds;
  }, [activeAgents]);

  // Stats
  const onboardingCount = filteredAgents.filter(a => ["onboarding", "training_online"].includes(a.onboardingStage)).length;
  const trainingCount = filteredAgents.filter(a => a.onboardingStage === "in_field_training").length;
  const liveCount = filteredAgents.filter(a => a.onboardingStage === "evaluated").length;
  const staleCount = filteredAgents.filter(isStaleAgent).length;

  const toggleSection = (key: string) => {
    setOpenSections(prev => {
      const next = new Set(prev);
      if (next.has(key)) { next.delete(key); playSound("click"); } else { next.add(key); playSound("whoosh"); }
      return next;
    });
  };

  if (authLoading) {
    return <DashboardLayout><div className="flex items-center justify-center h-64"><RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" /></div></DashboardLayout>;
  }

  return (
    <DashboardLayout>
      <div className="space-y-4 page-enter relative">
        <BackgroundGlow accent="teal" intensity="subtle" />
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 relative z-10">
          <div>
            <h1 className="text-2xl font-bold gradient-text">Recruiter HQ</h1>
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
            <Button onClick={fetchAgents} variant="outline" size="sm" className="gap-1.5">
              <RefreshCw className="h-3.5 w-3.5" /> Refresh
            </Button>
          </div>
        </div>

        {/* Bulk Actions Bar */}
        {bulkMode && (
          <BulkStageActions
            agents={filteredAgents.map(a => ({ id: a.id, name: a.name, onboardingStage: a.onboardingStage }))}
            selectedIds={selectedAgents}
            onSelectionChange={setSelectedAgents}
            onBulkUpdate={() => { fetchAgents(); setSelectedAgents(new Set()); }}
            isEnabled={bulkMode}
            onToggle={() => { setBulkMode(false); setSelectedAgents(new Set()); }}
          />
        )}

        {/* Quick Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          {[
            { label: "Onboarding", count: onboardingCount, icon: BookOpen, color: "text-primary", borderColor: "border-t-primary", bgGlow: "bg-primary/5" },
            { label: "In Training", count: trainingCount, icon: GraduationCap, color: "text-amber-500", borderColor: "border-t-amber-500", bgGlow: "bg-amber-500/5" },
            { label: "Live", count: liveCount, icon: Briefcase, color: "text-emerald-500", borderColor: "border-t-emerald-500", bgGlow: "bg-emerald-500/5" },
            { label: "Needs F/U", count: staleCount, icon: AlertTriangle, color: "text-red-500", borderColor: "border-t-red-500", bgGlow: "bg-red-500/5" },
          ].map(s => (
            <motion.div
              key={s.label}
              whileHover={{ y: -2 }}
              transition={{ duration: 0.15 }}
              className={cn(
                "flex items-center gap-2.5 px-3.5 py-3 rounded-xl border border-border/60 bg-card/80 backdrop-blur-sm shadow-sm border-t-2",
                s.borderColor, s.bgGlow
              )}
            >
              <div className={cn("p-1.5 rounded-lg bg-background/60")}>
                <s.icon className={cn("h-4 w-4", s.color)} />
              </div>
              <div>
                <p className="text-xl font-bold leading-none tabular-nums">{s.count}</p>
                <p className="text-[10px] text-muted-foreground font-medium mt-0.5">{s.label}</p>
              </div>
              {filteredAgents.length > 0 && (
                <div className="ml-auto">
                  <div className="h-1 w-10 rounded-full bg-muted overflow-hidden">
                    <div className={cn("h-full rounded-full transition-all", s.color.replace("text-", "bg-"))} style={{ width: `${Math.round((s.count / filteredAgents.length) * 100)}%` }} />
                  </div>
                </div>
              )}
            </motion.div>
          ))}
        </div>

        {/* Filters */}
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

        {/* Main Content */}
        {loading ? (
          <div className="flex items-center justify-center h-64"><RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" /></div>
        ) : (
          <div className="space-y-3">
            {SECTIONS.map(section => {
              const sectionAgents = getAgentsForSection(section.stages);
              const isOpen = openSections.has(section.key);
              const Icon = section.icon;

              return (
                <div key={section.key} className={cn("rounded-xl border border-border overflow-hidden", section.accent, "border-l-4")}>
                  {/* Section Header */}
                  <button
                    onClick={() => toggleSection(section.key)}
                    className={cn(
                      "w-full flex items-center justify-between px-4 py-3 transition-colors hover:bg-muted/30",
                      "bg-gradient-to-r from-primary/8 via-primary/4 to-transparent",
                      section.key === "in_training" && "from-amber-500/8 via-amber-500/4 to-transparent",
                      section.key === "live" && "from-emerald-500/8 via-emerald-500/4 to-transparent"
                    )}
                  >
                    <div className="flex items-center gap-2.5">
                      <div className={cn("p-1 rounded-md", section.headerBg)}>
                        <Icon className={cn("h-4 w-4", section.iconColor)} />
                      </div>
                      <span className="font-semibold text-sm">{section.label}</span>
                      <Badge variant="outline" className={cn("text-xs font-bold tabular-nums", section.headerBg, section.iconColor, "border-current/20")}>
                        {sectionAgents.length}
                      </Badge>
                      {sectionAgents.filter(isStaleAgent).length > 0 && (
                        <Badge variant="outline" className="text-[10px] bg-red-500/10 text-red-500 border-red-500/20 animate-pulse">
                          {sectionAgents.filter(isStaleAgent).length} stale
                        </Badge>
                      )}
                    </div>
                    <motion.div animate={{ rotate: isOpen ? 180 : 0 }} transition={{ duration: 0.15 }}>
                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    </motion.div>
                  </button>

                  {/* Section Table */}
                  <AnimatePresence>
                    {isOpen && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden"
                      >
                        {sectionAgents.length === 0 ? (
                          <div className="flex flex-col items-center justify-center py-10 gap-2 bg-gradient-to-b from-muted/20 to-transparent">
                            <div className={cn("p-3 rounded-full", section.headerBg)}>
                              <Users className={cn("h-6 w-6", section.iconColor, "opacity-50")} />
                            </div>
                            <p className="text-sm text-muted-foreground">No agents in this stage yet</p>
                          </div>
                        ) : (
                          <Table>
                            <TableHeader>
                              <TableRow className="hover:bg-transparent">
                                {bulkMode && <TableHead className="w-8" />}
                                <TableHead className="w-[220px]">Agent</TableHead>
                                <TableHead className="w-[100px]">License</TableHead>
                                <TableHead className="w-[90px]">Contact</TableHead>
                                <TableHead className="w-[70px]">Course</TableHead>
                                {section.key === "live" && <TableHead className="w-[100px] text-right">Week ALP</TableHead>}
                                {section.key === "live" && <TableHead className="w-[80px] text-right">Deals</TableHead>}
                                <TableHead className="w-[80px]">Attend.</TableHead>
                                <TableHead className="w-8" />
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {sectionAgents.map(agent => {
                                const contact = getContactInfo(agent);
                                const isExpanded = expandedAgentId === agent.id;
                                const licenseLabel = agent.agentLicenseStatus === "licensed" ? "Licensed"
                                  : agent.licenseProgress === "course_purchased" ? "Course"
                                  : agent.licenseProgress === "passed_test" ? "Passed"
                                  : agent.licenseProgress === "waiting_on_license" ? "Waiting"
                                  : "Unlicensed";
                                const licenseColor = agent.agentLicenseStatus === "licensed"
                                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                                  : "bg-muted text-muted-foreground";

                                return (
                                  <motion.tbody key={agent.id} layout>
                                    <TableRow
                                      className={cn(
                                        "cursor-pointer transition-all duration-150 hover:bg-muted/40",
                                        isExpanded && "bg-muted/50",
                                        !isExpanded && "even:bg-muted/15",
                                        isStaleAgent(agent) && !isExpanded && "bg-red-500/[0.04] hover:bg-red-500/[0.08] border-l-2 border-l-red-500/40",
                                        !isStaleAgent(agent) && !isExpanded && cn(
                                          "hover:border-l-2",
                                          section.key === "onboarding" && "hover:border-l-primary/60",
                                          section.key === "in_training" && "hover:border-l-amber-500/60",
                                          section.key === "live" && "hover:border-l-emerald-500/60"
                                        ),
                                        agent.isDeactivated && "opacity-50"
                                      )}
                                      onClick={() => {
                                        setExpandedAgentId(isExpanded ? null : agent.id);
                                        playSound(isExpanded ? "click" : "whoosh");
                                      }}
                                    >
                                      {bulkMode && (
                                        <TableCell className="py-2" onClick={e => e.stopPropagation()}>
                                          <AgentSelectCheckbox
                                            agentId={agent.id}
                                            isSelected={selectedAgents.has(agent.id)}
                                            onToggle={(id) => {
                                              const s = new Set(selectedAgents);
                                              s.has(id) ? s.delete(id) : s.add(id);
                                              setSelectedAgents(s);
                                            }}
                                            isEnabled={bulkMode}
                                          />
                                        </TableCell>
                                      )}
                                      <TableCell className="py-2">
                                        <div className="flex items-center gap-2 min-w-0">
                                          <div className="relative shrink-0">
                                          <div className={cn(
                                              "h-7 w-7 rounded-full bg-gradient-to-br flex items-center justify-center text-white text-xs font-bold ring-2 ring-background shadow-sm",
                                              getAvatarColor(agent.name)
                                            )}>
                                              {agent.name.charAt(0).toUpperCase()}
                                            </div>
                                            {isStaleAgent(agent) && (
                                              <div className={cn("absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-background", !agent.lastContactedAt ? "bg-red-500" : "bg-amber-500")} />
                                            )}
                                          </div>
                                          <div className="min-w-0">
                                            <div className="flex items-center gap-1">
                                              <p className="font-medium text-xs truncate">{agent.name}</p>
                                              {duplicateAgentIds.has(agent.id) && <Badge variant="outline" className="text-[8px] h-3.5 px-1 bg-amber-500/10 text-amber-500 border-amber-500/20">Dupe</Badge>}
                                              {agent.managerId && agent.managerName && agent.managerId !== currentAgentIdRef[0] && (
                                                <Badge variant="outline" className="text-[8px] h-3.5 px-1 bg-sky-500/10 text-sky-500 border-sky-500/20">
                                                  {agent.managerName.split(" ")[0]}
                                                </Badge>
                                              )}
                                              {agent.premiumPaid && <Badge className="text-[8px] h-3.5 px-1 bg-emerald-500/10 text-emerald-500 border-emerald-500/20">$1K</Badge>}
                                              {agent.standardPaid && !agent.premiumPaid && <Badge className="text-[8px] h-3.5 px-1 bg-emerald-500/10 text-emerald-500 border-emerald-500/20">$250</Badge>}
                                            </div>
                                            <p className="text-[10px] text-muted-foreground truncate">{agent.email}</p>
                                          </div>
                                        </div>
                                      </TableCell>
                                      <TableCell className="py-2">
                                        <Badge variant="outline" className={cn("text-[10px]", licenseColor)}>{licenseLabel}</Badge>
                                      </TableCell>
                                      <TableCell className="py-2">
                                        <span className={cn("text-xs font-medium", contact.color)}>{contact.label}</span>
                                      </TableCell>
                                      <TableCell className="py-2">
                                        {agent.hasTrainingCourse ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <span className="text-xs text-muted-foreground">—</span>}
                                      </TableCell>
                                      {section.key === "live" && (
                                        <TableCell className="py-2 text-right">
                                          <span className="text-xs font-semibold">{agent.weeklyALP > 0 ? `$${agent.weeklyALP.toLocaleString()}` : "—"}</span>
                                        </TableCell>
                                      )}
                                      {section.key === "live" && (
                                        <TableCell className="py-2 text-right">
                                          <span className="text-xs">{agent.weeklyDeals > 0 ? agent.weeklyDeals : "—"}</span>
                                        </TableCell>
                                      )}
                                      <TableCell className="py-2">
                                        <Badge variant="outline" className={cn("text-[10px]", attendanceColors[agent.attendanceStatus])}>
                                          {attendanceLabels[agent.attendanceStatus]}
                                        </Badge>
                                      </TableCell>
                                      <TableCell className="py-2">
                                        <motion.div animate={{ rotate: isExpanded ? 90 : 0 }} transition={{ duration: 0.15 }}>
                                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                                        </motion.div>
                                      </TableCell>
                                    </TableRow>
                                    <AnimatePresence>
                                      {isExpanded && (
                                        <tr>
                                          <td colSpan={bulkMode ? 9 : 8} className="p-0">
                                            <AgentExpandedRow
                                              agent={agent}
                                              onRefresh={fetchAgents}
                                              onStageUpdate={handleOptimisticStageUpdate}
                                              onGoLive={setInstagramPromptAgent}
                                              onDeactivate={setDeactivateAgent}
                                              onViewApp={setViewAppAgentId}
                                              onRecord={setRecorderAgent}
                                              onAgentUpdate={onAgentUpdate}
                                              playSound={playSound}
                                              sendingCourseLogin={sendingCourseLogin}
                                              setSendingCourseLogin={setSendingCourseLogin}
                                              currentAgentId={currentAgentIdRef[0]}
                                            />
                                          </td>
                                        </tr>
                                      )}
                                    </AnimatePresence>
                                  </motion.tbody>
                                );
                              })}
                            </TableBody>
                          </Table>
                        )}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Modals */}
      <ApplicationDetailSheet open={!!viewAppAgentId} onOpenChange={(o) => !o && setViewAppAgentId(null)} agentId={viewAppAgentId || undefined} />
      <DeactivateAgentDialog open={!!deactivateAgent} onOpenChange={(o) => !o && setDeactivateAgent(null)} agentId={deactivateAgent?.id || ""} agentName={deactivateAgent?.name || ""} currentManagerId={deactivateAgent?.managerId} onComplete={fetchAgents} />
      <InstagramPromptDialog open={!!instagramPromptAgent} onOpenChange={(o) => !o && setInstagramPromptAgent(null)} agentId={instagramPromptAgent?.id || ""} agentName={instagramPromptAgent?.name || ""} onComplete={fetchAgents} />
      {recorderAgent && user && (
        <InterviewRecorder applicationId={recorderAgent.id} agentId={recorderAgent.id} applicantName={recorderAgent.name} onClose={() => setRecorderAgent(null)} onTranscriptionSaved={fetchAgents} />
      )}
    </DashboardLayout>
  );
}
