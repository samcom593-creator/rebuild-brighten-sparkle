import { useState, useEffect, useMemo } from "react";
import { motion } from "framer-motion";
import {
  Users,
  Clock,
  Search,
  ChevronRight,
  Send,
  Copy,
  Shield,
  ShieldOff,
  UserX,
  UserCheck,
  ArrowRightLeft,
  Mail,
  FileText,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { LicenseProgressSelector } from "./LicenseProgressSelector";
import { toast } from "sonner";

type SortOption = "production-desc" | "production-asc" | "name" | "status";
type RosterFilter = "all" | "licensed" | "unlicensed" | "training" | "training_online" | "in_field_training";

interface TeamMember {
  id: string;
  userId: string;
  name: string;
  email: string;
  status: string;
  onboardingStage: string;
  totalLeads: number;
  contacted: number;
  closed: number;
  closeRate: number;
  joinedAt: string;
  weekALP: number;
  monthALP: number;
  monthDeals: number;
  licenseStatus: "licensed" | "unlicensed" | "pending";
  managerName: string | null;
  isDirectReport: boolean;
  isDeactivated: boolean;
  isInactive: boolean;
  lastContactedAt: string | null;
  invitedByManagerId: string | null;
  standardPaid: boolean;
  premiumPaid: boolean;
  applicationId: string | null;
  licenseProgress: string | null;
  testScheduledDate: string | null;
}

interface TeamStats {
  totalMembers: number;
  totalLeads: number;
  totalClosed: number;
  avgCloseRate: number;
  licensedCount: number;
  unlicensedCount: number;
  trainingCount: number;
}

async function fetchTeamDataFn(userId: string, isAdmin: boolean): Promise<{ members: TeamMember[]; stats: TeamStats; managerUserIds: Set<string> }> {
  // Fetch manager roles
  let managerUserIds = new Set<string>();
  if (isAdmin) {
    const { data } = await supabase
      .from("user_roles")
      .select("user_id")
      .eq("role", "manager");
    managerUserIds = new Set((data || []).map(r => r.user_id));
  }

  const { data: currentAgent } = await supabase
    .from("agents")
    .select("id")
    .eq("user_id", userId)
    .single();

  if (!currentAgent) return { members: [], stats: { totalMembers: 0, totalLeads: 0, totalClosed: 0, avgCloseRate: 0, licensedCount: 0, unlicensedCount: 0, trainingCount: 0 }, managerUserIds };

  let teamAgents: any[] = [];

  if (isAdmin) {
    const { data: allAgents, error } = await supabase
      .from("agents")
      .select(`id, user_id, status, onboarding_stage, created_at, license_status, invited_by_manager_id, is_deactivated, is_inactive`);
    if (error) throw error;
    teamAgents = allAgents || [];
  } else {
    const { data: directReports, error } = await supabase
      .from("agents")
      .select(`id, user_id, status, onboarding_stage, created_at, license_status, invited_by_manager_id`)
      .eq("invited_by_manager_id", currentAgent.id);
    if (error) throw error;
    teamAgents = directReports || [];
  }

  // Also fetch unlicensed applicants
  let pipelineApplicants: any[] = [];
  const { data: apps } = await supabase
    .from("applications")
    .select("id, first_name, last_name, email, phone, license_status, status, created_at, assigned_agent_id")
    .is("terminated_at", null)
    .eq("license_status", "unlicensed")
    .in("status", ["approved", "contracting"]);

  if (isAdmin) {
    pipelineApplicants = apps || [];
  } else {
    const teamAgentIds = new Set(teamAgents.map(a => a.id));
    teamAgentIds.add(currentAgent.id);
    pipelineApplicants = (apps || []).filter(app =>
      app.assigned_agent_id && teamAgentIds.has(app.assigned_agent_id)
    );
  }

  if (teamAgents.length === 0 && pipelineApplicants.length === 0) {
    return { members: [], stats: { totalMembers: 0, totalLeads: 0, totalClosed: 0, avgCloseRate: 0, licensedCount: 0, unlicensedCount: 0, trainingCount: 0 }, managerUserIds };
  }

  // Get manager names
  const managerIds = [...new Set(teamAgents.map(a => a.invited_by_manager_id).filter(Boolean))];
  let managerProfiles: Record<string, string> = {};

  if (managerIds.length > 0) {
    const { data: managerAgents } = await supabase
      .from("agents")
      .select("id, user_id")
      .in("id", managerIds);

    if (managerAgents && managerAgents.length > 0) {
      const mUserIds = managerAgents.map(m => m.user_id).filter(Boolean);
      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, full_name")
        .in("user_id", mUserIds);

      managerAgents.forEach(manager => {
        const profile = profiles?.find(p => p.user_id === manager.user_id);
        if (profile) {
          managerProfiles[manager.id] = profile.full_name || "Unknown Manager";
        }
      });
    }
  }

  // Get profiles
  const userIds = teamAgents.map(a => a.user_id).filter(Boolean);
  const { data: profiles } = await supabase
    .from("profiles")
    .select("user_id, full_name, email")
    .in("user_id", userIds);

  const today = new Date();
  const weekStartStr = new Date(today.setDate(today.getDate() - today.getDay())).toISOString().split('T')[0];
  const monthStartStr = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().split('T')[0];

  const agentIds = teamAgents.map(a => a.id);
  const { data: production } = await supabase
    .from("daily_production")
    .select("agent_id, aop, deals_closed, production_date")
    .in("agent_id", agentIds)
    .gte("production_date", monthStartStr);

  const productionMap = new Map();
  production?.forEach(p => {
    const existing = productionMap.get(p.agent_id) || { weekALP: 0, monthALP: 0, monthDeals: 0 };
    const alp = Number(p.aop) || 0;
    const deals = Number(p.deals_closed) || 0;
    existing.monthALP += alp;
    existing.monthDeals += deals;
    if (p.production_date >= weekStartStr) {
      existing.weekALP += alp;
    }
    productionMap.set(p.agent_id, existing);
  });

  const filteredAgents = teamAgents.filter(a => a.user_id !== userId);

  const members: TeamMember[] = filteredAgents.map(agent => {
    const profile = profiles?.find(p => p.user_id === agent.user_id);
    const prod = productionMap.get(agent.id) || { weekALP: 0, monthALP: 0, monthDeals: 0 };
    const isDirectReport = agent.invited_by_manager_id === currentAgent.id;
    const managerName = agent.invited_by_manager_id ? managerProfiles[agent.invited_by_manager_id] : null;

    return {
      id: agent.id,
      userId: agent.user_id || "",
      name: profile?.full_name || "Unknown",
      email: profile?.email || "",
      status: agent.status,
      onboardingStage: agent.onboarding_stage || "onboarding",
      totalLeads: 0,
      contacted: 0,
      closed: 0,
      closeRate: 0,
      joinedAt: agent.created_at,
      weekALP: prod.weekALP,
      monthALP: prod.monthALP,
      monthDeals: prod.monthDeals,
      licenseStatus: agent.license_status,
      managerName,
      isDirectReport,
      isDeactivated: agent.is_deactivated || false,
      isInactive: agent.is_inactive || false,
      lastContactedAt: null,
      invitedByManagerId: agent.invited_by_manager_id,
      standardPaid: false,
      premiumPaid: false,
      applicationId: null,
      licenseProgress: null,
      testScheduledDate: null,
    };
  });

  // Process pipeline applicants
  const uniqueApplicants = pipelineApplicants.filter(app =>
    !members.some(m => m.email.toLowerCase() === (app.email || "").toLowerCase())
  );

  const pipelineMembers: TeamMember[] = uniqueApplicants.map(app => {
    let applicantManagerName = null;
    if (app.assigned_agent_id) {
      if (app.assigned_agent_id === currentAgent.id) applicantManagerName = "You";
      else applicantManagerName = managerProfiles[app.assigned_agent_id] || "Unknown";
    }

    return {
      id: `app-${app.id}`,
      userId: "",
      name: `${app.first_name} ${app.last_name}`.trim(),
      email: app.email || "",
      status: "applicant",
      onboardingStage: "onboarding",
      totalLeads: 0,
      contacted: 0,
      closed: 0,
      closeRate: 0,
      joinedAt: app.created_at,
      weekALP: 0,
      monthALP: 0,
      monthDeals: 0,
      licenseStatus: "unlicensed",
      managerName: applicantManagerName,
      isDirectReport: app.assigned_agent_id === currentAgent.id,
      isDeactivated: false,
      isInactive: false,
      lastContactedAt: null,
      invitedByManagerId: app.assigned_agent_id,
      standardPaid: false,
      premiumPaid: false,
      applicationId: app.id,
      licenseProgress: null,
      testScheduledDate: null,
    };
  });

  const allMembers = [...members, ...pipelineMembers];

  // Calc stats
  const activeOnly = allMembers.filter(m => !m.isDeactivated && !m.isInactive);
  const stats: TeamStats = {
    totalMembers: activeOnly.length,
    totalLeads: 0,
    totalClosed: 0,
    avgCloseRate: 0,
    licensedCount: activeOnly.filter(m => m.licenseStatus === "licensed").length,
    unlicensedCount: activeOnly.filter(m => m.licenseStatus !== "licensed").length,
    trainingCount: activeOnly.filter(m => m.onboardingStage === "training_online" || m.onboardingStage === "in_field_training").length,
  };

  return { members: allMembers, stats, managerUserIds };
}

export function ManagerTeamView() {
  const { user, isManager, isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const [activeFilter, setActiveFilter] = useState<RosterFilter>("all");
  const [expandedMember, setExpandedMember] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<SortOption>("production-desc");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);

  const { data: teamData, isLoading: loading } = useQuery({
    queryKey: ["manager-team-view", user?.id, isAdmin],
    queryFn: () => fetchTeamDataFn(user!.id, isAdmin),
    enabled: !!user,
    staleTime: 0,
  });

  const teamMembers = teamData?.members ?? [];
  const teamStats = teamData?.stats ?? { totalMembers: 0, totalLeads: 0, totalClosed: 0, avgCloseRate: 0, licensedCount: 0, unlicensedCount: 0, trainingCount: 0 };
  const managerUserIds = teamData?.managerUserIds ?? new Set<string>();

  const refetchTeamData = () => {
    queryClient.invalidateQueries({ queryKey: ["manager-team-view"] });
  };

  const getTimeAgo = (dateString: string): string => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffHours / 24);
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays === 1) return "Yesterday";
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  const toggleExpand = (memberId: string) => {
    setExpandedMember(expandedMember === memberId ? null : memberId);
  };

  const toggleSelect = (memberId: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(memberId)) next.delete(memberId); else next.add(memberId);
      return next;
    });
  };

  const selectAll = () => {
    const realAgents = filteredAndSortedMembers.filter(m => !m.id.startsWith("app-"));
    if (selectedIds.size === realAgents.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(realAgents.map(m => m.id)));
    }
  };

  const bulkSendPortalLogins = async () => {
    setBulkLoading(true);
    const selected = teamMembers.filter(m => selectedIds.has(m.id) && !m.id.startsWith("app-"));
    let success = 0;
    for (const m of selected) {
      try {
        await supabase.functions.invoke("send-agent-portal-login", { body: { agentId: m.id, email: m.email } });
        success++;
      } catch {}
    }
    toast.success(`Portal logins sent to ${success} agent(s)`);
    setBulkLoading(false);
    setSelectedIds(new Set());
  };

  const bulkChangeStage = async (stage: string) => {
    setBulkLoading(true);
    const ids = Array.from(selectedIds).filter(id => !id.startsWith("app-"));
    let success = 0;
    for (const id of ids) {
      const { error } = await supabase.from("agents").update({ onboarding_stage: stage as any }).eq("id", id);
      if (!error) success++;
    }
    toast.success(`Stage updated for ${success} agent(s)`);
    setBulkLoading(false);
    setSelectedIds(new Set());
    refetchTeamData();
  };

  const filteredAndSortedMembers = useMemo(() => {
    let result = teamMembers;

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(m => m.name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q));
    }

    if (activeFilter === "licensed") result = result.filter(m => m.licenseStatus === "licensed");
    else if (activeFilter === "unlicensed") result = result.filter(m => m.licenseStatus !== "licensed");
    else if (activeFilter === "training") result = result.filter(m => ["training_online", "in_field_training"].includes(m.onboardingStage));

    return result.sort((a, b) => {
      if (sortBy === "production-desc") return b.monthALP - a.monthALP;
      if (sortBy === "production-asc") return a.monthALP - b.monthALP;
      if (sortBy === "name") return a.name.localeCompare(b.name);
      return 0;
    });
  }, [teamMembers, searchQuery, activeFilter, sortBy]);

  return (
    <div className="space-y-4">
      {/* Search + Sort Controls */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search agents by name or email..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 h-9"
          />
        </div>
        <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortOption)}>
          <SelectTrigger className="w-full sm:w-[180px] h-9">
            <SelectValue placeholder="Sort by" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="production-desc">Production (High → Low)</SelectItem>
            <SelectItem value="production-asc">Production (Low → High)</SelectItem>
            <SelectItem value="name">Name (A → Z)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Bulk select toggle */}
      {isAdmin && (
        <div className="flex items-center gap-3">
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={selectAll}>
            {selectedIds.size > 0 ? `Deselect All (${selectedIds.size})` : "Select All"}
          </Button>
          {selectedIds.size > 0 && <span className="text-xs text-muted-foreground">{selectedIds.size} selected</span>}
        </div>
      )}

      <div className="space-y-3">
        {filteredAndSortedMembers.map((member, index) => (
          <motion.div
            key={member.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.03 }}
            className={cn("border rounded-lg overflow-hidden", selectedIds.has(member.id) ? "border-primary" : "border-border")}
          >
            <div
              className="p-4 cursor-pointer hover:bg-muted/50 transition-colors"
              onClick={() => toggleExpand(member.id)}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {/* Bulk checkbox */}
                  {isAdmin && !member.id.startsWith("app-") && (
                    <input
                      type="checkbox"
                      checked={selectedIds.has(member.id)}
                      onChange={(e) => { e.stopPropagation(); toggleSelect(member.id); }}
                      onClick={(e) => e.stopPropagation()}
                      className="h-4 w-4 rounded border-border accent-primary"
                    />
                  )}
                  <div className="h-10 w-10 rounded-full bg-primary/20 flex items-center justify-center">
                    <span className="text-sm font-semibold text-primary">
                      {member.name.charAt(0).toUpperCase()}
                    </span>
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-medium">{member.name}</p>
                      {member.userId && managerUserIds.has(member.userId) && (
                        <Badge className="text-[10px] px-1.5 py-0 bg-teal-500/20 text-teal-400 border-teal-500/30">
                          Manager
                        </Badge>
                      )}
                      {isAdmin && !member.isDirectReport && member.managerName && (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                          Under: {member.managerName}
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <p className="text-xs text-muted-foreground">{member.email}</p>
                      {member.lastContactedAt ? (
                        <span className="flex items-center gap-1 text-[10px] text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded">
                          <Clock className="h-2.5 w-2.5" />
                          {getTimeAgo(member.lastContactedAt)}
                        </span>
                      ) : (
                        <span className="text-[10px] text-muted-foreground/50">No contact yet</span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <div className="hidden md:flex items-center gap-4 text-sm">
                    <div className="text-center">
                      <span className="font-semibold text-primary whitespace-nowrap">${member.weekALP.toLocaleString()}</span>
                      <p className="text-[10px] text-muted-foreground whitespace-nowrap">Week ALP</p>
                    </div>
                    <div className="text-center">
                      <span className="font-semibold text-emerald-500 whitespace-nowrap">${member.monthALP.toLocaleString()}</span>
                      <p className="text-[10px] text-muted-foreground whitespace-nowrap">Month ALP</p>
                    </div>
                    <div className="text-center">
                      <span className="font-semibold">{member.monthDeals}</span>
                      <p className="text-[10px] text-muted-foreground whitespace-nowrap">Deals</p>
                    </div>
                  </div>
                  {member.licenseStatus !== "licensed" && member.applicationId ? (
                    <LicenseProgressSelector
                      applicationId={member.applicationId.replace('app-', '')}
                      currentProgress={(member.licenseProgress || "unlicensed") as any}
                      testScheduledDate={member.testScheduledDate}
                      onProgressUpdated={refetchTeamData}
                      className="h-5 text-[10px]"
                    />
                  ) : (
                    <Badge className={cn(
                      "text-[10px] capitalize whitespace-nowrap shrink-0",
                      member.licenseStatus === "licensed" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" : "bg-muted text-muted-foreground"
                    )}>
                      {member.licenseStatus}
                    </Badge>
                  )}
                  <ChevronRight className={cn(
                    "h-4 w-4 text-muted-foreground transition-transform shrink-0",
                    expandedMember === member.id && "rotate-90"
                  )} />
                </div>
              </div>
            </div>

            {expandedMember === member.id && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="border-t border-border px-4 pb-4 pt-3 bg-muted/30"
              >
                {/* Mobile production stats */}
                <div className="flex items-center gap-4 text-sm mb-3 md:hidden">
                  <div className="text-center">
                    <span className="font-semibold text-primary">${member.weekALP.toLocaleString()}</span>
                    <p className="text-[10px] text-muted-foreground">Week ALP</p>
                  </div>
                  <div className="text-center">
                    <span className="font-semibold text-emerald-500">${member.monthALP.toLocaleString()}</span>
                    <p className="text-[10px] text-muted-foreground">Month ALP</p>
                  </div>
                  <div className="text-center">
                    <span className="font-semibold">{member.monthDeals}</span>
                    <p className="text-[10px] text-muted-foreground">Deals</p>
                  </div>
                </div>

                {/* Agent details */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs mb-3">
                  <div className="bg-background/50 rounded-md p-2">
                    <p className="text-muted-foreground">License</p>
                    <p className="font-medium capitalize">{member.licenseStatus}</p>
                  </div>
                  <div className="bg-background/50 rounded-md p-2">
                    <p className="text-muted-foreground">Stage</p>
                    <p className="font-medium capitalize">{member.onboardingStage.replace(/_/g, " ")}</p>
                  </div>
                  <div className="bg-background/50 rounded-md p-2">
                    <p className="text-muted-foreground">Joined</p>
                    <p className="font-medium">{getTimeAgo(member.joinedAt)}</p>
                  </div>
                  {member.managerName && (
                    <div className="bg-background/50 rounded-md p-2">
                      <p className="text-muted-foreground">Manager</p>
                      <p className="font-medium">{member.managerName}</p>
                    </div>
                  )}
                </div>

                {/* Quick actions */}
                <div className="flex items-center gap-2 flex-wrap">
                  <a
                    href={`/dashboard/crm?focusAgentId=${member.id}`}
                    onClick={(e) => e.stopPropagation()}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                  >
                    View in CRM
                  </a>
                  {member.email && (
                    <a
                      href={`mailto:${member.email}`}
                      onClick={(e) => e.stopPropagation()}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-muted text-muted-foreground hover:bg-accent transition-colors"
                    >
                      <Mail className="h-3 w-3" /> Email
                    </a>
                  )}
                </div>

                {/* ====== ADMIN ACTIONS ====== */}
                {isAdmin && !member.id.startsWith("app-") && (
                  <div className="mt-3 pt-3 border-t border-border space-y-3">
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Admin Actions</p>
                    
                    {/* Row 1: Login & Communication */}
                    <div className="flex items-center gap-2 flex-wrap">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs gap-1.5"
                        onClick={async (e) => {
                          e.stopPropagation();
                          try {
                            const { error } = await supabase.functions.invoke("send-agent-portal-login", {
                              body: { agentId: member.id, email: member.email },
                            });
                            if (error) throw error;
                            toast.success(`Portal login sent to ${member.email}`);
                          } catch (err: any) {
                            toast.error(err.message || "Failed to send login");
                          }
                        }}
                      >
                        <Send className="h-3 w-3" /> Send Portal Login
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs gap-1.5"
                        onClick={async (e) => {
                          e.stopPropagation();
                          try {
                            const { data, error } = await supabase.functions.invoke("generate-magic-link", {
                              body: { agentId: member.id, email: member.email, destination: "portal" },
                            });
                            if (error) throw error;
                            await navigator.clipboard.writeText(data.magicLink);
                            toast.success("Login link copied to clipboard!");
                          } catch (err: any) {
                            toast.error(err.message || "Failed to generate link");
                          }
                        }}
                      >
                        <Copy className="h-3 w-3" /> Copy Login Link
                      </Button>
                      {member.licenseStatus !== "licensed" && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs gap-1.5"
                          onClick={async (e) => {
                            e.stopPropagation();
                            try {
                              const { error } = await supabase.functions.invoke("send-licensing-instructions", {
                                body: { email: member.email, firstName: member.name.split(" ")[0] },
                              });
                              if (error) throw error;
                              toast.success("Licensing instructions sent!");
                            } catch (err: any) {
                              toast.error(err.message || "Failed to send");
                            }
                          }}
                        >
                          <FileText className="h-3 w-3" /> Send Licensing Info
                        </Button>
                      )}
                    </div>

                    {/* Row 2: License & Stage & Reassign */}
                    <div className="flex items-center gap-2 flex-wrap">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs gap-1.5"
                        onClick={async (e) => {
                          e.stopPropagation();
                          const newStatus = member.licenseStatus === "licensed" ? "unlicensed" : "licensed";
                          const { error } = await supabase
                            .from("agents")
                            .update({ license_status: newStatus })
                            .eq("id", member.id);
                          if (error) { toast.error("Failed to update license"); return; }
                          toast.success(`License changed to ${newStatus}`);
                          refetchTeamData();
                        }}
                      >
                        {member.licenseStatus === "licensed" ? "Set Unlicensed" : "Set Licensed"}
                      </Button>

                      <Select
                        value={member.onboardingStage}
                        onValueChange={async (val) => {
                          const { error } = await supabase
                            .from("agents")
                            .update({ onboarding_stage: val as any })
                            .eq("id", member.id);
                          if (error) { toast.error("Failed to update stage"); return; }
                          toast.success(`Stage changed to ${val.replace(/_/g, " ")}`);
                          refetchTeamData();
                        }}
                      >
                        <SelectTrigger className="h-7 w-[150px] text-xs" onClick={(e) => e.stopPropagation()}>
                          <SelectValue placeholder="Stage" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="onboarding">Onboarding</SelectItem>
                          <SelectItem value="training_online">Training Online</SelectItem>
                          <SelectItem value="in_field_training">In-Field Training</SelectItem>
                          <SelectItem value="evaluated">Evaluated</SelectItem>
                          <SelectItem value="active">Active</SelectItem>
                        </SelectContent>
                      </Select>

                      <ManagerReassignInline
                        currentManagerId={member.invitedByManagerId}
                        agentId={member.id}
                        onReassigned={refetchTeamData}
                      />
                    </div>

                    {/* Row 3: Role & Status */}
                    <div className="flex items-center gap-2 flex-wrap">
                      {member.userId && (
                        <Button
                          size="sm"
                          variant={managerUserIds.has(member.userId) ? "destructive" : "outline"}
                          className="h-7 text-xs gap-1.5"
                          onClick={async (e) => {
                            e.stopPropagation();
                            const isCurrentlyManager = managerUserIds.has(member.userId);
                            if (isCurrentlyManager) {
                              const { error } = await supabase
                                .from("user_roles")
                                .delete()
                                .eq("user_id", member.userId)
                                .eq("role", "manager");
                              if (error) { toast.error("Failed to remove manager role"); return; }
                              toast.success(`${member.name} demoted from Manager`);
                            } else {
                              const { error } = await supabase
                                .from("user_roles")
                                .insert({ user_id: member.userId, role: "manager" });
                              if (error) { toast.error("Failed to promote to manager"); return; }
                              toast.success(`${member.name} promoted to Manager!`);
                            }
                            refetchTeamData();
                          }}
                        >
                          {managerUserIds.has(member.userId) ? (
                            <><ShieldOff className="h-3 w-3" /> Remove Manager</>
                          ) : (
                            <><Shield className="h-3 w-3" /> Promote to Manager</>
                          )}
                        </Button>
                      )}

                      <Button
                        size="sm"
                        variant={member.isDeactivated ? "outline" : "destructive"}
                        className="h-7 text-xs gap-1.5"
                        onClick={async (e) => {
                          e.stopPropagation();
                          const { error } = await supabase
                            .from("agents")
                            .update({
                              is_deactivated: !member.isDeactivated,
                              is_inactive: !member.isDeactivated,
                            })
                            .eq("id", member.id);
                          if (error) { toast.error("Failed to update status"); return; }
                          toast.success(member.isDeactivated ? `${member.name} reactivated` : `${member.name} deactivated`);
                          refetchTeamData();
                        }}
                      >
                        {member.isDeactivated ? (
                          <><UserCheck className="h-3 w-3" /> Reactivate</>
                        ) : (
                          <><UserX className="h-3 w-3" /> Deactivate</>
                        )}
                      </Button>
                    </div>
                  </div>
                )}
              </motion.div>
            )}
          </motion.div>
        ))}
      </div>

      {/* Floating Bulk Action Bar */}
      {isAdmin && selectedIds.size > 0 && (
        <motion.div
          initial={{ y: 100, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-card border border-border rounded-xl shadow-lg px-6 py-3 flex items-center gap-4"
        >
          <span className="text-sm font-semibold">{selectedIds.size} selected</span>
          <div className="h-6 w-px bg-border" />
          <Button
            size="sm"
            variant="outline"
            className="h-8 text-xs gap-1.5"
            disabled={bulkLoading}
            onClick={bulkSendPortalLogins}
          >
            <Send className="h-3 w-3" /> Send Login Links
          </Button>
          <Select onValueChange={bulkChangeStage}>
            <SelectTrigger className="h-8 w-[140px] text-xs" disabled={bulkLoading}>
              <SelectValue placeholder="Change Stage" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="onboarding">Onboarding</SelectItem>
              <SelectItem value="training_online">Training Online</SelectItem>
              <SelectItem value="in_field_training">In-Field Training</SelectItem>
              <SelectItem value="evaluated">Evaluated</SelectItem>
              <SelectItem value="active">Active</SelectItem>
            </SelectContent>
          </Select>
          <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setSelectedIds(new Set())}>
            Cancel
          </Button>
        </motion.div>
      )}
    </div>
  );
}

function ManagerReassignInline({ currentManagerId, agentId, onReassigned }: { currentManagerId: string | null; agentId: string; onReassigned: () => void }) {
  const [managers, setManagers] = useState<{ id: string; name: string }[]>([]);
  
  useEffect(() => {
    (async () => {
      const { data } = await supabase.functions.invoke("get-active-managers");
      if (data?.managers) {
        setManagers(data.managers.map((m: any) => ({ id: m.id, name: m.name })));
      }
    })();
  }, []);

  return (
    <Select
      value={currentManagerId || ""}
      onValueChange={async (val) => {
        const { error } = await supabase
          .from("agents")
          .update({ invited_by_manager_id: val, manager_id: val })
          .eq("id", agentId);
        if (error) { toast.error("Failed to reassign"); return; }
        toast.success("Agent reassigned!");
        onReassigned();
      }}
    >
      <SelectTrigger className="h-7 w-[160px] text-xs" onClick={(e) => e.stopPropagation()}>
        <SelectValue placeholder="Reassign Manager" />
      </SelectTrigger>
      <SelectContent>
        {managers.map(m => (
          <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
