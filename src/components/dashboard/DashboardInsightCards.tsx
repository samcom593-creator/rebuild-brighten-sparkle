import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, BarChart3, BookOpen, TrendingUp, TrendingDown, ArrowRight, DollarSign } from "lucide-react";
import { GlassCard } from "@/components/ui/glass-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { Link } from "react-router-dom";
import { startOfWeek, startOfMonth, subWeeks, format } from "date-fns";
import { cn } from "@/lib/utils";

export function DashboardInsightCards() {
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const now = new Date();
  const weekStart = startOfWeek(now);
  const lastWeekStart = subWeeks(weekStart, 1);
  const monthStart = startOfMonth(now);
  const weekStartStr = format(weekStart, "yyyy-MM-dd");
  const lastWeekStartStr = format(lastWeekStart, "yyyy-MM-dd");
  const monthStartStr = format(monthStart, "yyyy-MM-dd");
  const sevenDaysAgoIso = new Date(Date.now() - 7 * 86400000).toISOString();

  const { data } = useQuery({
    queryKey: ["dashboard-insight-cards-v2", weekStartStr, monthStartStr],
    queryFn: async () => {
      const [
        newContractsRes,
        weeklyAppsRes,
        licenseStagesRes,
        thisWeekProdRes,
        lastWeekProdRes,
        monthProdRes,
      ] = await Promise.all([
        // New contracts this week (real)
        supabase.from("applications")
          .select("id, first_name, last_name, contracted_at", { count: "exact" })
          .not("contracted_at", "is", null)
          .gte("contracted_at", sevenDaysAgoIso)
          .order("contracted_at", { ascending: false })
          .limit(10),
        // Applications this week (active only)
        supabase.from("applications")
          .select("id", { count: "exact", head: true })
          .gte("created_at", sevenDaysAgoIso)
          .is("terminated_at", null),
        // License progress on contracted-but-unlicensed
        supabase.from("applications")
          .select("license_progress")
          .is("terminated_at", null)
          .not("contracted_at", "is", null)
          .neq("license_status", "licensed"),
        // This week ALP
        supabase.from("daily_production").select("aop").gte("production_date", weekStartStr),
        // Last week ALP
        supabase.from("daily_production").select("aop")
          .gte("production_date", lastWeekStartStr).lt("production_date", weekStartStr),
        // Month-to-date ALP
        supabase.from("daily_production").select("aop").gte("production_date", monthStartStr),
      ]);

      const stages = licenseStagesRes.data || [];
      const licenseBreakdown = {
        preCourse: stages.filter((a: any) => !a.license_progress || a.license_progress === "unlicensed").length,
        inCourse: stages.filter((a: any) => a.license_progress === "course_purchased" || a.license_progress === "in_course").length,
        examScheduled: stages.filter((a: any) => a.license_progress === "test_scheduled" || a.license_progress === "exam_scheduled").length,
        passed: stages.filter((a: any) => a.license_progress === "passed_test" || a.license_progress === "exam_passed").length,
        pendingState: stages.filter((a: any) => a.license_progress === "fingerprints_done" || a.license_progress === "waiting_on_license").length,
        total: stages.length,
      };

      const thisWeekAlp = (thisWeekProdRes.data || []).reduce((s: number, r: any) => s + Number(r.aop || 0), 0);
      const lastWeekAlp = (lastWeekProdRes.data || []).reduce((s: number, r: any) => s + Number(r.aop || 0), 0);
      const weekChange = lastWeekAlp > 0
        ? ((thisWeekAlp - lastWeekAlp) / lastWeekAlp) * 100
        : thisWeekAlp > 0 ? 100 : 0;

      const monthlyAlp = (monthProdRes.data || []).reduce((s: number, r: any) => s + Number(r.aop || 0), 0);
      const samEarnings = monthlyAlp * 0.03; // 3% override

      return {
        newContractsCount: newContractsRes.count ?? newContractsRes.data?.length ?? 0,
        newContractsTop5: (newContractsRes.data || []).slice(0, 5).map((a: any) => ({
          name: `${a.first_name} ${a.last_name}`,
          when: a.contracted_at ? formatRelative(a.contracted_at) : "",
        })),
        weeklyAppsCount: weeklyAppsRes.count || 0,
        licenseBreakdown,
        thisWeekAlp,
        lastWeekAlp,
        weekChange: Math.round(weekChange),
        monthlyAlp,
        samEarnings,
      };
    },
    staleTime: 120000,
  });

  if (!data) return null;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
      {/* New Contracts This Week */}
      <GlassCard className="p-4">
        <div className="flex items-center gap-2 mb-2">
          <CheckCircle2 className="h-4 w-4 text-emerald-400" />
          <h4 className="font-semibold text-sm">New Contracts This Week</h4>
          <Badge variant="outline" className="ml-auto text-xs text-emerald-400 border-emerald-500/30">
            {data.newContractsCount}
          </Badge>
        </div>
        <div className="space-y-1 mb-2 min-h-[80px]">
          {data.newContractsTop5.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">No new contracts yet this week</p>
          ) : (
            data.newContractsTop5.map((a, i) => (
              <div key={i} className="flex justify-between text-xs">
                <span className="text-muted-foreground truncate">{a.name}</span>
                <span className="text-emerald-400">{a.when}</span>
              </div>
            ))
          )}
        </div>
        <Link to="/dashboard/crm">
          <Button variant="outline" size="sm" className="w-full text-xs">
            View Contracts <ArrowRight className="h-3 w-3 ml-1" />
          </Button>
        </Link>
      </GlassCard>

      {/* Revenue This Month */}
      <GlassCard className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <DollarSign className="h-4 w-4 text-emerald-400" />
          <h4 className="font-semibold text-sm">Revenue This Month</h4>
          <Badge variant="outline" className="ml-auto text-xs text-muted-foreground">MTD</Badge>
        </div>
        <div className="space-y-2">
          <div>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Team ALP</p>
            <p className="text-2xl font-bold text-emerald-400">${data.monthlyAlp.toLocaleString()}</p>
          </div>
          <div>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Estimated Override (3%)</p>
            <p className="text-base font-semibold">${Math.round(data.samEarnings).toLocaleString()}</p>
          </div>
        </div>
      </GlassCard>

      {/* License Progress */}
      <GlassCard className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <BookOpen className="h-4 w-4 text-blue-400" />
          <h4 className="font-semibold text-sm">License Progress</h4>
          <Badge variant="outline" className="ml-auto text-xs">{data.licenseBreakdown.total} contracted</Badge>
        </div>
        <div className="space-y-2">
          {[
            { label: "Pre-Course", count: data.licenseBreakdown.preCourse, color: "bg-slate-400" },
            { label: "In Course", count: data.licenseBreakdown.inCourse, color: "bg-blue-400" },
            { label: "Exam Scheduled", count: data.licenseBreakdown.examScheduled, color: "bg-amber-400" },
            { label: "Passed", count: data.licenseBreakdown.passed, color: "bg-emerald-400" },
            { label: "Pending State", count: data.licenseBreakdown.pendingState, color: "bg-violet-400" },
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
          <Badge variant="outline" className="ml-auto text-xs text-muted-foreground">
            {data.weeklyAppsCount} apps
          </Badge>
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

function formatRelative(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  return `${days}d ago`;
}
