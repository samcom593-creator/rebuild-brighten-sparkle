import { useState, useEffect } from "react";
import { AgentAvatar, getAvatarUrl } from "@/components/ui/AgentAvatar";
import { startOfWeek, endOfWeek } from "date-fns";
import {
  Mail,
  Phone,
  Instagram,
  Users,
  Loader2,
  ExternalLink,
  RefreshCw,
  ChevronRight,
  DollarSign,
  Search,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

import { GlassCard } from "@/components/ui/glass-card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { AddToCourseButton } from "@/components/dashboard/AddToCourseButton";
import { cn } from "@/lib/utils";

interface ManagerProfile {
  id: string;
  fullName: string;
  email: string;
  phone?: string;
  instagramHandle?: string;
  avatarUrl?: string;
  city?: string;
  state?: string;
}

interface TeamMember {
  id: string;
  name: string;
  email: string;
  onboardingStage: string;
  hasProgress: boolean;
  courseProgress: number;
  avatarUrl?: string;
  weeklyAlp: number;
}

interface ManagerWithTeam {
  manager: ManagerProfile;
  agentId: string;
  teamMembers: TeamMember[];
  isCurrentUser: boolean;
  totalWeeklyAlp: number;
}

export default function TeamDirectory() {
  const { user, isAdmin, isManager, isLoading: authLoading } = useAuth();
  const [manager, setManager] = useState<ManagerProfile | null>(null);
  const [hierarchy, setHierarchy] = useState<ManagerWithTeam[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      if (!user) return;

      setLoading(true);
      setError(null);

      try {
        if (isAdmin || isManager) {
          await fetchHierarchy();
        } else {
          await fetchManagerInfo();
        }
      } catch (err) {
        console.error("Unexpected error:", err);
        setError("An unexpected error occurred.");
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [user?.id, isAdmin, isManager]);

  const fetchHierarchy = async () => {
    // Get current user's agent ID
    const { data: currentAgent } = await supabase
      .from("agents")
      .select("id")
      .eq("user_id", user!.id)
      .maybeSingle();

    // Fetch all managers and their teams
    const now = new Date();
    const weekStart = startOfWeek(now, { weekStartsOn: 1 }).toISOString().split("T")[0];
    const weekEnd = endOfWeek(now, { weekStartsOn: 1 }).toISOString().split("T")[0];

    const [rolesResult, agentsResult, profilesResult, progressResult, modulesResult, prodResult] = await Promise.all([
      supabase.from("user_roles").select("user_id").in("role", ["manager", "admin"]),
      supabase.from("agents").select("id, user_id, invited_by_manager_id, onboarding_stage, is_deactivated, status"),
      supabase.from("profiles").select("*"),
      supabase.from("onboarding_progress").select("agent_id, passed"),
      supabase.from("onboarding_modules").select("id").eq("is_active", true),
      supabase.from("daily_production").select("agent_id, aop").gte("production_date", weekStart).lte("production_date", weekEnd),
    ]);

    // Build weekly ALP map
    const weeklyAlpMap = new Map<string, number>();
    (prodResult.data || []).forEach(p => {
      weeklyAlpMap.set(p.agent_id, (weeklyAlpMap.get(p.agent_id) || 0) + Number(p.aop || 0));
    });

    const managerUserIds = new Set(rolesResult.data?.map(r => r.user_id) || []);
    const agents = agentsResult.data || [];
    const profiles = profilesResult.data || [];
    const progressData = progressResult.data || [];
    const totalModules = modulesResult.data?.length || 1;

    // Calculate progress per agent
    const agentProgressMap = new Map<string, { hasProgress: boolean; passedCount: number }>();
    progressData.forEach(p => {
      const existing = agentProgressMap.get(p.agent_id) || { hasProgress: false, passedCount: 0 };
      agentProgressMap.set(p.agent_id, {
        hasProgress: true,
        passedCount: existing.passedCount + (p.passed ? 1 : 0),
      });
    });

    // Build hierarchy
    const managerAgents = agents.filter(a => 
      managerUserIds.has(a.user_id || "") && 
      a.status === "active" && 
      !a.is_deactivated
    );

    const hierarchyData: ManagerWithTeam[] = managerAgents.map(managerAgent => {
      const profile = profiles.find(p => p.user_id === managerAgent.user_id);
      
      // Get team members under this manager
      const teamMembers: TeamMember[] = agents
        .filter(a => a.invited_by_manager_id === managerAgent.id && !a.is_deactivated)
        .map(a => {
          const memberProfile = profiles.find(p => p.user_id === a.user_id);
          const progressInfo = agentProgressMap.get(a.id);
          return {
            id: a.id,
            name: memberProfile?.full_name || "Unknown",
            email: memberProfile?.email || "",
            onboardingStage: a.onboarding_stage || "onboarding",
            hasProgress: progressInfo?.hasProgress || false,
            courseProgress: progressInfo 
              ? Math.round((progressInfo.passedCount / totalModules) * 100) 
              : 0,
            avatarUrl: memberProfile?.avatar_url || undefined,
            weeklyAlp: weeklyAlpMap.get(a.id) || 0,
          };
        });

      const totalWeeklyAlp = teamMembers.reduce((sum, m) => sum + m.weeklyAlp, 0);

      return {
        manager: {
          id: profile?.id || "",
          fullName: profile?.full_name || "Unknown Manager",
          email: profile?.email || "",
          phone: profile?.phone || undefined,
          instagramHandle: profile?.instagram_handle || undefined,
          avatarUrl: profile?.avatar_url || undefined,
          city: profile?.city || undefined,
          state: profile?.state || undefined,
        },
        agentId: managerAgent.id,
        teamMembers,
        isCurrentUser: managerAgent.id === currentAgent?.id,
        totalWeeklyAlp,
      };
    });

    // Sort: current user first, then by team size
    hierarchyData.sort((a, b) => {
      if (a.isCurrentUser) return -1;
      if (b.isCurrentUser) return 1;
      return b.teamMembers.length - a.teamMembers.length;
    });

    setHierarchy(hierarchyData);
  };

  const fetchManagerInfo = async () => {
    // Get the current user's agent record
    const { data: agentData, error: agentError } = await supabase
      .from("agents")
      .select("invited_by_manager_id")
      .eq("user_id", user!.id)
      .maybeSingle();

    if (agentError) {
      console.error("Error fetching agent:", agentError);
      setError("Could not load your team information.");
      return;
    }

    if (!agentData?.invited_by_manager_id) {
      setError("You haven't been assigned to a manager yet.");
      return;
    }

    // Get the manager's agent record to find their user_id
    const { data: managerAgent, error: managerAgentError } = await supabase
      .from("agents")
      .select("user_id")
      .eq("id", agentData.invited_by_manager_id)
      .maybeSingle();

    if (managerAgentError || !managerAgent?.user_id) {
      console.error("Error fetching manager agent:", managerAgentError);
      setError("Could not load manager information.");
      return;
    }

    // Get the manager's profile
    const { data: profileData, error: profileError } = await supabase
      .from("profiles")
      .select("*")
      .eq("user_id", managerAgent.user_id)
      .maybeSingle();

    if (profileError || !profileData) {
      console.error("Error fetching manager profile:", profileError);
      setError("Could not load manager profile.");
      return;
    }

    setManager({
      id: profileData.id,
      fullName: profileData.full_name || "Your Manager",
      email: profileData.email,
      phone: profileData.phone || undefined,
      instagramHandle: profileData.instagram_handle || undefined,
      avatarUrl: profileData.avatar_url || undefined,
      city: profileData.city || undefined,
      state: profileData.state || undefined,
    });
  };

  const getStageName = (stage: string) => {
    switch (stage) {
      case "onboarding": return "Onboarding";
      case "training_online": return "Coursework";
      case "in_field_training": return "Field Training";
      case "evaluated": return "Live";
      default: return stage;
    }
  };

  const getStageColor = (stage: string) => {
    switch (stage) {
      case "onboarding":
      case "training_online":
        return "bg-blue-500/20 text-blue-600 dark:text-blue-400 border-blue-500/30";
      case "in_field_training":
        return "bg-amber-500/20 text-amber-600 dark:text-amber-400 border-amber-500/30";
      case "evaluated":
        return "bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border-emerald-500/30";
      default:
        return "bg-muted text-muted-foreground";
    }
  };

  if (authLoading || loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (isAdmin || isManager) {
    return (
      <div className="space-y-6">
        <div className="space-y-6">
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-3">
                <Users className="h-8 w-8 text-primary" />
                <div>
                  <h1 className="text-3xl font-bold">Team Directory</h1>
                  <p className="text-muted-foreground">
                    Manager → Agent relationships at a glance
                  </p>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setLoading(true);
                  fetchHierarchy().finally(() => setLoading(false));
                }}
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                Refresh
              </Button>
            </div>
          </div>

          {/* Hierarchy Tree View */}
          <div className="space-y-4">
            {hierarchy.map((item, index) => (
              <div
                key={item.agentId}
              >
                <GlassCard className="p-0 overflow-hidden">
                  {/* Manager Header */}
                  <div className={cn(
                    "p-4 border-b border-border",
                    item.isCurrentUser && "bg-primary/5"
                  )}>
                    <div className="flex items-center gap-4">
                      <AgentAvatar avatarUrl={getAvatarUrl(item.manager.avatarUrl)} name={item.manager.fullName} size="lg" className="border-2 border-primary/20" />
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <h3 className="font-semibold text-lg">{item.manager.fullName}</h3>
                          {item.isCurrentUser && (
                            <Badge className="bg-primary/20 text-primary border-primary/30">You</Badge>
                          )}
                          <Badge variant="secondary">Manager</Badge>
                        </div>
                        <p className="text-sm text-muted-foreground">{item.manager.email}</p>
                      </div>
                      <div className="text-right space-y-1">
                        <p className="text-2xl font-bold text-primary">{item.teamMembers.length}</p>
                        <p className="text-xs text-muted-foreground">team members</p>
                        {item.totalWeeklyAlp > 0 && (
                          <div className="flex items-center gap-1 justify-end">
                            <DollarSign className="h-3 w-3 text-emerald-500" />
                            <span className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">
                              {item.totalWeeklyAlp.toLocaleString()} ALP
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Team Members */}
                  {item.teamMembers.length > 0 ? (
                    <div className="divide-y divide-border">
                      {item.teamMembers.map((member) => (
                        <div
                          key={member.id}
                          className="p-3 pl-8 flex items-center gap-4 hover:bg-muted/30 transition-colors"
                        >
                          <ChevronRight className="h-4 w-4 text-muted-foreground/50" />
                          <AgentAvatar avatarUrl={getAvatarUrl(member.avatarUrl)} name={member.name} size="sm" />
                          <div className="flex-1 min-w-0">
                            <p className="font-medium truncate">{member.name}</p>
                            <p className="text-xs text-muted-foreground truncate">{member.email}</p>
                          </div>
                          
                          {/* Weekly ALP + Course Progress */}
                          <div className="flex items-center gap-3">
                            {member.weeklyAlp > 0 && (
                              <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
                                ${member.weeklyAlp.toLocaleString()}
                              </span>
                            )}
                            
                            {member.courseProgress === 100 ? (
                              <Badge className="bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border-emerald-500/30">
                                ✓ Complete
                              </Badge>
                            ) : member.hasProgress ? (
                              <div className="flex items-center gap-2">
                                <Progress value={member.courseProgress} className="h-2 w-20" />
                                <span className="text-xs text-muted-foreground w-8">{member.courseProgress}%</span>
                              </div>
                            ) : (
                              <AddToCourseButton
                                agentId={member.id}
                                agentName={member.name}
                                hasProgress={false}
                                onSuccess={() => {
                                  setLoading(true);
                                  fetchHierarchy().finally(() => setLoading(false));
                                }}
                                size="sm"
                              />
                            )}
                            
                            <Badge className={getStageColor(member.onboardingStage)}>
                              {getStageName(member.onboardingStage)}
                            </Badge>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="p-4 pl-8 text-sm text-muted-foreground">
                      No team members yet
                    </div>
                  )}
                </GlassCard>
              </div>
            ))}

            {hierarchy.length === 0 && (
              <GlassCard className="p-8 text-center">
                <Users className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-lg font-semibold mb-2">No Managers Found</h3>
                <p className="text-muted-foreground">
                  No manager accounts have been set up yet.
                </p>
              </GlassCard>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="max-w-2xl mx-auto space-y-6">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <Users className="h-8 w-8 text-primary" />
            <h1 className="text-3xl font-bold">Team Directory</h1>
          </div>
          <p className="text-muted-foreground">
            Connect with your manager and get support
          </p>
        </div>

        {error ? (
          <GlassCard className="p-8 text-center">
            <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
              <Users className="h-8 w-8 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-semibold mb-2">No Manager Assigned</h3>
            <p className="text-muted-foreground">{error}</p>
          </GlassCard>
        ) : manager ? (
          <div>
            <GlassCard className="p-8">
              <div className="flex flex-col items-center text-center mb-8">
                <Avatar className="h-24 w-24 mb-4 border-4 border-primary/20">
                  <AvatarImage src={manager.avatarUrl} alt={manager.fullName} />
                  <AvatarFallback className="text-2xl bg-primary/20 text-primary">
                    {manager.fullName
                      .split(" ")
                      .map((n) => n[0])
                      .join("")
                      .toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <h2 className="text-2xl font-bold">{manager.fullName}</h2>
                <p className="text-muted-foreground">Your Manager</p>
                {manager.city && manager.state && (
                  <p className="text-sm text-muted-foreground mt-1">
                    📍 {manager.city}, {manager.state}
                  </p>
                )}
              </div>

              <div className="space-y-4">
                {/* Email */}
                <div className="flex items-center gap-4 p-4 rounded-lg bg-muted/50 hover:bg-muted transition-colors">
                  <div className="h-12 w-12 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                    <Mail className="h-6 w-6 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-muted-foreground">Email</p>
                    <a
                      href={`mailto:${manager.email}`}
                      className="font-medium text-primary hover:underline truncate block"
                    >
                      {manager.email}
                    </a>
                  </div>
                  <Button variant="outline" size="sm" asChild>
                    <a href={`mailto:${manager.email}`}>
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  </Button>
                </div>

                {/* Phone */}
                {manager.phone && (
                  <div className="flex items-center gap-4 p-4 rounded-lg bg-muted/50 hover:bg-muted transition-colors">
                    <div className="h-12 w-12 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                      <Phone className="h-6 w-6 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-muted-foreground">Phone</p>
                      <a
                        href={`tel:${manager.phone}`}
                        className="font-medium text-primary hover:underline"
                      >
                        {manager.phone}
                      </a>
                    </div>
                    <Button variant="outline" size="sm" asChild>
                      <a href={`tel:${manager.phone}`}>
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    </Button>
                  </div>
                )}

                {/* Instagram */}
                {manager.instagramHandle && (
                  <div className="flex items-center gap-4 p-4 rounded-lg bg-muted/50 hover:bg-muted transition-colors">
                    <div className="h-12 w-12 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                      <Instagram className="h-6 w-6 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-muted-foreground">Instagram</p>
                      <a
                        href={`https://instagram.com/${manager.instagramHandle}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium text-primary hover:underline"
                      >
                        @{manager.instagramHandle}
                      </a>
                    </div>
                    <Button variant="outline" size="sm" asChild>
                      <a
                        href={`https://instagram.com/${manager.instagramHandle}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    </Button>
                  </div>
                )}

                {/* No phone or Instagram */}
                {!manager.phone && !manager.instagramHandle && (
                  <div className="p-4 rounded-lg bg-muted/30 border border-border text-center">
                    <p className="text-sm text-muted-foreground">
                      Your manager hasn't added their phone or Instagram yet.
                      You can reach out via email for now.
                    </p>
                  </div>
                )}
              </div>

              <div className="mt-8 pt-6 border-t border-border">
                <div className="bg-primary/10 rounded-lg p-4 text-center">
                  <p className="text-sm text-primary font-medium">
                    💡 Need help with training, leads, or onboarding? Reach out
                    to your manager anytime!
                  </p>
                </div>
              </div>
            </GlassCard>
          </div>
        ) : null}
      </div>
    </div>
  );
}
