import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { BLOCKER_LABEL, WAITING_ON_LABEL, saveFollowup, type TeamPerson } from "@/lib/teamContracting";

type Owner = { user_id: string; name: string; roles: string[] };

const FIELD = "mt-1 min-h-[44px] w-full rounded-lg border border-border bg-background px-3 text-base text-foreground";

/**
 * Plan the next follow-up for one person: when, who owns it, what it is waiting on, the blocker and the next step.
 * Saving a plan is NOT a contact and does not touch any milestone. It uses the existing follow-up record.
 */
export function ContractingFollowupDialog({ person, queryKey, onClose }: { person: TeamPerson | null; queryKey: readonly unknown[]; onClose: () => void }) {
  const qc = useQueryClient();
  const open = person !== null;
  const [date, setDate] = useState("");
  const [owner, setOwner] = useState("");
  const [waiting, setWaiting] = useState("");
  const [blocker, setBlocker] = useState("");
  const [next, setNext] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!person) return;
    setDate(person.followup.next_on ?? "");
    setOwner(person.owner.source === "follow_up_owner" ? person.owner.user_id ?? "" : "");
    setWaiting(person.followup.waiting_on ?? "");
    setBlocker(person.followup.blocker ?? "");
    setNext(person.followup.next_action ?? "");
  }, [person]);

  const owners = useQuery({
    queryKey: ["contracting-owner-options"],
    enabled: open,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<Owner[]> => {
      const { data, error } = await supabase.rpc("contracting_case_owner_options" as never);
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as Owner[];
    },
  });

  const save = async () => {
    if (!person) return;
    setSaving(true);
    const res = await saveFollowup(person.agent_id, {
      follow_up_on: date || null, owner_user_id: owner || null, waiting_on: waiting || null, blocker: blocker || null, next_action: next.trim() || null,
    });
    setSaving(false);
    if (!res.ok) { toast.error(`Follow-up not saved: ${res.error?.slice(0, 140)}`); return; }
    toast.success(`Follow-up saved for ${person.display_name}`);
    await qc.invalidateQueries({ queryKey });
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Follow-up for {person?.display_name}</DialogTitle>
          <DialogDescription>Saving a plan does not mark anything contacted and does not complete a milestone.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <label className="block text-sm text-muted-foreground">Next follow-up date
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={FIELD} />
          </label>
          <label className="block text-sm text-muted-foreground">Who owns it
            <select value={owner} onChange={(e) => setOwner(e.target.value)} className={FIELD} disabled={owners.isLoading}>
              <option value="">{person?.owner.source === "manager" ? `${person.owner.name} (their manager)` : "Unassigned"}</option>
              {(owners.data ?? []).map((o) => <option key={o.user_id} value={o.user_id}>{o.name}</option>)}
            </select>
            {owners.isError ? <span className="text-xs text-amber-500">Could not load the owner list. Saving keeps the current owner.</span> : null}
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
          <label className="block text-sm text-muted-foreground">Next step
            <textarea value={next} onChange={(e) => setNext(e.target.value)} rows={2} maxLength={500} placeholder="What happens next, in a sentence" className={`${FIELD} py-2`} />
          </label>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={() => void save()} disabled={saving}>{saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Save follow-up</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
