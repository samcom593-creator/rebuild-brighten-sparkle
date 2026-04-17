import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useMountedRef } from "@/hooks/useMountedRef";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { GlassCard } from "@/components/ui/glass-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AgentTaskManager } from "@/components/dashboard/AgentTaskManager";
import {
  BarChart3,
  ListTodo,
  AlertTriangle,
  TrendingUp,
  Clock,
  Send,
  Eye,
} from "lucide-react";
import { toast } from "sonner";

interface AgentProdCard {
  id: string;
  name: string;
  todayALP: number;
  weekALP: number;
  lastLogged: string | null;
  streak: number;
  status: "green" | "yellow" | "red";
}

export default function AgentManagement() {
  const { user } = useAuth();
  const mounted = useMountedRef();
  const [agents, setAgents] = useState<AgentProdCard[]>([]);
  const [alerts, setAlerts] = useState<any[]>([]);
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
        .select("id, display_name, profiles(full_name)")
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
        const name = a.display_name || a.profiles?.full_name || "Unknown";
        const agentProd = (prodData || []).filter((p: any) => p.agent_id === a.id);
        const todayProd = agentProd.filter((p: any) => p.production_date === today);
        const todayALP = todayProd.reduce((s: number, r: any) => s + Number(r.aop || 0), 0);
        const weekALP = agentProd.reduce((s: number, r: any) => s + Number(r.aop || 0), 0);

        const dates = agentProd.map((p: any) => p.production_date).sort().reverse();
        const lastLogged = dates[0] || null;

        // Simple streak calc
        let streak = 0;
        const checkDate = new Date();
        for (let i = 0; i < 60; i++) {
          const d = checkDate.toISOString().split("T")[0];
          if (agentProd.some((p: any) => p.production_date === d && Number(p.aop) > 0)) {
            streak++;
            checkDate.setDate(checkDate.getDate() - 1);
          } else {
            break;
          }
        }

        let status: "green" | "yellow" | "red" = "red";
        if (lastLogged === today) status = "green";
        else if (lastLogged) {
          const daysSince = Math.floor(
            (Date.now() - new Date(lastLogged).getTime()) / 86400000
          );
          if (daysSince <= 1) status = "yellow";
        }

        return { id: a.id, name, todayALP, weekALP, lastLogged, streak, status };
      });

      setAgents(cards);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const loadAlerts = async () => {
    try {
      // Overdue tasks
      const { data: overdueTasks } = await supabase
        .from("agent_tasks")
        .select("id, title, agent_id")
        .eq("status", "overdue")
        .limit(10);

      // 3+ days no production
      const threeDaysAgo = new Date();
      threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

      const alertItems: any[] = [];
      (overdueTasks || []).forEach((t: any) => {
        alertItems.push({
          type: "overdue_task",
          label: `Task overdue: ${t.title}`,
          color: "text-orange-400",
        });
      });

      setAlerts(alertItems);
    } catch (err) {
      console.error(err);
    }
  };

  const sortedAgents = [...agents].sort((a, b) => {
    if (sortBy === "alp") return b.weekALP - a.weekALP;
    if (sortBy === "streak") return b.streak - a.streak;
    // inactive: sort by worst status first
    const order = { red: 0, yellow: 1, green: 2 };
    return order[a.status] - order[b.status];
  });

  const statusBorder = (s: string) => {
    if (s === "green") return "border-l-emerald-400";
    if (s === "yellow") return "border-l-yellow-400";
    return "border-l-red-400";
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Agent Management Hub</h1>
        <p className="text-sm text-muted-foreground">Control center for all agent operations</p>
      </div>

      <Tabs defaultValue="production">
        <TabsList>
          <TabsTrigger value="production">
            <BarChart3 className="h-4 w-4 mr-1" /> Production Board
          </TabsTrigger>
          <TabsTrigger value="tasks">
            <ListTodo className="h-4 w-4 mr-1" /> Task Board
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
                  className={`p-4 border-l-4 ${statusBorder(agent.status)}`}
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="font-semibold text-sm truncate">{agent.name}</div>
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
                  <div className="flex items-center justify-between mt-2">
                    <span className="text-[10px] text-muted-foreground">
                      {agent.lastLogged
                        ? `Last: ${new Date(agent.lastLogged).toLocaleDateString()}`
                        : "Never logged"}
                    </span>
                    <Button variant="ghost" size="sm" className="h-6 text-[10px] px-2">
                      <Send className="h-3 w-3 mr-1" /> Nudge
                    </Button>
                  </div>
                </GlassCard>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="tasks" className="mt-4">
          <AgentTaskManager />
        </TabsContent>

        <TabsContent value="alerts" className="mt-4 space-y-2">
          {alerts.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No alerts right now — all clear! ✅
            </div>
          ) : (
            alerts.map((alert, i) => (
              <GlassCard key={i} className="p-3 flex items-center gap-3">
                <AlertTriangle className={`h-4 w-4 ${alert.color}`} />
                <span className="text-sm">{alert.label}</span>
              </GlassCard>
            ))
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
