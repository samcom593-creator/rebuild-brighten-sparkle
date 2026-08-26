import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Pencil } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

// Admin-only inline editor for an agent's contract (comp) level. Writes through
// public.set_agent_contract_pct, which lands on the canonical agent id with
// source 'admin_ui'. The server refuses non-admins (42501), so this control is
// only rendered when the scoreboard payload proves the viewer is an admin.
export function CompLevelEditor({
  agentId,
  agentName,
  currentPct,
  provenance,
  onSaved,
}: {
  agentId: string;
  agentName: string;
  currentPct: number;
  provenance: string;
  onSaved?: () => void;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [pct, setPct] = useState(String(currentPct));
  const [note, setNote] = useState("");

  const mutation = useMutation({
    mutationFn: async (input: { pct: number; note: string }) => {
      const { data, error } = await supabase.rpc("set_agent_contract_pct" as never, {
        p_agent_id: agentId,
        p_pct: input.pct,
        p_note: input.note || null,
      } as never);
      if (error) throw error;
      return data as unknown as { resolved_pct: number; resolved_provenance: string };
    },
    onSuccess: (data) => {
      toast.success(`Saved ${agentName} at ${data?.resolved_pct ?? pct}% comp`);
      void queryClient.invalidateQueries({ queryKey: ["scoped-production-scoreboard"] });
      void queryClient.invalidateQueries({ queryKey: ["finances-overview"] });
      setOpen(false);
      setNote("");
      onSaved?.();
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : "Comp level was not saved";
      toast.error(message);
    },
  });

  const parsed = Number(pct);
  const valid = pct.trim() !== "" && Number.isFinite(parsed) && parsed >= 0 && parsed <= 200;

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setPct(String(currentPct));
      }}
    >
      <PopoverTrigger asChild>
        <Button
          aria-label={`Edit comp level for ${agentName}`}
          className="h-6 w-6 p-0 text-muted-foreground hover:text-primary"
          size="sm"
          variant="ghost"
        >
          <Pencil className="h-3 w-3" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 space-y-3">
        <div>
          <p className="text-sm font-semibold text-foreground">{agentName}</p>
          <p className="text-xs text-muted-foreground">
            Current {currentPct}% · {provenance.replace(/_/g, " ")}
          </p>
        </div>
        <div className="space-y-1">
          <Label className="text-xs" htmlFor={`comp-pct-${agentId}`}>Contract %</Label>
          <Input
            id={`comp-pct-${agentId}`}
            inputMode="decimal"
            max={200}
            min={0}
            step={0.1}
            type="number"
            value={pct}
            onChange={(event) => setPct(event.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs" htmlFor={`comp-note-${agentId}`}>Note (optional)</Label>
          <Input
            id={`comp-note-${agentId}`}
            placeholder="e.g. Carrier contract level confirmed"
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </div>
        {!valid && pct.trim() !== "" && (
          <p className="text-xs text-destructive">Enter a value between 0 and 200.</p>
        )}
        <div className="flex justify-end gap-2">
          <Button onClick={() => setOpen(false)} size="sm" variant="outline">Cancel</Button>
          <Button
            disabled={!valid || mutation.isPending}
            onClick={() => mutation.mutate({ pct: parsed, note: note.trim() })}
            size="sm"
          >
            {mutation.isPending ? "Saving…" : "Save comp level"}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
