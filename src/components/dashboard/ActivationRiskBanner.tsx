import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle, ChevronDown, ChevronUp, UserMinus, RotateCcw, EyeOff,
  Loader2, Phone, Mail, MessageSquare, ListTodo, MoreVertical,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { GlassCard } from "@/components/ui/glass-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { supabase } from "@/integrations/supabase/client";
import { subDays, format, differenceInDays } from "date-fns";
import { toast } from "sonner";
import { DeactivateAgentDialog } from "./DeactivateAgentDialog";
import { useSoundEffects } from "@/hooks/useSoundEffects";

interface AtRiskAgent {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  lastProductionDate: string | null;
  daysInactive: number;
  managerId?: string;
}

export function ActivationRiskBanner() {
  const queryClient = useQueryClient();
  const { playSound } = useSoundEffects();
  const [expanded, setExpanded] = useState(false);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [deactivateAgent, setDeactivateAgent] = useState<{ id: string; name: string; managerId?: string } | null>(null);

  const { data: atRiskAgents = [] } = useQuery({
    queryKey: ["activation-risk-agents"],
    queryFn: async () => {
      const { data: agents } = await supabase
        .from("agents")
        .select("id, user_id, profile_id, invited_by_manager_id")
        .eq("status", "active")
        .eq("is_deactivated", false)
        .eq("is_inactive", false);

      if (!agents || agents.length === 0) return [];

      const cutoff = format(subDays(new Date(), 14), "yyyy-MM-dd");
      const agentIds = agents.map((a) => a.id);

      const { data: recentProd } = await supabase
        .from("daily_production")
        .select("agent_id, production_date")
        .in("agent_id", agentIds)
        .gte("production_date", cutoff);

      const activeAgentIds = new Set(recentProd?.map((p) => p.agent_id) || []);
      const atRiskAgentRecords = agents.filter((a) => !activeAgentIds.has(a.id));

      if (atRiskAgentRecords.length === 0) return [];

      const atRiskIds = atRiskAgentRecords.map((a) => a.id);
      const { data: lastProd } = await supabase
        .from("daily_production")
        .select("agent_id, production_date")
        .in("agent_id", atRiskIds)
        .order("production_date", { ascending: false });

      const lastProdMap = new Map<string, string>();
      lastProd?.forEach((p) => {
        if (!lastProdMap.has(p.agent_id)) {
          lastProdMap.set(p.agent_id, p.production_date);
        }
      });

      const userIds = atRiskAgentRecords.map((a) => a.user_id).filter(Boolean) as string[];
      const { data: profiles } = userIds.length > 0
        ? await supabase.from("profiles").select("user_id, full_name, email, phone").in("user_id", userIds)
        : { data: [] };

      const profileMap = new Map(
        (profiles || []).map((p: any) => [p.user_id, p]),
      );

      const now = new Date();
      return atRiskAgentRecords.map((agent): AtRiskAgent => {
        const lastDate = lastProdMap.get(agent.id) || null;
        const daysInactive = lastDate
          ? differenceInDays(now, new Date(lastDate))
          : differenceInDays(now, new Date());
        const profile: any = agent.user_id ? profileMap.get(agent.user_id) : undefined;
        return {
          id: agent.id,
          name: profile?.full_name || "Unknown Agent",
          email: profile?.email || null,
          phone: profile?.phone || null,
          lastProductionDate: lastDate,
          daysInactive: lastDate ? daysInactive : -1,
          managerId: agent.invited_by_manager_id || undefined,
        };
      }).sort((a, b) => b.daysInactive - a.daysInactive);
    },
    staleTime: 300_000,
  });

  const visibleAgents = useMemo(
    () => atRiskAgents.filter((a) => !dismissedIds.has(a.id)),
    [atRiskAgents, dismissedIds],
  );

  if (visibleAgents.length === 0) return null;

  const handleMoveToInactive = async (agent: AtRiskAgent) => {
    setLoadingId(agent.id);
    try {
      const { error } = await supabase.from("agents").update({ is_inactive: true }).eq("id", agent.id);
      if (error) throw error;
      toast.success(`${agent.name} moved to inactive`);
      playSound("success");
      queryClient.invalidateQueries({ queryKey: ["activation-risk-agents"] });
    } catch {
      toast.error("Failed to update agent");
      playSound("error");
    } finally {
      setLoadingId(null);
    }
  };

  const handleReactivate = async (agent: AtRiskAgent) => {
    setLoadingId(agent.id);
    try {
      const { error } = await supabase
        .from("agents")
        .update({ status: "active" as any, is_deactivated: false, is_inactive: false, deactivation_reason: null })
        .eq("id", agent.id);
      if (error) throw error;
      toast.success(`${agent.name} reactivated`);
      playSound("success");
      queryClient.invalidateQueries({ queryKey: ["activation-risk-agents"] });
    } catch {
      toast.error("Failed to reactivate");
      playSound("error");
    } finally {
      setLoadingId(null);
    }
  };

  const createFollowupTask = async (agent: AtRiskAgent) => {
    const { error } = await supabase.from("agent_tasks").insert({
      agent_id: agent.id,
      title: `Revive ${agent.name} — ${agent.daysInactive === -1 ? "never produced" : `${agent.daysInactive}d inactive`}`,
      description: "Agent flagged in Activation Risk banner. Reach out, diagnose what's blocking them, and get them back to production.",
      due_date: new Date(Date.now() + 24 * 3600 * 1000).toISOString().split("T")[0],
      priority: "high",
      status: "pending",
      task_type: "followup",
      created_at: new Date().toISOString(),
    });
    if (error) { toast.error(error.message); return; }
    toast.success(`Task created for ${agent.name}`);
  };

  const handleDismiss = (agentId: string) => {
    setDismissedIds((prev) => new Set([...prev, agentId]));
    toast.info("Hidden for this session");
  };

  const bulkSMS = () => {
    const picks = visibleAgents.filter((a) => a.phone);
    if (picks.length === 0) { toast.error("No phones available"); return; }
    window.location.href = `sms:${picks.map((a) => a.phone).join(",")}`;
    toast.success(`Opening SMS for ${picks.length}`);
  };

  const bulkEmail = () => {
    const picks = visibleAgents.filter((a) => a.email);
    if (picks.length === 0) { toast.error("No emails available"); return; }
    window.location.href = `mailto:${picks.map((a) => a.email).join(",")}`;
    toast.success(`Opening email for ${picks.length}`);
  };

  const bulkTask = async () => {
    setBulkLoading(true);
    try {
      const rows = visibleAgents.map((a) => ({
        agent_id: a.id,
        title: `Revive ${a.name} — ${a.daysInactive === -1 ? "never produced" : `${a.daysInactive}d inactive`}`,
        description: "Bulk-assigned from Activation Risk banner. Reach out and diagnose what's blocking them.",
        due_date: new Date(Date.now() + 24 * 3600 * 1000).toISOString().split("T")[0],
        priority: "high",
        status: "pending",
        task_type: "followup",
        created_at: new Date().toISOString(),
      }));
      const { error } = await supabase.from("agent_tasks").insert(rows);
      if (error) throw error;
      toast.success(`Tasks created for ${rows.length}`);
      playSound("celebrate");
    } catch (e: any) {
      toast.error(e.message || "Failed to create tasks");
      playSound("error");
    } finally {
      setBulkLoading(false);
    }
  };

  const handleBulkInactive = async () => {
    setBulkLoading(true);
    try {
      const ids = visibleAgents.map((a) => a.id);
      const { error } = await supabase.from("agents").update({ is_inactive: true }).in("id", ids);
      if (error) throw error;
      toast.success(`${ids.length} agents moved to inactive`);
      playSound("celebrate");
      queryClient.invalidateQueries({ queryKey: ["activation-risk-agents"] });
    } catch {
      toast.error("Failed to update agents");
      playSound("error");
    } finally {
      setBulkLoading(false);
    }
  };

  return (
    <>
      <GlassCard className="p-3 border-amber-500/30 bg-amber-500/5">
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full flex items-center gap-2 text-left"
        >
          <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />
          <span className="text-sm font-medium text-amber-400">Activation Risk</span>
          <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30 text-[10px] ml-auto mr-2">
            {visibleAgents.length} agent{visibleAgents.length > 1 ? "s" : ""}
          </Badge>
          {expanded ? <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />}
        </button>

        <p className="text-[11px] text-muted-foreground mt-1 pl-6">
          {visibleAgents.length} agent{visibleAgents.length > 1 ? "s have" : " has"} no production in 14+ days — tap to take action
        </p>

        <AnimatePresence>
          {expanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              {visibleAgents.length > 1 && (
                <div className="flex flex-wrap items-center gap-2 mt-3 p-2 rounded-lg bg-amber-500/10 border border-amber-500/20">
                  <span className="text-[11px] text-amber-400 font-medium">
                    Bulk actions for {visibleAgents.length}:
                  </span>
                  <Button size="sm" variant="outline" onClick={bulkSMS} className="h-7 text-[11px]">
                    <MessageSquare className="h-3 w-3 mr-1" /> Text All
                  </Button>
                  <Button size="sm" variant="outline" onClick={bulkEmail} className="h-7 text-[11px]">
                    <Mail className="h-3 w-3 mr-1" /> Email All
                  </Button>
                  <Button size="sm" variant="outline" onClick={bulkTask} disabled={bulkLoading} className="h-7 text-[11px]">
                    {bulkLoading ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <ListTodo className="h-3 w-3 mr-1" />}
                    Create Tasks
                  </Button>
                  <Button size="sm" variant="outline" onClick={handleBulkInactive} disabled={bulkLoading}
                    className="h-7 text-[11px] border-amber-500/40 text-amber-400 hover:bg-amber-500/10 ml-auto"
                  >
                    <UserMinus className="h-3 w-3 mr-1" /> Move All to Inactive
                  </Button>
                </div>
              )}

              <div className="mt-3 space-y-2 max-h-80 overflow-y-auto">
                {visibleAgents.map((agent) => (
                  <div
                    key={agent.id}
                    className="flex items-center gap-2 p-2 rounded-lg bg-background/50 border border-border/50"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium truncate">{agent.name}</p>
                      <p className="text-[10px] text-muted-foreground">
                        {agent.daysInactive === -1
                          ? "Never logged production"
                          : `${agent.daysInactive}d inactive · last: ${agent.lastProductionDate}`}
                      </p>
                    </div>

                    <div className="flex items-center gap-0.5 shrink-0">
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
                      <Button
                        size="sm" variant="ghost"
                        className="h-7 w-7 p-0"
                        title="Create follow-up task"
                        onClick={() => createFollowupTask(agent)}
                      >
                        <ListTodo className="h-3.5 w-3.5" />
                      </Button>

                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" disabled={loadingId === agent.id}>
                            {loadingId === agent.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MoreVertical className="h-3.5 w-3.5" />}
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-52">
                          <DropdownMenuItem onClick={() => handleReactivate(agent)}>
                            <RotateCcw className="h-3.5 w-3.5 mr-2" /> Reactivate
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={() => handleMoveToInactive(agent)}>
                            <UserMinus className="h-3.5 w-3.5 mr-2" /> Move to Inactive
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() =>
                              setDeactivateAgent({
                                id: agent.id,
                                name: agent.name,
                                managerId: agent.managerId,
                              })
                            }
                          >
                            <UserMinus className="h-3.5 w-3.5 mr-2" /> Deactivate (with reason)
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={() => handleDismiss(agent.id)}>
                            <EyeOff className="h-3.5 w-3.5 mr-2" /> Hide for this session
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </GlassCard>

      {deactivateAgent && (
        <DeactivateAgentDialog
          open={!!deactivateAgent}
          onOpenChange={(open) => !open && setDeactivateAgent(null)}
          agentId={deactivateAgent.id}
          agentName={deactivateAgent.name}
          currentManagerId={deactivateAgent.managerId}
          onComplete={() => {
            setDeactivateAgent(null);
            queryClient.invalidateQueries({ queryKey: ["activation-risk-agents"] });
          }}
        />
      )}
    </>
  );
}
