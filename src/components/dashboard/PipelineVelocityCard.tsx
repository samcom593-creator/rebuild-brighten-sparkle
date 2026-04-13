import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { GlassCard } from "@/components/ui/glass-card";
import { Badge } from "@/components/ui/badge";
import { Clock, TrendingUp, AlertTriangle, CheckCircle, ArrowRight } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

interface StageMetric {
  stage: string;
  label: string;
  avgDays: number;
  count: number;
  color: string;
  icon: React.ReactNode;
}

const STAGE_CONFIG: Record<string, { label: string; color: string; order: number }> = {
  unlicensed: { label: "Pre-Course", color: "bg-red-500", order: 0 },
  pre_course: { label: "Pre-Course", color: "bg-red-500", order: 0 },
  course_purchased: { label: "Course Purchased", color: "bg-amber-500", order: 1 },
  finished_course: { label: "Course Complete", color: "bg-blue-500", order: 2 },
  test_scheduled: { label: "Exam Scheduled", color: "bg-purple-500", order: 3 },
  exam_passed: { label: "Exam Passed", color: "bg-emerald-500", order: 4 },
  licensed: { label: "Licensed", color: "bg-green-600", order: 5 },
};

export function PipelineVelocityCard() {
  const { data, isLoading } = useQuery({
    queryKey: ["pipeline-velocity"],
    queryFn: async () => {
      // Get all contracted applications with their licensing progress
      const { data: apps, error } = await supabase
        .from("applications")
        .select("id, license_progress, contracted_at, course_purchased_at, exam_scheduled_at, exam_passed_at, license_approved_at")
        .not("contracted_at", "is", null)
        .is("terminated_at", null);

      if (error) throw error;

      const now = new Date();
      const stageCounts: Record<string, number[]> = {};

      for (const app of apps || []) {
        const stage = app.license_progress || "unlicensed";
        const contractedAt = new Date(app.contracted_at);
        const daysSince = Math.floor((now.getTime() - contractedAt.getTime()) / 86400000);

        if (!stageCounts[stage]) stageCounts[stage] = [];
        stageCounts[stage].push(daysSince);
      }

      const metrics: StageMetric[] = Object.entries(stageCounts)
        .map(([stage, days]) => {
          const config = STAGE_CONFIG[stage] || { label: stage, color: "bg-gray-500", order: 99 };
          const avg = days.reduce((a, b) => a + b, 0) / days.length;
          return {
            stage,
            label: config.label,
            avgDays: Math.round(avg),
            count: days.length,
            color: config.color,
            icon: avg > 14 ? <AlertTriangle className="w-4 h-4 text-amber-400" /> : <CheckCircle className="w-4 h-4 text-emerald-400" />,
          };
        })
        .sort((a, b) => (STAGE_CONFIG[a.stage]?.order ?? 99) - (STAGE_CONFIG[b.stage]?.order ?? 99));

      // Overall avg time to license
      const licensedApps = (apps || []).filter(a => a.license_approved_at && a.contracted_at);
      const avgToLicense = licensedApps.length > 0
        ? Math.round(licensedApps.reduce((sum, a) => {
            return sum + (new Date(a.license_approved_at!).getTime() - new Date(a.contracted_at).getTime()) / 86400000;
          }, 0) / licensedApps.length)
        : null;

      return { metrics, totalApps: apps?.length || 0, avgToLicense };
    },
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading) {
    return (
      <GlassCard className="p-4">
        <Skeleton className="h-6 w-48 mb-4" />
        <div className="space-y-3">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-12 w-full" />)}
        </div>
      </GlassCard>
    );
  }

  if (!data) return null;

  return (
    <GlassCard className="p-4 sm:p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Clock className="w-5 h-5 text-emerald-400" />
          <h3 className="font-semibold text-white text-sm sm:text-base">Pipeline Velocity</h3>
        </div>
        {data.avgToLicense && (
          <Badge variant="outline" className="text-xs border-emerald-500/30 text-emerald-400">
            Avg to License: {data.avgToLicense}d
          </Badge>
        )}
      </div>

      {/* Pipeline funnel */}
      <div className="space-y-2">
        {data.metrics.map((metric, i) => (
          <div key={metric.stage} className="flex items-center gap-2 sm:gap-3">
            <div className={`w-2 h-2 rounded-full ${metric.color} flex-shrink-0`} />
            <span className="text-xs sm:text-sm text-white/80 min-w-[100px] sm:min-w-[120px]">{metric.label}</span>
            <div className="flex-1 bg-white/5 rounded-full h-5 relative overflow-hidden">
              <div
                className={`h-full ${metric.color}/60 rounded-full flex items-center justify-end pr-2 transition-all`}
                style={{ width: `${Math.min(100, (metric.count / data.totalApps) * 100)}%` }}
              >
                <span className="text-[10px] text-white font-medium">{metric.count}</span>
              </div>
            </div>
            <div className="flex items-center gap-1 min-w-[60px] justify-end">
              {metric.icon}
              <span className={`text-xs ${metric.avgDays > 14 ? "text-amber-400" : "text-white/60"}`}>
                {metric.avgDays}d avg
              </span>
            </div>
            {i < data.metrics.length - 1 && (
              <ArrowRight className="w-3 h-3 text-white/20 hidden sm:block flex-shrink-0" />
            )}
          </div>
        ))}
      </div>

      <div className="mt-3 pt-3 border-t border-white/5 flex items-center justify-between">
        <span className="text-xs text-white/40">{data.totalApps} total in pipeline</span>
        <div className="flex items-center gap-1 text-xs text-white/40">
          <TrendingUp className="w-3 h-3" />
          Updated live
        </div>
      </div>
    </GlassCard>
  );
}
