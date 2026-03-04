import { useState, useRef, forwardRef } from "react";
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
import { useSoundEffects } from "@/hooks/useSoundEffects";

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
  source?: "applications" | "aged_leads";
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

  // Batch-fetch emails in one go instead of N+1
  const agentIds = data.managers.map((m: { id: string }) => m.id);
  const { data: agents } = await supabase
    .from("agents")
    .select("id, user_id")
    .in("id", agentIds);

  const userIds = (agents || []).filter(a => a.user_id).map(a => a.user_id!);
  const { data: profiles } = await supabase
    .from("profiles")
    .select("user_id, email")
    .in("user_id", userIds);

  const emailMap = new Map<string, string>();
  for (const a of agents || []) {
    if (a.user_id) {
      const p = profiles?.find(pr => pr.user_id === a.user_id);
      if (p) emailMap.set(a.id, p.email);
    }
  }

  cachedManagers = data.managers.map((m: { id: string; name: string }) => ({
    id: m.id,
    name: m.name,
    email: emailMap.get(m.id) || "",
  }));
  cacheTimestamp = now;
  return cachedManagers!;
}

export const QuickAssignMenu = forwardRef<HTMLDivElement, QuickAssignMenuProps>(
  ({ applicationId, currentAgentId, onAssigned, className, source = "applications" }, ref) => {
  const { playSound } = useSoundEffects();
  const [managers, setManagers] = useState<Manager[]>([]);
  const [loading, setLoading] = useState(false);
  const [assigning, setAssigning] = useState<string | null>(null);
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

  const handleAssign = async (managerId: string) => {
    if (managerId === currentAgentId) {
      toast.info("Already assigned to this manager");
      return;
    }

    setAssigning(managerId);
    try {
      const { error } = source === "aged_leads"
        ? await supabase
            .from("aged_leads")
            .update({ assigned_manager_id: managerId })
            .eq("id", applicationId)
        : await supabase
            .from("applications")
            .update({ assigned_agent_id: managerId })
            .eq("id", applicationId);

      if (error) throw error;

      // Notify the new manager (fire and forget)
      supabase.functions.invoke("notify-lead-assigned", {
        body: { applicationId, agentId: managerId },
      });

      playSound("success");
      toast.success("Lead reassigned successfully");
      onAssigned?.();
    } catch (err) {
      console.error("Failed to assign lead:", err);
      playSound("error");
      toast.error("Failed to reassign lead");
    } finally {
      setAssigning(null);
    }
  };

    return (
      <div ref={ref}>
        <DropdownMenu onOpenChange={handleOpenChange}>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className={className}
            >
              <UserPlus className="h-4 w-4 mr-1" />
              Assign
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64 bg-popover border-border z-50">
            <DropdownMenuLabel className="text-xs text-muted-foreground">
              Assign to Manager
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            
            {loading ? (
              <DropdownMenuItem disabled>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Loading managers...
              </DropdownMenuItem>
            ) : managers.length === 0 ? (
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
      </div>
    );
  }
);

QuickAssignMenu.displayName = "QuickAssignMenu";
