import { useState, useEffect, useMemo } from "react";
import { TrendingUp, Instagram, BarChart3, Trophy } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2 } from "lucide-react";
import { getTodayPST } from "@/lib/dateUtils";
import { startOfWeek, subWeeks, format } from "date-fns";
import { useSoundEffects } from "@/hooks/useSoundEffects";
import { GrowthLeaderboard } from "@/components/growth/GrowthLeaderboard";
import { GrowthInputForm } from "@/components/growth/GrowthInputForm";
import { GrowthDeltaCards } from "@/components/growth/GrowthDeltaCards";
import { InstagramDirectory } from "@/components/growth/InstagramDirectory";

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
  const [prevWeekStats, setPrevWeekStats] = useState<GrowthStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [myAgentId, setMyAgentId] = useState<string | null>(null);

  const [formApps, setFormApps] = useState("");
  const [formViews, setFormViews] = useState("");
  const [formFollowers, setFormFollowers] = useState("");
  const [formFollowerCount, setFormFollowerCount] = useState("");

  const todayPST = getTodayPST();
  const weekStart = format(startOfWeek(new Date(todayPST), { weekStartsOn: 1 }), "yyyy-MM-dd");
  const prevWeekStart = format(startOfWeek(subWeeks(new Date(todayPST), 1), { weekStartsOn: 1 }), "yyyy-MM-dd");

  useEffect(() => { fetchData(); }, [user]);

  const fetchData = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const { data: agentData } = await supabase.from("agents").select("id").eq("user_id", user.id).maybeSingle();
      if (agentData) setMyAgentId(agentData.id);

      const { data: managersData } = await supabase.from("agents").select("id, display_name, profile_id").or("is_deactivated.is.null,is_deactivated.eq.false");
      const { data: profiles } = await supabase.from("profiles").select("id, full_name, avatar_url");
      const profileMap = new Map((profiles || []).map(p => [p.id, p]));

      const { data: appsWithIg } = await supabase.from("applications").select("assigned_agent_id, instagram_handle").not("instagram_handle", "is", null);
      const igMap = new Map<string, string>();
      (appsWithIg || []).forEach(a => { if (a.assigned_agent_id && a.instagram_handle) igMap.set(a.assigned_agent_id, a.instagram_handle); });

      const enrichedManagers = (managersData || []).map(m => {
        const profile = m.profile_id ? profileMap.get(m.profile_id) : null;
        return { ...m, full_name: profile?.full_name || m.display_name || "Unknown", avatar_url: profile?.avatar_url || null, instagram_handle: igMap.get(m.id) || null };
      });
      setManagers(enrichedManagers as ManagerProfile[]);

      // Current + previous week stats
      const { data: statsData } = await supabase.from("manager_growth_stats").select("*").gte("stat_date", prevWeekStart);
      const allStats = (statsData || []) as GrowthStat[];
      setWeekStats(allStats.filter(s => s.stat_date >= weekStart));
      setPrevWeekStats(allStats.filter(s => s.stat_date >= prevWeekStart && s.stat_date < weekStart));

      if (agentData) {
        const todayEntry = allStats.find(s => s.agent_id === agentData.id && s.stat_date === todayPST);
        if (todayEntry) {
          setFormApps(String(todayEntry.applications_submitted || 0));
          setFormViews(String(todayEntry.instagram_views || 0));
          setFormFollowers(String(todayEntry.followers_gained || 0));
          setFormFollowerCount(String(todayEntry.follower_count || 0));
        }
      }
    } catch (err) { console.error("Error fetching growth data:", err); }
    finally { setLoading(false); }
  };

  const handleSave = async () => {
    if (!myAgentId) return;
    setSaving(true);
    try {
      const { error } = await supabase.from("manager_growth_stats").upsert({
        agent_id: myAgentId, stat_date: todayPST,
        applications_submitted: parseInt(formApps) || 0, instagram_views: parseInt(formViews) || 0,
        followers_gained: parseInt(formFollowers) || 0, follower_count: parseInt(formFollowerCount) || 0,
      }, { onConflict: "agent_id,stat_date" });
      if (error) throw error;
      toast.success("Growth numbers saved!");
      fetchData();
    } catch (err) { console.error(err); toast.error("Failed to save."); }
    finally { setSaving(false); }
  };

  const leaderboard = useMemo(() => {
    const byManager = new Map<string, { apps: number; views: number; followers: number; latestCount: number }>();
    weekStats.forEach(s => {
      const e = byManager.get(s.agent_id) || { apps: 0, views: 0, followers: 0, latestCount: 0 };
      e.apps += s.applications_submitted; e.views += s.instagram_views; e.followers += s.followers_gained;
      if (s.follower_count > e.latestCount) e.latestCount = s.follower_count;
      byManager.set(s.agent_id, e);
    });
    return Array.from(byManager.entries()).map(([agentId, stats]) => {
      const mgr = managers.find(m => m.id === agentId);
      return { agentId, name: mgr?.full_name || "Unknown", ...stats };
    }).sort((a, b) => b.apps - a.apps);
  }, [weekStats, managers]);

  // Week-over-week aggregates
  const currentWeekAgg = useMemo(() => {
    const agg = { apps: 0, views: 0, followers: 0, latestCount: 0 };
    weekStats.forEach(s => { agg.apps += s.applications_submitted; agg.views += s.instagram_views; agg.followers += s.followers_gained; if (s.follower_count > agg.latestCount) agg.latestCount = s.follower_count; });
    return agg;
  }, [weekStats]);

  const prevWeekAgg = useMemo(() => {
    const agg = { apps: 0, views: 0, followers: 0, latestCount: 0 };
    prevWeekStats.forEach(s => { agg.apps += s.applications_submitted; agg.views += s.instagram_views; agg.followers += s.followers_gained; if (s.follower_count > agg.latestCount) agg.latestCount = s.follower_count; });
    return agg;
  }, [prevWeekStats]);

  const instagramDirectory = useMemo(() => {
    const latestCounts = new Map<string, number>();
    weekStats.forEach(s => { const c = latestCounts.get(s.agent_id) || 0; if (s.follower_count > c) latestCounts.set(s.agent_id, s.follower_count); });
    return managers.filter(m => m.instagram_handle).map(m => ({ ...m, followerCount: latestCounts.get(m.id) || 0 })).sort((a, b) => b.followerCount - a.followerCount);
  }, [managers, weekStats]);

  if (loading) return <div className="flex items-center justify-center min-h-[60vh]"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-6xl mx-auto page-enter">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-accent flex items-center justify-center">
          <TrendingUp className="h-5 w-5 text-primary-foreground" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">Growth Dashboard</h1>
          <p className="text-sm text-muted-foreground">Track team growth metrics & Instagram performance</p>
        </div>
      </div>

      {/* Delta cards always visible */}
      <GrowthDeltaCards currentWeek={currentWeekAgg} previousWeek={prevWeekAgg} />

      <Tabs defaultValue="leaderboard" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="leaderboard" className="flex items-center gap-2"><Trophy className="h-4 w-4" /> Leaderboard</TabsTrigger>
          <TabsTrigger value="input" className="flex items-center gap-2"><BarChart3 className="h-4 w-4" /> Log Numbers</TabsTrigger>
          <TabsTrigger value="instagram" className="flex items-center gap-2"><Instagram className="h-4 w-4" /> Directory</TabsTrigger>
        </TabsList>
        <TabsContent value="leaderboard" className="space-y-4 mt-4">
          <GrowthLeaderboard leaderboard={leaderboard} weekStart={weekStart} />
        </TabsContent>
        <TabsContent value="input" className="space-y-4 mt-4">
          <GrowthInputForm
            todayPST={todayPST} formApps={formApps} setFormApps={setFormApps}
            formViews={formViews} setFormViews={setFormViews} formFollowers={formFollowers}
            setFormFollowers={setFormFollowers} formFollowerCount={formFollowerCount}
            setFormFollowerCount={setFormFollowerCount} saving={saving} onSave={handleSave}
            isAllowed={isAdmin || isManager}
          />
        </TabsContent>
        <TabsContent value="instagram" className="space-y-4 mt-4">
          <InstagramDirectory directory={instagramDirectory} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
