import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { OUTCOME_LABEL, logContactOutcome } from "@/lib/teamContracting";

/**
 * Record what actually happened on a contact attempt. Opening a dial link is NOT a completed call, so a contact only
 * counts once somebody picks an outcome here. One outcome at a time: a second tap while the first is saving is ignored.
 */
export function ContactOutcomeButtons({ agentId, name, queryKey, onLogged, onSkip }: {
  agentId: string;
  name: string;
  queryKey: readonly unknown[];
  onLogged?: () => void;
  onSkip?: () => void;
}) {
  const qc = useQueryClient();
  const inFlight = useRef(false);
  const [saving, setSaving] = useState(false);

  const log = async (outcome: keyof typeof OUTCOME_LABEL) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setSaving(true);
    const r = await logContactOutcome(agentId, outcome);
    inFlight.current = false;
    setSaving(false);
    if (!r.ok) { toast.error(`Contact not recorded: ${r.error?.slice(0, 140)}`); return; }
    toast.success(`Recorded: ${OUTCOME_LABEL[outcome]} · ${name}`);
    await qc.invalidateQueries({ queryKey });
    onLogged?.();
  };

  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label={`Record what happened with ${name}`}>
      {Object.entries(OUTCOME_LABEL).map(([k, v]) => (
        <button key={k} type="button" disabled={saving} onClick={() => void log(k as keyof typeof OUTCOME_LABEL)}
          className="min-h-[40px] rounded-full border border-border bg-background px-3 text-sm font-medium hover:border-primary disabled:opacity-60">{v}</button>
      ))}
      {onSkip ? <button type="button" onClick={onSkip} className="min-h-[40px] px-2 text-sm text-muted-foreground underline">Skip</button> : null}
    </div>
  );
}
