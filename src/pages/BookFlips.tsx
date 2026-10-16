import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Loader2, Phone, PhoneOff, Search } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { formatTimeAgo } from "@/lib/dateUtils";
import { contactLinkProps, formatPhoneDisplay, phoneHref } from "@/lib/phone";
import { cn } from "@/lib/utils";
import {
  BOOK_FILTERS, defaultBookFilter, FLIP_FILTERS, FLIP_LABEL, FLIP_TONE, GROUP_TONE, PRIORITY_CARRIERS, PRIORITY_LABEL, PRIORITY_TONE, SORTS,
  displayName, matchesBook, matchesFlip, matchesSearch, matchesState, money, monthsInForceText, phoenixTime, policyState, stateChipsFor, stateCounts, stateName, stateSourceText, STATE_UNKNOWN,
  priorityTier, shortDate, sortPolicies, splitName, ALL_AGENTS, ALL_CARRIERS, agentCounts, agentGroupValue, matchesAgent,
  type BookFilter, type BookPolicy, type FlipFilter, type FlipStatus, type SortKey,
} from "@/lib/bookFlips";
import { SoldCallPanel } from "@/components/clients/SoldCallPanel";
import { useSoldCallKeys } from "@/hooks/useSoldCallKeys";
import { ageFromDob, dobDisplay } from "@/lib/clientFacts";
import { FlipActions, type FlipSetOptions } from "@/components/books/FlipActions";
import { EASY_RESELLS_KEY } from "@/lib/easyResells";

const COLUMNS =
  "flip_key, carrier, policy_number, client_key, product, book_status, is_dead, is_book_active, status_group, " +
  "client_name, client_first_name, client_last_name, phone, phone_source, dob, age_years, state, city, do_not_call, " +
  "best_time_to_call, face_amount, monthly_premium, annual_premium, effective_date, months_in_force, agent_name, " +
  "agent_gone, agent_group, clients_on_number, flip_status, attempts, last_contact_at, callback_at, notes, resold_policy_number, " +
  "resold_carrier, resold_annual_premium";
const PAGE = 50;

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


export default function BookFlips() {
  const [params, setParams] = useSearchParams();
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
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("priority");
  const [shown, setShown] = useState(PAGE);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [now, setNow] = useState(() => new Date());

  // Callbacks become due while the page is open; re-check every minute.
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(t);
  }, []);
  useEffect(() => { setShown(PAGE); }, [carrier, bookFilter, flipFilter, search, sort, stateFilter, agentFilter]);

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

  const searched = useMemo(() => all.filter((p) => matchesSearch(p, search)), [all, search]);
  const bookCounts = useMemo(() => {
    const out = {} as Record<BookFilter, number>;
    for (const f of BOOK_FILTERS) out[f.key] = searched.filter((p) => matchesAgent(p, agentFilter) && matchesState(p, stateFilter) && matchesFlip(p, flipFilter, now) && matchesBook(p, f.key)).length;
    return out;
  }, [searched, flipFilter, now, stateFilter, agentFilter]);
  const flipCounts = useMemo(() => {
    const out = {} as Record<FlipFilter, number>;
    for (const f of FLIP_FILTERS) out[f.key] = searched.filter((p) => matchesAgent(p, agentFilter) && matchesState(p, stateFilter) && matchesBook(p, bookFilter) && matchesFlip(p, f.key, now)).length;
    return out;
  }, [searched, bookFilter, now, stateFilter, agentFilter]);
  // State counts are taken over the book/call filters (not the state itself), so each chip says how many of THESE
  // opportunities sit in that state, and Unknown is counted rather than hidden.
  const byState = useMemo(
    () => stateCounts(searched.filter((p) => matchesAgent(p, agentFilter) && matchesBook(p, bookFilter) && matchesFlip(p, flipFilter, now))),
    [searched, bookFilter, flipFilter, now, agentFilter],
  );
  const visible = useMemo(
    () => sortPolicies(searched.filter((p) => matchesAgent(p, agentFilter) && matchesState(p, stateFilter) && matchesBook(p, bookFilter) && matchesFlip(p, flipFilter, now)), sort),
    [searched, bookFilter, flipFilter, sort, now, stateFilter, agentFilter],
  );
  // Agent counts are taken over every other filter (not the agent itself), so each option says how many of THESE
  // opportunities that agent sold. The chosen agent stays listed, at 0, when the other filters leave them nothing.
  const agentOptions = useMemo(() => {
    const list = agentCounts(searched.filter((p) => matchesState(p, stateFilter) && matchesBook(p, bookFilter) && matchesFlip(p, flipFilter, now)));
    if (agentFilter !== ALL_AGENTS && !agentFilter.startsWith("group:") && !list.some((a) => a.name === agentFilter)) list.push({ name: agentFilter, count: 0, gone: false });
    return list;
  }, [searched, stateFilter, bookFilter, flipFilter, now, agentFilter]);
  // Everyone under Vantage, counted under the bucket picking it opens on: the URL's ?book when set, otherwise the
  // group's own default (the same thing bookFilter computes once it is picked), so the label and the list agree.
  const vantageValue = agentGroupValue("Vantage");
  const vantageCount = useMemo(() => {
    const book: BookFilter = BOOK_FILTERS.some((f) => f.key === bookParam)
      ? (bookParam as BookFilter)
      : defaultBookFilter(all.filter((p) => matchesAgent(p, vantageValue)));
    return searched.filter((p) => matchesAgent(p, vantageValue) && matchesState(p, stateFilter) && matchesBook(p, book) && matchesFlip(p, flipFilter, now)).length;
  }, [all, searched, bookParam, stateFilter, flipFilter, now, vantageValue]);
  // The selected state always shows: with its real count when the top-12 cut hid it, as 0 only when nobody is there.
  const stateChips = useMemo(() => stateChipsFor(byState, stateFilter), [byState, stateFilter]);
  const unknownCount = byState.find((s) => s.code === STATE_UNKNOWN)?.count ?? 0;
  const inState = visible.length;

  const countFor = (c: string) => counts.data?.find((x) => x.carrier === c);
  const current = allCarriers ? sumCounts(counts.data ?? []) : countFor(carrier);
  const bookLabel = allCarriers ? "every carrier's" : `${carrier}'s`;
  const others = (counts.data ?? []).filter((x) => !PRIORITY_CARRIERS.some((p) => p.carrier === x.carrier));
  const stats = useMemo(() => ({
    workable: all.filter((p) => p.status_group !== "dead").length,
    active: all.filter((p) => p.status_group === "active").length,
    unknown: all.filter((p) => p.status_group === "unknown").length,
    lapsing: all.filter((p) => p.status_group === "lapsing").length,
    phones: all.filter((p) => !!p.phone).length,
    resold: all.filter((p) => p.flip_status === "resold").length,
    resoldPremium: all.reduce((s, p) => s + (p.flip_status === "resold" ? Number(p.resold_annual_premium ?? 0) : 0), 0),
  }), [all]);

  const setFlip = useCallback(async (p: BookPolicy, status: FlipStatus, opts: SetOpts = {}): Promise<boolean> => {
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
      if (status === "resold") toast.success("Marked resold.");
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

  return (
    <div className="mx-auto w-full max-w-5xl px-4 pb-24 pt-4 sm:px-6">
      <PageHeader
        eyebrow="Books"
        title="Work the books"
        subtitle="Call, rewrite, mark resold."
      />

      <nav aria-label="Carrier" className="-mx-4 mb-3 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
        <button
          type="button"
          onClick={() => setCarrier(ALL_CARRIERS)}
          aria-pressed={allCarriers}
          className={cn(
            "shrink-0 rounded-xl border px-3 py-2 text-left transition-colors",
            allCarriers ? "border-primary bg-primary/15" : "border-border bg-card hover:bg-muted",
          )}
        >
          <span className="block text-sm font-bold text-foreground">All carriers</span>
          <span className="block text-xs text-muted-foreground">
            Every book{counts.data ? ` · ${sumCounts(counts.data)?.to_call ?? 0} to call` : ""}
          </span>
        </button>
        {PRIORITY_CARRIERS.map(({ carrier: c, priority }) => {
          const n = countFor(c);
          const active = c === carrier;
          return (
            <button
              key={c}
              type="button"
              onClick={() => setCarrier(c)}
              aria-pressed={active}
              className={cn(
                "shrink-0 rounded-xl border px-3 py-2 text-left transition-colors",
                active ? "border-primary bg-primary/15" : "border-border bg-card hover:bg-muted",
              )}
            >
              <span className="block text-sm font-bold text-foreground">{c}</span>
              <span className="block text-xs text-muted-foreground">
                {priority} priority{n ? ` · ${n.to_call} to call` : ""}
              </span>
            </button>
          );
        })}
        {others.length > 0 && (
          <label className="flex shrink-0 items-center rounded-xl border border-border bg-card px-3 py-2 text-sm">
            <span className="sr-only">Other carriers</span>
            <select
              aria-label="Other carriers"
              value={others.some((o) => o.carrier === carrier) ? carrier : ""}
              onChange={(e) => e.target.value && setCarrier(e.target.value)}
              className="bg-transparent text-base text-foreground outline-none sm:text-sm"
            >
              <option value="">Other carriers</option>
              {others.map((o) => (
                <option key={o.carrier} value={o.carrier}>{o.carrier} ({o.policies})</option>
              ))}
            </select>
          </label>
        )}
      </nav>

      <p className="mb-3 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
        {noKnownStatus
          ? `None of ${carrier}'s ${current?.policies ?? ""} policies has a known status in our records, so confirm each one on the call. `
          : ""}
        {allCarriers
          ? "Statuses come from each carrier's own book import, and those dates differ. Pick a carrier to see its import date. "
          : `Statuses come from the book import${lastImport ? ` on ${lastImport}` : ""}. `}
        "Status unknown" means the carrier never sent one.
      </p>

      <section aria-label="Totals" className="mb-4 grid grid-cols-3 gap-2 sm:grid-cols-6">
        {[
          { label: "Workable", value: stats.workable },
          { label: "Confirmed active", value: stats.active },
          { label: "Status unknown", value: stats.unknown },
          { label: "Lapsing", value: stats.lapsing },
          { label: "With phone", value: stats.phones },
          { label: "Resold", value: stats.resold, sub: stats.resoldPremium ? `${money(stats.resoldPremium)}/yr` : "" },
        ].map((s) => (
          <div key={s.label} className="rounded-lg border border-border bg-card px-3 py-2">
            <p className="text-xl font-bold tabular-nums text-foreground">{rows.isLoading ? "…" : s.value}</p>
            <p className="text-xs text-muted-foreground">{s.label}{s.sub ? ` · ${s.sub}` : ""}</p>
          </div>
        ))}
      </section>

      <div className="mb-3 flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, phone or policy number"
            aria-label="Search the book"
            className="h-11 pl-9 text-base"
          />
        </div>
        <select
          aria-label="Sort"
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          className="h-11 rounded-md border border-input bg-background px-3 text-base text-foreground sm:text-sm"
        >
          {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
        <select
          aria-label="Writing agent"
          value={agentFilter}
          onChange={(e) => setAgentFilter(e.target.value)}
          className="h-11 rounded-md border border-input bg-background px-3 text-base text-foreground sm:max-w-[16rem] sm:text-sm"
        >
          <option value={ALL_AGENTS}>All agents</option>
          {(vantageCount > 0 || agentFilter === vantageValue) && (
            <option value={vantageValue}>Everyone under Vantage · {vantageCount}</option>
          )}
          {agentOptions.map((a) => (
            <option key={a.name} value={a.name}>{a.name}{a.gone ? " (left)" : ""} · {a.count}</option>
          ))}
        </select>
      </div>

      <div className="mb-2 flex flex-wrap gap-2" role="group" aria-label="Book status">
        {BOOK_FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setBookFilter(f.key)}
            aria-pressed={bookFilter === f.key}
            className={cn(
              "rounded-full border px-3 py-1.5 text-sm font-medium",
              bookFilter === f.key ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-foreground hover:bg-muted",
            )}
          >
            {f.label} <span className="tabular-nums opacity-80">{bookCounts[f.key]}</span>
          </button>
        ))}
      </div>
      <div className="mb-2 flex flex-wrap gap-2" role="group" aria-label="Call status">
        {FLIP_FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFlipFilter(f.key)}
            aria-pressed={flipFilter === f.key}
            className={cn(
              "rounded-full border px-3 py-1.5 text-sm font-medium",
              flipFilter === f.key ? "border-foreground bg-foreground text-background" : "border-border bg-card text-foreground hover:bg-muted",
            )}
          >
            {f.label} <span className="tabular-nums opacity-80">{flipCounts[f.key]}</span>
          </button>
        ))}
      </div>
      <div className="mb-4 space-y-1">
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="State">
          <button type="button" onClick={() => setStateFilter("all")} aria-pressed={stateFilter === "all"}
            className={cn("rounded-full border px-3 py-1.5 text-sm font-medium", stateFilter === "all" ? "border-primary bg-primary/15 text-foreground ring-1 ring-primary/60" : "border-border bg-card text-foreground hover:bg-muted")}>
            All states
          </button>
          {stateChips.map((s) => (
            <button key={s.code} type="button" onClick={() => setStateFilter(s.code)} aria-pressed={stateFilter === s.code}
              aria-label={`${stateName(s.code)}: ${s.count} ${s.count === 1 ? "opportunity" : "opportunities"}${s.onFile < s.count ? `, ${s.count - s.onFile} by area code` : ""}`}
              title={s.onFile < s.count ? `${s.onFile} on file · ${s.count - s.onFile} likely, by area code` : "On file"}
              className={cn("rounded-full border px-3 py-1.5 text-sm font-medium", stateFilter === s.code ? "border-primary bg-primary/15 text-foreground ring-1 ring-primary/60" : "border-border bg-card text-foreground hover:bg-muted")}>
              {s.code} <span className="tabular-nums opacity-80">{s.count}</span>
            </button>
          ))}
          {unknownCount > 0 || stateFilter === STATE_UNKNOWN ? (
            <button type="button" onClick={() => setStateFilter(STATE_UNKNOWN)} aria-pressed={stateFilter === STATE_UNKNOWN}
              className={cn("rounded-full border border-dashed px-3 py-1.5 text-sm font-medium", stateFilter === STATE_UNKNOWN ? "border-primary bg-primary/15 text-foreground ring-1 ring-primary/60" : "border-border bg-card text-muted-foreground hover:bg-muted")}>
              State unknown <span className="tabular-nums opacity-80">{unknownCount}</span>
            </button>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground" role="status">
          {stateFilter === "all"
            ? `${inState} ${inState === 1 ? "opportunity" : "opportunities"} across ${byState.filter((s) => s.code !== STATE_UNKNOWN).length} states${unknownCount ? ` plus ${unknownCount} with no state` : ""}. A state is the client's state on file, or the phone's area code (likely, not certain).`
            : stateFilter === STATE_UNKNOWN
              ? `${inState} ${inState === 1 ? "opportunity has" : "opportunities have"} no state on file and no area code to go by.`
              : `${inState} ${inState === 1 ? "opportunity" : "opportunities"} in ${stateName(stateFilter)} under these filters.`}
        </p>
      </div>

      {rows.isLoading ? (
        <div className="flex items-center gap-2 py-10 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" aria-hidden /> Loading {bookLabel} book…</div>
      ) : rows.isError ? (
        <div className="rounded-lg border border-red-400/40 bg-red-500/10 p-4 text-sm">
          <p className="font-semibold text-foreground">Could not load {bookLabel} book.</p>
          <p className="text-muted-foreground">{(rows.error as Error)?.message}</p>
          <Button size="sm" variant="outline" className="mt-2" onClick={() => void rows.refetch()}>Try again</Button>
        </div>
      ) : visible.length === 0 ? (
        <p className="rounded-lg border border-border bg-card p-6 text-center text-muted-foreground">
          Nothing here with these filters. Try "All" above.
        </p>
      ) : (
        <>
          <p className="mb-2 text-sm text-muted-foreground">
            Showing {Math.min(shown, visible.length)} of {visible.length}
          </p>
          <ul className="flex flex-col gap-3">
            {visible.slice(0, shown).map((p) => (
              <PolicyCard key={p.flip_key} p={p} busy={!!busy[p.flip_key]} onSet={setFlip} showCarrier={allCarriers} />
            ))}
          </ul>
          {shown < visible.length && (
            <Button variant="outline" className="mt-4 h-11 w-full" onClick={() => setShown((n) => n + PAGE)}>
              Show {Math.min(PAGE, visible.length - shown)} more
            </Button>
          )}
        </>
      )}
    </div>
  );
}

function PolicyCard({ p, busy, onSet, showCarrier = false }: { p: BookPolicy; busy: boolean; onSet: (p: BookPolicy, s: FlipStatus, o?: SetOpts) => Promise<boolean>; showCarrier?: boolean }) {
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
  const meta = [dob ? `DOB ${dob}` : "", age != null ? `${age} yrs` : "", p.city ?? "", stateSourceText(policyState(p)), p.best_time_to_call ? `best time ${p.best_time_to_call}` : ""].filter(Boolean).join(" · ");
  const soldCall = soldKeys.has(p.phone, p.client_first_name, p.client_last_name);

  const copyPhone = async () => {
    try {
      await navigator.clipboard.writeText(formatPhoneDisplay(p.phone));
      toast.success("Phone copied.");
    } catch {
      toast.error("Could not copy. Long-press the number instead.");
    }
  };

  return (
    <li className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="truncate text-lg font-bold text-foreground">{name}</p>
            {soldCall && (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-amber-500/50 bg-amber-500/15 px-2 py-0.5 text-xs font-semibold text-amber-600 dark:text-amber-400">
                <Phone className="h-3 w-3" aria-hidden /> Sold call
              </span>
            )}
          </div>
          {/* Who sold it sits under the name, so a scroll down the list reads as "who sold what". */}
          <p className="text-sm text-foreground">
            <span className="text-muted-foreground">Sold by </span>
            <span className="font-semibold">{p.agent_name || "agent not on file"}</span>
            {p.agent_gone && <span className="ml-1.5 rounded border border-border px-1.5 text-xs text-muted-foreground">left</span>}
            {p.agent_gone && priorityTier(p) < 6 && (
              <span className={cn("ml-1.5 rounded border px-1.5 text-xs font-semibold", PRIORITY_TONE[priorityTier(p)])}>{PRIORITY_LABEL[priorityTier(p)]}</span>
            )}
            {showCarrier && <span className="text-muted-foreground"> · {p.carrier}</span>}
          </p>
          {meta && <p className="text-sm text-muted-foreground">{meta}</p>}
        </div>
        <span className={cn("shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-semibold", FLIP_TONE[p.flip_status])}>
          {FLIP_LABEL[p.flip_status]}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {dnc ? (
          <span className="inline-flex items-center gap-1.5 rounded-md border border-red-400/40 bg-red-500/10 px-3 py-2 text-sm font-semibold text-red-700 dark:text-red-300">
            <PhoneOff className="h-4 w-4" aria-hidden /> Do not call
          </span>
        ) : badNumber ? (
          <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted px-3 py-2 text-sm font-semibold text-foreground">
            <PhoneOff className="h-4 w-4" aria-hidden /> Bad number{p.phone ? ` · ${formatPhoneDisplay(p.phone)}` : ""}
          </span>
        ) : tel ? (
          <a href={tel} {...contactLinkProps(tel)} className="inline-flex h-11 items-center gap-2 rounded-md bg-primary px-4 text-base font-bold text-primary-foreground">
            <Phone className="h-4 w-4" aria-hidden /> {formatPhoneDisplay(p.phone)}
          </a>
        ) : (
          <span className="text-sm text-muted-foreground">No phone on file</span>
        )}
        {p.phone && !dnc && (
          <Button type="button" variant="ghost" size="icon" aria-label="Copy phone number" onClick={() => void copyPhone()}>
            <Copy className="h-4 w-4" />
          </Button>
        )}
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
        <Field label="Product" value={p.product || "—"} />
        <Field label="Face amount" value={money(p.face_amount) || "—"} />
        <Field label="Premium" value={p.monthly_premium != null ? `${money(p.monthly_premium, 2)}/mo` : "—"} />
        <Field label="Effective" value={[shortDate(p.effective_date), monthsInForceText(p.months_in_force)].filter(Boolean).join(" · ") || "—"} />
        <div>
          <dt className="text-xs text-muted-foreground">Book status</dt>
          <dd><span className={cn("inline-block rounded-full border px-2 py-0.5 text-xs font-semibold", GROUP_TONE[p.status_group])}>{p.book_status}</span></dd>
        </div>
        <Field label="Policy #" value={`${p.policy_number}${p.clients_on_number > 1 ? " (number shared)" : ""}`} />
        <Field label="Attempts" value={`${p.attempts}${p.last_contact_at ? ` · last ${formatTimeAgo(p.last_contact_at)}` : ""}`} />
      </dl>

      {p.flip_status === "callback" && p.callback_at && (
        <p className="mt-2 text-sm font-semibold text-sky-700 dark:text-sky-300">Call back {phoenixTime(p.callback_at)} (Phoenix)</p>
      )}
      {p.flip_status === "resold" && (
        <p className="mt-2 text-sm font-semibold text-emerald-700 dark:text-emerald-300">
          Resold{p.resold_carrier ? ` with ${p.resold_carrier}` : ""}
          {p.resold_annual_premium ? ` · ${money(p.resold_annual_premium)}/yr` : ""}
          {p.resold_policy_number ? ` · #${p.resold_policy_number}` : ""}
        </p>
      )}
      {p.notes && <p className="mt-2 line-clamp-4 whitespace-pre-line text-sm text-muted-foreground">{p.notes}</p>}

      <div className="mt-3">
        <FlipActions
          idBase={p.flip_key}
          status={p.flip_status}
          busy={busy}
          client={{ firstName, lastName, phone: p.phone ?? "", dob: p.dob ?? "" }}
          onSet={(status, opts) => onSet(p, status, opts)}
        />
      </div>
      {/* Only a client with a sold call on file gets the packet (SSN, bank, beneficiaries),
          shown open on the card. The keys come from one shared read, so the other cards
          no longer fire a lookup each. */}
      {soldCall && <div className="mt-2"><SoldCallPanel phone={p.phone} firstName={p.client_first_name} lastName={p.client_last_name} doNotCall={dnc} /></div>}
    </li>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="break-words text-foreground">{value}</dd>
    </div>
  );
}
