import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { 
  CheckSquare, 
  Square, 
  ArrowRight, 
  ArrowLeft, 
  Users, 
  X,
  Send,
  Loader2 
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Database } from "@/integrations/supabase/types";

type OnboardingStage = Database["public"]["Enums"]["onboarding_stage"];

interface Agent {
  id: string;
  name: string;
  onboardingStage: OnboardingStage;
}

interface BulkStageActionsProps {
  agents: Agent[];
  selectedIds: Set<string>;
  onSelectionChange: (ids: Set<string>) => void;
  onBulkUpdate: () => void;
  isEnabled: boolean;
  onToggle: () => void;
}

const STAGE_ORDER: OnboardingStage[] = [
  "applied",
  "onboarding",
  "meeting_attendance",
  "pre_licensed",
  "training_online",
  "transfer",
  "in_field_training",
  "below_10k",
  "live",
  "evaluated",
  "need_followup",
  "inactive",
  "pending_review",
];

const STAGE_LABELS: Record<OnboardingStage, string> = {
  applied: "Applied",
  onboarding: "Onboarding",
  meeting_attendance: "Meeting Attendance",
  pre_licensed: "Pre-Licensed",
  training_online: "In Course",
  transfer: "Transfer",
  in_field_training: "In-Field Training",
  below_10k: "Below $10K",
  live: "Live",
  evaluated: "Evaluated",
  need_followup: "Needs Follow-Up",
  inactive: "Inactive",
  pending_review: "Pending Review",
};

export function BulkStageActions({
  agents,
  selectedIds,
  onSelectionChange,
  onBulkUpdate,
  isEnabled,
  onToggle,
}: BulkStageActionsProps) {
  const [loading, setLoading] = useState(false);

  const selectedAgents = agents.filter(a => selectedIds.has(a.id));
  const canAdvance = selectedAgents.some(a => {
    const idx = STAGE_ORDER.indexOf(a.onboardingStage);
    return idx < STAGE_ORDER.length - 1;
  });
  const canRevert = selectedAgents.some(a => {
    const idx = STAGE_ORDER.indexOf(a.onboardingStage);
    return idx > 0;
  });

  const toggleAgent = (id: string) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    onSelectionChange(newSet);
  };

  const selectAll = () => {
    onSelectionChange(new Set(agents.map(a => a.id)));
  };

  const clearSelection = () => {
    onSelectionChange(new Set());
  };

  const handleBulkStageChange = async (direction: "forward" | "backward") => {
    if (selectedIds.size === 0) return;
    
    setLoading(true);
    try {
      const updates: { id: string; newStage: OnboardingStage }[] = [];
      
      for (const agent of selectedAgents) {
        const currentIdx = STAGE_ORDER.indexOf(agent.onboardingStage);
        const targetIdx = direction === "forward" ? currentIdx + 1 : currentIdx - 1;
        
        if (targetIdx >= 0 && targetIdx < STAGE_ORDER.length) {
          updates.push({
            id: agent.id,
            newStage: STAGE_ORDER[targetIdx],
          });
        }
      }

      if (updates.length === 0) {
        toast.info("No agents can be moved in that direction");
        return;
      }

      // Perform batch update
      for (const update of updates) {
        const { error } = await supabase
          .from("agents")
          .update({ 
            onboarding_stage: update.newStage,
            ...(update.newStage === "evaluated" ? { onboarding_completed_at: new Date().toISOString() } : {}),
            ...(update.newStage === "in_field_training" ? { field_training_started_at: new Date().toISOString() } : {})
          })
          .eq("id", update.id);

        if (error) throw error;

        // Log the transition
        await supabase.from("agent_onboarding").insert({
          agent_id: update.id,
          stage: update.newStage,
          notes: `Bulk ${direction === "forward" ? "advance" : "revert"} via CRM`,
        });

        // Send notifications for going live
        if (update.newStage === "evaluated") {
          try {
            await supabase.functions.invoke("notify-agent-live-field", {
              body: { agentId: update.id }
            });
            await supabase.functions.invoke("send-agent-portal-login", {
              body: { agentId: update.id }
            });
          } catch (err) {
            console.error("Error sending live notifications:", err);
          }
        }
      }

      toast.success(`${updates.length} agent${updates.length > 1 ? "s" : ""} ${direction === "forward" ? "advanced" : "reverted"}`);
      clearSelection();
      onBulkUpdate();
    } catch (error) {
      console.error("Error bulk updating stages:", error);
      toast.error("Failed to update some agents");
    } finally {
      setLoading(false);
    }
  };

  const handleBulkSendPortalLogins = async () => {
    if (selectedIds.size === 0) return;
    
    const liveAgents = selectedAgents.filter(a => a.onboardingStage === "evaluated");
    if (liveAgents.length === 0) {
      toast.info("No selected agents are live");
      return;
    }

    setLoading(true);
    try {
      let sentCount = 0;
      for (const agent of liveAgents) {
        try {
          await supabase.functions.invoke("send-agent-portal-login", {
            body: { agentId: agent.id }
          });
          sentCount++;
        } catch (err) {
          console.error(`Failed to send portal login to ${agent.name}:`, err);
        }
      }
      toast.success(`Sent portal logins to ${sentCount} agent${sentCount > 1 ? "s" : ""}`);
    } catch (error) {
      console.error("Error sending bulk portal logins:", error);
      toast.error("Failed to send some portal logins");
    } finally {
      setLoading(false);
    }
  };

  if (!isEnabled) {
    return (
      <Button
        variant="outline"
        size="sm"
        className="gap-2"
        onClick={onToggle}
      >
        <CheckSquare className="h-4 w-4" />
        Bulk Actions
      </Button>
    );
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -10 }}
        className="w-full"
      >
        {/* Selection Bar */}
        <div className="flex items-center justify-between gap-4 p-3 bg-primary/10 rounded-lg border border-primary/20 mb-4">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-2"
              onClick={onToggle}
            >
              <X className="h-4 w-4" />
            </Button>
            
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-primary" />
              <span className="font-medium text-sm">
                {selectedIds.size} selected
              </span>
            </div>

            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={selectAll}
              >
                Select All
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={clearSelection}
                disabled={selectedIds.size === 0}
              >
                Clear
              </Button>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              disabled={!canRevert || loading || selectedIds.size === 0}
              onClick={() => handleBulkStageChange("backward")}
            >
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowLeft className="h-3.5 w-3.5" />}
              Revert Stage
            </Button>
            
            <Button
              size="sm"
              className="gap-1.5 bg-primary hover:bg-primary/90"
              disabled={!canAdvance || loading || selectedIds.size === 0}
              onClick={() => handleBulkStageChange("forward")}
            >
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowRight className="h-3.5 w-3.5" />}
              Advance Stage
            </Button>

            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              disabled={loading || selectedIds.size === 0}
              onClick={handleBulkSendPortalLogins}
            >
              <Send className="h-3.5 w-3.5" />
              Send Logins
            </Button>
          </div>
        </div>

        {/* Selected Agents Preview */}
        {selectedIds.size > 0 && (
          <div className="flex flex-wrap gap-2 mb-4">
            {selectedAgents.slice(0, 10).map(agent => (
              <Badge
                key={agent.id}
                variant="secondary"
                className="gap-1 cursor-pointer hover:bg-destructive/20"
                onClick={() => toggleAgent(agent.id)}
              >
                {agent.name}
                <X className="h-3 w-3" />
              </Badge>
            ))}
            {selectedIds.size > 10 && (
              <Badge variant="outline">
                +{selectedIds.size - 10} more
              </Badge>
            )}
          </div>
        )}
      </motion.div>
    </AnimatePresence>
  );
}

// Selection checkbox component to use in agent cards
interface AgentSelectCheckboxProps {
  agentId: string;
  isSelected: boolean;
  onToggle: (id: string) => void;
  isEnabled: boolean;
}

export function AgentSelectCheckbox({ 
  agentId, 
  isSelected, 
  onToggle, 
  isEnabled 
}: AgentSelectCheckboxProps) {
  if (!isEnabled) return null;

  return (
    <button
      type="button"
      className={cn(
        "h-5 w-5 rounded border-2 flex items-center justify-center transition-all",
        isSelected 
          ? "bg-primary border-primary text-primary-foreground" 
          : "border-muted-foreground/40 hover:border-primary/60"
      )}
      onClick={(e) => {
        e.stopPropagation();
        onToggle(agentId);
      }}
    >
      {isSelected && <CheckSquare className="h-3.5 w-3.5" />}
    </button>
  );
}
