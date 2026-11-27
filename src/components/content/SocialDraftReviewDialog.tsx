import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { approveSocialDraftReview, readSocialDraftReview, safeContentUrl } from "@/lib/socialDraftReview";
import { SOCIAL_COMMAND_KEY } from "@/lib/socialCommand";

/** Approval always submits the hash of the full version shown in this review. */
export function SocialDraftReviewDialog({ draftId, onClose, ownerOnly = false, onApproved }: {
  draftId: number | null; onClose: () => void; ownerOnly?: boolean; onApproved?: (origin: Element) => void;
}) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [writeError, setWriteError] = useState<string | null>(null);
  const [confirmedVersion, setConfirmedVersion] = useState<string | null>(null);
  const reviewGeneration = useRef(0);
  useEffect(() => {
    reviewGeneration.current++;
    setBusy(false); setWriteError(null); setConfirmedVersion(null);
    // A late response belongs to the account/draft that submitted it. It must
    // not close, celebrate or disable the review opened after that identity.
    return () => { reviewGeneration.current++; };
  }, [user?.id, draftId, ownerOnly]);
  const q = useQuery({ queryKey: ["social-draft-review", user?.id, draftId], queryFn: () => readSocialDraftReview(draftId!), enabled: draftId != null && !!user, staleTime: 0, refetchOnWindowFocus: false, retry: false });
  const draft = q.data;
  const reviewVersion = draft ? `${user?.id}:${draft.id}:${draft.content_hash}` : null;
  const confirmed = reviewVersion !== null && confirmedVersion === reviewVersion;
  const media = safeContentUrl(draft?.file_path);
  async function approve(origin: Element) {
    if (!draft || busy || !confirmed || !user) return;
    const generation = reviewGeneration.current;
    setBusy(true); setWriteError(null);
    try {
      await approveSocialDraftReview(draft, ownerOnly);
      if (generation !== reviewGeneration.current) return;
      await Promise.all([SOCIAL_COMMAND_KEY, "content_command_drafts", "content_command_status_counts", "social-bot-dashboard"].map(key => qc.invalidateQueries({ queryKey: [key] })));
      if (generation !== reviewGeneration.current) return;
      toast.success(`${draft.title || "Draft"}: approved`);
      onApproved?.(origin); onClose();
    } catch (error) { if (generation !== reviewGeneration.current) return; const message = error instanceof Error ? error.message : "Approval could not be confirmed."; setWriteError(message); setConfirmedVersion(null); toast.error(message); }
    finally { if (generation === reviewGeneration.current) setBusy(false); }
  }
  return <Dialog open={draftId != null} onOpenChange={open => { if (!open && !busy) onClose(); }}>
    <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
      <DialogHeader><DialogTitle>Review draft</DialogTitle><DialogDescription>Check the complete copy, source and destination. Approval applies to this version only.</DialogDescription></DialogHeader>
      {q.isPending ? <p role="status">Loading the full draft…</p> : q.isError ? <p role="alert">{q.error instanceof Error ? q.error.message : "Draft could not be loaded."}</p> : draft ? <div className="space-y-4">
        <h3 className="text-lg font-semibold">{draft.title || "Untitled draft"}</h3>
        <p className="text-sm">Destination: {draft.platform || "Platform not recorded"} · {draft.account || "Account not recorded"}</p>
        {[["Hook", draft.hook], ["Script / body", draft.body], ["Caption", draft.caption], ["Call to action", draft.cta], ["Hashtags", draft.hashtags]].map(([label, text]) => <section key={label}><h4 className="text-sm font-semibold">{label}</h4><p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">{text || "Not recorded"}</p></section>)}
        <section><h4 className="text-sm font-semibold">Media source</h4>{media ? <a className="inline-flex min-h-11 items-center break-all text-sm underline" href={media} target="_blank" rel="noopener noreferrer">Open source media</a> : <p className="break-all text-sm text-muted-foreground">{draft.file_path ? `Source file: ${draft.file_path}. Check this file before approving.` : "No media source recorded. Review whether this destination needs an attachment."}</p>}</section>
        {(ownerOnly ? draft.status === "awaiting_approval" : ["awaiting_approval", "awaiting_film"].includes(draft.status)) ? <>
          <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={event => setConfirmedVersion(event.target.checked ? reviewVersion : null)} />I reviewed this copy, media source and destination.</label>
          <Button className="h-11" disabled={busy || !confirmed || q.isFetching || !!writeError} onClick={event => void approve(event.currentTarget)}>{busy ? "Approving…" : "Approve reviewed version"}</Button>
        </> : <p className="text-sm">Current state: {draft.status.replace(/_/g, " ")}. Approval is available when this draft reaches the review stage.</p>}
      </div> : null}
      {writeError && <p role="alert" className="text-sm text-destructive">{writeError}</p>}
      <div className="flex flex-wrap gap-2"><Button variant="outline" className="h-11" disabled={busy || q.isFetching} onClick={() => { setWriteError(null); setConfirmedVersion(null); void q.refetch(); }}>Refresh review</Button><Button variant="ghost" className="h-11" disabled={busy} onClick={onClose}>Close</Button></div>
    </DialogContent>
  </Dialog>;
}
