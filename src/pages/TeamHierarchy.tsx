import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Users, ChevronDown, ChevronRight, Crown, Shield, User,
  ArrowRightLeft, Loader2, Search, Sparkles, ArrowUp, ArrowDown,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
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
  avatarUrl?: string;
  userId?: string | null;
  role: "admin" | "manager" | "agent";
  managerId: string | null;
  isDeactivated: boolean;
  onboardingStage: string | null;
  teamCount: number;
}

const roleConfig = {
  admin: {
    ring: "ring-2 ring-amber-400/60 shadow-[0_0_12px_rgba(245,158,11,0.4)]",
    badge: "bg-amber-400/15 text-amber-400 border-amber-400/30",
    fallbackBg: "bg-gradient-to-br from-amber-500/30 to-amber-600/20 text-amber-300",
    icon: Crown,
    label: "Admin",
    statBg: "from-amber-500/10 to-amber-600/5 border-amber-500/20",
    glow: "shadow-[0_0_20px_rgba(245,158,11,0.15)]",
  },
  manager: {
    ring: "ring-2 ring-emerald-400/60 shadow-[0_0_12px_rgba(34,211,165,0.4)]",
    badge: "bg-emerald-400/15 text-emerald-400 border-emerald-400/30",
    fallbackBg: "bg-gradient-to-br from-emerald-500/30 to-emerald-600/20 text-emerald-300",
    icon: Shield,
    label: "Manager",
    statBg: "from-emerald-500/10 to-emerald-600/5 border-emerald-500/20",
    glow: "shadow-[0_0_20px_rgba(34,211,165,0.15)]",
  },
  agent: {
    ring: "ring-1 ring-border/50",
    badge: "bg-muted/50 text-muted-foreground border-border/50",
    fallbackBg: "bg-gradient-to-br from-muted/50 to-muted/30 text-muted-foreground",
    icon: User,
    label: "Agent",
    statBg: "from-muted/10 to-muted/5 border-border/30",
    glow: "",
  },
};

export default function TeamHierarchy() {
  const { isAdmin } = useAuth();
  const [agents, setAgents] = useState<AgentNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [reassignAgent, setReassignAgent] = useState<AgentNode | null>(null);
  const [newManagerId, setNewManagerId] = useState("");
  const [saving, setSaving] = useState(false);

  // Promotion/demotion state
  const [promoteAgent, setPromoteAgent] = useState<AgentNode | null>(null);
  const [promoteDirection, setPromoteDirection] = useState<"up" | "down">("up");
  const [promoteSaving, setPromoteSaving] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      const { data: agentsData } = await supabase
        .from("agents")
        .select("id, display_name, manager_id, is_deactivated, onboarding_stage, invited_by_manager_id, user_id")
        .eq("is_deactivated", false)
        .order("display_name");

      const allAgents = agentsData || [];

      const userIds = allAgents.filter(a => a.user_id).map(a => a.user_id!);
      const { data: profiles } = userIds.length > 0
        ? await supabase.from("profiles").select("user_id, avatar_url").in("user_id", userIds)
        : { data: [] };

      const profileMap = new Map((profiles || []).map(p => [p.user_id, p.avatar_url]));

      const managerIds = new Set(
        allAgents.filter(a => a.invited_by_manager_id).map(a => a.invited_by_manager_id!)
      );

      let adminUserIds = new Set<string>();
      try {
        const { data: adminRoles } = await supabase
          .from("user_roles")
          .select("user_id")
          .eq("role", "admin");
        if (adminRoles) adminUserIds = new Set(adminRoles.map(r => r.user_id));
      } catch { /* non-admins won't see this */ }

      const nodes: AgentNode[] = allAgents.map(a => {
        const isAdminUser = a.user_id ? adminUserIds.has(a.user_id) : false;
        const isManager = managerIds.has(a.id);
        const role: "admin" | "manager" | "agent" = isAdminUser ? "admin" : isManager ? "manager" : "agent";

        return {
          id: a.id,
          name: a.display_name || "Unknown",
          avatarUrl: a.user_id ? profileMap.get(a.user_id) || undefined : undefined,
          userId: a.user_id,
          role,
          managerId: a.invited_by_manager_id || a.manager_id,
          isDeactivated: a.is_deactivated || false,
          onboardingStage: a.onboarding_stage,
          teamCount: 0,
        };
      });

      nodes.forEach(n => {
        if (n.managerId) {
          const mgr = nodes.find(m => m.id === n.managerId);
          if (mgr) mgr.teamCount++;
        }
      });

      setAgents(nodes);
      const autoExpand = new Set<string>();
      nodes.filter(n => n.role === "admin" || n.role === "manager").forEach(n => autoExpand.add(n.id));
      setExpanded(autoExpand);
      setLoading(false);
    };
    fetchData();
  }, []);

  const toggleExpand = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleReassign = async () => {
    if (!reassignAgent || !newManagerId) return;
    setSaving(true);
    const { error } = await supabase
      .from("agents")
      .update({ invited_by_manager_id: newManagerId, manager_id: newManagerId })
      .eq("id", reassignAgent.id);
    if (error) toast.error("Reassign failed");
    else {
      toast.success(`${reassignAgent.name} reassigned`);
      setAgents(prev => prev.map(a =>
        a.id === reassignAgent.id ? { ...a, managerId: newManagerId } : a
      ));
    }
    setSaving(false);
    setReassignAgent(null);
    setNewManagerId("");
  };

  const handlePromote = async () => {
    if (!promoteAgent || !promoteAgent.userId) return;
    setPromoteSaving(true);

    if (promoteDirection === "up") {
      // Promote agent → manager (add manager role)
      const { error } = await supabase
        .from("user_roles")
        .insert({ user_id: promoteAgent.userId, role: "manager" as any });
      if (error && !error.message.includes("duplicate")) {
        toast.error("Promotion failed");
      } else {
        toast.success(`${promoteAgent.name} promoted to Manager`);
        setAgents(prev => prev.map(a =>
          a.id === promoteAgent.id ? { ...a, role: "manager" } : a
        ));
      }
    } else {
      // Demote manager → agent (remove manager role)
      const { error } = await supabase
        .from("user_roles")
        .delete()
        .eq("user_id", promoteAgent.userId)
        .eq("role", "manager" as any);
      if (error) {
        toast.error("Demotion failed");
      } else {
        toast.success(`${promoteAgent.name} demoted to Agent`);
        setAgents(prev => prev.map(a =>
          a.id === promoteAgent.id ? { ...a, role: "agent" } : a
        ));
      }
    }

    setPromoteSaving(false);
    setPromoteAgent(null);
  };

  const agentIdSet = new Set(agents.map(a => a.id));
  const topLevel = agents.filter(a => !a.managerId || !agentIdSet.has(a.managerId));
  const getChildren = (parentId: string) =>
    agents.filter(a => a.managerId === parentId && a.id !== parentId);

  const filtered = search
    ? agents.filter(a => a.name.toLowerCase().includes(search.toLowerCase()))
    : [];

  const renderNode = (node: AgentNode, depth: number = 0, index: number = 0) => {
    const children = getChildren(node.id);
    const isExpanded = expanded.has(node.id);
    const hasChildren = children.length > 0;
    const cfg = roleConfig[node.role];
    const RoleIcon = cfg.icon;

    const canPromote = isAdmin && node.role === "agent" && !!node.userId;
    const canDemote = isAdmin && node.role === "manager" && !!node.userId;

    return (
      <motion.div
        key={node.id}
        initial={{ opacity: 0, x: -16 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.3, delay: index * 0.04 }}
      >
        <div className={cn("relative", depth > 0 && "ml-6")}>
          {depth > 0 && (
            <div className="absolute left-[-12px] top-0 bottom-0 w-px bg-border/30" />
          )}
          {depth > 0 && (
            <div className="absolute left-[-12px] top-5 w-3 h-px bg-border/30" />
          )}

          <div className={cn(
            "flex items-center gap-3 px-3 py-2.5 rounded-xl border border-transparent transition-all duration-200 group cursor-pointer",
            "hover:border-primary/20 hover:bg-card/60 hover:shadow-lg hover:shadow-primary/5 hover:scale-[1.01]",
            depth === 0 && "bg-card/40 border-border/30 backdrop-blur-sm",
            cfg.glow && depth === 0 && cfg.glow,
          )}>
            {/* Expand toggle */}
            <button
              onClick={() => hasChildren && toggleExpand(node.id)}
              className={cn(
                "w-5 h-5 flex items-center justify-center shrink-0 transition-transform duration-200",
                !hasChildren && "opacity-0 pointer-events-none",
              )}
            >
              <motion.div animate={{ rotate: isExpanded ? 90 : 0 }} transition={{ duration: 0.2 }}>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </motion.div>
            </button>

            {/* Avatar */}
            <div className={cn("relative shrink-0 rounded-full", cfg.ring)}>
              <Avatar className="h-9 w-9">
                <AvatarImage src={node.avatarUrl || ""} className="object-cover" />
                <AvatarFallback className={cn("text-xs font-semibold font-['Syne']", cfg.fallbackBg)}>
                  {node.name.charAt(0)}
                </AvatarFallback>
              </Avatar>
            </div>

            {/* Name + badge */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-sm truncate font-['DM_Sans']">{node.name}</span>
                <Badge variant="outline" className={cn("text-[9px] px-1.5 py-0 h-4 border font-['Syne'] font-bold uppercase tracking-wider", cfg.badge)}>
                  {cfg.label}
                </Badge>
                {hasChildren && (
                  <span className="text-[10px] text-muted-foreground bg-muted/30 px-1.5 py-0.5 rounded-full">
                    {children.length}
                  </span>
                )}
              </div>
            </div>

            {/* Actions */}
            {isAdmin && node.role !== "admin" && (
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                {canPromote && (
                  <Button
                    variant="ghost" size="sm"
                    className="h-7 text-xs font-['Syne'] font-bold text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10"
                    onClick={(e) => { e.stopPropagation(); setPromoteAgent(node); setPromoteDirection("up"); }}
                  >
                    <ArrowUp className="h-3 w-3 mr-1" /> Promote
                  </Button>
                )}
                {canDemote && (
                  <Button
                    variant="ghost" size="sm"
                    className="h-7 text-xs font-['Syne'] font-bold text-amber-400 hover:text-amber-300 hover:bg-amber-500/10"
                    onClick={(e) => { e.stopPropagation(); setPromoteAgent(node); setPromoteDirection("down"); }}
                  >
                    <ArrowDown className="h-3 w-3 mr-1" /> Demote
                  </Button>
                )}
                <Button
                  variant="ghost" size="sm"
                  className="h-7 text-xs font-['Syne'] font-bold"
                  onClick={(e) => { e.stopPropagation(); setReassignAgent(node); setNewManagerId(node.managerId || ""); }}
                >
                  <ArrowRightLeft className="h-3 w-3 mr-1" /> Reassign
                </Button>
              </div>
            )}
          </div>

          {/* Children */}
          <AnimatePresence>
            {isExpanded && hasChildren && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.25, ease: "easeInOut" }}
                className="overflow-hidden"
              >
                <div className="mt-1 space-y-0.5">
                  {children.map((c, i) => renderNode(c, depth + 1, i))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const managerList = agents.filter(a => a.role === "manager" || a.role === "admin");
  const counts = {
    admin: agents.filter(a => a.role === "admin").length,
    manager: agents.filter(a => a.role === "manager").length,
    agent: agents.filter(a => a.role === "agent").length,
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center justify-between"
      >
        <div>
          <h1 className="text-2xl font-bold font-['Syne'] bg-gradient-to-r from-foreground via-foreground to-primary bg-clip-text text-transparent">
            Team Structure
          </h1>
          <p className="text-muted-foreground text-sm font-['DM_Sans']">
            {agents.length} active members
          </p>
        </div>
        <div className="flex items-center gap-1.5 text-primary/60">
          <Sparkles className="h-4 w-4" />
          <span className="text-xs font-['Syne'] font-bold uppercase tracking-wider">Live</span>
        </div>
      </motion.div>

      {/* Search */}
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search team members..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="pl-10 bg-card/30 border-border/40 backdrop-blur-sm focus:ring-2 focus:ring-primary/30 focus:border-primary/40 transition-all font-['DM_Sans']"
        />
      </motion.div>

      {/* Stat Cards */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15 }}
        className="grid grid-cols-3 gap-3"
      >
        {(["admin", "manager", "agent"] as const).map((role) => {
          const c = roleConfig[role];
          const Icon = c.icon;
          return (
            <div
              key={role}
              className={cn(
                "relative overflow-hidden rounded-xl border p-4 text-center bg-gradient-to-b backdrop-blur-sm transition-all duration-300 hover:scale-[1.02]",
                c.statBg,
              )}
            >
              <Icon className={cn(
                "h-5 w-5 mx-auto mb-2",
                role === "admin" && "text-amber-400",
                role === "manager" && "text-emerald-400",
                role === "agent" && "text-muted-foreground",
              )} />
              <p className="text-2xl font-bold font-['Syne']">{counts[role]}</p>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-['Syne'] font-bold mt-0.5">{c.label}s</p>
            </div>
          );
        })}
      </motion.div>

      {/* Tree */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="rounded-2xl border border-border/30 bg-card/20 backdrop-blur-sm p-4"
      >
        {search ? (
          <div className="space-y-1">
            {filtered.length === 0 && <p className="text-center text-muted-foreground py-8 font-['DM_Sans']">No results</p>}
            {filtered.map((n, i) => renderNode(n, 0, i))}
          </div>
        ) : (
          <div className="space-y-1">
            {topLevel.map((n, i) => renderNode(n, 0, i))}
            {topLevel.length === 0 && (
              <p className="text-center text-muted-foreground py-8 font-['DM_Sans']">No team structure found</p>
            )}
          </div>
        )}
      </motion.div>

      {/* Reassign Dialog */}
      <Dialog open={!!reassignAgent} onOpenChange={() => setReassignAgent(null)}>
        <DialogContent className="border-border/40 bg-card/95 backdrop-blur-xl">
          <DialogHeader>
            <DialogTitle className="font-['Syne']">Reassign {reassignAgent?.name}</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <label className="text-sm text-muted-foreground mb-2 block font-['DM_Sans']">New Manager</label>
            <Select value={newManagerId} onValueChange={setNewManagerId}>
              <SelectTrigger><SelectValue placeholder="Select manager" /></SelectTrigger>
              <SelectContent>
                {managerList.filter(m => m.id !== reassignAgent?.id).map(m => (
                  <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReassignAgent(null)} className="font-['Syne'] font-bold">Cancel</Button>
            <Button onClick={handleReassign} disabled={!newManagerId || saving} className="font-['Syne'] font-bold">
              {saving ? "Saving..." : "Reassign"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Promote/Demote Confirmation Dialog */}
      <Dialog open={!!promoteAgent} onOpenChange={() => setPromoteAgent(null)}>
        <DialogContent className="border-border/40 bg-card/95 backdrop-blur-xl">
          <DialogHeader>
            <DialogTitle className="font-['Syne']">
              {promoteDirection === "up" ? "Promote" : "Demote"} {promoteAgent?.name}?
            </DialogTitle>
            <DialogDescription className="font-['DM_Sans']">
              {promoteDirection === "up"
                ? `This will promote ${promoteAgent?.name} from Agent to Manager. They will gain access to management tools and be able to manage their own team.`
                : `This will demote ${promoteAgent?.name} from Manager to Agent. They will lose access to management tools.`
              }
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPromoteAgent(null)} className="font-['Syne'] font-bold">Cancel</Button>
            <Button
              onClick={handlePromote}
              disabled={promoteSaving}
              className={cn(
                "font-['Syne'] font-bold",
                promoteDirection === "down" && "bg-amber-500 hover:bg-amber-600 text-white"
              )}
            >
              {promoteSaving
                ? "Saving..."
                : promoteDirection === "up"
                  ? "Promote to Manager"
                  : "Demote to Agent"
              }
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
