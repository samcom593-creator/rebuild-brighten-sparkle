import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { useSearchParams } from "react-router-dom";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useAgentIdentity } from "@/hooks/useAgentIdentity";
import { useFullBookReader } from "@/hooks/useFullBookReader";
import { useResolvedDownline } from "@/hooks/useResolvedDownline";
import { useBusinessToday } from "@/hooks/useBusinessToday";
import { SubmitDealDialog } from "@/components/deals/SubmitDealDialog";
import { SoldCallPanel } from "@/components/clients/SoldCallPanel";
import { ClientContactLine } from "@/components/clients/ClientContactLine";
import { BookRowWork } from "@/components/books/BookRowWork";
import { splitClientName } from "@/lib/clientFacts";
import { useBookClientDetails, type BookClientDetails } from "@/hooks/useBookClientDetails";
import { useSoldCallKeys } from "@/hooks/useSoldCallKeys";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { QueryState, describeQuery, errorMessage } from "@/components/ui/query-state";
import { PageHeader } from "@/components/ui/page-header";
import { DollarSign, ChevronDown, ChevronRight, FilePlus2 } from "lucide-react";
import { format, formatDistanceToNowStrict } from "date-fns";
import { shiftDateKey } from "@/lib/businessClock";
import {
  AGENCY_PERIODS,
  agencyPeriodRangeLabel,
  countStatusBucketsInScope,
  dealsCursorAfter,
  dealsPageCursorFilter,
  dealsPageMayContinue,
  parseStatusBucket,
  splitStatusTiles,
  statusBucketFilter,
  summarizeAgencyPeriod,
  type AgencyPeriod,
  type AgencyPeriodRow,
  type DealsCursor,
  type StatusBucket,
} from "@/lib/productionBook";

type DealRow = {
  row_key: string;
  origin: string | null;
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

/** One server page of the book, with the server's exact count of rows matching from its cursor on. */
type DealsPage = { rows: DealRow[]; matching: number | null };

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

/** "submitted" -> "Submitted", "charged_back" -> "Charged back"; blank reads as "Not reported". */
function policyStatusLabel(s: string | null): string {
  const t = (s ?? "").trim().replace(/_/g, " ");
  return t ? t.charAt(0).toUpperCase() + t.slice(1).toLowerCase() : "Not reported";
}

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
// (v_book_status_tiles over v_production_unified) with semantic tints. The keys
// are the view's bucket names; src/lib/productionBook.ts mirrors the view's CASE
// so a tile click lists exactly the rows the tile counted.
const POLICY_STATUS: { key: StatusBucket; label: string; cls: string }[] = [
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

type StatusTile = { bucket: string | null; n: number | null };

function PolicyStatusTiles({
  tiles,
  active,
  expanded,
  onToggleExpanded,
  onSelect,
}: {
  tiles: StatusTile[];
  active: StatusBucket | null;
  expanded: boolean;
  onToggleExpanded: () => void;
  onSelect: (bucket: StatusBucket | null) => void;
}) {
  // A bucket the view omits had no rows: that is a complete read, so 0 is true here.
  const countByBucket = new Map(tiles.map((t) => [t.bucket, t.n ?? 0]));
  const countOf = (key: StatusBucket) => countByBucket.get(key) ?? 0;
  const { shown, folded } = splitStatusTiles(POLICY_STATUS, countOf, active);
  const visibleTiles = expanded ? POLICY_STATUS : shown;
  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5" role="group" aria-label="Filter the deal list by policy status">
        {visibleTiles.map((s) => {
          const isActive = active === s.key;
          return (
            <button
              key={s.key}
              type="button"
              aria-pressed={isActive}
              onClick={() => onSelect(isActive ? null : s.key)}
              className={`rounded-md border p-3 text-left ${s.cls} ${isActive ? "outline outline-2 -outline-offset-2 outline-primary" : ""}`}
            >
              <p className="text-2xl font-bold tabular-nums">{countOf(s.key).toLocaleString()}</p>
              <p className="text-xs font-medium opacity-90">{s.label}</p>
            </button>
          );
        })}
      </div>
      {folded.length > 0 && (
        <Button type="button" size="sm" variant="ghost" className="mt-2 h-8 px-2 text-xs" aria-expanded={expanded} onClick={onToggleExpanded}>
          {expanded ? "Fewer statuses" : `More statuses (${folded.length})`}
        </Button>
      )}
    </>
  );
}

function DealRowItem({
  d,
  isOpen,
  isFocus,
  teamView,
  onToggle,
  focusRef,
  client,
  clientLoading,
  clientFailed = false,
  hasSoldCall,
  canWork = false,
}: {
  d: DealRow;
  isOpen: boolean;
  isFocus: boolean;
  teamView: boolean;
  onToggle: () => void;
  focusRef?: RefObject<HTMLDivElement | null>;
  client?: BookClientDetails;
  clientLoading?: boolean;
  clientFailed?: boolean;
  hasSoldCall?: (phone?: string | null, first?: string | null, last?: string | null) => boolean;
  /** Admin or manager: may log call outcomes (book_flip_set enforces the same rule). */
  canWork?: boolean;
}) {
  const { firstName, lastName } = splitClientName(d.client_name);
  // A client-level row: something a person can be called about and resold. Aggregate rows
  // (external daily gaps, API totals) have no client, so they get no contact line.
  const isClientRow = Boolean(d.client_name || d.policy_number);
  const soldCall = isClientRow && hasSoldCall ? hasSoldCall(client?.phone, firstName, lastName) : false;
  return (
    <div
      ref={isFocus ? focusRef : undefined}
      className={isFocus ? "bg-primary/5 outline outline-1 -outline-offset-1 outline-primary/40" : "hover:bg-muted/10"}
    >
      <button
        type="button"
        onClick={onToggle}
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
            <p className="text-[11px] text-muted-foreground">
              Writing agent: {d.agent_name || "Unassigned"}
            </p>
          )}
        </div>
        <div className="text-xs text-muted-foreground">
          {d.posted_date ? format(new Date(`${d.posted_date}T12:00:00`), "MMM d, yyyy") : "not on file"}
          <span className="block text-[11px] opacity-70">posted</span>
        </div>
        <div className="text-right">
          <p className="font-semibold text-sm">{fmtMoney(d.annual_premium)}</p>
          <p className="text-[11px] text-muted-foreground">annual premium</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className="text-[11px] text-muted-foreground">Policy status</span>
          <Badge variant="outline" className={statusColor(d.status)}>{policyStatusLabel(d.status)}</Badge>
        </div>
      </button>
      {isClientRow && (
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 pb-3 md:pl-11">
          <ClientContactLine
            phone={client?.phone}
            dob={client?.dob}
            state={client?.state}
            city={client?.city}
            doNotCall={client?.do_not_call || client?.flip_status === "do_not_call"}
            badNumber={client?.flip_status === "bad_number"}
            bestTime={client?.best_time_to_call}
            loading={clientLoading && !client}
            failed={clientFailed && !client}
          />
        </div>
      )}
      {/* Where this client stands and the same options Book Flips has (No answer,
          Callback, Appointment, Resold, More, Note), recorded in one place for both pages. */}
      {isClientRow && (
        <div className="px-3 pb-3 md:pl-11">
          <BookRowWork clientName={d.client_name} details={client} canWork={canWork} />
        </div>
      )}
      {/* The client's ReadyMode sold-call packet (SSN, bank, beneficiaries, health) sits
          on the row itself, never behind the expand. Only admins and Aisha get keys, and
          the panel renders only for a client with a sold call on file. */}
      {soldCall && (
        <div className="px-3 pb-3 md:pl-11">
          <SoldCallPanel phone={client?.phone} firstName={firstName} lastName={lastName} />
        </div>
      )}
      {isOpen && (
        <>
          <div className="px-4 pb-4 pt-1 grid grid-cols-2 md:grid-cols-4 gap-3 text-xs bg-muted/10">
            <div>
              <p className="text-muted-foreground uppercase tracking-wider text-[11px]">Producer</p>
              <p className="font-semibold">{d.agent_name || "Unassigned"}</p>
            </div>
            <div>
              <p className="text-muted-foreground uppercase tracking-wider text-[11px]">Policy</p>
              <p className="font-semibold">{d.policy_number || "—"}</p>
            </div>
            <div>
              <p className="text-muted-foreground uppercase tracking-wider text-[11px]">Product</p>
              <p className="font-semibold">{d.product || "—"}</p>
            </div>
            <div>
              <p className="text-muted-foreground uppercase tracking-wider text-[11px]">Effective</p>
              <p className="font-semibold">{d.effective_date ? format(new Date(`${d.effective_date}T12:00:00`), "MMM d, yyyy") : "not on file"}</p>
            </div>
            <div>
              <p className="text-muted-foreground uppercase tracking-wider text-[11px]">Source</p>
              <p className="font-semibold">{d.origin === "apex_native" ? "Galaxy native" : "Live production feed"}</p>
            </div>
            <div>
              <p className="text-muted-foreground uppercase tracking-wider text-[11px]">Last synced</p>
              <p className="font-semibold">{d.synced_at ? format(new Date(d.synced_at), "MMM d, h:mm a") : "—"}</p>
            </div>
            <div>
              <p className="text-muted-foreground uppercase tracking-wider text-[11px]">Row ID</p>
              <p className="font-semibold line-clamp-2">{d.row_key}</p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default function MyDeals() {
  const { user, isAdmin, isManager } = useAuth();
  // F17: one shared answer to "which agents row is this login". It follows
  // merge pointers and reports a failed read as an error, never as "no agent".
  const me = useAgentIdentity();
  // The full book is for Sam's admin logins and the book_readers list (Aisha);
  // the database enforces it, and this page follows the same answer.
  const bookReader = useFullBookReader();
  const fullBook = isAdmin || bookReader.isFullReader;
  // A manager who is not an admin sees their team. The team is read under the
  // row `me` resolved, and a failed read is an error, never an empty team.
  const isTeamManager = isManager && !fullBook;
  const downline = useResolvedDownline(me.identity, isTeamManager);
  const todayKey = useBusinessToday();
  const [searchParams, setSearchParams] = useSearchParams();
  const focusDealId = searchParams.get("deal");
  // The status filter lives in the URL so a tile selection survives a reload and
  // can be shared. Only a known bucket name is accepted; anything else is no filter.
  const statusBucket = parseStatusBucket(searchParams.get("status"));
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [visible, setVisible] = useState(PAGE);
  const [moreStatuses, setMoreStatuses] = useState(false);
  const [agencyPeriod, setAgencyPeriod] = useState<AgencyPeriod>("mtd");
  const focusRef = useRef<HTMLDivElement | null>(null);
  const focusHandled = useRef<string | null>(null);

  const teamView = fullBook || isManager;
  const selfAgentId = me.agentId;
  const scopedAgentIds = Array.from(new Set([
    ...(isTeamManager ? downline.ids ?? [] : []),
    ...(selfAgentId ? [selfAgentId] : []),
  ]));
  const scopeKey = fullBook ? "all" : scopedAgentIds.join(",");

  // The book is read once its scope is known: admins at once, managers once
  // their own record and their team list have both answered, agents only with
  // a resolved record. Until then nothing is fetched and nothing below
  // pretends to be empty. A manager whose team list could not be read sees that
  // error, not their own deals presented as the team's.
  const identityLoading = !fullBook && (bookReader.isLoading || me.isLoading || (isTeamManager && downline.isWaiting));
  const teamListReady = !isTeamManager || downline.ids !== undefined;
  const scopeReady = fullBook || (!identityLoading && teamListReady && scopedAgentIds.length > 0);
  const enabled = Boolean(user?.id) && scopeReady;
  const statusFilter = statusBucket ? statusBucketFilter(statusBucket) : null;

  // One deduped source for imported production and native APEX submissions.
  // The rows, exact count, KPI totals, status tiles and agency split all read
  // this same view, so a number cannot be live in one place and stale in another.
  //
  // F09: the book is read in server pages, ordered by (posted_date desc, row_key
  // asc) so ties on a posted date cannot skip or repeat a row between pages.
  // "Load more" fetches the next range after the last row loaded, in that same
  // order; the literal page size is pinned by scripts/check-native-deals.mjs.
  // The server answers at most 1,000 rows per request whatever the limit asks,
  // so each page also carries the server's exact count of the rows matching
  // from its cursor on, and the list continues while a page holds fewer.
  const dealsQuery = useInfiniteQuery({
    queryKey: ["deals", scopeKey, statusBucket ?? "all"],
    enabled,
    initialPageParam: null as DealsCursor | null,
    queryFn: async ({ pageParam }): Promise<DealsPage> => {
      let query = supabase
        .from("v_production_unified")
        .select("*", { count: "exact" })
        .order("posted_date", { ascending: false, nullsFirst: false })
        .order("row_key", { ascending: true })
        .limit(3000);
      if (!fullBook) query = query.in("agent_id", scopedAgentIds);
      if (statusFilter) query = query.or(statusFilter);
      if (pageParam) query = query.or(dealsPageCursorFilter(pageParam));
      const { data, error, count } = await query;
      if (error) throw error;
      if (!Array.isArray(data)) throw new Error("The deal read returned no result set.");
      return { rows: data as unknown as DealRow[], matching: typeof count === "number" ? count : null };
    },
    getNextPageParam: (lastPage) => {
      const last = lastPage.rows[lastPage.rows.length - 1];
      return last && dealsPageMayContinue(lastPage.rows.length, lastPage.matching) ? dealsCursorAfter(last) : null;
    },
  });
  const deals = useMemo(() => dealsQuery.data?.pages.flatMap((page) => page.rows) ?? [], [dealsQuery.data]);
  // The first page has loaded at least once. A later refresh or Load more may
  // have failed since; the rows on hand still answer "is that deal loaded?".
  const dealsLoaded = dealsQuery.data !== undefined;

  // Exact total for the header, independent of how many rows the list holds.
  // head:true fetches no rows, only the Content-Range count. Same scope and the
  // same status filter as the list, so "loaded N of M" compares like with like.
  const countQuery = useQuery({
    queryKey: ["deals-count", scopeKey, statusBucket ?? "all"],
    enabled,
    queryFn: async () => {
      let query = supabase.from("v_production_unified").select("row_key", { count: "exact", head: true });
      if (!fullBook) query = query.in("agent_id", scopedAgentIds);
      if (statusFilter) query = query.or(statusFilter);
      const { count, error } = await query;
      if (error) throw error;
      if (count === null) throw new Error("The server did not return a deal count.");
      return count;
    },
  });

  // "View deal" on the post-a-deal receipt navigates here as
  // /dashboard/production?deal=<id>. Open the row, widen the window far enough
  // to paint it, and scroll it into view. When the row is not among the loaded
  // pages (older than the first page, or filtered out), look it up directly by
  // row_key inside the same scope instead of guessing why it is missing.
  const focusIndex = useMemo(
    () => (focusDealId ? deals.findIndex((d) => d.row_key === focusDealId) : -1),
    [deals, focusDealId],
  );

  const focusLookup = useQuery({
    queryKey: ["deal-by-key", scopeKey, focusDealId],
    enabled: Boolean(focusDealId) && enabled && dealsLoaded && focusIndex < 0,
    queryFn: async () => {
      const key = focusDealId;
      if (!key) throw new Error("No deal id to look up.");
      let query = supabase.from("v_production_unified").select("*").eq("row_key", key).limit(1);
      if (!fullBook) query = query.in("agent_id", scopedAgentIds);
      const { data, error } = await query;
      if (error) throw error;
      if (!Array.isArray(data)) throw new Error("The deal lookup returned no result set.");
      return (data[0] as unknown as DealRow | undefined) ?? null;
    },
  });

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

  const setStatusBucket = (nextBucket: StatusBucket | null) => {
    const next = new URLSearchParams(searchParams);
    if (nextBucket) next.set("status", nextBucket);
    else next.delete("status");
    setSearchParams(next, { replace: true });
    setVisible(PAGE);
    setExpandedId(null);
  };

  const latestSync = deals.reduce<string | null>((acc, d) => {
    const t = d.synced_at;
    if (!t) return acc;
    return !acc || t > acc ? t : acc;
  }, null);

  const productionTitle = fullBook ? "Agency Production" : isManager ? "Team Production" : "My Deals";
  const productionListLabel = fullBook ? "Agency production" : isManager ? "Team production" : "My deals";
  const productionScopeKey = fullBook ? "agency" : scopedAgentIds.join(",") || "self-unresolved";

  // Production dollars, straight from the unified book-truth view (Phoenix tz,
  // posted-date, dead excluded, the documented source of truth). The header's
  // deal COUNT is every row; these are the ALP totals. Rolling 30d is the
  // number Sam reads production by; calendar MTD understates it mid-month.
  // These totals are agency-wide for EVERY viewer: v_agentlink_book_truth reads
  // v_production_unified, which runs with its owner's rights and has no caller
  // filter, so a manager gets the agency's numbers, not the team's. The block
  // says so on screen.
  const bookQuery = useQuery({
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
  const book = bookQuery.data ?? null;

  // What the tiles deliberately leave out (no agent identity on the roster, or an excluded external
  // producer), all-time so the tiles reconcile with the deal list below. Shown, never summed in.
  const notCountedQuery = useQuery({
    queryKey: ["production-attribution-exceptions", "all-time", todayKey],
    enabled: Boolean(isAdmin),
    staleTime: 60_000,
    queryFn: async () => {
      // p_end is exclusive: everything posted through tomorrow (one day of
      // margin), counted from the Phoenix day key, not the browser's UTC date.
      const end = shiftDateKey(todayKey, 2);
      const { data, error } = await supabase.rpc("production_attribution_exceptions" as never, { p_start: "2000-01-01", p_end: end } as never);
      if (error) throw error;
      return (data ?? []) as unknown as Array<{ kind: string; policies: number; alp: number }>;
    },
  });
  const notCounted = notCountedQuery.data ?? [];

  const prod30dDelta = book && book.premium_prior_30d > 0
    ? ((book.premium_30d - book.premium_prior_30d) / book.premium_prior_30d) * 100
    : null;

  // Policy-status tiles from the real book (Active / In Review / Lapsed / ...),
  // counted in the scope the list below shows (F11). v_book_status_tiles reads
  // the whole unified book, so it serves the admin's agency view only. A
  // manager's tiles are exact counts over their team using the same bucket
  // filters the list applies, so a tile click lists what its tile counted.
  const tilesQuery = useQuery({
    queryKey: ["book-status-tiles", productionScopeKey],
    enabled: teamView && scopeReady,
    staleTime: 60_000,
    queryFn: async (): Promise<StatusTile[]> => {
      if (!fullBook) return countStatusBucketsInScope(supabase, scopedAgentIds);
      const { data, error } = await supabase.from("v_book_status_tiles").select("bucket, n");
      if (error) throw error;
      if (!Array.isArray(data)) throw new Error("The policy status read returned no result set.");
      return data;
    },
  });

  // APEX (direct) vs Vantage production, rolled up from the same unified
  // hierarchy used by the rows and headline totals. The view carries three
  // periods per agency, computed in one statement from the same Phoenix day,
  // so whichever period is chosen, amount, bar, sort and total agree (F08).
  // Agency-level totals are part of the full book: shown to full-book readers only.
  const imoQuery = useQuery({
    queryKey: ["imo-by-agency", productionScopeKey],
    enabled: fullBook,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_imo_by_agency")
        .select("agency, is_primary, policies, alp, alp_mtd, policies_mtd, policies_30d, alp_30d");
      if (error) throw error;
      if (!Array.isArray(data)) throw new Error("The agency production read returned no result set.");
      return data
        .map((row) => ({
          agency: row.agency,
          is_primary: row.is_primary,
          policies: row.policies,
          alp: row.alp,
          alp_mtd: row.alp_mtd,
          policies_mtd: row.policies_mtd,
          policies_30d: row.policies_30d,
          alp_30d: row.alp_30d,
        }))
        .filter((row): row is AgencyPeriodRow => typeof row.agency === "string");
    },
  });
  const agencySummary = imoQuery.data ? summarizeAgencyPeriod(imoQuery.data, agencyPeriod) : null;
  const agencyPeriodLabel = AGENCY_PERIODS.find((p) => p.key === agencyPeriod)?.label ?? "This month";
  // Null for All time, which has no bounds to show.
  const agencyRangeLabel = agencyPeriodRangeLabel(agencyPeriod, todayKey);
  const activeStatus = statusBucket ? POLICY_STATUS.find((s) => s.key === statusBucket) ?? null : null;
  const nextPageError = dealsQuery.isFetchNextPageError ? errorMessage(dealsQuery.error) : null;
  const exactCount = countQuery.data !== undefined ? countQuery.data.toLocaleString() : "an unknown total";
  // The exact count says more rows match than the list holds and no next page
  // is known (deals posted after the list loaded, say). The footer says so
  // instead of ending the list silently.
  const shortLoaded =
    countQuery.data !== undefined && dealsLoaded && !dealsQuery.hasNextPage && deals.length < countQuery.data;
  const focusRow = focusLookup.data ?? null;

  // Client phone, date of birth, state and Book Flips resale state for the rows on
  // screen plus the focused deal, read in the list's own 60-row chunks (see
  // useBookClientDetails). Sold-call keys decide which rows carry the packet panel.
  const shownRefs = useMemo(() => {
    const rows = deals.slice(0, visible);
    if (focusRow && !rows.some((r) => r.row_key === focusRow.row_key)) rows.push(focusRow);
    return rows.map((r) => ({ row_key: r.row_key, origin: r.origin, policy_number: r.policy_number, carrier: r.carrier, client_name: r.client_name }));
  }, [deals, visible, focusRow]);
  const clientDetails = useBookClientDetails(shownRefs, enabled);
  const soldKeys = useSoldCallKeys();
  const canWorkBook = Boolean(isAdmin || isManager);

  // Why the list is not shown yet, for a login whose scope is not resolved.
  // A failed read says so with a retry; it is never shown as an empty book.
  let identityBlock: ReactNode = null;
  if (!scopeReady) {
    if (identityLoading) {
      identityBlock = <QueryState status="loading" label={isTeamManager ? "your team" : "your agent record"} />;
    } else if (isTeamManager && downline.isError) {
      // The team list could not be read. The list is withheld rather than
      // narrowed to the manager's own deals under a Team Production title.
      identityBlock = (
        <div className="space-y-3">
          {me.identity?.status === "error" && (
            <QueryState status="error" label="your agent record" error={me.identity.message} onRetry={me.refetch} />
          )}
          <QueryState status="error" label="your team list" error={downline.error} onRetry={downline.refetch} />
        </div>
      );
    } else if (me.identity?.status === "error") {
      identityBlock = <QueryState status="error" label="your agent record" error={me.identity.message} onRetry={me.refetch} />;
    } else if (me.identity?.status === "ambiguous") {
      identityBlock = (
        <QueryState
          status="empty"
          title="More than one agent record matches this login"
          body="Ask an admin to merge them. Nothing is shown until then."
        />
      );
    } else {
      identityBlock = <QueryState status="empty" title="This login has no agent record" body="Ask an admin to link it." />;
    }
  }

  const clearFilterButton = (
    <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setStatusBucket(null)}>
      Clear filter
    </Button>
  );

  return (
    <div className="space-y-6 p-4 md:p-6 page-enter max-w-5xl">
      {/* F37: from lg up the shell's sidebar rail always shows Post a Deal, so the
          page's own button shows only below lg, where the shell keeps its copy
          inside the Actions sheet. One visible creation button per viewport. */}
      <PageHeader
        eyebrow={fullBook ? "Production · Agency" : isManager ? "Production · Team" : "Production · My Deals"}
        eyebrowIcon={<DollarSign className="h-3 w-3" />}
        title={productionTitle}
        subtitle={
          <>
            Source: <span className="font-medium text-foreground">Vantage live feed</span> + native Galaxy
            {latestSync && <> · last sync {formatDistanceToNowStrict(new Date(latestSync), { addSuffix: true })}</>}
          </>
        }
        primaryAction={
          <SubmitDealDialog
            trigger={(
              <Button className="h-11 gap-2 sm:h-10 lg:hidden">
                <FilePlus2 className="h-4 w-4" />
                Post a Deal
              </Button>
            )}
          />
        }
      />

      {teamView && (
        <QueryState
          {...describeQuery(bookQuery)}
          label="production totals"
          onRetry={() => void bookQuery.refetch()}
          asOf={bookQuery.dataUpdatedAt}
          title="No production totals for this scope yet"
          body="Totals appear once the book holds a deal in your scope."
        >
          {book && (
            <>
              <p className="mb-2 text-xs text-muted-foreground">
                {fullBook ? "Agency-wide totals." : isManager ? "Your team's totals." : "Your totals."}
              </p>
              <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
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
                  {/* No deals means there is no average: never a made-up $0. */}
                  <p className="text-2xl font-bold tabular-nums mt-0.5">
                    {book.deals_30d > 0 ? fmtMoney(Math.round(book.premium_30d / book.deals_30d)) : "No deals"}
                  </p>
                  <p className="text-xs text-muted-foreground">{book.deals_30d > 0 ? "last 30 days" : "in the last 30 days"}</p>
                </div>
              </div>
            </>
          )}
        </QueryState>
      )}
      {teamView && book && notCountedQuery.isError && (
        <QueryState
          compact
          status="error"
          label="attribution exceptions"
          error={notCountedQuery.error}
          onRetry={() => void notCountedQuery.refetch()}
          className="-mt-3"
        />
      )}
      {teamView && book && notCounted.length > 0 && (
        <p className="-mt-3 text-xs text-muted-foreground" role="note">
          Not counted above:{" "}
          {notCounted.map((x, i) => (
            <span key={x.kind}>
              {i > 0 ? " · " : ""}
              {x.policies} {x.policies === 1 ? "deal" : "deals"} ({fmtMoney(Number(x.alp))})
              {x.kind === "no_agent_identity" ? " with no agent on the roster" : " from producers outside the roster"}
            </span>
          ))}
          . They still appear in the deal list below.
        </p>
      )}

      {teamView && (
        <div>
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-[0.15em] text-muted-foreground">Policy Status</p>
            {activeStatus ? (
              <p className="flex items-center gap-1 text-xs text-muted-foreground">
                Listing <span className="font-medium text-foreground">{activeStatus.label}</span> deals below.
                {clearFilterButton}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                {fullBook ? "Agency-wide counts." : isManager ? "Counts for your team." : "Counts for your deals."} Select one to filter the list below.
              </p>
            )}
          </div>
          {scopeReady ? (
            <QueryState
              {...describeQuery(tilesQuery)}
              label="policy status counts"
              compact
              onRetry={() => void tilesQuery.refetch()}
              asOf={tilesQuery.dataUpdatedAt}
              title="No policy status counts yet"
              body="The book has no rows to count."
            >
              {tilesQuery.data && (
                <PolicyStatusTiles
                  tiles={tilesQuery.data}
                  active={statusBucket}
                  expanded={moreStatuses}
                  onToggleExpanded={() => setMoreStatuses((v) => !v)}
                  onSelect={setStatusBucket}
                />
              )}
            </QueryState>
          ) : identityLoading ? (
            <QueryState status="loading" compact label="policy status counts" />
          ) : (
            <p className="text-xs text-muted-foreground">Counts appear once your team is known. The deal list below says what is missing.</p>
          )}
        </div>
      )}

      {fullBook && (
        <div>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-[0.15em] text-muted-foreground">Production by Agency</p>
            <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Production by Agency period">
              {AGENCY_PERIODS.map((p) => (
                <Button
                  key={p.key}
                  type="button"
                  size="sm"
                  variant={agencyPeriod === p.key ? "default" : "outline"}
                  className="h-7 px-2 text-xs"
                  aria-pressed={agencyPeriod === p.key}
                  onClick={() => setAgencyPeriod(p.key)}
                >
                  {p.label}
                </Button>
              ))}
            </div>
          </div>
          <QueryState
            {...describeQuery(imoQuery)}
            label="production by agency"
            onRetry={() => void imoQuery.refetch()}
            asOf={imoQuery.dataUpdatedAt}
            title="No agency production on the book yet"
            body="Rows appear once an agency has a posted deal."
          >
            {agencySummary && (
              <Card>
                <CardContent className="space-y-3 p-4">
                  <p className="text-xs text-muted-foreground">
                    {agencyPeriodLabel}
                    {agencyRangeLabel && <> · {agencyRangeLabel}</>} · Agency-wide ·{" "}
                    <span className="font-semibold text-foreground">{fmtMoney(agencySummary.total)} ALP</span> across{" "}
                    {agencySummary.policies.toLocaleString()} policies
                  </p>
                  {agencySummary.rows.map((a) => (
                    <div key={a.agency}>
                      <div className="flex items-center justify-between text-sm">
                        <span className="flex items-center gap-2 font-medium">
                          {a.agency}
                          {a.is_primary && <Badge variant="outline" className="border-primary/30 bg-primary/15 text-primary text-[11px]">PRIMARY</Badge>}
                        </span>
                        <span className="font-semibold tabular-nums">{fmtMoney(a.alp)}</span>
                      </div>
                      <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
                        <div className="h-full rounded-full bg-primary" style={{ width: `${a.share * 100}%` }} />
                      </div>
                      <p className="mt-0.5 text-[12px] text-muted-foreground">
                        {a.policies === null ? "Policy count unavailable" : `${a.policies.toLocaleString()} policies`} · {agencyPeriodLabel.toLowerCase()}
                      </p>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
          </QueryState>
        </div>
      )}

      {focusDealId && enabled && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
          {focusIndex >= 0 ? (
            <span>Showing the deal you just posted, highlighted below.</span>
          ) : dealsLoaded ? (
            <div className="min-w-0 flex-1">
              <QueryState
                {...describeQuery(focusLookup)}
                label="that deal"
                compact
                onRetry={() => void focusLookup.refetch()}
                title="That deal is not in this view."
                body="It is outside your scope or no longer in the book."
              >
                {focusRow && (
                  <div>
                    <p className="mb-2">The deal you opened. It is not among the rows loaded below (older than the loaded pages, or hidden by the status filter), so here it is directly.</p>
                    <div className="rounded-md border border-border bg-card">
                      <DealRowItem
                        d={focusRow}
                        isOpen={expandedId === focusRow.row_key}
                        isFocus
                        teamView={teamView}
                        onToggle={() => setExpandedId((current) => (current === focusRow.row_key ? null : focusRow.row_key))}
                        client={clientDetails.byKey.get(focusRow.row_key)}
                        clientLoading={clientDetails.loading.has(focusRow.row_key)}
                        clientFailed={clientDetails.failedKeys.has(focusRow.row_key)}
                        hasSoldCall={soldKeys.has}
                        canWork={canWorkBook}
                      />
                    </div>
                  </div>
                )}
              </QueryState>
            </div>
          ) : dealsQuery.isError ? (
            <span>That deal cannot be looked up until the list loads.</span>
          ) : (
            <span>Looking for the deal you opened.</span>
          )}
          <Button size="sm" variant="ghost" onClick={clearFocus}>Show all deals</Button>
        </div>
      )}

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-baseline gap-2 space-y-0">
          <CardTitle className="text-sm">
            {productionListLabel}
            {activeStatus && <span className="font-normal text-muted-foreground"> · {activeStatus.label}</span>}
          </CardTitle>
          {enabled && (
            <div className="text-sm text-muted-foreground">
              <QueryState {...describeQuery(countQuery)} label="deal count" compact onRetry={() => void countQuery.refetch()}>
                <span>{exactCount} deals</span>
              </QueryState>
            </div>
          )}
        </CardHeader>
        <CardContent className="p-0">
          {identityBlock ? (
            <div className="p-4">{identityBlock}</div>
          ) : (
            <>
              {isTeamManager && me.identity?.status === "error" && (
                <div className="px-4 pt-4">
                  <QueryState compact status="error" label="your own agent record" error={me.identity.message} onRetry={me.refetch} />
                  <p className="mt-1 text-xs text-muted-foreground">The team below comes from the server's own lookup of this login until your record loads.</p>
                </div>
              )}
              {isTeamManager && downline.isError && downline.ids !== undefined && (
                <div className="px-4 pt-4">
                  <QueryState compact status="error" label="your team list" error={downline.error} onRetry={downline.refetch} />
                  <p className="mt-1 text-xs text-muted-foreground">Showing your team as of its last successful read.</p>
                </div>
              )}
              {me.identity?.status === "resolved" && me.identity.note && (
                <p className="px-4 pt-4 text-xs text-muted-foreground" role="note">{me.identity.note}</p>
              )}
              <QueryState
                {...describeQuery({
                  isPending: dealsQuery.isPending,
                  isError: dealsQuery.isError && !dealsQuery.isFetchNextPageError,
                  data: dealsQuery.data,
                  error: dealsQuery.error,
                  isEmpty: deals.length === 0,
                })}
                label="deals"
                onRetry={() => void dealsQuery.refetch()}
                asOf={dealsQuery.dataUpdatedAt}
                className="p-4"
                title={activeStatus ? `No ${activeStatus.label} deals in this view` : "No deals logged yet"}
                body={activeStatus ? <>Every other status is hidden by the filter. {clearFilterButton}</> : "Use Post a Deal to record the first one."}
              >
                {clientDetails.failed && (
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2 text-xs" role="status">
                    <span className="text-destructive">Client phone and date of birth did not load: {clientDetails.failed}</span>
                    <Button size="sm" variant="outline" className="h-7" onClick={clientDetails.retry}>Try again</Button>
                  </div>
                )}
                <div className="divide-y divide-border">
                  {deals.slice(0, visible).map((d) => (
                    <DealRowItem
                      key={d.row_key}
                      d={d}
                      isOpen={expandedId === d.row_key}
                      isFocus={focusDealId === d.row_key}
                      teamView={teamView}
                      onToggle={() => setExpandedId(expandedId === d.row_key ? null : d.row_key)}
                      focusRef={focusRef}
                      client={clientDetails.byKey.get(d.row_key)}
                      clientLoading={clientDetails.loading.has(d.row_key)}
                      clientFailed={clientDetails.failedKeys.has(d.row_key)}
                      hasSoldCall={soldKeys.has}
                      canWork={canWorkBook}
                    />
                  ))}
                </div>
                {(visible < deals.length || dealsQuery.hasNextPage || shortLoaded) && (
                  <div className="flex flex-wrap items-center justify-center gap-3 border-t border-border p-3">
                    <span className="text-xs text-muted-foreground">
                      Showing {Math.min(visible, deals.length).toLocaleString()} of {exactCount} · {deals.length.toLocaleString()} loaded
                    </span>
                    {visible < deals.length ? (
                      <>
                        <Button size="sm" variant="outline" onClick={() => setVisible((v) => v + PAGE * 4)}>Show more</Button>
                        <Button size="sm" variant="ghost" onClick={() => setVisible(deals.length)}>Show all loaded</Button>
                      </>
                    ) : dealsQuery.hasNextPage ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={dealsQuery.isFetchingNextPage}
                        onClick={() => {
                          setVisible((v) => v + PAGE * 4);
                          void dealsQuery.fetchNextPage();
                        }}
                      >
                        {dealsQuery.isFetchingNextPage ? "Loading more" : "Load more"}
                      </Button>
                    ) : (
                      <>
                        <span className="text-xs text-muted-foreground">The count is higher than the rows loaded.</span>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={dealsQuery.isFetching}
                          onClick={() => {
                            void dealsQuery.refetch();
                            void countQuery.refetch();
                          }}
                        >
                          {dealsQuery.isFetching ? "Reloading" : "Reload list"}
                        </Button>
                      </>
                    )}
                    {nextPageError && <span role="alert" className="text-xs text-destructive">{nextPageError}</span>}
                  </div>
                )}
              </QueryState>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
