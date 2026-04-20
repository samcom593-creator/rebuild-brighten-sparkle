import { useState, useMemo } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AgentTaskManager } from "@/components/dashboard/AgentTaskManager";
import { CourseProgressPanel } from "@/components/admin/CourseProgressPanel";
import {
  BarChart3, ListTodo, AlertTriangle, GraduationCap, MessageSquare,
} from "lucide-react";
import { PageLoadingSkeleton } from "@/components/ui/page-loading-skeleton";

import { useAgentManagementData } from "@/components/admin/agent-management/useAgentManagementData";
import { ProductionCard } from "@/components/admin/agent-management/ProductionCard";
import { AlertsList } from "@/components/admin/agent-management/AlertsList";
import {
  nudgeAgent, createFollowupTask, markTaskComplete,
  bulkNudgeRed, bulkTextRed,
} from "@/components/admin/agent-management/agentActions";

type SortKey = "alp" | "inactive" | "streak";

export default function AgentManagement() {
  const { agents, alerts, loading, reloadAlerts } = useAgentManagementData();
  const [sortBy, setSortBy] = useState<SortKey>("alp");

  const sortedAgents = useMemo(() => {
    return [...agents].sort((a, b) => {
      if (sortBy === "alp") return b.weekALP - a.weekALP;
      if (sortBy === "streak") return b.streak - a.streak;
      const order = { red: 0, yellow: 1, green: 2 } as const;
      return order[a.status] - order[b.status];
    });
  }, [agents, sortBy]);

  const redCount = agents.filter(a => a.status === "red").length;

  if (loading && agents.length === 0) return <PageLoadingSkeleton variant="dashboard" />;

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Agent Management Hub</h1>
          <p className="text-sm text-muted-foreground">Control center for all agent operations</p>
        </div>
        {redCount > 0 && (
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => bulkTextRed(agents)} className="border-red-500/40 text-red-400">
              <MessageSquare className="h-3.5 w-3.5 mr-1" /> Text {redCount} Red
            </Button>
            <Button size="sm" variant="outline" onClick={() => bulkNudgeRed(agents)} className="border-red-500/40 text-red-400">
              <ListTodo className="h-3.5 w-3.5 mr-1" /> Nudge {redCount} Red
            </Button>
          </div>
        )}
      </div>

      <Tabs defaultValue="production">
        <TabsList>
          <TabsTrigger value="production"><BarChart3 className="h-4 w-4 mr-1" /> Production Board</TabsTrigger>
          <TabsTrigger value="tasks"><ListTodo className="h-4 w-4 mr-1" /> Task Board</TabsTrigger>
          <TabsTrigger value="course"><GraduationCap className="h-4 w-4 mr-1" /> Course</TabsTrigger>
          <TabsTrigger value="alerts">
            <AlertTriangle className="h-4 w-4 mr-1" /> Alerts
            {alerts.length > 0 && (
              <Badge variant="destructive" className="ml-1 text-[10px] h-4 min-w-4 p-0 flex items-center justify-center">
                {alerts.length}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="production" className="mt-4 space-y-4">
          <div className="flex gap-2">
            {(["alp", "inactive", "streak"] as const).map((s) => (
              <Button
                key={s}
                variant={sortBy === s ? "default" : "ghost"}
                size="sm"
                onClick={() => setSortBy(s)}
                className="capitalize text-xs"
              >
                {s === "alp" ? "By ALP" : s === "inactive" ? "By Inactivity" : "By Streak"}
              </Button>
            ))}
          </div>

          {loading ? (
            <div className="text-center py-8 text-muted-foreground">Loading...</div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {sortedAgents.map((agent) => (
                <ProductionCard
                  key={agent.id}
                  agent={agent}
                  onNudge={nudgeAgent}
                  onCreateFollowup={createFollowupTask}
                />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="tasks" className="mt-4">
          <AgentTaskManager />
        </TabsContent>

        <TabsContent value="course" className="mt-4">
          <CourseProgressPanel />
        </TabsContent>

        <TabsContent value="alerts" className="mt-4">
          <AlertsList
            alerts={alerts}
            onMarkComplete={async (taskId, name) => {
              const ok = await markTaskComplete(taskId, name);
              if (ok) reloadAlerts();
            }}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
