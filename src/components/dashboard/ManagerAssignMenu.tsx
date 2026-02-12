import { useState, useRef } from "react";
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
import { useSoundEffects } from "@/hooks/useSoundEffects";

interface Manager {
  id: string;
  name: string;
}

interface ManagerAssignMenuProps {
  agentId: string;
  currentManagerId?: string | null;
  onAssigned?: () => void;
}

// Shared cache so all instances reuse the same data
let cachedManagers: Manager[] | null = null;
let cacheTimestamp = 0;
const CACHE_TTL = 120_000; // 2 minutes

async function getManagers(): Promise<Manager[]> {
  const now = Date.now();
  if (cachedManagers && now - cacheTimestamp < CACHE_TTL) {
    return cachedManagers;
  }

  const { data, error } = await supabase.functions.invoke("get-active-managers");
  if (error || !data?.managers || !Array.isArray(data.managers)) {
    return cachedManagers || [];
  }

  cachedManagers = data.managers.map((m: { id: string; name: string }) => ({
    id: m.id,
    name: m.name,
  }));
  cacheTimestamp = now;
  return cachedManagers!;
}

export function ManagerAssignMenu({ agentId, currentManagerId, onAssigned }: ManagerAssignMenuProps) {
  const { playSound } = useSoundEffects();
  const [managers, setManagers] = useState<Manager[]>([]);
  const [loading, setLoading] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const hasFetched = useRef(false);

  const handleOpenChange = async (open: boolean) => {
    if (open && !hasFetched.current) {
      setLoading(true);
      try {
        const result = await getManagers();
        setManagers(result);
        hasFetched.current = true;
      } finally {
        setLoading(false);
      }
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
      
      playSound("success");
      toast.success(`Assigned to ${managerName}`);
      onAssigned?.();
    } catch (error) {
      console.error("Error assigning manager:", error);
      playSound("error");
      toast.error("Failed to assign manager");
    } finally {
      setAssigning(false);
    }
  };

  return (
    <DropdownMenu onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5 text-xs">
          {assigning ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Users className="h-3 w-3" />
          )}
          Assign Manager
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
