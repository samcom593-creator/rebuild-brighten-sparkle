import { useState, useSyncExternalStore } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { useRolePreview } from "@/hooks/useRolePreview";
import { looseSupabase } from "@/lib/looseSupabase";
import type { WorkflowRpc } from "@/integrations/supabase/workflow-rpcs";
import {
  COVERAGE_REVIEW_QUERY_KEY,
  parseCoverageDecision,
  parseDealCoverageReviewQueue,
  readCoverageHold,
  type DealCoverageReview,
} from "@/lib/dealCoverageReview";
import { announcePostedDealReceipt, isDealId } from "@/lib/dealCelebrations";
import { invalidateOperationalTruth } from "@/lib/invalidateOperationalTruth";
import { removeQueuedDealAfterReceipt } from "@/lib/offlineQueue";
import { isDemoMode, subscribeDemoMode } from "@/lib/demoMode";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { QueryState, errorMessage } from "@/components/ui/query-state";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const STATUS_LABELS = {
  pending: "Awaiting review",
  approved: "Approved to resume",
  rejected: "Not approved",
  submitted: "Posted",
} as const;
type Status = keyof typeof STATUS_LABELS;
type Filter = "all" | Exclude<Status, "submitted">;
type Action = "approved" | "rejected" | "resume";
const money = (value: number | null) => value === null ? "Not recorded" : value.toLocaleString("en-US", { style: "currency", currency: "USD" });
const when = (value: string) => new Date(value).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });

function CoverageReviewItem({ review, userId, current }: { review: DealCoverageReview; userId: string; current: boolean }) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState("");
  const [confirmPosting, setConfirmPosting] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const reasonId = `coverage-reason-${review.id}`;
  const refresh = () => queryClient.invalidateQueries({ queryKey: [COVERAGE_REVIEW_QUERY_KEY, userId] });
  const mutation = useMutation({
    retry: false,
    mutationFn: async (action: Action) => {
      if (!current || completed || !review.payload_current) throw new Error("Refresh this request before acting on it.");
      if (action === "resume") {
        if (!review.can_resume || review.owner_user_id !== userId || review.status !== "approved") throw new Error("Only the requester can post this approved draft.");
        const { data, error } = await (looseSupabase.rpc as unknown as WorkflowRpc)("resume_deal_coverage_review", {
          p_review_id: review.id, p_expected_version: review.version,
        });
        if (error) throw error;
        const hold = readCoverageHold(data);
        if (hold) return { kind: "held" as const, hold };
        const receipt = data as { ok?: unknown; dealId?: unknown; status?: unknown; replayed?: unknown } | null;
        if (!receipt || !isDealId(receipt.dealId) || typeof receipt.status !== "string"
          || !["submitted", "needs_review", "pending", "approved", "issued", "in_force", "active", "already_recorded"].includes(receipt.status)
          || (receipt.ok !== undefined && receipt.ok !== true)
          || (receipt.replayed !== undefined && typeof receipt.replayed !== "boolean")) {
          throw new Error("Posting was not confirmed. Refresh this request before trying again.");
        }
        return { kind: "posted" as const, receipt };
      }
      if (!review.can_decide || review.status !== "pending") throw new Error("This request is not available for your review.");
      const rationale = reason.trim();
      if (rationale.length < 20 || rationale.length > 2000) throw new Error("Record a review reason between 20 and 2,000 characters.");
      const { data, error } = await (looseSupabase.rpc as unknown as WorkflowRpc)("decide_deal_coverage_review", {
        p_review_id: review.id, p_decision: action, p_reason: rationale, p_expected_version: review.version,
      });
      if (error) throw error;
      const decision = parseCoverageDecision(data, review.id);
      if (decision.status !== action || decision.version <= review.version) throw new Error("The expected review decision was not confirmed. Refresh before trying again.");
      return { kind: "decided" as const, decision };
    },
    onSuccess: (result) => {
      setCompleted(true);
      setConfirmPosting(false);
      if (result.kind === "posted") {
        removeQueuedDealAfterReceipt(userId, review.idempotency_key);
        announcePostedDealReceipt(userId, result.receipt);
        invalidateOperationalTruth(queryClient);
        const message = result.receipt.status === "already_recorded" || result.receipt.replayed === true
          ? "This deal was already recorded. No duplicate was posted."
          : "Deal posted. Carrier status and payment are tracked separately.";
        setNotice(message);
        toast.success(message);
      } else if (result.kind === "held") {
        const message = result.hold.status === "review_rejected"
          ? "This draft is not approved. Nothing was posted."
          : "Coverage changed and needs another review. Nothing was posted.";
        setNotice(message);
        toast.info(message);
      } else {
        const message = result.decision.status === "approved"
          ? "Review approved. The requester must finish posting; no production was added."
          : "Review rejected. Nothing was posted.";
        setNotice(message);
        toast.success(message);
      }
      void refresh();
    },
    onError: (error) => {
      setConfirmPosting(false);
      toast.error(errorMessage(error));
      // A version or authorization conflict must re-read the current request,
      // never retry the mutation against a changed draft automatically.
      void refresh();
    },
  });
  const busy = mutation.isPending || completed || !current;
  const reasonReady = reason.trim().length >= 20 && reason.trim().length <= 2000;
  const reviewer = review.requires_admin ? "Administrator" : review.manager_name || "Assigned manager or administrator";

  return (
    <article aria-label={`Coverage review for ${review.client_name}`} className="min-w-0 space-y-4 rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="break-words text-base font-semibold">{review.client_name}</h3>
          <p className="break-words text-sm text-muted-foreground">{review.carrier_name || "Carrier not recorded"} · {review.product || "Product not recorded"}</p>
        </div>
        <span className="rounded-md border border-border bg-muted/40 px-2 py-1 text-sm font-medium">{STATUS_LABELS[review.status]}</span>
      </div>
      <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
        <div><dt className="text-muted-foreground">Writing agent</dt><dd className="break-words">{review.agent_name || "Not recorded"}</dd></div>
        <div><dt className="text-muted-foreground">Policy or application</dt><dd className="break-words">{review.policy_number || "Not recorded"}</dd></div>
        <div><dt className="text-muted-foreground">Annual premium</dt><dd className="tabular-nums">{money(review.annual_premium)}</dd></div>
        <div><dt className="text-muted-foreground">Review owner</dt><dd className="break-words">{reviewer}</dd></div>
        <div><dt className="text-muted-foreground">Requested</dt><dd>{when(review.created_at)}</dd></div>
        <div><dt className="text-muted-foreground">Version</dt><dd>{review.version}</dd></div>
      </dl>
      <div className="rounded-md border border-border bg-muted/20 p-3 text-sm">
        <p className="font-medium">{review.match_count} possible {review.match_count === 1 ? "coverage match" : "coverage matches"}</p>
        <p className="mt-1 text-muted-foreground">Matched on {review.match_signals.map(signal => signal === "name_dob" ? "name and date of birth" : "phone and date of birth").join("; ")}. A match requires review; it does not by itself establish a duplicate policy.</p>
        {review.matched_policies.length > 0 && <ul className="mt-3 space-y-2" aria-label="Policies available for this review">
          {review.matched_policies.map(policy => <li key={policy.deal_id} className="break-words rounded-md border border-border bg-card p-3">
            <p className="font-medium">{policy.client_name || "Client not recorded"} · {policy.carrier_name || "Carrier not recorded"}</p>
            <p>{policy.product || "Product not recorded"} · {policy.policy_number || "Policy number not recorded"}</p>
            <p className="text-muted-foreground">{policy.status || "Status not recorded"} · {policy.agent_name || "Writing agent not recorded"}</p>
          </li>)}
        </ul>}
        {review.matched_policies.length < review.match_count && <p className="mt-2 text-muted-foreground">Some matching policy details are outside your access. An authorized reviewer must check them.</p>}
      </div>
      {review.decision_reason && <div className="text-sm"><p className="font-medium">Recorded review reason</p><p className="mt-1 whitespace-pre-wrap break-words">{review.decision_reason}</p>{review.reviewed_at && <p className="mt-1 text-muted-foreground">Reviewed {when(review.reviewed_at)}</p>}</div>}
      {!review.payload_current && review.status !== "submitted" && <p role="status" className="text-sm text-warning">The saved draft changed after this review. Reopen it and submit it for a fresh coverage check.</p>}
      {review.status === "pending" && !review.can_decide && <p className="text-sm text-muted-foreground">Review pending with {reviewer}. This request has not added production.</p>}
      {review.status === "approved" && !review.can_resume && review.payload_current && <p className="text-sm text-muted-foreground">The requester must finish posting this approved draft. Approval alone does not add production.</p>}
      {review.status === "rejected" && <p className="text-sm text-muted-foreground">This draft is not cleared to post. Address the recorded reason before submitting a revised draft.</p>}
      {review.can_decide && review.status === "pending" && review.payload_current && <div className="space-y-3">
        <div className="space-y-2">
          <Label htmlFor={reasonId}>Review reason</Label>
          <Textarea id={reasonId} value={reason} disabled={busy} onChange={event => setReason(event.target.value)} maxLength={2000} rows={3} placeholder="Record the existing coverage reviewed and why this request should be approved or rejected." aria-describedby={`${reasonId}-hint`} />
          <p id={`${reasonId}-hint`} className="text-sm text-muted-foreground">Use 20–2,000 characters. Do not include payment card, bank account, or Social Security numbers.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" className="min-h-11" disabled={busy || !reasonReady} onClick={() => mutation.mutate("approved")}>Approve coverage review</Button>
          <Button type="button" variant="outline" className="min-h-11" disabled={busy || !reasonReady} onClick={() => mutation.mutate("rejected")}>Reject request</Button>
        </div>
        <p className="text-sm text-muted-foreground">This records a review decision only. It does not submit the deal or contact a carrier.</p>
      </div>}
      {review.can_resume && review.status === "approved" && review.payload_current && <div className="space-y-3">
        {confirmPosting ? <>
          <p className="text-sm">Post this approved saved draft now? Coverage and the review version will be checked again before the deal is recorded.</p>
          <div className="flex flex-wrap gap-2"><Button type="button" className="min-h-11" disabled={busy} onClick={() => mutation.mutate("resume")}>Confirm posting</Button><Button type="button" variant="outline" className="min-h-11" disabled={busy} onClick={() => setConfirmPosting(false)}>Cancel</Button></div>
        </> : <Button type="button" className="min-h-11" disabled={busy} onClick={() => setConfirmPosting(true)}>Post approved deal</Button>}
        <p className="text-sm text-muted-foreground">Your approval is saved. The deal enters production only after you confirm posting and receive a saved receipt.</p>
      </div>}
      {review.status === "submitted" && review.deal_id && <Button asChild variant="outline" className="min-h-11"><Link to={`/dashboard/production?deal=${encodeURIComponent(review.deal_id)}`}>Open posted deal</Link></Button>}
      {mutation.isPending && <p role="status" className="text-sm">{mutation.variables === "resume" ? "Checking and posting the approved draft…" : "Saving the review decision…"}</p>}
      {mutation.isError && <p role="alert" className="text-sm text-destructive">{errorMessage(mutation.error)}</p>}
      {notice && <p role="status" className="text-sm">{notice}</p>}
    </article>
  );
}

/** The database scopes every row and decides who may review or resume it. */
export function DealCoverageReviewQueue() {
  const { user, isLoading } = useAuth();
  const { isPreviewing } = useRolePreview();
  const demoMode = useSyncExternalStore(subscribeDemoMode, isDemoMode, isDemoMode);
  const [filter, setFilter] = useState<Filter>("all");
  const [visible, setVisible] = useState(10);
  const userId = user?.id;
  const queue = useQuery({
    queryKey: [COVERAGE_REVIEW_QUERY_KEY, userId],
    enabled: Boolean(userId) && !isLoading && !isPreviewing && !demoMode,
    staleTime: 30_000,
    retry: 1,
    queryFn: async () => {
      if (!userId) throw new Error("Sign in to read coverage reviews.");
      const { data, error } = await (looseSupabase.rpc as unknown as WorkflowRpc)("deal_coverage_review_queue");
      if (error) throw error;
      return parseDealCoverageReviewQueue(data, userId);
    },
  });
  if (!userId || isLoading || isPreviewing || demoMode) return null;
  const rows = queue.data?.reviews.filter(review => filter === "all" || review.status === filter) ?? [];
  return (
    <Card id="coverage-reviews" aria-label="Coverage review queue">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1.5"><CardTitle className="flex items-center gap-2"><ShieldCheck className="h-5 w-5" aria-hidden="true" />Coverage review</CardTitle><CardDescription>Possible overlapping coverage is held here before posting. Pending and rejected requests do not add production.</CardDescription></div>
          <Button type="button" variant="outline" className="min-h-11" disabled={queue.isFetching} onClick={() => void queue.refetch()}><RefreshCw className="h-4 w-4" aria-hidden="true" />Refresh reviews</Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {queue.isPending ? <QueryState status="loading" label="coverage reviews" /> : queue.isError ? <QueryState status="error" label="coverage reviews" error={queue.error} onRetry={() => void queue.refetch()} /> : <>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="w-full space-y-2 sm:w-56"><Label htmlFor="coverage-review-status">Review status</Label><Select value={filter} onValueChange={value => { if (value === "all" || value === "pending" || value === "approved" || value === "rejected") { setFilter(value); setVisible(10); } }}><SelectTrigger id="coverage-review-status"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All review statuses</SelectItem>{(["pending", "approved", "rejected"] as const).map(value => <SelectItem key={value} value={value}>{STATUS_LABELS[value]}</SelectItem>)}</SelectContent></Select></div>
            {queue.data && <p className="text-sm text-muted-foreground">Updated {when(queue.data.as_of)}</p>}
          </div>
          {queue.data?.has_more && <p role="status" className="text-sm text-muted-foreground">Showing {queue.data.reviews.length} recent authorized requests. Older requests are not included in these filters.</p>}
          {rows.length === 0 ? <QueryState status="empty" title={filter === "all" ? "No coverage reviews in this queue" : "No loaded requests match this status"} body="Only requests within your permitted scope appear here." /> : <>
            <div className="space-y-4">{rows.slice(0, visible).map(review => <CoverageReviewItem key={`${review.id}:${review.version}:${review.status}:${review.payload_current}`} review={review} userId={userId} current={!queue.isFetching && !queue.isError} />)}</div>
            {rows.length > visible && <Button type="button" variant="outline" className="min-h-11" onClick={() => setVisible(value => value + 10)}>Show more loaded reviews</Button>}
          </>}
        </>}
      </CardContent>
    </Card>
  );
}
