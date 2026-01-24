import { useState } from "react";
import { Award, Plus, Minus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface PerformanceBadgesProps {
  agentId: string;
  badgeCount: number;
  onUpdate?: () => void;
  readOnly?: boolean;
}

export function PerformanceBadges({
  agentId,
  badgeCount,
  onUpdate,
  readOnly = false,
}: PerformanceBadgesProps) {
  const [count, setCount] = useState(badgeCount);
  const [updating, setUpdating] = useState(false);

  const handleUpdateCount = async (delta: number) => {
    if (readOnly || updating) return;
    
    const newCount = Math.max(0, count + delta);
    setUpdating(true);

    try {
      const { error } = await supabase
        .from("agents")
        .update({ weekly_10k_badges: newCount })
        .eq("id", agentId);

      if (error) throw error;

      setCount(newCount);
      toast.success(`Badge count updated to ${newCount}`);
      onUpdate?.();
    } catch (error) {
      console.error("Error updating badges:", error);
      toast.error("Failed to update badges");
    } finally {
      setUpdating(false);
    }
  };

  // Display badges as icons (max 5 visible, then show +X more)
  const displayCount = Math.min(count, 5);
  const extraCount = count > 5 ? count - 5 : 0;

  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-1">
        <Award className="h-4 w-4 text-amber-400" />
        <span className="text-sm font-medium text-amber-400">$10K+ Weeks:</span>
      </div>
      
      <div className="flex items-center gap-1">
        {count === 0 ? (
          <span className="text-sm text-muted-foreground">None yet</span>
        ) : (
          <>
            {Array.from({ length: displayCount }).map((_, i) => (
              <Award
                key={i}
                className="h-4 w-4 text-primary fill-primary"
              />
            ))}
            {extraCount > 0 && (
              <span className="text-sm font-medium text-primary ml-1">
                +{extraCount}
              </span>
            )}
            <span className="text-sm text-muted-foreground ml-1">
              ({count} total)
            </span>
          </>
        )}
      </div>

      {!readOnly && (
        <div className="flex items-center gap-1 ml-2">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => handleUpdateCount(-1)}
            disabled={updating || count === 0}
          >
            <Minus className="h-3 w-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => handleUpdateCount(1)}
            disabled={updating}
          >
            <Plus className="h-3 w-3" />
          </Button>
        </div>
      )}
    </div>
  );
}
