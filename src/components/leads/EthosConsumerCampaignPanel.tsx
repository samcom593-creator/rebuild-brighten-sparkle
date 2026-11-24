import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { GlassCard } from "@/components/ui/glass-card";
import { EthosConsumerSettings } from "@/components/leads/EthosConsumerSettings";
import { ETHOS_CONSUMER_CAMPAIGN_KEY } from "../../../supabase/functions/_shared/ethos-consumer-campaign";

type Candidate = { lead_id: string; email: string; first_name: string | null; state: string; audience_token: string };
type Preview = {
  counts: Record<string, number>;
  eligible: Candidate[];
  already_queued: number;
  campaign: { sends_enabled: boolean; approved_at: string | null };
  message: { subject: string; text: string };
};
const REASONS: Record<string, string> = {
  eligible: "Eligible consumers", email_missing_or_invalid: "Email missing or invalid", state_missing_or_invalid: "State missing or invalid",
  licensed_state_not_verified: "Owner license evidence missing or expired", ethos_state_eligibility_not_verified: "Ethos state eligibility not verified",
  do_not_contact: "Do not contact", email_opt_out: "Email opted out", email_suppressed: "Email suppressed", lead_suppressed: "Lead suppressed",
  duplicate_email: "Duplicate email", email_identity_conflict: "Conflicting states for one email", consumer_source_unverified: "Consumer source not verified",
};

/** Consumer-only handoff, mounted by the consumer worklist. No producer invitations are sent here. */
export function EthosConsumerCampaignPanel({ sourceBatchId = "" }: { sourceBatchId?: string }) {
  const [batch, setBatch] = useState(sourceBatchId);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<string | null>(null);
  const [reviewed, setReviewed] = useState(false);
  const [queuedDeliveryIds, setQueuedDeliveryIds] = useState<string[]>([]);
  const currentBatch = useRef(sourceBatchId);
  const requestVersion = useRef(0);
  useEffect(() => {
    requestVersion.current += 1;
    currentBatch.current = sourceBatchId;
    setBatch(sourceBatchId); setPreview(null); setSelected(new Set()); setReviewed(false); setQueuedDeliveryIds([]); setReceipt(null); setError(null); setBusy(false);
  }, [sourceBatchId]);

  const call = async (body: Record<string, unknown>) => {
    const result = await supabase.functions.invoke("ethos-consumer-campaign", { body: { campaign_key: ETHOS_CONSUMER_CAMPAIGN_KEY, source_batch_id: batch.trim(), ...body } });
    if (result.error) {
      const fallbackMessage = result.error.message;
      const response = (result.error as { context?: Response }).context;
      if (response?.clone) {
        const details = await response.clone().json().catch(() => { throw new Error(fallbackMessage); });
        if (details?.error) throw new Error(String(details.error));
      }
      throw new Error(fallbackMessage);
    }
    if (!result.data?.ok && !Array.isArray(result.data?.receipts)) throw new Error(result.data?.error ?? "The campaign did not return a complete receipt.");
    return result.data;
  };
  const inspect = async () => {
    const requestedBatch = batch.trim();
    const version = ++requestVersion.current;
    setBusy(true); setError(null); setReceipt(null); setReviewed(false); setQueuedDeliveryIds([]); setPreview(null); setSelected(new Set());
    try { const result = await call({ action: "preview" }) as Preview; if (requestVersion.current === version && currentBatch.current.trim() === requestedBatch) setPreview(result); }
    catch (e) { if (requestVersion.current === version && currentBatch.current.trim() === requestedBatch) setError((e as Error).message); }
    finally { if (requestVersion.current === version) setBusy(false); }
  };
  const queue = async () => {
    if (!preview) return;
    const requestedBatch = batch.trim();
    const version = ++requestVersion.current;
    setBusy(true); setError(null);
    try {
      const result = await call({ action: "queue", selections: preview.eligible.filter((r) => selected.has(r.lead_id)).map(({ lead_id, audience_token }) => ({ lead_id, audience_token })) });
      if (requestVersion.current !== version || currentBatch.current.trim() !== requestedBatch) return;
      setReceipt(`${result.queued} queued, ${result.already_present} already recorded. No email sent by this step.`);
      setQueuedDeliveryIds(result.delivery_ids ?? []);
    } catch (e) { if (requestVersion.current === version && currentBatch.current.trim() === requestedBatch) setError((e as Error).message); }
    finally { if (requestVersion.current === version) setBusy(false); }
  };
  const dispatch = async () => {
    const requestedBatch = batch.trim();
    const version = ++requestVersion.current;
    setBusy(true); setError(null);
    try {
      const result = await call({ action: "dispatch", confirm_campaign: ETHOS_CONSUMER_CAMPAIGN_KEY, delivery_ids: queuedDeliveryIds, limit: 25 });
      if (requestVersion.current !== version || currentBatch.current.trim() !== requestedBatch) return;
      const unknown = (result.receipts ?? []).filter((r: { status: string; receiptSaved: boolean }) => r.status === "unknown" || !r.receiptSaved).length;
      setReceipt(`${result.provider_accepted} accepted by the email provider. Delivery is not yet confirmed.${unknown ? ` ${unknown} need reconciliation; do not resend them.` : ""}`);
      setReviewed(false); setQueuedDeliveryIds([]);
    } catch (e) { if (requestVersion.current === version && currentBatch.current.trim() === requestedBatch) setError((e as Error).message); }
    finally { if (requestVersion.current === version) setBusy(false); }
  };
  return <GlassCard className="space-y-4 p-4 sm:p-5">
    <div><h2 className="text-base font-semibold">Ethos consumer coverage email</h2><p className="mt-1 text-sm text-muted-foreground">Preview an imported consumer batch against the owner&apos;s verified license and Ethos eligibility. This sends consumers to Sam&apos;s coverage page.</p></div>
    <EthosConsumerSettings onChanged={() => { requestVersion.current += 1; setBusy(false); setPreview(null); setSelected(new Set()); setReviewed(false); setQueuedDeliveryIds([]); setReceipt(null); }} />
    {!sourceBatchId ? <div className="space-y-1"><Label htmlFor="ethos-consumer-batch">Consumer import batch</Label><Input id="ethos-consumer-batch" value={batch} placeholder="Exact source batch ID" onChange={(e) => { requestVersion.current += 1; currentBatch.current=e.target.value; setBusy(false); setBatch(e.target.value); setPreview(null); setReviewed(false); setQueuedDeliveryIds([]); setSelected(new Set()); setReceipt(null); setError(null); }} /></div> : null}
    <Button type="button" variant="outline" disabled={busy || !batch.trim()} onClick={() => void inspect()}>{busy ? "Working…" : "Preview eligible consumers"}</Button>
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    {preview ? <>
      <div className="grid gap-2 text-sm sm:grid-cols-2">{Object.entries(preview.counts).map(([reason, count]) => <p key={reason}><span className="font-semibold tabular-nums">{count}</span> {REASONS[reason] ?? "Held for review"}</p>)}</div>
      <p className="text-xs text-muted-foreground">{preview.already_queued} already recorded for this batch. The preview shows up to 25 new eligible recipients.</p>
      <details className="rounded-md border border-border p-3"><summary className="cursor-pointer text-sm font-medium">Review the email</summary><p className="mt-3 text-sm font-semibold">{preview.message.subject}</p><p className="mt-2 whitespace-pre-line text-sm">{preview.message.text}</p><p className="mt-2 text-xs text-muted-foreground">The email service adds the unsubscribe link and company postal address.</p></details>
      {preview.eligible.length ? <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th className="p-2">Select</th><th className="p-2">Consumer</th><th className="p-2">State</th></tr></thead><tbody>{preview.eligible.map((r) => <tr key={r.lead_id} className="border-t border-border"><td className="p-2"><input type="checkbox" aria-label={`Select ${r.email}`} disabled={busy} checked={selected.has(r.lead_id)} onChange={(e) => { setSelected((before) => { const next = new Set(before); if (e.target.checked) next.add(r.lead_id); else next.delete(r.lead_id); return next; }); setQueuedDeliveryIds([]); setReviewed(false); setReceipt(null); }} /></td><td className="p-2">{r.first_name ?? "Consumer"}<div className="text-xs text-muted-foreground">{r.email}</div></td><td className="p-2">{r.state}</td></tr>)}</tbody></table></div> : <p className="text-sm">No new eligible recipients. Resolve the evidence or contact blockers shown above before queueing.</p>}
      <Button type="button" disabled={busy || selected.size === 0} onClick={() => void queue()}>Queue {selected.size} selected</Button>
      {!preview.campaign.sends_enabled || !preview.campaign.approved_at ? <p className="text-sm text-muted-foreground">Sending is disabled. The owner can record evidence and enable reviewed sends in Licensed states and sending settings.</p> : <div className="space-y-2"><label className="flex gap-2 text-sm"><input type="checkbox" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} />I reviewed this message and the selected eligible consumers.</label><Button type="button" disabled={busy || !reviewed || queuedDeliveryIds.length === 0} onClick={() => void dispatch()}>Send {queuedDeliveryIds.length} reviewed invitations</Button></div>}
    </> : null}
    {receipt ? <p role="status" className="text-sm">{receipt}</p> : null}
  </GlassCard>;
}
