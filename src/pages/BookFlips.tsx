// Book Flips (2026-10-07): work the carrier books for rewrites. One card per policy (v_book_flip_worklist),
// every outcome saved with book_flip_set, the same record Easy Resells and Book of Business read.
//
// OVERHAUL-resells (2026-10-29), Sam: "cleaner cards, and rank opportunities by evidence (recently
// lapsed, a sold ReadyMode call on file, gave SSN and bank, reachable phone). Show why each one ranks
// where it does." The page opens on "Best evidence first" (src/lib/resellEvidence.ts): somebody you can
// call, then the most evidence, then the departed-writer priority it used before. Each card shows its
// rank, its score and one chip per piece of evidence; the four tiles count the evidence in view and open
// exactly those policies. The six totals that opened nothing are gone (their counts sit on the chips);
// on a phone the filters fold behind one button that says what is chosen. Only the first card's Call is gold.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Copy, Loader2, Phone, PhoneCall, PhoneOff, Search, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { TonePill } from "@/components/ui/delight/ToneBubble";
import { formatTimeAgo } from "@/lib/dateUtils";
import { contactLinkProps, formatPhoneDisplay, phoneHref } from "@/lib/phone";
import { cn } from "@/lib/utils";
import {
  BOOK_FILTERS, defaultBookFilter, FLIP_FILTERS, FLIP_LABEL, PRIORITY_CARRIERS, PRIORITY_LABEL, SORTS,
  displayName, matchesBook, matchesFlip, matchesSearch, matchesState, money, monthsInForceText, phoenixTime, policyState, stateChipsFor, stateCounts, stateName, stateSourceText, STATE_UNKNOWN,
  groupTone, policySubject, priorityTier, shortDate, sortPolicies, splitName, ALL_AGENTS, ALL_CARRIERS, agentCounts, agentGroupValue, matchesAgent,
  type BookFilter, type BookPolicy, type FlipFilter, type FlipStatus, type SortKey,
} from "@/lib/bookFlips";
import { SoldCallPanel } from "@/components/clients/SoldCallPanel";
import { canViewSoldCalls, useSoldCallKeys } from "@/hooks/useSoldCallKeys";
import { useResellEvidence } from "@/hooks/useResellEvidence";
import { ageFromDob, dobDisplay } from "@/lib/clientFacts";
import { FlipActions, type FlipSetOptions } from "@/components/books/FlipActions";
import { EvidenceBoard, EvidenceChips, RankBadge, RankedListHeader, ScoreBadge } from "@/components/resells/Evidence";
import { EASY_RESELLS_KEY } from "@/lib/easyResells";
import { EMPTY_EVIDENCE, NO_EVIDENCE, evidenceCounts, evidenceFor, hasEvidence, type Evidence, type EvidenceKey } from "@/lib/resellEvidence";
import { flipStatusTone } from "@/lib/tones";
import { celebrate } from "@/lib/celebrate";

const COLUMNS =
  "flip_key, carrier, policy_number, client_key, product, book_status, is_dead, is_book_active, status_group, " +
  "client_name, client_first_name, client_last_name, phone, phone_source, dob, age_years, state, city, do_not_call, " +
  "best_time_to_call, face_amount, monthly_premium, annual_premium, effective_date, posted_date, months_in_force, agent_name, " +
  "agent_gone, agent_group, clients_on_number, flip_status, attempts, last_contact_at, callback_at, notes, resold_policy_number, " +
  "resold_carrier, resold_annual_premium";
const PAGE = 50;
const FILTERS_OPEN_KEY = "book-flips:filters-open";

interface CarrierCount {
  carrier: string;
  policies: number;
  book_active: number;
  unknown_status: number;
  lapsing: number;
  workable: number;
  with_phone: number;
  to_call: number;
  callbacks_due: number;
  resold: number;
  resold_annual_premium: number;
  last_imported_at: string | null;
}

type SetOpts = FlipSetOptions;

async function fetchCarrier(carrier: string): Promise<BookPolicy[]> {
  // PostgREST answers at most 1000 rows per request, so page until a short page.
  // "All carriers" reads every book, so one writing agent's whole book shows in one list.
  const out: BookPolicy[] = [];
  for (let from = 0; ; from += 1000) {
    let query = supabase.from("v_book_flip_worklist").select(COLUMNS);
    if (carrier !== ALL_CARRIERS) query = query.eq("carrier", carrier);
    const { data, error } = await query
      .order("flip_key")
      .range(from, from + 999);
    if (error) throw error;
    const rows = (data ?? []) as unknown as BookPolicy[];
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}

/** The carrier totals summed for the "All carriers" view (latest import across the books). */
function sumCounts(list: CarrierCount[]): CarrierCount | undefined {
  if (list.length === 0) return undefined;
  const sum = (k: keyof CarrierCount) => list.reduce((s, c) => s + Number(c[k] ?? 0), 0);
  return {
    carrier: ALL_CARRIERS, policies: sum("policies"), book_active: sum("book_active"), unknown_status: sum("unknown_status"),
    lapsing: sum("lapsing"), workable: sum("workable"), with_phone: sum("with_phone"), to_call: sum("to_call"),
    callbacks_due: sum("callbacks_due"), resold: sum("resold"), resold_annual_premium: sum("resold_annual_premium"),
    last_imported_at: null,
  };
}

async function fetchCounts(): Promise<CarrierCount[]> {
  const { data, error } = await supabase.from("v_book_flip_carrier_counts").select("*").order("policies", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as CarrierCount[];
}

/** One look for every filter chip on the page: the chosen one is tinted gold, never filled (one gold button per screen). */
const chipClass = (active: boolean, extra?: string) => cn(
  "inline-flex min-h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-sm font-medium focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)]",
  active ? "border-primary bg-primary/15 font-semibold text-foreground" : "border-border bg-card text-foreground hover:bg-muted",
  extra,
);
const policies = (n: number) => `${n.toLocaleString()} ${n === 1 ? "policy" : "policies"}`;

export default function BookFlips() {
  const [params, setParams] = useSearchParams();
  const { isAdmin, user } = useAuth();
  const seesSoldCalls = canViewSoldCalls(!!isAdmin, user?.id);
  const carrier = params.get("carrier") || PRIORITY_CARRIERS[0].carrier;
  const stateFilter = params.get("state") || "all";
  // The writing agent lives in the URL too (?agent=Name), so a link opens on one agent's book.
  const agentFilter = params.get("agent") || ALL_AGENTS;
  const allCarriers = carrier === ALL_CARRIERS;
  const qc = useQueryClient();
  const rowsKey = useMemo(() => ["book-flips", carrier] as const, [carrier]);

  const counts = useQuery({ queryKey: ["book-flip-counts"], queryFn: fetchCounts, staleTime: 60_000 });
  const rows = useQuery({ queryKey: rowsKey, queryFn: () => fetchCarrier(carrier), staleTime: 60_000 });
  const all = useMemo(() => rows.data ?? [], [rows.data]);
  const bookParam = params.get("book");
  // The default bucket is chosen from the rows actually in view: with an agent picked, from that agent's rows.
  const bookFilter: BookFilter = BOOK_FILTERS.some((f) => f.key === bookParam)
    ? (bookParam as BookFilter)
    : defaultBookFilter(all.filter((p) => matchesAgent(p, agentFilter)));

  const [flipFilter, setFlipFilter] = useState<FlipFilter>("to_call");
  const [proof, setProof] = useState<EvidenceKey | null>(null);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("evidence");
  const [shown, setShown] = useState(PAGE);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [now, setNow] = useState(() => new Date());
  // On a phone the carriers scroll sideways; the chosen one is brought into view, so a link that opens on
  // Royal Neighbors shows Royal Neighbors picked instead of a row that seems to start on Combined.
  const carrierNavRef = useRef<HTMLElement>(null);
  const carrierCountsLoaded = counts.isSuccess;
  useEffect(() => {
    // Again once the counts arrive: they widen the buttons and move the chosen one.
    carrierNavRef.current?.querySelector<HTMLElement>('[aria-pressed="true"]')?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [carrier, carrierCountsLoaded]);
  // Open or folded is remembered on this device, so someone who works with the filters open keeps them open.
  const [filtersOpen, setFiltersOpen] = useState<boolean>(() => {
    try { return window.localStorage.getItem(FILTERS_OPEN_KEY) === "1"; } catch { return false; } // empty-catch-allow:storage-unavailable
  });
  const toggleFilters = () => setFiltersOpen((o) => {
    try { window.localStorage.setItem(FILTERS_OPEN_KEY, o ? "0" : "1"); } catch { /* storage unavailable: the choice lasts for this visit */ } // empty-catch-allow:storage-unavailable
    return !o;
  });

  // Callbacks become due while the page is open; re-check every minute.
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(t);
  }, []);
  useEffect(() => { setShown(PAGE); }, [carrier, bookFilter, flipFilter, search, sort, stateFilter, agentFilter, proof]);

  const setCarrier = (c: string) => {
    const next = new URLSearchParams(params);
    next.set("carrier", c);
    setParams(next, { replace: true });
  };
  // The book bucket lives in the URL too (?book=all), so a link can open the page on exactly these opportunities.
  const setBookFilter = (key: BookFilter) => {
    const next = new URLSearchParams(params);
    next.set("book", key);
    setParams(next, { replace: true });
  };
  const setStateFilter = (code: string) => {
    const next = new URLSearchParams(params);
    if (code === "all") next.delete("state"); else next.set("state", code);
    setParams(next, { replace: true });
  };
  const setAgentFilter = (name: string) => {
    const next = new URLSearchParams(params);
    if (name === ALL_AGENTS) next.delete("agent"); else next.set("agent", name);
    setParams(next, { replace: true });
  };

  // Evidence for every policy loaded (one read), ranked on what this viewer may see.
  const subjects = useMemo(() => all.map(policySubject), [all]);
  const ev = useResellEvidence(subjects, { enabled: rows.isSuccess, scope: `book-flips:${carrier}` });
  const evidenceKnown = ev.isReady && !ev.isError;
  const evidence = useMemo(() => {
    const index = ev.index ?? EMPTY_EVIDENCE;
    const at = new Date();
    return new Map(all.map((p, i) => [p.flip_key, evidenceFor(subjects[i], index, at)]));
  }, [all, subjects, ev.index]);
  const evOf = useCallback((p: BookPolicy): Evidence => evidence.get(p.flip_key) ?? NO_EVIDENCE, [evidence]);
  const proofOk = useCallback((p: BookPolicy) => !proof || hasEvidence(evOf(p), proof), [proof, evOf]);

  const searched = useMemo(() => all.filter((p) => matchesSearch(p, search)), [all, search]);
  const bookCounts = useMemo(() => {
    const out = {} as Record<BookFilter, number>;
    for (const f of BOOK_FILTERS) out[f.key] = searched.filter((p) => matchesAgent(p, agentFilter) && matchesState(p, stateFilter) && matchesFlip(p, flipFilter, now) && proofOk(p) && matchesBook(p, f.key)).length;
    return out;
  }, [searched, flipFilter, now, stateFilter, agentFilter, proofOk]);
  const flipCounts = useMemo(() => {
    const out = {} as Record<FlipFilter, number>;
    for (const f of FLIP_FILTERS) out[f.key] = searched.filter((p) => matchesAgent(p, agentFilter) && matchesState(p, stateFilter) && matchesBook(p, bookFilter) && proofOk(p) && matchesFlip(p, f.key, now)).length;
    return out;
  }, [searched, bookFilter, now, stateFilter, agentFilter, proofOk]);
  // State counts are taken over the book/call filters (not the state itself), so each chip says how many of THESE
  // opportunities sit in that state, and Unknown is counted rather than hidden.
  const byState = useMemo(
    () => stateCounts(searched.filter((p) => matchesAgent(p, agentFilter) && matchesBook(p, bookFilter) && matchesFlip(p, flipFilter, now) && proofOk(p))),
    [searched, bookFilter, flipFilter, now, agentFilter, proofOk],
  );
  // The evidence tiles count every other filter as it stands, so each tile equals the list it opens.
  const inView = useMemo(
    () => searched.filter((p) => matchesAgent(p, agentFilter) && matchesState(p, stateFilter) && matchesBook(p, bookFilter) && matchesFlip(p, flipFilter, now)),
    [searched, bookFilter, flipFilter, now, stateFilter, agentFilter],
  );
  const tileCounts = useMemo(() => (evidenceKnown ? evidenceCounts(inView.map(evOf)) : null), [inView, evOf, evidenceKnown]);
  const visible = useMemo(
    () => sortPolicies(inView.filter(proofOk), sort === "evidence" && !evidenceKnown ? "priority" : sort, (p) => evOf(p).score),
    [inView, proofOk, sort, evidenceKnown, evOf],
  );
  // Agent counts are taken over every other filter (not the agent itself), so each option says how many of THESE
  // opportunities that agent sold. The chosen agent stays listed, at 0, when the other filters leave them nothing.
  const agentOptions = useMemo(() => {
    const list = agentCounts(searched.filter((p) => matchesState(p, stateFilter) && matchesBook(p, bookFilter) && matchesFlip(p, flipFilter, now) && proofOk(p)));
    if (agentFilter !== ALL_AGENTS && !agentFilter.startsWith("group:") && !list.some((a) => a.name === agentFilter)) list.push({ name: agentFilter, count: 0, gone: false });
    return list;
  }, [searched, stateFilter, bookFilter, flipFilter, now, agentFilter, proofOk]);
  // Everyone under Vantage, counted under the bucket picking it opens on: the URL's ?book when set, otherwise the
  // group's own default (the same thing bookFilter computes once it is picked), so the label and the list agree.
  const vantageValue = agentGroupValue("Vantage");
  const vantageCount = useMemo(() => {
    const book: BookFilter = BOOK_FILTERS.some((f) => f.key === bookParam)
      ? (bookParam as BookFilter)
      : defaultBookFilter(all.filter((p) => matchesAgent(p, vantageValue)));
    return searched.filter((p) => matchesAgent(p, vantageValue) && matchesState(p, stateFilter) && matchesBook(p, book) && matchesFlip(p, flipFilter, now) && proofOk(p)).length;
  }, [all, searched, bookParam, stateFilter, flipFilter, now, vantageValue, proofOk]);
  // The selected state always shows: with its real count when the top-12 cut hid it, as 0 only when nobody is there.
  const stateChips = useMemo(() => stateChipsFor(byState, stateFilter), [byState, stateFilter]);
  const unknownCount = byState.find((s) => s.code === STATE_UNKNOWN)?.count ?? 0;
  const inState = visible.length;

  const countFor = (c: string) => counts.data?.find((x) => x.carrier === c);
  const current = allCarriers ? sumCounts(counts.data ?? []) : countFor(carrier);
  const bookLabel = allCarriers ? "every carrier's" : `${carrier}'s`;
  const others = (counts.data ?? []).filter((x) => !PRIORITY_CARRIERS.some((p) => p.carrier === x.carrier));

  const setFlip = useCallback(async (p: BookPolicy, status: FlipStatus, opts: SetOpts = {}, origin?: Element | null): Promise<boolean> => {
    if (busy[p.flip_key]) return false;
    setBusy((b) => ({ ...b, [p.flip_key]: true }));
    const before = qc.getQueryData<BookPolicy[]>(rowsKey);
    const patch = (row: BookPolicy): BookPolicy => ({
      ...row,
      flip_status: status,
      attempts: row.attempts + (opts.countAttempt ? 1 : 0),
      last_contact_at: opts.countAttempt ? new Date().toISOString() : row.last_contact_at,
      callback_at: status === "callback" ? (opts.callbackAt ?? row.callback_at) : null,
    });
    qc.setQueryData<BookPolicy[]>(rowsKey, (list) => (list ?? []).map((r) => (r.flip_key === p.flip_key ? patch(r) : r)));
    try {
      const { data, error } = await supabase.rpc("book_flip_set", {
        p_carrier: p.carrier,
        p_policy_number: p.policy_number,
        p_client_key: p.client_key,
        p_status: status,
        p_count_attempt: !!opts.countAttempt,
        ...(opts.note ? { p_note: opts.note } : {}),
        ...(opts.callbackAt ? { p_callback_at: opts.callbackAt } : {}),
        ...(opts.receipt ? {
          p_resold_deal_id: opts.receipt.dealId,
          p_resold_policy_number: opts.receipt.policyNumber,
          p_resold_annual_premium: opts.receipt.annualPaid,
        } : {}),
      });
      if (error) throw error;
      const saved = (data ?? {}) as Partial<BookPolicy>;
      qc.setQueryData<BookPolicy[]>(rowsKey, (list) => (list ?? []).map((r) => (r.flip_key === p.flip_key ? {
        ...r,
        flip_status: (saved.flip_status as FlipStatus) ?? status,
        attempts: saved.attempts ?? r.attempts,
        last_contact_at: saved.last_contact_at ?? r.last_contact_at,
        callback_at: saved.callback_at ?? null,
        notes: saved.notes ?? r.notes,
        resold_policy_number: saved.resold_policy_number ?? null,
        resold_carrier: saved.resold_carrier ?? null,
        resold_annual_premium: saved.resold_annual_premium ?? null,
      } : r)));
      void qc.invalidateQueries({ queryKey: ["book-flip-counts"] });
      // A policy sits in both the All carriers list and its own carrier's list. Mark every cached book
      // list stale so the other one reloads the next time it is shown; refetchType "none" means no
      // 1,000-row reload now and no refetch racing another optimistic save.
      void qc.invalidateQueries({ queryKey: ["book-flips"], refetchType: "none" });
      void qc.invalidateQueries({ queryKey: [EASY_RESELLS_KEY], refetchType: "none" });
      if (status === "resold") {
        toast.success("Marked resold.");
        // A resell is a sale: the bubbles rise from the card, after the server said it saved.
        void celebrate("win", origin);
      }
      return true;
    } catch (e) {
      qc.setQueryData(rowsKey, before);
      const msg = e instanceof Error ? e.message : (e as { message?: string })?.message ?? "Could not save.";
      toast.error(opts.receipt
        ? `The new deal posted, but this policy was not marked resold (${msg}). Tap Resold, then "Already posted" to retry.`
        : `Not saved: ${msg}`);
      return false;
    } finally {
      setBusy((b) => {
        const next = { ...b };
        delete next[p.flip_key];
        return next;
      });
    }
  }, [busy, qc, rowsKey]);

  // Each carrier's book is imported on its own date, so the combined view names no single date.
  const lastImport = !allCarriers && current?.last_imported_at ? shortDate(current.last_imported_at) : "";
  const noKnownStatus = !allCarriers && !!current && current.book_active === 0 && current.unknown_status > 0;
  const listLoading = rows.isLoading || (rows.isSuccess && ev.isLoading);

  const flipLabel = FLIP_FILTERS.find((f) => f.key === flipFilter)?.label ?? "";
  const bookChipLabel = BOOK_FILTERS.find((f) => f.key === bookFilter)?.label ?? "";
  const agentLabel = agentFilter === ALL_AGENTS ? "" : agentFilter === vantageValue ? "Everyone under Vantage" : agentFilter;
  const stateLabel = stateFilter === "all" ? "" : stateFilter === STATE_UNKNOWN ? "State unknown" : stateName(stateFilter);
  const sortLabel = sort === "evidence" ? "" : SORTS.find((s) => s.key === sort)?.label ?? "";
  const filterSummary = [bookChipLabel, flipLabel, stateLabel, agentLabel, sortLabel].filter(Boolean).join(" · ");

  const boardNotice = ev.isError ? (
    <>
      <span role="alert">Call evidence did not load, so the list is ordered by departed writers first and nothing is ranked.</span>
      <Button type="button" size="sm" variant="outline" className="h-9 shrink-0" onClick={() => void ev.refetch()}>Try again</Button>
    </>
  ) : undefined;

  return (
    <div className="mx-auto w-full max-w-6xl space-y-4 px-4 pb-24 pt-4 sm:px-6">
      <PageHeader
        eyebrow="My Business"
        icon={<PhoneCall />}
        tone="good"
        title="Book Flips"
        subtitle="Save a policy or rewrite it, best first."
      />

      <div className="space-y-2">
        <nav ref={carrierNavRef} aria-label="Carrier" className="relative -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
          <CarrierButton active={allCarriers} onClick={() => setCarrier(ALL_CARRIERS)} title="All carriers"
            sub={`Every book${counts.data ? ` · ${sumCounts(counts.data)?.to_call ?? 0} to call` : ""}`} />
          {PRIORITY_CARRIERS.map(({ carrier: c, priority }) => {
            const n = countFor(c);
            return (
              <CarrierButton key={c} active={c === carrier} onClick={() => setCarrier(c)} title={c}
                sub={`${priority} priority${n ? ` · ${n.to_call} to call` : ""}`} />
            );
          })}
          {/* The select is its own 44px target, and carries its name itself: an sr-only span here sat
              outside the row's scroll box and stretched the whole page sideways on a phone. */}
          {others.length > 0 && (
            <select
              aria-label="Other carriers"
              value={others.some((o) => o.carrier === carrier) ? carrier : ""}
              onChange={(e) => e.target.value && setCarrier(e.target.value)}
              className={cn(
                "min-h-11 shrink-0 rounded-xl border px-3 text-base text-foreground focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)] sm:text-sm",
                others.some((o) => o.carrier === carrier) ? "border-primary bg-primary/15 font-semibold" : "border-border bg-card",
              )}
            >
              <option value="">Other carriers</option>
              {others.map((o) => (
                <option key={o.carrier} value={o.carrier}>{o.carrier} ({o.policies})</option>
              ))}
            </select>
          )}
        </nav>
        <p className="text-[13px] leading-[18px] text-muted-foreground">
          {noKnownStatus
            ? `None of ${carrier}'s ${current?.policies ?? ""} policies has a known status in our records, so confirm each one on the call. `
            : ""}
          {allCarriers
            ? "Statuses come from each carrier's own book import, on different dates. Pick a carrier to see its date. "
            : `Statuses come from the book import${lastImport ? ` on ${lastImport}` : ""}. `}
          &ldquo;Status unknown&rdquo; means the carrier never sent one.
        </p>
      </div>

      <EvidenceBoard
        counts={rows.isSuccess ? tileCounts : null}
        active={proof}
        onSelect={setProof}
        notice={boardNotice}
        hidden={seesSoldCalls ? undefined : new Set<EvidenceKey>(["ssn_bank"])}
      />

      <div className="space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, phone or policy number"
              aria-label="Search the book"
              className="h-11 bg-card pl-9 text-base"
            />
          </div>
          {/* The filters fold behind one button that says what is chosen, so the list starts near the top. */}
          <Button
            type="button"
            variant="outline"
            className="h-11 min-w-0 justify-between gap-2 bg-card sm:max-w-[26rem]"
            aria-expanded={filtersOpen}
            aria-controls="book-flip-filters"
            onClick={toggleFilters}
          >
            <span className="flex min-w-0 items-center gap-2">
              <SlidersHorizontal className="h-4 w-4 shrink-0" aria-hidden />
              <span className="truncate">Filters: {filterSummary}</span>
            </span>
            <ChevronDown className={cn("h-4 w-4 shrink-0", filtersOpen && "rotate-180")} aria-hidden />
          </Button>
        </div>

        {filtersOpen && (
          <div id="book-flip-filters" className="space-y-3 rounded-xl border border-border bg-card p-3 sm:p-4">
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="space-y-1">
                <span className="block text-[13px] font-semibold leading-[18px] text-muted-foreground">Order</span>
                <select
                  aria-label="Sort"
                  value={sort}
                  onChange={(e) => setSort(e.target.value as SortKey)}
                  className="h-11 w-full min-w-0 rounded-md border border-input bg-background px-3 text-base text-foreground sm:text-sm"
                >
                  {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                </select>
              </label>
              <label className="space-y-1">
                <span className="block text-[13px] font-semibold leading-[18px] text-muted-foreground">Writing agent</span>
                <select
                  aria-label="Writing agent"
                  value={agentFilter}
                  onChange={(e) => setAgentFilter(e.target.value)}
                  className="h-11 w-full min-w-0 rounded-md border border-input bg-background px-3 text-base text-foreground sm:text-sm"
                >
                  <option value={ALL_AGENTS}>All agents</option>
                  {(vantageCount > 0 || agentFilter === vantageValue) && (
                    <option value={vantageValue}>Everyone under Vantage · {vantageCount}</option>
                  )}
                  {agentOptions.map((a) => (
                    <option key={a.name} value={a.name}>{a.name}{a.gone ? " (left)" : ""} · {a.count}</option>
                  ))}
                </select>
              </label>
            </div>
            <FilterRow label="Book">
              <div className="flex flex-wrap gap-2" role="group" aria-label="Book status">
                {BOOK_FILTERS.map((f) => (
                  <button key={f.key} type="button" onClick={() => setBookFilter(f.key)} aria-pressed={bookFilter === f.key} className={chipClass(bookFilter === f.key)}>
                    {f.label} <span className="tabular-nums text-muted-foreground">{bookCounts[f.key]}</span>
                  </button>
                ))}
              </div>
            </FilterRow>
            <FilterRow label="Calls">
              <div className="flex flex-wrap gap-2" role="group" aria-label="Call status">
                {FLIP_FILTERS.map((f) => (
                  <button key={f.key} type="button" onClick={() => setFlipFilter(f.key)} aria-pressed={flipFilter === f.key} className={chipClass(flipFilter === f.key)}>
                    {f.label} <span className="tabular-nums text-muted-foreground">{flipCounts[f.key]}</span>
                  </button>
                ))}
              </div>
            </FilterRow>
            <FilterRow label="State">
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2" role="group" aria-label="State">
                  <button type="button" onClick={() => setStateFilter("all")} aria-pressed={stateFilter === "all"} className={chipClass(stateFilter === "all")}>
                    All states
                  </button>
                  {stateChips.map((s) => (
                    <button key={s.code} type="button" onClick={() => setStateFilter(s.code)} aria-pressed={stateFilter === s.code}
                      aria-label={`${stateName(s.code)}: ${s.count} ${s.count === 1 ? "opportunity" : "opportunities"}${s.onFile < s.count ? `, ${s.count - s.onFile} by area code` : ""}`}
                      title={s.onFile < s.count ? `${s.onFile} on file · ${s.count - s.onFile} likely, by area code` : "On file"}
                      className={chipClass(stateFilter === s.code)}>
                      {s.code} <span className="tabular-nums text-muted-foreground">{s.count}</span>
                    </button>
                  ))}
                  {unknownCount > 0 || stateFilter === STATE_UNKNOWN ? (
                    <button type="button" onClick={() => setStateFilter(STATE_UNKNOWN)} aria-pressed={stateFilter === STATE_UNKNOWN}
                      className={chipClass(stateFilter === STATE_UNKNOWN, "border-dashed")}>
                      State unknown <span className="tabular-nums text-muted-foreground">{unknownCount}</span>
                    </button>
                  ) : null}
                </div>
                <p className="text-[13px] leading-[18px] text-muted-foreground">
                  {stateFilter === "all"
                    ? `${inState} ${inState === 1 ? "opportunity" : "opportunities"} across ${byState.filter((s) => s.code !== STATE_UNKNOWN).length} states${unknownCount ? ` plus ${unknownCount} with no state` : ""}. A state is the client's state on file, or the phone's area code (likely, not certain).`
                    : stateFilter === STATE_UNKNOWN
                      ? `${inState} ${inState === 1 ? "opportunity has" : "opportunities have"} no state on file and no area code to go by.`
                      : `${inState} ${inState === 1 ? "opportunity" : "opportunities"} in ${stateName(stateFilter)} under these filters.`}
                </p>
              </div>
            </FilterRow>
          </div>
        )}
      </div>

      {listLoading ? (
        <div className="flex items-center gap-2 py-10 text-muted-foreground" aria-busy="true"><Loader2 className="h-5 w-5 animate-spin" aria-hidden /> Loading {bookLabel} book…</div>
      ) : rows.isError ? (
        <div className="rounded-lg border border-tone-hot/35 bg-tone-hot/12 p-4 text-sm" role="alert">
          <p className="font-semibold text-foreground">Could not load {bookLabel} book.</p>
          <p className="text-muted-foreground">{(rows.error as Error)?.message}</p>
          <Button size="sm" variant="outline" className="mt-2" onClick={() => void rows.refetch()}>Try again</Button>
        </div>
      ) : visible.length === 0 ? (
        <p className="rounded-lg border border-border bg-card p-6 text-center text-muted-foreground">
          Nothing here with these filters. Try &ldquo;All&rdquo; above{proof ? ", or tap the chosen tile again" : ""}.
        </p>
      ) : (
        <>
          <RankedListHeader
            summary={`${policies(visible.length)}${sort === "evidence" && evidenceKnown ? ", most evidence first" : `, ${(SORTS.find((s) => s.key === sort)?.label ?? "").toLowerCase()}`}`}
            ranked={sort === "evidence" && evidenceKnown}
            only={proof}
            onShowAll={() => setProof(null)}
            tieBreak="somebody you can call first, then departed writers' policies by how soon they cost money, then the biggest premium"
          />
          <ul className="apex-rise-list flex flex-col gap-3">
            {visible.slice(0, shown).map((p, i) => (
              <PolicyCard
                key={p.flip_key}
                p={p}
                rank={i + 1}
                gold={i === 0}
                evidence={evOf(p)}
                evidenceKnown={evidenceKnown}
                busy={!!busy[p.flip_key]}
                onSet={setFlip}
                showCarrier={allCarriers}
              />
            ))}
          </ul>
          {shown < visible.length && (
            <Button variant="outline" className="h-11 w-full" onClick={() => setShown((n) => n + PAGE)}>
              Show {Math.min(PAGE, visible.length - shown)} more ({(visible.length - shown).toLocaleString()} not shown yet)
            </Button>
          )}
        </>
      )}
    </div>
  );
}

function CarrierButton({ active, onClick, title, sub }: { active: boolean; onClick: () => void; title: string; sub: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "min-h-11 shrink-0 rounded-xl border px-3 py-2 text-left focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)]",
        active ? "border-primary bg-primary/15" : "border-border bg-card hover:bg-muted",
      )}
    >
      <span className="block text-sm font-bold text-foreground">{title}</span>
      <span className="block text-[13px] leading-[18px] text-muted-foreground">{sub}</span>
    </button>
  );
}

/** One labelled row of filter chips: the label names the question ("Book", "Calls", "State"). */
function FilterRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1.5 sm:grid-cols-[4.5rem_1fr] sm:items-start sm:gap-3">
      <span className="text-[13px] font-semibold leading-[18px] text-muted-foreground sm:pt-3">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function PolicyCard({ p, rank, gold, evidence, evidenceKnown, busy, onSet, showCarrier = false }: {
  p: BookPolicy;
  rank: number;
  gold: boolean;
  evidence: Evidence;
  evidenceKnown: boolean;
  busy: boolean;
  onSet: (p: BookPolicy, s: FlipStatus, o?: SetOpts, origin?: Element | null) => Promise<boolean>;
  showCarrier?: boolean;
}) {
  const cardRef = useRef<HTMLLIElement>(null);
  const soldKeys = useSoldCallKeys();
  // Phone: native dialer; laptop: Google Voice (the site-wide rule in @/lib/phone).
  // Do not call comes from the client record or from this card's own outcome; a number
  // marked Bad number stays visible but is no longer offered as a call.
  const dnc = p.do_not_call || p.flip_status === "do_not_call";
  const badNumber = p.flip_status === "bad_number";
  const tel = dnc || badNumber ? null : phoneHref(p.phone);
  const name = displayName(p.client_name) || "Name missing";
  const { firstName, lastName } = splitName(p);
  const dob = dobDisplay(p.dob);
  const age = ageFromDob(p.dob);
  const soldCall = soldKeys.has(p.phone, p.client_first_name, p.client_last_name);
  const tier = priorityTier(p);
  const started = [shortDate(p.effective_date ?? p.posted_date ?? null), monthsInForceText(p.months_in_force)].filter(Boolean).join(", ");

  const policyLine = [
    showCarrier ? p.carrier : null,
    p.product,
    p.monthly_premium != null ? `${money(p.monthly_premium, 2)}/mo` : null,
  ].filter(Boolean).join(" · ");
  const details = [
    dob ? `DOB ${dob}` : "",
    age != null ? `${age} yrs` : "",
    p.city ?? "",
    stateSourceText(policyState(p)),
    p.best_time_to_call ? `best time ${p.best_time_to_call}` : "",
    `Policy # ${p.policy_number}${p.clients_on_number > 1 ? " (number shared)" : ""}`,
    p.face_amount != null ? `face ${money(p.face_amount)}` : "",
    `${p.attempts} ${p.attempts === 1 ? "attempt" : "attempts"}${p.last_contact_at ? `, last ${formatTimeAgo(p.last_contact_at)}` : ""}`,
  ].filter(Boolean).join(" · ");

  const copyPhone = async () => {
    try {
      await navigator.clipboard.writeText(formatPhoneDisplay(p.phone));
      toast.success("Phone copied.");
    } catch {
      toast.error("Could not copy. Long-press the number instead.");
    }
  };

  return (
    // On a phone the Call row comes straight after the policy, so the first card's Call is on the first
    // screen; from sm up the chips sit first, beside the score they add up to.
    <li ref={cardRef} className="flex min-w-0 flex-col rounded-xl border border-border bg-card p-4 sm:p-5" aria-label={`Policy: ${name}`}>
      <div className="order-1 flex items-start gap-3">
        {evidenceKnown && <RankBadge rank={rank} />}
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 pt-0.5">
          <p className="min-w-0 break-words text-[17px] font-bold leading-tight text-foreground">{name}</p>
          <TonePill tone={flipStatusTone(p.flip_status)} className="whitespace-nowrap">{FLIP_LABEL[p.flip_status]}</TonePill>
        </div>
        {evidenceKnown && <ScoreBadge evidence={evidence} />}
      </div>
      <div className="order-2 mt-2">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[15px] leading-[22px] text-foreground">
          {policyLine && <span className="min-w-0 break-words">{policyLine}</span>}
          <TonePill tone={groupTone(p.status_group)} className="whitespace-nowrap">{p.book_status}</TonePill>
        </div>
        {/* Who sold it sits under the policy, so a scroll down the list reads as "who sold what". */}
        <p className="mt-0.5 text-sm text-muted-foreground">
          Sold by <span className="font-semibold text-foreground">{p.agent_name || "agent not on file"}</span>
          {p.agent_gone ? ", who left" : ""}
          {/* What a departed writer's policy needs; "Status unknown" would only repeat the status pill. */}
          {p.agent_gone && tier < 5 ? ` · ${PRIORITY_LABEL[tier]}` : ""}
          {started ? ` · started ${started}` : ""}
        </p>
      </div>

      {evidenceKnown && <div className="order-4 mt-3 sm:order-3"><EvidenceChips evidence={evidence} /></div>}

      <div className="order-3 mt-3 flex flex-wrap items-center gap-2 sm:order-4">
        {dnc ? (
          <span className="inline-flex min-h-11 items-center gap-1.5 rounded-md border border-tone-hot/35 bg-tone-hot/12 px-3 text-sm font-semibold text-tone-hot">
            <PhoneOff className="h-4 w-4" aria-hidden /> Do not call
          </span>
        ) : badNumber ? (
          <span className="inline-flex min-h-11 items-center gap-1.5 rounded-md border border-border bg-muted px-3 text-sm font-semibold text-foreground">
            <PhoneOff className="h-4 w-4" aria-hidden /> Bad number{p.phone ? ` · ${formatPhoneDisplay(p.phone)}` : ""}
          </span>
        ) : tel ? (
          <Button asChild variant={gold ? "default" : "outline"} className="h-11 px-4 text-[15px] font-bold">
            <a href={tel} {...contactLinkProps(tel)}><Phone className="mr-2 h-4 w-4" aria-hidden />{formatPhoneDisplay(p.phone)}</a>
          </Button>
        ) : (
          <span className="text-sm text-muted-foreground">No phone on file</span>
        )}
        {p.phone && !dnc && (
          <Button type="button" variant="ghost" size="icon" aria-label="Copy phone number" onClick={() => void copyPhone()}>
            <Copy className="h-4 w-4" />
          </Button>
        )}
      </div>

      <div className="order-5">
        <p className="mt-2 break-words text-[13px] leading-[18px] text-muted-foreground">{details}</p>
        {p.flip_status === "callback" && p.callback_at && (
          <p className="mt-2 text-sm font-semibold text-tone-cool">Call back {phoenixTime(p.callback_at)} (Phoenix)</p>
        )}
        {p.flip_status === "resold" && (
          <p className="mt-2 text-sm font-semibold text-tone-good">
            Resold{p.resold_carrier ? ` with ${p.resold_carrier}` : ""}
            {p.resold_annual_premium ? ` · ${money(p.resold_annual_premium)}/yr` : ""}
            {p.resold_policy_number ? ` · #${p.resold_policy_number}` : ""}
          </p>
        )}
        {p.notes && <p className="mt-2 line-clamp-4 whitespace-pre-line text-sm text-muted-foreground">{p.notes}</p>}
      </div>

      <div className="order-6 mt-3 border-t border-border pt-3">
        <FlipActions
          idBase={p.flip_key}
          status={p.flip_status}
          busy={busy}
          client={{ firstName, lastName, phone: p.phone ?? "", dob: p.dob ?? "" }}
          onSet={(status, opts) => onSet(p, status, opts, cardRef.current)}
          resoldVariant="outline"
        />
      </div>
      {/* Only a client with a sold call on file gets the packet (SSN, bank, beneficiaries),
          shown open on the card. The keys come from one shared read, so the other cards
          no longer fire a lookup each. The card already has Call and Text for this number. */}
      {soldCall && (
        <div className="order-7 mt-3">
          <SoldCallPanel phone={p.phone} firstName={p.client_first_name} lastName={p.client_last_name} doNotCall={dnc} showContact={!tel} />
        </div>
      )}
    </li>
  );
}
