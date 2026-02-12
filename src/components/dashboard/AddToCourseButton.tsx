import { useState } from "react";
import { GraduationCap, Loader2, Check, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface AddToCourseButtonProps {
  agentId: string;
  agentName: string;
  hasProgress?: boolean;
  onSuccess?: () => void;
  variant?: "default" | "outline" | "ghost";
  size?: "default" | "sm" | "icon";
}

export function AddToCourseButton({
  agentId,
  agentName,
  hasProgress = false,
  onSuccess,
  variant = "outline",
  size = "sm",
}: AddToCourseButtonProps) {
  const [enrolling, setEnrolling] = useState(false);

  const handleEnroll = async () => {
    setEnrolling(true);

    try {
      // 1. Check if agent already has progress
      const { data: existingProgress } = await supabase
        .from("onboarding_progress")
        .select("id")
        .eq("agent_id", agentId)
        .limit(1);

      if (existingProgress && existingProgress.length > 0) {
        toast.info(`${agentName} is already enrolled in the course`);
        setEnrolling(false);
        return;
      }

      // 2. Get the first active module
      const { data: firstModule, error: moduleError } = await supabase
        .from("onboarding_modules")
        .select("id")
        .eq("is_active", true)
        .order("order_index", { ascending: true })
        .limit(1)
        .maybeSingle();

      if (moduleError || !firstModule) {
        toast.error("No active course modules found");
        setEnrolling(false);
        return;
      }

      // 3. Update agent stage to training_online
      const { error: stageError } = await supabase
        .from("agents")
        .update({ 
          onboarding_stage: "training_online",
          has_training_course: true 
        })
        .eq("id", agentId);

      if (stageError) {
        console.error("Error updating agent stage:", stageError);
        toast.error("Failed to update agent stage");
        setEnrolling(false);
        return;
      }

      // 4. Create initial progress record
      const { error: progressError } = await supabase
        .from("onboarding_progress")
        .insert({
          agent_id: agentId,
          module_id: firstModule.id,
          started_at: new Date().toISOString(),
          video_watched_percent: 0,
          passed: false,
        });

      if (progressError) {
        console.error("Error creating progress:", progressError);
        toast.error("Failed to initialize course progress");
        setEnrolling(false);
        return;
      }

      // 5. Send course enrollment email with magic link
      const { error: emailError } = await supabase.functions.invoke(
        "send-course-enrollment-email",
        { body: { agentId } }
      );

      if (emailError) {
        console.warn("Course enrolled but login email failed:", emailError);
        toast.success(`${agentName} enrolled in course (login email may have failed)`);
      } else {
        toast.success(`✓ ${agentName} enrolled in course. Login sent!`);
      }

      onSuccess?.();
    } catch (error) {
      console.error("Error enrolling agent:", error);
      toast.error("Failed to enroll agent in course");
    } finally {
      setEnrolling(false);
    }
  };

  // Already enrolled
  if (hasProgress) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size={size}
              disabled
              className="text-emerald-500 cursor-default"
            >
              <Check className="h-4 w-4" />
              {size !== "icon" && <span className="ml-1">Enrolled</span>}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>Already enrolled in course</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant={variant}
            size={size}
            onClick={handleEnroll}
            disabled={enrolling}
            className="gap-1"
          >
            {enrolling ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <GraduationCap className="h-4 w-4" />
            )}
            {size !== "icon" && (
              <span>{enrolling ? "Enrolling..." : "Add to Course"}</span>
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>Enroll in onboarding course & send login</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
