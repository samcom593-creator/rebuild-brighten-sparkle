import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { parseCarrierContractReceipts, RECEIPT_CARRIERS, type CarrierContractReceipts, type ReceiptCarrierKey } from "@/lib/carrierContractReceipts";

// MP-TEAM-CARRIER-CONTRACTS — Sam, My Team: one tap per carrier to log that an agent has
// received their contract. Since the Nov11 migration, this RPC reads/writes contract_review_marks and projects
// into getting_started_progress. Its supported keys are a receipt tracker, not a promise of the current catalog.

const shortDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : null;

export function CarrierContractsPanel({ agentId, readOnly = false }: { agentId: string; readOnly?: boolean }) {
  const { user, isAdmin, isManager } = useAuth();
  const qc = useQueryClient();
  const canSee = isAdmin || isManager;
  const key = ["carrier-contracts", user?.id, agentId];
  const inFlight = useRef(false);
  const [saving, setSaving] = useState(false);

  const query = useQuery({
    queryKey: key,
    enabled: canSee && !!agentId,
    queryFn: async (): Promise<CarrierContractReceipts> => {
      const { data, error } = await supabase.rpc("team_carrier_contract_status", { p_agent_id: agentId });
      if (error) throw error;
      return parseCarrierContractReceipts(data);
    },
  });

  if (!canSee || !agentId) return null;
  const s = query.data;

  const toggle = async (carrier: ReceiptCarrierKey, next: boolean) => {
    if (readOnly || inFlight.current) return;
    inFlight.current = true;
    setSaving(true);
    try {
      const { data, error } = await supabase.rpc("set_team_carrier_contract", { p_agent_id: agentId, p_carrier: carrier, p_received: next });
      if (error) throw error;
      const receipt = parseCarrierContractReceipts(data);
      if (receipt[carrier] !== next) throw new Error("The requested receipt was not confirmed. Refresh and try again.");
      qc.setQueryData<CarrierContractReceipts>(key, receipt);
      void qc.invalidateQueries({ queryKey: ["contract-review-roster"] });
      toast.success(`${RECEIPT_CARRIERS.find((c) => c.key === carrier)?.label}: ${next ? "marked received" : "cleared"}`);
    } catch (error) {
      toast.error(`Couldn't update that contract: ${error instanceof Error ? error.message : "The saved receipt could not be verified."}`);
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  };

  return (
    <section className="space-y-2 border-t border-border pt-4" aria-label="Carrier contracts">
      <h3 className="text-base font-semibold text-foreground">Carrier contract receipts</h3>
      <p className="text-sm text-muted-foreground">{readOnly ? "Saved manual receipts from the team tracker." : "Mark received only after verifying the agent's contract in the carrier portal."} This tracker does not list every available carrier.</p>
      {query.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : query.isError ? (
        <p role="alert" className="text-sm text-amber-700 dark:text-amber-400">
          Couldn't load carrier contracts.{" "}
          <button type="button" aria-label="Retry carrier contracts" className="font-semibold underline" onClick={() => void query.refetch()}>Retry</button>
        </p>
      ) : s ? (
        <div className="flex flex-col gap-2">
          {RECEIPT_CARRIERS.map((c) => {
            if (c.key === "ahl" && s.ahl_exempt) {
              return (
                <div key={c.key} className="flex items-center justify-between rounded-lg border border-dashed border-border px-3 py-2.5 text-sm text-muted-foreground">
                  <span>{c.label}</span>
                  <span className="text-[12px]">Not in this hierarchy</span>
                </div>
              );
            }
            const on = s[c.key];
            const at = shortDate(s[`${c.key}_at` as "chubb_at" | "ethos_at" | "ahl_at"]);
            return (
              <button
                key={c.key}
                type="button"
                aria-pressed={on}
                disabled={readOnly || saving}
                onClick={() => void toggle(c.key, !on)}
                className={cn(
                  "flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors disabled:cursor-default",
                  on
                    ? "border-emerald-500/40 bg-emerald-500/10 text-foreground"
                    : "border-border bg-background hover:bg-muted/40 text-foreground",
                )}
              >
                <span className="flex items-center gap-2">
                  <span className={cn(
                    "flex h-5 w-5 items-center justify-center rounded-full border",
                    on ? "border-emerald-500 bg-emerald-500 text-white" : "border-border",
                  )}>
                    {on ? <Check className="h-3.5 w-3.5" aria-hidden /> : null}
                  </span>
                  {c.label}
                </span>
                <span className="text-right text-sm text-muted-foreground">{on ? (at ? `Received ${at}` : "Received") : "No receipt recorded"}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
