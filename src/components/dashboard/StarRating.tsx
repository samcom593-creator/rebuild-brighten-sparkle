import { useState } from "react";
import { Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface StarRatingProps {
  agentId: string;
  rating: number;
  onUpdate?: () => void;
  readOnly?: boolean;
  size?: "sm" | "md";
}

export function StarRating({
  agentId,
  rating,
  onUpdate,
  readOnly = false,
  size = "md",
}: StarRatingProps) {
  const [hoveredStar, setHoveredStar] = useState<number | null>(null);
  const [updating, setUpdating] = useState(false);

  const handleClick = async (starValue: number) => {
    if (readOnly || updating) return;
    
    // If clicking the same star, toggle off (set to 0)
    const newRating = starValue === rating ? 0 : starValue;
    
    setUpdating(true);
    try {
      const { error } = await supabase
        .from("agents")
        .update({ potential_rating: newRating })
        .eq("id", agentId);

      if (error) throw error;
      
      toast.success("Potential rating updated");
      onUpdate?.();
    } catch (error) {
      console.error("Error updating rating:", error);
      toast.error("Failed to update rating");
    } finally {
      setUpdating(false);
    }
  };

  const displayRating = hoveredStar !== null ? hoveredStar : rating;
  const starSize = size === "sm" ? "h-3 w-3" : "h-4 w-4";

  return (
    <div className="flex flex-col items-end gap-1">
      <div 
        className={cn(
          "flex gap-0.5",
          updating && "opacity-50"
        )}
        onMouseLeave={() => setHoveredStar(null)}
      >
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            onClick={() => handleClick(star)}
            onMouseEnter={() => !readOnly && setHoveredStar(star)}
            disabled={readOnly || updating}
            className={cn(
              "transition-transform",
              !readOnly && "hover:scale-110 cursor-pointer"
            )}
          >
            <Star
              className={cn(
                starSize,
                star <= displayRating
                  ? "fill-amber-400 text-amber-400"
                  : "text-muted-foreground/40"
              )}
            />
          </button>
        ))}
      </div>
      <span className="text-[10px] text-muted-foreground">
        Potential: {rating}/5
      </span>
    </div>
  );
}
