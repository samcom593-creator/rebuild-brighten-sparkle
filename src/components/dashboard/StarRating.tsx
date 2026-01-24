import { useState, useEffect } from "react";
import { Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

interface StarRatingProps {
  agentId: string;
  rating: number;
  onUpdate?: () => void;
  readOnly?: boolean;
  size?: "sm" | "md";
}

interface ManagerRating {
  rated_by: string;
  rating: number;
}

export function StarRating({
  agentId,
  rating,
  onUpdate,
  readOnly = false,
  size = "md",
}: StarRatingProps) {
  const { user, isAdmin, isManager } = useAuth();
  const [hoveredStar, setHoveredStar] = useState<number | null>(null);
  const [updating, setUpdating] = useState(false);
  const [managerRatings, setManagerRatings] = useState<ManagerRating[]>([]);
  const [myRating, setMyRating] = useState<number | null>(null);
  const [averageRating, setAverageRating] = useState(rating);

  useEffect(() => {
    if (user && (isAdmin || isManager)) {
      fetchRatings();
    }
  }, [agentId, user, isAdmin, isManager]);

  const fetchRatings = async () => {
    try {
      const { data, error } = await supabase
        .from("agent_ratings")
        .select("rated_by, rating")
        .eq("agent_id", agentId);

      if (error) throw error;

      if (data && data.length > 0) {
        setManagerRatings(data);
        
        // Calculate average
        const avg = data.reduce((sum, r) => sum + r.rating, 0) / data.length;
        setAverageRating(Math.round(avg * 10) / 10);
        
        // Find my rating
        const mine = data.find(r => r.rated_by === user?.id);
        if (mine) {
          setMyRating(mine.rating);
        }
      } else {
        // Fallback to the rating from agents table
        setAverageRating(rating);
      }
    } catch (error) {
      console.error("Error fetching ratings:", error);
    }
  };

  const handleClick = async (starValue: number) => {
    if (readOnly || updating || !user) return;

    // Toggle off if clicking the same star
    const newRating = myRating === starValue ? 0 : starValue;

    setUpdating(true);
    try {
      if (newRating === 0) {
        // Delete the rating
        const { error } = await supabase
          .from("agent_ratings")
          .delete()
          .eq("agent_id", agentId)
          .eq("rated_by", user.id);

        if (error) throw error;
        setMyRating(null);
      } else {
        // Upsert the rating
        const { error } = await supabase
          .from("agent_ratings")
          .upsert(
            {
              agent_id: agentId,
              rated_by: user.id,
              rating: newRating,
            },
            { onConflict: "agent_id,rated_by" }
          );

        if (error) throw error;
        setMyRating(newRating);
      }

      // Recalculate average and update agents table
      const { data: allRatings } = await supabase
        .from("agent_ratings")
        .select("rating")
        .eq("agent_id", agentId);

      const newAvg = allRatings && allRatings.length > 0
        ? allRatings.reduce((sum, r) => sum + r.rating, 0) / allRatings.length
        : 0;

      // Update the agents table with the new average
      await supabase
        .from("agents")
        .update({ potential_rating: Math.round(newAvg) })
        .eq("id", agentId);

      setAverageRating(Math.round(newAvg * 10) / 10);
      toast.success("Rating updated");
      onUpdate?.();
    } catch (error: any) {
      console.error("Error updating rating:", error);
      toast.error("Failed to update rating");
    } finally {
      setUpdating(false);
    }
  };

  const displayRating = hoveredStar !== null ? hoveredStar : averageRating;
  const starSize = size === "sm" ? "h-3 w-3" : "h-4 w-4";
  const ratingCount = managerRatings.length;

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
      <div className="flex flex-col items-end">
        <span className="text-[10px] text-muted-foreground">
          Potential: {averageRating}/5
          {ratingCount > 0 && (
            <span className="opacity-70 ml-1">({ratingCount})</span>
          )}
        </span>
        {myRating !== null && (
          <span className="text-[10px] text-primary">Your: {myRating}/5</span>
        )}
      </div>
    </div>
  );
}
