import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useMountedRef } from "@/hooks/useMountedRef";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { GlassCard } from "@/components/ui/glass-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { AgentTaskManager } from "@/components/dashboard/AgentTaskManager";
import { CourseProgressPanel } from "@/components/admin/CourseProgressPanel";
import {
  BarChart3, ListTodo, AlertTriangle, GraduationCap,
  Phone, Mail, MessageSquare, MoreVertical, CheckCircle2,
} from "lucide-react";
import { toast } from "sonner";

interface AgentProdCard {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  todayALP: number;
  weekALP: number;
  lastLogged: string | null;
  streak: number;
  status: "green" | "yellow" | "red";
}

interface AlertItem {
  type: "overdue_task" | "no_production";
  label: string;
  agentId: string;
  agentName: string;
  agentPhone: string | null;
  agentEmail: string | null;
  taskId?: string;
  color: string;
}

export default function AgentManagement() {
  const { user } = useAuth();
  const mounted = useMountedRef();
  const [agents, setAgents] = useState<AgentProdCard[]>([]);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState<"alp" | "inactive" | "streak">("alp");

  useEffect(() => {
    loadProductionBoard();
    loadAlerts();
  }, []);

  const loadProductionBoard = async () => {
    setLoading(true);
    try {
      const { data: agentData } = await supabase
        .from("agents")
        .select("id, user_id, display_name, profiles(full_name, email, phone)")
        .eq("is_deactivated", false)
        .eq("status", "active");

      if (!mounted.current) return;
      if (!agentData) return;

      const today = new Date().toISOString().split("T")[0];
      const weekStart = new Date();
      weekStart.setDate(weekStart.getDate() - weekStart.getDay());
      const weekStartStr = weekStart.toISOString().split("T")[0];

      const ids = agentData.map((a: any) => a.id);

      const { data: prodData } = await supabase
        .from("daily_production")
        .select("agent_id, aop, production_date")
        .in("agent_id", ids)
        .gte("production_date", weekStartStr);

      const cards: AgentProdCard[] = agentData.map((a: any) => {
        const p = a.profiles;
        const name = a.display_name || p?.full_name || "Unknown";
        const agentProd = (prodData || []).filter((r: any) => r.agent_id === a.id);
        const todayProd = agentProd.filter((r: any) => r.production_date === today);
        const todayALP = todayProd.reduce((s: number, r: any) => s + Number(r.aop || 0), 0);
        const weekALP = agentProd.reduce((s: number, r: any) => s + Number(r.aop || 0), 0);

        const dates = agentProd.map((r: any) => r.production_date).sort().reverse();
        const lastLogged = dates[0] || null;

        let streak = 0;
        const checkDate = new Date();
        for (let i = 0; i < 60; i++) {
          const d = checkDate.toISOString().split("T")[0];
          if (agentProd.some((r: any) => r.production_date === d && Number(r.aop) > 0)) {
            streak++;
            checkDate.setDate(checkDate.getDate() - 1);
          } else {
            break;
          }
        }

        let status: "green" | "yellow" | "red" = "red";
        if (lastLogged === today) status = "green";
        else if (lastLogged) {
          const daysSince = Math.floor((Date.now() - new Date(lastLogged).getTime()) / 86400000);
          if (daysSince <= 1) status = "yellow";
        }

        return {
          id: a.id, name,
          email: p?.email || null,
          phone: p?.phone || null,
          todayALP, weekALP, lastLogged, streak, status,
        };
      });

      if (mounted.current) setAgents(cards);
    } catch (err) {
      console.error(err);
    } finally {
      if (mounted.current) setLoading(false);
    }
  };

  const loadAlerts = async () => {
    try {
      const { data: overdueTasks } = await supabase
        .from("agent_tasks")
        .select("id, title, agent_id")
        .eq("status", "overdue")
        .limit(20);

      const taskAgentIds = [...new Set((overdueTasks || []).map((t: any) => t.agent_id))];
      const { data: agentRecords } = taskAgentIds.length > 0
        ? await supabase
            .from("agents")
            .select("id, user_id, display_name, profiles(full_name, email, phone)")
            .in("id", taskAgentIds)
        : { data: [] };

      const agentMap = new Map<string, any>();
      (agentRecords || []).forEach((a: any) => {
        agentMap.set(a.id, {
          name: a.display_name || a.profiles?.full_name || "Unknown",
          email: a.profiles?.email || null,
          phone: a.profiles?.phone || null,
        });
      });

      const items: AlertItem[] = [];
      (overdueTasks || []).forEach((t: any) => {
        const info = agentMap.get(t.agent_id);
        if (!info) return;
        items.push({
          type: "overdue_task",
          label: `${info.name}: ${t.title}`,
          agentId: t.agent_id,
          agentName: info.name,
          agentPhone: info.phone,
          agentEmail: info.email,
          taskId: t.id,
          color: "text-orange-400",
        });
      });

      if (mounted.current) setAlerts(items);
    } catch (err) {
      console.error(err);
    }
  };

  const nudgeAgent = async (agent: AgentProdCard) => {
    const { error } = await supabase.from("agent_tasks").insert({
      agent_id: agent.id,
      title: `Nudge from management`,
      description: `Hey ${agent.name} — checking in. Let's log today's numbers and book some appointments.`,
      due_date: new Date().toISOString().split("T")[0],
      priority: "high",
      status: "pending",
      task_type: "nudge",
      created_at: new Date().toISOString(),
    });
    if (error) { toast.error(`Nudge failed: ${error.message}`); return; }
    toast.success(`Nudge sent to ${agent.name}`);
  };

  const createFollowupTask = async (agent: AgentProdCard) => {
    const { error } = await supabase.from("agent_tasks").insert({
      agent_id: agent.id,
      title: `Follow-up: ${agent.name}`,
      description: `Production check-in. Last logged: ${agent.lastLogged || "never"}.`,
      due_date: new Date(Date.now() + 24 * 3600 * 1000).toISOString().split("T")[0],
      priority: agent.status === "red" ? "high" : "medium",
      status: "pending",
      task_type: "followup",
      created_at: new Date().toISOString(),
    });
    if (error) { toast.error(error.message); return; }
    toast.success(`Task created`);
  };

  const markTaskComplete = async (taskId: string, agentName: string) => {
    const { error } = await supabase
      .from("agent_tasks")
      .update({ status: "completed", completed_at: new Date().toISOString() })
      .eq("id", taskId);
    if (error) { toast.error(error.message); return; }
    toast.success(`Task for ${agentName} completed`);
    loadAlerts();
  };

  const bulkNudgeRed = async () => {
    const redAgents = agents.filter(a => a.status === "red");
    if (redAgents.length === 0) { toast.error("No red agents"); return; }
    const rows = redAgents.map(a => ({
      agent_id: a.id,
      title: `Bulk nudge — get back to work`,
      description: `Inactive ${a.lastLogged ? `since ${a.lastLogged}` : "— never logged"}. Log today's numbers.`,
      due_date: new Date().toISOString().split("T")[0],
      priority: "high",
      status: "pending",
      task_type: "nudge",
      created_at: new Date().toISOString(),
    }));
    const { error } = await supabase.from("agent_tasks").insert(rows);
    if (error) { toast.error(error.message); return; }
    toast.success(`Nudged ${rows.length} red-status agents`);
  };

  const bulkTextRed = () => {
    const redAgents = agents.filter(a => a.status === "red" && a.phone);
    if (redAgents.length === 0) { toast.error("No phones available for red agents"); return; }
    window.location.href = `sms:${redAgents.map(a => a.phone).join(",")}`;
    toast.success(`Opening SMS for ${redAgents.length}`);
  };

  const sortedAgents = [...agents].sort((a, b) => {
    if (sortBy === "alp") return b.weekALP - a.weekALP;
    if (sortBy === "streak") return b.streak - a.streak;
    const order = { red: 0, yellow: 1, green: 2 };
    return order[a.status] - order[b.status];
  });

  const statusBorder = (s: string) => {
    if (s === "green") return "border-l-emerald-400";
    if (s === "yellow") return "border-l-yellow-400";
    return "border-l-red-400";
  };

  const redCount = agents.filter(a => a.status === "red").length;

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Agent Management Hub</h1>
          <p className="text-sm text-muted-foreground">Control center for all agent operations</p>
        </div>
        {redCount > 0 && (
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={bulkTextRed} className="border-red-500/40 text-red-400">
              <MessageSquare className="h-3.5 w-3.5 mr-1" /> Text {redCount} Red
            </Button>
            <Button size="sm" variant="outline" onClick={bulkNudgeRed} className="border-red-500/40 text-red-400">
              <ListTodo className="h-3.5 w-3.5 mr-1" /> Nudge {redCount} Red
            </Button>
          </div>
        )}
      </div>

      <Tabs defaultValue="production">
        <TabsList>
          <TabsTrigger value="production">
            <BarChart3 className="h-4 w-4 mr-1" /> Production Board
          </TabsTrigger>
          <TabsTrigger value="tasks">
            <ListTodo className="h-4 w-4 mr-1" /> Task Board
          </TabsTrigger>
          <TabsTrigger value="course">
            <GraduationCap className="h-4 w-4 mr-1" /> Course
          </TabsTrigger>
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
                <GlassCard
                  key={agent.id}
                  className={`p-4 border-l-4 ${statusBorder(agent.status)} group`}
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="font-semibold text-sm truncate flex-1">{agent.name}</div>
                    {agent.streak > 0 && (
                      <Badge variant="outline" className="text-[10px] shrink-0">
                        🔥 {agent.streak}d
                      </Badge>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <span className="text-muted-foreground">Today</span>
                      <div className="font-bold text-primary">
                        ${agent.todayALP.toLocaleString()}
                      </div>
                    </div>
                    <div>
                      <span className="text-muted-foreground">This Week</span>
                      <div className="font-bold">
                        ${agent.weekALP.toLocaleString()}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center justify-between mt-3 pt-2 border-t border-border/30">
                    <span className="text-[10px] text-muted-foreground">
                      {agent.lastLogged
                        ? `Last: ${new Date(agent.lastLogged).toLocaleDateString()}`
                        : "Never logged"}
                    </span>

                    <div className="flex items-center gap-0.5">
                      {agent.phone && (
                        <Button size="sm" variant="ghost" className="h-6 w-6 p-0" asChild title="Call">
                          <a href={`tel:${agent.phone}`}><Phone className="h-3 w-3" /></a>
                        </Button>
                      )}
                      {agent.phone && (
                        <Button size="sm" variant="ghost" className="h-6 w-6 p-0" asChild title="Text">
                          <a href={`sms:${agent.phone}`}><MessageSquare className="h-3 w-3" /></a>
                        </Button>
                      )}
                      {agent.email && (
                        <Button size="sm" variant="ghost" className="h-6 w-6 p-0" asChild title="Email">
                          <a href={`mailto:${agent.email}`}><Mail className="h-3 w-3" /></a>
                        </Button>
                      )}
                      <Button
                        size="sm" variant="ghost"
                        className="h-6 w-6 p-0"
                        title="Nudge (creates high-priority task)"
                        onClick={() => nudgeAgent(agent)}
                      >
                        <ListTodo className="h-3 w-3" />
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button size="sm" variant="ghost" className="h-6 w-6 p-0">
                            <MoreVertical className="h-3 w-3" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-48">
                          <DropdownMenuItem onClick={() => createFollowupTask(agent)}>
                            <ListTodo className="h-3.5 w-3.5 mr-2" /> Create Follow-up Task
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => nudgeAgent(agent)}>
                            <ListTodo className="h-3.5 w-3.5 mr-2" /> Nudge (urgent task today)
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          {agent.phone && (
                            <DropdownMenuItem asChild>
                              <a href={`tel:${agent.phone}`}>
                                <Phone className="h-3.5 w-3.5 mr-2" /> Call {agent.phone}
                              </a>
                            </DropdownMenuItem>
                          )}
                          {agent.email && (
                            <DropdownMenuItem asChild>
                              <a href={`mailto:${agent.email}`}>
                                <Mail className="h-3.5 w-3.5 mr-2" /> Email
                              </a>
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                </GlassCard>
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

        <TabsContent value="alerts" className="mt-4 space-y-2">
          {alerts.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No alerts right now — all clear! ✅
            </div>
          ) : (
            alerts.map((alert, i) => (
              <GlassCard key={i} className="p-3 flex items-center gap-3 group">
                <AlertTriangle className={`h-4 w-4 ${alert.color} shrink-0`} />
                <span className="text-sm flex-1 truncate">{alert.label}</span>

                <div className="flex items-center gap-0.5 shrink-0">
                  {alert.agentPhone && (
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0" asChild title="Call">
                      <a href={`tel:${alert.agentPhone}`}><Phone className="h-3.5 w-3.5" /></a>
                    </Button>
                  )}
                  {alert.agentPhone && (
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0" asChild title="Text">
                      <a href={`sms:${alert.agentPhone}`}><MessageSquare className="h-3.5 w-3.5" /></a>
                    </Button>
                  )}
                  {alert.agentEmail && (
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0" asChild title="Email">
                      <a href={`mailto:${alert.agentEmail}`}><Mail className="h-3.5 w-3.5" /></a>
                    </Button>
                  )}
                  {alert.type === "overdue_task" && alert.taskId && (
                    <Button
                      size="sm" variant="ghost"
                      className="h-7 px-2 text-xs text-emerald-400 hover:bg-emerald-500/10"
                      onClick={() => markTaskComplete(alert.taskId!, alert.agentName)}
                    >
                      <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Mark Done
                    </Button>
                  )}
                </div>
              </GlassCard>
            ))
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
