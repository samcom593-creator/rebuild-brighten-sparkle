/**
 * LeadStatePrompt (MP-MORNING-LEADS part 2, 2026-11-23): one question that unlocks a licensed agent's leads.
 *
 * 21 of 51 licensed agents had no license state on file in any of the six places it is recorded, so the
 * morning grant had no state to match leads to and skipped them. The owner can save it from Home; this lets
 * the agent answer it themselves.
 *
 * Contract:
 *   - source: my_leads_state_prompt() -> { needs_state }. True only for an active licensed agent with no
 *             state anywhere and nothing else holding their leads back. Anything else renders nothing.
 *   - write:  my_leads_set_state(states[]) saves the states and grants the leads in the same call.
 *   - a failed read renders nothing: this card is an offer, and My Leads already reports its own errors.
 */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MapPin, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/glass-card";
import { US_STATES } from "@/lib/constants";
import { MY_LEADS_QUERY_KEY } from "@/lib/myLeads";
import { errorMessage } from "@/lib/queryState";
import { addState, stateName } from "@/lib/leadStatePrompt";

type RpcFn<T> = (fn: string, args?: Record<string, unknown>) => Promise<{ data: T | null; error: { message: string } | null }>;

export const LEAD_STATE_PROMPT_KEY = ["my-leads-state-prompt"] as const;

interface SetStateReply {
  ok?: boolean;
  leads?: { decision?: string; leads?: number; reason?: string } | null;
}

export function LeadStatePrompt() {
  const queryClient = useQueryClient();
  const [states, setStates] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const query = useQuery({
    queryKey: LEAD_STATE_PROMPT_KEY,
    queryFn: async (): Promise<boolean> => {
      const { data, error } = await (supabase.rpc as unknown as RpcFn<{ needs_state?: boolean }>)("my_leads_state_prompt");
      if (error) throw new Error(error.message);
      return data?.needs_state === true;
    },
    staleTime: 5 * 60_000,
    retry: false,
  });

  if (query.data !== true) return null;

  const save = async () => {
    if (states.length === 0 || saving) return;
    setSaving(true);
    try {
      const { data, error } = await (supabase.rpc as unknown as RpcFn<SetStateReply>)("my_leads_set_state", { p_states: states });
      if (error) throw new Error(error.message);
      const granted = data?.leads?.decision === "granted" ? data.leads.leads ?? 0 : 0;
      toast.success(granted > 0 ? `${granted} leads are in My Leads now.` : "Saved. Your leads are on the way.");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: LEAD_STATE_PROMPT_KEY }),
        queryClient.invalidateQueries({ queryKey: MY_LEADS_QUERY_KEY }),
      ]);
    } catch (err) {
      toast.error(errorMessage(err, "That did not save. Try again."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <GlassCard className="border-primary/40 bg-primary/5 p-4" data-testid="lead-state-prompt">
      <div className="flex items-start gap-3">
        <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary" aria-hidden="true">
          <MapPin className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-base font-semibold leading-tight">Your leads are ready. Which state are you licensed in?</p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Leads are matched to the states you can write in. Pick yours and they land in My Leads right away.
          </p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
            <label htmlFor="lead-state-select" className="sr-only">State you are licensed in</label>
            <select
              id="lead-state-select"
              data-testid="lead-state-select"
              value=""
              onChange={(e) => setStates((prev) => addState(prev, e.target.value))}
              className="h-11 w-full rounded-md border border-input bg-background px-3 text-base text-foreground focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)] sm:max-w-xs"
            >
              <option value="">{states.length === 0 ? "Choose your state" : "Add another state"}</option>
              {US_STATES.filter((st) => !states.includes(st.value)).map((st) => (
                <option key={st.value} value={st.value}>{st.label}</option>
              ))}
            </select>
            <Button className="h-11 w-full sm:w-auto" disabled={states.length === 0 || saving} onClick={save}>
              {saving ? "Getting your leads" : "Get my leads"}
            </Button>
          </div>
          {states.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-2" aria-label="States chosen">
              {states.map((code) => (
                <li key={code}>
                  <button
                    type="button"
                    onClick={() => setStates((prev) => prev.filter((s) => s !== code))}
                    className="inline-flex min-h-9 items-center gap-1 rounded-full border border-border bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)]"
                    aria-label={`Remove ${stateName(code)}`}
                  >
                    {stateName(code)} <X className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </GlassCard>
  );
}

export default LeadStatePrompt;
