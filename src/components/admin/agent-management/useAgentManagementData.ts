import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useMountedRef } from "@/hooks/useMountedRef";
import type { AgentProdCard } from "@/components/admin/agent-management/ProductionCard";
import type { AlertItem } from "@/components/admin/agent-management/AlertsList";

export function useAgentManagementData() {
  const mounted = useMountedRef();
  const [agents, setAgents] = useState<AgentProdCard[]>([]);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [loading, setLoading] = useState(true);

  const loadProductionBoard = async () => {
    setLoading(true);
    try {
      const { data: agentData } = await supabase
        .from("agents")
        .select("id, user_id, display_name, profiles(full_name, email, phone)")
        .eq("is_deactivated", false)
        .eq("status", "active");

      if (!mounted.current || !agentData) return;

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

        let status: AgentProdCard["status"] = "red";
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

  useEffect(() => {
    loadProductionBoard();
    loadAlerts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { agents, alerts, loading, reloadAlerts: loadAlerts, reloadAgents: loadProductionBoard };
}
