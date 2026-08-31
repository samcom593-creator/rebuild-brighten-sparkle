import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * MP-343: move a recruit to any pipeline stage, from the pipeline itself.
 *
 * Sam: "make me able to move people through the pipeline, I should have full
 * control." Before this the board could only terminate, restore, or set license
 * progress on someone who was already an AGENT — and the recruiting pipeline is
 * almost entirely applications, so the people most in need of moving were the
 * ones nothing could move.
 *
 * The server (set_applicant_stage) owns the rules: it writes the timestamp that
 * defines the target stage and clears the later ones, because the board derives
 * stage from timestamps and a backwards move would otherwise be outranked and
 * snap forward again. It refuses anyone outside can_work_application, the same
 * gate as calling them, and records every move in applicant_stage_moves.
 *
 * Backwards moves are offered deliberately. "Full control" that only ratchets
 * forward is not control — a miskeyed stage would be permanent.
 */
export const PIPELINE_STAGES = [
  { key: "applied", label: "Applied" },
  { key: "course", label: "Course purchased" },
  { key: "finished_course", label: "Finished course" },
  { key: "test_scheduled", label: "Test scheduled" },
  { key: "passed_test", label: "Passed test" },
  { key: "licensed", label: "Licensed" },
  { key: "contracted", label: "Contracted" },
] as const;

export function StageMover({
  applicationId,
  currentStage,
  personName,
  onMoved,
}: {
  applicationId: string;
  currentStage?: string;
  personName?: string;
  onMoved?: () => void;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const move = useMutation({
    mutationFn: async (stage: string) => {
      const { data, error } = await supabase.rpc("set_applicant_stage" as never, {
        p_application_id: applicationId,
        p_stage: stage,
        p_note: null,
      } as never);
      if (error) throw error;
      return data as unknown as { from_stage: string; to_stage: string };
    },
    onSuccess: (result) => {
      const label = PIPELINE_STAGES.find((s) => s.key === result?.to_stage)?.label ?? result?.to_stage;
      toast.success(`${personName ?? "Recruit"} moved to ${label}`);
      void queryClient.invalidateQueries({ queryKey: ["applications"] });
      void queryClient.invalidateQueries({ queryKey: ["onboarding-roll-call"] });
      setOpen(false);
      onMoved?.();
    },
    // The server's refusal text is the useful message ("that person is not
    // yours to move"), so it is surfaced rather than replaced with a generic one.
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : "Could not move this person");
    },
  });

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          className="h-7 gap-1 text-xs"
          disabled={move.isPending}
          aria-label={`Move ${personName ?? "recruit"} to another pipeline stage`}
        >
          {move.isPending ? "Moving…" : "Move stage"}
          <ChevronRight className="h-3 w-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          Move {personName ?? "this recruit"} to
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {PIPELINE_STAGES.map((stage) => (
          <DropdownMenuItem
            key={stage.key}
            disabled={stage.key === currentStage || move.isPending}
            onSelect={(event) => {
              event.preventDefault();
              move.mutate(stage.key);
            }}
          >
            {stage.label}
            {stage.key === currentStage && (
              <span className="ml-auto text-[10px] text-muted-foreground">current</span>
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
