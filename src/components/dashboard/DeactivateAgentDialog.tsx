import { useState, useEffect } from "react";
import { X, UserX, AlertTriangle, UserMinus, ArrowRightLeft } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Manager {
  id: string;
  name: string;
}

interface DeactivateAgentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agentId: string;
  agentName: string;
  currentManagerId?: string;
  onComplete?: () => void;
}

export function DeactivateAgentDialog({
  open,
  onOpenChange,
  agentId,
  agentName,
  currentManagerId,
  onComplete,
}: DeactivateAgentDialogProps) {
  const [loading, setLoading] = useState(false);
  const [showManagerSelect, setShowManagerSelect] = useState(false);
  const [managers, setManagers] = useState<Manager[]>([]);
  const [selectedManagerId, setSelectedManagerId] = useState("");

  useEffect(() => {
    if (showManagerSelect) {
      fetchManagers();
    }
  }, [showManagerSelect]);

  const fetchManagers = async () => {
    try {
      const { data: managerRoles } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("role", "manager");

      if (!managerRoles?.length) return;

      const managerUserIds = managerRoles.map(r => r.user_id);

      const { data: managerAgents } = await supabase
        .from("agents")
        .select("id, user_id")
        .in("user_id", managerUserIds)
        .eq("status", "active");

      if (!managerAgents?.length) return;

      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, full_name")
        .in("user_id", managerUserIds);

      const profileMap = new Map(profiles?.map(p => [p.user_id, p.full_name]) || []);

      const managerList: Manager[] = managerAgents
        .filter(agent => agent.id !== currentManagerId) // Exclude current manager
        .map(agent => ({
          id: agent.id,
          name: profileMap.get(agent.user_id) || "Unknown Manager",
        }));

      setManagers(managerList);
    } catch (error) {
      console.error("Error fetching managers:", error);
    }
  };

  const handleAction = async (action: "bad_business" | "inactive" | "switch_teams") => {
    if (action === "switch_teams" && !showManagerSelect) {
      setShowManagerSelect(true);
      return;
    }

    if (action === "switch_teams" && !selectedManagerId) {
      toast.error("Please select a manager to transfer to");
      return;
    }

    setLoading(true);
    try {
      if (action === "switch_teams") {
        // Transfer to new manager
        const { error } = await supabase
          .from("agents")
          .update({
            invited_by_manager_id: selectedManagerId,
            switched_to_manager_id: selectedManagerId,
            deactivation_reason: "switched_teams",
          })
          .eq("id", agentId);

        if (error) throw error;
        toast.success(`${agentName} transferred to new team`);
      } else {
        // Deactivate with reason
        const { error } = await supabase
          .from("agents")
          .update({
            is_deactivated: true,
            deactivation_reason: action,
          })
          .eq("id", agentId);

        if (error) throw error;
        toast.success(`${agentName} has been deactivated`);
      }

      onComplete?.();
      onOpenChange(false);
    } catch (error) {
      console.error("Error updating agent:", error);
      toast.error("Failed to update agent status");
    } finally {
      setLoading(false);
      setShowManagerSelect(false);
      setSelectedManagerId("");
    }
  };

  const handleClose = () => {
    setShowManagerSelect(false);
    setSelectedManagerId("");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserX className="h-5 w-5 text-destructive" />
            Deactivate {agentName}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 pt-4">
          {showManagerSelect ? (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Select the manager to transfer this agent to:
              </p>
              <Select value={selectedManagerId} onValueChange={setSelectedManagerId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a manager" />
                </SelectTrigger>
                <SelectContent>
                  {managers.map((manager) => (
                    <SelectItem key={manager.id} value={manager.id}>
                      {manager.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => setShowManagerSelect(false)}
                >
                  Back
                </Button>
                <Button
                  className="flex-1"
                  onClick={() => handleAction("switch_teams")}
                  disabled={loading || !selectedManagerId}
                >
                  Transfer Agent
                </Button>
              </div>
            </div>
          ) : (
            <>
              <Button
                variant="outline"
                className="w-full justify-start gap-3"
                onClick={handleClose}
              >
                <X className="h-4 w-4" />
                Never mind
              </Button>

              <Button
                variant="outline"
                className="w-full justify-start gap-3 text-destructive hover:text-destructive"
                onClick={() => handleAction("bad_business")}
                disabled={loading}
              >
                <AlertTriangle className="h-4 w-4" />
                Bad Business
              </Button>

              <Button
                variant="outline"
                className="w-full justify-start gap-3"
                onClick={() => handleAction("inactive")}
                disabled={loading}
              >
                <UserMinus className="h-4 w-4" />
                Inactive
              </Button>

              <Button
                variant="outline"
                className="w-full justify-start gap-3"
                onClick={() => handleAction("switch_teams")}
                disabled={loading}
              >
                <ArrowRightLeft className="h-4 w-4" />
                Switch Teams
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
