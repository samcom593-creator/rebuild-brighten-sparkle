import { useState, useEffect } from "react";
import { UserPlus, Loader2, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Manager {
  id: string;
  name: string;
  email: string;
}

interface QuickAssignMenuProps {
  applicationId: string;
  currentAgentId: string | null;
  onAssigned?: () => void;
  className?: string;
}

export function QuickAssignMenu({
  applicationId,
  currentAgentId,
  onAssigned,
  className,
}: QuickAssignMenuProps) {
  const [managers, setManagers] = useState<Manager[]>([]);
  const [loading, setLoading] = useState(false);
  const [assigning, setAssigning] = useState<string | null>(null);

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

      const managerUserIds = managerRoles.map((r) => r.user_id);

      // Get agents for these managers
      const { data: agents } = await supabase
        .from("agents")
        .select("id, user_id")
        .in("user_id", managerUserIds)
        .eq("status", "active");

      if (!agents) {
        setManagers([]);
        return;
      }

      // Get profiles
      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, full_name, email")
        .in("user_id", managerUserIds);

      const managersData: Manager[] = agents.map((agent) => {
        const profile = profiles?.find((p) => p.user_id === agent.user_id);
        return {
          id: agent.id,
          name: profile?.full_name || "Unknown Manager",
          email: profile?.email || "",
        };
      });

      setManagers(managersData);
    } catch (error) {
      console.error("Error fetching managers:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleAssign = async (managerId: string) => {
    if (managerId === currentAgentId) {
      toast.info("Already assigned to this manager");
      return;
    }

    setAssigning(managerId);
    try {
      const { error } = await supabase
        .from("applications")
        .update({ assigned_agent_id: managerId })
        .eq("id", applicationId);

      if (error) throw error;

      // Notify the new manager
      await supabase.functions.invoke("notify-lead-assigned", {
        body: { applicationId, agentId: managerId },
      });

      toast.success("Lead reassigned successfully");
      onAssigned?.();
    } catch (err) {
      console.error("Failed to assign lead:", err);
      toast.error("Failed to reassign lead");
    } finally {
      setAssigning(null);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={className}
          disabled={loading}
        >
          {loading ? (
            <Loader2 className="h-4 w-4 mr-1 animate-spin" />
          ) : (
            <UserPlus className="h-4 w-4 mr-1" />
          )}
          Assign
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          Assign to Manager
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        
        {managers.length === 0 ? (
          <DropdownMenuItem disabled>
            No managers available
          </DropdownMenuItem>
        ) : (
          managers.map((manager) => (
            <DropdownMenuItem
              key={manager.id}
              onClick={() => handleAssign(manager.id)}
              disabled={assigning !== null}
              className="flex items-center justify-between"
            >
              <div className="flex flex-col">
                <span className="font-medium">{manager.name}</span>
                <span className="text-xs text-muted-foreground">{manager.email}</span>
              </div>
              {currentAgentId === manager.id && (
                <Check className="h-4 w-4 text-primary" />
              )}
              {assigning === manager.id && (
                <Loader2 className="h-4 w-4 animate-spin" />
              )}
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
