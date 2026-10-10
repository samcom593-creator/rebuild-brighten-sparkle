import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Copy, Loader2, Phone, PhoneOff, RotateCcw, Search, StickyNote } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { SubmitDealDialog, type PostedDealReceipt } from "@/components/deals/SubmitDealDialog";
import { formatTimeAgo } from "@/lib/dateUtils";
import { contactLinkProps, formatPhoneDisplay, phoneHref } from "@/lib/phone";
import { cn } from "@/lib/utils";
import {
  BOOK_FILTERS, FLIP_FILTERS, FLIP_LABEL, FLIP_TONE, GROUP_TONE, PRIORITY_CARRIERS, PRIORITY_LABEL, PRIORITY_TONE, SORTS,
  displayName, matchesBook, matchesFlip, matchesSearch, matchesState, money, monthsInForceText, phoenixTime, policyState, stateCounts, stateName, stateSourceText, STATE_UNKNOWN,
  priorityTier, shortDate, sortPolicies, splitName,
  type BookFilter, type BookPolicy, type FlipFilter, type FlipStatus, type SortKey,
} from "@/lib/bookFlips";

const COLUMNS =
  "flip_key, carrier, policy_number, client_key, product, book_status, is_dead, is_book_active, status_group, " +
  "client_name, client_first_name, client_last_name, phone, phone_source, dob, age_years, state, city, do_not_call, " +
  "best_time_to_call, face_amount, monthly_premium, annual_premium, effective_date, months_in_force, agent_name, " +
  "agent_gone, clients_on_number, flip_status, attempts, last_contact_at, callback_at, notes, resold_policy_number, " +
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

interface SetOpts {
  countAttempt?: boolean;
  note?: string;
  callbackAt?: string;
  receipt?: PostedDealReceipt;
}

async function fetchCarrier(carrier: string): Promise<BookPolicy[]> {
  // PostgREST answers at most 1000 rows per request, so page until a short page.
  const out: BookPolicy[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("v_book_flip_worklist")
      .select(COLUMNS)
      .eq("carrier", carrier)
      .order("flip_key")
      .range(from, from + 999);
    if (error) throw error;
    const rows = (data ?? []) as unknown as BookPolicy[];
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}

async function fetchCounts(): Promise<CarrierCount[]> {
  const { data, error } = await supabase.from("v_book_flip_carrier_counts").select("*").order("policies", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as CarrierCount[];
}

/** Default callback: two hours from now, on the quarter hour, in the device's local time. */
function defaultCallbackLocal(): string {
  const d = new Date(Date.now() + 2 * 3600_000);
  d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function BookFlips() {
  const [params, setParams] = useSearchParams();
  const carrier = params.get("carrier") || PRIORITY_CARRIERS[0].carrier;
  const stateFilter = params.get("state") || "all";
  const qc = useQueryClient();
  const rowsKey = useMemo(() => ["book-flips", carrier] as const, [carrier]);

  const counts = useQuery({ queryKey: ["book-flip-counts"], queryFn: fetchCounts, staleTime: 60_000 });
  const rows = useQuery({ queryKey: rowsKey, queryFn: () => fetchCarrier(carrier), staleTime: 60_000 });

  const [bookFilter, setBookFilter] = useState<BookFilter>("departed");
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
  useEffect(() => { setShown(PAGE); }, [carrier, bookFilter, flipFilter, search, sort, stateFilter]);

  const setCarrier = (c: string) => {
    const next = new URLSearchParams(params);
    next.set("carrier", c);
    setParams(next, { replace: true });
  };
  const setStateFilter = (code: string) => {
    const next = new URLSearchParams(params);
    if (code === "all") next.delete("state"); else next.set("state", code);
    setParams(next, { replace: true });
  };

  const all = useMemo(() => rows.data ?? [], [rows.data]);
  const searched = useMemo(() => all.filter((p) => matchesSearch(p, search)), [all, search]);
  const bookCounts = useMemo(() => {
    const out = {} as Record<BookFilter, number>;
    for (const f of BOOK_FILTERS) out[f.key] = searched.filter((p) => matchesState(p, stateFilter) && matchesFlip(p, flipFilter, now) && matchesBook(p, f.key)).length;
    return out;
  }, [searched, flipFilter, now, stateFilter]);
  const flipCounts = useMemo(() => {
    const out = {} as Record<FlipFilter, number>;
    for (const f of FLIP_FILTERS) out[f.key] = searched.filter((p) => matchesState(p, stateFilter) && matchesBook(p, bookFilter) && matchesFlip(p, f.key, now)).length;
    return out;
  }, [searched, bookFilter, now, stateFilter]);
  // State counts are taken over the book/call filters (not the state itself), so each chip says how many of THESE
  // opportunities sit in that state, and Unknown is counted rather than hidden.
  const byState = useMemo(
    () => stateCounts(searched.filter((p) => matchesBook(p, bookFilter) && matchesFlip(p, flipFilter, now))),
    [searched, bookFilter, flipFilter, now],
  );
  const visible = useMemo(
    () => sortPolicies(searched.filter((p) => matchesState(p, stateFilter) && matchesBook(p, bookFilter) && matchesFlip(p, flipFilter, now)), sort),
    [searched, bookFilter, flipFilter, sort, now, stateFilter],
  );
  // A state that no longer has anyone under the current filters still shows (as 0) while selected, so the user can see why.
  const stateChips = useMemo(() => {
    const chips = byState.filter((s) => s.code !== STATE_UNKNOWN).slice(0, 12);
    if (stateFilter !== "all" && stateFilter !== STATE_UNKNOWN && !chips.some((c) => c.code === stateFilter)) chips.unshift({ code: stateFilter, count: 0, onFile: 0 });
    return chips;
  }, [byState, stateFilter]);
  const unknownCount = byState.find((s) => s.code === STATE_UNKNOWN)?.count ?? 0;
  const inState = visible.length;

  const countFor = (c: string) => counts.data?.find((x) => x.carrier === c);
  const current = countFor(carrier);
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

  const lastImport = current?.last_imported_at ? shortDate(current.last_imported_at) : "";
  const noKnownStatus = !!current && current.book_active === 0 && current.unknown_status > 0;

  return (
    <div className="mx-auto w-full max-w-5xl px-4 pb-24 pt-4 sm:px-6">
      <PageHeader
        eyebrow="Books"
        title="Work the books"
        subtitle="Call, rewrite, mark resold."
      />

      <nav aria-label="Carrier" className="-mx-4 mb-3 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
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
        Statuses come from the book import{lastImport ? ` on ${lastImport}` : ""}. "Status unknown" means the carrier never sent one.
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
        <div className="flex items-center gap-2 py-10 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" aria-hidden /> Loading {carrier}'s book…</div>
      ) : rows.isError ? (
        <div className="rounded-lg border border-red-400/40 bg-red-500/10 p-4 text-sm">
          <p className="font-semibold text-foreground">Could not load {carrier}'s book.</p>
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
              <PolicyCard key={p.flip_key} p={p} busy={!!busy[p.flip_key]} onSet={setFlip} />
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

function PolicyCard({ p, busy, onSet }: { p: BookPolicy; busy: boolean; onSet: (p: BookPolicy, s: FlipStatus, o?: SetOpts) => Promise<boolean> }) {
  const [panel, setPanel] = useState<"none" | "callback" | "note">("none");
  const [cb, setCb] = useState(defaultCallbackLocal);
  const [note, setNote] = useState("");
  // Phone: native dialer; laptop: Google Voice (the site-wide rule in @/lib/phone).
  const tel = p.do_not_call ? null : phoneHref(p.phone);
  const name = displayName(p.client_name) || "Name missing";
  const { firstName, lastName } = splitName(p);
  const meta = [p.age_years ? `${p.age_years} yrs` : "", stateSourceText(policyState(p)), p.best_time_to_call ? `best time ${p.best_time_to_call}` : ""].filter(Boolean).join(" · ");

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
          <p className="truncate text-lg font-bold text-foreground">{name}</p>
          {meta && <p className="text-sm text-muted-foreground">{meta}</p>}
        </div>
        <span className={cn("shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-semibold", FLIP_TONE[p.flip_status])}>
          {FLIP_LABEL[p.flip_status]}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {p.do_not_call ? (
          <span className="inline-flex items-center gap-1.5 rounded-md border border-red-400/40 bg-red-500/10 px-3 py-2 text-sm font-semibold text-red-700 dark:text-red-300">
            <PhoneOff className="h-4 w-4" aria-hidden /> Do not call
          </span>
        ) : tel ? (
          <a href={tel} {...contactLinkProps(tel)} className="inline-flex h-11 items-center gap-2 rounded-md bg-primary px-4 text-base font-bold text-primary-foreground">
            <Phone className="h-4 w-4" aria-hidden /> {formatPhoneDisplay(p.phone)}
          </a>
        ) : (
          <span className="text-sm text-muted-foreground">No phone on file</span>
        )}
        {p.phone && !p.do_not_call && (
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
        <div>
          <dt className="text-xs text-muted-foreground">Writing agent</dt>
          <dd className="text-foreground">
            {p.agent_name || "—"}
            {p.agent_gone && <span className="ml-1.5 rounded border border-border px-1.5 text-xs text-muted-foreground">left</span>}
            {p.agent_gone && priorityTier(p) < 6 && (
              <span className={cn("ml-1.5 rounded border px-1.5 text-xs font-semibold", PRIORITY_TONE[priorityTier(p)])}>{PRIORITY_LABEL[priorityTier(p)]}</span>
            )}
          </dd>
        </div>
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

      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void onSet(p, "no_answer", { countAttempt: true })}>No answer</Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => setPanel(panel === "callback" ? "none" : "callback")}>
          <CalendarClock className="mr-1 h-4 w-4" aria-hidden /> Callback
        </Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void onSet(p, "appointment", { countAttempt: true })}>Appointment</Button>
        <SubmitDealDialog
          trigger={<Button size="sm" disabled={busy}>Resold</Button>}
          title="Post the new policy"
          description="Posting counts the sale in production and marks this book policy resold."
          initialClient={{ firstName, lastName, phone: p.phone ?? "", dob: p.dob ?? "" }}
          onPosted={(receipt) => void onSet(p, "resold", { countAttempt: true, receipt })}
          secondaryAction={{ label: "Already posted: just mark resold", onClick: () => void onSet(p, "resold", { countAttempt: true }) }}
        />
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void onSet(p, "not_interested", { countAttempt: true })}>Not interested</Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void onSet(p, "bad_number", { countAttempt: true })}>Bad number</Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void onSet(p, "do_not_call")}>Do not call</Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => setPanel(panel === "note" ? "none" : "note")}>
          <StickyNote className="mr-1 h-4 w-4" aria-hidden /> Note
        </Button>
        {p.flip_status !== "to_call" && (
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void onSet(p, "to_call")}>
            <RotateCcw className="mr-1 h-4 w-4" aria-hidden /> Back to call list
          </Button>
        )}
        {busy && <Loader2 className="h-5 w-5 animate-spin self-center text-muted-foreground" aria-label="Saving" />}
      </div>

      {panel === "callback" && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-border p-3">
          <label className="text-sm text-muted-foreground" htmlFor={`cb-${p.flip_key}`}>Call back at</label>
          <input
            id={`cb-${p.flip_key}`}
            type="datetime-local"
            value={cb}
            onChange={(e) => setCb(e.target.value)}
            className="h-10 rounded-md border border-input bg-background px-2 text-base text-foreground"
          />
          <Button
            size="sm"
            disabled={busy || !cb}
            onClick={async () => {
              const at = new Date(cb);
              if (Number.isNaN(at.getTime())) return;
              if (await onSet(p, "callback", { countAttempt: true, callbackAt: at.toISOString() })) setPanel("none");
            }}
          >
            Save callback
          </Button>
        </div>
      )}
      {panel === "note" && (
        <div className="mt-3 flex flex-col gap-2 rounded-lg border border-border p-3">
          <label className="sr-only" htmlFor={`note-${p.flip_key}`}>Note</label>
          <textarea
            id={`note-${p.flip_key}`}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={2000}
            rows={3}
            placeholder="What happened on the call?"
            className="rounded-md border border-input bg-background p-2 text-base text-foreground"
          />
          <Button
            size="sm"
            className="self-start"
            disabled={busy || !note.trim()}
            onClick={async () => {
              // Keep the typed note until the save lands, so a failed save never loses it.
              if (await onSet(p, p.flip_status, { note: note.trim() })) {
                setNote("");
                setPanel("none");
              }
            }}
          >
            Save note
          </Button>
        </div>
      )}
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
