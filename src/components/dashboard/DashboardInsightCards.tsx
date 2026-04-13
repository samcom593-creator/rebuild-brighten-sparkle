import { useQuery } from "@tanstack/react-query";
import { AlertCircle, BarChart3, BookOpen, TrendingUp, TrendingDown, ArrowRight } from "lucide-react";
import { GlassCard } from "@/components/ui/glass-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { Link } from "react-router-dom";
import { startOfWeek, subWeeks, format } from "date-fns";
import { cn } from "@/lib/utils";

export function DashboardInsightCards() {
  const now = new Date();
  const weekStart = startOfWeek(now);
  const lastWeekStart = subWeeks(weekStart, 1);
  const weekStartStr = format(weekStart, "yyyy-MM-dd");
  const lastWeekStartStr = format(lastWeekStart, "yyyy-MM-dd");

  const { data } = useQuery({
    queryKey: ["dashboard-insight-cards", weekStartStr],
    queryFn: async () => {
      const [unreachedRes, agentsRes, recentProdRes, appsRes, thisWeekProdRes, lastWeekProdRes] = await Promise.all([
        // Unreached applicants (no contact)
        supabase.from("applications").select("id, first_name, last_name, created_at")
          .is("contacted_at", null).is("terminated_at", null).eq("status", "new").order("created_at", { ascending: true }).limit(10),
        // All active agents
        supabase.from("agents").select("id, display_name, profile_id").eq("is_deactivated", false),
        // Recent production (last 3 days)
        supabase.from("daily_production").select("agent_id")
          .gte("production_date", format(new Date(Date.now() - 3 * 86400000), "yyyy-MM-dd")),
        // License progress
        supabase.from("applications").select("license_status, license_progress")
          .is("terminated_at", null).eq("license_status", "unlicensed"),
        // This week ALP
        supabase.from("daily_production").select("aop").gte("production_date", weekStartStr),
        // Last week ALP
        supabase.from("daily_production").select("aop")
          .gte("production_date", lastWeekStartStr).lt("production_date", weekStartStr),
      ]);

      const unreached = unreachedRes.data || [];
      const urgentCount = unreached.filter(a => {
        const days = (Date.now() - new Date(a.created_at).getTime()) / 86400000;
        return days >= 3;
      }).length;

      const activeAgentIds = new Set((recentProdRes.data || []).map((p: any) => p.agent_id));
      const notLogging = (agentsRes.data || []).filter((a: any) => !activeAgentIds.has(a.id));

      const licenseBreakdown = {
        studying: (appsRes.data || []).filter((a: any) => a.license_progress === "studying").length,
        examScheduled: (appsRes.data || []).filter((a: any) => a.license_progress === "exam_scheduled").length,
        inCourse: (appsRes.data || []).filter((a: any) => a.license_progress === "in_course" || a.license_progress === "pre_licensing").length,
        total: (appsRes.data || []).length,
      };

      const thisWeekAlp = (thisWeekProdRes.data || []).reduce((s: number, r: any) => s + Number(r.aop || 0), 0);
      const lastWeekAlp = (lastWeekProdRes.data || []).reduce((s: number, r: any) => s + Number(r.aop || 0), 0);
      const weekChange = lastWeekAlp > 0 ? ((thisWeekAlp - lastWeekAlp) / lastWeekAlp) * 100 : thisWeekAlp > 0 ? 100 : 0;

      return {
        unreachedCount: unreached.length,
        urgentCount,
        unreachedTop5: unreached.slice(0, 5).map(a => ({
          name: `${a.first_name} ${a.last_name}`,
          days: Math.floor((Date.now() - new Date(a.created_at).getTime()) / 86400000),
        })),
        notLoggingCount: notLogging.length,
        notLoggingNames: notLogging.slice(0, 5).map((a: any) => a.display_name || "Agent"),
        licenseBreakdown,
        thisWeekAlp,
        lastWeekAlp,
        weekChange: Math.round(weekChange),
      };
    },
    staleTime: 120000,
  });

  if (!data) return null;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
      {/* Unreached Applicants */}
      <GlassCard className={cn("p-4", data.urgentCount > 0 && "border-red-500/30")}>
        <div className="flex items-center gap-2 mb-2">
          <AlertCircle className={cn("h-4 w-4", data.urgentCount > 0 ? "text-red-400" : "text-amber-400")} />
          <h4 className="font-semibold text-sm">Unreached Applicants</h4>
          <Badge variant="outline" className={cn("ml-auto text-xs",
            data.urgentCount > 0 ? "text-red-400 border-red-500/30" : "text-muted-foreground"
          )}>
            {data.unreachedCount}
          </Badge>
        </div>
        <div className="space-y-1 mb-2">
          {data.unreachedTop5.map((a, i) => (
            <div key={i} className="flex justify-between text-xs">
              <span className="text-muted-foreground truncate">{a.name}</span>
              <span className={cn(a.days >= 3 ? "text-red-400 font-bold" : "text-muted-foreground")}>
                {a.days}d waiting
              </span>
            </div>
          ))}
        </div>
        <Link to="/dashboard/crm">
          <Button variant="outline" size="sm" className="w-full text-xs">
            View All <ArrowRight className="h-3 w-3 ml-1" />
          </Button>
        </Link>
      </GlassCard>

      {/* Agents Not Logging */}
      <GlassCard className="p-4">
        <div className="flex items-center gap-2 mb-2">
          <BarChart3 className="h-4 w-4 text-amber-400" />
          <h4 className="font-semibold text-sm">Not Logging (3+ Days)</h4>
          <Badge variant="outline" className="ml-auto text-xs text-amber-400 border-amber-500/30">
            {data.notLoggingCount}
          </Badge>
        </div>
        <div className="space-y-1 mb-2">
          {data.notLoggingNames.map((name, i) => (
            <p key={i} className="text-xs text-muted-foreground truncate">{name}</p>
          ))}
          {data.notLoggingCount > 5 && (
            <p className="text-xs text-muted-foreground">+{data.notLoggingCount - 5} more</p>
          )}
        </div>
        <Link to="/dashboard/crm">
          <Button variant="outline" size="sm" className="w-full text-xs">
            View in CRM <ArrowRight className="h-3 w-3 ml-1" />
          </Button>
        </Link>
      </GlassCard>

      {/* License Progress */}
      <GlassCard className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <BookOpen className="h-4 w-4 text-blue-400" />
          <h4 className="font-semibold text-sm">License Progress</h4>
          <Badge variant="outline" className="ml-auto text-xs">{data.licenseBreakdown.total} unlicensed</Badge>
        </div>
        <div className="space-y-2">
          {[
            { label: "In Course", count: data.licenseBreakdown.inCourse, color: "bg-blue-400" },
            { label: "Studying", count: data.licenseBreakdown.studying, color: "bg-amber-400" },
            { label: "Exam Scheduled", count: data.licenseBreakdown.examScheduled, color: "bg-emerald-400" },
          ].map(item => (
            <div key={item.label} className="flex items-center gap-2 text-xs">
              <div className={cn("h-2 w-2 rounded-full", item.color)} />
              <span className="text-muted-foreground flex-1">{item.label}</span>
              <span className="font-bold">{item.count}</span>
            </div>
          ))}
        </div>
      </GlassCard>

      {/* This Week vs Last Week */}
      <GlassCard className="p-4">
        <div className="flex items-center gap-2 mb-3">
          {data.weekChange >= 0 ? (
            <TrendingUp className="h-4 w-4 text-emerald-400" />
          ) : (
            <TrendingDown className="h-4 w-4 text-red-400" />
          )}
          <h4 className="font-semibold text-sm">Week vs Week</h4>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-[10px] text-muted-foreground">This Week</p>
            <p className="text-xl font-bold">${data.thisWeekAlp.toLocaleString()}</p>
          </div>
          <div>
            <p className="text-[10px] text-muted-foreground">Last Week</p>
            <p className="text-xl font-bold text-muted-foreground">${data.lastWeekAlp.toLocaleString()}</p>
          </div>
        </div>
        <div className="mt-2 text-center">
          <Badge variant="outline" className={cn("text-sm font-bold",
            data.weekChange >= 0 ? "text-emerald-400 border-emerald-500/30" : "text-red-400 border-red-500/30"
          )}>
            {data.weekChange >= 0 ? "↑" : "↓"} {Math.abs(data.weekChange)}%
          </Badge>
        </div>
      </GlassCard>
    </div>
  );
}
