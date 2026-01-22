import { useState, useEffect } from "react";
import { motion } from "framer-motion";
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
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { ApplicantNotes } from "@/components/dashboard/ApplicantNotes";
import { InterviewRecorder } from "@/components/dashboard/InterviewRecorder";

interface Application {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  city: string | null;
  state: string | null;
  license_status: "licensed" | "unlicensed" | "pending";
  status: string;
  instagram_handle: string | null;
  contacted_at: string | null;
  qualified_at: string | null;
  closed_at: string | null;
  started_training: boolean | null;
  created_at: string;
  notes: string | null;
  has_insurance_experience: boolean | null;
  previous_company: string | null;
  years_experience: number | null;
}

const statusColors: Record<string, string> = {
  new: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  contacted: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  qualified: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  closed: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
};

const licenseColors: Record<string, string> = {
  licensed: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  unlicensed: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  pending: "bg-blue-500/20 text-blue-400 border-blue-500/30",
};

export default function DashboardApplicants() {
  const { user } = useAuth();
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

  useEffect(() => {
    fetchApplications();
  }, [user]);

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
      const { data, error } = await supabase
        .from("applications")
        .select("*")
        .eq("assigned_agent_id", agentData.id)
        .order("created_at", { ascending: false });

      if (!error && data) {
        setApplications(data as Application[]);
      }
    } else {
      // Demo data for agents without assigned applications
      setApplications([
        {
          id: "1",
          first_name: "Sarah",
          last_name: "Johnson",
          email: "sarah.j@email.com",
          phone: "(555) 123-4567",
          city: "Atlanta",
          state: "GA",
          license_status: "licensed",
          status: "new",
          instagram_handle: "sarahjohnson",
          contacted_at: null,
          qualified_at: null,
          closed_at: null,
          started_training: false,
          created_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
          notes: null,
          has_insurance_experience: true,
          previous_company: "Symmetry Financial",
          years_experience: 3,
        },
        {
          id: "2",
          first_name: "Michael",
          last_name: "Chen",
          email: "m.chen@email.com",
          phone: "(555) 234-5678",
          city: "Miami",
          state: "FL",
          license_status: "unlicensed",
          status: "contacted",
          instagram_handle: "mikechen_",
          contacted_at: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(),
          qualified_at: null,
          closed_at: null,
          started_training: true,
          created_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
          notes: "[Jan 20, 10:30 AM] Left voicemail, will call back tomorrow",
          has_insurance_experience: false,
          previous_company: null,
          years_experience: null,
        },
        {
          id: "3",
          first_name: "Emily",
          last_name: "Rodriguez",
          email: "emily.r@email.com",
          phone: "(555) 345-6789",
          city: "Houston",
          state: "TX",
          license_status: "licensed",
          status: "qualified",
          instagram_handle: "emilyrod",
          contacted_at: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
          qualified_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
          closed_at: null,
          started_training: false,
          created_at: new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString(),
          notes: null,
          has_insurance_experience: true,
          previous_company: "American Income Life",
          years_experience: 5,
        },
        {
          id: "4",
          first_name: "David",
          last_name: "Kim",
          email: "d.kim@email.com",
          phone: "(555) 456-7890",
          city: "Phoenix",
          state: "AZ",
          license_status: "pending",
          status: "closed",
          instagram_handle: null,
          contacted_at: new Date(Date.now() - 96 * 60 * 60 * 1000).toISOString(),
          qualified_at: new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString(),
          closed_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
          started_training: false,
          created_at: new Date(Date.now() - 168 * 60 * 60 * 1000).toISOString(),
          notes: null,
          has_insurance_experience: false,
          previous_company: null,
          years_experience: null,
        },
      ]);
    }
    
    setIsLoading(false);
  };

  const getApplicationStatus = (app: Application): string => {
    if (app.closed_at) return "closed";
    if (app.qualified_at) return "qualified";
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

  const handleMarkAsContacted = async (id: string) => {
    const { error } = await supabase
      .from("applications")
      .update({ contacted_at: new Date().toISOString() })
      .eq("id", id);

    if (error) {
      toast.error("Failed to update status");
    } else {
      toast.success("Marked as contacted");
      fetchApplications();
    }
  };

  const handleMarkAsQualified = async (id: string) => {
    const { error } = await supabase
      .from("applications")
      .update({ 
        qualified_at: new Date().toISOString(),
        contacted_at: applications.find(a => a.id === id)?.contacted_at || new Date().toISOString()
      })
      .eq("id", id);

    if (error) {
      toast.error("Failed to update status");
    } else {
      toast.success("Marked as qualified");
      fetchApplications();
    }
  };

  const handleMarkAsClosed = async (id: string) => {
    const app = applications.find(a => a.id === id);
    const { error } = await supabase
      .from("applications")
      .update({ 
        closed_at: new Date().toISOString(),
        qualified_at: app?.qualified_at || new Date().toISOString(),
        contacted_at: app?.contacted_at || new Date().toISOString()
      })
      .eq("id", id);

    if (error) {
      toast.error("Failed to update status");
    } else {
      toast.success("Marked as closed");
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

  const filteredApplications = applications
    .filter((app) => {
      const name = `${app.first_name} ${app.last_name}`.toLowerCase();
      const matchesSearch = name.includes(searchQuery.toLowerCase()) ||
        app.email.toLowerCase().includes(searchQuery.toLowerCase());
      
      const appStatus = getApplicationStatus(app);
      const matchesStatus = statusFilter === "all" || appStatus === statusFilter;
      const matchesLicense = licenseFilter === "all" || app.license_status === licenseFilter;
      
      return matchesSearch && matchesStatus && matchesLicense;
    })
    .sort((a, b) => {
      const dateA = new Date(a.created_at).getTime();
      const dateB = new Date(b.created_at).getTime();
      return sortOrder === "newest" ? dateB - dateA : dateA - dateB;
    });

  // Stats
  const totalLeads = applications.length;
  const contacted = applications.filter(a => a.contacted_at).length;
  const qualified = applications.filter(a => a.qualified_at).length;
  const closed = applications.filter(a => a.closed_at).length;

  return (
    <DashboardLayout>
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-8"
      >
        <h1 className="text-3xl font-bold mb-2">Applicants</h1>
        <p className="text-muted-foreground">
          Manage and track your assigned applicants
        </p>
      </motion.div>

      {/* Stats */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8"
      >
        {[
          { label: "Total Leads", value: totalLeads, icon: Users, color: "text-primary" },
          { label: "Contacted", value: contacted, icon: Phone, color: "text-yellow-400" },
          { label: "Qualified", value: qualified, icon: UserCheck, color: "text-purple-400" },
          { label: "Closed", value: closed, icon: CheckCircle, color: "text-emerald-400" },
        ].map((stat) => (
          <GlassCard key={stat.label} className="p-4">
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
            <SelectItem value="qualified">Qualified</SelectItem>
            <SelectItem value="closed">Closed</SelectItem>
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

      {/* Applicants List */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className="space-y-4"
      >
        {filteredApplications.map((app, index) => {
          const status = getApplicationStatus(app);
          return (
            <motion.div
              key={app.id}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.1 * index }}
            >
              <GlassCard className="p-4 hover:bg-muted/50 transition-colors">
                <div className="flex flex-col gap-4">
                  {/* Top Row: Avatar, Name, Contact Info, Badges */}
                  <div className="flex flex-col lg:flex-row lg:items-center gap-4">
                    {/* Avatar & Name */}
                    <div className="flex items-center gap-4 flex-1">
                      <div className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center">
                        <Users className="h-6 w-6 text-primary" />
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
                      <Badge variant="outline" className={cn("capitalize", licenseColors[app.license_status])}>
                        {app.license_status === "licensed" && <Award className="h-3 w-3 mr-1" />}
                        {app.license_status === "unlicensed" && <GraduationCap className="h-3 w-3 mr-1" />}
                        {app.license_status}
                      </Badge>
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

                  {/* Notes Preview */}
                  {app.notes && (
                    <div className="text-sm text-muted-foreground bg-muted/30 rounded-md px-3 py-2 border-l-2 border-primary/50">
                      <span className="line-clamp-2">{app.notes}</span>
                    </div>
                  )}

                  {/* Actions Row */}
                  <div className="flex items-center gap-2 flex-wrap pt-2 border-t border-border/50">
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
                      Record Interview
                    </Button>
                    
                    <div className="flex-1" />
                    
                    {status === "new" && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleMarkAsContacted(app.id)}
                      >
                        <MessageCircle className="h-4 w-4 mr-1" />
                        Contacted
                      </Button>
                    )}
                    
                    {status === "contacted" && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleMarkAsQualified(app.id)}
                      >
                        <UserCheck className="h-4 w-4 mr-1" />
                        Qualified
                      </Button>
                    )}
                    
                    {status === "qualified" && (
                      <Button
                        variant="default"
                        size="sm"
                        onClick={() => handleMarkAsClosed(app.id)}
                      >
                        <CheckCircle className="h-4 w-4 mr-1" />
                        Close
                      </Button>
                    )}
                  </div>
                </div>
              </GlassCard>
            </motion.div>
          );
        })}

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
    </DashboardLayout>
  );
}
