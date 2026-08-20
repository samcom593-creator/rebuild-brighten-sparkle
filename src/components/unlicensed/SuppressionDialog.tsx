/**
 * MP-257 — SuppressionDialog
 *
 * Required-reason confirmation dialog. Terminates the source row
 * (applications.terminated_at + termination_reason, or aged_leads.status='terminated').
 * Never auto-triggers — always requires an explicit confirm click from Sam or a VA.
 *
 * Consumed by src/pages/admin/UnlicensedAll.tsx.
 */
import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, ShieldOff } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export interface SuppressionTarget {
  id: string;
  source: "applied" | "aged_lead";
  first_name?: string | null;
  last_name?: string | null;
}

const REASONS: Array<{ key: string; label: string }> = [
  { key: "not_interested",           label: "Not interested" },
  { key: "bad_number",                label: "Bad number" },
  { key: "duplicate",                 label: "Duplicate" },
  { key: "already_licensed_elsewhere",label: "Already licensed elsewhere" },
  { key: "no_response_after_sequence",label: "No response after sequence" },
  { key: "invalid_record",            label: "Invalid record" },
  { key: "other",                     label: "Other" },
];

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  target: SuppressionTarget | null;
  /** Called after the suppress succeeds — parent can auto-advance the drawer. */
  onSuppressed?: (target: SuppressionTarget) => void;
}

export function SuppressionDialog({ open, onOpenChange, target, onSuppressed }: Props) {
  const qc = useQueryClient();
  const [reason, setReason] = useState<string>("");
  const [otherText, setOtherText] = useState<string>("");

  useEffect(() => {
    if (open) {
      setReason("");
      setOtherText("");
    }
  }, [open]);

  const suppress = useMutation({
    mutationFn: async () => {
      if (!target) throw new Error("no target");
      if (!reason) throw new Error("Reason required");
      if (reason === "other" && !otherText.trim()) throw new Error("Describe the reason");

      const finalReason = reason === "other" ? `other: ${otherText.trim()}` : reason;
      const nowIso = new Date().toISOString();

      if (target.source === "applied") {
        const { error } = await supabase
          .from("applications")
          .update({
            terminated_at: nowIso,
            termination_reason: finalReason,
          } as any)
          .eq("id", target.id);
        if (error) throw error;

        // Log the suppress outcome for the timeline.
        try {
          await supabase.rpc("log_contact_attempt" as any, {
            p_application_id: target.id,
            p_channel: "recovery_batch",
            p_outcome: "suppress",
            p_notes: finalReason,
          });
        } catch { // empty-catch-allow:fire-and-forget-telemetry
          // suppress log must not block termination.
        }
      } else {
        const { error } = await supabase
          .from("aged_leads")
          .update({
            status: "terminated",
            notes: `suppressed: ${finalReason}`,
          } as any)
          .eq("id", target.id);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success("Suppressed");
      qc.invalidateQueries({ queryKey: ["v_unlicensed_all"] });
      qc.invalidateQueries({ queryKey: ["mp257_kpis"] });
      if (target) onSuppressed?.(target);
      onOpenChange(false);
    },
    onError: (e) => toast.error(String(e instanceof Error ? e.message : e)),
  });

  const canSubmit = !!reason && (reason !== "other" || otherText.trim().length > 0);
  const targetName = target ? [target.first_name, target.last_name].filter(Boolean).join(" ") || "this record" : "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-[#0B1118] text-slate-100 border-white/10 max-w-md">
        <DialogHeader>
          <DialogTitle className="inline-flex items-center gap-2 text-slate-100">
            <ShieldOff className="h-4 w-4 text-rose-300" /> Suppress {targetName}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground text-xs">
            Suppressed records stay visible so managers can audit the rate — pick the real reason.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <RadioGroup value={reason} onValueChange={setReason} className="space-y-1.5">
            {REASONS.map((r) => (
              <div key={r.key} className="flex items-center gap-2">
                <RadioGroupItem
                  value={r.key}
                  id={`mp257-suppress-${r.key}`}
                  className="border-white/30 text-teal-300"
                />
                <Label htmlFor={`mp257-suppress-${r.key}`} className="text-sm text-slate-200 cursor-pointer">
                  {r.label}
                </Label>
              </div>
            ))}
          </RadioGroup>

          {reason === "other" && (
            <div>
              <Label htmlFor="mp257-suppress-other" className="text-[10px] uppercase tracking-widest text-muted-foreground">
                Describe the reason
              </Label>
              <Textarea
                id="mp257-suppress-other"
                value={otherText}
                onChange={(e) => setOtherText(e.target.value)}
                placeholder="Wrong person — this record was created for a different applicant with same first name."
                className="mt-1 min-h-[70px] bg-white/[0.03] border-white/10 text-slate-100 placeholder:text-muted-foreground"
              />
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            className="text-muted-foreground hover:text-slate-100"
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => suppress.mutate()}
            disabled={!canSubmit || suppress.isPending}
            className="bg-rose-500 text-slate-50 hover:bg-rose-600 disabled:opacity-60"
            aria-label="Confirm suppression"
          >
            {suppress.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : null}
            Suppress
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
