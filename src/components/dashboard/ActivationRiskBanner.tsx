import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ChevronDown, ChevronUp, UserMinus, Settings, EyeOff, Users, Loader2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { GlassCard } from "@/components/ui/glass-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { subDays, format, differenceInDays } from "date-fns";
import { toast } from "sonner";
import { DeactivateAgentDialog } from "./DeactivateAgentDialog";

interface AtRiskAgent {
  id: string;
  name: string;
  lastProductionDate: string | null;
  daysInactive: number;
  managerId?: string;
}

export function ActivationRiskBanner() {
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [bulkLoading, setBulkLoading] = useState(false);

  // Deactivate dialog state
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

      // Get recent production
      const { data: recentProd } = await supabase
        .from("daily_production")
        .select("agent_id, production_date")
        .in("agent_id", agentIds)
        .gte("production_date", cutoff);

      const activeAgentIds = new Set(recentProd?.map((p) => p.agent_id) || []);
      const atRiskAgentRecords = agents.filter((a) => !activeAgentIds.has(a.id));

      if (atRiskAgentRecords.length === 0) return [];

      // Get last production date for each at-risk agent
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

      // Get profile names
      const userIds = atRiskAgentRecords.map((a) => a.user_id).filter(Boolean) as string[];
      const { data: profiles } = userIds.length > 0
        ? await supabase.from("profiles").select("user_id, full_name").in("user_id", userIds)
        : { data: [] };

      const nameMap = new Map<string, string>(
        (profiles?.map((p) => [p.user_id, p.full_name] as [string, string]) || [])
      );

      const now = new Date();
      return atRiskAgentRecords.map((agent): AtRiskAgent => {
        const lastDate = lastProdMap.get(agent.id) || null;
        const daysInactive = lastDate
          ? differenceInDays(now, new Date(lastDate))
          : differenceInDays(now, new Date());
        return {
          id: agent.id,
          name: (agent.user_id ? nameMap.get(agent.user_id) : undefined) || "Unknown Agent",
          lastProductionDate: lastDate,
          daysInactive: lastDate ? daysInactive : -1,
          managerId: agent.invited_by_manager_id || undefined,
        };
      }).sort((a, b) => b.daysInactive - a.daysInactive);
    },
    staleTime: 300_000,
  });

  const visibleAgents = atRiskAgents.filter((a) => !dismissedIds.has(a.id));

  if (visibleAgents.length === 0) return null;

  const handleMoveToInactive = async (agent: AtRiskAgent) => {
    setLoadingId(agent.id);
    try {
      const { error } = await supabase
        .from("agents")
        .update({ is_inactive: true })
        .eq("id", agent.id);
      if (error) throw error;
      toast.success(`${agent.name} moved to inactive`);
      queryClient.invalidateQueries({ queryKey: ["activation-risk-agents"] });
    } catch {
      toast.error("Failed to update agent");
    } finally {
      setLoadingId(null);
    }
  };

  const handleDismiss = (agentId: string) => {
    setDismissedIds((prev) => new Set([...prev, agentId]));
    toast.info("Agent hidden from risk list for this session");
  };

  const handleBulkInactive = async () => {
    setBulkLoading(true);
    try {
      const ids = visibleAgents.map((a) => a.id);
      const { error } = await supabase
        .from("agents")
        .update({ is_inactive: true })
        .in("id", ids);
      if (error) throw error;
      toast.success(`${ids.length} agents moved to inactive`);
      queryClient.invalidateQueries({ queryKey: ["activation-risk-agents"] });
    } catch {
      toast.error("Failed to update agents");
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
          {expanded ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
          )}
        </button>

        <p className="text-[11px] text-muted-foreground mt-1 pl-6">
          {visibleAgents.length} agent{visibleAgents.length > 1 ? "s have" : " has"} no production in 14+ days — tap to manage
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
              <div className="mt-3 space-y-2 max-h-64 overflow-y-auto">
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
                          : `${agent.daysInactive}d inactive — last: ${agent.lastProductionDate}`}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 px-2 text-[10px] border-amber-500/30 text-amber-400 hover:bg-amber-500/10"
                        onClick={() => handleMoveToInactive(agent)}
                        disabled={loadingId === agent.id}
                      >
                        {loadingId === agent.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <UserMinus className="h-3 w-3 mr-1" />
                        )}
                        Inactive
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 px-2 text-[10px]"
                        onClick={() =>
                          setDeactivateAgent({
                            id: agent.id,
                            name: agent.name,
                            managerId: agent.managerId,
                          })
                        }
                      >
                        <Settings className="h-3 w-3" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-[10px] text-muted-foreground"
                        onClick={() => handleDismiss(agent.id)}
                      >
                        <EyeOff className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>

              {visibleAgents.length > 1 && (
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full mt-3 h-8 text-xs border-amber-500/30 text-amber-400 hover:bg-amber-500/10"
                  onClick={handleBulkInactive}
                  disabled={bulkLoading}
                >
                  {bulkLoading ? (
                    <Loader2 className="h-3 w-3 animate-spin mr-2" />
                  ) : (
                    <Users className="h-3 w-3 mr-2" />
                  )}
                  Move All {visibleAgents.length} to Inactive
                </Button>
              )}
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
