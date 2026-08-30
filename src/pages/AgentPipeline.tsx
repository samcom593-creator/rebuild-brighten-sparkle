import { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useMountedRef } from "@/hooks/useMountedRef";
import { motion, AnimatePresence } from "framer-motion";
import {
  Users, Phone, Mail, Search, LayoutGrid, List, Filter,
  Clock, Award, Calendar, UserCheck, ChevronRight, KeyRound,
  UsersRound, User, Zap, TrendingUp, Activity, CheckSquare,
  Square, Send, RefreshCw, Flame, X,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useRealtimeTable } from "@/shared/realtime/useRealtimeTable";
import { GlassCard } from "@/components/ui/glass-card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  KanbanBoard, KanbanApplication, KanbanStage, KANBAN_COLUMNS, getColumnForApp, toDbStage,
} from "@/components/pipeline/KanbanBoard";
import { InterviewScheduler } from "@/components/dashboard/InterviewScheduler";
import { ApplicationDetailSheet } from "@/components/dashboard/ApplicationDetailSheet";
import { LicenseProgressSelector } from "@/components/dashboard/LicenseProgressSelector";
import { LastContactedBadge } from "@/components/dashboard/LastContactedBadge";
import { QuickEmailMenu } from "@/components/dashboard/QuickEmailMenu";
import { ResendLicensingButton } from "@/components/callcenter/ResendLicensingButton";
import { useSoundEffects } from "@/hooks/useSoundEffects";
import { FOLLOWUP_TIMING } from "@/lib/apexConfig";
import { formatDistanceToNow, differenceInDays, differenceInHours } from "date-fns";

interface Application extends KanbanApplication {
  status: string;
  notes?: string | null;
  contacted_at?: string | null;
  created_at: string;
}

// ─── Urgency scoring: lower = more urgent ─────────────────────────────────────
function urgencyScore(app: Application): number {
  const last = app.last_contacted_at || app.contacted_at;
  const hoursStale = last
    ? differenceInHours(new Date(), new Date(last))
    : 9999;
  const score = (app.lead_score ?? 50) - hoursStale * 0.4;
  return score;
}

// ─── At-risk: never contacted OR >48 h stale, not licensed ───────────────────
function isAtRisk(app: Application): boolean {
  if (app.license_status === "licensed") return false;
  const last = app.last_contacted_at || app.contacted_at;
  if (!last) return true;
  return differenceInHours(new Date(), new Date(last)) >= FOLLOWUP_TIMING.needsContactHours;
}

// ─── Stat card with animated counter ─────────────────────────────────────────
function StatCard({
  label, value, icon: Icon, color, active, onClick, sub,
}: {
  label: string; value: number; icon: any; color: string;
  active?: boolean; onClick?: () => void; sub?: string;
}) {
  return (
    <motion.div whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}>
      <GlassCard
        className={cn(
          "p-4 cursor-pointer transition-all select-none",
          active && "ring-2 ring-primary shadow-lg shadow-primary/10"
        )}
        onClick={onClick}
      >
        <div className="flex items-center gap-3">
          <div className={cn("p-2 rounded-lg bg-muted/70", active && "bg-primary/10")}>
            <Icon className={cn("h-5 w-5", color)} />
          </div>
          <div>
            <p className={cn("text-2xl font-bold tabular-nums", color)}>{value}</p>
            <p className="text-xs text-muted-foreground leading-tight">{label}</p>
            {sub && <p className="text-[10px] text-muted-foreground/60">{sub}</p>}
          </div>
        </div>
      </GlassCard>
    </motion.div>
  );
}

// ─── Conversion funnel bar ────────────────────────────────────────────────────
function FunnelBar({ stages }: { stages: { label: string; count: number; color: string }[] }) {
  const max = Math.max(...stages.map((s) => s.count), 1);
  return (
    <GlassCard className="p-4 mb-6">
      <div className="flex items-center gap-2 mb-3">
        <TrendingUp className="h-4 w-4 text-primary" />
        <span className="text-sm font-semibold">Pipeline Funnel</span>
      </div>
      <div className="space-y-1.5">
        {stages.map((s) => (
          <div key={s.label} className="flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground w-24 truncate shrink-0">{s.label}</span>
            <div className="flex-1 h-2 bg-muted/40 rounded-full overflow-hidden">
              <motion.div
                className={cn("h-full rounded-full", s.color)}
                initial={{ width: 0 }}
                animate={{ width: `${(s.count / max) * 100}%` }}
                transition={{ duration: 0.6, ease: "easeOut" }}
              />
            </div>
            <span className="text-[10px] text-muted-foreground w-5 text-right shrink-0">{s.count}</span>
          </div>
        ))}
      </div>
    </GlassCard>
  );
}

// ─── At-risk banner ───────────────────────────────────────────────────────────
function AtRiskBanner({ count, onClick }: { count: number; onClick: () => void }) {
  if (count === 0) return null;
  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      className="mb-4"
    >
      <button
        onClick={onClick}
        className="w-full flex items-center gap-3 px-4 py-3 rounded-md bg-red-500/10 border border-red-500/30 text-sm hover:bg-red-500/15 transition-colors text-left"
      >
        <Flame className="h-4 w-4 text-red-400 shrink-0 animate-pulse" />
        <span className="font-medium text-red-300">
          {count} recruit{count !== 1 ? "s" : ""} at risk — no contact in 48+ hours
        </span>
        <Badge className="ml-auto bg-red-500/20 text-red-400 border-red-500/30 shrink-0">
          View
        </Badge>
      </button>
    </motion.div>
  );
}

// ─── Bulk action toolbar ──────────────────────────────────────────────────────
function BulkToolbar({
  selectedIds,
  onClear,
  onMarkContacted,
  onEmailBlast,
  sending,
}: {
  selectedIds: Set<string>;
  onClear: () => void;
  onMarkContacted: () => void;
  onEmailBlast: () => void;
  sending: boolean;
}) {
  if (selectedIds.size === 0) return null;
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50"
    >
      <div className="flex items-center gap-2 px-4 py-3 rounded-md bg-card border border-border shadow-2xl shadow-black/40">
        <Badge variant="outline" className="bg-primary/10 text-primary border-primary/30">
          {selectedIds.size} selected
        </Badge>
        <Button size="sm" variant="outline" onClick={onMarkContacted} disabled={sending} className="h-8 gap-1.5">
          <CheckSquare className="h-3.5 w-3.5" />
          Mark Contacted
        </Button>
        <Button size="sm" variant="outline" onClick={onEmailBlast} disabled={sending} className="h-8 gap-1.5">
          {sending ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
          Email Blast
        </Button>
        <Button size="icon"
        aria-label="Close" variant="ghost" onClick={onClear} className="h-8 w-8">
          <X className="h-4 w-4" />
        </Button>
      </div>
    </motion.div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function AgentPipeline() {
  const navigate   = useNavigate();
  const { user, isAdmin, isManager } = useAuth();
  const { playSound } = useSoundEffects();
  const mounted    = useMountedRef();

  const [applications, setApplications] = useState<Application[]>([]);
  const [agentId, setAgentId]           = useState<string | null>(null);
  const [loading, setLoading]           = useState(true);
  const [viewMode, setViewMode]         = useState<"list" | "kanban">("list");
  const [searchQuery, setSearchQuery]   = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortMode, setSortMode]         = useState<"urgency" | "recent" | "name">("urgency");
  const [teamMode, setTeamMode]         = useState<"mine" | "team">("mine");
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(["needs_outreach"]));
  const [showFunnel, setShowFunnel]     = useState(false);
  const [selectedIds, setSelectedIds]   = useState<Set<string>>(new Set());
  const [bulkSending, setBulkSending]   = useState(false);
  const [schedulerOpen, setSchedulerOpen] = useState(false);
  const [schedulerApp, setSchedulerApp] = useState<Application | null>(null);
  const [detailAppId, setDetailAppId]   = useState<string | null>(null);

  const fetchApplications = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const { data: agentData } = await supabase
        .from("agents").select("id").eq("user_id", user.id).maybeSingle();
      if (!mounted.current) return;
      if (!agentData) { setLoading(false); return; }
      setAgentId(agentData.id);

      let query = supabase.from("applications").select("*").is("terminated_at", null);

      if (teamMode === "team" && (isManager || isAdmin)) {
        const { data: teamAgents } = await supabase
          .from("agents").select("id").eq("invited_by_manager_id", agentData.id);
        const ids = [agentData.id, ...(teamAgents || []).map((a) => a.id)];
        const inList = `(${ids.join(",")})`;
        query = query.or(
          `assigned_agent_id.in.${inList},referral_manager_id.in.${inList},recruiter_id.in.${inList}`,
        );
      } else {
        query = query.or(
          `assigned_agent_id.eq.${agentData.id},referral_manager_id.eq.${agentData.id},recruiter_id.eq.${agentData.id}`,
        );
      }

      const { data, error } = await query.order("created_at", { ascending: false });
      if (error) throw error;
      if (!mounted.current) return;
      setApplications((data || []) as Application[]);
    } catch (err) {
      console.error("Error fetching pipeline:", err);
      if (mounted.current) toast.error("Failed to load pipeline");
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [user, teamMode, isManager, isAdmin, mounted]);

  useEffect(() => { fetchApplications(); }, [fetchApplications]);

  // ─── Real-time sync ────────────────────────────────────────────────────────
  useRealtimeTable(
    { table: "applications", event: "*", channelSuffix: "pipeline-page", enabled: !!agentId },
    ({ eventType, new: newRow, old: oldRow }) => {
      if (eventType === "INSERT" && newRow) {
        setApplications((prev) => {
          if (prev.find((a) => a.id === (newRow as Application).id)) return prev;
          return [newRow as Application, ...prev];
        });
      }
      if (eventType === "UPDATE" && newRow) {
        setApplications((prev) =>
          prev.map((a) => a.id === (newRow as Application).id ? { ...a, ...newRow } as Application : a)
        );
      }
      if (eventType === "DELETE" && oldRow) {
        setApplications((prev) => prev.filter((a) => a.id !== (oldRow as any).id));
      }
    }
  );

  // ─── Stage change ──────────────────────────────────────────────────────────
  const handleStageChange = useCallback(async (applicationId: string, newStage: KanbanStage) => {
    const app = applications.find((a) => a.id === applicationId);
    const prevStage = app?.license_progress ?? "new_applicant";
    try {
      const updateData: Record<string, unknown> = { license_progress: toDbStage(newStage) };
      if (newStage === "licensed") updateData.license_status = "licensed";

      const { error } = await supabase.from("applications").update(updateData as never).eq("id", applicationId);
      if (error) throw error;

      setApplications((prev) =>
        prev.map((a) =>
          a.id === applicationId
            ? { ...a, license_progress: toDbStage(newStage), license_status: newStage === "licensed" ? "licensed" : a.license_status }
            : a
        )
      );

      // Fire Discord notification (fire-and-forget, never blocks UI).
      // discord-webhook-notify only supports 8 event_types — sending
      // "stage_change" or "milestone" returns 400 and the call silently
      // failed (the .catch swallowed it). The right ping for "this
      // applicant just got licensed and is now an active agent" is
      // `agent_activated`. For interim stage promotions there's no
      // matching Discord event yet, so we simply skip the post rather
      // than send a request that's guaranteed to 400.
      if (app && newStage === "licensed") {
        supabase.functions.invoke("discord-webhook-notify", {
          body: {
            event_type: "agent_activated",
            details: {
              agent_name:  `${app.first_name} ${app.last_name}`,
              hired_by:    app.assigned_manager_name ?? "APEX",
              referred_by: null,
              instagram_handle: null,
            },
          },
        }).catch((err) => console.warn("[AgentPipeline] discord ping failed:", err));
      }

      if (newStage === "licensed") {
        playSound("celebrate");
        toast.success("🎉 Agent is now licensed!");
        if (app && agentId) {
          supabase.functions.invoke("add-agent", {
            body: {
              firstName: app.first_name, lastName: app.last_name,
              email: app.email, phone: app.phone || "",
              managerId: agentId, licenseStatus: "licensed", hasTrainingCourse: true,
            },
          }).then(({ error: addErr }) => {
            if (!addErr) toast.success(`${app.first_name} added to Dashboard & enrolled in course`);
          });
        }
      } else {
        playSound("success");
        toast.success("Stage updated");
      }
    } catch (err) {
      console.error("Error updating stage:", err);
      playSound("error");
      toast.error("Failed to update stage");
    }
  }, [applications, agentId, playSound]);

  // ─── Bulk actions ──────────────────────────────────────────────────────────
  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleBulkMarkContacted = async () => {
    if (!selectedIds.size) return;
    setBulkSending(true);
    const now = new Date().toISOString();
    const { error } = await supabase
      .from("applications")
      .update({ last_contacted_at: now })
      .in("id", [...selectedIds]);
    setBulkSending(false);
    if (error) { toast.error("Failed to update"); return; }
    setApplications((prev) =>
      prev.map((a) => selectedIds.has(a.id) ? { ...a, last_contacted_at: now } : a)
    );
    toast.success(`Marked ${selectedIds.size} recruits as contacted`);
    setSelectedIds(new Set());
  };

  const handleBulkEmailBlast = async () => {
    if (!selectedIds.size || !agentId) return;
    setBulkSending(true);
    const targets = applications.filter((a) => selectedIds.has(a.id));
    try {
      await supabase.functions.invoke("bulk-agent-message", {
        body: {
          agentId,
          applicationIds: [...selectedIds],
          type: "general",
          recipientCount: targets.length,
        },
      });
      toast.success(`Blast sent to ${targets.length} recruits`);
      setSelectedIds(new Set());
    } catch {
      toast.error("Failed to send blast");
    } finally {
      setBulkSending(false);
    }
  };

  // ─── Filtering & sorting ───────────────────────────────────────────────────
  const filteredApps = useMemo(() => {
    let list = applications.filter((app) => {
      const name = `${app.first_name} ${app.last_name}`.toLowerCase();
      const matchSearch =
        name.includes(searchQuery.toLowerCase()) ||
        app.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (app.phone || "").includes(searchQuery);
      const matchStatus =
        statusFilter === "all" ||
        (statusFilter === "at_risk"    && isAtRisk(app)) ||
        (statusFilter === "needs_contact" && !app.contacted_at) ||
        (statusFilter === "in_progress"   && app.contacted_at && app.license_status !== "licensed") ||
        (statusFilter === "licensed"       && app.license_status === "licensed");
      return matchSearch && matchStatus;
    });

    list = [...list].sort((a, b) => {
      if (sortMode === "urgency") return urgencyScore(a) - urgencyScore(b);
      if (sortMode === "name")    return `${a.first_name} ${a.last_name}`.localeCompare(`${b.first_name} ${b.last_name}`);
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });

    return list;
  }, [applications, searchQuery, statusFilter, sortMode]);

  // ─── Group for accordion ───────────────────────────────────────────────────
  const sectionApps = useMemo(() =>
    KANBAN_COLUMNS.reduce<Record<string, Application[]>>((acc, col) => {
      acc[col.id] = filteredApps.filter((app) => getColumnForApp(app) === col.id);
      return acc;
    }, {}),
    [filteredApps]
  );

  // ─── Stats ─────────────────────────────────────────────────────────────────
  const totalLeads   = applications.length;
  const atRiskCount  = applications.filter(isAtRisk).length;
  const inProgress   = applications.filter((a) => a.contacted_at && a.license_status !== "licensed").length;
  const licensed     = applications.filter((a) => a.license_status === "licensed").length;
  const convRate     = totalLeads > 0 ? Math.round((licensed / totalLeads) * 100) : 0;

  const funnelStages = useMemo(() => KANBAN_COLUMNS.map((col) => ({
    label: col.label,
    count: applications.filter((a) => getColumnForApp(a) === col.id).length,
    color: col.id === "licensed"
      ? "bg-emerald-500" : col.id === "dormant"
      ? "bg-slate-500"   : col.id === "needs_outreach"
      ? "bg-red-500"     : "bg-primary",
  })), [applications]);

  const getContactBadgeStyle = (app: Application) => {
    const last = app.last_contacted_at || app.contacted_at;
    if (!last)                                             return "bg-destructive/20 text-destructive border-destructive/30";
    if (differenceInHours(new Date(), new Date(last)) > 48) return "bg-amber-500/20 text-amber-400 border-amber-500/30";
    return "bg-emerald-500/20 text-emerald-400 border-emerald-500/30";
  };

  const toggleSection = (id: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); playSound("click"); }
      else { next.add(id); playSound("whoosh"); }
      return next;
    });
  };
  const expandAllSections = () => {
    setExpandedSections(new Set(KANBAN_COLUMNS.map((c) => c.id)));
    playSound("whoosh");
  };
  const collapseAllSections = () => {
    setExpandedSections(new Set());
    playSound("click");
  };

  const renderAppRow = (app: Application) => {
    const badgeStyle = getContactBadgeStyle(app);
    const last       = app.last_contacted_at || app.contacted_at;
    const contactLabel = last
      ? formatDistanceToNow(new Date(last), { addSuffix: true })
      : "Never";
    const daysInPipeline = differenceInDays(new Date(), new Date(app.created_at));
    const atRisk         = isAtRisk(app);
    const isSelected     = selectedIds.has(app.id);

    return (
      <motion.div
        key={app.id}
        layout
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className={cn(
          "px-3 py-2 border-b border-border/50 last:border-b-0 transition-colors",
          isSelected ? "bg-primary/5" : "hover:bg-muted/30",
          atRisk && !isSelected && "border-l-2 border-l-red-500/40"
        )}
      >
        <div className="flex flex-col md:flex-row md:items-center gap-3">
          {/* Checkbox */}
          <button
            className="shrink-0 text-muted-foreground hover:text-primary transition-colors"
            onClick={() => toggleSelect(app.id)}
          >
            {isSelected
              ? <CheckSquare className="h-4 w-4 text-primary" />
              : <Square className="h-4 w-4" />}
          </button>

          {/* Name & Contact */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5 flex-wrap">
              <h3
                className="font-semibold text-sm text-primary hover:underline cursor-pointer"
                onClick={() => navigate(`/dashboard/crm?focusAgentId=${app.id}`)}
              >
                {app.first_name} {app.last_name}
              </h3>
              <Badge variant="outline" className={cn("text-[10px]", badgeStyle)}>
                <Clock className="h-2.5 w-2.5 mr-1" />
                {contactLabel}
              </Badge>
              {atRisk && (
                <Badge className="bg-red-500/15 text-red-400 border-red-500/30 text-[10px]">
                  <Flame className="h-2.5 w-2.5 mr-1" />
                  At Risk
                </Badge>
              )}
              {app.lead_score != null && app.lead_score >= 70 && (
                <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30 text-[10px]">
                  <Zap className="h-2.5 w-2.5 mr-1" />
                  Hot Lead
                </Badge>
              )}
            </div>
            <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1"><Mail className="h-3 w-3" />{app.email}</span>
              {app.phone && <span className="flex items-center gap-1"><Phone className="h-3 w-3" />{app.phone}</span>}
              <span className="flex items-center gap-1 text-muted-foreground/50">
                <Activity className="h-3 w-3" />
                {daysInPipeline}d in pipeline
              </span>
            </div>
          </div>

          {/* Stage selector */}
          <div className="flex items-center gap-2 flex-wrap">
            {app.license_status !== "licensed" ? (
              <LicenseProgressSelector
                applicationId={app.id}
                currentProgress={app.license_progress as any}
                onProgressUpdated={fetchApplications}
              />
            ) : (
              <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30">
                <Award className="h-3 w-3 mr-1" />
                Licensed
              </Badge>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1.5">
            <LastContactedBadge applicationId={app.id} />
            <Button
              variant="ghost" size="icon"
              className="h-8 w-8 text-info hover:text-info hover:bg-info/10"
              onClick={() => { setSchedulerApp(app); setSchedulerOpen(true); }}
              title="Schedule Interview"
            >
              <Calendar className="h-4 w-4" />
            </Button>
            {agentId && (
              <QuickEmailMenu
                applicationId={app.id}
                agentId={agentId}
                licenseStatus={app.license_status as any}
                recipientEmail={app.email}
                recipientName={`${app.first_name} ${app.last_name}`}
                onEmailSent={fetchApplications}
                displayMode="icon"
              />
            )}
            {app.license_status !== "licensed" && (
              <ResendLicensingButton
                recipientEmail={app.email}
                recipientName={app.first_name}
                licenseStatus={app.license_status as any}
              />
            )}
            <Button
              variant="ghost" size="icon"
              className="h-8 w-8 text-violet-400 hover:text-violet-300 hover:bg-violet-500/10"
              title="Send portal login link"
              onClick={async () => {
                if (!app.email) { toast.error("No email on file"); return; }
                try {
                  const { error } = await supabase.functions.invoke("send-agent-portal-login", {
                    body: { applicationId: app.id, email: app.email },
                  });
                  if (error) throw error;
                  toast.success(`Login link sent to ${app.email}`);
                  playSound("success");
                } catch (e: any) {
                  toast.error(e?.message || "Failed to send login link");
                  playSound("error");
                }
              }}
            >
              <KeyRound className="h-4 w-4" />
            </Button>
            {app.phone && (
              <Button variant="ghost" size="icon"
              aria-label="Call agent"
                className="h-8 w-8 text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10"
                asChild
              >
                <a href={`tel:${app.phone}`}><Phone className="h-4 w-4" /></a>
              </Button>
            )}
          </div>
        </div>
      </motion.div>
    );
  };

  return (
    <>
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="mb-6">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-md bg-primary/10">
              <Users className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-3xl font-bold">My Pipeline</h1>
              <p className="text-muted-foreground text-sm">
                Track recruits through licensing — live, real-time
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {(isManager || isAdmin) && (
              <div className="flex items-center gap-1 bg-muted rounded-lg p-1">
                <Button variant={teamMode === "mine" ? "secondary" : "ghost"} size="sm"
                  onClick={() => { setTeamMode("mine"); playSound("click"); }} className="h-8 gap-1.5">
                  <User className="h-3.5 w-3.5" />My Recruits
                </Button>
                <Button variant={teamMode === "team" ? "secondary" : "ghost"} size="sm"
                  onClick={() => { setTeamMode("team"); playSound("click"); }} className="h-8 gap-1.5">
                  <UsersRound className="h-3.5 w-3.5" />Full Team
                </Button>
              </div>
            )}
            <Button variant="ghost" size="sm" onClick={() => { setShowFunnel((v) => !v); playSound("click"); }}
              className={cn("h-8 gap-1.5", showFunnel && "bg-primary/10 text-primary")}>
              <TrendingUp className="h-3.5 w-3.5" />
              Funnel
            </Button>
            <div className="flex items-center gap-1 bg-muted rounded-lg p-1">
              <Button variant={viewMode === "list" ? "secondary" : "ghost"} size="sm"
                onClick={() => { setViewMode("list"); playSound("click"); }} className="h-8">
                <List className="h-4 w-4 mr-1" />List
              </Button>
              <Button variant={viewMode === "kanban" ? "secondary" : "ghost"} size="sm"
                onClick={() => { setViewMode("kanban"); playSound("click"); }} className="h-8">
                <LayoutGrid className="h-4 w-4 mr-1" />Kanban
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* ── At-risk banner ──────────────────────────────────────────────────── */}
      <AtRiskBanner
        count={atRiskCount}
        onClick={() => setStatusFilter((v) => v === "at_risk" ? "all" : "at_risk")}
      />

      {/* ── Stats ───────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard label="Total Recruits" value={totalLeads} icon={Users}
          color="text-primary" active={statusFilter === "all"} onClick={() => setStatusFilter("all")} />
        <StatCard label="At Risk" value={atRiskCount} icon={Flame}
          color="text-red-400" active={statusFilter === "at_risk"}
          onClick={() => setStatusFilter((v) => v === "at_risk" ? "all" : "at_risk")}
          sub="48+ h no contact" />
        <StatCard label="In Progress" value={inProgress} icon={UserCheck}
          color="text-amber-400" active={statusFilter === "in_progress"}
          onClick={() => setStatusFilter("in_progress")} />
        <StatCard label="Licensed" value={licensed} icon={Award}
          color="text-emerald-400" active={statusFilter === "licensed"}
          onClick={() => setStatusFilter("licensed")}
          sub={totalLeads > 0 ? `${convRate}% conversion` : undefined} />
      </div>

      {/* ── Funnel ──────────────────────────────────────────────────────────── */}
      <AnimatePresence>
        {showFunnel && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.25 }}>
            <FunnelBar stages={funnelStages} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Filters ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search by name, email, or phone…"
            value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10 bg-input" />
        </div>
        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); playSound("click"); }}>
          <SelectTrigger className="w-full sm:w-44 bg-input">
            <Filter className="h-4 w-4 mr-2" />
            <SelectValue placeholder="Filter" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Recruits</SelectItem>
            <SelectItem value="at_risk">🔥 At Risk</SelectItem>
            <SelectItem value="needs_contact">Needs Contact</SelectItem>
            <SelectItem value="in_progress">In Progress</SelectItem>
            <SelectItem value="licensed">Licensed</SelectItem>
          </SelectContent>
        </Select>
        <Select value={sortMode} onValueChange={(v) => setSortMode(v as any)}>
          <SelectTrigger className="w-full sm:w-40 bg-input">
            <SelectValue placeholder="Sort" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="urgency">🔥 By Urgency</SelectItem>
            <SelectItem value="recent">🕐 Most Recent</SelectItem>
            <SelectItem value="name">A–Z Name</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* ── Content ─────────────────────────────────────────────────────────── */}
      <div>
        {loading ? (
          <div className="space-y-3">
            {[1,2,3].map((i) => (
              // stable-key-allow:skeleton
              <div key={i} className="h-16 rounded-md bg-muted/40 animate-pulse" />
            ))}
          </div>
        ) : filteredApps.length === 0 ? (
          <GlassCard className="p-12 text-center">
            <Users className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-2">No recruits found</h3>
            <p className="text-muted-foreground text-sm">
              {applications.length === 0
                ? "You don't have any recruits assigned yet."
                : "Try adjusting your search or filter."}
            </p>
          </GlassCard>
        ) : viewMode === "kanban" ? (
          <KanbanBoard
            applications={filteredApps}
            onStageChange={handleStageChange}
            onCardClick={(app) => setDetailAppId(app.id)}
            onScheduleInterview={(app) => { setSchedulerApp(app as Application); setSchedulerOpen(true); }}
          />
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-end gap-2 -mt-2">
              <button
                onClick={expandAllSections}
                className="text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
              >
                Expand all
              </button>
              <span className="text-muted-foreground/40">·</span>
              <button
                onClick={collapseAllSections}
                className="text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
              >
                Collapse all
              </button>
            </div>
            {KANBAN_COLUMNS.map((col) => {
              const apps  = sectionApps[col.id] || [];
              const isOpen = expandedSections.has(col.id);
              const hasRisk = apps.some(isAtRisk);
              return (
                <div key={col.id}>
                  <div className={cn(
                    "rounded-md border-2 overflow-hidden transition-all",
                    col.color, isOpen && "shadow-lg"
                  )}>
                    <button
                      onClick={() => toggleSection(col.id)}
                      className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/30 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-lg">{col.emoji}</span>
                        <span className="font-semibold text-sm text-foreground">{col.label}</span>
                        <Badge variant="outline" className="text-xs bg-muted border-border text-muted-foreground">
                          {apps.length}
                        </Badge>
                        {hasRisk && (
                          <Badge className="bg-red-500/15 text-red-400 border-red-500/30 text-[10px]">
                            <Flame className="h-2.5 w-2.5 mr-0.5" />
                            {apps.filter(isAtRisk).length}
                          </Badge>
                        )}
                      </div>
                      <motion.div animate={{ rotate: isOpen ? 90 : 0 }} transition={{ duration: 0.2 }}>
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      </motion.div>
                    </button>

                    <AnimatePresence>
                      {isOpen && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.25, ease: "easeInOut" }}
                          className="overflow-hidden"
                        >
                          <div className="border-t border-border/50">
                            {apps.length === 0 ? (
                              <div className="py-8 text-center text-sm text-muted-foreground/50 italic">
                                No recruits in this stage
                              </div>
                            ) : (
                              <>
                                {apps.slice(0, 100).map((app) => renderAppRow(app))}
                                {apps.length > 100 && (
                                  <div className="py-2 text-center text-xs text-muted-foreground">
                                    +{apps.length - 100} more in this stage — narrow with search or filters
                                  </div>
                                )}
                              </>
                            )}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Modals ──────────────────────────────────────────────────────────── */}
      {schedulerApp && (
        <InterviewScheduler
          open={schedulerOpen}
          onOpenChange={(open) => { setSchedulerOpen(open); if (!open) setSchedulerApp(null); }}
          applicationId={schedulerApp.id}
          applicantName={`${schedulerApp.first_name} ${schedulerApp.last_name}`}
          applicantEmail={schedulerApp.email}
          onScheduled={fetchApplications}
        />
      )}
      <ApplicationDetailSheet
        open={!!detailAppId}
        onOpenChange={(o) => !o && setDetailAppId(null)}
        applicationId={detailAppId ?? undefined}
        onRefresh={fetchApplications}
      />

      {/* ── Bulk toolbar ────────────────────────────────────────────────────── */}
      <AnimatePresence>
        <BulkToolbar
          selectedIds={selectedIds}
          onClear={() => setSelectedIds(new Set())}
          onMarkContacted={handleBulkMarkContacted}
          onEmailBlast={handleBulkEmailBlast}
          sending={bulkSending}
        />
      </AnimatePresence>
    </>
  );
}
