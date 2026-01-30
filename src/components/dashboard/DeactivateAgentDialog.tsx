import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { 
  X, 
  UserX, 
  AlertTriangle, 
  UserMinus, 
  ArrowRightLeft,
  ChevronLeft,
  Trash2,
  Clock,
  Loader2
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { useSoundEffects } from "@/hooks/useSoundEffects";

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

type Screen = "main" | "terminate" | "switch_teams" | "remove_reason";

export function DeactivateAgentDialog({
  open,
  onOpenChange,
  agentId,
  agentName,
  currentManagerId,
  onComplete,
}: DeactivateAgentDialogProps) {
  const { user, isAdmin } = useAuth();
  const { playSound } = useSoundEffects();
  const [loading, setLoading] = useState(false);
  const [screen, setScreen] = useState<Screen>("main");
  const [managers, setManagers] = useState<Manager[]>([]);
  const [selectedManagerId, setSelectedManagerId] = useState("");
  const [removalReason, setRemovalReason] = useState("");

  useEffect(() => {
    if (screen === "switch_teams") {
      fetchManagers();
    }
  }, [screen]);

  useEffect(() => {
    if (open) {
      playSound("whoosh");
    }
  }, [open, playSound]);

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
        .filter(agent => agent.id !== currentManagerId)
        .map(agent => ({
          id: agent.id,
          name: profileMap.get(agent.user_id) || "Unknown Manager",
        }));

      setManagers(managerList);
    } catch (error) {
      console.error("Error fetching managers:", error);
    }
  };

  // Direct delete function for admins - no approval needed
  const performDirectDelete = async (targetAgentId: string) => {
    // Delete from related tables in order (typed individually to avoid TS issues)
    await supabase.from('agent_notes').delete().eq('agent_id', targetAgentId);
    await supabase.from('agent_attendance').delete().eq('agent_id', targetAgentId);
    await supabase.from('agent_goals').delete().eq('agent_id', targetAgentId);
    await supabase.from('agent_ratings').delete().eq('agent_id', targetAgentId);
    await supabase.from('onboarding_progress').delete().eq('agent_id', targetAgentId);
    await supabase.from('agent_onboarding').delete().eq('agent_id', targetAgentId);
    await supabase.from('daily_production').delete().eq('agent_id', targetAgentId);
    await supabase.from('agent_achievements').delete().eq('agent_id', targetAgentId);
    await supabase.from('plaque_awards').delete().eq('agent_id', targetAgentId);
    await supabase.from('contact_history').delete().eq('agent_id', targetAgentId);
    
    // Finally delete agent
    await supabase.from('agents').delete().eq('id', targetAgentId);
  };

  const handleAction = async (action: "bad_business" | "inactive" | "switch_teams" | "remove_from_system") => {
    if (action === "switch_teams" && !selectedManagerId) {
      toast.error("Please select a manager to transfer to");
      return;
    }

    setLoading(true);
    playSound("click");

    try {
      if (action === "switch_teams") {
        const { error } = await supabase
          .from("agents")
          .update({
            invited_by_manager_id: selectedManagerId,
            switched_to_manager_id: selectedManagerId,
            deactivation_reason: "switched_teams",
          })
          .eq("id", agentId);

        if (error) throw error;
        playSound("success");
        toast.success(`${agentName} transferred to new team`);
      } else if (action === "inactive") {
        const { error } = await supabase
          .from("agents")
          .update({
            is_inactive: true,
          })
          .eq("id", agentId);

        if (error) throw error;
        playSound("success");
        toast.success(`${agentName} added to inactive agents`);
      } else if (action === "remove_from_system") {
        // Admin bypass - direct delete without email approval
        if (isAdmin) {
          await performDirectDelete(agentId);
          playSound("success");
          toast.success(`${agentName} permanently removed from system`);
        } else {
          // Non-admins need email approval
          const { data: profile } = await supabase
            .from("profiles")
            .select("full_name")
            .eq("user_id", user?.id)
            .single();

          const { error } = await supabase.functions.invoke("confirm-agent-removal", {
            body: {
              agentId,
              agentName,
              reason: removalReason || "No reason provided",
              requestedBy: user?.id,
              requestedByName: profile?.full_name || "Unknown",
            }
          });

          if (error) throw error;
          playSound("success");
          toast.success("Removal request sent - awaiting admin approval");
        }
      } else {
        const { error } = await supabase
          .from("agents")
          .update({
            is_deactivated: true,
            deactivation_reason: action,
          })
          .eq("id", agentId);

        if (error) throw error;
        playSound("success");
        toast.success(`${agentName} has been deactivated`);
      }

      onComplete?.();
      handleClose();
    } catch (error) {
      console.error("Error updating agent:", error);
      playSound("error");
      toast.error("Failed to update agent status");
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setScreen("main");
    setSelectedManagerId("");
    setRemovalReason("");
    onOpenChange(false);
  };

  const navigateTo = (newScreen: Screen) => {
    playSound("click");
    setScreen(newScreen);
  };

  const screenVariants = {
    enter: { x: 20, opacity: 0 },
    center: { x: 0, opacity: 1 },
    exit: { x: -20, opacity: 0 },
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserX className="h-5 w-5 text-destructive" />
            {screen === "main" ? "Agent Options" : 
             screen === "terminate" ? "Terminate Agent" :
             screen === "switch_teams" ? "Switch Teams" :
             "Remove from System"}
          </DialogTitle>
          <DialogDescription>
            {agentName}
          </DialogDescription>
        </DialogHeader>

        <AnimatePresence mode="wait">
          <motion.div
            key={screen}
            variants={screenVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.2 }}
            className="space-y-3 pt-4"
          >
            {screen === "main" && (
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
                  className="w-full justify-start gap-3 border-destructive/50 text-destructive hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => navigateTo("terminate")}
                >
                  <UserX className="h-4 w-4" />
                  Terminate Agent
                </Button>
              </>
            )}

            {screen === "terminate" && (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  className="mb-2"
                  onClick={() => navigateTo("main")}
                >
                  <ChevronLeft className="h-4 w-4 mr-1" />
                  Back
                </Button>

                <Button
                  variant="outline"
                  className="w-full justify-start gap-3 border-destructive/50 text-destructive hover:bg-destructive/10"
                  onClick={() => handleAction("bad_business")}
                  disabled={loading}
                >
                  <AlertTriangle className="h-4 w-4" />
                  Bad Business
                  <span className="ml-auto text-xs text-muted-foreground">Immediate</span>
                </Button>

                <Button
                  variant="outline"
                  className="w-full justify-start gap-3"
                  onClick={() => handleAction("inactive")}
                  disabled={loading}
                >
                  <UserMinus className="h-4 w-4" />
                  Add to Inactive Agents
                  <span className="ml-auto text-xs text-muted-foreground">Admin only view</span>
                </Button>

                <Button
                  variant="outline"
                  className="w-full justify-start gap-3"
                  onClick={() => isAdmin ? handleAction("remove_from_system") : navigateTo("remove_reason")}
                  disabled={loading}
                >
                  <Trash2 className="h-4 w-4" />
                  Remove from System
                  <span className="ml-auto text-xs text-muted-foreground">
                    {isAdmin ? "Immediate" : "Email approval"}
                  </span>
                </Button>

                <Button
                  variant="outline"
                  className="w-full justify-start gap-3"
                  onClick={() => navigateTo("switch_teams")}
                  disabled={loading}
                >
                  <ArrowRightLeft className="h-4 w-4" />
                  Switch Teams
                </Button>
              </>
            )}

            {screen === "switch_teams" && (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  className="mb-2"
                  onClick={() => navigateTo("terminate")}
                >
                  <ChevronLeft className="h-4 w-4 mr-1" />
                  Back
                </Button>

                <div className="space-y-2">
                  <Label>Select new manager:</Label>
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
                </div>

                <Button
                  className="w-full"
                  onClick={() => handleAction("switch_teams")}
                  disabled={loading || !selectedManagerId}
                >
                  {loading ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <ArrowRightLeft className="h-4 w-4 mr-2" />
                  )}
                  Transfer Agent
                </Button>
              </>
            )}

            {screen === "remove_reason" && (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  className="mb-2"
                  onClick={() => navigateTo("terminate")}
                >
                  <ChevronLeft className="h-4 w-4 mr-1" />
                  Back
                </Button>

                <div className="space-y-2">
                  <Label>Reason for removal (optional):</Label>
                  <Textarea
                    value={removalReason}
                    onChange={(e) => setRemovalReason(e.target.value)}
                    placeholder="Why is this agent being removed?"
                    rows={3}
                  />
                </div>

                <div className="flex items-center gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-sm">
                  <Clock className="h-4 w-4 text-amber-500 shrink-0" />
                  <span className="text-muted-foreground">
                    {isAdmin 
                      ? "You'll receive an email to confirm this action"
                      : "Admin approval required via email confirmation"}
                  </span>
                </div>

                <Button
                  variant="destructive"
                  className="w-full"
                  onClick={() => handleAction("remove_from_system")}
                  disabled={loading}
                >
                  {loading ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <Trash2 className="h-4 w-4 mr-2" />
                  )}
                  Request Removal
                </Button>
              </>
            )}
          </motion.div>
        </AnimatePresence>
      </DialogContent>
    </Dialog>
  );
}
