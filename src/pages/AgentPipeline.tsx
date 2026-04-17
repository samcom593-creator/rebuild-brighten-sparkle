import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useMountedRef } from "@/hooks/useMountedRef";
import { motion, AnimatePresence } from "framer-motion";
import {
  Users,
  Phone,
  Mail,
  Search,
  LayoutGrid,
  List,
  Filter,
  Clock,
  Award,
  Calendar,
  UserCheck,
  AlertCircle,
  ChevronDown,
  ChevronRight,
  UsersRound,
  User,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

import { GlassCard } from "@/components/ui/glass-card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { KanbanBoard, KanbanApplication, KanbanStage, KANBAN_COLUMNS, getColumnForStage } from "@/components/pipeline/KanbanBoard";
import { InterviewScheduler } from "@/components/dashboard/InterviewScheduler";
import { ApplicationDetailSheet } from "@/components/dashboard/ApplicationDetailSheet";
import { LicenseProgressSelector } from "@/components/dashboard/LicenseProgressSelector";
import { LastContactedBadge } from "@/components/dashboard/LastContactedBadge";
import { QuickEmailMenu } from "@/components/dashboard/QuickEmailMenu";
import { ResendLicensingButton } from "@/components/callcenter/ResendLicensingButton";
import { useSoundEffects } from "@/hooks/useSoundEffects";
import { formatDistanceToNow } from "date-fns";

interface Application extends KanbanApplication {
  status: string;
  notes?: string | null;
  contacted_at?: string | null;
  created_at: string;
}

export default function AgentPipeline() {
  const navigate = useNavigate();
  const { user, isAdmin, isManager } = useAuth();
  const { playSound } = useSoundEffects();
  const mounted = useMountedRef();
  const [applications, setApplications] = useState<Application[]>([]);
  const [agentId, setAgentId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<"list" | "kanban">("list");
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [teamMode, setTeamMode] = useState<"mine" | "team">("mine");
  const [expandedSection, setExpandedSection] = useState<string | null>("needs_outreach");

  // Interview scheduler
  const [schedulerOpen, setSchedulerOpen] = useState(false);
  const [schedulerApp, setSchedulerApp] = useState<Application | null>(null);

  // Application detail sheet
  const [detailAppId, setDetailAppId] = useState<string | null>(null);

  const fetchApplications = useCallback(async () => {
    if (!user) return;
    setLoading(true);

    try {
      // Get agent record
      const { data: agentData } = await supabase
        .from("agents")
        .select("id")
        .eq("user_id", user.id)
        .maybeSingle();

      if (!mounted.current) return;
      if (!agentData) {
        setLoading(false);
        return;
      }
      setAgentId(agentData.id);

      if (teamMode === "team" && (isManager || isAdmin)) {
        // Fetch team agents under this manager
        const { data: teamAgents } = await supabase
          .from("agents")
          .select("id")
          .eq("invited_by_manager_id", agentData.id);

        const teamIds = [agentData.id, ...(teamAgents || []).map(a => a.id)];

        const { data, error } = await supabase
          .from("applications")
          .select("*")
          .in("assigned_agent_id", teamIds)
          .is("terminated_at", null)
          .order("created_at", { ascending: false });

        if (error) throw error;
        if (!mounted.current) return;
        setApplications((data || []) as Application[]);
      } else {
        // Fetch only my direct recruits
        const { data, error } = await supabase
          .from("applications")
          .select("*")
          .eq("assigned_agent_id", agentData.id)
          .is("terminated_at", null)
          .order("created_at", { ascending: false });

        if (error) throw error;
        if (!mounted.current) return;
        setApplications((data || []) as Application[]);
      }
    } catch (err) {
      console.error("Error fetching pipeline:", err);
      if (mounted.current) toast.error("Failed to load pipeline");
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [user, teamMode, isManager, isAdmin, mounted]);

  useEffect(() => {
    fetchApplications();
  }, [fetchApplications]);

  const handleStageChange = async (applicationId: string, newStage: KanbanStage) => {
    try {
      const updateData: Record<string, unknown> = { license_progress: newStage };
      if (newStage === "licensed") updateData.license_status = "licensed";

      const { error } = await supabase
        .from("applications")
        .update(updateData)
        .eq("id", applicationId);

      if (error) throw error;

      setApplications((prev) =>
        prev.map((a) =>
          a.id === applicationId
            ? { ...a, license_progress: newStage, license_status: newStage === "licensed" ? "licensed" : a.license_status }
            : a
        )
      );

      if (newStage === "licensed") {
        playSound("celebrate");
        toast.success("🎉 Congratulations! Agent is now licensed!");

        // Auto-create agent record so they appear in Dashboard, CRM, and Course
        const app = applications.find((a) => a.id === applicationId);
        if (app && agentId) {
          try {
            const { data: addResult, error: addError } = await supabase.functions.invoke("add-agent", {
              body: {
                firstName: app.first_name,
                lastName: app.last_name,
                email: app.email,
                phone: app.phone || "",
                managerId: agentId,
                licenseStatus: "licensed",
                hasTrainingCourse: true,
              },
            });

            if (addError) {
              console.error("Error creating agent record:", addError);
            } else if (addResult?.error) {
              // 409 = already exists, which is fine
              console.log("Add-agent result:", addResult);
            } else {
              toast.success(`${app.first_name} ${app.last_name} added to Dashboard & enrolled in course`);
            }
          } catch (err) {
            console.error("Failed to auto-create agent:", err);
          }
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
  };

  const openScheduler = (app: Application) => {
    setSchedulerApp(app);
    setSchedulerOpen(true);
  };

  // Filter applications
  const filteredApps = applications.filter((app) => {
    const name = `${app.first_name} ${app.last_name}`.toLowerCase();
    const matchesSearch =
      name.includes(searchQuery.toLowerCase()) ||
      app.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (app.phone || "").includes(searchQuery);

    const matchesStatus =
      statusFilter === "all" ||
      (statusFilter === "needs_contact" && !app.contacted_at) ||
      (statusFilter === "in_progress" && app.contacted_at && app.license_status !== "licensed") ||
      (statusFilter === "licensed" && app.license_status === "licensed");

    return matchesSearch && matchesStatus;
  });

  // Group by kanban column for accordion sections
  const sectionApps = KANBAN_COLUMNS.reduce<Record<string, Application[]>>((acc, col) => {
    acc[col.id] = filteredApps.filter(
      (app) => getColumnForStage(app.license_progress) === col.id
    );
    return acc;
  }, {});

  // Stats
  const totalLeads = applications.length;
  const needsContact = applications.filter((a) => !a.contacted_at).length;
  const inProgress = applications.filter(
    (a) => a.contacted_at && a.license_status !== "licensed"
  ).length;
  const licensed = applications.filter((a) => a.license_status === "licensed").length;

  const stats = [
    { label: "Total Recruits", value: totalLeads, icon: Users, color: "text-primary", filter: "all" },
    { label: "Needs Contact", value: needsContact, icon: Clock, color: "text-red-400", filter: "needs_contact" },
    { label: "In Progress", value: inProgress, icon: UserCheck, color: "text-amber-400", filter: "in_progress" },
    { label: "Licensed", value: licensed, icon: Award, color: "text-emerald-400", filter: "licensed" },
  ];

  const getContactBadgeStyle = (app: Application) => {
    const last = app.last_contacted_at || app.contacted_at;
    if (!last) return "bg-destructive/20 text-destructive border-destructive/30";
    const hoursAgo = (Date.now() - new Date(last).getTime()) / (1000 * 60 * 60);
    if (hoursAgo > 48) return "bg-amber-500/20 text-amber-400 border-amber-500/30";
    return "bg-emerald-500/20 text-emerald-400 border-emerald-500/30";
  };

  const toggleSection = (sectionId: string) => {
    if (expandedSection === sectionId) {
      playSound("click");
      setExpandedSection(null);
    } else {
      playSound("whoosh");
      setExpandedSection(sectionId);
    }
  };

  const renderAppRow = (app: Application, idx: number) => {
    const contactBadgeStyle = getContactBadgeStyle(app);
    const last = app.last_contacted_at || app.contacted_at;
    const contactLabel = last
      ? formatDistanceToNow(new Date(last), { addSuffix: true })
      : "Never contacted";

    return (
      <div
        key={app.id}
        className="px-3 py-2 border-b border-border/50 last:border-b-0 hover:bg-muted/30 transition-colors"
      >
        <div className="flex flex-col md:flex-row md:items-center gap-3">
          {/* Name & Contact */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5 flex-wrap">
              <h3
                className="font-semibold text-sm text-primary hover:underline cursor-pointer"
                onClick={() => navigate(`/dashboard/crm?focusAgentId=${app.id}`)}
              >{app.first_name} {app.last_name}</h3>
              <Badge variant="outline" className={cn("text-[10px]", contactBadgeStyle)}>
                <Clock className="h-2.5 w-2.5 mr-1" />
                {contactLabel}
              </Badge>
              {(!app.license_progress || app.license_progress === "unlicensed") && (
                <Badge className="bg-amber-500/15 text-amber-400 border-amber-500/30 text-[10px]">
                  <AlertCircle className="h-2.5 w-2.5 mr-1" />
                  Course not purchased
                </Badge>
              )}
            </div>
            <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <Mail className="h-3 w-3" />
                {app.email}
              </span>
              {app.phone && (
                <span className="flex items-center gap-1">
                  <Phone className="h-3 w-3" />
                  {app.phone}
                </span>
              )}
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
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-blue-400 hover:text-blue-300 hover:bg-blue-500/10"
              onClick={() => openScheduler(app)}
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

            {app.phone && (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10"
                asChild
              >
                <a href={`tel:${app.phone}`}>
                  <Phone className="h-4 w-4" />
                </a>
              </Button>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <>
      {/* Header */}
      <div
        className="mb-6"
      >
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-primary/10">
              <Users className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-3xl font-bold">My Pipeline</h1>
              <p className="text-muted-foreground text-sm">
                Track and manage your recruits through the licensing process
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Team toggle for managers */}
            {(isManager || isAdmin) && (
              <div className="flex items-center gap-1 bg-muted rounded-lg p-1">
                <Button
                  variant={teamMode === "mine" ? "secondary" : "ghost"}
                  size="sm"
                  onClick={() => { setTeamMode("mine"); playSound("click"); }}
                  className="h-8 gap-1.5"
                >
                  <User className="h-3.5 w-3.5" />
                  My Recruits
                </Button>
                <Button
                  variant={teamMode === "team" ? "secondary" : "ghost"}
                  size="sm"
                  onClick={() => { setTeamMode("team"); playSound("click"); }}
                  className="h-8 gap-1.5"
                >
                  <UsersRound className="h-3.5 w-3.5" />
                  Full Team
                </Button>
              </div>
            )}
            {/* View toggle */}
            <div className="flex items-center gap-1 bg-muted rounded-lg p-1">
              <Button
                variant={viewMode === "list" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => { setViewMode("list"); playSound("click"); }}
                className="h-8"
              >
                <List className="h-4 w-4 mr-1" />
                List
              </Button>
              <Button
                variant={viewMode === "kanban" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => { setViewMode("kanban"); playSound("click"); }}
                className="h-8"
              >
                <LayoutGrid className="h-4 w-4 mr-1" />
                Kanban
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div
        className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6"
      >
        {stats.map((stat) => (
          <GlassCard
            key={stat.label}
            className={cn(
              "p-4 cursor-pointer transition-all hover:scale-[1.02]",
              statusFilter === stat.filter && "ring-2 ring-primary"
            )}
            onClick={() => { setStatusFilter(stat.filter); playSound("click"); }}
          >
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-muted">
                <stat.icon className={cn("h-5 w-5", stat.color)} />
              </div>
              <div>
                <p className={cn("text-2xl font-bold", stat.color)}>{stat.value}</p>
                <p className="text-xs text-muted-foreground">{stat.label}</p>
              </div>
            </div>
          </GlassCard>
        ))}
      </div>

      {/* Filters */}
      <div
        className="flex flex-col sm:flex-row gap-3 mb-6"
      >
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by name, email, or phone..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10 bg-input"
          />
        </div>
        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); playSound("click"); }}>
          <SelectTrigger className="w-full sm:w-44 bg-input">
            <Filter className="h-4 w-4 mr-2" />
            <SelectValue placeholder="Filter" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Recruits</SelectItem>
            <SelectItem value="needs_contact">Needs Contact</SelectItem>
            <SelectItem value="in_progress">In Progress</SelectItem>
            <SelectItem value="licensed">Licensed</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Content */}
      <div>
        {loading ? (
          <div className="text-center py-16 text-muted-foreground">Loading pipeline...</div>
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
            onScheduleInterview={(app) => openScheduler(app as Application)}
          />
        ) : (
          /* Accordion list view grouped by pipeline stage */
          <div className="space-y-3">
            {KANBAN_COLUMNS.map((col, colIdx) => {
              const apps = sectionApps[col.id] || [];
              const isOpen = expandedSection === col.id;

              return (
                <div
                  key={col.id}
                >
                  <div
                    className={cn(
                      "rounded-xl border-2 overflow-hidden transition-all",
                      col.color,
                      isOpen && "shadow-lg"
                    )}
                  >
                    {/* Section Header */}
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
                      </div>
                      <motion.div
                        animate={{ rotate: isOpen ? 90 : 0 }}
                        transition={{ duration: 0.2 }}
                      >
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      </motion.div>
                    </button>

                    {/* Section Content */}
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
                              apps.map((app, idx) => renderAppRow(app, idx))
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

      {/* Interview Scheduler Modal */}
      {schedulerApp && (
        <InterviewScheduler
          open={schedulerOpen}
          onOpenChange={(open) => {
            setSchedulerOpen(open);
            if (!open) setSchedulerApp(null);
          }}
          applicationId={schedulerApp.id}
          applicantName={`${schedulerApp.first_name} ${schedulerApp.last_name}`}
          applicantEmail={schedulerApp.email}
          onScheduled={fetchApplications}
        />
      )}
    </>
  );
}
