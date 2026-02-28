import { useState, useEffect, useMemo } from "react";
import { motion } from "framer-motion";
import { TrendingUp, Instagram, Users, BarChart3, Trophy, ExternalLink, Loader2, Save } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { GlassCard } from "@/components/ui/glass-card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getTodayPST } from "@/lib/dateUtils";
import { startOfWeek, format } from "date-fns";

interface ManagerProfile {
  id: string;
  display_name: string | null;
  profile_id: string | null;
  full_name?: string;
  avatar_url?: string;
  instagram_handle?: string;
}

interface GrowthStat {
  id: string;
  agent_id: string;
  stat_date: string;
  applications_submitted: number;
  instagram_views: number;
  followers_gained: number;
  follower_count: number;
}

export default function GrowthDashboard() {
  const { user, isAdmin, isManager } = useAuth();
  const [managers, setManagers] = useState<ManagerProfile[]>([]);
  const [weekStats, setWeekStats] = useState<GrowthStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [myAgentId, setMyAgentId] = useState<string | null>(null);

  // Form state for daily input
  const [formApps, setFormApps] = useState("");
  const [formViews, setFormViews] = useState("");
  const [formFollowers, setFormFollowers] = useState("");
  const [formFollowerCount, setFormFollowerCount] = useState("");

  const todayPST = getTodayPST();
  const weekStart = format(startOfWeek(new Date(todayPST), { weekStartsOn: 1 }), "yyyy-MM-dd");

  useEffect(() => {
    fetchData();
  }, [user]);

  const fetchData = async () => {
    if (!user) return;
    setLoading(true);

    try {
      // Get current user's agent id
      const { data: agentData } = await supabase
        .from("agents")
        .select("id")
        .eq("user_id", user.id)
        .maybeSingle();

      if (agentData) setMyAgentId(agentData.id);

      // Get all managers with profiles
      const { data: managersData } = await supabase
        .from("agents")
        .select("id, display_name, profile_id")
        .or("is_deactivated.is.null,is_deactivated.eq.false");

      // Get profiles for full names + instagram
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, full_name, avatar_url");

      // Get applications for instagram handles
      const profileMap = new Map((profiles || []).map(p => [p.id, p]));

      // Get instagram handles from applications table (assigned agents)
      const { data: appsWithIg } = await supabase
        .from("applications")
        .select("assigned_agent_id, instagram_handle")
        .not("instagram_handle", "is", null);

      const igMap = new Map<string, string>();
      (appsWithIg || []).forEach(a => {
        if (a.assigned_agent_id && a.instagram_handle) {
          igMap.set(a.assigned_agent_id, a.instagram_handle);
        }
      });

      // Also check agents table for instagram from profiles
      const enrichedManagers = (managersData || []).map(m => {
        const profile = m.profile_id ? profileMap.get(m.profile_id) : null;
        return {
          ...m,
          full_name: profile?.full_name || m.display_name || "Unknown",
          avatar_url: profile?.avatar_url || null,
          instagram_handle: igMap.get(m.id) || null,
        };
      });

      setManagers(enrichedManagers as ManagerProfile[]);

      // Get this week's growth stats
      const { data: statsData } = await supabase
        .from("manager_growth_stats")
        .select("*")
        .gte("stat_date", weekStart);

      setWeekStats((statsData || []) as GrowthStat[]);

      // Pre-fill today's entry if exists
      if (agentData) {
        const todayEntry = (statsData || []).find(
          (s: any) => s.agent_id === agentData.id && s.stat_date === todayPST
        );
        if (todayEntry) {
          const te = todayEntry as GrowthStat;
          setFormApps(String(te.applications_submitted || 0));
          setFormViews(String(te.instagram_views || 0));
          setFormFollowers(String(te.followers_gained || 0));
          setFormFollowerCount(String(te.follower_count || 0));
        }
      }
    } catch (err) {
      console.error("Error fetching growth data:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!myAgentId) return;
    setSaving(true);

    try {
      const payload = {
        agent_id: myAgentId,
        stat_date: todayPST,
        applications_submitted: parseInt(formApps) || 0,
        instagram_views: parseInt(formViews) || 0,
        followers_gained: parseInt(formFollowers) || 0,
        follower_count: parseInt(formFollowerCount) || 0,
      };

      const { error } = await supabase
        .from("manager_growth_stats")
        .upsert(payload, { onConflict: "agent_id,stat_date" });

      if (error) throw error;
      toast.success("Growth numbers saved!");
      fetchData();
    } catch (err) {
      console.error("Error saving:", err);
      toast.error("Failed to save. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  // Leaderboard: aggregate weekly stats per manager
  const leaderboard = useMemo(() => {
    const byManager = new Map<string, { apps: number; views: number; followers: number; latestCount: number }>();

    weekStats.forEach((s) => {
      const existing = byManager.get(s.agent_id) || { apps: 0, views: 0, followers: 0, latestCount: 0 };
      existing.apps += s.applications_submitted;
      existing.views += s.instagram_views;
      existing.followers += s.followers_gained;
      if (s.follower_count > existing.latestCount) existing.latestCount = s.follower_count;
      byManager.set(s.agent_id, existing);
    });

    return Array.from(byManager.entries())
      .map(([agentId, stats]) => {
        const manager = managers.find(m => m.id === agentId);
        return { agentId, name: manager?.full_name || "Unknown", ...stats };
      })
      .sort((a, b) => b.apps - a.apps);
  }, [weekStats, managers]);

  // Instagram directory: managers sorted by follower count
  const instagramDirectory = useMemo(() => {
    const latestCounts = new Map<string, number>();
    weekStats.forEach(s => {
      const current = latestCounts.get(s.agent_id) || 0;
      if (s.follower_count > current) latestCounts.set(s.agent_id, s.follower_count);
    });

    return managers
      .filter(m => m.instagram_handle)
      .map(m => ({
        ...m,
        followerCount: latestCounts.get(m.id) || 0,
      }))
      .sort((a, b) => b.followerCount - a.followerCount);
  }, [managers, weekStats]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-6xl mx-auto page-enter">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-accent flex items-center justify-center">
          <TrendingUp className="h-5 w-5 text-primary-foreground" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">Growth Dashboard</h1>
          <p className="text-sm text-muted-foreground">Track team growth metrics & Instagram performance</p>
        </div>
      </div>

      <Tabs defaultValue="leaderboard" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="leaderboard" className="flex items-center gap-2">
            <Trophy className="h-4 w-4" /> Leaderboard
          </TabsTrigger>
          <TabsTrigger value="input" className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4" /> Log Numbers
          </TabsTrigger>
          <TabsTrigger value="instagram" className="flex items-center gap-2">
            <Instagram className="h-4 w-4" /> Directory
          </TabsTrigger>
        </TabsList>

        {/* Leaderboard Tab */}
        <TabsContent value="leaderboard" className="space-y-4 mt-4">
          <GlassCard className="p-4">
            <h3 className="font-semibold mb-3 flex items-center gap-2">
              <Trophy className="h-4 w-4 text-primary" />
              Weekly Manager Rankings
              <Badge variant="outline" className="ml-auto text-xs">Week of {weekStart}</Badge>
            </h3>

            {leaderboard.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">No data yet this week. Be the first to log!</p>
            ) : (
              <div className="space-y-2">
                {leaderboard.map((entry, i) => (
                  <motion.div
                    key={entry.agentId}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.05 }}
                    className={`flex items-center gap-3 p-3 rounded-lg border transition-all ${
                      i === 0 ? "border-primary/30 bg-primary/5" : "border-border bg-card/50"
                    }`}
                  >
                    <span className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                      i === 0 ? "bg-primary text-primary-foreground" : i === 1 ? "bg-muted text-foreground" : "bg-muted/50 text-muted-foreground"
                    }`}>
                      {i + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">{entry.name}</p>
                    </div>
                    <div className="flex items-center gap-4 text-xs">
                      <div className="text-center">
                        <p className="font-bold text-foreground">{entry.apps}</p>
                        <p className="text-muted-foreground">Apps</p>
                      </div>
                      <div className="text-center">
                        <p className="font-bold text-foreground">{entry.views.toLocaleString()}</p>
                        <p className="text-muted-foreground">Views</p>
                      </div>
                      <div className="text-center">
                        <p className="font-bold text-foreground">+{entry.followers}</p>
                        <p className="text-muted-foreground">Followers</p>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            )}
          </GlassCard>
        </TabsContent>

        {/* Log Numbers Tab */}
        <TabsContent value="input" className="space-y-4 mt-4">
          {(isAdmin || isManager) ? (
            <GlassCard className="p-5">
              <h3 className="font-semibold mb-4 flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-primary" />
                Log Today's Growth Numbers
                <Badge variant="outline" className="ml-auto text-xs">{todayPST}</Badge>
              </h3>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Applications Submitted</Label>
                  <Input type="number" min="0" value={formApps} onChange={(e) => setFormApps(e.target.value)} placeholder="0" className="bg-input text-center text-lg font-bold" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">IG Story Views (this week)</Label>
                  <Input type="number" min="0" value={formViews} onChange={(e) => setFormViews(e.target.value)} placeholder="0" className="bg-input text-center text-lg font-bold" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">New Followers Gained</Label>
                  <Input type="number" min="0" value={formFollowers} onChange={(e) => setFormFollowers(e.target.value)} placeholder="0" className="bg-input text-center text-lg font-bold" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Total Follower Count</Label>
                  <Input type="number" min="0" value={formFollowerCount} onChange={(e) => setFormFollowerCount(e.target.value)} placeholder="0" className="bg-input text-center text-lg font-bold" />
                </div>
              </div>
              <Button onClick={handleSave} disabled={saving} className="w-full mt-4">
                {saving ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Saving...</> : <><Save className="h-4 w-4 mr-2" /> Save Numbers</>}
              </Button>
            </GlassCard>
          ) : (
            <GlassCard className="p-6 text-center">
              <p className="text-muted-foreground">Only managers can log growth numbers.</p>
            </GlassCard>
          )}
        </TabsContent>

        {/* Instagram Directory Tab */}
        <TabsContent value="instagram" className="space-y-4 mt-4">
          <GlassCard className="p-4">
            <h3 className="font-semibold mb-3 flex items-center gap-2">
              <Instagram className="h-4 w-4 text-primary" />
              Instagram Directory
              <Badge variant="outline" className="ml-auto text-xs">{instagramDirectory.length} profiles</Badge>
            </h3>

            {instagramDirectory.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">No Instagram handles on file yet.</p>
            ) : (
              <div className="space-y-2">
                {instagramDirectory.map((person, i) => (
                  <motion.a
                    key={person.id}
                    href={`https://instagram.com/${person.instagram_handle}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.03 }}
                    className="flex items-center gap-3 p-3 rounded-lg border border-border bg-card/50 hover:border-primary/30 hover:bg-primary/5 transition-all group"
                  >
                    <div className="w-9 h-9 rounded-full bg-gradient-to-br from-pink-500 to-purple-600 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                      {person.full_name?.charAt(0) || "?"}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">{person.full_name}</p>
                      <p className="text-xs text-muted-foreground">@{person.instagram_handle}</p>
                    </div>
                    {person.followerCount > 0 && (
                      <Badge variant="secondary" className="text-xs">{person.followerCount.toLocaleString()} followers</Badge>
                    )}
                    <ExternalLink className="h-3.5 w-3.5 text-muted-foreground group-hover:text-primary transition-colors flex-shrink-0" />
                  </motion.a>
                ))}
              </div>
            )}
          </GlassCard>
        </TabsContent>
      </Tabs>
    </div>
  );
}
