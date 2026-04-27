import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, BookOpen, TrendingUp, TrendingDown, ArrowRight, DollarSign } from "lucide-react";
import { GlassCard } from "@/components/ui/glass-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Link } from "react-router-dom";
import { startOfWeek, startOfMonth, subWeeks, format } from "date-fns";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export function DashboardInsightCards() {
  const { user } = useAuth();
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const [hiresDialogOpen, setHiresDialogOpen] = useState(false);

  const now = new Date();
  const weekStart = startOfWeek(now, { weekStartsOn: 1 });
  const lastWeekStart = subWeeks(weekStart, 1);
  const monthStart = startOfMonth(now);

  // Matched-range: only pull last-week production through the same weekday as today
  const daysIntoWeek = Math.max(1, Math.min(7, Math.floor((now.getTime() - weekStart.getTime()) / 86400000) + 1));
  const lastWeekMatchedEnd = new Date(lastWeekStart);
  lastWeekMatchedEnd.setDate(lastWeekMatchedEnd.getDate() + daysIntoWeek);

  const weekStartStr = format(weekStart, "yyyy-MM-dd");
  const lastWeekStartStr = format(lastWeekStart, "yyyy-MM-dd");
  const lastWeekMatchedEndStr = format(lastWeekMatchedEnd, "yyyy-MM-dd");
  const monthStartStr = format(monthStart, "yyyy-MM-dd");

  const { data } = useQuery({
    queryKey: ["dashboard-insight-cards-v5-deals", weekStartStr, monthStartStr, user?.id],
    queryFn: async () => {
      // Per-agent revenue estimate (uses contract % + override rate from view)
      let estimate: any = null;
      if (user?.id) {
        const { data: agentRow } = await supabase.from("agents").select("id").eq("user_id", user.id).maybeSingle();
        const myAgentId = agentRow?.id;
        if (myAgentId) {
          const r = await supabase.from("agent_revenue_estimate" as any).select("*").eq("agent_id", myAgentId).maybeSingle();
          estimate = r.data;
        }
      }
      const [
        newContractsRes,
        weeklyAppsRes,
        licenseStagesRes,
        thisWeekProdRes,
        lastWeekProdRes,
        monthProdRes,
        insuracloudRes,
      ] = await Promise.all([
        // New hires this week (Monday-start)
        supabase.from("applications")
          .select("id, first_name, last_name, contracted_at", { count: "exact" })
          .not("contracted_at", "is", null)
          .gte("contracted_at", weekStart.toISOString())
          .order("contracted_at", { ascending: false })
          .limit(500),
        // Applications this week (Monday-start)
        supabase.from("applications")
          .select("id", { count: "exact", head: true })
          .gte("created_at", weekStart.toISOString())
          .is("terminated_at", null),
        // License progress across EVERY active applicant (not just contracted)
        supabase.from("applications")
          .select("license_progress, license_status")
          .is("terminated_at", null)
          .neq("license_status", "licensed"),
        // This week ALP — submitted/active only, exclude cancelled/lapsed
        supabase.from("deals").select("annual_premium")
          .gte("effective_date", weekStartStr)
          .in("status", ["submitted", "active"]),
        // Last week ALP — same day-of-week range
        supabase.from("deals").select("annual_premium")
          .gte("effective_date", lastWeekStartStr).lt("effective_date", lastWeekMatchedEndStr)
          .in("status", ["submitted", "active"]),
        // Month-to-date ALP
        supabase.from("deals").select("annual_premium")
          .gte("effective_date", monthStartStr)
          .in("status", ["submitted", "active"]),
        // Insuracloud snapshots (real commissions)
        supabase.from("insuracloud_snapshots" as any)
          .select("*")
          .order("snapshot_date", { ascending: false })
          .limit(200),
      ]);

      const stages = licenseStagesRes.data || [];
      const licenseBreakdown = {
        preCourse: stages.filter((a: any) =>
          !a.license_progress
          || a.license_progress === "unlicensed"
          || a.license_progress === "not_started"
          || a.license_progress === "applied"
        ).length,
        inCourse: stages.filter((a: any) =>
          a.license_progress === "course_purchased"
          || a.license_progress === "in_course"
          || a.license_progress === "studying"
        ).length,
        examScheduled: stages.filter((a: any) =>
          a.license_progress === "test_scheduled"
          || a.license_progress === "exam_scheduled"
        ).length,
        passed: stages.filter((a: any) =>
          a.license_progress === "passed_test"
          || a.license_progress === "exam_passed"
          || a.license_progress === "test_passed"
        ).length,
        pendingState: stages.filter((a: any) =>
          a.license_progress === "fingerprints_done"
          || a.license_progress === "waiting_on_license"
          || a.license_progress === "pending_state"
        ).length,
        total: stages.length,
      };

      const thisWeekAlp = (thisWeekProdRes.data || []).reduce((s: number, r: any) => s + Number(r.annual_premium || 0), 0);
      const lastWeekAlp = (lastWeekProdRes.data || []).reduce((s: number, r: any) => s + Number(r.annual_premium || 0), 0);
      const weekChange = lastWeekAlp > 0
        ? ((thisWeekAlp - lastWeekAlp) / lastWeekAlp) * 100
        : thisWeekAlp > 0 ? 100 : 0;

      // Insuracloud-backed real commissions (latest per agent)
      const icSnaps = (insuracloudRes.data || []) as any[];
      const seenAgents = new Set<string>();
      const latest: any[] = [];
      for (const s of icSnaps) {
        if (!s?.agent_id || seenAgents.has(s.agent_id)) continue;
        seenAgents.add(s.agent_id);
        latest.push(s);
      }
      const teamMtd = latest.reduce((sum, s) => sum + Number(s.mtd_earnings || 0), 0);
      const teamDirect = latest.reduce((sum, s) => sum + Number(s.direct_commissions || 0), 0);
      const teamOverride = latest.reduce((sum, s) => sum + Number(s.override_commissions || 0), 0);

      const monthlyAlp = (monthProdRes.data || []).reduce((s: number, r: any) => s + Number(r.annual_premium || 0), 0);
      // 9-month advance × 65% comp avg × 75% persistency ≈ 31.5%
      const estimatedFromAlp = monthlyAlp * 0.315;

      return {
        newContractsCount: newContractsRes.count ?? newContractsRes.data?.length ?? 0,
        newContractsTop5: (newContractsRes.data || []).slice(0, 5).map((a: any) => ({
          name: `${a.first_name} ${a.last_name}`,
          when: a.contracted_at ? formatRelative(a.contracted_at) : "",
        })),
        newContractsAll: (newContractsRes.data || []).map((a: any) => ({
          id: a.id,
          name: `${a.first_name} ${a.last_name}`,
          when: a.contracted_at ? formatRelative(a.contracted_at) : "",
          contractedAt: a.contracted_at,
        })),
        weeklyAppsCount: weeklyAppsRes.count || 0,
        licenseBreakdown,
        thisWeekAlp,
        lastWeekAlp,
        weekChange: Math.round(weekChange),
        monthlyAlp,
        teamMtd,
        teamDirect,
        teamOverride,
        estimatedFromAlp,
        estimate,
      };
    },
    staleTime: 60_000,
    refetchInterval: 60_000,
  });

  if (!data) return null;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
      {/* New Hires This Week — clickable */}
      <GlassCard
        className="p-4 cursor-pointer hover:ring-2 hover:ring-emerald-500/30 transition-all"
        onClick={() => setHiresDialogOpen(true)}
      >
        <div className="flex items-center gap-2 mb-2">
          <CheckCircle2 className="h-4 w-4 text-emerald-400" />
          <h4 className="font-semibold text-sm">New Hires This Week</h4>
          <Badge variant="outline" className="ml-auto text-xs text-emerald-400 border-emerald-500/30">
            {data.newContractsCount}
          </Badge>
        </div>
        <div className="space-y-1 mb-2 min-h-[80px]">
          {data.newContractsTop5.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">No new hires yet this week</p>
          ) : (
            data.newContractsTop5.map((a, i) => (
              <div key={i} className="flex justify-between text-xs">
                <span className="text-muted-foreground truncate">{a.name}</span>
                <span className="text-emerald-400">{a.when}</span>
              </div>
            ))
          )}
        </div>
        <Button variant="outline" size="sm" className="w-full text-xs pointer-events-none">
          Tap to view all {data.newContractsCount} <ArrowRight className="h-3 w-3 ml-1" />
        </Button>
      </GlassCard>

      <Dialog open={hiresDialogOpen} onOpenChange={setHiresDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New Hires This Week ({data.newContractsCount})</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            {data.newContractsAll && data.newContractsAll.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-8">No hires this week yet.</p>
            )}
            {data.newContractsAll?.map((a: any) => (
              <Link
                key={a.id}
                to={`/dashboard/applicants?id=${a.id}`}
                className="flex items-center justify-between p-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition"
              >
                <div>
                  <p className="font-medium text-sm">{a.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {a.contractedAt ? new Date(a.contractedAt).toLocaleDateString() : "—"}
                  </p>
                </div>
                <Badge variant="outline" className="text-emerald-400 border-emerald-500/30">{a.when}</Badge>
              </Link>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* Revenue This Month — real Insuracloud or proper tiered estimate */}
      <GlassCard className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <DollarSign className="h-4 w-4 text-emerald-400" />
          <h4 className="font-semibold text-sm">Revenue This Month</h4>
          <Badge variant="outline" className="ml-auto text-xs text-muted-foreground">
            {data.estimate?.insuracloud_mtd ? "InsuraCloud Live" : "Estimate"}
          </Badge>
        </div>

        {data.estimate?.insuracloud_mtd ? (
          <div className="space-y-2">
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide">My MTD Commissions</p>
              <p className="text-2xl font-bold text-emerald-400">
                ${Math.round(Number(data.estimate.insuracloud_mtd)).toLocaleString()}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs pt-2 border-t border-border/50">
              <div>
                <p className="text-muted-foreground">Direct</p>
                <p className="font-semibold">${Math.round(Number(data.estimate.insuracloud_direct || 0)).toLocaleString()}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Override</p>
                <p className="font-semibold">${Math.round(Number(data.estimate.insuracloud_override || 0)).toLocaleString()}</p>
              </div>
            </div>
          </div>
        ) : data.estimate ? (
          <div className="space-y-2">
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Estimated MTD</p>
              <p className="text-2xl font-bold text-emerald-400">
                ${Math.round(Number(data.estimate.personal_monthly_estimate) + Number(data.estimate.override_monthly_estimate)).toLocaleString()}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs pt-2 border-t border-border/50">
              <div>
                <p className="text-muted-foreground">Personal (est.)</p>
                <p className="font-semibold">${Math.round(Number(data.estimate.personal_monthly_estimate)).toLocaleString()}</p>
                <p className="text-[10px] text-muted-foreground">
                  ALP ${Number(data.estimate.personal_monthly_alp || 0).toLocaleString()} × {data.estimate.contract_pct}% × 9mo × 75%
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Override (est.)</p>
                <p className="font-semibold">${Math.round(Number(data.estimate.override_monthly_estimate)).toLocaleString()}</p>
                <p className="text-[10px] text-muted-foreground">
                  Team ALP ${Number(data.estimate.downline_monthly_alp || 0).toLocaleString()} × {Math.round(Number(data.estimate.override_rate || 0) * 100)}%
                </p>
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground pt-1">
              Estimate — will show live InsuraCloud data once sync completes
            </p>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground italic py-2">No data yet</p>
        )}
      </GlassCard>

      {/* License Progress — clickable stages */}
      <GlassCard className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <BookOpen className="h-4 w-4 text-blue-400" />
          <h4 className="font-semibold text-sm">License Progress</h4>
          <Badge variant="outline" className="ml-auto text-xs">{data.licenseBreakdown.total} active</Badge>
        </div>
        <div className="space-y-1">
          {[
            { label: "Pre-Course",     count: data.licenseBreakdown.preCourse,      filterKey: "pre_course",      color: "bg-slate-400" },
            { label: "In Course",      count: data.licenseBreakdown.inCourse,       filterKey: "in_course",       color: "bg-blue-400" },
            { label: "Exam Scheduled", count: data.licenseBreakdown.examScheduled,  filterKey: "exam_scheduled",  color: "bg-amber-400" },
            { label: "Passed",         count: data.licenseBreakdown.passed,         filterKey: "passed",          color: "bg-emerald-400" },
            { label: "Pending State",  count: data.licenseBreakdown.pendingState,   filterKey: "pending_state",   color: "bg-violet-400" },
          ].map(item => (
            <Link
              key={item.label}
              to={`/dashboard/applicants?stage=${item.filterKey}`}
              className="flex items-center gap-2 text-xs p-1.5 -mx-1.5 rounded hover:bg-muted/40 transition"
            >
              <div className={cn("h-2 w-2 rounded-full", item.color)} />
              <span className="text-muted-foreground flex-1">{item.label}</span>
              <span className="font-bold">{item.count}</span>
              <ArrowRight className="h-3 w-3 text-muted-foreground" />
            </Link>
          ))}
        </div>
      </GlassCard>

      {/* This Week vs Last Week — matched range */}
      <GlassCard className="p-4">
        <div className="flex items-center gap-2 mb-1">
          {data.weekChange >= 0 ? (
            <TrendingUp className="h-4 w-4 text-emerald-400" />
          ) : (
            <TrendingDown className="h-4 w-4 text-red-400" />
          )}
          <h4 className="font-semibold text-sm">Week vs Week</h4>
          <Badge variant="outline" className="ml-auto text-xs text-muted-foreground">
            {data.weeklyAppsCount} Applications
          </Badge>
        </div>
        <p className="text-[10px] text-muted-foreground mb-3">
          Matched range: Mon–{format(now, "EEE")} this week vs Mon–{format(now, "EEE")} last week
        </p>
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
