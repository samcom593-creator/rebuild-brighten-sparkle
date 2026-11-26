import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { looseSupabase } from "@/lib/looseSupabase";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { errorMessage } from "@/components/ui/query-state";

// MP-PROJ-INP-TRUTH (2026-11-25). The Mark paid / Lapsed / Not taken control
// the CFO sheets have asked for since 2026-11-16 (CFO-NATIVE-RECONCILE-UI-001).
//
// 220 native deals / $360,672 of written ALP sit at "Issued, not paid" and not
// one has ever moved: the status is a log-time default on a feed that retired
// 2026-10-17, and nothing in the app could write a payment outcome. The
// backend write path shipped 2026-11-21 (reconcile_native_deal_payment) and was
// proven to touch ONLY policy_status_standard + status_updated_at + version: no
// outbox_events, no production_ledger, no Discord, no InsuraCloud. This is the
// UI half. fn_native_deal_reconcile_context supplies the row version for the
// RPC's optimistic lock under the same admin-or-manager-over-agent rule, because
// managers have no RLS read on public.deals.
//
// What this is NOT: it does not confirm payment with a carrier. The person
// clicking is attesting what the producer or the carrier portal told them; the
// reason is recorded in deal_status_history and audit_log with their identity.

type Outcome = "paid" | "lapsed" | "not_taken";

const OUTCOMES: Array<{ key: Outcome; label: string; hint: string }> = [
  { key: "paid", label: "Paid · in force", hint: "The first premium cleared and the policy is in force." },
  { key: "lapsed", label: "Lapsed", hint: "It was issued, then lapsed or was cancelled." },
  { key: "not_taken", label: "Not taken", hint: "It never went in force; no premium was ever paid." },
];

type ReconcileContext = {
  found: boolean;
  deal_id?: string;
  version?: number;
  source?: string | null;
  status?: string | null;
  policy_status_standard?: string | null;
  status_updated_at?: string | null;
  reconcilable?: boolean;
};

export function NativePaymentReconcile({
  dealId,
  clientName,
}: {
  dealId: string;
  clientName: string | null;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState(false);

  const context = useQuery({
    queryKey: ["native-deal-reconcile-context", dealId],
    enabled: open,
    staleTime: 0,
    retry: 1,
    queryFn: async (): Promise<ReconcileContext> => {
      const { data, error } = await looseSupabase.rpc("fn_native_deal_reconcile_context", { p_deal_id: dealId });
      if (error) throw error;
      return (data ?? { found: false }) as ReconcileContext;
    },
  });

  const chosen = OUTCOMES.find((o) => o.key === outcome) ?? null;

  const reconcile = useMutation({
    mutationFn: async () => {
      const ctx = context.data;
      if (!ctx?.found || typeof ctx.version !== "number") throw new Error("The deal's current version could not be read; reopen the row and try again.");
      if (!outcome) throw new Error("Pick an outcome first.");
      if (!reason.trim()) throw new Error("Say how you know (who confirmed it, or where you saw it).");
      const { data, error } = await looseSupabase.rpc("reconcile_native_deal_payment", {
        p_deal_id: dealId,
        p_outcome: outcome,
        p_reason: reason.trim(),
        p_expected_version: ctx.version,
      });
      if (error) throw error;
      return data as { ok?: boolean; policyStatusStandard?: string } | null;
    },
    onSuccess: (data) => {
      toast.success(`Recorded "${chosen?.label ?? outcome}" for ${clientName || "this deal"}${data?.policyStatusStandard ? ` (status now ${data.policyStatusStandard})` : ""}.`);
      setOpen(false);
      setConfirming(false);
      setOutcome(null);
      setReason("");
      // The book list, its counts and the standing board all read deals/v_book_of_business.
      void qc.invalidateQueries({
        predicate: (q) => {
          const k = q.queryKey[0];
          return k === "deals" || k === "deals-count" || k === "book-standing" || k === "book-state-summary"
            || k === "deal-by-key" || k === "native-deal-reconcile-context";
        },
      });
    },
    onError: (e) => {
      // 40001 = the row changed under us (someone else reconciled it). Re-read, do not retry blind.
      const msg = errorMessage(e);
      toast.error(msg);
      setConfirming(false);
      void context.refetch();
    },
  });

  if (!open) {
    return (
      <div className="rounded-md border border-dashed border-border/70 p-3 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">Payment outcome not recorded.</span> This status is the posting-time default; nothing has confirmed whether the first premium cleared.
        <Button type="button" size="sm" variant="outline" className="ml-2 h-7" onClick={() => setOpen(true)}>
          Record payment outcome
        </Button>
      </div>
    );
  }

  return (
    <div className="rounded-md border border-primary/30 bg-primary/5 p-3 text-sm" aria-label="Record payment outcome">
      <div className="flex items-start justify-between gap-2">
        <p className="font-medium">Record payment outcome{clientName ? ` · ${clientName}` : ""}</p>
        <Button type="button" size="sm" variant="ghost" className="h-7" onClick={() => { setOpen(false); setConfirming(false); }}>Cancel</Button>
      </div>
      {context.isLoading && <p className="mt-2 text-xs text-muted-foreground">Reading the deal's current status…</p>}
      {context.isError && (
        <p role="alert" className="mt-2 text-xs text-destructive">
          Could not read the deal: {errorMessage(context.error)}.
          <Button type="button" size="sm" variant="outline" className="ml-2 h-7" onClick={() => void context.refetch()}>Try again</Button>
        </p>
      )}
      {context.data && !context.data.found && <p role="alert" className="mt-2 text-xs text-destructive">This deal no longer exists.</p>}
      {context.data?.found && context.data.reconcilable === false && (
        <p role="alert" className="mt-2 text-xs text-destructive">Only deals posted on the platform can be reconciled here; this row came from an imported feed.</p>
      )}
      {context.data?.found && context.data.reconcilable !== false && (
        <>
          <p className="mt-1 text-xs text-muted-foreground">
            Current status: <span className="font-medium text-foreground">{context.data.policy_status_standard || context.data.status || "unknown"}</span>
            {context.data.status_updated_at ? "" : " · never updated since posting"}. Nothing here contacts a carrier; you are recording what the producer or the carrier portal confirmed.
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Outcome">
            {OUTCOMES.map((o) => (
              <button
                key={o.key}
                type="button"
                role="radio"
                aria-checked={outcome === o.key}
                onClick={() => { setOutcome(o.key); setConfirming(false); }}
                className={`rounded-md border p-2 text-left text-xs ${outcome === o.key ? "border-primary bg-primary/10" : "border-border hover:bg-muted/30"}`}
              >
                <span className="block font-semibold text-foreground">{o.label}</span>
                <span className="block text-muted-foreground">{o.hint}</span>
              </button>
            ))}
          </div>
          <label className="mt-3 block text-xs text-muted-foreground">
            How do you know? (recorded with your name in the deal history)
            <Textarea
              value={reason}
              onChange={(e) => { setReason(e.target.value); setConfirming(false); }}
              rows={2}
              className="mt-1 text-sm"
              placeholder="e.g. Producer confirmed by text 11/25; first draft cleared 11/20."
            />
          </label>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {!confirming ? (
              <Button type="button" size="sm" disabled={!outcome || !reason.trim()} onClick={() => setConfirming(true)}>
                Review
              </Button>
            ) : (
              <>
                <span className="text-xs">Set this deal to <strong>{chosen?.label}</strong>? The book re-buckets immediately.</span>
                <Button type="button" size="sm" disabled={reconcile.isPending} onClick={() => reconcile.mutate()}>
                  {reconcile.isPending ? "Saving…" : "Yes, record it"}
                </Button>
                <Button type="button" size="sm" variant="ghost" disabled={reconcile.isPending} onClick={() => setConfirming(false)}>Back</Button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
