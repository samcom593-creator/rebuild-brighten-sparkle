// HandoffButton: hand a warm lead to a stronger closer in one tap (MP-310, 2026-10-29).
//
// Sam: "help us find deals that could be easily closed by more experienced agents." Sam and Aisha pick the closer;
// lead_bundle_handoff() puts the lead in that closer's own handoff bundle and gives them access. It refuses a
// do-not-call number and a lead someone already holds, and the lead shows on the closer's My Leads page.
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { closerOptionLabel, fetchClosers } from "@/lib/closers";

export function HandoffButton({ phone10, leadName, onDone }: { phone10: string; leadName: string; onDone?: () => void }) {
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState("");
  const closers = useQuery({ queryKey: ["closer-candidates"], queryFn: fetchClosers, staleTime: 10 * 60_000, enabled: open });
  const go = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("lead_bundle_handoff" as never, { p_phone10: phone10, p_user: to, p_note: null } as never);
      if (error) throw new Error(error.message);
      return (data ?? {}) as { closer?: string };
    },
    onSuccess: (r) => {
      toast.success(`${leadName} is with ${r.closer ?? "that closer"} now, on their My Leads page.`);
      setOpen(false);
      setTo("");
      onDone?.();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  if (!open) return <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>Hand to a closer</Button>;
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <select value={to} onChange={(e) => setTo(e.target.value)} aria-label="Closer" className="h-8 rounded-md border border-border bg-background px-2 text-sm">
        <option value="">{closers.isLoading ? "Loading closers…" : "Pick a closer"}</option>
        {(closers.data ?? []).map((c) => <option key={c.user_id} value={c.user_id}>{closerOptionLabel(c)}</option>)}
      </select>
      <Button type="button" size="sm" disabled={!to || go.isPending} onClick={() => go.mutate()}>Hand over</Button>
      <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
    </span>
  );
}
