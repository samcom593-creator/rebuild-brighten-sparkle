import { useState, useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  Users,
  Phone,
  Mail,
  MapPin,
  Clock,
  Filter,
  Search,
  Instagram,
  CheckCircle,
  UserCheck,
  MessageCircle,
  Award,
  GraduationCap,
  ExternalLink,
  StickyNote,
  Mic,
  Building2,
  XCircle,
  ChevronDown,
  ChevronUp,
  RotateCcw,
  Send,
  FileCheck,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { DashboardLayout } from "@/components/dashboard/DashboardLayout";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { ApplicantNotes } from "@/components/dashboard/ApplicantNotes";
import { InterviewRecorder } from "@/components/dashboard/InterviewRecorder";
import { ApplicantSummary } from "@/components/dashboard/ApplicantSummary";
import { LeadQualificationChat } from "@/components/dashboard/LeadQualificationChat";
import { QuickEmailMenu } from "@/components/dashboard/QuickEmailMenu";
import { QuickAssignMenu } from "@/components/dashboard/QuickAssignMenu";
import { LastContactedBadge } from "@/components/dashboard/LastContactedBadge";
import { LicenseProgressSelector } from "@/components/dashboard/LicenseProgressSelector";
import { ContractedModal } from "@/components/dashboard/ContractedModal";

interface Application {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  city: string | null;
  state: string | null;
  license_status: "licensed" | "unlicensed" | "pending";
  license_progress: "unlicensed" | "course_purchased" | "passed_test" | "waiting_on_license" | "licensed" | null;
  status: string;
  instagram_handle: string | null;
  contacted_at: string | null;
  qualified_at: string | null;
  closed_at: string | null;
  contracted_at: string | null;
  terminated_at: string | null;
  termination_reason: string | null;
  started_training: boolean | null;
  created_at: string;
  notes: string | null;
  has_insurance_experience: boolean | null;
  previous_company: string | null;
  years_experience: number | null;
  assigned_agent_id: string | null;
}

const statusColors: Record<string, string> = {
  new: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  contacted: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  hired: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  contracted: "bg-violet-500/20 text-violet-400 border-violet-500/30",
  terminated: "bg-red-500/20 text-red-400 border-red-500/30",
};

const licenseColors: Record<string, string> = {
  licensed: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  unlicensed: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  pending: "bg-blue-500/20 text-blue-400 border-blue-500/30",
};

export default function DashboardApplicants() {
  const { user, isAdmin, isManager } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const highlightedLeadId = searchParams.get("lead");
  const managerFilter = searchParams.get("manager");
  
  const [applications, setApplications] = useState<Application[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [licenseFilter, setLicenseFilter] = useState<string>("all");
  const [sortOrder, setSortOrder] = useState<string>("newest");
  const [isLoading, setIsLoading] = useState(true);
  const [agentId, setAgentId] = useState<string | null>(null);
  
  // Notes modal state
  const [notesApp, setNotesApp] = useState<Application | null>(null);
  
  // Interview recorder state
  const [recorderApp, setRecorderApp] = useState<Application | null>(null);

  // Terminate modal state
  const [terminateApp, setTerminateApp] = useState<Application | null>(null);
  const [terminateReason, setTerminateReason] = useState("");
  const [isTerminating, setIsTerminating] = useState(false);

  // Terminated section expanded state
  const [showTerminated, setShowTerminated] = useState(false);

  // Manual follow-up state
  const [sendingFollowupId, setSendingFollowupId] = useState<string | null>(null);

  // Contracted modal state
  const [contractedApp, setContractedApp] = useState<Application | null>(null);
  
  // When deep linking, clear filters to ensure lead is visible
  useEffect(() => {
    if (highlightedLeadId) {
      setStatusFilter("all");
      setLicenseFilter("all");
      setSearchQuery("");
    }
  }, [highlightedLeadId]);
  
  // Scroll to highlighted lead when data loads
  useEffect(() => {
    if (highlightedLeadId && applications.length > 0) {
      const timer = setTimeout(() => {
        const leadElement = document.getElementById(`lead-${highlightedLeadId}`);
        if (leadElement) {
          leadElement.scrollIntoView({ behavior: "smooth", block: "center" });
          // Clear the URL param after scrolling
          setTimeout(() => setSearchParams({}), 2000);
        } else {
          // Check if it's in terminated section and show it
          const isTerminatedLead = applications.find(
            app => app.id === highlightedLeadId && app.terminated_at
          );
          if (isTerminatedLead) {
            setShowTerminated(true);
            setTimeout(() => {
              const leadEl = document.getElementById(`lead-${highlightedLeadId}`);
              if (leadEl) {
                leadEl.scrollIntoView({ behavior: "smooth", block: "center" });
                setTimeout(() => setSearchParams({}), 2000);
              }
            }, 300);
          }
        }
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [highlightedLeadId, applications, setSearchParams]);

  useEffect(() => {
    fetchApplications();
  }, [user, highlightedLeadId, isAdmin, isManager, managerFilter]);

  const fetchApplications = async () => {
    if (!user) return;

    setIsLoading(true);
    
    // Get agent ID
    const { data: agentData } = await supabase
      .from("agents")
      .select("id")
      .eq("user_id", user.id)
      .single();

    if (agentData) {
      setAgentId(agentData.id);
    }

    // If admin/manager with manager filter, filter by that manager
    if (managerFilter && (isAdmin || isManager)) {
      const { data: filteredApps, error } = await supabase
        .from("applications")
        .select("*")
        .eq("assigned_agent_id", managerFilter)
        .order("created_at", { ascending: false });
      
      if (!error && filteredApps) {
        setApplications(filteredApps as Application[]);
      }
      setIsLoading(false);
      return;
    }
    
    // ADMINS: Always see ALL applications
    if (isAdmin) {
      const { data: adminApps } = await supabase
        .from("applications")
        .select("*")
        .order("created_at", { ascending: false });
      setApplications((adminApps || []) as Application[]);
      setIsLoading(false);
      return;
    }

    // MANAGERS: See all applications (RLS filters to their team + unassigned)
    if (isManager) {
      const { data: managerApps } = await supabase
        .from("applications")
        .select("*")
        .order("created_at", { ascending: false });
      setApplications((managerApps || []) as Application[]);
      setIsLoading(false);
      return;
    }

    // AGENTS: Only see their assigned applications
    if (agentData) {
      const { data, error } = await supabase
        .from("applications")
        .select("*")
        .eq("assigned_agent_id", agentData.id)
        .order("created_at", { ascending: false });

      if (!error && data) {
        setApplications(data as Application[]);
      }
    } else {
      setApplications([]);
    }
    
    setIsLoading(false);
  };

  const getApplicationStatus = (app: Application): string => {
    if (app.terminated_at) return "terminated";
    if (app.contracted_at) return "contracted";
    if (app.closed_at) return "hired";
    if (app.contacted_at) return "contacted";
    return "new";
  };

  const getTimeAgo = (dateString: string): string => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    
    if (diffHours < 1) return "Just now";
    if (diffHours < 24) return `${diffHours} hours ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays === 1) return "1 day ago";
    if (diffDays < 7) return `${diffDays} days ago`;
    return `${Math.floor(diffDays / 7)} week(s) ago`;
  };

  const handleMarkAsHired = async (id: string) => {
    const app = applications.find(a => a.id === id);
    if (!app) return;

    const { error } = await supabase
      .from("applications")
      .update({ 
        closed_at: new Date().toISOString(),
        contacted_at: app.contacted_at || new Date().toISOString(),
      })
      .eq("id", id);

    if (error) {
      toast.error("Failed to mark as hired");
      return;
    }
    
    toast.success("Marked as hired!");
    fetchApplications();
    
    // Send hire email to recruit (fire and forget)
    supabase.functions.invoke("send-post-call-followup", {
      body: {
        firstName: app.first_name,
        email: app.email,
        licenseStatus: app.license_status,
        actionType: "hired",
        agentId: agentId,
      }
    }).then(({ error: emailErr }) => {
      if (emailErr) console.error("Failed to send hire email:", emailErr);
      else console.log("Hire email sent to", app.email);
    });

    // Broadcast hire announcement to all managers
    supabase.functions.invoke("notify-hire-announcement", {
      body: { applicationId: id, agentId }
    }).then(({ error: announceErr }) => {
      if (announceErr) console.error("Failed to send hire announcement:", announceErr);
    });
  };

  const handleTerminate = async () => {
    if (!terminateApp) return;
    
    setIsTerminating(true);
    const terminatedId = terminateApp.id;
    const { data, error } = await supabase
      .from("applications")
      .update({ 
        terminated_at: new Date().toISOString(),
        termination_reason: terminateReason.trim() || null
      })
      .eq("id", terminatedId)
      .select("id");

    if (error) {
      toast.error("Failed to terminate lead");
    } else if (!data || data.length === 0) {
      toast.error("Could not terminate this lead — you may not have permission");
    } else {
      // Optimistic UI: immediately remove from active list
      setApplications(prev => prev.map(app => 
        app.id === terminatedId 
          ? { ...app, terminated_at: new Date().toISOString(), termination_reason: terminateReason.trim() || null }
          : app
      ));
      toast.success("Lead terminated");
      setTerminateApp(null);
      setTerminateReason("");
      fetchApplications();
    }
    setIsTerminating(false);
  };

  const handleRestoreLead = async (id: string) => {
    const { error } = await supabase
      .from("applications")
      .update({ 
        terminated_at: null,
        termination_reason: null
      })
      .eq("id", id);

    if (error) {
      toast.error("Failed to restore lead");
    } else {
      toast.success("Lead restored");
      fetchApplications();
    }
  };

  const openInstagram = (handle: string) => {
    window.open(`https://instagram.com/${handle}`, "_blank");
  };

  const handleNotesSave = (notes: string) => {
    if (notesApp) {
      setApplications(apps => 
        apps.map(a => a.id === notesApp.id ? { ...a, notes } : a)
      );
      setNotesApp(null);
    }
  };

  const handleManualFollowup = async (applicationId: string) => {
    setSendingFollowupId(applicationId);
    try {
      const { error } = await supabase.functions.invoke("send-manual-followup", {
        body: { applicationId, agentId }
      });
      
      if (error) throw error;
      
      toast.success("Follow-up email sent!");
      fetchApplications();
    } catch (err) {
      console.error("Failed to send follow-up:", err);
      toast.error("Failed to send follow-up email");
    } finally {
      setSendingFollowupId(null);
    }
  };

  // Split applications into active and terminated
  const activeApplications = applications.filter(app => !app.terminated_at);
  const terminatedApplications = applications.filter(app => app.terminated_at);

  // When status filter is "terminated", filter from terminated list instead
  const baseApplications = statusFilter === "terminated" ? terminatedApplications : activeApplications;

  const filteredApplications = baseApplications
    .filter((app) => {
      const name = `${app.first_name} ${app.last_name}`.toLowerCase();
      const matchesSearch = name.includes(searchQuery.toLowerCase()) ||
        app.email.toLowerCase().includes(searchQuery.toLowerCase());
      
      const appStatus = getApplicationStatus(app);
      const matchesStatus = statusFilter === "all" || statusFilter === "terminated" || appStatus === statusFilter;
      const matchesLicense = licenseFilter === "all" || app.license_status === licenseFilter;
      
      return matchesSearch && matchesStatus && matchesLicense;
    })
    .sort((a, b) => {
      const dateA = new Date(a.created_at).getTime();
      const dateB = new Date(b.created_at).getTime();
      return sortOrder === "newest" ? dateB - dateA : dateA - dateB;
    });

  // Stats - exclude terminated from active stats
  const totalLeads = activeApplications.length;
  const hired = activeApplications.filter(a => a.closed_at && !a.contracted_at).length;
  const contracted = activeApplications.filter(a => a.contracted_at).length;
  const terminated = terminatedApplications.length;

  const renderApplicationCard = (app: Application, index: number, isTerminated = false) => {
    const status = getApplicationStatus(app);
    const isHighlighted = highlightedLeadId === app.id;
    return (
      <div
        key={app.id}
        id={`lead-${app.id}`}
        className="opacity-100"
      >
        <GlassCard className={cn(
          "p-4 hover:bg-muted/50 transition-all duration-300 card-hover-lift",
          isTerminated && "opacity-60",
          isHighlighted && "ring-2 ring-primary shadow-lg shadow-primary/20 animate-pulse"
        )}>
          <div className="flex flex-col gap-4">
            {/* Top Row: Avatar, Name, Contact Info, Badges */}
            <div className="flex flex-col lg:flex-row lg:items-center gap-4">
              {/* Avatar & Name */}
              <div className="flex items-center gap-4 flex-1">
                <div className={cn(
                  "w-12 h-12 rounded-full flex items-center justify-center",
                  isTerminated ? "bg-red-500/20" : "bg-primary/20"
                )}>
                  <Users className={cn("h-6 w-6", isTerminated ? "text-red-400" : "text-primary")} />
                </div>
                <div>
                  <h3 className="font-semibold">{app.first_name} {app.last_name}</h3>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    <span>{getTimeAgo(app.created_at)}</span>
                  </div>
                </div>
              </div>

              {/* Contact Info */}
              <div className="flex flex-wrap gap-4 text-sm">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Mail className="h-4 w-4" />
                  <span>{app.email}</span>
                </div>
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Phone className="h-4 w-4" />
                  <span>{app.phone}</span>
                </div>
                {app.city && app.state && (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <MapPin className="h-4 w-4" />
                    <span>{app.city}, {app.state}</span>
                  </div>
                )}
              </div>

              {/* Badges */}
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="outline" className={cn("capitalize", statusColors[status])}>
                  {status}
                </Badge>
                
                {/* License Progress Selector (replaces static badge for unlicensed leads) */}
                {!isTerminated && app.license_status !== "licensed" ? (
                  <LicenseProgressSelector
                    applicationId={app.id}
                    currentProgress={app.license_progress}
                    onProgressUpdated={fetchApplications}
                  />
                ) : (
                  <Badge variant="outline" className={cn("capitalize", licenseColors[app.license_status])}>
                    {app.license_status === "licensed" && <Award className="h-3 w-3 mr-1" />}
                    {app.license_status === "unlicensed" && <GraduationCap className="h-3 w-3 mr-1" />}
                    {app.license_status}
                  </Badge>
                )}
                
                {app.started_training && (
                  <Badge variant="outline" className="bg-primary/20 text-primary border-primary/30">
                    Started Training
                  </Badge>
                )}
              </div>
            </div>

            {/* Previous Experience Row */}
            {app.has_insurance_experience && app.previous_company && (
              <div className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-muted/50 w-fit">
                <Building2 className="h-4 w-4 text-orange-400" />
                <span className="text-sm text-muted-foreground">
                  Previously at <span className="text-foreground font-medium">{app.previous_company}</span>
                  {app.years_experience && app.years_experience > 0 && (
                    <span className="text-muted-foreground"> • {app.years_experience} yr{app.years_experience > 1 ? 's' : ''} exp</span>
                  )}
                </span>
              </div>
            )}

            {/* Termination Reason */}
            {isTerminated && app.termination_reason && (
              <div className="text-sm text-red-400 bg-red-500/10 rounded-md px-3 py-2 border-l-2 border-red-500/50">
                <span className="font-medium">Reason:</span> {app.termination_reason}
              </div>
            )}

            {/* Notes Preview */}
            {app.notes && !isTerminated && (
              <div className="text-sm text-muted-foreground bg-muted/30 rounded-md px-3 py-2 border-l-2 border-primary/50">
                <span className="line-clamp-2">{app.notes}</span>
              </div>
            )}

            {/* AI Summary */}
            {!isTerminated && (
              <ApplicantSummary 
                applicant={{
                  id: app.id,
                  full_name: `${app.first_name} ${app.last_name}`,
                  email: app.email,
                  phone: app.phone,
                  city: app.city || '',
                  state: app.state || '',
                  instagram_handle: app.instagram_handle || '',
                  has_license: app.license_status === 'licensed',
                  years_experience: app.years_experience?.toString() || '',
                  current_occupation: app.previous_company || '',
                  why_join: '',
                  status: status,
                  created_at: app.created_at,
                }}
              />
            )}

            {/* Actions Row */}
            <div className="flex items-center gap-2 flex-wrap pt-2 border-t border-border/50">
              {/* Last contacted badge */}
              <LastContactedBadge applicationId={app.id} />
              
              {app.instagram_handle && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => openInstagram(app.instagram_handle!)}
                  className="text-pink-400 hover:text-pink-300 hover:bg-pink-500/10"
                >
                  <Instagram className="h-4 w-4 mr-1" />
                  <span className="hidden sm:inline">@{app.instagram_handle}</span>
                  <ExternalLink className="h-3 w-3 ml-1" />
                </Button>
              )}
              
              {!isTerminated && (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setNotesApp(app)}
                    className={cn(
                      "text-muted-foreground hover:text-foreground",
                      app.notes && "text-primary"
                    )}
                  >
                    <StickyNote className="h-4 w-4 mr-1" />
                    Notes
                  </Button>

                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setRecorderApp(app)}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <Mic className="h-4 w-4 mr-1" />
                    Record
                  </Button>

                  {status !== "closed" && (
                    <QuickEmailMenu
                      applicationId={app.id}
                      agentId={agentId}
                      licenseStatus={app.license_status}
                      recipientEmail={app.email}
                      recipientName={`${app.first_name} ${app.last_name}`}
                      onEmailSent={fetchApplications}
                      className="text-muted-foreground hover:text-primary"
                    />
                  )}

                  {/* Admin-only quick assign */}
                  {isAdmin && (
                    <QuickAssignMenu
                      applicationId={app.id}
                      currentAgentId={app.assigned_agent_id}
                      onAssigned={fetchApplications}
                      className="text-muted-foreground hover:text-primary"
                    />
                  )}
                </>
              )}
              
              <div className="flex-1" />

              {isTerminated ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleRestoreLead(app.id)}
                  className="text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10"
                >
                  <RotateCcw className="h-4 w-4 mr-1" />
                  Restore
                </Button>
              ) : (
                <>
                  {/* Hired button - available for any non-hired, non-contracted lead */}
                  {status !== "hired" && status !== "contracted" && (
                    <Button
                      variant="default"
                      size="sm"
                      onClick={() => handleMarkAsHired(app.id)}
                    >
                      <UserCheck className="h-4 w-4 mr-1" />
                      Hired
                    </Button>
                  )}

                  {/* Contracted button - available for any non-contracted lead */}
                  {!app.contracted_at && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setContractedApp(app)}
                      className="text-violet-400 border-violet-500/30 hover:bg-violet-500/10"
                    >
                      <FileCheck className="h-4 w-4 mr-1" />
                      Contracted
                    </Button>
                  )}

                  {status !== "hired" && status !== "contracted" && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setTerminateApp(app)}
                      className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
                    >
                      <XCircle className="h-4 w-4 mr-1" />
                      Terminate
                    </Button>
                  )}
                </>
              )}
            </div>
          </div>
        </GlassCard>
      </div>
    );
  };

  return (
    <DashboardLayout>
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-8"
      >
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-primary/10">
            <Users className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-3xl font-bold">Applicants</h1>
            <p className="text-muted-foreground text-sm">
              Manage and track your assigned applicants
            </p>
          </div>
        </div>
      </motion.div>

      {/* Stats - Clickable to filter */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8"
      >
        {[
          { label: "Total Leads", value: totalLeads, icon: Users, color: "text-primary", filter: "all" },
          { label: "Hired", value: hired, icon: UserCheck, color: "text-emerald-400", filter: "hired" },
          { label: "Contracted", value: contracted, icon: FileCheck, color: "text-violet-400", filter: "contracted" },
          { label: "Terminated", value: terminated, icon: XCircle, color: "text-red-400", filter: "terminated" },
        ].map((stat) => (
          <GlassCard 
            key={stat.label} 
            className={cn(
              "p-4 cursor-pointer transition-all hover:scale-[1.02]",
              statusFilter === stat.filter && "ring-2 ring-primary ring-offset-2 ring-offset-background"
            )}
            onClick={() => setStatusFilter(stat.filter === "terminated" ? "all" : stat.filter)}
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
      </motion.div>

      {/* Filters */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="flex flex-col sm:flex-row gap-4 mb-6"
      >
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search applicants..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10 bg-input"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full sm:w-40 bg-input">
            <Filter className="h-4 w-4 mr-2" />
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="new">New</SelectItem>
            <SelectItem value="contacted">Contacted</SelectItem>
            <SelectItem value="hired">Hired</SelectItem>
            <SelectItem value="contracted">Contracted</SelectItem>
            <SelectItem value="terminated">Terminated</SelectItem>
          </SelectContent>
        </Select>
        <Select value={licenseFilter} onValueChange={setLicenseFilter}>
          <SelectTrigger className="w-full sm:w-40 bg-input">
            <Award className="h-4 w-4 mr-2" />
            <SelectValue placeholder="License" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Licenses</SelectItem>
            <SelectItem value="licensed">Licensed</SelectItem>
            <SelectItem value="unlicensed">Unlicensed</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
          </SelectContent>
        </Select>
        <Select value={sortOrder} onValueChange={setSortOrder}>
          <SelectTrigger className="w-full sm:w-40 bg-input">
            <Clock className="h-4 w-4 mr-2" />
            <SelectValue placeholder="Sort by" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="newest">Newest First</SelectItem>
            <SelectItem value="oldest">Oldest First</SelectItem>
          </SelectContent>
        </Select>
      </motion.div>

      {/* Applicants List - Shows terminated when that filter is active */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className="space-y-4"
      >
        {filteredApplications.map((app, index) => renderApplicationCard(app, index, statusFilter === "terminated"))}

        {filteredApplications.length === 0 && (
          <GlassCard className="p-12 text-center">
            <Users className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-2">No applicants found</h3>
            <p className="text-muted-foreground">
              {isLoading ? "Loading..." : "Try adjusting your search or filter criteria"}
            </p>
          </GlassCard>
        )}
      </motion.div>

      {/* Terminated Leads Section - Only show when not filtering by terminated */}
      {statusFilter !== "terminated" && terminatedApplications.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="mt-8"
        >
          <button
            onClick={() => setShowTerminated(!showTerminated)}
            className="w-full flex items-center justify-between p-4 rounded-lg bg-red-500/10 border border-red-500/20 hover:bg-red-500/15 transition-colors"
          >
            <div className="flex items-center gap-3">
              <XCircle className="h-5 w-5 text-red-400" />
              <span className="font-semibold text-red-400">
                Terminated Leads ({terminatedApplications.length})
              </span>
            </div>
            {showTerminated ? (
              <ChevronUp className="h-5 w-5 text-red-400" />
            ) : (
              <ChevronDown className="h-5 w-5 text-red-400" />
            )}
          </button>

          <AnimatePresence>
            {showTerminated && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.2 }}
                className="space-y-4 mt-4 overflow-hidden"
              >
                {terminatedApplications.map((app, index) => renderApplicationCard(app, index, true))}
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      )}

      {/* Notes Modal */}
      {notesApp && (
        <ApplicantNotes
          applicationId={notesApp.id}
          applicantName={`${notesApp.first_name} ${notesApp.last_name}`}
          initialNotes={notesApp.notes}
          onClose={() => setNotesApp(null)}
          onSave={handleNotesSave}
        />
      )}

      {/* Interview Recorder Modal */}
      {recorderApp && agentId && (
        <InterviewRecorder
          applicationId={recorderApp.id}
          agentId={agentId}
          applicantName={`${recorderApp.first_name} ${recorderApp.last_name}`}
          onClose={() => setRecorderApp(null)}
          onTranscriptionSaved={fetchApplications}
        />
      )}

      {/* Terminate Confirmation Modal */}
      <Dialog open={!!terminateApp} onOpenChange={(open) => !open && setTerminateApp(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-400">
              <XCircle className="h-5 w-5" />
              Terminate Lead
            </DialogTitle>
            <DialogDescription>
              Are you sure you want to terminate {terminateApp?.first_name} {terminateApp?.last_name}? 
              This will move them to the terminated leads section.
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-2 py-4">
            <Label htmlFor="reason">Reason (optional)</Label>
            <Textarea
              id="reason"
              placeholder="e.g., Not interested, Wrong number, Duplicate..."
              value={terminateReason}
              onChange={(e) => setTerminateReason(e.target.value)}
              className="bg-input"
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setTerminateApp(null)}>
              Cancel
            </Button>
            <Button 
              variant="destructive" 
              onClick={handleTerminate}
              disabled={isTerminating}
            >
              {isTerminating ? "Terminating..." : "Terminate Lead"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Contracted Modal */}
      {contractedApp && agentId && (
        <ContractedModal
          open={!!contractedApp}
          onOpenChange={(open) => !open && setContractedApp(null)}
          application={contractedApp}
          agentId={agentId}
          onSuccess={fetchApplications}
        />
      )}

      {/* Lead Qualification Chat */}
      <LeadQualificationChat />
    </DashboardLayout>
  );
}
