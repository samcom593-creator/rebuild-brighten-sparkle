import { useState, useEffect } from "react";
import { Users, Check, Loader2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Manager {
  id: string;
  name: string;
}

interface ManagerAssignMenuProps {
  agentId: string;
  currentManagerId?: string | null;
  onAssigned?: () => void;
}

export function ManagerAssignMenu({ agentId, currentManagerId, onAssigned }: ManagerAssignMenuProps) {
  const [managers, setManagers] = useState<Manager[]>([]);
  const [loading, setLoading] = useState(false);
  const [assigning, setAssigning] = useState(false);

  useEffect(() => {
    fetchManagers();
  }, []);

  const fetchManagers = async () => {
    setLoading(true);
    try {
      // Get all users with manager role
      const { data: managerRoles } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("role", "manager");

      if (!managerRoles || managerRoles.length === 0) {
        setManagers([]);
        return;
      }

      const userIds = managerRoles.map(r => r.user_id);

      // Get their agent records
      const { data: agents } = await supabase
        .from("agents")
        .select("id, user_id")
        .in("user_id", userIds)
        .eq("is_deactivated", false);

      if (!agents) {
        setManagers([]);
        return;
      }

      // Get their profiles
      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, full_name")
        .in("user_id", userIds);

      const managerList: Manager[] = agents.map(agent => {
        const profile = profiles?.find(p => p.user_id === agent.user_id);
        return {
          id: agent.id,
          name: profile?.full_name || "Unknown Manager",
        };
      });

      setManagers(managerList);
    } catch (error) {
      console.error("Error fetching managers:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleAssign = async (managerId: string | null) => {
    setAssigning(true);
    try {
      const { error } = await supabase
        .from("agents")
        .update({ invited_by_manager_id: managerId })
        .eq("id", agentId);

      if (error) throw error;

      const managerName = managerId 
        ? managers.find(m => m.id === managerId)?.name || "Manager"
        : "No manager";
      
      toast.success(`Assigned to ${managerName}`);
      onAssigned?.();
    } catch (error) {
      console.error("Error assigning manager:", error);
      toast.error("Failed to assign manager");
    } finally {
      setAssigning(false);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-7 w-7">
          {assigning ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Users className="h-3.5 w-3.5" />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel className="text-xs">Assign Manager</DropdownMenuLabel>
        <DropdownMenuSeparator />
        
        {loading ? (
          <DropdownMenuItem disabled>
            <Loader2 className="h-3 w-3 animate-spin mr-2" />
            Loading...
          </DropdownMenuItem>
        ) : managers.length === 0 ? (
          <DropdownMenuItem disabled>No managers available</DropdownMenuItem>
        ) : (
          <>
            <DropdownMenuItem 
              onClick={() => handleAssign(null)}
              className="text-xs"
            >
              {!currentManagerId && <Check className="h-3 w-3 mr-2" />}
              <span className={!currentManagerId ? "font-medium" : ""}>Unassigned</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {managers.map((manager) => (
              <DropdownMenuItem
                key={manager.id}
                onClick={() => handleAssign(manager.id)}
                className="text-xs"
              >
                {currentManagerId === manager.id && <Check className="h-3 w-3 mr-2" />}
                <span className={currentManagerId === manager.id ? "font-medium" : ""}>
                  {manager.name}
                </span>
              </DropdownMenuItem>
            ))}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
