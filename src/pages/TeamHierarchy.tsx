import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  Users, ChevronDown, ChevronRight, Crown, Shield, User,
  ArrowRightLeft, Loader2, Search, ArrowUp, ArrowDown,
  Network, List,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useMyDownline } from "@/hooks/useMyDownline";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface AgentNode {
  id: string;
  name: string;
  avatarUrl?: string | null;
  userId?: string | null;
  role: "admin" | "manager" | "agent";
  managerId: string | null;
  isDeactivated: boolean;
  onboardingStage: string | null;
  teamCount: number;
  downlineTotal: number;
}

const roleConfig = {
  admin: {
    ring: "ring-2 ring-amber-400/60",
    badge: "bg-amber-400/15 text-amber-400 border-amber-400/30",
    fallbackBg: "bg-gradient-to-br from-amber-500/30 to-amber-600/20 text-amber-300",
    icon: Crown,
    label: "Admin",
    nodeBg: "#f59e0b",
  },
  manager: {
    ring: "ring-2 ring-emerald-400/60",
    badge: "bg-emerald-400/15 text-emerald-400 border-emerald-400/30",
    fallbackBg: "bg-gradient-to-br from-emerald-500/30 to-emerald-600/20 text-emerald-300",
    icon: Shield,
    label: "Manager",
    nodeBg: "#22c55e",
  },
  agent: {
    ring: "ring-1 ring-border/50",
    badge: "bg-muted/50 text-muted-foreground border-border/50",
    fallbackBg: "bg-gradient-to-br from-muted/50 to-muted/30 text-muted-foreground",
    icon: User,
    label: "Agent",
    nodeBg: "#64748b",
  },
};

type ViewMode = "list" | "chart";

export default function TeamHierarchy() {
  const { isAdmin, isManager } = useAuth();
  const queryClient = useQueryClient();
  const { data: downlineIds = [] } = useMyDownline();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [view, setView] = useState<ViewMode>("list");
  const [reassignAgent, setReassignAgent] = useState<AgentNode | null>(null);
  const [newManagerId, setNewManagerId] = useState("");
  const [saving, setSaving] = useState(false);
  const [promoteAgent, setPromoteAgent] = useState<AgentNode | null>(null);
  const [promoteDirection, setPromoteDirection] = useState<"up" | "down">("up");
  const [promoteSaving, setPromoteSaving] = useState(false);

  const { data: agents = [], isLoading } = useQuery({
    queryKey: ["hierarchy", isAdmin, downlineIds.join(",")],
    queryFn: async (): Promise<AgentNode[]> => {
      let agentQ = supabase
        .from("agents")
        .select(`
          id, user_id, display_name, is_deactivated, onboarding_stage,
          invited_by_manager_id,
          profile:profiles!agents_profile_id_fkey(full_name, avatar_url)
        `);

      if (!isAdmin && downlineIds.length > 0) {
        agentQ = agentQ.in("id", downlineIds);
      }

      const { data: agentData } = await agentQ;

      const userIds = (agentData || []).map((a: any) => a.user_id).filter(Boolean);
      const { data: roleData } = userIds.length
        ? await supabase.from("user_roles").select("user_id, role").in("user_id", userIds)
        : { data: [] as any[] };
      const roleMap = new Map<string, "admin" | "manager" | "agent">(
        (roleData || []).map((r: any) => [r.user_id, r.role as any])
      );

      const directCounts = new Map<string, number>();
      for (const a of (agentData || []) as any[]) {
        if (a.invited_by_manager_id) {
          directCounts.set(a.invited_by_manager_id, (directCounts.get(a.invited_by_manager_id) || 0) + 1);
        }
      }

      const ids = (agentData || []).map((a: any) => a.id);
      const downlineCounts = new Map<string, number>();
      for (const id of ids) downlineCounts.set(id, 1);

      const potentialManagers = ((agentData || []) as any[])
        .filter((a) => directCounts.has(a.id))
        .map((a) => a.id);

      for (const mgrId of potentialManagers) {
        const { data: dlData } = await supabase.rpc("get_downline_agent_ids", { p_root_agent_id: mgrId });
        downlineCounts.set(mgrId, (dlData || []).length);
      }

      return ((agentData || []) as any[]).map((a: any): AgentNode => ({
        id: a.id,
        name: a.profile?.full_name || a.display_name || "Unknown",
        avatarUrl: a.profile?.avatar_url || null,
        userId: a.user_id,
        role: roleMap.get(a.user_id) || "agent",
        managerId: a.invited_by_manager_id,
        isDeactivated: a.is_deactivated || false,
        onboardingStage: a.onboarding_stage,
        teamCount: directCounts.get(a.id) || 0,
        downlineTotal: downlineCounts.get(a.id) || 1,
      }));
    },
    enabled: isAdmin || isManager,
  });

  const tree = useMemo(() => {
    const byId = new Map(agents.map((a) => [a.id, a]));
    const roots: AgentNode[] = [];
    const childrenOf = new Map<string, AgentNode[]>();

    for (const a of agents) {
      if (!a.managerId || !byId.has(a.managerId)) {
        roots.push(a);
      } else {
        if (!childrenOf.has(a.managerId)) childrenOf.set(a.managerId, []);
        childrenOf.get(a.managerId)!.push(a);
      }
    }

    const rolePriority = { admin: 0, manager: 1, agent: 2 };
    const sortFn = (a: AgentNode, b: AgentNode) =>
      rolePriority[a.role] - rolePriority[b.role] || a.name.localeCompare(b.name);
    roots.sort(sortFn);
    for (const arr of childrenOf.values()) arr.sort(sortFn);

    return { roots, childrenOf };
  }, [agents]);

  const filteredAgents = useMemo(() => {
    if (!search.trim()) return agents;
    const q = search.toLowerCase();
    return agents.filter((a) => a.name.toLowerCase().includes(q));
  }, [agents, search]);

  const possibleManagers = useMemo(
    () => agents.filter((a) => a.role === "manager" || a.role === "admin"),
    [agents]
  );

  const visibleExpanded = useMemo(() => {
    if (!search.trim()) return expanded;
    const result = new Set(expanded);
    const matches = filteredAgents.map((a) => a.id);
    for (const id of matches) {
      let node = agents.find((a) => a.id === id);
      while (node?.managerId) {
        result.add(node.managerId);
        node = agents.find((a) => a.id === node!.managerId);
      }
    }
    return result;
  }, [expanded, search, filteredAgents, agents]);

  const toggle = (id: string) => {
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpanded(next);
  };

  const expandAll = () => {
    const all = new Set(agents.filter((a) => a.teamCount > 0).map((a) => a.id));
    setExpanded(all);
  };
  const collapseAll = () => setExpanded(new Set());

  const handleReassign = async () => {
    if (!reassignAgent) return;
    setSaving(true);
    try {
      const newId = newManagerId === "__none__" ? null : newManagerId || null;
      const { error } = await supabase
        .from("agents")
        .update({ invited_by_manager_id: newId })
        .eq("id", reassignAgent.id);
      if (error) throw error;
      toast.success(`${reassignAgent.name} reassigned`);
      setReassignAgent(null);
      setNewManagerId("");
      queryClient.invalidateQueries({ queryKey: ["hierarchy"] });
    } catch (e: any) {
      toast.error("Failed: " + (e.message || "unknown"));
    } finally {
      setSaving(false);
    }
  };

  const handlePromote = async () => {
    if (!promoteAgent || !promoteAgent.userId) return;
    setPromoteSaving(true);
    try {
      const newRole =
        promoteDirection === "up"
          ? promoteAgent.role === "agent"
            ? "manager"
            : "admin"
          : promoteAgent.role === "admin"
          ? "manager"
          : "agent";

      await supabase.from("user_roles").delete().eq("user_id", promoteAgent.userId);
      const { error } = await supabase.from("user_roles").insert({
        user_id: promoteAgent.userId,
        role: newRole,
      });
      if (error) throw error;

      toast.success(
        `${promoteAgent.name} ${promoteDirection === "up" ? "promoted to" : "demoted to"} ${newRole}.`
      );
      setPromoteAgent(null);
      queryClient.invalidateQueries({ queryKey: ["hierarchy"] });
    } catch (e: any) {
      toast.error("Failed: " + (e.message || "unknown"));
    } finally {
      setPromoteSaving(false);
    }
  };

  if (!isAdmin && !isManager) {
    return (
      <div className="p-6 text-muted-foreground">
        Manager or admin access required.
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-5 page-enter">
      <PageHeader
        accent="primary"
        eyebrow="Admin · Structure"
        eyebrowIcon={<Users className="h-3 w-3" />}
        title="Team Hierarchy"
        subtitle={isAdmin ? "Full agency structure — every manager, every downline, every direct." : "Your downline — recruits and the agents they brought in."}
      />
      <div className="flex items-center justify-end flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 rounded-lg border border-border p-0.5">
            <Button
              size="sm"
              variant={view === "list" ? "default" : "ghost"}
              className="h-8 gap-1.5"
              onClick={() => setView("list")}
            >
              <List className="h-3.5 w-3.5" /> List
            </Button>
            <Button
              size="sm"
              variant={view === "chart" ? "default" : "ghost"}
              className="h-8 gap-1.5"
              onClick={() => setView("chart")}
            >
              <Network className="h-3.5 w-3.5" /> Chart
            </Button>
          </div>

          {view === "list" && (
            <>
              <Button size="sm" variant="outline" onClick={expandAll}>Expand all</Button>
              <Button size="sm" variant="outline" onClick={collapseAll}>Collapse all</Button>
            </>
          )}
        </div>
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search agents..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : agents.length === 0 ? (
        <div className="p-8 text-center text-muted-foreground">No agents to display.</div>
      ) : view === "list" ? (
        <ListView
          roots={tree.roots}
          childrenOf={tree.childrenOf}
          expanded={visibleExpanded}
          onToggle={toggle}
          onReassign={setReassignAgent}
          onPromote={(a, dir) => {
            setPromoteAgent(a);
            setPromoteDirection(dir);
          }}
          isAdmin={isAdmin}
          searchActive={!!search.trim()}
          filteredIds={new Set(filteredAgents.map((a) => a.id))}
        />
      ) : (
        <ChartView roots={tree.roots} childrenOf={tree.childrenOf} />
      )}

      <Dialog open={!!reassignAgent} onOpenChange={(o) => !o && setReassignAgent(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reassign {reassignAgent?.name}</DialogTitle>
            <DialogDescription>
              Change which manager {reassignAgent?.name} reports to. Their downline stays with them.
            </DialogDescription>
          </DialogHeader>
          <Select value={newManagerId} onValueChange={setNewManagerId}>
            <SelectTrigger><SelectValue placeholder="Pick new manager..." /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">— No manager (top level) —</SelectItem>
              {possibleManagers
                .filter((m) => m.id !== reassignAgent?.id)
                .map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.name} ({roleConfig[m.role].label})
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setReassignAgent(null)}>Cancel</Button>
            <Button onClick={handleReassign} disabled={saving}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!promoteAgent} onOpenChange={(o) => !o && setPromoteAgent(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {promoteDirection === "up" ? "Promote" : "Demote"} {promoteAgent?.name}
            </DialogTitle>
            <DialogDescription>
              Current role: <strong>{promoteAgent ? roleConfig[promoteAgent.role].label : ""}</strong>.
              New role:{" "}
              <strong>
                {promoteAgent &&
                  (promoteDirection === "up"
                    ? promoteAgent.role === "agent"
                      ? "Manager"
                      : "Admin"
                    : promoteAgent.role === "admin"
                    ? "Manager"
                    : "Agent")}
              </strong>
              . Comp rates will auto-update.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPromoteAgent(null)}>Cancel</Button>
            <Button onClick={handlePromote} disabled={promoteSaving}>
              {promoteDirection === "up" ? "Promote" : "Demote"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ListView({
  roots, childrenOf, expanded, onToggle, onReassign, onPromote, isAdmin, searchActive, filteredIds,
}: {
  roots: AgentNode[];
  childrenOf: Map<string, AgentNode[]>;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  onReassign: (a: AgentNode) => void;
  onPromote: (a: AgentNode, dir: "up" | "down") => void;
  isAdmin: boolean;
  searchActive: boolean;
  filteredIds: Set<string>;
}) {
  function showInSubtree(n: AgentNode): boolean {
    if (filteredIds.has(n.id)) return true;
    for (const c of childrenOf.get(n.id) || []) if (showInSubtree(c)) return true;
    return false;
  }

  const renderNode = (node: AgentNode, depth: number): JSX.Element | null => {
    const cfg = roleConfig[node.role];
    const Icon = cfg.icon;
    const children = childrenOf.get(node.id) || [];
    const isExpanded = expanded.has(node.id);
    const showNode = !searchActive || filteredIds.has(node.id) || children.some((c) => showInSubtree(c));

    if (!showNode) return null;

    return (
      <div key={node.id} className="group/row">
        <div
          className={cn(
            "flex items-center gap-3 py-2 px-2 rounded-lg hover:bg-muted/30 transition",
            searchActive && !filteredIds.has(node.id) && "opacity-50"
          )}
          style={{ paddingLeft: `${depth * 24 + 8}px` }}
        >
          {children.length > 0 ? (
            <button
              onClick={() => onToggle(node.id)}
              className="w-5 shrink-0 text-muted-foreground hover:text-foreground"
            >
              {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </button>
          ) : (
            <div className="w-5 shrink-0" />
          )}

          <div className={cn("rounded-full", cfg.ring)}>
            <Avatar className="h-8 w-8">
              <AvatarImage src={node.avatarUrl || undefined} />
              <AvatarFallback className={cfg.fallbackBg}>
                {node.name.slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium text-sm truncate">{node.name}</span>
              <Badge variant="outline" className={cn("text-[10px]", cfg.badge)}>
                <Icon className="h-2.5 w-2.5 mr-0.5" /> {cfg.label}
              </Badge>
              {node.teamCount > 0 && (
                <Badge variant="outline" className="text-[10px]">
                  {node.teamCount} direct · {node.downlineTotal} total
                </Badge>
              )}
              {node.isDeactivated && (
                <Badge variant="outline" className="text-[10px] bg-red-500/10 text-red-400 border-red-500/30">
                  Inactive
                </Badge>
              )}
            </div>
          </div>

          {isAdmin && (
            <div className="flex items-center gap-1 opacity-0 group-hover/row:opacity-100 transition">
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs"
                onClick={() => onReassign(node)}
                title="Reassign manager"
              >
                <ArrowRightLeft className="h-3 w-3" />
              </Button>
              {node.role !== "admin" && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs"
                  onClick={() => onPromote(node, "up")}
                  title="Promote"
                >
                  <ArrowUp className="h-3 w-3" />
                </Button>
              )}
              {node.role !== "agent" && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs"
                  onClick={() => onPromote(node, "down")}
                  title="Demote"
                >
                  <ArrowDown className="h-3 w-3" />
                </Button>
              )}
            </div>
          )}
        </div>

        <AnimatePresence>
          {isExpanded && children.length > 0 && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="overflow-hidden"
            >
              {children.map((c) => renderNode(c, depth + 1))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  };

  return (
    <div className="rounded-xl border border-border bg-card">
      {roots.map((root) => renderNode(root, 0))}
    </div>
  );
}

function ChartView({ roots, childrenOf }: {
  roots: AgentNode[];
  childrenOf: Map<string, AgentNode[]>;
}) {
  interface Positioned {
    node: AgentNode;
    x: number;
    y: number;
    width: number;
    children: Positioned[];
  }

  const NODE_W = 160;
  const NODE_H = 80;
  const H_GAP = 20;
  const V_GAP = 70;

  function layout(node: AgentNode, depth: number): Positioned {
    const kids = (childrenOf.get(node.id) || []).map((c) => layout(c, depth + 1));
    if (kids.length === 0) {
      return { node, x: 0, y: depth * (NODE_H + V_GAP), width: NODE_W + H_GAP, children: [] };
    }
    let offset = 0;
    for (const k of kids) {
      k.x = offset;
      offset += k.width;
    }
    const totalW = offset;
    return { node, x: (totalW - NODE_W) / 2, y: depth * (NODE_H + V_GAP), width: totalW, children: kids };
  }

  let xOffset = 0;
  const positionedRoots: Positioned[] = roots.map((r) => {
    const p = layout(r, 0);
    p.x += xOffset;
    xOffset += p.width;
    return p;
  });

  function propagate(p: Positioned): void {
    for (const c of p.children) {
      c.x += p.x;
      propagate(c);
    }
  }
  for (const r of positionedRoots) propagate(r);

  const allNodes: Positioned[] = [];
  function collect(p: Positioned) {
    allNodes.push(p);
    for (const c of p.children) collect(c);
  }
  for (const r of positionedRoots) collect(r);

  const maxX = Math.max(...allNodes.map((n) => n.x + NODE_W), 600);
  const maxY = Math.max(...allNodes.map((n) => n.y + NODE_H), 400);

  interface Edge { x1: number; y1: number; x2: number; y2: number; }
  const edges: Edge[] = [];
  for (const p of allNodes) {
    const parentCx = p.x + NODE_W / 2;
    const parentBottom = p.y + NODE_H;
    for (const c of p.children) {
      const childCx = c.x + NODE_W / 2;
      const childTop = c.y;
      edges.push({ x1: parentCx, y1: parentBottom, x2: childCx, y2: childTop });
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card p-4 overflow-auto">
      <svg
        width={maxX + 40}
        height={maxY + 40}
        viewBox={`0 0 ${maxX + 40} ${maxY + 40}`}
        className="min-w-full"
      >
        {edges.map((e, i) => (
          <path
            key={i}
            d={`M ${e.x1} ${e.y1} C ${e.x1} ${(e.y1 + e.y2) / 2}, ${e.x2} ${(e.y1 + e.y2) / 2}, ${e.x2} ${e.y2}`}
            fill="none"
            stroke="hsl(var(--border))"
            strokeWidth="1.5"
          />
        ))}

        {allNodes.map((p) => {
          const cfg = roleConfig[p.node.role];
          return (
            <g key={p.node.id} transform={`translate(${p.x}, ${p.y})`}>
              <rect
                width={NODE_W}
                height={NODE_H}
                rx={8}
                ry={8}
                fill="hsl(var(--card))"
                stroke={cfg.nodeBg}
                strokeWidth="1.5"
              />
              <circle cx={22} cy={22} r={12} fill={cfg.nodeBg} />
              <text x={22} y={26} textAnchor="middle" fontSize="10" fill="white" fontWeight="bold">
                {p.node.name.slice(0, 2).toUpperCase()}
              </text>
              <text x={42} y={25} fontSize="11" fontWeight="600" fill="hsl(var(--foreground))">
                {p.node.name.length > 14 ? p.node.name.slice(0, 14) + "…" : p.node.name}
              </text>
              <text x={42} y={40} fontSize="9" fill={cfg.nodeBg} fontWeight="500">
                {cfg.label.toUpperCase()}
              </text>
              {p.node.teamCount > 0 && (
                <text
                  x={NODE_W / 2}
                  y={NODE_H - 12}
                  textAnchor="middle"
                  fontSize="10"
                  fill="hsl(var(--muted-foreground))"
                >
                  {p.node.teamCount} direct · {p.node.downlineTotal} total
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
