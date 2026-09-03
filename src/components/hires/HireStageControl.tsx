// MP-392 (2026-09-02): push a hire through onboarding from ANY page.
//
// advance_hire_stage() is the one audited write path for agents.onboarding_stage
// (gate = fn_can_move_hire, optimistic 40001 on drift, agent_stage_moves
// receipt, reports the onboarding emails it set in motion). Until this file it
// was mounted on exactly one page, the Hires board; every other surface either
// rendered the stage as text or wrote the column directly with no receipt.
//
// Three exports, one mutation:
//   useMoveHireStage()  — confirm → rpc → toast → invalidate. Every caller
//                         goes through this so the receipt and the email
//                         report are the same on every page.
//   HireStageStepper    — the five-rung rail from the board, plus a flags
//                         menu for the off-ladder states. For profile pages
//                         and drawers.
//   HireStageSelect     — a compact select for table rows.
//
// Both controls decide read-only vs editable from useAuth() (admin or
// manager). That is a display decision only; the server gate is the one that
// counts, and a manager clicking on somebody outside their tree gets the
// RPC's 42501 as a toast, not a silent no-op.
import { useCallback, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronDown, Flag } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useConfirm } from "@/hooks/useConfirm";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  HIRE_RUNGS,
  OFF_LADDER_STAGES,
  stageForRank,
  stageLabel,
  stageRank,
} from "@/lib/hireLadder";

/** The off-ladder flags, in the order they are offered. `evaluated` is a rung
 *  (rank 4) so it is not here; `applied`/`meeting_attendance` are pre-hire
 *  application states and are not offered as targets from an agent surface. */
export const HIRE_FLAGS = ["need_followup", "pending_review", "transfer", "below_10k", "inactive"] as const;

export type MoveHireInput = {
  agentId: string;
  name: string;
  toStage: string;
  /** The stage the caller last saw. Passed to the RPC as p_expected_stage so
   *  two people working the same hire cannot overwrite each other. */
  expectedStage: string | null;
  licenseStatus?: string | null;
  email?: string | null;
  note?: string | null;
};

export type MoveResult = {
  ok: boolean;
  changed: boolean;
  from?: string | null;
  stage: string;
  rank: number | null;
  onLadder?: boolean;
  licenseStatus?: string | null;
  queuedEmails?: string[];
  message?: string;
};

// Query keys that hold an agent's stage somewhere in their rows. A stage move
// is rare and a full invalidateQueries() would refetch every heavy dashboard
// RPC at once (the MP-388 stampede shape), so match on the key instead.
const STAGE_BEARING_KEY = /agent|hire|interview|producer|crm|onboard|team|roster|pipeline|account|inactive|course|profile/i;

/** Move a hire's stage with no confirm dialog and no toast — for flows where
 *  the stage change is a side effect of an action the user already confirmed
 *  (enrolling in the course, deactivating, a bulk sweep). Goes through the
 *  same RPC so the move is gated, audited in agent_stage_moves, and queues the
 *  licensed→live emails exactly like the visible control. Throws the
 *  PostgREST error on refusal (42501 not allowed, 40001 drift, 22023 unknown
 *  stage) so callers report it instead of pretending the row moved. */
export async function advanceHireStage(
  agentId: string,
  toStage: string,
  expectedStage: string | null = null,
  note: string | null = null,
): Promise<MoveResult> {
  const { data, error } = await supabase.rpc("advance_hire_stage" as never, {
    p_agent_id: agentId,
    p_to_stage: toStage,
    p_expected_stage: expectedStage,
    p_note: note,
  } as never);
  if (error) throw error;
  return data as unknown as MoveResult;
}

/** Query keys that hold an agent's stage somewhere in their rows. Exported so
 *  a caller using advanceHireStage() directly can refresh the same set. */
export function invalidateStageBearingQueries(qc: { invalidateQueries: (f: { predicate: (q: { queryKey: readonly unknown[] }) => boolean }) => unknown }) {
  void qc.invalidateQueries({
    predicate: (query) => {
      const head = query.queryKey[0];
      return typeof head === "string" && STAGE_BEARING_KEY.test(head);
    },
  });
}

export function useMoveHireStage(opts: { onMoved?: (result: MoveResult, input: MoveHireInput) => void } = {}) {
  const qc = useQueryClient();
  const askConfirm = useConfirm();
  const [pendingId, setPendingId] = useState<string | null>(null);

  const invalidate = useCallback(() => invalidateStageBearingQueries(qc), [qc]);

  const mutation = useMutation({
    mutationFn: (input: MoveHireInput) =>
      advanceHireStage(input.agentId, input.toStage, input.expectedStage, input.note ?? null),
    onSuccess: (result, input) => {
      if (!result.changed) {
        toast.info(result.message ?? "Already at that stage — nothing was written.");
      } else {
        const queued = result.queuedEmails ?? [];
        const suffix = queued.length
          ? ` ${queued.length} onboarding email${queued.length === 1 ? "" : "s"} queued: ${queued.map((k) => k.replace(/_/g, " ")).join(", ")}.`
          : "";
        toast.success(`${input.name} → ${stageLabel(result.stage)}.${suffix}`);
      }
      invalidate();
      opts.onMoved?.(result, input);
    },
    onError: (error: Error) => {
      toast.error(error.message || "Could not move this hire.");
      // 40001 = somebody else moved them; the fresh stage is the fix.
      invalidate();
    },
    onSettled: () => setPendingId(null),
  });

  const move = useCallback(async (input: MoveHireInput) => {
    const sends = input.toStage === "live" && input.licenseStatus === "licensed";
    const fromRank = stageRank(input.expectedStage);
    const toRank = stageRank(input.toStage);
    const backward = fromRank !== null && toRank !== null && fromRank > toRank;
    const flag = OFF_LADDER_STAGES.has(input.toStage);
    const ok = await askConfirm({
      title: flag
        ? `Flag ${input.name} as ${stageLabel(input.toStage)}?`
        : backward
          ? `Move ${input.name} back to ${stageLabel(input.toStage)}?`
          : `Move ${input.name} to ${stageLabel(input.toStage)}?`,
      description: sends
        ? `This is the point the onboarding emails go out — ${input.name} will be sent the course and Discord invites at ${input.email ?? "the email on file"}. Everything is recorded against your name.`
        : flag
          ? "This takes them off the onboarding ladder until somebody puts them back on a step. Recorded against your name. Nothing is sent."
          : backward
            ? "Moving somebody backwards is recorded the same as moving them forwards. Nothing is sent."
            : "Recorded against your name. No email is sent at this step.",
      confirmText: flag ? "Flag them" : "Move them",
      tone: sends || backward || flag ? "danger" : "primary",
    });
    if (!ok) return false;
    setPendingId(input.agentId);
    mutation.mutate(input);
    return true;
  }, [askConfirm, mutation]);

  return { move, pendingId, isPending: mutation.isPending };
}

export function useCanMoveHires(): boolean {
  const { isAdmin, isManager } = useAuth();
  return isAdmin || isManager;
}

type ControlProps = {
  agentId: string;
  name: string;
  stage: string | null | undefined;
  licenseStatus?: string | null;
  email?: string | null;
  className?: string;
  /** Force read-only regardless of role (e.g. a terminated agent). */
  readOnly?: boolean;
  onMoved?: (result: MoveResult) => void;
};

/** The five-rung rail from the Hires board plus a flags menu. */
export function HireStageStepper({ agentId, name, stage, licenseStatus, email, className, readOnly, onMoved }: ControlProps) {
  const canMove = useCanMoveHires() && !readOnly;
  const { move, pendingId } = useMoveHireStage({ onMoved: (r) => onMoved?.(r) });
  const busy = pendingId === agentId;
  const rank = stageRank(stage);
  const offLadder = rank === null && !!stage;

  const go = (toStage: string) => move({ agentId, name, toStage, expectedStage: stage ?? null, licenseStatus, email });

  if (!canMove) {
    return (
      <Badge variant="outline" className={cn("font-medium", className)}>{stageLabel(stage)}</Badge>
    );
  }

  return (
    <div className={cn("w-full", className)} role="group" aria-label={`Move ${name} through onboarding`}>
      <div className="grid grid-cols-5 gap-1">
        {HIRE_RUNGS.map((rung) => {
          const done = !offLadder && rung.rank <= (rank ?? 0);
          const current = !offLadder && rung.rank === rank;
          const target = stageForRank(rung.rank, stage);
          return (
            <button
              key={rung.rank}
              type="button"
              disabled={busy || current || !target}
              onClick={() => target && void go(target)}
              aria-current={current ? "step" : undefined}
              title={current ? `Currently ${stageLabel(stage)}` : `Move to ${rung.label}`}
              className="min-w-0 text-left disabled:cursor-default"
            >
              <div className={cn("h-1.5 rounded-full transition-colors", done ? "bg-primary" : "bg-muted")} />
              <p className={cn(
                "mt-1.5 truncate text-[9px] font-bold uppercase tracking-wide",
                current ? "text-primary" : done ? "text-foreground" : "text-muted-foreground/60",
              )}>
                {rung.short}
              </p>
            </button>
          );
        })}
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
        <span className="truncate">
          {offLadder
            ? <>Flagged <span className="font-bold text-foreground">{stageLabel(stage)}</span> · click a step to put them back on the ladder</>
            : <>{stageLabel(stage)} · click any step to move them</>}
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" size="sm" className="h-6 px-1.5 text-[10px]" disabled={busy} aria-label="Flag this hire">
              <Flag className="mr-1 h-3 w-3" aria-hidden="true" /> Flag <ChevronDown className="ml-0.5 h-3 w-3" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel className="text-xs">Take off the ladder</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {HIRE_FLAGS.map((flag) => (
              <DropdownMenuItem key={flag} disabled={stage === flag} onSelect={() => void go(flag)}>
                {stageLabel(flag)}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

/** A compact select for table rows and drawers. Read-only renders a badge. */
export function HireStageSelect({ agentId, name, stage, licenseStatus, email, className, readOnly, onMoved }: ControlProps) {
  const canMove = useCanMoveHires() && !readOnly;
  const { move, pendingId } = useMoveHireStage({ onMoved: (r) => onMoved?.(r) });
  const busy = pendingId === agentId;
  const current = stage ?? "";

  if (!canMove) {
    return <Badge variant="outline" className={cn("font-medium", className)}>{stageLabel(stage)}</Badge>;
  }

  return (
    <Select
      value={current}
      disabled={busy}
      onValueChange={(next) => {
        if (!next || next === current) return;
        void move({ agentId, name, toStage: next, expectedStage: stage ?? null, licenseStatus, email });
      }}
    >
      <SelectTrigger
        className={cn("h-8 min-w-[9.5rem] text-xs", className)}
        aria-label={`Onboarding stage for ${name}`}
        onClick={(e) => e.stopPropagation()}
      >
        <SelectValue placeholder="No stage">{stageLabel(stage)}</SelectValue>
      </SelectTrigger>
      <SelectContent onClick={(e) => e.stopPropagation()}>
        <SelectGroup>
          <SelectLabel>Onboarding ladder</SelectLabel>
          {HIRE_RUNGS.map((rung) => (
            <SelectItem key={rung.stage} value={rung.stage}>{rung.label}</SelectItem>
          ))}
          {current === "evaluated" && <SelectItem value="evaluated">Evaluated</SelectItem>}
        </SelectGroup>
        <SelectSeparator />
        <SelectGroup>
          <SelectLabel>Flags</SelectLabel>
          {HIRE_FLAGS.map((flag) => (
            <SelectItem key={flag} value={flag}>{stageLabel(flag)}</SelectItem>
          ))}
        </SelectGroup>
        {current && !HIRE_RUNGS.some((r) => r.stage === current) && current !== "evaluated" && !(HIRE_FLAGS as readonly string[]).includes(current) && (
          <SelectItem value={current}>{stageLabel(current)}</SelectItem>
        )}
      </SelectContent>
    </Select>
  );
}
