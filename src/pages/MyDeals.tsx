import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useMyDownline } from "@/hooks/useMyDownline";
import { SubmitDealDialog } from "@/components/deals/SubmitDealDialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DollarSign, Zap, ChevronDown, ChevronRight } from "lucide-react";
import { format, formatDistanceToNowStrict } from "date-fns";
import { PageHeader } from "@/components/ui/page-header";

type DealRow = {
  row_key: string;
  origin: "agentlink" | "apex_native";
  agent_id: string | null;
  agent_name: string | null;
  client_name: string | null;
  carrier: string | null;
  product: string | null;
  policy_number: string | null;
  annual_premium: number | null;
  posted_date: string | null;
  effective_date: string | null;
  status: string | null;
  synced_at: string | null;
};

const statusColor = (s: string | null) => {
  switch ((s ?? "unknown").toLowerCase()) {
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

// How many rows to paint at once. The header count is the TRUE total (imported
// Vantage production plus native APEX posts); the list windows the DOM and grows on
// demand so a 1,700-row book never has to render all at once, and never gets
// silently truncated to a fixed number the way the old .limit(100) did.
const PAGE = 60;

// Agent Cloud's POLICY STATUS 10-tile grid, sourced from the unified book
// (v_book_status_tiles over v_production_unified) with semantic tints.
const POLICY_STATUS: { key: string; label: string; cls: string }[] = [
  { key: "active", label: "Active", cls: "border-success/30 bg-success/10 text-success" },
  { key: "issued_not_paid", label: "Issued, Not Paid", cls: "border-success/30 bg-success/10 text-success" },
  { key: "in_review", label: "In Review", cls: "border-info/30 bg-info/10 text-info" },
  { key: "lapse_pending", label: "Lapse Pending", cls: "border-warning/30 bg-warning/10 text-warning" },
  { key: "lapsed", label: "Lapsed", cls: "border-destructive/30 bg-destructive/10 text-destructive" },
  { key: "cancelled", label: "Cancelled", cls: "border-destructive/30 bg-destructive/10 text-destructive" },
  { key: "withdrawn", label: "Withdrawn", cls: "border-border bg-muted/40 text-muted-foreground" },
  { key: "not_taken", label: "Not Taken", cls: "border-warning/30 bg-warning/10 text-warning" },
  { key: "postponed", label: "Postponed", cls: "border-warning/30 bg-warning/10 text-warning" },
  { key: "carrier_na", label: "Carrier N/A", cls: "border-border bg-muted/40 text-muted-foreground" },
];

export default function MyDeals() {
  const { user, isAdmin, isManager } = useAuth();
  const downline = useMyDownline();
  const [searchParams, setSearchParams] = useSearchParams();
  const focusDealId = searchParams.get("deal");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [visible, setVisible] = useState(PAGE);
  const focusRef = useRef<HTMLDivElement | null>(null);
  const focusHandled = useRef<string | null>(null);

  const { data: agentId } = useQuery({
    queryKey: ["my-agent-id", user?.id],
    queryFn: async () => {
      if (!user?.id) return null;
      // agents carries no unique index on user_id, and PostgREST returns
      // data=null on a multi-row match — so .maybeSingle() reported "this
      // person has no agent record" for anyone holding two rows, and the
      // whole page rendered empty for them. Take the first row instead.
      const { data, error } = await supabase
        .from("agents")
        .select("id")
        .eq("user_id", user.id)
        .order("created_at")
        .limit(1);
      if (error) throw error;
      return (data ?? [])[0]?.id ?? null;
    },
    enabled: !!user?.id,
  });

  const scopedAgentIds = Array.from(new Set([
    ...(isManager ? downline.data ?? [] : []),
    ...(agentId ? [agentId] : []),
  ]));

  const enabled = Boolean(user?.id) && (isAdmin || (isManager ? downline.isSuccess : Boolean(agentId)));

  // One deduped source for imported production and native APEX submissions.
  // The rows, exact count, KPI totals, status tiles and agency split all read
  // this same view, so a number cannot be live in one place and stale in another.
  const { data: deals = [] } = useQuery({
    queryKey: ["deals", isAdmin ? "all" : scopedAgentIds.join(",")],
    queryFn: async () => {
      if (!isAdmin && scopedAgentIds.length === 0) return [];
      let query = (supabase as any).from("v_production_unified")
        .select("*")
        .order("posted_date", { ascending: false })
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
      let query = (supabase as any).from("v_production_unified").select("row_key", { count: "exact", head: true });
      if (!isAdmin) query = query.in("agent_id", scopedAgentIds);
      const { count, error } = await query;
      if (error) throw error;
      return count ?? 0;
    },
    enabled,
  });

  // "View deal" on the post-a-deal receipt navigates here as
  // /dashboard/production?deal=<id>. Nothing on this page had ever read that
  // parameter, so the button landed you on an unchanged list and left you to
  // find the row yourself. Open the row, widen the window far enough to paint
  // it, and scroll it into view.
  const focusIndex = useMemo(
    () => (focusDealId ? deals.findIndex((d) => d.row_key === focusDealId) : -1),
    [deals, focusDealId],
  );

  useEffect(() => {
    if (!focusDealId || focusIndex < 0) return;
    if (focusHandled.current === focusDealId) return;
    focusHandled.current = focusDealId;
    setExpandedId(focusDealId);
    setVisible((current) => (focusIndex + 1 > current ? focusIndex + 1 : current));
  }, [focusDealId, focusIndex]);

  useEffect(() => {
    if (!focusDealId || focusIndex < 0 || focusIndex + 1 > visible) return;
    focusRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [focusDealId, focusIndex, visible]);

  const clearFocus = () => {
    const next = new URLSearchParams(searchParams);
    next.delete("deal");
    setSearchParams(next, { replace: true });
  };

  const latestSync = deals.reduce<string | null>((acc, d) => {
    const t = d.synced_at;
    if (!t) return acc;
    return !acc || t > acc ? t : acc;
  }, null);

  const teamView = isAdmin || isManager;
  const productionTitle = isAdmin ? "Agency Production" : isManager ? "Team Production" : "My Deals";
  const productionListLabel = isAdmin ? "Agency production" : isManager ? "Team production" : "My deals";
  const productionScopeKey = isAdmin ? "agency" : scopedAgentIds.join(",") || "self-unresolved";

  // Scoped production dollars, straight from the unified book-truth view (Phoenix tz,
  // posted-date, dead excluded — the documented source of truth). The header's
  // deal COUNT is every row; these are the ALP totals. Rolling 30d is the
  // number Sam reads production by (~$305k) — calendar MTD understates it
  // mid-month. RLS gives admins the agency and managers only their team.
  const { data: book } = useQuery({
    queryKey: ["book-truth-production", productionScopeKey],
    enabled: teamView,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_agentlink_book_truth" as never)
        .select("premium_30d, deals_30d, premium_prior_30d, premium_this_month, deals_this_month, total_annual_premium, total_deals")
        .maybeSingle();
      if (error) throw error;
      return data as unknown as {
        premium_30d: number; deals_30d: number; premium_prior_30d: number;
        premium_this_month: number; deals_this_month: number;
        total_annual_premium: number; total_deals: number;
      } | null;
    },
  });

  const prod30dDelta = book && book.premium_prior_30d > 0
    ? ((book.premium_30d - book.premium_prior_30d) / book.premium_prior_30d) * 100
    : null;

  // Policy-status tiles from the real book (Active / In Review / Lapsed / …).
  const { data: statusTiles = [] } = useQuery({
    queryKey: ["book-status-tiles", productionScopeKey],
    enabled: teamView,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from("v_book_status_tiles" as never).select("bucket, n, alp");
      if (error) throw error;
      return (data ?? []) as unknown as Array<{ bucket: string; n: number; alp: number }>;
    },
  });
  const statusByBucket = Object.fromEntries(statusTiles.map((t) => [t.bucket, t]));

  // APEX (direct) vs Vantage production, rolled up from the same scoped,
  // unified hierarchy used by the rows and headline totals.
  const { data: imo = [] } = useQuery({
    queryKey: ["imo-by-agency", productionScopeKey],
    enabled: teamView,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from("v_imo_by_agency" as never).select("agency, is_primary, policies, alp, alp_mtd").order("alp", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as Array<{ agency: string; is_primary: boolean; policies: number; alp: number; alp_mtd: number }>;
    },
  });
  const imoMax = Math.max(1, ...imo.map((a) => a.alp));
  const imoMtdTotal = imo.reduce((s, a) => s + (a.alp_mtd || 0), 0);

  return (
    <div className="space-y-6 p-4 md:p-6 page-enter max-w-5xl">
      <PageHeader
        eyebrow={isAdmin ? "Production · Agency" : isManager ? "Production · Team" : "Production · My Deals"}
        eyebrowIcon={<DollarSign className="h-3 w-3" />}
        title={productionTitle}
        subtitle={
          <>
            Source: <span className="font-medium text-foreground">Vantage live feed</span> + native APEX
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

      {teamView && statusTiles.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.15em] text-muted-foreground">Policy Status</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {POLICY_STATUS.map((s) => (
              <div key={s.key} className={`rounded-md border p-3 ${s.cls}`}>
                <p className="text-2xl font-bold tabular-nums">{(statusByBucket[s.key]?.n ?? 0).toLocaleString()}</p>
                <p className="text-xs font-medium opacity-90">{s.label}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {teamView && imo.length > 0 && (
        <div>
          <div className="mb-2 flex items-baseline justify-between">
            <p className="text-xs font-semibold uppercase tracking-[0.15em] text-muted-foreground">Production by Agency</p>
            <p className="text-xs text-muted-foreground">This month · {fmtMoney(imoMtdTotal)} ALP</p>
          </div>
          <Card>
            <CardContent className="space-y-3 p-4">
              {imo.map((a) => (
                <div key={a.agency}>
                  <div className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2 font-medium">
                      {a.agency}
                      {a.is_primary && <Badge variant="outline" className="border-primary/30 bg-primary/15 text-primary text-[10px]">PRIMARY</Badge>}
                    </span>
                    <span className="font-semibold tabular-nums">{fmtMoney(a.alp)}</span>
                  </div>
                  <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${(a.alp / imoMax) * 100}%` }} />
                  </div>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">{a.policies.toLocaleString()} policies · {fmtMoney(a.alp_mtd)} this month</p>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      )}

      <Card className="border-primary/30 bg-primary/5">
        <CardContent className="p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <Zap className="h-5 w-5 text-primary mt-0.5" />
            <div>
              <p className="text-sm font-semibold">Every deal, straight from the book.</p>
              <p className="text-xs text-muted-foreground mt-0.5">Pulled from the same deduped live feed used by every production total and Discord delivery.</p>
            </div>
          </div>
          <SubmitDealDialog trigger={<Button size="sm" variant="default">Post a Deal</Button>} />
        </CardContent>
      </Card>

      {focusDealId && deals.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
          <span>
            {focusIndex >= 0
              ? "Showing the deal you just posted, highlighted below."
              : "That deal is not in this view — it may belong to an agent outside your downline."}
          </span>
          <Button size="sm" variant="ghost" onClick={clearFocus}>Show all deals</Button>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-baseline gap-2">
            {productionListLabel}
            <span className="text-muted-foreground font-normal">· {totalDeals.toLocaleString()} deals</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {deals.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              No deals logged yet. Use “Post a Deal” to record the first one.
            </div>
          ) : (
            <>
              <div className="divide-y divide-border">
                {deals.slice(0, visible).map((d) => {
                  const isOpen = expandedId === d.row_key;
                  const isFocus = focusDealId === d.row_key;
                  return (
                    <div
                      key={d.row_key}
                      ref={isFocus ? focusRef : undefined}
                      className={isFocus ? "bg-primary/5 ring-1 ring-inset ring-primary/40" : "hover:bg-muted/10"}
                    >
                      <button
                        type="button"
                        onClick={() => setExpandedId(isOpen ? null : d.row_key)}
                        className="w-full text-left p-3 grid grid-cols-1 md:grid-cols-[20px_1fr_auto_auto_auto] gap-3 items-center"
                        aria-expanded={isOpen}
                      >
                        <span className="text-muted-foreground hidden md:block">
                          {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        </span>
                        <div>
                          <p className="font-medium text-sm">{d.client_name || "Client not on file"}</p>
                          <p className="text-xs text-muted-foreground">
                            {d.carrier || "—"} · {d.product || "Product not on file"} · #{d.policy_number || "no policy #"}
                          </p>
                          {teamView && (
                            <p className="text-[10px] text-muted-foreground">
                              Writing agent: {d.agent_name || "Unassigned"}
                            </p>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {d.posted_date ? format(new Date(`${d.posted_date}T12:00:00`), "MMM d, yyyy") : "not on file"}
                          <span className="block text-[10px] opacity-70">posted</span>
                        </div>
                        <div className="text-right">
                          <p className="font-semibold text-sm">{fmtMoney(d.annual_premium)}</p>
                          <p className="text-[10px] text-muted-foreground">annual premium</p>
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          <Badge variant="outline" className={statusColor(d.status)}>{d.status || "unknown"}</Badge>
                        </div>
                      </button>
                      {isOpen && (
                        <div className="px-4 pb-4 pt-1 grid grid-cols-2 md:grid-cols-4 gap-3 text-xs bg-muted/10">
                          <div>
                            <p className="text-muted-foreground uppercase tracking-wider text-[10px]">Producer</p>
                            <p className="font-semibold">{d.agent_name || "Unassigned"}</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground uppercase tracking-wider text-[10px]">Policy</p>
                            <p className="font-semibold">{d.policy_number || "—"}</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground uppercase tracking-wider text-[10px]">Product</p>
                            <p className="font-semibold">{d.product || "—"}</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground uppercase tracking-wider text-[10px]">Effective</p>
                            <p className="font-semibold">{d.effective_date ? format(new Date(`${d.effective_date}T12:00:00`), "MMM d, yyyy") : "not on file"}</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground uppercase tracking-wider text-[10px]">Source</p>
                            <p className="font-semibold">{d.origin === "apex_native" ? "APEX native" : "Live production feed"}</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground uppercase tracking-wider text-[10px]">Last synced</p>
                            <p className="font-semibold">{d.synced_at ? format(new Date(d.synced_at), "MMM d, h:mm a") : "—"}</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground uppercase tracking-wider text-[10px]">Row ID</p>
                            <p className="font-semibold truncate">{d.row_key}</p>
                          </div>
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
