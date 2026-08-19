import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { useAuth } from "@/hooks/useAuth";
import { useMyDownline } from "@/hooks/useMyDownline";
import { SubmitDealDialog } from "@/components/deals/SubmitDealDialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DollarSign, CheckCircle2, AlertTriangle, Clock, ExternalLink, Zap, ChevronDown, ChevronRight, FileCheck2, Loader2 } from "lucide-react";
import { format, formatDistanceToNowStrict } from "date-fns";
import { toast } from "sonner";
import { AGENTLINK_LINKS } from "@/lib/agentlink";
import { PageHeader } from "@/components/ui/page-header";

type DealRow = Database["public"]["Tables"]["deals"]["Row"] & {
  carrier: { name: string | null } | null;
  agent: { display_name: string | null } | null;
  chargeback_status?: string | null;
  commission_cents?: number | null;
  submitted_at?: string | null;
  version?: number | null;
};

type ReviewTarget = "approved" | "declined";

function dealRpc<T>(name: string, args: Record<string, unknown>) {
  return (supabase.rpc as unknown as (
    functionName: string,
    values: Record<string, unknown>,
  ) => PromiseLike<{ data: T | null; error: { message: string } | null }>)(name, args);
}

function DealEvidence({ dealId }: { dealId: string }) {
  const evidence = useQuery({
    queryKey: ["deal-evidence-links", dealId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("deal_attachments" as never)
        .select("id, object_path, original_file_name, scan_status")
        .eq("deal_id", dealId)
        .order("created_at");
      if (error) throw error;
      const rows = (data ?? []) as unknown as Array<{
        id: string;
        object_path: string;
        original_file_name: string;
        scan_status: string;
      }>;
      return Promise.all(rows.map(async (row) => {
        const { data: signed, error: signedError } = await supabase.storage
          .from("apex-deal-evidence")
          .createSignedUrl(row.object_path, 300);
        return { ...row, signedUrl: signedError ? null : signed?.signedUrl ?? null };
      }));
    },
    staleTime: 4 * 60_000,
  });

  if (evidence.isLoading) return <p className="col-span-2 md:col-span-4 text-xs text-muted-foreground">Loading private evidence…</p>;
  if (evidence.isError) return <p className="col-span-2 md:col-span-4 text-xs text-destructive">Evidence could not be loaded. Do not approve until access is restored.</p>;
  if (!evidence.data?.length) return <p className="col-span-2 md:col-span-4 text-xs text-amber-600 dark:text-amber-400">No supporting evidence is attached.</p>;
  return (
    <div className="col-span-2 md:col-span-4 space-y-1.5">
      <p className="text-muted-foreground uppercase tracking-wider text-[10px]">Private evidence</p>
      {evidence.data.map((file) => file.signedUrl ? (
        <a key={file.id} href={file.signedUrl} target="_blank" rel="noopener noreferrer" className="flex min-h-9 items-center gap-2 rounded border border-border px-2 text-xs hover:bg-muted/30">
          <FileCheck2 className="h-3.5 w-3.5" />
          <span className="min-w-0 flex-1 truncate">{file.original_file_name}</span>
          <span className="text-muted-foreground">{file.scan_status}</span>
        </a>
      ) : (
        <p key={file.id} className="text-xs text-destructive">{file.original_file_name}: secure link unavailable</p>
      ))}
    </div>
  );
}

function SyncStatus({ deal }: { deal: DealRow }) {
  if (deal.synced_to_insuracloud_at) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] text-emerald-500" title={`Synced ${deal.synced_to_insuracloud_at}`}>
        <CheckCircle2 className="h-3 w-3" /> Synced
      </span>
    );
  }
  if (deal.insuracloud_sync_error) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] text-destructive" title={deal.insuracloud_sync_error}>
        <AlertTriangle className="h-3 w-3" /> Sync failed
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground" title="Queued for AgentLink sync">
      <Clock className="h-3 w-3" /> Pending sync
    </span>
  );
}

const statusColor = (s: string) => {
  switch (s) {
    case "active": return "bg-emerald-500/20 text-emerald-400 border-emerald-500/30";
    case "submitted": return "bg-primary/20 text-primary border-primary/30";
    case "draft": return "bg-muted text-muted-foreground";
    case "lapsed": case "cancelled": return "bg-destructive/20 text-destructive border-destructive/30";
    case "charged_back": return "bg-orange-500/20 text-orange-400 border-orange-500/30";
    default: return "bg-muted";
  }
};

function fmtMoney(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return `$${Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

export default function MyDeals() {
  const { user, isAdmin, isManager } = useAuth();
  const downline = useMyDownline();
  // PL-048: per-row expansion for full policy info (face, term, effective,
  // commission, status timeline, sync status) without leaving the page.
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [reviewDeal, setReviewDeal] = useState<DealRow | null>(null);
  const [reviewTarget, setReviewTarget] = useState<ReviewTarget>("approved");
  const [reviewReason, setReviewReason] = useState("");
  const [reviewing, setReviewing] = useState(false);

  const { data: agentId } = useQuery({
    queryKey: ["my-agent-id", user?.id],
    queryFn: async () => {
      if (!user?.id) return null;
      const { data } = await supabase.from("agents").select("id").eq("user_id", user.id).maybeSingle();
      return data?.id ?? null;
    },
    enabled: !!user?.id,
  });

  const scopedAgentIds = Array.from(new Set([
    ...(isManager ? downline.data ?? [] : []),
    ...(agentId ? [agentId] : []),
  ]));

  const { data: deals = [], refetch } = useQuery({
    queryKey: ["deals", isAdmin ? "all" : scopedAgentIds.join(",")],
    queryFn: async () => {
      if (!isAdmin && scopedAgentIds.length === 0) return [];
      let query = supabase.from("deals")
        // 2026-08-19: 'agent:agents(display_name)' was AMBIGUOUS — deals has TWO fks
        // to agents (agent_id and manager_id), so PostgREST returned HTTP 300
        // PGRST201 and the query threw. The page rendered its empty state,
        // 'No deals logged yet', while 1,780 deals sat in the table. Naming the
        // constraint resolves it. Verified live as Sam: 300 -> 200 with rows.
        .select("*, carrier:carriers(name), agent:agents!deals_agent_id_fkey(display_name)")
        .order("effective_date", { ascending: false })
        .limit(100);
      if (!isAdmin) query = query.in("agent_id", scopedAgentIds);
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as unknown as DealRow[];
    },
    enabled: Boolean(user?.id) && (isAdmin || (isManager ? downline.isSuccess : Boolean(agentId))),
  });

  const beginReview = (deal: DealRow, target: ReviewTarget) => {
    setReviewDeal(deal);
    setReviewTarget(target);
    setReviewReason(target === "approved" ? "Evidence and production fields verified." : "Needs correction before approval.");
  };

  const submitReview = async () => {
    if (!reviewDeal || !reviewReason.trim()) return;
    setReviewing(true);
    const { data, error } = await dealRpc<{ ok?: boolean }>("transition_apex_deal_status", {
      p_deal_id: reviewDeal.id,
      p_to_status: reviewTarget,
      p_reason: reviewReason.trim(),
      p_expected_version: reviewDeal.version ?? 1,
    });
    if (error || !data?.ok) toast.error(error?.message || "Deal review could not be saved");
    else {
      toast.success(reviewTarget === "approved" ? "Deal approved and downstream delivery queued" : "Deal declined with an audit reason");
      setReviewDeal(null);
      setReviewReason("");
      void refetch();
    }
    setReviewing(false);
  };

  // Find the most recently-synced deal so we can show a "data freshness" line.
  const latestSync = deals.reduce<string | null>((acc, d) => {
    const t = d.synced_to_insuracloud_at || d.created_at;
    if (!t) return acc;
    return !acc || t > acc ? t : acc;
  }, null);

  return (
    <div className="space-y-6 p-4 md:p-6 page-enter max-w-5xl">
      <PageHeader
                eyebrow="Production · My Deals"
        eyebrowIcon={<DollarSign className="h-3 w-3" />}
        title={isAdmin || isManager ? "Production" : "My Deals"}
        subtitle={
          <>
            Source: <span className="font-medium text-foreground">APEX</span>, with durable AgentLink reconciliation
            {latestSync && <> · last sync {formatDistanceToNowStrict(new Date(latestSync), { addSuffix: true })}</>}
          </>
        }
        actions={
          <SubmitDealDialog />
        }
      />

      {/* Native submit is durable first; AgentLink remains a reconciled
          downstream book, never a reason to lose the APEX receipt. */}
      <Card className="border-primary/30 bg-primary/5">
        <CardContent className="p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <Zap className="h-5 w-5 text-primary mt-0.5" />
            <div>
              <p className="text-sm font-semibold">Submit once in APEX.</p>
              <p className="text-xs text-muted-foreground mt-0.5">The APEX receipt saves first; approved records reconcile to AgentLink through the durable delivery queue.</p>
            </div>
          </div>
          <div className="flex gap-2">
            <SubmitDealDialog trigger={<Button size="sm" variant="default">Add Deal</Button>} />
            <Button asChild size="sm" variant="ghost"><a href={AGENTLINK_LINKS.bookOfBusiness} target="_blank" rel="noopener noreferrer">Open AgentLink <ExternalLink className="h-3 w-3 ml-1.5" /></a></Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">{isAdmin || isManager ? "Team and review queue" : "Recent deals"} ({deals.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {deals.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              No deals logged yet. Click "Add Deal" to get started.
            </div>
          ) : (
            <div className="divide-y divide-border">
              {deals.map((d) => {
                const isOpen = expandedId === d.id;
                return (
                  <div key={d.id} className="hover:bg-muted/10">
                    {/* PL-048: clickable summary row — toggles full policy detail below. */}
                    <button
                      type="button"
                      onClick={() => setExpandedId(isOpen ? null : d.id)}
                      className="w-full text-left p-3 grid grid-cols-1 md:grid-cols-[20px_1fr_auto_auto_auto] gap-3 items-center"
                      aria-expanded={isOpen}
                    >
                      <span className="text-muted-foreground hidden md:block">
                        {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </span>
                      <div>
                        <p className="font-medium text-sm">{d.client_first_name} {d.client_last_name}</p>
                        <p className="text-xs text-muted-foreground">
                          {d.carrier?.name || "—"} · {d.product_sold} · #{d.policy_number || "no policy #"}
                        </p>
                        {(isAdmin || isManager) && <p className="text-[10px] text-muted-foreground">Writing agent: {d.agent?.display_name || "Unassigned"}</p>}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {d.effective_date ? format(new Date(d.effective_date), "MMM d, yyyy") : "—"}
                      </div>
                      <div className="text-right">
                        <p className="font-semibold text-sm">{fmtMoney(d.annual_premium)}</p>
                        <p className="text-[10px] text-muted-foreground">${Number(d.monthly_premium ?? 0).toFixed(2)}/mo</p>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <Badge variant="outline" className={statusColor(d.status)}>{d.status}</Badge>
                        <SyncStatus deal={d} />
                      </div>
                    </button>
                    {isOpen && (
                      <div className="px-4 pb-4 pt-1 grid grid-cols-2 md:grid-cols-4 gap-3 text-xs bg-muted/10">
                        <div>
                          <p className="text-muted-foreground uppercase tracking-wider text-[10px]">Face amount</p>
                          <p className="font-semibold">{fmtMoney(d.face_amount)}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground uppercase tracking-wider text-[10px]">Term</p>
                          <p className="font-semibold">{d.policy_term_months ? `${d.policy_term_months} mo` : "—"}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground uppercase tracking-wider text-[10px]">Commission</p>
                          <p className="font-semibold">{fmtMoney(d.commission_cents ? d.commission_cents / 100 : null)}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground uppercase tracking-wider text-[10px]">Posted</p>
                          <p className="font-semibold">{d.posted_at ? format(new Date(d.posted_at), "MMM d") : "—"}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground uppercase tracking-wider text-[10px]">Submitted</p>
                          <p className="font-semibold">{d.submitted_at ? format(new Date(d.submitted_at), "MMM d") : "—"}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground uppercase tracking-wider text-[10px]">Chargeback</p>
                          <p className="font-semibold">{d.chargeback_status || "—"}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground uppercase tracking-wider text-[10px]">Source</p>
                          <p className="font-semibold">{d.source || "manual"}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground uppercase tracking-wider text-[10px]">External ID</p>
                          <p className="font-semibold truncate">{d.external_deal_id || "—"}</p>
                        </div>
                        {d.notes && (
                          <div className="col-span-2 md:col-span-4">
                            <p className="text-muted-foreground uppercase tracking-wider text-[10px]">Notes</p>
                            <p className="text-foreground/80 whitespace-pre-wrap">{d.notes}</p>
                          </div>
                        )}
                        <DealEvidence dealId={d.id} />
                        {(isAdmin || isManager) && ["submitted", "needs_review"].includes(d.status ?? "") && (
                          <div className="col-span-2 md:col-span-4 flex flex-wrap gap-2 border-t border-border pt-3">
                            <Button size="sm" onClick={() => beginReview(d, "approved")}>Approve deal</Button>
                            <Button size="sm" variant="destructive" onClick={() => beginReview(d, "declined")}>Decline</Button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={Boolean(reviewDeal)} onOpenChange={(open) => { if (!open && !reviewing) setReviewDeal(null); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{reviewTarget === "approved" ? "Approve deal" : "Decline deal"}</DialogTitle>
            <DialogDescription>
              Review the private evidence first. This transition is version-checked, audited, and cannot silently overwrite another reviewer.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="deal-review-reason">Audit reason</Label>
            <Textarea id="deal-review-reason" value={reviewReason} maxLength={1000} rows={4} onChange={(event) => setReviewReason(event.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={reviewing} onClick={() => setReviewDeal(null)}>Cancel</Button>
            <Button variant={reviewTarget === "declined" ? "destructive" : "default"} disabled={reviewing || !reviewReason.trim()} onClick={() => void submitReview()}>
              {reviewing && <Loader2 className="h-4 w-4 animate-spin" />}
              Confirm {reviewTarget === "approved" ? "approval" : "decline"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
