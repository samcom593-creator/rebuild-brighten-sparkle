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
import { DollarSign, CheckCircle2, AlertTriangle, Clock, ExternalLink, Zap, ChevronDown, ChevronRight } from "lucide-react";
import { format, formatDistanceToNowStrict } from "date-fns";
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

function SyncStatus({ deal }: { deal: DealRow }) {
  if (deal.synced_to_insuracloud_at) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] text-success" title={`Synced ${deal.synced_to_insuracloud_at}`}>
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
    case "active": return "bg-success/15 text-success border-success/30";
    case "submitted": return "bg-primary/15 text-primary border-primary/30";
    case "draft": return "bg-muted text-muted-foreground";
    case "lapsed": case "cancelled": return "bg-destructive/15 text-destructive border-destructive/30";
    case "charged_back": return "bg-warning/15 text-warning border-warning/30";
    default: return "bg-muted";
  }
};

function fmtMoney(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return `$${Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

// How many rows to paint at once. The header count is the TRUE total (every
// deal off the AgentLink/Vantage sync); the list windows the DOM and grows on
// demand so a 1,700-row book never has to render all at once, and never gets
// silently truncated to a fixed number the way the old .limit(100) did.
const PAGE = 60;

export default function MyDeals() {
  const { user, isAdmin, isManager } = useAuth();
  const downline = useMyDownline();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [visible, setVisible] = useState(PAGE);

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

  const enabled = Boolean(user?.id) && (isAdmin || (isManager ? downline.isSuccess : Boolean(agentId)));

  // Every deal off the Vantage/AgentLink sync (source=agent_link) plus native
  // APEX submissions — this is the number Discord's live feed celebrates, so
  // the page must agree with it. Ordered newest first; a generous ceiling
  // instead of a truncating page-size, and the count below is exact regardless.
  const { data: deals = [] } = useQuery({
    queryKey: ["deals", isAdmin ? "all" : scopedAgentIds.join(",")],
    queryFn: async () => {
      if (!isAdmin && scopedAgentIds.length === 0) return [];
      let query = supabase.from("deals")
        // 'agent:agents(display_name)' was AMBIGUOUS — deals has TWO fks to
        // agents (agent_id + manager_id), so PostgREST returned HTTP 300
        // PGRST201 and the page rendered "No deals" over 1,780 real rows.
        // Naming the constraint resolves it.
        .select("*, carrier:carriers(name), agent:agents!deals_agent_id_fkey(display_name)")
        .order("effective_date", { ascending: false })
        .limit(3000);
      if (!isAdmin) query = query.in("agent_id", scopedAgentIds);
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as unknown as DealRow[];
    },
    enabled,
  });

  // Exact total — the honest count for the header, independent of how many rows
  // the list paints. head:true fetches no rows, only the Content-Range count.
  const { data: totalDeals = 0 } = useQuery({
    queryKey: ["deals-count", isAdmin ? "all" : scopedAgentIds.join(",")],
    queryFn: async () => {
      if (!isAdmin && scopedAgentIds.length === 0) return 0;
      let query = supabase.from("deals").select("id", { count: "exact", head: true });
      if (!isAdmin) query = query.in("agent_id", scopedAgentIds);
      const { count, error } = await query;
      if (error) throw error;
      return count ?? 0;
    },
    enabled,
  });

  const latestSync = deals.reduce<string | null>((acc, d) => {
    const t = d.synced_to_insuracloud_at || d.created_at;
    if (!t) return acc;
    return !acc || t > acc ? t : acc;
  }, null);

  const teamView = isAdmin || isManager;

  // Agency production dollars, straight from the book-truth view (Phoenix tz,
  // posted-date, dead excluded — the documented source of truth). The header's
  // deal COUNT is every row; these are the ALP totals. Rolling 30d is the
  // number Sam reads production by (~$305k) — calendar MTD understates it
  // mid-month. Admin/manager only; the view is agency-wide, not agent-scoped.
  const { data: book } = useQuery({
    queryKey: ["book-truth-production"],
    enabled: teamView,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_agentlink_book_truth")
        .select("premium_30d, deals_30d, premium_prior_30d, premium_this_month, deals_this_month, total_annual_premium, total_deals")
        .maybeSingle();
      if (error) throw error;
      return data as {
        premium_30d: number; deals_30d: number; premium_prior_30d: number;
        premium_this_month: number; deals_this_month: number;
        total_annual_premium: number; total_deals: number;
      } | null;
    },
  });

  const prod30dDelta = book && book.premium_prior_30d > 0
    ? ((book.premium_30d - book.premium_prior_30d) / book.premium_prior_30d) * 100
    : null;

  return (
    <div className="space-y-6 p-4 md:p-6 page-enter max-w-5xl">
      <PageHeader
        eyebrow="Production · My Deals"
        eyebrowIcon={<DollarSign className="h-3 w-3" />}
        title={teamView ? "Production" : "My Deals"}
        subtitle={
          <>
            Source: <span className="font-medium text-foreground">AgentLink / Vantage sync</span> + native APEX
            {latestSync && <> · last sync {formatDistanceToNowStrict(new Date(latestSync), { addSuffix: true })}</>}
          </>
        }
        actions={<SubmitDealDialog />}
      />

      {teamView && book && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="rounded-md border border-border p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wider">Last 30 days</p>
            <p className="text-2xl font-bold tabular-nums mt-0.5">{fmtMoney(book.premium_30d)}</p>
            <p className="text-xs text-muted-foreground">
              {book.deals_30d} deals
              {prod30dDelta !== null && (
                <span className={prod30dDelta >= 0 ? "text-success" : "text-destructive"}> · {prod30dDelta >= 0 ? "+" : ""}{prod30dDelta.toFixed(1)}% vs prior 30d</span>
              )}
            </p>
          </div>
          <div className="rounded-md border border-border p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wider">This month</p>
            <p className="text-2xl font-bold tabular-nums mt-0.5">{fmtMoney(book.premium_this_month)}</p>
            <p className="text-xs text-muted-foreground">{book.deals_this_month} deals · calendar MTD</p>
          </div>
          <div className="rounded-md border border-border p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wider">Total book</p>
            <p className="text-2xl font-bold tabular-nums mt-0.5">{fmtMoney(book.total_annual_premium)}</p>
            <p className="text-xs text-muted-foreground">{book.total_deals.toLocaleString()} deals all-time</p>
          </div>
          <div className="rounded-md border border-border p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wider">Avg per deal</p>
            <p className="text-2xl font-bold tabular-nums mt-0.5">{fmtMoney(book.deals_30d > 0 ? Math.round(book.premium_30d / book.deals_30d) : 0)}</p>
            <p className="text-xs text-muted-foreground">last 30 days</p>
          </div>
        </div>
      )}

      <Card className="border-primary/30 bg-primary/5">
        <CardContent className="p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <Zap className="h-5 w-5 text-primary mt-0.5" />
            <div>
              <p className="text-sm font-semibold">Every deal, straight from the book.</p>
              <p className="text-xs text-muted-foreground mt-0.5">Pulled live from the AgentLink / Vantage sync — the same feed Discord celebrates. Add a native deal here and it reconciles into the book.</p>
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
          <CardTitle className="text-sm flex items-baseline gap-2">
            {teamView ? "Agency production" : "My deals"}
            <span className="text-muted-foreground font-normal">· {totalDeals.toLocaleString()} deals</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {deals.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              No deals logged yet. Click "Add Deal" to get started.
            </div>
          ) : (
            <>
              <div className="divide-y divide-border">
                {deals.slice(0, visible).map((d) => {
                  const isOpen = expandedId === d.id;
                  return (
                    <div key={d.id} className="hover:bg-muted/10">
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
                          {teamView && <p className="text-[10px] text-muted-foreground">Writing agent: {d.agent?.display_name || "Unassigned"}</p>}
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
                            <p className="font-semibold">{d.source === "agent_link" ? "AgentLink / Vantage" : d.source || "manual"}</p>
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
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              {visible < deals.length && (
                <div className="flex items-center justify-center gap-3 border-t border-border p-3">
                  <span className="text-xs text-muted-foreground">
                    Showing {Math.min(visible, deals.length).toLocaleString()} of {totalDeals.toLocaleString()}
                  </span>
                  <Button size="sm" variant="outline" onClick={() => setVisible((v) => v + PAGE * 4)}>Show more</Button>
                  <Button size="sm" variant="ghost" onClick={() => setVisible(deals.length)}>Show all</Button>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
