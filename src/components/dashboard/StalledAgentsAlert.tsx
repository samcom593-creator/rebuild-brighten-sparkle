import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { GlassCard } from "@/components/ui/glass-card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Clock, UserMinus, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useState } from "react";

interface StalledAgent {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  stage: string;
  daysSinceContracted: number;
  urgency: "critical" | "high" | "medium";
}

const STAGE_LABELS: Record<string, string> = {
  unlicensed: "Not Started",
  pre_course: "Pre-Course",
  course_purchased: "Course Purchased",
  finished_course: "Course Complete",
  test_scheduled: "Exam Scheduled",
};

export function StalledAgentsAlert() {
  const [showAll, setShowAll] = useState(false);

  const { data: stalled, isLoading } = useQuery({
    queryKey: ["stalled-agents"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("applications")
        .select("id, first_name, last_name, email, phone, license_progress, contracted_at")
        .eq("license_status", "unlicensed")
        .not("contracted_at", "is", null)
        .is("terminated_at", null);

      if (error) throw error;

      const now = new Date();
      const agents: StalledAgent[] = [];

      for (const app of data || []) {
        const contractedAt = new Date(app.contracted_at);
        const daysSince = Math.floor((now.getTime() - contractedAt.getTime()) / 86400000);
        const stage = app.license_progress || "unlicensed";

        if (daysSince < 7) continue;

        let urgency: "critical" | "high" | "medium" = "medium";
        if (daysSince > 21 && ["unlicensed", "pre_course"].includes(stage)) urgency = "critical";
        else if (daysSince > 14) urgency = "high";

        agents.push({
          id: app.id,
          name: `${app.first_name} ${app.last_name}`,
          email: app.email,
          phone: app.phone,
          stage,
          daysSinceContracted: daysSince,
          urgency,
        });
      }

      return agents.sort((a, b) => b.daysSinceContracted - a.daysSinceContracted);
    },
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading) {
    return (
      <GlassCard className="p-4">
        <Skeleton className="h-6 w-48 mb-4" />
        <Skeleton className="h-20 w-full" />
      </GlassCard>
    );
  }

  if (!stalled || stalled.length === 0) return null;

  const critical = stalled.filter(s => s.urgency === "critical");
  const displayed = showAll ? stalled : stalled.slice(0, 5);

  return (
    <GlassCard className="p-4 sm:p-6 border-amber-500/20">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-amber-400" />
          <h3 className="font-semibold text-white text-sm sm:text-base">Stalled Agents</h3>
          <Badge variant="destructive" className="text-xs">{stalled.length}</Badge>
        </div>
        {critical.length > 0 && (
          <Badge className="bg-red-500/20 text-red-400 text-xs">
            {critical.length} critical
          </Badge>
        )}
      </div>

      <div className="space-y-2">
        {displayed.map(agent => (
          <div
            key={agent.id}
            className={`flex items-center justify-between p-2 sm:p-3 rounded-lg ${
              agent.urgency === "critical" ? "bg-red-500/10 border border-red-500/20" :
              agent.urgency === "high" ? "bg-amber-500/10 border border-amber-500/20" :
              "bg-white/5"
            }`}
          >
            <div className="flex items-center gap-2 sm:gap-3 min-w-0">
              <UserMinus className={`w-4 h-4 flex-shrink-0 ${
                agent.urgency === "critical" ? "text-red-400" :
                agent.urgency === "high" ? "text-amber-400" : "text-white/40"
              }`} />
              <div className="min-w-0">
                <p className="text-xs sm:text-sm text-white font-medium truncate">{agent.name}</p>
                <p className="text-[10px] sm:text-xs text-white/40">{STAGE_LABELS[agent.stage] || agent.stage}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1">
                <Clock className="w-3 h-3 text-white/40" />
                <span className={`text-xs font-medium ${
                  agent.urgency === "critical" ? "text-red-400" :
                  agent.urgency === "high" ? "text-amber-400" : "text-white/60"
                }`}>
                  {agent.daysSinceContracted}d
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {stalled.length > 5 && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowAll(!showAll)}
          className="w-full mt-2 text-xs text-white/40 hover:text-white"
        >
          {showAll ? "Show Less" : `Show All ${stalled.length} Stalled`}
        </Button>
      )}
    </GlassCard>
  );
}
