import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Star, Zap, Flame, Trophy, Phone, Mail, MapPin, Calendar,
  Clock, Search, ChevronRight, GraduationCap,
  BookOpen, BookCheck, CalendarClock, FileCheck, Fingerprint,
  Award, Users, UserCheck, AlertTriangle, TrendingUp, Sparkles,
  MessageSquare, ChevronDown, ChevronUp, Plus, ExternalLink, AlertCircle,
  Activity,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useSoundEffects } from "@/hooks/useSoundEffects";
import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { LicenseProgressSelector } from "@/components/dashboard/LicenseProgressSelector";
import { ResendLicensingButton } from "@/components/callcenter/ResendLicensingButton";
import { QuickEmailMenu } from "@/components/dashboard/QuickEmailMenu";
import { ConfettiCelebration } from "@/components/dashboard/ConfettiCelebration";
import { ActivityTimeline } from "@/components/recruiter/ActivityTimeline";
import { logLeadActivity } from "@/lib/logLeadActivity";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { Navigate } from "react-router-dom";

// ─── Constants ────────────────────────────────────────────────────────────────
const AISHA_EMAIL = "kebbeh045@gmail.com";

const UNLICENSED_SCHEDULING_LINK = "https://calendly.com/apexlifeadvisors/15min";
const LICENSED_SCHEDULING_LINK = "https://calendly.com/apexlifeadvisors/30min";

const XP_REWARDS = {
  contact: 10,
  stage_update: 15,
  test_scheduled: 25,
  licensed: 100,
  note_added: 5,
};

const RANK_LEVELS = [
  { min: 0, label: "Rookie", color: "text-muted-foreground", emoji: "🌱" },
  { min: 100, label: "Rising Star", color: "text-blue-400", emoji: "⭐" },
  { min: 300, label: "Power Recruiter", color: "text-purple-400", emoji: "💜" },
  { min: 600, label: "Elite", color: "text-amber-400", emoji: "👑" },
  { min: 1000, label: "Legend", color: "text-rose-400", emoji: "🔥" },
];

const PROGRESS_COLUMNS = [
  {
    id: "needs_outreach",
    label: "Needs Outreach",
    emoji: "📣",
    values: ["unlicensed"],
    color: "border-rose-500/30 bg-rose-500/5",
    headerColor: "text-rose-400",
  },
  {
    id: "course",
    label: "In Course",
    emoji: "📚",
    values: ["course_purchased", "finished_course"],
    color: "border-blue-500/30 bg-blue-500/5",
    headerColor: "text-blue-400",
  },
  {
    id: "test_phase",
    label: "Test Phase",
    emoji: "✏️",
    values: ["test_scheduled", "passed_test"],
    color: "border-purple-500/30 bg-purple-500/5",
    headerColor: "text-purple-400",
  },
  {
    id: "final_steps",
    label: "Final Steps",
    emoji: "🏁",
    values: ["fingerprints_done", "waiting_on_license"],
    color: "border-amber-500/30 bg-amber-500/5",
    headerColor: "text-amber-400",
  },
  {
    id: "licensed",
    label: "Licensed! 🎉",
    emoji: "🏆",
    values: ["licensed"],
    color: "border-emerald-500/30 bg-emerald-500/5",
    headerColor: "text-emerald-400",
  },
];

type SortMode = "stale" | "newest" | "oldest" | "name";

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
      initial={{ opacity: 0, scale: 0.8, y: 20 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ delay, type: "spring", stiffness: 300, damping: 20 }}
      whileHover={{ scale: 1.04 }}
      className={cn(
        "relative overflow-hidden rounded-2xl border p-4 text-center cursor-default",
        color
      )}
    >
      <div className="flex items-center justify-center mb-2">
        <Icon className="h-5 w-5" />
      </div>
      <p className="text-2xl font-bold">{value}</p>
      <p className="text-[11px] text-muted-foreground mt-0.5 leading-tight">{label}</p>
      <div className="absolute -right-3 -top-3 h-10 w-10 rounded-full bg-current opacity-10 blur-xl" />
    </motion.div>
  );
}

function LeadCard({
  lead,
  agentId,
  onRefresh,
  onXP,
  onCelebrate,
}: {
  lead: Lead;
  agentId: string | null;
  onRefresh: () => void;
  onXP: (pts: number, label: string) => void;
  onCelebrate: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [noteText, setNoteText] = useState(lead.notes || "");
  const [savingNote, setSavingNote] = useState(false);
  const { playSound } = useSoundEffects();

  const [showTimeline, setShowTimeline] = useState(false);

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

  const handleContactLogged = useCallback(async () => {
    logLeadActivity({
      leadId: lead.id,
      type: "call_attempt",
      title: `Called ${lead.first_name}`,
      details: { phone: lead.phone },
    });
    try {
      await supabase
        .from("applications")
        .update({ last_contacted_at: new Date().toISOString() })
        .eq("id", lead.id);
      onXP(XP_REWARDS.contact, "📞 Contact logged!");
      playSound("success");
      onRefresh();
    } catch {
      console.error("Failed to log contact");
    }
  }, [lead.id, lead.first_name, lead.phone, onXP, playSound, onRefresh]);

  const contactColor = contactBadgeColor(lead);
  const contactLabel = contactBadgeLabel(lead);
  const fullName = `${lead.first_name} ${lead.last_name}`.trim();
  const location = [lead.city, lead.state].filter(Boolean).join(", ");

  return (
    <TooltipProvider delayDuration={200}>
      <motion.div
        layout
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95 }}
        whileHover={{ y: -1 }}
        transition={{ type: "spring", stiffness: 300, damping: 25 }}
        className="bg-card border border-border rounded-xl overflow-hidden shadow-sm"
      >
        <div className="p-2.5 space-y-1.5">
          {/* ── Row 1: Full name + location + freshness badge ── */}
          <div className="flex items-start justify-between gap-1.5">
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-sm leading-tight break-words">{fullName}</p>
              {location && (
                <span className="inline-flex items-center gap-0.5 mt-0.5 text-[10px] text-muted-foreground">
                  <MapPin className="h-2.5 w-2.5 flex-shrink-0" />
                  {location}
                </span>
              )}
            </div>
            <Badge className={cn("text-[9px] border shrink-0 whitespace-nowrap px-1.5 py-0", contactColor)}>
              <Clock className="h-2 w-2 mr-0.5" />
              {contactLabel}
            </Badge>
          </div>

          {/* ── Row 2: Phone | Email | License badge | Actions ── */}
          <div className="flex items-center gap-1.5 flex-wrap">
            {/* Contact info */}
            {lead.phone && (
              <a
                href={`tel:${lead.phone}`}
                onClick={handleContactLogged}
                className="text-[11px] text-emerald-400 hover:text-emerald-300 transition-colors font-medium"
              >
                {lead.phone}
              </a>
            )}
            {lead.phone && lead.email && <span className="text-muted-foreground/30 text-[10px]">|</span>}
            {lead.email && (
              <span className="text-[11px] text-muted-foreground truncate max-w-[120px]">{lead.email}</span>
            )}

            {/* Spacer to push actions right */}
            <div className="flex-1" />

            {/* Inline license progress */}
            <LicenseProgressSelector
              applicationId={lead.id}
              currentProgress={lead.license_progress as any}
              testScheduledDate={lead.test_scheduled_date}
              onProgressUpdated={() => handleProgressUpdated()}
              className="text-[10px] h-6"
            />
          </div>

          {/* ── Row 3: Icon-only action buttons ── */}
          <div className="flex items-center gap-1 pt-0.5">
            {/* Call */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  asChild
                  className="h-7 w-7 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10"
                  onClick={handleContactLogged}
                >
                  <a href={`tel:${lead.phone}`}>
                    <Phone className="h-3 w-3" />
                  </a>
                </Button>
              </TooltipTrigger>
              <TooltipContent><p>Call {lead.first_name}</p></TooltipContent>
            </Tooltip>

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
              className="text-xs h-7 w-7 px-0"
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
                  className="h-7 w-7 border-pink-500/30 text-pink-400 hover:bg-pink-500/10"
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
              <TooltipContent><p>Book a call</p></TooltipContent>
            </Tooltip>

            {/* Activity timeline toggle */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setShowTimeline((v) => !v)}
                  className="h-7 w-7 text-muted-foreground hover:text-foreground"
                >
                  <Activity className="h-3 w-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent><p>{showTimeline ? "Hide activity" : "Activity"}</p></TooltipContent>
            </Tooltip>

            {/* Notes toggle */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setExpanded((v) => !v)}
                  className="h-7 w-7 ml-auto text-muted-foreground hover:text-foreground"
                >
                  <MessageSquare className="h-3 w-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent><p>{expanded ? "Hide notes" : "Notes"}</p></TooltipContent>
            </Tooltip>
          </div>
        </div>

        {/* ── Expanded notes ── */}
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
    </TooltipProvider>
  );
}

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

  // Fetch leads assigned to Aisha (or all if admin viewing)
  const fetchLeads = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      // Get Aisha's agent record
      const { data: agentData } = await supabase
        .from("agents")
        .select("id")
        .eq("user_id", user?.id || "")
        .single();

      const myAgentId = agentData?.id || null;
      setAgentId(myAgentId);

      const query = supabase
        .from("applications")
        .select("id, first_name, last_name, email, phone, city, state, created_at, last_contacted_at, contacted_at, license_status, license_progress, test_scheduled_date, notes, assigned_agent_id")
        .is("terminated_at", null)
        .neq("license_status", "licensed")
        .in("status", ["reviewing", "contracting", "approved", "new"]);

      // If Aisha is viewing, show her assigned leads
      if (myAgentId) {
        query.eq("assigned_agent_id", myAgentId);
      }

      const { data, error } = await query.order("created_at", { ascending: false });
      if (error) throw error;
      setLeads(data || []);
    } catch (err) {
      console.error("RecruiterDashboard fetch error:", err);
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => { fetchLeads(); }, [fetchLeads]);

  // XP system (session-based, persisted to localStorage for fun)
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

  // Filter + sort
  const filtered = leads
    .filter((l) => {
      const q = search.toLowerCase();
      const name = `${l.first_name} ${l.last_name}`.toLowerCase();
      if (q && !name.includes(q) && !l.email.toLowerCase().includes(q) && !l.phone.includes(q)) return false;
      if (filterStage !== "all") {
        const col = PROGRESS_COLUMNS.find((c) => c.id === filterStage);
        if (col && !col.values.includes(l.license_progress || "unlicensed")) return false;
      }
      return true;
    })
    .sort((a, b) => {
      if (sortMode === "stale") return getLastContactAge(b) - getLastContactAge(a);
      if (sortMode === "newest") return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      if (sortMode === "oldest") return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      return `${a.first_name} ${a.last_name}`.localeCompare(`${b.first_name} ${b.last_name}`);
    });

  // Group by column
  const columnLeads = PROGRESS_COLUMNS.map((col) => ({
    ...col,
    leads: filtered.filter((l) => col.values.includes(l.license_progress || "unlicensed")),
  }));

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
    <div className="p-4 md:p-6 space-y-5 max-w-[1800px] mx-auto">
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
        className="relative overflow-hidden rounded-2xl border border-pink-500/20 bg-gradient-to-br from-pink-500/10 via-purple-500/5 to-transparent p-5"
      >
        <div className="flex flex-col md:flex-row md:items-center gap-4">
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-1">
              <Sparkles className="h-6 w-6 text-pink-400 animate-pulse" />
              <h1 className="text-2xl font-bold bg-gradient-to-r from-pink-400 to-purple-400 bg-clip-text text-transparent">
                Aisha's Recruiter HQ
              </h1>
              {advancedToday > 0 && (
                <motion.div
                  animate={{ scale: [1, 1.1, 1] }}
                  transition={{ repeat: Infinity, duration: 2 }}
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
          <div className="md:w-64 bg-background/60 rounded-xl p-3 border border-border/50">
            <XPBar xp={xp} />
          </div>

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

        {/* Background sparkle decoration */}
        <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-pink-500/10 blur-3xl pointer-events-none" />
        <div className="absolute -left-10 -bottom-10 h-32 w-32 rounded-full bg-purple-500/10 blur-3xl pointer-events-none" />
      </motion.div>

      {/* ── Stat bubbles ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatBubble icon={Users} label="Total Hired (Unlicensed)" value={totalLeads} color="border border-pink-500/20 bg-pink-500/5 text-pink-400" delay={0} />
        <StatBubble icon={AlertTriangle} label="Needs Contact" value={needsContact} color="border border-rose-500/20 bg-rose-500/5 text-rose-400" delay={0.06} />
        <StatBubble icon={TrendingUp} label="Actively In Progress" value={inProgress} color="border border-purple-500/20 bg-purple-500/5 text-purple-400" delay={0.12} />
        <StatBubble icon={Star} label="New This Month" value={thisMonth} color="border border-amber-500/20 bg-amber-500/5 text-amber-400" delay={0.18} />
      </div>

      {/* ── Search / Filter / Sort ── */}
      <GlassCard className="p-3 space-y-2">
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

        {/* Filter by stage + Sort in one scrollable row */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
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
            <option value="newest">Newest First</option>
            <option value="oldest">Oldest First</option>
            <option value="name">Name A–Z</option>
          </select>
        </div>
      </GlassCard>

      {/* ── Kanban columns ── */}
      <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-5 gap-4">
        {columnLeads.map((col, ci) => (
          <motion.div
            key={col.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: ci * 0.06 }}
            className={cn("rounded-2xl border p-3 min-h-[200px]", col.color)}
          >
            {/* Column header */}
            {(() => {
              const needsAttention = col.leads.filter((l) => getLastContactAge(l) > 48 * 3600 * 1000 || getLastContactAge(l) === Infinity).length;
              return (
                <div className={cn("flex items-center gap-2 mb-3 font-bold text-sm", col.headerColor)}>
                  <span className="text-base">{col.emoji}</span>
                  <span>{col.label}</span>
                  {needsAttention > 0 && (
                    <span className="flex items-center gap-0.5 text-[10px] font-medium text-rose-400 bg-rose-500/15 border border-rose-500/30 rounded-full px-1.5 py-0">
                      <AlertCircle className="h-2.5 w-2.5" />
                      {needsAttention}
                    </span>
                  )}
                  <Badge variant="outline" className={cn("ml-auto text-xs border", col.headerColor.replace("text-", "border-").replace("-400", "-400/40"))}>
                    {col.leads.length}
                  </Badge>
                </div>
              );
            })()}

            {/* Lead cards */}
            <div className="space-y-3">
              <AnimatePresence mode="popLayout">
                {col.leads.length === 0 ? (
                  <motion.p
                    key="empty"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="text-xs text-muted-foreground text-center py-8"
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
                    />
                  ))
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        ))}
      </div>

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
    </div>
  );
}
