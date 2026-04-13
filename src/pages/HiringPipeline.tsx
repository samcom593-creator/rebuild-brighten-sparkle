import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Users, Clock, TrendingUp, AlertTriangle, CheckCircle, ArrowRight,
  Zap, Timer, BarChart3, UserX, Phone, RefreshCw,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { GlassCard } from "@/components/ui/glass-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { differenceInDays, differenceInHours, format } from "date-fns";

// Stage definitions with targets
const PIPELINE_STAGES = [
  { key: "new", label: "Applied", targetDays: 0 },
  { key: "contacted", label: "Called", targetDays: 1 },
  { key: "contracted", label: "Contracted", targetDays: 3 },
  { key: "course_purchased", label: "In Course", targetDays: 7 },
  { key: "finished_course", label: "Course Done", targetDays: 21 },
  { key: "licensed", label: "Licensed", targetDays: 30 },
  { key: "in_field_training", label: "Field Training", targetDays: 35 },
  { key: "evaluated", label: "Live", targetDays: 42 },
] as const;

function avgDays(items: any[], startField: string, endField: string): number {
  const valid = items.filter(i => i[startField] && i[endField]);
  if (valid.length === 0) return 0;
  const totalDays = valid.reduce((sum, i) => {
    return sum + differenceInDays(new Date(i[endField]), new Date(i[startField]));
  }, 0);
  return Math.round((totalDays / valid.length) * 10) / 10;
}

export default function HiringPipelineCenter() {
  const { user, isAdmin } = useAuth();

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["hiring-pipeline-center"],
    queryFn: async () => {
      const [appsRes, agentsRes, managersRes] = await Promise.all([
        supabase.from("applications").select("*").is("terminated_at", null).order("created_at", { ascending: false }),
        supabase.from("agents").select("id, user_id, invited_by_manager_id, is_deactivated, display_name, profiles!agents_profile_id_fkey(full_name)").eq("is_deactivated", false),
        supabase.from("user_roles").select("user_id").eq("role", "manager"),
      ]);
      return {
        apps: (appsRes.data || []) as any[],
        agents: (agentsRes.data || []) as any[],
        managerUserIds: (managersRes.data || []).map((m: any) => m.user_id),
      };
    },
    enabled: !!user && isAdmin,
    staleTime: 60000,
  });

  const apps = data?.apps || [];
  const agents = data?.agents || [];
  const managerUserIds = data?.managerUserIds || [];

  // Top metrics
  const totalInPipeline = apps.length;
  const thisWeekApps = apps.filter(a => differenceInDays(new Date(), new Date(a.created_at)) <= 7).length;
  const thisWeekLicensed = apps.filter(a => a.licensed_at && differenceInDays(new Date(), new Date(a.licensed_at)) <= 7).length;
  const stalledApps = apps.filter(a => {
    const lastUpdate = a.last_response_at || a.updated_at || a.created_at;
    return differenceInDays(new Date(), new Date(lastUpdate)) >= 7;
  });
  const conversionRate = apps.length > 0 
    ? Math.round((apps.filter(a => a.license_status === "licensed").length / apps.length) * 100) 
    : 0;
  const avgDaysToLicense = avgDays(apps.filter(a => a.licensed_at), "created_at", "licensed_at");

  // Pipeline stages counts
  const stageCounts = useMemo(() => {
    const counts: Record<string, any[]> = {};
    PIPELINE_STAGES.forEach(s => counts[s.key] = []);
    
    apps.forEach(app => {
      if (app.license_progress === "licensed" || app.license_status === "licensed") {
        if (app.license_approved_at) counts["licensed"].push(app);
        else counts["licensed"].push(app);
      } else if (app.license_progress === "finished_course" || app.license_progress === "passed_test") {
        counts["finished_course"].push(app);
      } else if (app.license_progress === "course_purchased") {
        counts["course_purchased"].push(app);
      } else if (app.contracted_at) {
        counts["contracted"].push(app);
      } else if (app.contacted_at) {
        counts["contacted"].push(app);
      } else {
        counts["new"].push(app);
      }
    });
    return counts;
  }, [apps]);

  // Speed-to-contact metrics
  const speedMetrics = useMemo(() => {
    const contacted = apps.filter(a => a.first_contact_attempt_at);
    const avgHours = contacted.length > 0
      ? contacted.reduce((sum, a) => sum + differenceInHours(new Date(a.first_contact_attempt_at), new Date(a.created_at)), 0) / contacted.length
      : 0;
    const waiting24h = apps.filter(a => !a.first_contact_attempt_at && differenceInHours(new Date(), new Date(a.created_at)) >= 24).length;
    return { avgHours: Math.round(avgHours * 10) / 10, waiting24h };
  }, [apps]);

  // Manager capacity
  const managerCapacity = useMemo(() => {
    const managerAgents = agents.filter(a => managerUserIds.includes(a.user_id));
    return managerAgents.map(mgr => {
      const teamSize = agents.filter(a => a.invited_by_manager_id === mgr.id).length;
      const pipelineCount = apps.filter(a => a.assigned_agent_id === mgr.id && !a.contracted_at).length;
      const total = teamSize + pipelineCount;
      const name = (mgr as any).profiles?.full_name || mgr.display_name || "Unknown";
      return { id: mgr.id, name, teamSize, pipelineCount, total, maxRecruits: 15 };
    }).sort((a, b) => b.total - a.total);
  }, [agents, apps, managerUserIds]);

  // Source quality
  const sourceStats = useMemo(() => {
    const grouped: Record<string, { total: number; contracted: number; licensed: number }> = {};
    apps.forEach(app => {
      const src = app.referral_source || "Direct / Unknown";
      if (!grouped[src]) grouped[src] = { total: 0, contracted: 0, licensed: 0 };
      grouped[src].total++;
      if (app.contracted_at) grouped[src].contracted++;
      if (app.license_status === "licensed") grouped[src].licensed++;
    });
    return Object.entries(grouped)
      .map(([source, stats]) => ({
        source,
        ...stats,
        convRate: stats.total > 0 ? Math.round((stats.contracted / stats.total) * 100) : 0,
        licenseRate: stats.contracted > 0 ? Math.round((stats.licensed / stats.contracted) * 100) : 0,
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 8);
  }, [apps]);

  // Pipeline speed report
  const pipelineSpeed = useMemo(() => ({
    applied_to_contacted: avgDays(apps, "created_at", "contacted_at"),
    contacted_to_contracted: avgDays(apps, "contacted_at", "contracted_at"),
    contracted_to_course: avgDays(apps, "contracted_at", "course_purchased_at"),
    course_to_licensed: avgDays(apps.filter(a => a.course_purchased_at && a.licensed_at), "course_purchased_at", "licensed_at"),
    licensed_to_first_deal: avgDays(apps.filter(a => a.licensed_at && a.first_deal_at), "licensed_at", "first_deal_at"),
  }), [apps]);

  // Ghosted & duplicates
  const ghostedCount = apps.filter(a => a.is_ghosted).length;
  const duplicateCount = apps.filter(a => a.is_duplicate).length;

  if (isLoading) {
    return <div className="p-6 text-center text-muted-foreground">Loading pipeline data...</div>;
  }

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Hiring Pipeline</h1>
          <p className="text-sm text-muted-foreground">Full funnel visibility — every hole, every metric</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4 mr-1" /> Refresh
        </Button>
      </div>

      {/* Top Metrics Bar */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          { label: "In Pipeline", value: totalInPipeline, icon: Users, color: "text-blue-400" },
          { label: "Avg Days to License", value: avgDaysToLicense || "—", icon: Timer, color: "text-amber-400" },
          { label: "Conversion Rate", value: `${conversionRate}%`, icon: TrendingUp, color: "text-emerald-400" },
          { label: "New This Week", value: thisWeekApps, icon: Zap, color: "text-violet-400" },
          { label: "Licensed This Week", value: thisWeekLicensed, icon: CheckCircle, color: "text-green-400" },
          { label: "Stalled (7+ days)", value: stalledApps.length, icon: AlertTriangle, color: stalledApps.length > 5 ? "text-red-400" : "text-amber-400" },
        ].map((m, i) => (
          <GlassCard key={i} className="p-3 text-center">
            <m.icon className={cn("h-5 w-5 mx-auto mb-1", m.color)} />
            <p className="text-xl font-bold text-foreground">{m.value}</p>
            <p className="text-xs text-muted-foreground">{m.label}</p>
          </GlassCard>
        ))}
      </div>

      {/* Alert Badges */}
      <div className="flex flex-wrap gap-2">
        {ghostedCount > 0 && (
          <Badge variant="destructive" className="text-xs">👻 {ghostedCount} Ghosted Applicants</Badge>
        )}
        {duplicateCount > 0 && (
          <Badge className="text-xs bg-amber-500/20 text-amber-400 border-amber-500/30">🔄 {duplicateCount} Duplicates</Badge>
        )}
        {speedMetrics.waiting24h > 0 && (
          <Badge variant="destructive" className="text-xs">⏰ {speedMetrics.waiting24h} Waiting 24h+ Uncalled</Badge>
        )}
      </div>

      {/* Pipeline Funnel */}
      <GlassCard className="p-4">
        <h2 className="text-lg font-semibold text-foreground mb-4">Pipeline Funnel</h2>
        <div className="flex items-center gap-1 overflow-x-auto pb-2">
          {PIPELINE_STAGES.map((stage, i) => {
            const count = stageCounts[stage.key]?.length || 0;
            const stuckCount = (stageCounts[stage.key] || []).filter(a => {
              const lastUpdate = a.last_response_at || a.updated_at || a.created_at;
              return differenceInDays(new Date(), new Date(lastUpdate)) >= 7;
            }).length;
            return (
              <div key={stage.key} className="flex items-center">
                <div className="min-w-[90px] text-center">
                  <div className="text-2xl font-bold text-foreground">{count}</div>
                  <div className="text-xs text-muted-foreground">{stage.label}</div>
                  {stuckCount > 0 && (
                    <div className="text-xs text-red-400 mt-1">{stuckCount} stuck</div>
                  )}
                </div>
                {i < PIPELINE_STAGES.length - 1 && (
                  <ArrowRight className="h-4 w-4 text-muted-foreground flex-shrink-0 mx-1" />
                )}
              </div>
            );
          })}
        </div>
      </GlassCard>

      <div className="grid md:grid-cols-2 gap-4">
        {/* Speed-to-Contact */}
        <GlassCard className="p-4">
          <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
            <Phone className="h-4 w-4 text-blue-400" /> Speed-to-Contact
          </h3>
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">Avg Hours to First Contact</span>
              <span className={cn("text-lg font-bold", speedMetrics.avgHours < 4 ? "text-green-400" : speedMetrics.avgHours < 24 ? "text-amber-400" : "text-red-400")}>
                {speedMetrics.avgHours}h
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">Uncalled 24h+</span>
              <span className={cn("text-lg font-bold", speedMetrics.waiting24h > 0 ? "text-red-400" : "text-green-400")}>
                {speedMetrics.waiting24h}
              </span>
            </div>
            <div className="text-xs text-muted-foreground">Target: &lt;4 hours | Top performers: &lt;2 hours</div>
          </div>
        </GlassCard>

        {/* Pipeline Speed Report */}
        <GlassCard className="p-4">
          <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-violet-400" /> Pipeline Speed (Avg Days)
          </h3>
          <div className="space-y-2">
            {[
              { label: "Applied → Called", val: pipelineSpeed.applied_to_contacted, target: 1 },
              { label: "Called → Contracted", val: pipelineSpeed.contacted_to_contracted, target: 3 },
              { label: "Contracted → Course", val: pipelineSpeed.contracted_to_course, target: 1 },
              { label: "Course → Licensed", val: pipelineSpeed.course_to_licensed, target: 14 },
              { label: "Licensed → First Deal", val: pipelineSpeed.licensed_to_first_deal, target: 7 },
            ].map((row, i) => (
              <div key={i} className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{row.label}</span>
                <div className="flex items-center gap-2">
                  <span className={cn("font-semibold", row.val <= row.target ? "text-green-400" : row.val <= row.target * 2 ? "text-amber-400" : "text-red-400")}>
                    {row.val || "—"} days
                  </span>
                  <span className="text-xs text-muted-foreground">(target: {row.target}d)</span>
                </div>
              </div>
            ))}
          </div>
        </GlassCard>

        {/* Manager Capacity */}
        <GlassCard className="p-4">
          <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
            <Users className="h-4 w-4 text-emerald-400" /> Manager Capacity
          </h3>
          <div className="space-y-3">
            {managerCapacity.slice(0, 6).map(mgr => (
              <div key={mgr.id}>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-foreground font-medium truncate">{mgr.name}</span>
                  <span className={cn("text-xs font-semibold",
                    mgr.total <= 10 ? "text-green-400" : mgr.total <= 15 ? "text-amber-400" : "text-red-400"
                  )}>
                    {mgr.total}/{mgr.maxRecruits}
                  </span>
                </div>
                <Progress 
                  value={Math.min((mgr.total / mgr.maxRecruits) * 100, 100)} 
                  className="h-2"
                />
              </div>
            ))}
            {managerCapacity.length === 0 && (
              <p className="text-xs text-muted-foreground">No managers found</p>
            )}
          </div>
        </GlassCard>

        {/* Source Quality */}
        <GlassCard className="p-4">
          <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-amber-400" /> Source Quality
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-muted-foreground text-xs">
                  <th className="text-left pb-2">Source</th>
                  <th className="text-right pb-2">Apps</th>
                  <th className="text-right pb-2">Conv%</th>
                  <th className="text-right pb-2">Lic%</th>
                </tr>
              </thead>
              <tbody>
                {sourceStats.map((s, i) => (
                  <tr key={i} className="border-t border-border/30">
                    <td className="py-1.5 text-foreground truncate max-w-[120px]">{s.source}</td>
                    <td className="py-1.5 text-right text-muted-foreground">{s.total}</td>
                    <td className="py-1.5 text-right">
                      <span className={cn(s.convRate >= 30 ? "text-green-400" : s.convRate >= 15 ? "text-amber-400" : "text-red-400")}>
                        {s.convRate}%
                      </span>
                    </td>
                    <td className="py-1.5 text-right">
                      <span className={cn(s.licenseRate >= 50 ? "text-green-400" : s.licenseRate >= 25 ? "text-amber-400" : "text-muted-foreground")}>
                        {s.licenseRate}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </GlassCard>
      </div>
    </div>
  );
}
