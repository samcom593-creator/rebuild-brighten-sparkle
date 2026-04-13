import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { GlassCard } from "@/components/ui/glass-card";
import { ListTodo } from "lucide-react";
import { useNavigate } from "react-router-dom";

export function TeamTasksWidget() {
  const navigate = useNavigate();
  const [counts, setCounts] = useState({
    overdue: 0,
    dueToday: 0,
    dueThisWeek: 0,
    completed: 0,
  });

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      const today = new Date().toISOString().split("T")[0];
      const weekEnd = new Date();
      weekEnd.setDate(weekEnd.getDate() + (7 - weekEnd.getDay()));
      const weekEndStr = weekEnd.toISOString().split("T")[0];

      const [overdue, dueToday, dueWeek, completed] = await Promise.all([
        supabase.from("agent_tasks").select("id", { count: "exact", head: true }).eq("status", "overdue"),
        supabase.from("agent_tasks").select("id", { count: "exact", head: true }).eq("due_date", today).neq("status", "completed"),
        supabase.from("agent_tasks").select("id", { count: "exact", head: true }).lte("due_date", weekEndStr).gte("due_date", today).neq("status", "completed"),
        supabase.from("agent_tasks").select("id", { count: "exact", head: true }).eq("status", "completed"),
      ]);

      if (mounted) {
        setCounts({
          overdue: overdue.count || 0,
          dueToday: dueToday.count || 0,
          dueThisWeek: dueWeek.count || 0,
          completed: completed.count || 0,
        });
      }
    };
    load();
    return () => { mounted = false; };
  }, []);

  const items = [
    { label: "Overdue", count: counts.overdue, color: "text-red-400" },
    { label: "Due Today", count: counts.dueToday, color: "text-yellow-400" },
    { label: "This Week", count: counts.dueThisWeek, color: "text-blue-400" },
    { label: "Completed", count: counts.completed, color: "text-emerald-400" },
  ];

  return (
    <GlassCard
      className="p-4 cursor-pointer hover:border-primary/30 transition-colors"
      onClick={() => navigate("/dashboard/agent-management")}
    >
      <div className="flex items-center gap-2 mb-3">
        <ListTodo className="h-4 w-4 text-primary" />
        <span className="text-sm font-semibold">Team Tasks</span>
      </div>
      <div className="grid grid-cols-4 gap-2 text-center">
        {items.map((item) => (
          <div key={item.label}>
            <div className={`text-lg font-bold ${item.color}`}>{item.count}</div>
            <div className="text-[10px] text-muted-foreground">{item.label}</div>
          </div>
        ))}
      </div>
    </GlassCard>
  );
}
