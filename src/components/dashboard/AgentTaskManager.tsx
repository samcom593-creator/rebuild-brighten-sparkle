import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { GlassCard } from "@/components/ui/glass-card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Plus,
  ListTodo,
  LayoutGrid,
  Clock,
  AlertTriangle,
  CheckCircle,
  Loader2,
  User,
} from "lucide-react";

interface AgentTask {
  id: string;
  agent_id: string;
  title: string;
  description: string | null;
  due_date: string | null;
  priority: string;
  status: string;
  task_type: string;
  completed_at: string | null;
  agent_notes: string | null;
  created_at: string;
  agent_name?: string;
}

interface AgentOption {
  id: string;
  name: string;
}

interface AgentTaskManagerProps {
  viewMode?: "board" | "list";
  agentFilter?: string;
  showAssignButton?: boolean;
}

export function AgentTaskManager({
  viewMode: defaultView = "board",
  agentFilter,
  showAssignButton = true,
}: AgentTaskManagerProps) {
  const { user } = useAuth();
  const [tasks, setTasks] = useState<AgentTask[]>([]);
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState(defaultView);
  const [assignOpen, setAssignOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  // Form
  const [formAgentId, setFormAgentId] = useState("");
  const [formTitle, setFormTitle] = useState("");
  const [formDesc, setFormDesc] = useState("");
  const [formType, setFormType] = useState("general");
  const [formDue, setFormDue] = useState("");
  const [formPriority, setFormPriority] = useState("normal");

  useEffect(() => {
    loadData();
  }, [agentFilter]);

  const loadData = async () => {
    setLoading(true);
    try {
      // Load agents
      const { data: agentData } = await supabase
        .from("agents")
        .select("id, display_name, profiles(full_name)")
        .eq("is_deactivated", false);

      const agentList = (agentData || []).map((a: any) => ({
        id: a.id,
        name: a.display_name || a.profiles?.full_name || "Unknown",
      }));
      setAgents(agentList);

      // Load tasks
      let query = supabase
        .from("agent_tasks")
        .select("*")
        .order("created_at", { ascending: false });

      if (agentFilter) {
        query = query.eq("agent_id", agentFilter);
      }

      const { data: taskData } = await query;

      const enriched = (taskData || []).map((t: any) => ({
        ...t,
        agent_name: agentList.find((a) => a.id === t.agent_id)?.name || "Unknown",
      }));
      setTasks(enriched);
    } catch (err) {
      console.error("Failed to load tasks", err);
    } finally {
      setLoading(false);
    }
  };

  const handleAssign = async () => {
    if (!formTitle.trim() || !formAgentId) {
      toast.error("Agent and title are required");
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase.from("agent_tasks").insert({
        agent_id: formAgentId,
        assigned_by: user?.id,
        title: formTitle,
        description: formDesc || null,
        task_type: formType,
        due_date: formDue || null,
        priority: formPriority,
      });
      if (error) throw error;
      toast.success("Task assigned!");
      setAssignOpen(false);
      setFormTitle("");
      setFormDesc("");
      setFormType("general");
      setFormDue("");
      setFormPriority("normal");
      setFormAgentId("");
      loadData();
    } catch (err) {
      toast.error("Failed to assign task");
    } finally {
      setSaving(false);
    }
  };

  const updateTaskStatus = async (taskId: string, newStatus: string) => {
    try {
      const updates: any = { status: newStatus };
      if (newStatus === "completed") updates.completed_at = new Date().toISOString();
      const { error } = await supabase.from("agent_tasks").update(updates).eq("id", taskId);
      if (error) throw error;
      toast.success(`Task marked as ${newStatus}`);
      loadData();
    } catch {
      toast.error("Failed to update task");
    }
  };

  const priorityColor = (p: string) => {
    switch (p) {
      case "urgent": return "destructive";
      case "high": return "default";
      case "normal": return "secondary";
      case "low": return "outline";
      default: return "secondary";
    }
  };

  const statusIcon = (s: string) => {
    switch (s) {
      case "completed": return <CheckCircle className="h-4 w-4 text-emerald-400" />;
      case "overdue": return <AlertTriangle className="h-4 w-4 text-red-400" />;
      case "in_progress": return <Loader2 className="h-4 w-4 text-blue-400" />;
      default: return <Clock className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const columns = ["pending", "in_progress", "completed", "overdue"];
  const columnLabels: Record<string, string> = {
    pending: "To Do",
    in_progress: "In Progress",
    completed: "Completed",
    overdue: "Overdue",
  };

  if (loading) {
    return <div className="text-center py-8 text-muted-foreground">Loading tasks...</div>;
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button
            variant={view === "board" ? "default" : "ghost"}
            size="sm"
            onClick={() => setView("board")}
          >
            <LayoutGrid className="h-4 w-4 mr-1" /> Board
          </Button>
          <Button
            variant={view === "list" ? "default" : "ghost"}
            size="sm"
            onClick={() => setView("list")}
          >
            <ListTodo className="h-4 w-4 mr-1" /> List
          </Button>
        </div>

        {showAssignButton && (
          <Dialog open={assignOpen} onOpenChange={setAssignOpen}>
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus className="h-4 w-4 mr-1" /> Assign Task
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>Assign Task</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <Select value={formAgentId} onValueChange={setFormAgentId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select Agent" />
                  </SelectTrigger>
                  <SelectContent>
                    {agents.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  placeholder="Task title"
                  value={formTitle}
                  onChange={(e) => setFormTitle(e.target.value)}
                />
                <Textarea
                  placeholder="Description (optional)"
                  value={formDesc}
                  onChange={(e) => setFormDesc(e.target.value)}
                  rows={2}
                />
                <div className="grid grid-cols-2 gap-2">
                  <Select value={formType} onValueChange={setFormType}>
                    <SelectTrigger>
                      <SelectValue placeholder="Type" />
                    </SelectTrigger>
                    <SelectContent>
                      {["general", "training", "production", "licensing", "admin", "content"].map((t) => (
                        <SelectItem key={t} value={t}>{t}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={formPriority} onValueChange={setFormPriority}>
                    <SelectTrigger>
                      <SelectValue placeholder="Priority" />
                    </SelectTrigger>
                    <SelectContent>
                      {["low", "normal", "high", "urgent"].map((p) => (
                        <SelectItem key={p} value={p}>{p}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Input
                  type="date"
                  value={formDue}
                  onChange={(e) => setFormDue(e.target.value)}
                />
                <Button onClick={handleAssign} disabled={saving} className="w-full">
                  {saving ? "Assigning..." : "Assign Task"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {/* Board View */}
      {view === "board" && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {columns.map((col) => {
            const colTasks = tasks.filter((t) => t.status === col);
            return (
              <div key={col} className="space-y-2">
                <div className="flex items-center gap-2 mb-2">
                  {statusIcon(col)}
                  <span className="text-sm font-semibold">{columnLabels[col]}</span>
                  <Badge variant="outline" className="ml-auto text-xs">
                    {colTasks.length}
                  </Badge>
                </div>
                {colTasks.length === 0 ? (
                  <div className="text-xs text-muted-foreground text-center py-6 border border-dashed rounded-lg">
                    No tasks
                  </div>
                ) : (
                  colTasks.map((task) => (
                    <GlassCard key={task.id} className="p-3 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-sm font-medium leading-tight">{task.title}</span>
                        <Badge variant={priorityColor(task.priority)} className="text-[10px] shrink-0">
                          {task.priority}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <User className="h-3 w-3" />
                        {task.agent_name}
                      </div>
                      {task.due_date && (
                        <div className="text-xs text-muted-foreground">
                          Due: {new Date(task.due_date).toLocaleDateString()}
                        </div>
                      )}
                      {task.status !== "completed" && (
                        <div className="flex gap-1">
                          {task.status === "pending" && (
                            <Button size="sm" variant="ghost" className="text-xs h-7"
                              onClick={() => updateTaskStatus(task.id, "in_progress")}>
                              Start
                            </Button>
                          )}
                          <Button size="sm" variant="ghost" className="text-xs h-7 text-emerald-400"
                            onClick={() => updateTaskStatus(task.id, "completed")}>
                            Complete
                          </Button>
                        </div>
                      )}
                    </GlassCard>
                  ))
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* List View */}
      {view === "list" && (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/30">
              <tr>
                <th className="text-left p-3 font-medium">Agent</th>
                <th className="text-left p-3 font-medium">Task</th>
                <th className="text-left p-3 font-medium hidden md:table-cell">Type</th>
                <th className="text-left p-3 font-medium hidden md:table-cell">Due</th>
                <th className="text-left p-3 font-medium">Priority</th>
                <th className="text-left p-3 font-medium">Status</th>
                <th className="text-left p-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((task) => (
                <tr key={task.id} className="border-t">
                  <td className="p-3">{task.agent_name}</td>
                  <td className="p-3 font-medium">{task.title}</td>
                  <td className="p-3 hidden md:table-cell capitalize">{task.task_type}</td>
                  <td className="p-3 hidden md:table-cell">
                    {task.due_date ? new Date(task.due_date).toLocaleDateString() : "—"}
                  </td>
                  <td className="p-3">
                    <Badge variant={priorityColor(task.priority)} className="text-[10px]">
                      {task.priority}
                    </Badge>
                  </td>
                  <td className="p-3">
                    <div className="flex items-center gap-1">
                      {statusIcon(task.status)}
                      <span className="capitalize text-xs">{task.status}</span>
                    </div>
                  </td>
                  <td className="p-3">
                    {task.status !== "completed" && (
                      <Button size="sm" variant="ghost" className="text-xs h-7"
                        onClick={() => updateTaskStatus(task.id, "completed")}>
                        ✓
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
              {tasks.length === 0 && (
                <tr>
                  <td colSpan={7} className="p-6 text-center text-muted-foreground">
                    No tasks found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
