import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Users, Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface Manager {
  id: string;
  display_name: string;
  profile?: {
    full_name: string | null;
  };
}

interface LeadReassignButtonProps {
  leadId: string;
  leadSource: "aged_leads" | "applications";
  currentManagerId?: string;
  onReassigned?: (newManagerId: string) => void;
  className?: string;
}

export function LeadReassignButton({
  leadId,
  leadSource,
  currentManagerId,
  onReassigned,
  className,
}: LeadReassignButtonProps) {
  const [open, setOpen] = useState(false);
  const [reassigning, setReassigning] = useState(false);
  const [selectedManagerId, setSelectedManagerId] = useState<string | null>(null);

  // Fetch managers
  const { data: managers = [], isLoading: loadingManagers } = useQuery({
    queryKey: ["managers-for-reassign"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("agents")
        .select(`
          id,
          display_name,
          profile:profiles!agents_profile_id_fkey(full_name)
        `)
        .eq("is_deactivated", false)
        .order("display_name");

      if (error) {
        console.error("Error fetching managers:", error);
        return [];
      }

      // Filter to managers by checking user_roles
      const { data: managerRoles } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("role", "manager");

      const managerUserIds = new Set(managerRoles?.map((r) => r.user_id) || []);

      // Get user_ids for agents
      const agentUserIds = await Promise.all(
        (data || []).map(async (agent) => {
          const { data: agentData } = await supabase
            .from("agents")
            .select("user_id")
            .eq("id", agent.id)
            .single();
          return { ...agent, user_id: agentData?.user_id };
        })
      );

      return agentUserIds.filter((a) => a.user_id && managerUserIds.has(a.user_id)) as Manager[];
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  const handleReassign = async (managerId: string) => {
    if (!managerId || reassigning) return;

    setReassigning(true);
    setSelectedManagerId(managerId);

    try {
      if (leadSource === "aged_leads") {
        const { error } = await supabase
          .from("aged_leads")
          .update({ assigned_manager_id: managerId })
          .eq("id", leadId);

        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("applications")
          .update({ assigned_agent_id: managerId })
          .eq("id", leadId);

        if (error) throw error;
      }

      const managerName = managers.find((m) => m.id === managerId)?.display_name ||
        managers.find((m) => m.id === managerId)?.profile?.full_name ||
        "Manager";

      toast.success(`Lead reassigned to ${managerName}`);
      onReassigned?.(managerId);
      setOpen(false);
    } catch (error) {
      console.error("Error reassigning lead:", error);
      toast.error("Failed to reassign lead");
    } finally {
      setReassigning(false);
      setSelectedManagerId(null);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn(
            "gap-2 border-amber-500/30 text-amber-400 hover:bg-amber-500/10",
            className
          )}
        >
          <Users className="h-4 w-4" />
          Reassign
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-2" align="end">
        <div className="space-y-1">
          <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
            Assign to Manager
          </div>
          
          {loadingManagers ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : managers.length === 0 ? (
            <div className="text-sm text-muted-foreground text-center py-4">
              No managers available
            </div>
          ) : (
            <div className="max-h-60 overflow-y-auto">
              {managers.map((manager) => {
                const name = manager.display_name || manager.profile?.full_name || "Unknown Manager";
                const isSelected = manager.id === currentManagerId;
                const isSelecting = manager.id === selectedManagerId && reassigning;

                return (
                  <motion.button
                    key={manager.id}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => handleReassign(manager.id)}
                    disabled={reassigning || isSelected}
                    className={cn(
                      "w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left text-sm transition-colors",
                      isSelected
                        ? "bg-primary/10 text-primary cursor-default"
                        : "hover:bg-muted/50 text-foreground",
                      reassigning && !isSelecting && "opacity-50"
                    )}
                  >
                    {isSelecting ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : isSelected ? (
                      <Check className="h-4 w-4" />
                    ) : (
                      <div className="w-4" />
                    )}
                    <span className="truncate">{name}</span>
                    {isSelected && (
                      <span className="ml-auto text-xs text-muted-foreground">Current</span>
                    )}
                  </motion.button>
                );
              })}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
