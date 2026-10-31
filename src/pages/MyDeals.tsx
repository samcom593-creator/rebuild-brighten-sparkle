import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { useSearchParams } from "react-router-dom";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useAgentIdentity } from "@/hooks/useAgentIdentity";
import { useFullBookReader } from "@/hooks/useFullBookReader";
import { useResolvedDownline } from "@/hooks/useResolvedDownline";
import { SubmitDealDialog } from "@/components/deals/SubmitDealDialog";
import { SoldCallPanel } from "@/components/clients/SoldCallPanel";
import { ClientContactLine } from "@/components/clients/ClientContactLine";
import { BookRowWork } from "@/components/books/BookRowWork";
import { BookRowCallsPanel } from "@/components/books/BookRowCallsPanel";
import { BookStandingBoard } from "@/components/books/BookStandingBoard";
import { LeadStatesPanel } from "@/components/books/LeadStatesPanel";
import { dispositionLabel } from "@/lib/readymodeDispositions";
import { looseSupabase } from "@/lib/looseSupabase";
import { splitClientName } from "@/lib/clientFacts";
import { resolveBrand } from "@/config/brand";
import { useBookClientDetails, type BookClientDetails } from "@/hooks/useBookClientDetails";
import { useSoldCallKeys } from "@/hooks/useSoldCallKeys";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TonePill } from "@/components/ui/delight/ToneBubble";
import { QueryState, describeQuery, errorMessage } from "@/components/ui/query-state";
import { PageHeader } from "@/components/ui/page-header";
import { BookOpen, ChevronDown, ChevronRight, FilePlus2, PhoneCall, Star } from "lucide-react";
import { format, formatDistanceToNowStrict } from "date-fns";
import { bookStandingTone } from "@/lib/tones";
import { formatAsOf } from "@/lib/queryState";
import { prefersReducedMotion } from "@/lib/celebrate";
import {
  KNOWN_STANDINGS_IN_LIST,
  STANDING_META,
  readStandingParams,
  statusKeyLabel,
  summarizeStanding,
  type BookStanding,
  type StandingCountRow,
} from "@/lib/bookStanding";
import {
  dealsCursorAfter,
  dealsPageCursorFilter,
  dealsPageMayContinue,
  type DealsCursor,
} from "@/lib/productionBook";
import {
  STATE_NOT_KNOWN,
  parseLeadYield,
  parseStateParam,
  parseStateSummary,
  stateLabel,
} from "@/lib/leadStates";

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
  /** The status in one key ("issued_not_paid"), from v_book_of_business. */
  status_key: string | null;
  /** active / pending / lapsing / gone / unknown, from v_book_of_business. */
  standing: string | null;
  /** OVERHAUL-states: the client's state (two letters), or null when it is not known. */
  client_state?: string | null;
  /** How the state is known: "on_file" (client record, sold call, lead list) or "area_code" (the phone's area code, likely). */
  client_state_source?: string | null;
};

/** One server page of the book, with the server's exact count of rows matching from its cursor on. */
type DealsPage = { rows: DealRow[]; matching: number | null };

/** What the dialer knows about one book row (v_book_row_call_summary, MP-310). Sam + Aisha only. */
type CallSummary = {
  flip_key: string;
  policy_number: string | null;
  client_key: string | null;
  calls_total: number;
  sold_calls: number;
  objection_calls: number;
  appointment_calls: number;
  dnc_calls: number;
  transcripts: number;
  last_call_at: string | null;
  last_disposition: string | null;
  last_agent: string | null;
  matched_by_phone: boolean;
  packet_id: string | null;
  latest_summary: string | null;
  best_grade: number | null;
  has_great_call: boolean;
  gave_ssn_and_bank: boolean;
  last_approval_said: string | null;
};
type DialerChip = "all" | "sold_call" | "transcript" | "great_call" | "no_call";
const DIALER_CHIPS: { key: DialerChip; label: string }[] = [
  { key: "all", label: "Every row" },
  { key: "sold_call", label: "Sold on a call" },
  { key: "transcript", label: "Has transcript" },
  { key: "great_call", label: "Great call" },
  { key: "no_call", label: "No dialer call" },
];
const nameKey = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
/** The summary for a book row: by policy number + client name (what the row itself carries), then by its Book Flips key. */
function callsFor(map: Map<string, CallSummary> | undefined, d: DealRow, client?: BookClientDetails): CallSummary | null {
  if (!map) return null;
  const byRow = map.get(`row:${(d.policy_number ?? "").trim()}|${nameKey(d.client_name)}`);
  if (byRow) return byRow;
  if (client?.flip_carrier && client.flip_policy_number) {
    const key = [client.flip_carrier, client.flip_policy_number, client.flip_client_key].filter((v) => v != null).join("|");
    return map.get(`flip:${key.replace(/\|+$/, "")}`) ?? null;
  }
  return null;
}

function fmtMoney(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return `$${Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

const policiesWord = (n: number) => (n === 1 ? "policy" : "policies");

// How many rows to paint at once. The header count is the TRUE total (imported
// Vantage production, native deals and the policies that left the books); the
// list windows the DOM and grows on demand so a 1,700-row book never has to
// render all at once, and never gets silently truncated to a fixed number the
// way the old .limit(100) did.
const PAGE = 60;

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
  calls = null,
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
  /** MP-310: what the dialer knows about this client; null without sold-call access or without a match. */
  calls?: CallSummary | null;
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
        className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-2 p-3 text-left md:grid-cols-[20px_minmax(0,1fr)_7rem_8.5rem_minmax(11.5rem,auto)] md:items-center"
        aria-expanded={isOpen}
      >
        <span className="hidden text-muted-foreground md:block">
          {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </span>
        <div className="min-w-0">
          <p className="font-medium text-sm [overflow-wrap:anywhere]">{d.client_name || "Client not on file"}</p>
          <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
            {d.carrier || "—"} · {d.product || "Product not on file"} · #{d.policy_number || "no policy #"}
          </p>
          {teamView && (
            <p className="text-xs text-muted-foreground">
              Writing agent: {d.agent_name || "Unassigned"}
            </p>
          )}
        </div>
        {/* The policy's status, in the tone of where it stands (Active green, Pending blue, Lapsing
            amber, Gone red, no status grey), always with the words. Top right on a phone. */}
        <div className="flex flex-col items-end gap-1 md:order-last">
          <span className="text-xs text-muted-foreground">Policy status</span>
          <TonePill tone={bookStandingTone(d.standing)} dot className="whitespace-nowrap">{statusKeyLabel(d.status_key)}</TonePill>
        </div>
        <div className="text-xs text-muted-foreground">
          {d.posted_date ? format(new Date(`${d.posted_date}T12:00:00`), "MMM d, yyyy") : "not on file"}
          <span className="block text-xs opacity-70">posted</span>
        </div>
        <div className="text-right">
          <p className="font-semibold text-sm tabular-nums">{fmtMoney(d.annual_premium)}</p>
          <p className="text-xs text-muted-foreground">annual premium</p>
        </div>
      </button>
      {isClientRow && (
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 pb-3 md:pl-11">
          <ClientContactLine
            phone={client?.phone}
            dob={client?.dob}
            state={d.client_state ?? client?.state}
            stateLikely={Boolean(d.client_state) && d.client_state_source === "area_code"}
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
      {/* MP-310: the dialer's history with this client in one line; the calls themselves open with the row. */}
      {calls && calls.calls_total > 0 && (
        <div className="px-3 pb-3 md:pl-11">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <PhoneCall className="h-3.5 w-3.5 text-primary" aria-hidden />
            <span>{calls.calls_total} dialer {calls.calls_total === 1 ? "call" : "calls"}{calls.sold_calls > 0 ? ` · ${calls.sold_calls} sold` : ""}</span>
            <span>· last {dispositionLabel(calls.last_disposition)}{calls.last_call_at ? ` ${format(new Date(calls.last_call_at), "MMM d")}` : ""}{calls.last_agent ? ` by ${calls.last_agent}` : ""}</span>
            {calls.transcripts > 0 && <span>· {calls.transcripts} transcribed</span>}
            {calls.last_approval_said && <span>· agent said {calls.last_approval_said}</span>}
            {calls.gave_ssn_and_bank && <span className="text-emerald-700 dark:text-emerald-300">· gave SSN + bank</span>}
            {calls.best_grade != null && (
              <span className={calls.has_great_call ? "inline-flex items-center gap-0.5 font-semibold text-amber-700 dark:text-amber-300" : ""}>
                · best call {calls.best_grade}/100{calls.has_great_call && <Star className="h-3 w-3" aria-label="great call" />}
              </span>
            )}
            {!calls.matched_by_phone && <span>· matched by name</span>}
          </p>
          {calls.latest_summary && <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{calls.latest_summary}</p>}
        </div>
      )}
      {/* The client's ReadyMode sold-call packet (SSN, bank, beneficiaries, health) sits
          on the row itself, never behind the expand. Only admins and Aisha get keys, and
          the panel renders only for a client with a sold call on file. */}
      {soldCall && (
        <div className="px-3 pb-3 md:pl-11">
          <SoldCallPanel phone={client?.phone} firstName={firstName} lastName={lastName} doNotCall={Boolean(client?.do_not_call || client?.flip_status === "do_not_call")} />
        </div>
      )}
      {isOpen && (
        <>
          <div className="px-4 pb-4 pt-1 grid grid-cols-2 md:grid-cols-4 gap-3 text-xs bg-muted/10">
            <div>
              <p className="text-xs text-muted-foreground">Producer</p>
              <p className="font-semibold">{d.agent_name || "Unassigned"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Policy</p>
              <p className="font-semibold [overflow-wrap:anywhere]">{d.policy_number || "—"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Product</p>
              <p className="font-semibold">{d.product || "—"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Effective</p>
              <p className="font-semibold">{d.effective_date ? format(new Date(`${d.effective_date}T12:00:00`), "MMM d, yyyy") : "not on file"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Source</p>
              <p className="font-semibold">{d.origin === "apex_native" ? `Posted on ${resolveBrand().platformName}` : "Live production feed"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Last synced</p>
              <p className="font-semibold">{d.synced_at ? format(new Date(d.synced_at), "MMM d, h:mm a") : "—"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Row ID</p>
              <p className="font-semibold line-clamp-2 [overflow-wrap:anywhere]">{d.row_key}</p>
            </div>
          </div>
          {calls && calls.calls_total > 0 && (
            <div className="px-4 pb-4"><BookRowCallsPanel flipKey={calls.flip_key} /></div>
          )}
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
  const [searchParams, setSearchParams] = useSearchParams();
  const focusDealId = searchParams.get("deal");
  // OVERHAUL-book: which part of the book the list shows lives in the URL, so a tile selection
  // survives a reload and can be shared. ?standing= is one of the four tiles (or "unknown"),
  // ?status= one status inside it; the page's older ?group= and ?status= links still read.
  const { standing, statusKey } = readStandingParams(searchParams);
  // OVERHAUL-states: ?state=TX lists the clients in one state (?state=unknown: no state known), from the
  // same client_state v_book_of_business carries and book_state_summary() counts.
  const stateFilter = parseStateParam(searchParams.get("state"));
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [visible, setVisible] = useState(PAGE);
  const focusRef = useRef<HTMLDivElement | null>(null);
  const focusHandled = useRef<string | null>(null);

  const teamView = fullBook || isManager;
  const selfAgentId = me.agentId;
  const scopedAgentIds = Array.from(new Set([
    ...(isTeamManager ? downline.ids ?? [] : []),
    ...(selfAgentId ? [selfAgentId] : []),
  ]));
  const scopeKey = fullBook ? "all" : scopedAgentIds.join(",");
  const productionScopeKey = fullBook ? "agency" : scopedAgentIds.join(",") || "self-unresolved";

  // The book is read once its scope is known: admins at once, managers once
  // their own record and their team list have both answered, agents only with
  // a resolved record. Until then nothing is fetched and nothing below
  // pretends to be empty. A manager whose team list could not be read sees that
  // error, not their own deals presented as the team's.
  const identityLoading = !fullBook && (bookReader.isLoading || me.isLoading || (isTeamManager && downline.isWaiting));
  const teamListReady = !isTeamManager || downline.ids !== undefined;
  const scopeReady = fullBook || (!identityLoading && teamListReady && scopedAgentIds.length > 0);
  const enabled = Boolean(user?.id) && scopeReady;
  const filterKey = `${standing ?? "everyone"}:${statusKey ?? "all"}:${stateFilter ?? "any-state"}`;

  // One source for the whole book: v_book_of_business is every row of the
  // unified production book (imported production and native posts, deduped)
  // plus the policies that left the books, each with its standing. The rows,
  // the exact count and the four tiles all read it with the same filters, so a
  // number cannot be live in one place and stale in another.
  //
  // F09: the book is read in server pages, ordered by (posted_date desc, row_key
  // asc) so ties on a posted date cannot skip or repeat a row between pages.
  // "Load more" fetches the next range after the last row loaded, in that same
  // order; the literal page size is pinned by scripts/check-native-deals.mjs.
  // The server answers at most 1,000 rows per request whatever the limit asks,
  // so each page also carries the server's exact count of the rows matching
  // from its cursor on, and the list continues while a page holds fewer.
  const dealsQuery = useInfiniteQuery({
    queryKey: ["deals", scopeKey, filterKey],
    enabled,
    initialPageParam: null as DealsCursor | null,
    queryFn: async ({ pageParam }): Promise<DealsPage> => {
      let query = supabase
        .from("v_book_of_business")
        .select("*", { count: "exact" })
        .order("posted_date", { ascending: false, nullsFirst: false })
        .order("row_key", { ascending: true })
        .limit(3000);
      if (!fullBook) query = query.in("agent_id", scopedAgentIds);
      if (standing === "unknown") query = query.not("standing", "in", KNOWN_STANDINGS_IN_LIST);
      else if (standing) query = query.eq("standing", standing);
      if (statusKey) query = query.eq("status_key", statusKey);
      if (stateFilter === STATE_NOT_KNOWN) query = query.is("client_state", null);
      else if (stateFilter) query = query.eq("client_state", stateFilter);
      if (pageParam) query = query.or(dealsPageCursorFilter(pageParam));
      const { data, error, count } = await query;
      if (error) throw error;
      if (!Array.isArray(data)) throw new Error("The book read returned no result set.");
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

  // Exact total for the list heading, independent of how many rows the list holds.
  // head:true fetches no rows, only the Content-Range count. Same scope and the
  // same filters as the list, so "loaded N of M" compares like with like.
  const countQuery = useQuery({
    queryKey: ["deals-count", scopeKey, filterKey],
    enabled,
    queryFn: async () => {
      let query = supabase.from("v_book_of_business").select("row_key", { count: "exact", head: true });
      if (!fullBook) query = query.in("agent_id", scopedAgentIds);
      if (standing === "unknown") query = query.not("standing", "in", KNOWN_STANDINGS_IN_LIST);
      else if (standing) query = query.eq("standing", standing);
      if (statusKey) query = query.eq("status_key", statusKey);
      if (stateFilter === STATE_NOT_KNOWN) query = query.is("client_state", null);
      else if (stateFilter) query = query.eq("client_state", stateFilter);
      const { count, error } = await query;
      if (error) throw error;
      if (count === null) throw new Error("The server did not return a policy count.");
      return count;
    },
  });

  // OVERHAUL-book (Sam, 2026-10-28: "it should be breakdown of people who are here and not people
  // who aren't here"): the four tiles. book_of_business_counts() counts v_book_of_business by
  // standing and status inside the caller's scope, and a manager or agent passes the same agent
  // list the rows are filtered by, so each tile equals the list it opens.
  const standingQuery = useQuery({
    queryKey: ["book-standing", productionScopeKey],
    enabled,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("book_of_business_counts", fullBook ? {} : { p_agent_ids: scopedAgentIds });
      if (error) throw error;
      if (!Array.isArray(data)) throw new Error("The book counts returned no result set.");
      return summarizeStanding(data as StandingCountRow[]);
    },
  });
  const standingSummary = standingQuery.data ?? null;

  // OVERHAUL-states (Sam, 2026-10-30: "show what states I should get, in order"): the book by client state,
  // for the full-book readers, who buy the leads. book_state_summary() counts v_book_of_business by
  // client_state inside the caller's scope, so a state's number is the list ?state= opens and the states add
  // up to the tiles. The lead lists (lead_state_yield) are slower and admin data: read after, cached longer.
  const stateSummaryQuery = useQuery({
    queryKey: ["book-state-summary"],
    enabled: enabled && fullBook,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("book_state_summary", {});
      if (error) throw error;
      return parseStateSummary(data);
    },
  });
  const leadYieldQuery = useQuery({
    queryKey: ["lead-state-yield"],
    enabled: enabled && fullBook,
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("lead_state_yield");
      if (error) throw error;
      return parseLeadYield(data);
    },
  });
  const stateRow = stateFilter && stateSummaryQuery.data
    ? stateSummaryQuery.data.find((r) => (r.state ?? STATE_NOT_KNOWN) === stateFilter) ?? null
    : null;
  // A failed read with nothing on hand shows dashes and why; a failed refresh keeps the last
  // numbers and says how old they are. Either way Try again is beside it, and nothing reads 0.
  const standingNotice = standingQuery.isError
    ? standingSummary
      ? `These counts are from ${formatAsOf(standingQuery.dataUpdatedAt)}. The latest read failed: ${errorMessage(standingQuery.error)}`
      : `The book counts did not load: ${errorMessage(standingQuery.error)}`
    : null;

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
      let query = supabase.from("v_book_of_business").select("*").eq("row_key", key).limit(1);
      if (!fullBook) query = query.in("agent_id", scopedAgentIds);
      const { data, error } = await query;
      if (error) throw error;
      if (!Array.isArray(data)) throw new Error("The deal lookup returned no result set.");
      return (data[0] as unknown as DealRow | undefined) ?? null;
    },
  });

  // ?flip=<carrier|policy|client> is how Sold Calls opens "this client's row". Resolve it to a
  // row_key and hand it to ?deal= above. Policy numbers repeat (72 shared), so a row is chosen
  // only when the client also matches, or when the policy number is unique in this scope.
  const focusFlip = searchParams.get("flip");
  const flipLookup = useQuery({
    queryKey: ["deal-by-flip", scopeKey, focusFlip],
    enabled: Boolean(focusFlip) && enabled && !focusDealId,
    queryFn: async () => {
      const [, policy = "", client = ""] = (focusFlip ?? "").split("|");
      if (!policy.trim()) return null;
      let query = supabase.from("v_book_of_business").select("row_key, client_name").eq("policy_number", policy.trim()).limit(25);
      if (!fullBook) query = query.in("agent_id", scopedAgentIds);
      const { data, error } = await query;
      if (error) throw error;
      const rows = (data ?? []) as Array<{ row_key: string; client_name: string | null }>;
      const exact = client ? rows.find((r) => nameKey(r.client_name) === client) : undefined;
      return exact?.row_key ?? (rows.length === 1 ? rows[0].row_key : null);
    },
  });
  useEffect(() => {
    if (!focusFlip || flipLookup.data === undefined) return;
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete("flip");
      if (flipLookup.data) next.set("deal", flipLookup.data);
      return next;
    }, { replace: true });
  }, [focusFlip, flipLookup.data, setSearchParams]);

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

  // Choosing a tile (or Everyone) sets ?standing= and drops any status inside the old one;
  // choosing a status inside the tile sets ?status=. The page's older params go either way.
  const showBook = (nextStanding: BookStanding | null, nextStatus: string | null = null) => {
    const next = new URLSearchParams(searchParams);
    next.delete("group");
    // The four tiles count the whole book, so choosing one leaves any state behind.
    next.delete("state");
    if (nextStanding) next.set("standing", nextStanding);
    else next.delete("standing");
    if (nextStatus) next.set("status", nextStatus);
    else next.delete("status");
    setSearchParams(next, { replace: true });
    setVisible(PAGE);
    setExpandedId(null);
  };
  // A tile opens its list. On a phone the list starts below the four tiles, so bring it up to
  // where the person is looking; on a wide screen it is already in view and nothing moves.
  const listRef = useRef<HTMLDivElement | null>(null);
  const bringListUp = () => {
    requestAnimationFrame(() => {
      const el = listRef.current;
      if (!el || el.getBoundingClientRect().top < window.innerHeight * 0.6) return;
      el.scrollIntoView?.({ block: "start", behavior: prefersReducedMotion() ? "auto" : "smooth" });
    });
  };
  const openStanding = (nextStanding: BookStanding | null) => {
    showBook(nextStanding);
    if (!nextStanding) return;
    bringListUp();
  };
  // A state (from Where to buy leads) opens the book filtered to it: the whole state, any standing. Choosing
  // the state that is already open closes it again.
  const openState = (code: string) => {
    const nextCode = parseStateParam(code);
    const next = new URLSearchParams(searchParams);
    next.delete("group");
    next.delete("standing");
    next.delete("status");
    if (nextCode && nextCode !== stateFilter) next.set("state", nextCode);
    else next.delete("state");
    setSearchParams(next, { replace: true });
    setVisible(PAGE);
    setExpandedId(null);
    if (nextCode && nextCode !== stateFilter) bringListUp();
  };
  // Inside a state, one standing at a time (the counts come from the same summary as the state's row).
  const showStateStanding = (nextStanding: BookStanding | null) => {
    const next = new URLSearchParams(searchParams);
    next.delete("group");
    next.delete("status");
    if (nextStanding) next.set("standing", nextStanding);
    else next.delete("standing");
    setSearchParams(next, { replace: true });
    setVisible(PAGE);
    setExpandedId(null);
  };
  const clearState = () => {
    const next = new URLSearchParams(searchParams);
    next.delete("state");
    setSearchParams(next, { replace: true });
    setVisible(PAGE);
    setExpandedId(null);
  };

  const latestSync = deals.reduce<string | null>((acc, d) => {
    const t = d.synced_at;
    if (!t) return acc;
    return !acc || t > acc ? t : acc;
  }, null);

  const scopeWords = fullBook ? "across the agency" : isManager ? "on your team" : "for your clients";
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

  // MP-310 (Sam, 2026-10-28): what the dialer knows about every book row, so each sale is matched to its
  // transcript and the list can be filtered by it. v_book_row_call_summary is security_invoker over tables
  // gated by can_view_sold_calls(), so only Sam's admin logins and Aisha read rows; nobody else sends the query.
  // Admins at once; Aisha once her sold-call keys answered (the same can_view_sold_calls() the view enforces).
  const canViewCalls = !!isAdmin || soldKeys.ready;
  const callSummaryQuery = useQuery({
    queryKey: ["book-row-call-summary"],
    enabled: canViewCalls && enabled,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await (looseSupabase
        .from("v_book_row_call_summary")
        .select("flip_key, policy_number, client_key, calls_total, sold_calls, objection_calls, appointment_calls, dnc_calls, transcripts, last_call_at, last_disposition, last_agent, matched_by_phone, packet_id, latest_summary, best_grade, has_great_call, gave_ssn_and_bank, last_approval_said")
        .limit(5000) as unknown as Promise<{ data: CallSummary[] | null; error: { message: string } | null }>);
      if (error) throw new Error(error.message);
      const map = new Map<string, CallSummary>();
      for (const r of data ?? []) {
        map.set(`flip:${r.flip_key.replace(/\|+$/, "")}`, r);
        if (r.policy_number) map.set(`row:${r.policy_number.trim()}|${r.client_key ?? ""}`, r);
      }
      return map;
    },
  });
  const callSummaries = callSummaryQuery.data;
  const [dialerChip, setDialerChip] = useState<DialerChip>("all");
  const dialerMatch = (d: DealRow): boolean => {
    if (dialerChip === "all") return true;
    const c = callsFor(callSummaries, d, clientDetails.byKey.get(d.row_key));
    // A row the dialer never touched has no summary at all: that is "No dialer call", not a miss.
    if (dialerChip === "no_call") return !c || c.calls_total === 0;
    if (!c) return false;
    if (dialerChip === "sold_call") return c.sold_calls > 0;
    if (dialerChip === "transcript") return c.transcripts > 0;
    return c.has_great_call;
  };
  const visibleDeals = dialerChip === "all" ? deals : deals.filter(dialerMatch);
  // The dialer filter is for the people who can read the calls, once there are rows to filter
  // (or one is already chosen, so it can always be turned back off).
  const showDialerFilter = Boolean(canViewCalls && callSummaries && (deals.length > 0 || dialerChip !== "all"));

  // Why the list is not shown yet, for a login whose scope is not resolved.
  // A failed read says so with a retry; it is never shown as an empty book.
  let identityBlock: ReactNode = null;
  if (!scopeReady) {
    if (identityLoading) {
      identityBlock = <QueryState status="loading" label={isTeamManager ? "your team" : "your agent record"} />;
    } else if (isTeamManager && downline.isError) {
      // The team list could not be read. The list is withheld rather than
      // narrowed to the manager's own deals under a team heading.
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

  // The list heading names what is showing, in the tile's own words.
  const standingMeta = standing ? STANDING_META[standing] : null;
  const stateName = stateFilter ? stateLabel(stateFilter === STATE_NOT_KNOWN ? null : stateFilter) : null;
  const listTitle = stateName ?? (standingMeta ? standingMeta.label : "Everyone");
  const statusLabel = statusKey ? statusKeyLabel(statusKey) : null;
  const inState = stateFilter === STATE_NOT_KNOWN ? "with no state known" : stateName ? `in ${stateName}` : null;
  const emptyTitle = inState
    ? standingMeta
      ? `${standingMeta.emptyTitle} ${inState}`
      : `No policies ${inState}`
    : statusLabel
      ? `No ${statusLabel.toLowerCase()} policies ${scopeWords}`
      : standingMeta
        ? `${standingMeta.emptyTitle} ${scopeWords}`
        : "Nothing on the book yet";
  // The statuses inside the chosen tile, from the same counts, so each chip equals its list. Inside a state
  // the chips are the state's standings instead (from book_state_summary(), the same rows).
  const standingStatuses = standing && standingSummary && !stateFilter ? standingSummary.statuses[standing] : [];
  const stateStandings: { key: BookStanding; label: string; n: number }[] = stateRow
    ? ([
        { key: "active", label: STANDING_META.active.label, n: stateRow.active },
        { key: "pending", label: STANDING_META.pending.label, n: stateRow.pending },
        { key: "lapsing", label: STANDING_META.lapsing.label, n: stateRow.lapsing },
        { key: "gone", label: STANDING_META.gone.label, n: stateRow.gone },
        { key: "unknown", label: STANDING_META.unknown.label, n: stateRow.no_status },
      ] as { key: BookStanding; label: string; n: number }[]).filter((s) => s.n > 0 || s.key === standing)
    : [];
  const stateLine = stateFilter && stateRow
    ? stateFilter === STATE_NOT_KNOWN
      ? `${stateRow.no_client.toLocaleString()} reported as agency totals with no client; the other ${(stateRow.policies - stateRow.no_client).toLocaleString()} have no state on file and no phone with a US area code.`
      : stateRow.on_file === stateRow.policies
        ? `Every one has the client's state on file.`
        : stateRow.on_file === 0
          ? `Likely ${stateName}, by the client's phone area code: no state is on file for these clients.`
          : `${stateRow.on_file.toLocaleString()} with the state on file; the other ${(stateRow.policies - stateRow.on_file).toLocaleString()} are likely ${stateName}, by the phone's area code.`
    : null;
  const showEveryoneButton = (
    <Button type="button" size="sm" variant="outline" className="h-9 px-3" onClick={() => (stateFilter ? clearState() : showBook(null))}>
      {stateFilter ? "Show every state" : "Show everyone"}
    </Button>
  );

  return (
    <div className="space-y-5 p-4 md:p-6 page-enter max-w-5xl">
      {/* F37: from lg up the shell's sidebar rail always shows Post a Deal, so the
          page's own button shows only below lg, where the shell keeps its copy
          inside the Actions sheet. One visible creation button per viewport. */}
      <PageHeader
        icon={<BookOpen />}
        tone="good"
        title="Book of Business"
        subtitle={`Who is on the books and who is not, ${scopeWords}. Tap a number to see them.`}
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

      {/* OVERHAUL-book: the money flow Sam asked to remove (the premium totals, the "not counted"
          line and the split by agency) is gone from this page. The same numbers live on Home:
          the production scoreboard and Total IMO by agency. */}
      {scopeReady ? (
        <BookStandingBoard
          summary={standingSummary}
          notice={standingNotice}
          onRetry={() => void standingQuery.refetch()}
          selected={stateFilter ? null : standing}
          onSelect={openStanding}
        />
      ) : identityLoading ? (
        <QueryState status="loading" compact label="who is on the books" />
      ) : (
        <p className="text-sm text-muted-foreground">The counts appear once your book is known. The list below says what is missing.</p>
      )}

      {/* OVERHAUL-states: where the deals come from by state and how to split the next lead order. For the
          full-book readers (Sam's admin logins and the book readers), who buy the leads. */}
      {fullBook && enabled ? (
        <LeadStatesPanel
          summary={stateSummaryQuery.data ?? null}
          summaryLoading={stateSummaryQuery.isPending}
          summaryError={stateSummaryQuery.isError ? stateSummaryQuery.error : null}
          summaryUpdatedAt={stateSummaryQuery.dataUpdatedAt}
          onRetrySummary={() => void stateSummaryQuery.refetch()}
          leads={leadYieldQuery.data ?? null}
          leadsLoading={leadYieldQuery.isPending}
          leadsError={leadYieldQuery.isError ? leadYieldQuery.error : null}
          onRetryLeads={() => void leadYieldQuery.refetch()}
          bookTotal={standingSummary ? standingSummary.total : null}
          selectedState={stateFilter}
          onOpenState={openState}
        />
      ) : null}

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
                    <p className="mb-2">The deal you opened. It is not among the rows loaded below (older than the loaded pages, or in another part of the book), so here it is directly.</p>
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
                        calls={callsFor(callSummaries, focusRow, clientDetails.byKey.get(focusRow.row_key))}
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

      <Card ref={listRef} className="scroll-mt-20">
        <CardHeader className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
              <CardTitle className="text-base">
                {listTitle}
                {stateName && standingMeta && <span className="font-normal text-muted-foreground"> · {standingMeta.label}</span>}
                {statusLabel && <span className="font-normal text-muted-foreground"> · {statusLabel}</span>}
              </CardTitle>
              {enabled && (
                <div className="text-sm text-muted-foreground">
                  <QueryState {...describeQuery(countQuery)} label="policy count" compact onRetry={() => void countQuery.refetch()}>
                    <span>{exactCount} {policiesWord(countQuery.data ?? 0)}</span>
                  </QueryState>
                </div>
              )}
            </div>
            {(standing || stateFilter || showDialerFilter) && (
              <div className="flex flex-wrap items-center gap-2">
                {showDialerFilter && (
                  <Select value={dialerChip} onValueChange={(v) => { setDialerChip(v as DialerChip); setVisible(PAGE); }}>
                    <SelectTrigger aria-label="Filter by dialer calls" className="h-9 w-auto min-w-[12rem] gap-2">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DIALER_CHIPS.map((c) => (
                        <SelectItem key={c.key} value={c.key}>{c.key === "all" ? "Dialer calls: every row" : c.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                {(standing || stateFilter) && showEveryoneButton}
              </div>
            )}
          </div>
          {stateLine && <p className="text-sm text-muted-foreground">{stateLine}</p>}
          {stateFilter && stateStandings.length > 0 && (
            <div className="flex flex-wrap items-center gap-2" role="group" aria-label={`${stateName ?? ""} by standing`}>
              <Button
                type="button"
                size="sm"
                variant={standing ? "outline" : "secondary"}
                className="h-9 px-3"
                aria-pressed={!standing}
                onClick={() => showStateStanding(null)}
              >
                All <span className="ml-1 tabular-nums text-muted-foreground">{stateRow?.policies.toLocaleString()}</span>
              </Button>
              {stateStandings.map((s) => (
                <Button
                  key={s.key}
                  type="button"
                  size="sm"
                  variant={standing === s.key ? "secondary" : "outline"}
                  className="h-9 px-3"
                  aria-pressed={standing === s.key}
                  onClick={() => showStateStanding(standing === s.key ? null : s.key)}
                >
                  {s.label} <span className="ml-1 tabular-nums text-muted-foreground">{s.n.toLocaleString()}</span>
                </Button>
              ))}
            </div>
          )}
          {showDialerFilter && dialerChip !== "all" && (
            <p className="text-sm text-muted-foreground">
              {DIALER_CHIPS.find((c) => c.key === dialerChip)?.label}: {visibleDeals.length.toLocaleString()} of the {deals.length.toLocaleString()} loaded rows.
            </p>
          )}
          {standingMeta && <p className="text-sm text-muted-foreground">{standingMeta.definition}</p>}
          {standing && standingStatuses.length > 1 && (
            <div className="flex flex-wrap items-center gap-2" role="group" aria-label={`${standingMeta?.label ?? ""} by status`}>
              <Button
                type="button"
                size="sm"
                variant={statusKey ? "outline" : "secondary"}
                className="h-9 px-3"
                aria-pressed={!statusKey}
                onClick={() => showBook(standing)}
              >
                All <span className="ml-1 tabular-nums text-muted-foreground">{standingSummary?.byStanding[standing].toLocaleString()}</span>
              </Button>
              {standingStatuses.map((s) => (
                <Button
                  key={s.key}
                  type="button"
                  size="sm"
                  variant={statusKey === s.key ? "secondary" : "outline"}
                  className="h-9 px-3"
                  aria-pressed={statusKey === s.key}
                  onClick={() => showBook(standing, statusKey === s.key ? null : s.key)}
                >
                  {s.label} <span className="ml-1 tabular-nums text-muted-foreground">{s.n.toLocaleString()}</span>
                </Button>
              ))}
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
                label="the book"
                onRetry={() => void dealsQuery.refetch()}
                asOf={dealsQuery.dataUpdatedAt}
                className="p-4"
                title={emptyTitle}
                body={standing || stateFilter ? <>The rest of the book is still here. {showEveryoneButton}</> : "Use Post a Deal to record the first one."}
              >
                {clientDetails.failed && (
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2 text-xs" role="status">
                    <span className="text-destructive">Client phone and date of birth did not load: {clientDetails.failed}</span>
                    <Button size="sm" variant="outline" className="h-7" onClick={clientDetails.retry}>Try again</Button>
                  </div>
                )}
                <div className="divide-y divide-border">
                  {visibleDeals.slice(0, visible).map((d) => (
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
                      calls={callsFor(callSummaries, d, clientDetails.byKey.get(d.row_key))}
                    />
                  ))}
                </div>
                {(visible < visibleDeals.length || dealsQuery.hasNextPage || shortLoaded) && (
                  <div className="flex flex-wrap items-center justify-center gap-3 border-t border-border p-3">
                    <span className="text-xs text-muted-foreground">
                      Showing {Math.min(visible, visibleDeals.length).toLocaleString()} of {exactCount} · {deals.length.toLocaleString()} loaded
                    </span>
                    {visible < visibleDeals.length ? (
                      <>
                        <Button size="sm" variant="outline" onClick={() => setVisible((v) => v + PAGE * 4)}>Show more</Button>
                        <Button size="sm" variant="ghost" onClick={() => setVisible(visibleDeals.length)}>Show all loaded</Button>
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
      <p className="text-[13px] text-muted-foreground">
        Source: Vantage live feed + deals posted on {resolveBrand().platformName}
        {latestSync && <> · last sync {formatDistanceToNowStrict(new Date(latestSync), { addSuffix: true })}</>}
      </p>
    </div>
  );
}
