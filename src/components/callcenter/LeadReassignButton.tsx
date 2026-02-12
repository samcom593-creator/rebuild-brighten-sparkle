import { useState, useRef } from "react";
import { motion } from "framer-motion";
import { Users, Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface Manager {
  id: string;
  name: string;
}

interface LeadReassignButtonProps {
  leadId: string;
  leadSource: "aged_leads" | "applications";
  currentManagerId?: string;
  onReassigned?: (newManagerId: string) => void;
  className?: string;
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

export function LeadReassignButton({
  leadId,
  leadSource,
  currentManagerId,
  onReassigned,
  className,
}: LeadReassignButtonProps) {
  const [open, setOpen] = useState(false);
  const [managers, setManagers] = useState<Manager[]>([]);
  const [loading, setLoading] = useState(false);
  const [reassigning, setReassigning] = useState(false);
  const [selectedManagerId, setSelectedManagerId] = useState<string | null>(null);
  const hasFetched = useRef(false);

  const handleOpenChange = async (isOpen: boolean) => {
    setOpen(isOpen);
    if (isOpen && !hasFetched.current) {
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

      const managerName = managers.find((m) => m.id === managerId)?.name || "Manager";
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
    <Popover open={open} onOpenChange={handleOpenChange}>
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
          
          {loading ? (
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
                    <span className="truncate">{manager.name}</span>
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
