import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { BLOCKER_LABEL, WAITING_ON_LABEL, saveFollowup, type TeamPerson } from "@/lib/teamContracting";

type Owner = { user_id: string; name: string; roles: string[] };

const FIELD = "mt-1 min-h-[44px] w-full rounded-md border border-border bg-background px-3 text-base text-foreground";

/**
 * Plan the next follow-up for one person: when, who owns it, what it is waiting on, the blocker and the next step.
 * Saving a plan is NOT a contact and does not touch any milestone. It uses the existing follow-up record.
 * It lives inside the person drawer, so there is never a second dialog on top of the drawer.
 */
export function ContractingFollowupForm({ person, queryKey }: { person: TeamPerson; queryKey: readonly unknown[] }) {
  const qc = useQueryClient();
  const [date, setDate] = useState(person.followup.next_on ?? "");
  const [owner, setOwner] = useState(person.owner.source === "follow_up_owner" ? person.owner.user_id ?? "" : "");
  const [waiting, setWaiting] = useState(person.followup.waiting_on ?? "");
  const [blocker, setBlocker] = useState(person.followup.blocker ?? "");
  const [next, setNext] = useState(person.followup.next_action ?? "");
  const [saving, setSaving] = useState(false);
  const inFlight = useRef(false);

  const owners = useQuery({
    queryKey: ["contracting-owner-options"],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<Owner[]> => {
      const { data, error } = await supabase.rpc("contracting_case_owner_options" as never);
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as Owner[];
    },
  });

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true;
    setSaving(true);
    const res = await saveFollowup(person.agent_id, {
      follow_up_on: date || null, owner_user_id: owner || null, waiting_on: waiting || null, blocker: blocker || null, next_action: next.trim() || null,
    });
    inFlight.current = false;
    setSaving(false);
    if (!res.ok) { toast.error(`Follow-up not saved: ${res.error?.slice(0, 140)}`); return; }
    toast.success(`Follow-up saved for ${person.display_name}`);
    await qc.invalidateQueries({ queryKey });
  };

  return (
    <form onSubmit={(e) => void save(e)} className="space-y-3" aria-label={`Follow-up plan for ${person.display_name}`}>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm text-muted-foreground">Next follow-up date
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={FIELD} />
        </label>
        <label className="block text-sm text-muted-foreground">Who owns it
          <select value={owner} onChange={(e) => setOwner(e.target.value)} className={FIELD} disabled={owners.isLoading}>
            <option value="">{person.owner.source === "manager" ? `${person.owner.name} (their manager)` : "Unassigned"}</option>
            {(owners.data ?? []).map((o) => <option key={o.user_id} value={o.user_id}>{o.name}</option>)}
          </select>
          {owners.isError ? <span className="text-xs text-amber-700 dark:text-amber-400">Could not load the owner list. Saving keeps the current owner.</span> : null}
        </label>
        <label className="block text-sm text-muted-foreground">Waiting on
          <select value={waiting} onChange={(e) => setWaiting(e.target.value)} className={FIELD}>
            <option value="">Nobody recorded</option>
            {Object.entries(WAITING_ON_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label className="block text-sm text-muted-foreground">Blocker
          <select value={blocker} onChange={(e) => setBlocker(e.target.value)} className={FIELD}>
            <option value="">Not recorded</option>
            {Object.entries(BLOCKER_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
      </div>
      <label className="block text-sm text-muted-foreground">Next step
        <textarea value={next} onChange={(e) => setNext(e.target.value)} rows={2} maxLength={500} placeholder="What happens next, in a sentence" className={`${FIELD} py-2`} />
      </label>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={saving}>{saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Save follow-up</Button>
        <p className="text-xs text-muted-foreground">Saving a plan does not mark anything contacted and does not complete a milestone.</p>
      </div>
    </form>
  );
}
