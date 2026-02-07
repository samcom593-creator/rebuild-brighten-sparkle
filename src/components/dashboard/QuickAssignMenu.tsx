import { useState, useEffect, forwardRef } from "react";
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

export const QuickAssignMenu = forwardRef<HTMLDivElement, QuickAssignMenuProps>(
  ({ applicationId, currentAgentId, onAssigned, className }, ref) => {
  const [managers, setManagers] = useState<Manager[]>([]);
  const [loading, setLoading] = useState(false);
  const [assigning, setAssigning] = useState<string | null>(null);

  useEffect(() => {
    fetchManagers();
  }, []);

  const fetchManagers = async () => {
    setLoading(true);
    try {
      // Use edge function for consistent manager fetching (bypasses RLS)
      const { data, error } = await supabase.functions.invoke("get-active-managers");

      if (error) {
        console.error("Error fetching managers:", error);
        setManagers([]);
        return;
      }

      if (data?.managers && Array.isArray(data.managers)) {
        // Transform to expected format with email lookup
        const managersWithEmail: Manager[] = await Promise.all(
          data.managers.map(async (m: { id: string; name: string }) => {
            // Get email from profiles via agent lookup
            const { data: agent } = await supabase
              .from("agents")
              .select("user_id")
              .eq("id", m.id)
              .maybeSingle();

            if (agent?.user_id) {
              const { data: profile } = await supabase
                .from("profiles")
                .select("email")
                .eq("user_id", agent.user_id)
                .maybeSingle();

              return { id: m.id, name: m.name, email: profile?.email || "" };
            }
            return { id: m.id, name: m.name, email: "" };
          })
        );
        setManagers(managersWithEmail);
      } else {
        setManagers([]);
      }
    } catch (error) {
      console.error("Error fetching managers:", error);
      setManagers([]);
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
      <div ref={ref}>
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
          <DropdownMenuContent align="end" className="w-64 bg-popover border-border z-50">
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
      </div>
    );
  }
);

QuickAssignMenu.displayName = "QuickAssignMenu";
