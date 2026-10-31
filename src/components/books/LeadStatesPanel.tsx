// LeadStatesPanel: "Where to buy leads" on the Book of Business (OVERHAUL-states, 2026-10-30).
//
// Sam: "show what states I should get, in order: where most of our deals are coming from ... I need to rebuy
// [leads] in these states, so I need to know exactly what to get." The panel answers in three layers:
//   1. Buy next: the states to put in the next lead order and how many leads each, with the math in one line
//      and a Copy order button that puts "TX 24, OH 16, ..." on the clipboard for the vendor;
//   2. Avoid (each with its reason) and how many states hold;
//   3. every state in a table (a list on a phone): policies, clients, premium, share still active, the last
//      30 and 90 days and the trend, or, in the Leads view, leads bought, never called, dialed, sales per 100
//      leads dialed and cost per sale at the price Sam types. Every state opens the book filtered to it.
// Every number comes from book_state_summary() / lead_state_yield() through src/lib/leadStates.ts. The states
// add up to the book (the policies with no state are their own row) and the panel says so when they do not.
// Shown to the full-book readers (Sam's admin logins and the book_readers list) only.
import { useMemo, useState, type ReactNode } from "react";
import { Check, ChevronDown, ChevronRight, ClipboardCopy, MapPin } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryState, errorMessage } from "@/components/ui/query-state";
import { ToneBubble, TonePill } from "@/components/ui/delight/ToneBubble";
import { playSoundEffect } from "@/hooks/useSoundEffects";
import { formatAsOf } from "@/lib/queryState";
import { TONE_CLASS } from "@/lib/tones";
import { cn } from "@/lib/utils";
import {
  AVOID_ACTIVE_SHARE,
  DEFAULT_ORDER_SIZE,
  HOLD_BELOW_CUT,
  MIN_DECIDED_FOR_OWN_SHARE,
  MIN_DIALED_FOR_RATE,
  STATE_NOT_KNOWN,
  STATE_ORDERS,
  areaCodeAccuracy,
  buildStateRows,
  costPerSale,
  orderText,
  parseOrderSize,
  parsePrice,
  parseStateOrder,
  rankedByRate,
  recommend,
  sortStateRows,
  splitMath,
  totalsOf,
  type LeadYieldRow,
  type Recommendation,
  type StateOrder,
  type StateRow,
  type StateSummaryRow,
  type Trend,
} from "@/lib/leadStates";

type PanelView = "deals" | "leads";

const PREF = {
  order: "galaxy:lead-states:order",
  view: "galaxy:lead-states:view",
  size: "galaxy:lead-states:order-size",
  price: "galaxy:lead-states:price",
} as const;

function readPref(key: string): string | null {
  try { return window.localStorage.getItem(key); } catch { return null; } // empty-catch-allow:storage-unavailable
}
function writePref(key: string, value: string) {
  try { window.localStorage.setItem(key, value); } catch { /* storage unavailable: the choice lasts for this visit */ } // empty-catch-allow:storage-unavailable
}

const num = (n: number) => n.toLocaleString("en-US");
const share = (n: number | null) => (n === null ? "—" : `${Math.round(n * 100)}%`);
function money(n: number | null, compact = false): string {
  if (n === null || !Number.isFinite(n)) return "—";
  if (compact && Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (compact && Math.abs(n) >= 10_000) return `$${Math.round(n / 1000).toLocaleString("en-US")}K`;
  return `$${Math.round(n).toLocaleString("en-US")}`;
}
const per100 = (n: number | null) => (n === null ? "—" : n >= 10 ? n.toFixed(0) : n.toFixed(1));

/** The trend in words for a screen reader, and an arrow and a number for the eye. Up is the good tone; down
 *  and flat stay quiet, because a drop across every state at once is usually the data, not the states. */
function TrendText({ trend }: { trend: Trend }) {
  if (trend.kind === "none") return <span className="text-muted-foreground">—</span>;
  const words = trend.kind === "up" ? `up ${trend.pct}%` : trend.kind === "down" ? `down ${Math.abs(trend.pct ?? 0)}%` : trend.kind === "flat" ? "about the same" : "new in the last 90 days";
  const shown = trend.kind === "up" ? `↑ ${trend.pct}%` : trend.kind === "down" ? `↓ ${Math.abs(trend.pct ?? 0)}%` : trend.kind === "flat" ? "≈ same" : "new";
  const tone = trend.kind === "up" ? TONE_CLASS.good.text : trend.kind === "new" ? TONE_CLASS.cool.text : "text-foreground";
  return (
    <span className={cn("whitespace-nowrap font-semibold", tone)} aria-label={words} title={words}>
      <span aria-hidden>{shown}</span>
    </span>
  );
}

type Verdict = { kind: "buy"; leads: number } | { kind: "hold"; reason: string } | { kind: "avoid"; reason: string } | { kind: "none" };

function verdictFor(rec: Recommendation | null, code: string | null): Verdict {
  if (!rec || !code) return { kind: "none" };
  const b = rec.buy.find((x) => x.code === code);
  if (b) return { kind: "buy", leads: b.leads };
  const a = rec.avoid.find((x) => x.code === code);
  if (a) return { kind: "avoid", reason: a.reason };
  const h = rec.hold.find((x) => x.code === code);
  if (h) return { kind: "hold", reason: h.reason };
  return { kind: "none" };
}

/** The reason worth printing on a row: every Avoid reason, and a Hold reason other than the common one. */
function rowReason(v: Verdict): string | null {
  if (v.kind === "avoid") return v.reason;
  if (v.kind === "hold" && v.reason !== HOLD_BELOW_CUT) return v.reason;
  return null;
}

function VerdictPill({ verdict }: { verdict: Verdict }) {
  if (verdict.kind === "none") return <span className="text-muted-foreground">—</span>;
  if (verdict.kind === "buy") return <TonePill tone="good" dot className="whitespace-nowrap">Buy {num(verdict.leads)}</TonePill>;
  if (verdict.kind === "avoid") return <span title={verdict.reason}><TonePill tone="hot" dot className="whitespace-nowrap">Avoid</TonePill></span>;
  return <span title={verdict.reason}><TonePill tone="slate" className="whitespace-nowrap">Hold</TonePill></span>;
}

export interface LeadStatesPanelProps {
  /** book_state_summary() rows, already checked; null while loading or after a failed read with nothing to show. */
  summary: StateSummaryRow[] | null;
  summaryLoading: boolean;
  summaryError: unknown;
  summaryUpdatedAt: number;
  onRetrySummary: () => void;
  /** lead_state_yield() rows; null while loading or failed. */
  leads: LeadYieldRow[] | null;
  leadsLoading: boolean;
  leadsError: unknown;
  onRetryLeads: () => void;
  /** Every policy the board above counts, to prove the states add up to it. */
  bookTotal: number | null;
  /** The state the list below is showing ("TX", "unknown"), or null. */
  selectedState: string | null;
  onOpenState: (code: string) => void;
}

const VISIBLE_STATES = 10;
const AVOID_ON_PHONE = 3;
/** The Leads view's six number columns, named so a loading row's placeholders keep stable keys. */
const LEAD_COLUMNS = ["bought", "never-dialed", "dialed", "sales", "per-100", "cost"] as const;
const NUM_CELL = "whitespace-nowrap px-3 py-2 text-right tabular-nums";
const HEAD_CELL = "whitespace-nowrap px-3 py-2.5 text-right font-semibold";

export function LeadStatesPanel(props: LeadStatesPanelProps) {
  const { summary, summaryLoading, summaryError, summaryUpdatedAt, onRetrySummary, leads, leadsLoading, leadsError, onRetryLeads, bookTotal, selectedState, onOpenState } = props;
  const [order, setOrderState] = useState<StateOrder>(() => parseStateOrder(readPref(PREF.order)));
  const [view, setViewState] = useState<PanelView>(() => (readPref(PREF.view) === "leads" ? "leads" : "deals"));
  const [sizeText, setSizeText] = useState<string>(() => String(parseOrderSize(readPref(PREF.size) ?? DEFAULT_ORDER_SIZE)));
  const [priceText, setPriceText] = useState<string>(() => readPref(PREF.price) ?? "");
  const [showAll, setShowAll] = useState(false);
  const [showAllAvoid, setShowAllAvoid] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyFallback, setCopyFallback] = useState<string | null>(null);

  const setOrder = (o: StateOrder) => { setOrderState(o); writePref(PREF.order, o); };
  const setView = (v: PanelView) => { setViewState(v); writePref(PREF.view, v); };
  const orderSize = parseOrderSize(sizeText);
  const price = parsePrice(priceText);

  const rows = useMemo(() => (summary ? buildStateRows(summary, leads) : null), [summary, leads]);
  const rec = useMemo(() => (rows ? recommend(rows, orderSize) : null), [rows, orderSize]);
  const totals = useMemo(() => (rows ? totalsOf(rows) : null), [rows]);
  const sorted = useMemo(() => (rows ? sortStateRows(rows, order) : []), [rows, order]);
  const area = useMemo(() => areaCodeAccuracy(leads), [leads]);
  const known = sorted.filter((r) => r.code !== null);
  const unknownRow = sorted.find((r) => r.code === null) ?? null;
  const visibleKnown = showAll ? known : known.slice(0, VISIBLE_STATES);
  // A selected state below the cut stays visible, so the row the list is showing is never hidden.
  const selectedHidden = !showAll && selectedState && selectedState !== STATE_NOT_KNOWN ? known.find((r) => r.code === selectedState && !visibleKnown.includes(r)) ?? null : null;
  const shownRows = [...visibleKnown, ...(selectedHidden ? [selectedHidden] : []), ...(unknownRow ? [unknownRow] : [])];
  const leadsView = view === "leads";
  const totalsMismatch = totals !== null && bookTotal !== null && totals.policies !== bookTotal;
  const order1 = rec ? orderText(rec.buy) : "";
  const math = rec ? splitMath(rec) : null;
  const neverCalledTotal = rows?.reduce((a, r) => a + (r.code ? r.leads?.neverCalled ?? 0 : 0), 0) ?? 0;
  const topBuy = rec?.buy[0] ? rows?.find((r) => r.code === rec.buy[0].code) ?? null : null;
  const callsSince = leads?.find((l) => l.calls_since)?.calls_since ?? null;
  const listsLoaded = leads?.find((l) => l.lists_loaded)?.lists_loaded ?? null;

  const copyOrder = async () => {
    if (!order1) return;
    try {
      await navigator.clipboard.writeText(order1);
      playSoundEffect("pop");
      setCopied(true);
      setCopyFallback(null);
      toast.success(`Copied: ${order1}`);
      window.setTimeout(() => setCopied(false), 2400);
    } catch (err) {
      // The browser refused the clipboard: show the order selected, so a long-press or Cmd+C copies it.
      console.warn("clipboard blocked", err);
      setCopyFallback(order1);
      toast.error("This browser blocked copying. The order is selected below: copy it from there.");
    }
  };

  const openRow = (r: StateRow) => onOpenState(r.code ?? STATE_NOT_KNOWN);
  const isSelected = (r: StateRow) => (r.code ?? STATE_NOT_KNOWN) === selectedState;

  if (!rows || rows.length === 0) {
    return (
      <Card aria-labelledby="lead-states-title">
        <PanelHeader />
        <CardContent>
          <QueryState
            status={!rows ? (summaryLoading ? "loading" : "error") : "empty"}
            label="the states"
            error={summaryError}
            onRetry={onRetrySummary}
            compact={Boolean(rows)}
            title="No policies on the book yet, so there are no states to rank."
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card aria-labelledby="lead-states-title">
      <PanelHeader />
      <CardContent className="space-y-4">
        {summaryError ? (
          <p role="status" className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-[13px] text-muted-foreground">
            These states are from {formatAsOf(summaryUpdatedAt) || "the last read"}. The latest read failed: {errorMessage(summaryError)}
            <Button type="button" size="sm" variant="ghost" className="h-9" onClick={onRetrySummary}>Try again</Button>
          </p>
        ) : null}

        {/* 1. Buy next */}
        <section aria-labelledby="buy-next-title" className="rounded-xl border border-tone-good/35 bg-tone-good/8 p-3 sm:p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h4 id="buy-next-title" className="flex flex-wrap items-center gap-2 text-[15px] font-semibold text-foreground">
              <TonePill tone="good" dot>Buy next</TonePill>
              <span className="font-normal text-muted-foreground">
                {rec && rec.buy.length ? `${rec.buy.length} ${rec.buy.length === 1 ? "state" : "states"} · ${num(rec.orderSize)} leads` : "Nothing to buy yet"}
              </span>
            </h4>
            <div className="flex items-center gap-2">
              <label htmlFor="lead-order-size" className="text-[13px] font-semibold text-muted-foreground">
                <span className="sm:hidden">Leads</span>
                <span className="hidden sm:inline">Leads in the order</span>
              </label>
              <Input
                id="lead-order-size"
                type="number"
                inputMode="numeric"
                min={1}
                step={10}
                value={sizeText}
                onChange={(e) => { setSizeText(e.target.value); writePref(PREF.size, String(parseOrderSize(e.target.value))); }}
                onBlur={() => setSizeText(String(orderSize))}
                className="h-11 w-20 text-base tabular-nums sm:h-9 sm:w-24"
              />
              <Button type="button" variant="outline" className="h-11 gap-2 sm:h-9" onClick={() => void copyOrder()} disabled={!order1}>
                {copied ? <Check aria-hidden /> : <ClipboardCopy aria-hidden />}
                {copied ? "Copied" : "Copy order"}
              </Button>
            </div>
          </div>
          {rec && rec.buy.length ? (
            <>
              <ul className="mt-3 flex flex-wrap gap-2" aria-label="States to buy and how many leads">
                {rec.buy.map((b) => (
                  <li key={b.code}>
                    <button
                      type="button"
                      onClick={() => onOpenState(b.code)}
                      aria-pressed={selectedState === b.code}
                      title={`${b.name}: ${b.last90} ${b.last90 === 1 ? "deal" : "deals"} in the last 90 days, ${share(b.share)} still active${b.ownShare ? "" : " (the agency's share: fewer than 10 decided here)"}. Opens its policies below.`}
                      className={cn(
                        "apex-lift inline-flex h-11 min-w-[4.75rem] items-center justify-between gap-2 rounded-lg border bg-card px-3 text-left hover:bg-muted/40 focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)] sm:h-10",
                        selectedState === b.code ? "border-tone-good bg-tone-good/12" : "border-tone-good/35",
                      )}
                    >
                      <span className="text-[15px] font-bold text-foreground">{b.code}</span>
                      <span className="text-[15px] font-semibold tabular-nums text-tone-good">{num(b.leads)}</span>
                    </button>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-[13px] leading-[18px] text-muted-foreground">
                <span className="font-semibold text-foreground">How it splits:</span> deals in the last 90 days × the share still active.
                {math ? <> <span className="font-semibold text-foreground sm:whitespace-nowrap">{math}</span>.</> : null}
              </p>
              <p className="mt-1 text-[13px] leading-[18px] text-muted-foreground">
                A state with fewer than {MIN_DECIDED_FOR_OWN_SHARE} policies decided uses the agency's {share(rec.agencyShare)}
                {rec.licensingApplied ? "; a state needs an active agent licensed there or selling there in the last 180 days" : ""}.
              </p>
              {topBuy?.leads && neverCalledTotal > 0 ? (
                <p className="mt-1 text-[13px] leading-[18px] text-muted-foreground">
                  Already on hand: <span className="font-semibold text-foreground">{num(neverCalledTotal)}</span> bought leads never dialed
                  {topBuy.leads.neverCalled > 0 ? <>, {num(topBuy.leads.neverCalled)} of them in {topBuy.name}</> : null}.
                </p>
              ) : null}
              {copyFallback ? (
                <Input readOnly aria-label="The order to copy" value={copyFallback} autoFocus onFocus={(e) => e.currentTarget.select()} className="mt-3 h-11 text-base" />
              ) : null}
            </>
          ) : (
            <p className="mt-2 text-[13px] text-muted-foreground">No state has a deal in the last 90 days, so there is nothing to split yet.</p>
          )}
        </section>

        {/* 2. Avoid and Hold */}
        {rec && (rec.avoid.length > 0 || rec.hold.length > 0) ? (
          <div className="space-y-3">
            {rec.avoid.length > 0 ? (
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
                <TonePill tone="hot" dot className="shrink-0 self-start sm:mt-1.5">Avoid</TonePill>
                <ul id="avoid-states" className="flex min-w-0 flex-1 flex-wrap gap-1.5" aria-label="States to avoid">
                  {rec.avoid.map((a, i) => (
                    // A phone shows the first few; the rest open with "more", so the reasons stay readable.
                    <li key={a.code} className={cn("max-w-full", i >= AVOID_ON_PHONE && !showAllAvoid && "hidden sm:block")}>
                      <button
                        type="button"
                        onClick={() => onOpenState(a.code)}
                        aria-pressed={selectedState === a.code}
                        className={cn(
                          "inline-flex min-h-10 max-w-full items-center gap-1.5 rounded-md border px-2.5 py-1 text-left text-[13px] leading-[18px] hover:bg-muted/40 focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)]",
                          selectedState === a.code ? "border-tone-hot bg-tone-hot/12" : "border-border bg-card",
                        )}
                      >
                        <span className="font-bold text-foreground">{a.code}</span>
                        <span className="text-muted-foreground">{a.reason}</span>
                      </button>
                    </li>
                  ))}
                  {rec.avoid.length > AVOID_ON_PHONE ? (
                    <li className="sm:hidden">
                      <Button type="button" variant="ghost" size="sm" className="h-10" aria-expanded={showAllAvoid} aria-controls="avoid-states" onClick={() => setShowAllAvoid((v) => !v)}>
                        {showAllAvoid ? "Fewer" : `${rec.avoid.length - AVOID_ON_PHONE} more`}
                      </Button>
                    </li>
                  ) : null}
                </ul>
              </div>
            ) : null}
            {rec.hold.length > 0 ? (
              <div className="flex flex-col gap-2 text-[13px] leading-[18px] text-muted-foreground sm:flex-row sm:items-center">
                <TonePill tone="slate" className="shrink-0 self-start sm:self-auto">Hold</TonePill>
                <span>
                  {rec.hold.length === 1 ? "1 state" : `${rec.hold.length} states`}: most have fewer recent deals than the ones to buy; any other reason is on its row.
                </span>
              </div>
            ) : null}
          </div>
        ) : null}

        {/* 3. Every state */}
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-[15px] font-semibold text-foreground">Every state</h4>
            <div className="flex flex-wrap items-center gap-2">
              <div role="group" aria-label="What the table shows" className="inline-flex rounded-md border border-border bg-card p-0.5">
                {(["deals", "leads"] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    aria-pressed={view === v}
                    onClick={() => setView(v)}
                    className={cn(
                      "h-10 rounded-[8px] px-3 text-sm font-semibold focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)] sm:h-8",
                      view === v ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {v === "deals" ? "Deals" : "Leads"}
                  </button>
                ))}
              </div>
              <Select value={order} onValueChange={(v) => setOrder(parseStateOrder(v))}>
                <SelectTrigger aria-label="Order the states" className="h-11 w-auto min-w-[11rem] gap-2 sm:h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATE_ORDERS.map((o) => (
                    <SelectItem key={o.key} value={o.key}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {order === "per_lead" ? (
            <p className="text-[13px] leading-[18px] text-muted-foreground">
              States with {num(MIN_DIALED_FOR_RATE)} or more leads dialed rank by sales per 100 leads dialed; the rest rank by deals, because a few calls make the rate swing.
            </p>
          ) : null}
          {leadsView ? (
            <LeadsNotice loading={leadsLoading && !leads} error={leads ? null : leadsError} onRetry={onRetryLeads} priceText={priceText} onPrice={(v) => { setPriceText(v); writePref(PREF.price, v); }} />
          ) : null}

          {/* Phones: one row per state, the whole row a button. */}
          <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border md:hidden" aria-label="States">
            {shownRows.map((r) => {
              const verdict = verdictFor(rec, r.code);
              const reason = rowReason(verdict);
              return (
                <li key={r.code ?? STATE_NOT_KNOWN}>
                  <button
                    type="button"
                    onClick={() => openRow(r)}
                    aria-pressed={isSelected(r)}
                    className={cn("flex w-full min-w-0 items-start gap-3 px-3 py-3 text-left hover:bg-muted/40 focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)]", isSelected(r) && "bg-primary/8")}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="text-[15px] font-semibold text-foreground">{r.code ? `${r.code} · ${r.name}` : r.name}</span>
                        {r.code ? <VerdictPill verdict={verdict} /> : null}
                      </span>
                      <span className="mt-1 block text-[13px] leading-[18px] text-muted-foreground">
                        {leadsView ? leadsLine(r, price, leadsLoading && !leads) : dealsLine(r)}
                      </span>
                      {reason ? <span className="mt-0.5 block text-[13px] leading-[18px] text-muted-foreground">{reason}</span> : null}
                    </span>
                    <span className="flex shrink-0 items-center gap-1">
                      <span className="text-right">
                        <span className="block text-[15px] font-semibold tabular-nums text-foreground">{num(r.policies)}</span>
                        <span className="block text-[13px] leading-4 text-muted-foreground">{r.policies === 1 ? "policy" : "policies"}</span>
                      </span>
                      <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden />
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          {/* Wider screens: a table. The state's name is the button; the row is a target too. */}
          <div className="hidden overflow-x-auto rounded-lg border border-border md:block">
            <table className="w-full min-w-[760px] text-sm">
              <caption className="sr-only">Policies by the client's state{leadsView ? ", with the lead lists" : ""}. Choose a state to list its policies.</caption>
              <thead className="bg-muted/30 text-[13px] text-muted-foreground">
                <tr className="border-b border-border">
                  <th scope="col" className="px-3 py-2.5 text-left font-semibold">State</th>
                  <th scope="col" className={HEAD_CELL} title="Every policy on the book for clients in this state">Policies</th>
                  {leadsView ? (
                    <>
                      <th scope="col" className={HEAD_CELL} title="Leads in the lead lists with this state">Bought</th>
                      <th scope="col" className={HEAD_CELL} title="Bought leads the dialer has no call on record for">Never dialed</th>
                      <th scope="col" className={HEAD_CELL} title="Numbers the dialer called, by the state on the list, else the area code">Dialed</th>
                      <th scope="col" className={HEAD_CELL} title="Book policies sold to a dialed number on or after its first call">Sales</th>
                      <th scope="col" className={HEAD_CELL} title="Sales per 100 leads dialed">Per 100</th>
                      <th scope="col" className={HEAD_CELL} title="What one sale costs at your price per lead, if every lead you buy gets dialed">Cost a sale</th>
                    </>
                  ) : (
                    <>
                      <th scope="col" className={HEAD_CELL} title="Different clients">Clients</th>
                      <th scope="col" className={HEAD_CELL} title="Annual premium of these policies, and the average per policy">Premium</th>
                      <th scope="col" className={HEAD_CELL} title="Of the policies with an outcome (active, lapsing or gone), the share still active. Pending and no-status policies are not counted.">Still active</th>
                      <th scope="col" className={HEAD_CELL} title="Policies posted in the last 30 days">30 days</th>
                      <th scope="col" className={HEAD_CELL} title="Policies posted in the last 90 days">90 days</th>
                      <th scope="col" className={HEAD_CELL} title="The last 90 days against the 90 before them">Trend</th>
                    </>
                  )}
                  <th scope="col" className="whitespace-nowrap px-3 py-2.5 text-left font-semibold">Next order</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {shownRows.map((r) => {
                  const verdict = verdictFor(rec, r.code);
                  const reason = rowReason(verdict);
                  return (
                    <tr
                      key={r.code ?? STATE_NOT_KNOWN}
                      onClick={() => openRow(r)}
                      className={cn("cursor-pointer hover:bg-muted/40", isSelected(r) && "bg-primary/8", r.code === null && "bg-muted/20")}
                    >
                      <th scope="row" className="px-3 py-2 text-left font-normal">
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); openRow(r); }}
                          aria-pressed={isSelected(r)}
                          className="inline-flex min-h-9 items-center gap-2 whitespace-nowrap rounded-md text-left focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)]"
                        >
                          {r.code ? <span className="w-7 text-[15px] font-bold text-foreground">{r.code}</span> : null}
                          <span className={cn("text-sm", r.code ? "text-foreground" : "font-semibold text-foreground")}>{r.name}</span>
                        </button>
                        {r.code && r.policies > 0 ? (
                          <span className="block whitespace-nowrap pl-9 text-[13px] text-muted-foreground">{r.onFile === r.policies ? "all on file" : r.onFile === 0 ? "by area code" : `${num(r.onFile)} on file`}</span>
                        ) : r.code === null && r.noClient > 0 ? (
                          <span className="block whitespace-nowrap text-[13px] text-muted-foreground">{num(r.noClient)} agency totals</span>
                        ) : null}
                      </th>
                      <td className={cn(NUM_CELL, "font-semibold text-foreground")}>{num(r.policies)}</td>
                      {leadsView ? (
                        <LeadCells row={r} loading={leadsLoading && !leads} price={price} />
                      ) : (
                        <>
                          <td className={NUM_CELL}>{num(r.clients)}</td>
                          <td className={NUM_CELL}>
                            <span className="font-semibold text-foreground">{money(r.premium, true)}</span>
                            {r.avgPremium !== null ? <span className="block text-[13px] text-muted-foreground">{money(r.avgPremium)} avg</span> : null}
                          </td>
                          <td className={NUM_CELL} title={r.decided ? `${r.active} of ${r.decided} with an outcome are active` : "No policy here has an outcome yet"}>
                            <span className={cn("font-semibold", r.decided >= MIN_DECIDED_FOR_OWN_SHARE && r.activeShare !== null && r.activeShare < AVOID_ACTIVE_SHARE ? TONE_CLASS.hot.text : "text-foreground")}>{share(r.activeShare)}</span>
                            {r.decided ? <span className="block text-[13px] text-muted-foreground">{r.active} of {r.decided}</span> : null}
                          </td>
                          <td className={NUM_CELL}>{num(r.last30)}</td>
                          <td className={NUM_CELL}>{num(r.last90)}</td>
                          <td className={NUM_CELL} title={`${r.last90} in the last 90 days, ${r.prior90} in the 90 before`}><TrendText trend={r.trend} /></td>
                        </>
                      )}
                      <td className="min-w-[13rem] px-3 py-2 text-left">
                        <VerdictPill verdict={verdict} />
                        {reason ? <span className="mt-0.5 block max-w-[16rem] text-[13px] leading-[18px] text-muted-foreground">{reason}</span> : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="border-t border-border bg-muted/30 text-[13px]">
                <tr>
                  <th scope="row" className="px-3 py-2.5 text-left font-semibold text-foreground">Every policy</th>
                  <td className={cn(NUM_CELL, "font-bold text-foreground")}>{num(totals?.policies ?? 0)}</td>
                  <td colSpan={7} className="px-3 py-2.5 text-left text-muted-foreground">
                    {totalsMismatch ? `The board above counts ${num(bookTotal ?? 0)}: these were read at a different moment.` : bookTotal !== null ? "The same total as the board above." : null}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            {known.length > VISIBLE_STATES ? (
              <Button type="button" variant="ghost" size="sm" className="h-11 gap-1.5 sm:h-9" aria-expanded={showAll} onClick={() => setShowAll((v) => !v)}>
                <ChevronDown className={cn("h-4 w-4 transition-transform", showAll && "rotate-180")} aria-hidden />
                {showAll ? `Show the top ${VISIBLE_STATES}` : `Show all ${known.length} states`}
              </Button>
            ) : <span />}
            <p className="text-[13px] leading-[18px] text-muted-foreground md:hidden">
              Every policy: <span className="font-semibold text-foreground">{num(totals?.policies ?? 0)}</span>
              {totalsMismatch ? `. The board above counts ${num(bookTotal ?? 0)}: these were read at a different moment.` : bookTotal !== null ? ", the same as the board." : "."}
            </p>
          </div>
        </div>

        {/* How the numbers are known */}
        {totals && totals.policies > 0 ? (
          <div className="space-y-1.5 border-t border-border pt-3 text-[13px] leading-[18px] text-muted-foreground">
            <p>
              <span className="font-semibold text-foreground">How a state is known.</span> {num(totals.onFile)} on file (client record, sold call or the lead list the number was bought on);{" "}
              {num(totals.byAreaCode)} likely, by the phone's area code{area ? <> (it names the lead list's state for {share(area.matched / area.checked)} of {num(area.checked)} leads)</> : null};{" "}
              {num(totals.notKnown)} not known{totals.notKnownNoClient > 0 ? <> ({num(totals.notKnownNoClient)} reported as agency totals with no client)</> : null}.
            </p>
            {totals.last90NotKnown > 0 ? (
              <p>
                {num(totals.last90NotKnown)} of the {num(totals.last90)} policies in the last 90 days have no state, so every state's recent numbers read low by about the same share.
              </p>
            ) : null}
            {leadsView && (callsSince || listsLoaded) ? (
              <p>
                {listsLoaded ? <>Lead lists last loaded {formatDay(listsLoaded)}. </> : null}
                {callsSince ? <>Dialer calls since {formatDay(callsSince)}. </> : null}
                No lead price is on file, so cost a sale uses the price you type.
              </p>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function PanelHeader() {
  return (
    <CardHeader className="flex-row items-start gap-3 space-y-0">
      <ToneBubble tone="gold" size="md"><MapPin /></ToneBubble>
      <div className="min-w-0">
        <CardTitle id="lead-states-title" className="text-base">Where to buy leads</CardTitle>
        <CardDescription className="mt-0.5">Where your deals come from, which ones stay on the books, and how to split the next lead order.</CardDescription>
      </div>
    </CardHeader>
  );
}

function formatDay(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function dealsLine(r: StateRow): ReactNode {
  return (
    <>
      {num(r.last90)} in 90 days{r.trend.kind !== "none" ? <> <TrendText trend={r.trend} /></> : null} · {share(r.activeShare)} still active · {money(r.premium, true)}
    </>
  );
}

function leadsLine(r: StateRow, price: number | null, loading: boolean): ReactNode {
  if (loading) return <Skeleton className="h-4 w-48" />;
  if (!r.leads) return <>The lead lists did not load.</>;
  const cost = costPerSale(price, r.leads);
  return (
    <>
      {num(r.leads.dialed)} dialed · {num(r.leads.sales)} {r.leads.sales === 1 ? "sale" : "sales"}
      {r.leads.per100 !== null ? <> · <span className={cn(rankedByRate(r) ? "font-semibold text-foreground" : undefined)}>{per100(r.leads.per100)} per 100</span></> : null}
      {" · "}{num(r.leads.neverCalled)} never dialed
      {cost !== null ? <> · {money(cost)} a sale</> : null}
    </>
  );
}

function LeadCells({ row, loading, price }: { row: StateRow; loading: boolean; price: number | null }) {
  if (loading) {
    return (
      <>
        {LEAD_COLUMNS.map((col) => (
          <td key={col} className="px-3 py-2 text-right"><Skeleton className="ml-auto h-4 w-12" /></td>
        ))}
      </>
    );
  }
  const l = row.leads;
  const cost = costPerSale(price, l);
  return (
    <>
      <td className={NUM_CELL}>{l ? num(l.bought) : "—"}</td>
      <td className={NUM_CELL}>{l ? num(l.neverCalled) : "—"}</td>
      <td className={NUM_CELL}>{l ? num(l.dialed) : "—"}</td>
      <td className={NUM_CELL}>{l ? num(l.sales) : "—"}</td>
      <td className={NUM_CELL} title={l && !rankedByRate(row) && l.dialed > 0 ? `Fewer than ${num(MIN_DIALED_FOR_RATE)} dialed: too few to rank on` : undefined}>
        <span className={cn(l && rankedByRate(row) ? "font-semibold text-foreground" : "text-muted-foreground")}>{l ? per100(l.per100) : "—"}</span>
      </td>
      <td className={NUM_CELL}>{cost !== null ? money(cost) : "—"}</td>
    </>
  );
}

function LeadsNotice({ loading, error, onRetry, priceText, onPrice }: { loading: boolean; error: unknown; onRetry: () => void; priceText: string; onPrice: (v: string) => void }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-muted/30 px-3 py-2">
      {loading ? (
        <span role="status" className="text-[13px] text-muted-foreground">Reading the lead lists and the dialer…</span>
      ) : error ? (
        <span role="alert" className="flex flex-wrap items-center gap-2 text-[13px] text-destructive">
          The lead lists did not load: {errorMessage(error)}
          <Button type="button" size="sm" variant="outline" className="h-9" onClick={onRetry}>Try again</Button>
        </span>
      ) : (
        <span className="text-[13px] leading-[18px] text-muted-foreground">Dialed and sales count every number the dialer called, by the state on its list, else its area code.</span>
      )}
      <span className="flex items-center gap-2">
        <label htmlFor="lead-price" className="text-[13px] font-semibold text-muted-foreground">Price per lead</label>
        <span className="relative">
          <span aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
          <Input id="lead-price" inputMode="decimal" placeholder="0.00" value={priceText} onChange={(e) => onPrice(e.target.value)} className="h-11 w-24 pl-6 text-base tabular-nums sm:h-9" />
        </span>
      </span>
    </div>
  );
}
