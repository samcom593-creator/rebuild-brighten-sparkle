import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Users, ChevronDown, ChevronRight, Crown, Shield, User,
  ArrowRightLeft, Loader2, Search,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { GlassCard } from "@/components/ui/glass-card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface AgentNode {
  id: string;
  name: string;
  avatarUrl?: string;
  role: "admin" | "manager" | "agent";
  managerId: string | null;
  isDeactivated: boolean;
  onboardingStage: string | null;
  teamCount: number;
}

export default function TeamHierarchy() {
  const { isAdmin } = useAuth();
  const [agents, setAgents] = useState<AgentNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [reassignAgent, setReassignAgent] = useState<AgentNode | null>(null);
  const [newManagerId, setNewManagerId] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      // Fetch all active agents with user_id
      const { data: agentsData } = await supabase
        .from("agents")
        .select("id, display_name, manager_id, is_deactivated, onboarding_stage, invited_by_manager_id, user_id")
        .eq("is_deactivated", false)
        .order("display_name");

      const allAgents = agentsData || [];

      // Get profiles for avatars
      const userIds = allAgents.filter(a => a.user_id).map(a => a.user_id!);
      const { data: profiles } = userIds.length > 0
        ? await supabase.from("profiles").select("user_id, avatar_url").in("user_id", userIds)
        : { data: [] };

      const profileMap = new Map((profiles || []).map(p => [p.user_id, p.avatar_url]));

      // Determine roles by structure instead of user_roles table:
      // - If agent has others pointing to them via invited_by_manager_id → manager
      // - We'll also check user_roles for the current user's own role visibility
      const managerIds = new Set(
        allAgents
          .filter(a => a.invited_by_manager_id)
          .map(a => a.invited_by_manager_id!)
      );

      // Try to get admin roles - only works for admins due to RLS
      let adminUserIds = new Set<string>();
      try {
        const { data: adminRoles } = await supabase
          .from("user_roles")
          .select("user_id")
          .eq("role", "admin");
        if (adminRoles) {
          adminUserIds = new Set(adminRoles.map(r => r.user_id));
        }
      } catch { /* non-admins won't see this */ }

      const nodes: AgentNode[] = allAgents.map(a => {
        const isAdminUser = a.user_id ? adminUserIds.has(a.user_id) : false;
        const isManager = managerIds.has(a.id);
        const role: "admin" | "manager" | "agent" = isAdminUser ? "admin" : isManager ? "manager" : "agent";

        return {
          id: a.id,
          name: a.display_name || "Unknown",
          avatarUrl: a.user_id ? profileMap.get(a.user_id) || undefined : undefined,
          role,
          managerId: a.invited_by_manager_id || a.manager_id,
          isDeactivated: a.is_deactivated || false,
          onboardingStage: a.onboarding_stage,
          teamCount: 0,
        };
      });

      // Count team members
      nodes.forEach(n => {
        if (n.managerId) {
          const mgr = nodes.find(m => m.id === n.managerId);
          if (mgr) mgr.teamCount++;
        }
      });

      setAgents(nodes);

      // Auto-expand admins + managers
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
    if (error) { toast.error("Reassign failed"); }
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

  // Build tree - top level = nodes with no parent or whose parent isn't in the list
  const agentIdSet = new Set(agents.map(a => a.id));
  const topLevel = agents.filter(a => !a.managerId || !agentIdSet.has(a.managerId));

  const getChildren = (parentId: string) =>
    agents.filter(a => a.managerId === parentId && a.id !== parentId);

  const filtered = search
    ? agents.filter(a => a.name.toLowerCase().includes(search.toLowerCase()))
    : [];

  const RoleIcon = ({ role }: { role: string }) => {
    if (role === "admin") return <Crown className="h-3.5 w-3.5 text-amber-400" />;
    if (role === "manager") return <Shield className="h-3.5 w-3.5 text-primary" />;
    return <User className="h-3.5 w-3.5 text-muted-foreground" />;
  };

  const renderNode = (node: AgentNode, depth: number = 0) => {
    const children = getChildren(node.id);
    const isExpanded = expanded.has(node.id);
    const hasChildren = children.length > 0;

    return (
      <div key={node.id} style={{ marginLeft: depth * 24 }}>
        <div className={cn(
          "flex items-center gap-3 px-3 py-2.5 rounded-lg border border-transparent hover:border-border hover:bg-card/50 transition-all group",
          depth === 0 && "bg-card/30 border-border"
        )}>
          <button
            onClick={() => hasChildren && toggleExpand(node.id)}
            className={cn("w-5 h-5 flex items-center justify-center shrink-0", !hasChildren && "opacity-0")}
          >
            {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>

          <Avatar className="h-8 w-8 border border-border shrink-0">
            <AvatarImage src={node.avatarUrl || ""} />
            <AvatarFallback className="text-xs bg-muted">{node.name.charAt(0)}</AvatarFallback>
          </Avatar>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <RoleIcon role={node.role} />
              <span className="font-medium text-sm truncate">{node.name}</span>
              {hasChildren && (
                <Badge variant="outline" className="text-[9px] ml-1">{children.length}</Badge>
              )}
            </div>
          </div>

          {isAdmin && node.role !== "admin" && (
            <Button
              variant="ghost" size="sm"
              className="h-7 text-xs opacity-0 group-hover:opacity-100 transition-opacity"
              onClick={() => { setReassignAgent(node); setNewManagerId(node.managerId || ""); }}
            >
              <ArrowRightLeft className="h-3 w-3 mr-1" /> Reassign
            </Button>
          )}
        </div>

        {isExpanded && hasChildren && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            {children.map(c => renderNode(c, depth + 1))}
          </motion.div>
        )}
      </div>
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

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold font-['Syne']">Team Structure</h1>
          <p className="text-muted-foreground text-sm">{agents.length} active members</p>
        </div>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input placeholder="Search team members..." value={search} onChange={e => setSearch(e.target.value)} className="pl-10" />
      </div>

      <div className="grid grid-cols-3 gap-3">
        <GlassCard className="p-3 text-center">
          <Crown className="h-5 w-5 mx-auto mb-1 text-amber-400" />
          <p className="text-lg font-bold">{agents.filter(a => a.role === "admin").length}</p>
          <p className="text-[10px] text-muted-foreground">Admin</p>
        </GlassCard>
        <GlassCard className="p-3 text-center">
          <Shield className="h-5 w-5 mx-auto mb-1 text-primary" />
          <p className="text-lg font-bold">{agents.filter(a => a.role === "manager").length}</p>
          <p className="text-[10px] text-muted-foreground">Managers</p>
        </GlassCard>
        <GlassCard className="p-3 text-center">
          <User className="h-5 w-5 mx-auto mb-1 text-muted-foreground" />
          <p className="text-lg font-bold">{agents.filter(a => a.role === "agent").length}</p>
          <p className="text-[10px] text-muted-foreground">Agents</p>
        </GlassCard>
      </div>

      <GlassCard className="p-4">
        {search ? (
          <div className="space-y-1">
            {filtered.length === 0 && <p className="text-center text-muted-foreground py-4">No results</p>}
            {filtered.map(n => renderNode(n, 0))}
          </div>
        ) : (
          <div className="space-y-1">
            {topLevel.map(n => renderNode(n, 0))}
            {topLevel.length === 0 && (
              <p className="text-center text-muted-foreground py-8">No team structure found</p>
            )}
          </div>
        )}
      </GlassCard>

      <Dialog open={!!reassignAgent} onOpenChange={() => setReassignAgent(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reassign {reassignAgent?.name}</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <label className="text-sm text-muted-foreground mb-2 block">New Manager</label>
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
            <Button variant="outline" onClick={() => setReassignAgent(null)}>Cancel</Button>
            <Button onClick={handleReassign} disabled={!newManagerId || saving}>
              {saving ? "Saving..." : "Reassign"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}