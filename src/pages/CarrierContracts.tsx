import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "react-router-dom";
import { ExternalLink, Copy, Check, ClipboardList, Building2, Files, Search } from "lucide-react";

import { useAuth } from "@/hooks/useAuth";
import { usePageTitle } from "@/hooks/usePageTitle";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/glass-card";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { CONTRACTING_LINK_URL, CONTRACTING_PROFILE_URL } from "@/lib/contractingLinks";
import { ContractingIntakeAdmin } from "@/components/contracting/ContractingIntakeAdmin";
import { ContractingRequestsBoard } from "@/components/contracting/ContractingRequestsBoard";
import { ContractingReviewWorkspace } from "@/components/contracting-review/ContractingReviewWorkspace";
import { useContractReview } from "@/hooks/useContractReview";
import { CONTRACT_RECORD_PAGE_SIZE, useContractRows, useContractSummary } from "@/hooks/useContractRecords";
import { externalHref } from "@/lib/externalHref";

/**
 * Contracting. Four working pages, one process:
 *   Review          the manual portal tracker (the SAME component My Team shows, over the same records)
 *   Carriers        the four tracked carriers and their portal links, plus the full carrier directory
 *   Writing numbers writing and contract numbers carriers have issued (still real records)
 *   Requests        current carrier-request snapshots and their sheet delivery receipts
 *   Intake history  earlier intake records; no dispatch action on that historical page
 * Every other page of the old process (operations, cases, Aflac sends, Ethos sheet, audit, contracts board) redirects
 * to the review or to My Team's Contracting view (src/App.tsx). Carrier contracting itself happens in each carrier's
 * own portal; nothing here submits to a carrier.
 */

type Carrier = { id: string; name: string | null; website: string | null };

export default function CarrierContracts() {
  const pathname = useLocation().pathname;
  const mode = pathname.endsWith("/requests") ? "requests"
    : pathname.endsWith("/history") ? "history"
    : pathname.endsWith("/carriers") ? "carriers"
    : pathname.endsWith("/documents") ? "documents"
    : "review";
  usePageTitle(`${mode === "review" ? "Contracting" : mode === "documents" ? "Writing numbers" : mode === "history" ? "Intake history" : mode.charAt(0).toUpperCase() + mode.slice(1)} · Galaxy`);
  const { isAdmin, isManager } = useAuth();
  const canInvite = !!(isAdmin || isManager);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const copyLink = async (id: string, url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(id);
      toast.success("Link copied");
      setTimeout(() => setCopiedId((curr) => (curr === id ? null : curr)), 1500);
    } catch {
      toast.error("Couldn't copy. Long-press to share instead.");
    }
  };

  const carriersQ = useQuery({
    queryKey: ["link-hub-carriers"],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<Carrier[]> => {
      const { data, error } = await supabase
        .from("carriers" as never)
        .select("id, name, website")
        .eq("is_active", true)
        .order("name", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as Carrier[];
    },
  });

  // These management routes are admin-only. Managers use the scoped Grow and Team review routes.
  const reviewItem = [["review", "/dashboard/contracting", "Review"]] as Array<[string, string, string]>;
  const liveItems = [["requests", "/dashboard/contracting/requests", "Requests"], ["carriers", "/dashboard/contracting/carriers", "Carriers"], ["documents", "/dashboard/contracting/documents", "Writing numbers"]] as Array<[string, string, string]>;
  const earlierItems = [["history", "/dashboard/contracting/history", "Intake history"]] as Array<[string, string, string]>;
  const isHistory = earlierItems.some(([k]) => k === mode);

  const navButton = ([key, to, label]: [string, string, string]) => (
    <Button
      key={key}
      asChild
      variant="ghost"
      className={cn("rounded-none border-b-2 px-3", mode === key ? "border-primary text-foreground" : "border-transparent text-muted-foreground")}
    >
      <Link to={to} aria-current={mode === key ? "page" : undefined}>{label}</Link>
    </Button>
  );
  const workspaceNav = (
    <nav className="flex items-center gap-1 overflow-x-auto border-b border-border" aria-label="Contracting sections">
      {reviewItem.map(navButton)}
      {liveItems.map(navButton)}
      <Button asChild variant="ghost" className="shrink-0 rounded-none border-b-2 border-transparent px-3 text-muted-foreground"><Link to="/dashboard/grow">Ethos submissions</Link></Button>
      {earlierItems.length > 0 ? <span className="ml-3 shrink-0 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">History</span> : null}
      {earlierItems.map(navButton)}
    </nav>
  );
  const retiredBanner = isHistory ? (
    <div role="note" className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-foreground">
      <span className="flex-1">These are earlier intake records. Use <Link to="/dashboard/contracting/requests" className="font-semibold underline">Requests</Link> for current carrier-request receipts, <Link to="/dashboard/grow" className="font-semibold underline">Grow my team</Link> for the Ethos submission lane, and <Link to="/dashboard/contracting" className="font-semibold underline">Review</Link> to record carrier confirmation.</span>
    </div>
  ) : null;

  if (mode === "review") {
    return (
      <div className="page-enter mx-auto w-full max-w-6xl space-y-5 px-4 pb-24 sm:px-6">
        <PageHeader
          eyebrow="Contracting"
          eyebrowIcon={<ClipboardList className="h-4 w-4" />}
          title="Contracting review"
          subtitle="Check the agent's profile and carrier portal, then record each carrier's confirmation. Submission receipts and writing numbers have their own tabs."
        />
        {workspaceNav}
        {canInvite ? <ContractingLinkCard copyLink={copyLink} copiedId={copiedId} /> : null}
        <GlassCard className="p-3 sm:p-4"><ContractingReviewWorkspace /></GlassCard>
      </div>
    );
  }

  const title = mode === "carriers" ? "Carriers" : mode === "requests" ? "Contracting requests" : mode === "history" ? "Intake history" : "Writing numbers";
  const subtitle = mode === "carriers"
    ? "The four carriers tracked on every agent's profile, their portal links, and the full carrier directory."
    : mode === "requests"
    ? "Review missing information, save a request and follow its sheet receipt. A submitted request does not establish carrier approval."
    : mode === "history"
    ? "Earlier intake records retained for reference. Current submissions and carrier confirmations are tracked separately."
    : "Writing and contract numbers that carriers have issued, kept on record. E&O certificates live on each agent's profile documents.";

  return (
    <div className="page-enter mx-auto w-full max-w-6xl space-y-5 px-4 pb-24 sm:px-6">
      <PageHeader
        eyebrow="Contracting"
        eyebrowIcon={mode === "carriers" ? <Building2 className="h-4 w-4" /> : mode === "documents" ? <Files className="h-4 w-4" /> : <ClipboardList className="h-4 w-4" />}
        title={title}
        subtitle={subtitle}
      />
      {workspaceNav}
      {retiredBanner}

      {mode === "carriers" && <TrackedCarriersCard />}
      {mode === "carriers" && <CarrierDirectory carriersQ={carriersQ} />}
      {mode === "requests" && <ContractingRequestsBoard />}
      {mode === "history" && <ContractingIntakeAdmin showEmptyState />}
      {mode === "documents" && <ContractDocuments />}
    </div>
  );
}

/** The four carriers every agent is reviewed against, straight from the review's own carrier list. */
function TrackedCarriersCard() {
  const review = useContractReview(true);
  const carriers = review.roster?.carriers ?? [];
  return (
    <GlassCard className="p-4">
      <h2 className="text-sm font-semibold text-foreground">Tracked on every agent</h2>
      <p className="mt-0.5 text-xs text-muted-foreground">Combine, AFLAC, GTO and Ethos are confirmed by hand on the review after you check each carrier's portal.</p>
      {review.query.isLoading ? <p className="mt-3 text-sm text-muted-foreground">Loading…</p> : null}
      {review.query.isError ? <p role="alert" className="mt-3 text-sm text-destructive">The carrier list did not load.</p> : null}
      {carriers.length > 0 ? (
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {carriers.map((c) => (
            <li key={c.key} className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2">
              <div>
                <p className="text-sm font-medium text-foreground">{c.label}</p>
                <p className="text-xs text-muted-foreground">{c.mapped ? "Matched to the carrier directory" : "Not yet matched to a directory entry"}</p>
              </div>
              {externalHref(c.portal_url) ? (
                <a href={externalHref(c.portal_url) ?? undefined} target="_blank" rel="noopener noreferrer" className="text-xs font-medium text-primary hover:underline">Open portal</a>
              ) : <span className="text-xs text-muted-foreground">No portal link on file</span>}
            </li>
          ))}
        </ul>
      ) : null}
    </GlassCard>
  );
}

/* ───────────────────────── Carrier Directory ───────────────────────── */

function CarrierDirectory({ carriersQ }: {
  carriersQ: { data?: Carrier[]; isLoading: boolean; error: unknown; refetch: () => unknown };
}) {
  const [search, setSearch] = useState("");
  const all = carriersQ.data ?? [];
  const rows = all.filter((c) => !search || (c.name ?? "").toLowerCase().includes(search.toLowerCase()));

  return (
    <GlassCard className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-border p-4">
        <div className="relative min-w-56 flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search carriers" aria-label="Search carriers" className="pl-9" data-testid="carrier-search" />
        </div>
        <p className="text-xs text-muted-foreground">
          {carriersQ.error ? "Carrier count unavailable" : carriersQ.isLoading ? "Loading carriers…" : <><span className="font-semibold tabular-nums text-foreground">{rows.length}</span> of{" "}<span className="font-semibold tabular-nums text-foreground">{all.length}</span> active carriers</>}
        </p>
      </div>

      <div className="hidden grid-cols-[minmax(0,1fr)_120px] border-b border-border bg-muted/40 px-4 py-2 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground sm:grid">
        <span>Carrier</span><span>Website</span>
      </div>

      {carriersQ.isLoading ? (
        <div className="space-y-2 p-4"><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /></div>
      ) : carriersQ.error ? (
        <div role="alert" className="space-y-2 p-4 text-sm"><p>The carrier directory did not load.</p><Button type="button" variant="outline" onClick={() => void carriersQ.refetch()}>Retry carrier directory</Button></div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<Building2 className="h-7 w-7" />}
          title={all.length === 0 ? "No active carriers" : "No carrier matches that search"}
          description={all.length === 0 ? "No carrier records are currently visible for this workspace." : "Clear the search to see every active carrier."}
        />
      ) : (
        <ul>
          {rows.map((carrier) => {
            // Raw DB text in an href is not a link to that site: a scheme-less
            // value resolves relative to this page and lands in the catch-all (MP-495).
            const href = externalHref(carrier.website);
            return (
              <li key={carrier.id} className="grid grid-cols-2 items-center gap-2 border-b border-border/70 px-4 py-3 text-sm last:border-0 sm:grid-cols-[minmax(0,1fr)_120px]">
                <span className="truncate font-medium">{carrier.name ?? `Carrier ${carrier.id}`}</span>
                <span className="justify-self-end sm:justify-self-auto">
                  {href ? (
                    <Button asChild size="sm" variant="outline">
                      <a href={href} target="_blank" rel="noopener noreferrer">
                        Website <ExternalLink className="ml-1 h-3.5 w-3.5" />
                      </a>
                    </Button>
                  ) : (
                    <span className="text-xs text-muted-foreground">No URL on file</span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </GlassCard>
  );
}

/* ───────────────────────── Documents ───────────────────────── */

function ContractDocuments() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  useEffect(() => { setPage(0); }, [search]);
  const summaryQ = useContractSummary("agency", search);
  const rowsQ = useContractRows("agency", "all", search, page);
  const rows = rowsQ.data ?? [];
  const total = summaryQ.isError ? null : summaryQ.data?.total ?? null;

  return (
    <GlassCard className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-border p-4">
        <div className="relative min-w-56 flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search carrier, producer, or writing number" aria-label="Search contract records" className="pl-9" data-testid="documents-search" />
        </div>
        <p className="w-full text-xs text-muted-foreground sm:w-auto">
          {summaryQ.isError ? "Record count unavailable" : total == null ? "Loading record count…" : <><span className="font-semibold tabular-nums text-foreground">{total}</span> records</>}
        </p>
      </div>

      <div className="hidden grid-cols-[minmax(0,1fr)_minmax(0,1fr)_120px_minmax(0,1fr)] border-b border-border bg-muted/40 px-4 py-2 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground sm:grid">
        <span>Carrier</span><span>Producer</span><span>Status</span><span>Contract record</span>
      </div>

      {rowsQ.isLoading ? (
        <div className="p-4"><Skeleton className="h-12 w-full" /></div>
      ) : rowsQ.isError ? (
        <div role="alert" className="space-y-2 p-4 text-sm"><p>The contract records did not load.</p><Button type="button" variant="outline" onClick={() => { void rowsQ.refetch(); void summaryQ.refetch(); }}>Retry contract records</Button></div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<Files className="h-7 w-7" />}
          title="No contract records match"
          description="Writing numbers and contract numbers appear here once a carrier issues them and they are recorded. E&O certificates live on each agent's profile documents. Clear the search to see every record."
        />
      ) : (
        <ul>
          {rows.map((r) => (
            <li key={r.id} className="grid grid-cols-2 gap-2 border-b border-border/70 px-4 py-3 text-sm last:border-0 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_120px_minmax(0,1fr)]">
              <span className="truncate font-medium">{r.carrier_name ?? "Carrier not on file"}</span>
              <span className="truncate text-muted-foreground">{r.agent_id ? <Link to={`/dashboard/profile?agentId=${r.agent_id}`} className="underline underline-offset-2">{r.agent_name ?? "Open linked producer"}</Link> : r.agent_name ?? "Producer not linked"}</span>
              <span className="truncate capitalize text-muted-foreground">{(r.status ?? "unknown").replace(/_/g, " ")}</span>
              <span className="truncate font-mono text-xs text-muted-foreground">
                {r.writing_number ? `Writing # ${r.writing_number}` : r.contract_number ? `Contract # ${r.contract_number}` : "No number issued yet"}
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-3">
        <p className="text-xs text-muted-foreground">Page {page + 1}{!rowsQ.isLoading && !rowsQ.isError ? ` · ${rows.length} records shown` : ""}</p>
        <div className="flex gap-2"><Button type="button" variant="outline" size="sm" disabled={page === 0 || rowsQ.isLoading} onClick={() => setPage((p) => Math.max(0,p-1))}>Previous records</Button><Button type="button" variant="outline" size="sm" disabled={rowsQ.isLoading || rowsQ.isError || rows.length < CONTRACT_RECORD_PAGE_SIZE || (total != null && (page+1)*CONTRACT_RECORD_PAGE_SIZE >= total)} onClick={() => setPage((p) => p+1)}>Next records</Button></div>
      </div>
    </GlassCard>
  );
}

/* ───────────────────────── Shared pieces ───────────────────────── */

/**
 * The contracting link. One link for everyone: the MGN Agent Hub, where carrier contracting actually happens now
 * (2026-11-17, replacing the Galaxy profile link as the link we hand out). It works the same for every agent and
 * copying it sends nothing. The five-field profile intake still exists for our own tracking; see ContractingProfile.
 */
function ContractingLinkCard({ copyLink, copiedId }: { copyLink: (id: string, url: string) => Promise<void>; copiedId: string | null }) {
  const url = CONTRACTING_LINK_URL;
  return (
    <GlassCard className="p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 sm:flex-1">
          <h2 className="text-sm font-semibold text-foreground">Agent contracting links</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">MGN opens the carrier portal. The Galaxy profile link collects the signed-in agent&apos;s details for review. Recruiting and new account setup start in Grow my team.</p>
        </div>
        <Button size="sm" variant="outline" className="h-10" onClick={() => copyLink("contracting-profile-link", url)}>
          {copiedId === "contracting-profile-link"
            ? <><Check className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Copied</>
            : <><Copy className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Copy MGN portal link</>}
        </Button>
        <Button size="sm" variant="outline" className="h-10" onClick={() => copyLink("galaxy-profile-link", CONTRACTING_PROFILE_URL)}>{copiedId === "galaxy-profile-link" ? "Profile link copied" : "Copy agent profile link"}</Button>
        <Button asChild size="sm" variant="ghost" className="h-10"><Link to="/dashboard/grow">Grow my team</Link></Button>
      </div>
    </GlassCard>
  );
}

