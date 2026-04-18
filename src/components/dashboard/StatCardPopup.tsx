import { useState, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  DollarSign, Users, TrendingUp, AlertTriangle, Target, Phone, Mail,
  MessageSquare, MoreVertical, Download, Search, ListTodo,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export type StatType = "totalAlp" | "activeAgents" | "producers" | "needsAttention" | "totalDeals";

interface AgentData {
  id: string;
  fullName: string;
  totalAlp: number;
  totalDeals: number;
  email?: string | null;
  phone?: string | null;
  isDeactivated?: boolean;
  isInactive?: boolean;
}

interface StatCardPopupProps {
  type: StatType;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agents: AgentData[];
  timePeriod?: "week" | "month" | "day" | "custom";
}

const icons = {
  totalAlp: DollarSign,
  activeAgents: Users,
  producers: TrendingUp,
  needsAttention: AlertTriangle,
  totalDeals: Target,
};

const titles = {
  totalAlp: "ALP Contributors",
  activeAgents: "Active Agents",
  producers: "Producers This Period",
  needsAttention: "Needs Attention",
  totalDeals: "Deals by Agent",
};

const descriptions = {
  totalAlp: "Agents who contributed to this period's ALP",
  activeAgents: "All agents marked as active in the system",
  producers: "Agents who sold at least one deal",
  needsAttention: "Agents under threshold with low production",
  totalDeals: "Agents ranked by deals closed this period",
};

export function StatCardPopup({
  type,
  open,
  onOpenChange,
  agents,
  timePeriod = "week",
}: StatCardPopupProps) {
  const Icon = icons[type];
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const sortedAgents = useMemo(() => {
    const filtered = agents.filter((agent) => {
      switch (type) {
        case "totalAlp":       return agent.totalAlp > 0;
        case "activeAgents":   return !agent.isDeactivated && !agent.isInactive;
        case "producers":      return agent.totalDeals > 0 && !agent.isDeactivated && !agent.isInactive;
        case "needsAttention": {
          const threshold = timePeriod === "month" ? 20000 : 5000;
          return !agent.isDeactivated && !agent.isInactive && agent.totalAlp < threshold;
        }
        case "totalDeals":     return agent.totalDeals > 0;
        default: return true;
      }
    });

    const q = search.trim().toLowerCase();
    const searched = q
      ? filtered.filter(a => a.fullName.toLowerCase().includes(q) || (a.email || "").toLowerCase().includes(q))
      : filtered;

    return [...searched].sort((a, b) => {
      if (type === "needsAttention") return a.totalAlp - b.totalAlp;
      if (type === "totalDeals")     return b.totalDeals - a.totalDeals;
      return b.totalAlp - a.totalAlp;
    });
  }, [agents, type, timePeriod, search]);

  const allSelected = sortedAgents.length > 0 && sortedAgents.every(a => selected.has(a.id));

  function toggleOne(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(sortedAgents.map(a => a.id)));
  }

  function getSelectedAgents() {
    return sortedAgents.filter(a => selected.has(a.id));
  }

  function bulkSMS() {
    const picks = getSelectedAgents().filter(a => a.phone);
    if (picks.length === 0) { toast.error("No phones available in selection"); return; }
    const phones = picks.map(a => a.phone).join(",");
    window.location.href = `sms:${phones}`;
    toast.success(`Opening SMS for ${picks.length}`);
  }

  function bulkEmail() {
    const picks = getSelectedAgents().filter(a => a.email);
    if (picks.length === 0) { toast.error("No emails available in selection"); return; }
    const emails = picks.map(a => a.email).join(",");
    window.location.href = `mailto:${emails}`;
    toast.success(`Opening email for ${picks.length}`);
  }

  async function bulkTask() {
    const picks = getSelectedAgents();
    if (picks.length === 0) return;
    const title = type === "needsAttention"
      ? "Follow up — low production"
      : "Check in with agent";
    const description = type === "needsAttention"
      ? "Agent flagged for low production. Reach out to diagnose and support."
      : `Check in with ${picks.length === 1 ? picks[0].fullName : "these agents"}.`;
    const rows = picks.map(a => ({
      agent_id: a.id,
      title,
      description,
      due_date: new Date(Date.now() + 24 * 3600 * 1000).toISOString().split("T")[0],
      priority: type === "needsAttention" ? "high" : "medium",
      status: "pending",
      task_type: "followup",
      created_at: new Date().toISOString(),
    }));
    const { error } = await supabase.from("agent_tasks").insert(rows);
    if (error) { toast.error(`Failed: ${error.message}`); return; }
    toast.success(`Task created for ${picks.length}`);
    setSelected(new Set());
  }

  function exportCSV() {
    if (sortedAgents.length === 0) { toast.error("Nothing to export"); return; }
    const rows = sortedAgents.map(a => ({
      name: a.fullName,
      email: a.email || "",
      phone: a.phone || "",
      alp: Math.round(a.totalAlp),
      deals: a.totalDeals,
    }));
    const header = Object.keys(rows[0]).join(",");
    const body = rows.map(r => Object.values(r).map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([`${header}\n${body}`], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${titles[type].toLowerCase().replace(/\s+/g, "-")}-${Date.now()}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon className={cn(
              "h-5 w-5",
              type === "needsAttention" ? "text-destructive" : "text-primary"
            )} />
            {titles[type]}
            <Badge variant="secondary" className="ml-auto text-xs">
              {sortedAgents.length}
            </Badge>
          </DialogTitle>
          <p className="text-sm text-muted-foreground">{descriptions[type]}</p>
        </DialogHeader>

        {/* Search + export */}
        <div className="flex gap-2 items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Search by name or email…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-8 h-8 text-sm"
            />
          </div>
          <Button variant="outline" size="sm" onClick={exportCSV} disabled={sortedAgents.length === 0}>
            <Download className="h-3.5 w-3.5 mr-1" /> CSV
          </Button>
        </div>

        {/* Bulk action bar */}
        {selected.size > 0 && (
          <div className="flex items-center gap-2 p-2 rounded-md bg-primary/10 border border-primary/30">
            <span className="text-sm font-medium">{selected.size} selected</span>
            <div className="h-4 w-px bg-border mx-1" />
            <Button size="sm" variant="outline" onClick={bulkSMS}>
              <MessageSquare className="h-3.5 w-3.5 mr-1" /> SMS All
            </Button>
            <Button size="sm" variant="outline" onClick={bulkEmail}>
              <Mail className="h-3.5 w-3.5 mr-1" /> Email All
            </Button>
            <Button size="sm" variant="outline" onClick={bulkTask}>
              <ListTodo className="h-3.5 w-3.5 mr-1" /> Create Task
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())} className="ml-auto">
              Clear
            </Button>
          </div>
        )}

        <ScrollArea className="max-h-[440px] pr-4">
          {sortedAgents.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Icon className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>No agents in this category</p>
            </div>
          ) : (
            <>
              {/* Select-all */}
              <div className="flex items-center gap-2 px-3 py-2 border-b border-border/30 mb-2">
                <Checkbox checked={allSelected} onCheckedChange={toggleAll} />
                <span className="text-xs text-muted-foreground">
                  Select all {sortedAgents.length}
                </span>
              </div>

              <div className="space-y-1.5">
                {sortedAgents.map((agent, index) => (
                  <div
                    key={agent.id}
                    className={cn(
                      "group flex items-center justify-between p-2.5 rounded-lg border transition",
                      type === "needsAttention" && agent.totalAlp === 0 && "border-destructive/30 bg-destructive/5",
                      index === 0 && type !== "needsAttention" && "bg-primary/5 border-primary/30",
                      selected.has(agent.id) && "ring-1 ring-primary/40",
                    )}
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <Checkbox
                        checked={selected.has(agent.id)}
                        onCheckedChange={() => toggleOne(agent.id)}
                      />
                      <div className={cn(
                        "w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0",
                        type !== "needsAttention" && index === 0 && "bg-amber-500 text-black",
                        type !== "needsAttention" && index === 1 && "bg-gray-300 text-black",
                        type !== "needsAttention" && index === 2 && "bg-amber-700 text-white",
                        (type === "needsAttention" || index > 2) && "bg-muted text-muted-foreground",
                      )}>
                        {index + 1}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-sm truncate">{agent.fullName}</p>
                        {(agent.email || agent.phone) && (
                          <p className="text-[10px] text-muted-foreground truncate">
                            {agent.phone || ""}{agent.phone && agent.email ? " · " : ""}{agent.email || ""}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 flex-shrink-0">
                      {/* Metric display */}
                      <div className="text-right hidden sm:block">
                        {type === "activeAgents" ? (
                          <Badge variant="secondary" className="text-xs">Active</Badge>
                        ) : type === "totalDeals" ? (
                          <>
                            <p className="font-bold text-sm">{agent.totalDeals} deals</p>
                            <p className="text-[10px] text-muted-foreground">
                              ${Math.round(agent.totalAlp).toLocaleString()}
                            </p>
                          </>
                        ) : (
                          <>
                            <p className={cn(
                              "font-bold text-sm",
                              type === "needsAttention" && agent.totalAlp === 0 && "text-destructive",
                            )}>
                              ${Math.round(agent.totalAlp).toLocaleString()}
                            </p>
                            {type === "producers" && (
                              <p className="text-[10px] text-muted-foreground">{agent.totalDeals} deals</p>
                            )}
                          </>
                        )}
                      </div>

                      {/* Inline action buttons */}
                      <div className="flex items-center gap-0.5 opacity-70 group-hover:opacity-100 transition">
                        {agent.phone && (
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" asChild title="Call">
                            <a href={`tel:${agent.phone}`}><Phone className="h-3.5 w-3.5" /></a>
                          </Button>
                        )}
                        {agent.phone && (
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" asChild title="Text">
                            <a href={`sms:${agent.phone}`}><MessageSquare className="h-3.5 w-3.5" /></a>
                          </Button>
                        )}
                        {agent.email && (
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" asChild title="Email">
                            <a href={`mailto:${agent.email}`}><Mail className="h-3.5 w-3.5" /></a>
                          </Button>
                        )}
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button size="sm" variant="ghost" className="h-7 w-7 p-0">
                              <MoreVertical className="h-3.5 w-3.5" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={async () => {
                              const { error } = await supabase.from("agent_tasks").insert({
                                agent_id: agent.id,
                                title: type === "needsAttention"
                                  ? "Follow up — low production"
                                  : `Check in with ${agent.fullName}`,
                                description: type === "needsAttention"
                                  ? "Agent flagged for low production."
                                  : null,
                                due_date: new Date(Date.now() + 24 * 3600 * 1000).toISOString().split("T")[0],
                                priority: type === "needsAttention" ? "high" : "medium",
                                status: "pending",
                                task_type: "followup",
                                created_at: new Date().toISOString(),
                              });
                              if (error) toast.error(error.message);
                              else toast.success("Task created");
                            }}>
                              <ListTodo className="h-3.5 w-3.5 mr-2" /> Create Task
                            </DropdownMenuItem>
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
                                  <Mail className="h-3.5 w-3.5 mr-2" /> Email {agent.email}
                                </a>
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
