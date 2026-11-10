import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

// MP-TEAM-CARRIER-CONTRACTS — Sam, My Team: one tap per carrier to log that an agent has
// received their contract. Chubb / Ethos / American Home Life. Reads + writes the same
// getting_started_progress timestamps the contracting-stalled alert keys off, so a tap here
// also silences that weekly page for the carrier. AHL hides for OB's / Chudi's hierarchies
// (they carry no AHL), exactly as the alert skips them.
const CARRIERS = [
  { key: "chubb", label: "Chubb" },
  { key: "ethos", label: "Ethos" },
  { key: "ahl", label: "American Home Life" },
] as const;

interface ContractStatus {
  chubb: boolean; ethos: boolean; ahl: boolean; ahl_exempt: boolean;
  chubb_at: string | null; ethos_at: string | null; ahl_at: string | null;
}

const shortDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : null;

export function CarrierContractsPanel({ agentId }: { agentId: string }) {
  const { isAdmin, isManager } = useAuth();
  const qc = useQueryClient();
  const canSee = isAdmin || isManager;
  const key = ["carrier-contracts", agentId];

  const query = useQuery({
    queryKey: key,
    enabled: canSee && !!agentId,
    queryFn: async (): Promise<ContractStatus> => {
      const { data, error } = await supabase.rpc("team_carrier_contract_status" as never, { p_agent_id: agentId } as never);
      if (error) throw error;
      return data as unknown as ContractStatus;
    },
  });

  if (!canSee || !agentId) return null;
  const s = query.data;

  const toggle = async (carrier: string, next: boolean) => {
    // optimistic: flip the chip immediately, roll back on error
    const prev = qc.getQueryData<ContractStatus>(key);
    if (prev) qc.setQueryData<ContractStatus>(key, { ...prev, [carrier]: next, [`${carrier}_at`]: next ? new Date().toISOString() : null });
    const { data, error } = await supabase.rpc("set_team_carrier_contract" as never, { p_agent_id: agentId, p_carrier: carrier, p_received: next } as never);
    if (error) {
      if (prev) qc.setQueryData<ContractStatus>(key, prev);
      toast.error(`Couldn't update that contract: ${error.message}`);
      return;
    }
    qc.setQueryData<ContractStatus>(key, data as unknown as ContractStatus);
    toast.success(`${CARRIERS.find((c) => c.key === carrier)?.label}: ${next ? "marked received" : "cleared"}`);
  };

  return (
    <section className="space-y-2 border-t border-border pt-4" aria-label="Carrier contracts">
      <h3 className="text-[15px] font-semibold text-foreground">Carrier contracts</h3>
      <p className="text-[13px] text-muted-foreground">Tap when the agent has received each carrier's contract.</p>
      {query.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : query.isError ? (
        <p className="text-sm text-amber-700 dark:text-amber-400">
          Couldn't load carrier contracts.{" "}
          <button type="button" aria-label="Retry carrier contracts" className="font-semibold underline" onClick={() => void query.refetch()}>Retry</button>
        </p>
      ) : s ? (
        <div className="flex flex-col gap-2">
          {CARRIERS.map((c) => {
            if (c.key === "ahl" && s.ahl_exempt) {
              return (
                <div key={c.key} className="flex items-center justify-between rounded-lg border border-dashed border-border px-3 py-2.5 text-sm text-muted-foreground">
                  <span>{c.label}</span>
                  <span className="text-[12px]">Not in this hierarchy</span>
                </div>
              );
            }
            const on = Boolean(s[c.key as "chubb" | "ethos" | "ahl"]);
            const at = shortDate(s[`${c.key}_at` as "chubb_at" | "ethos_at" | "ahl_at"]);
            return (
              <button
                key={c.key}
                type="button"
                aria-pressed={on}
                onClick={() => void toggle(c.key, !on)}
                className={cn(
                  "flex items-center justify-between rounded-lg border px-3 py-2.5 text-left text-sm transition-colors",
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
                <span className="text-[12px] text-muted-foreground">{on ? (at ? `Received ${at}` : "Received") : "Tap to mark"}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
