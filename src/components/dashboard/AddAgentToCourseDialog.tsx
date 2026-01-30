import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { UserPlus, Search, Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface EligibleAgent {
  id: string;
  name: string;
  email: string;
  managerId: string | null;
}

interface AddAgentToCourseDialogProps {
  onSuccess?: () => void;
}

export function AddAgentToCourseDialog({ onSuccess }: AddAgentToCourseDialogProps) {
  const [open, setOpen] = useState(false);
  const [selectedAgents, setSelectedAgents] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const queryClient = useQueryClient();

  // Fetch agents eligible for course enrollment
  // (in onboarding stage, not already in training_online, not deactivated)
  const { data: eligibleAgents = [], isLoading } = useQuery({
    queryKey: ["eligible-agents-for-course"],
    queryFn: async () => {
      // Get agents in onboarding stage
      const { data: agents } = await supabase
        .from("agents")
        .select(`
          id,
          onboarding_stage,
          has_training_course,
          profiles!agents_profile_id_fkey (
            full_name,
            email
          )
        `)
        .eq("onboarding_stage", "onboarding")
        .eq("is_deactivated", false);

      if (!agents?.length) return [];

      // Get agents who already have progress
      const agentIds = agents.map(a => a.id);
      const { data: progressData } = await supabase
        .from("onboarding_progress")
        .select("agent_id")
        .in("agent_id", agentIds);

      const agentsWithProgress = new Set(progressData?.map(p => p.agent_id) || []);

      // Filter to only those without progress and not already flagged for course
      return agents
        .filter(a => !agentsWithProgress.has(a.id) && !a.has_training_course)
        .map(a => ({
          id: a.id,
          name: a.profiles?.full_name || "Unknown",
          email: a.profiles?.email || "",
          managerId: null,
        })) as EligibleAgent[];
    },
    enabled: open,
  });

  // Enrollment mutation
  const enrollMutation = useMutation({
    mutationFn: async (agentIds: string[]) => {
      // Update all selected agents
      const updates = agentIds.map(async (agentId) => {
        // Update agent stage
        const { error: agentError } = await supabase
          .from("agents")
          .update({
            onboarding_stage: "training_online",
            has_training_course: true,
          })
          .eq("id", agentId);

        if (agentError) throw agentError;

        // Get agent email for sending login
        const { data: agent } = await supabase
          .from("agents")
          .select("profiles!agents_profile_id_fkey(email, full_name)")
          .eq("id", agentId)
          .single();

        if (agent?.profiles?.email) {
          // Trigger portal login email
          await supabase.functions.invoke("send-agent-portal-login", {
            body: { 
              agentId, 
              email: agent.profiles.email,
              agentName: agent.profiles.full_name || "Agent"
            },
          });
        }
      });

      await Promise.all(updates);
    },
    onSuccess: () => {
      toast.success(`${selectedAgents.length} agent(s) enrolled in course`);
      queryClient.invalidateQueries({ queryKey: ["course-progress-full"] });
      queryClient.invalidateQueries({ queryKey: ["course-progress-admin"] });
      queryClient.invalidateQueries({ queryKey: ["eligible-agents-for-course"] });
      setSelectedAgents([]);
      setOpen(false);
      onSuccess?.();
    },
    onError: (error) => {
      console.error("Enrollment error:", error);
      toast.error("Failed to enroll some agents");
    },
  });

  const filteredAgents = eligibleAgents.filter(
    (agent) =>
      agent.name.toLowerCase().includes(search.toLowerCase()) ||
      agent.email.toLowerCase().includes(search.toLowerCase())
  );

  const toggleAgent = (agentId: string) => {
    setSelectedAgents((prev) =>
      prev.includes(agentId)
        ? prev.filter((id) => id !== agentId)
        : [...prev, agentId]
    );
  };

  const selectAll = () => {
    if (selectedAgents.length === filteredAgents.length) {
      setSelectedAgents([]);
    } else {
      setSelectedAgents(filteredAgents.map((a) => a.id));
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <UserPlus className="h-3.5 w-3.5" />
          Add to Course
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="h-5 w-5 text-primary" />
            Add Agents to Course
          </DialogTitle>
          <DialogDescription>
            Select agents to enroll in the onboarding course. They'll receive login credentials.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search agents..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>

          {/* Select All */}
          {filteredAgents.length > 0 && (
            <div className="flex items-center gap-2">
              <Checkbox
                id="select-all"
                checked={selectedAgents.length === filteredAgents.length && filteredAgents.length > 0}
                onCheckedChange={selectAll}
              />
              <label htmlFor="select-all" className="text-sm text-muted-foreground cursor-pointer">
                Select all ({filteredAgents.length})
              </label>
            </div>
          )}

          {/* Agent List */}
          <ScrollArea className="h-[250px] border rounded-lg">
            {isLoading ? (
              <div className="flex items-center justify-center h-full">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : filteredAgents.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                <UserPlus className="h-8 w-8 mb-2 opacity-50" />
                <p className="text-sm">No eligible agents found</p>
                <p className="text-xs">Agents must be in "onboarding" stage</p>
              </div>
            ) : (
              <div className="p-2 space-y-1">
                {filteredAgents.map((agent) => (
                  <div
                    key={agent.id}
                    className={`flex items-center gap-3 p-2 rounded-lg cursor-pointer transition-colors ${
                      selectedAgents.includes(agent.id)
                        ? "bg-primary/10 border border-primary/30"
                        : "hover:bg-muted/50"
                    }`}
                    onClick={() => toggleAgent(agent.id)}
                  >
                    <Checkbox
                      checked={selectedAgents.includes(agent.id)}
                      onCheckedChange={() => toggleAgent(agent.id)}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">{agent.name}</p>
                      <p className="text-xs text-muted-foreground truncate">{agent.email}</p>
                    </div>
                    {selectedAgents.includes(agent.id) && (
                      <Check className="h-4 w-4 text-primary shrink-0" />
                    )}
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => enrollMutation.mutate(selectedAgents)}
            disabled={selectedAgents.length === 0 || enrollMutation.isPending}
            className="gap-2"
          >
            {enrollMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Enrolling...
              </>
            ) : (
              <>
                <UserPlus className="h-4 w-4" />
                Enroll {selectedAgents.length > 0 ? `(${selectedAgents.length})` : ""}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
