import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  COMMISSION_PAYMENT_LABELS, commissionPaymentState, isDateKey, ledgerSummary,
  paidCommissionTrend, paidYearToDate,
  type CommissionPaymentState, type CommissionRow, type LedgerRow,
} from "@/lib/commissionLedger";

const money = (amount: number) => amount.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const quantity = (count: number, singular: string) => `${count.toLocaleString()} ${singular}${count === 1 ? "" : "s"}`;
const PAYMENT_COLORS: Record<CommissionPaymentState, string> = {
  paid: "bg-emerald-500", pending: "bg-amber-400", unverified: "bg-violet-500",
  closed: "bg-slate-500", clawed_back: "bg-rose-500", estimate_only: "bg-cyan-500",
};
const PAYMENT_BADGES: Record<CommissionPaymentState, string> = {
  paid: "border-emerald-500/40 text-emerald-700 dark:text-emerald-300",
  pending: "border-amber-500/40 text-amber-800 dark:text-amber-300",
  unverified: "border-violet-500/40 text-violet-700 dark:text-violet-300",
  closed: "border-border text-muted-foreground",
  clawed_back: "border-rose-500/40 text-rose-700 dark:text-rose-300",
  estimate_only: "border-cyan-500/40 text-cyan-800 dark:text-cyan-300",
};

/** Presentation only: every amount comes from the caller's validated, scoped ledger. */
export function CommissionOverview({ ledgerRows, todayKey, hiddenLabel = null }: {
  ledgerRows: LedgerRow[]; todayKey: string; hiddenLabel?: string | null;
}) {
  const summary = ledgerSummary(ledgerRows, todayKey);
  const paid = paidYearToDate(ledgerRows, todayKey);
  const metrics = [
    { label: `Commission paid · ${todayKey.slice(0, 4)}`, value: hiddenLabel ?? (paid.count ? money(paid.total) : "Not recorded"), color: "text-emerald-700 dark:text-emerald-300", detail: hiddenLabel ? "Ledger access is incomplete" : paid.count ? quantity(paid.count, "dated ledger payment") : "No dated payments in this ledger for the selected year" },
    { label: "Open commission ledger", value: hiddenLabel ?? (summary.pending.count ? money(summary.pending.total) : "No open records"), color: "text-amber-700 dark:text-amber-300", detail: hiddenLabel ? "Ledger access is incomplete" : `${quantity(summary.pending.count, "open ledger row")}${summary.pending.pastExpectedCount ? ` · ${summary.pending.pastExpectedCount} past expected date` : ""}` },
    { label: "Ledger clawbacks", value: hiddenLabel ?? (summary.clawedBack.count ? money(summary.clawedBack.total) : "Not recorded"), color: "text-rose-700 dark:text-rose-300", detail: hiddenLabel ? "Ledger access is incomplete" : "Carrier-recorded chargebacks are shown in Policy book" },
  ];
  return (
    <section aria-label="Commission payment totals" className="space-y-3">
      <div className="grid min-w-0 gap-3 md:grid-cols-3">
        {metrics.map(metric => <div key={metric.label} className="min-w-0 rounded-xl border-2 border-border bg-card p-5">
          <p className="text-sm font-bold uppercase tracking-wide text-muted-foreground">{metric.label}</p>
          <p className={`galaxy-stat mt-3 break-words text-3xl font-black tabular-nums ${metric.color}`}>{metric.value}</p>
          <p className="mt-3 text-sm text-muted-foreground">{metric.detail}</p>
        </div>)}
      </div>
      <p className="text-sm text-muted-foreground">Recorded ledger amounts. Open rows are calculated bookings; a carrier statement is needed to confirm the amount payable. Missing payment records do not mean no commission was earned.</p>
      {!hiddenLabel && (paid.undatedPaidCount + paid.futureDatedPaidCount > 0 || summary.pendingOnClosedDeals.count > 0) && <p className="text-sm text-muted-foreground">
        {paid.undatedPaidCount > 0 && `${paid.undatedPaidCount} marked paid without a valid payment date. `}
        {paid.futureDatedPaidCount > 0 && `${paid.futureDatedPaidCount} future-dated payment records. `}
        {summary.pendingOnClosedDeals.count > 0 && `${summary.pendingOnClosedDeals.count} pending rows on closed deals. `}
        These are excluded from the paid or open-pending totals.
      </p>}
    </section>
  );
}

/** Real payment dates drive this chart; ledger bookings and production AP never enter it. */
export function CommissionCharts({ ledgerRows, rows, todayKey }: { ledgerRows: LedgerRow[]; rows: CommissionRow[]; todayKey: string }) {
  const trend = useMemo(() => paidCommissionTrend(ledgerRows, todayKey), [ledgerRows, todayKey]);
  const paidCount = trend.reduce((sum, month) => sum + month.count, 0);
  const scale = Math.max(...trend.map(month => Math.abs(month.amount)), 1);
  const hasNegative = trend.some(month => month.amount < 0);
  const baseline = hasNegative ? 50 : 0;
  const maxHeight = hasNegative ? 46 : 92;
  const monthColumns = { gridTemplateColumns: `repeat(${trend.length}, minmax(0, 1fr))` };
  const mix = useMemo(() => {
    const counts = new Map<CommissionPaymentState, number>();
    for (const row of rows) {
      const state = commissionPaymentState(row.ledger, todayKey);
      counts.set(state, (counts.get(state) ?? 0) + 1);
    }
    return Object.entries(COMMISSION_PAYMENT_LABELS).map(([state, label]) => ({ state: state as CommissionPaymentState, label, count: counts.get(state as CommissionPaymentState) ?? 0 })).filter(item => item.count > 0);
  }, [rows, todayKey]);
  return (
    <div className="grid min-w-0 gap-4 lg:grid-cols-[1.5fr_1fr]">
      <section className="min-w-0 rounded-xl border border-border bg-card p-5" aria-label="Recorded payment trend">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="galaxy-heading text-xl font-black italic uppercase">Commission paid by month</h2>
          <p className="text-sm text-muted-foreground">{todayKey.slice(0, 4)} · actual payment date</p>
        </div>
        {paidCount === 0 ? <div className="flex min-h-48 items-center justify-center text-center text-base text-muted-foreground">No dated commission payments recorded this year.</div> : <>
          <div className="mb-4 mt-5 min-w-0" role="img" aria-label={trend.map(month => `${month.label}: ${money(month.amount)} from ${quantity(month.count, "payment")}`).join(", ")}>
            <div className="relative h-44" aria-hidden>
              <div className="absolute inset-x-0 border-t border-border" style={{ bottom: `${baseline}%` }} />
              <div className="absolute inset-0 grid gap-1 sm:gap-2" style={monthColumns}>
                {trend.map(month => <div key={month.key} className="relative min-w-0">
                  <div className={`absolute inset-x-0 mx-auto w-full max-w-8 rounded-sm ${month.amount >= 0 ? "bg-emerald-500" : "bg-rose-500"}`}
                    style={{ height: `${Math.abs(month.amount) / scale * maxHeight}%`, ...(month.amount >= 0 ? { bottom: `${baseline}%` } : { top: `${100 - baseline}%` }) }} />
                </div>)}
              </div>
            </div>
            <div className="mt-2 grid gap-1 text-center text-[10px] text-muted-foreground sm:gap-2 sm:text-xs" style={monthColumns} aria-hidden>
              {trend.map(month => <span key={month.key} className="min-w-0">{month.label}</span>)}
            </div>
          </div>
          <details className="mt-1 text-sm text-muted-foreground">
            <summary className="cursor-pointer font-semibold text-foreground">Monthly amounts</summary>
            <dl className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">{trend.map(month => <div key={month.key}><dt>{month.label}</dt><dd className="font-semibold tabular-nums text-foreground">{money(month.amount)}</dd></div>)}</dl>
          </details>
        </>}
        <p className="mt-3 text-sm text-muted-foreground">Paid ledger entries through today. No pending commissions or premium included.</p>
      </section>
      <section className="min-w-0 rounded-xl border border-border bg-card p-5" aria-label="Commission payment status breakdown">
        <div className="flex flex-wrap items-baseline justify-between gap-2"><h2 className="galaxy-heading text-xl font-black italic uppercase">Payment status</h2><p className="text-sm text-muted-foreground">{rows.length.toLocaleString()} ledger / production rows</p></div>
        {rows.length > 0 ? <div className="mt-5 space-y-4">{mix.map(item => <div key={item.state}>
          <div className="mb-1.5 flex items-center justify-between gap-2 text-sm"><span>{item.label}</span><span className="font-bold tabular-nums">{item.count.toLocaleString()}</span></div>
          <div className="h-2.5 overflow-hidden rounded-full bg-muted" aria-hidden><div className={`h-full rounded-full ${PAYMENT_COLORS[item.state]}`} style={{ width: `${item.count / rows.length * 100}%` }} /></div>
        </div>)}</div> : <p className="mt-6 text-base text-muted-foreground">No commission or production records returned.</p>}
        <p className="mt-4 text-sm text-muted-foreground">Record counts, not dollars. Unmatched rows stay separate.</p>
      </section>
    </div>
  );
}

/** Pure searchable ledger; source percentages and estimates retain their own labels. */
export function CommissionPolicyLedger({ rows, todayKey, ledgerHiddenText = null, hasProduction = true }: {
  rows: CommissionRow[]; todayKey: string; ledgerHiddenText?: string | null; hasProduction?: boolean;
}) {
  const [search, setSearch] = useState("");
  const [payment, setPayment] = useState<"all" | CommissionPaymentState>("all");
  const [visibleCount, setVisibleCount] = useState(100);
  const filtered = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    return rows.filter(row => (payment === "all" || commissionPaymentState(row.ledger, todayKey) === payment) && (!needle ||
      [row.policyNumber, row.clientName, row.carrierName, row.product, row.ledger?.dealStatus, row.estimate?.status].some(value => value?.toLocaleLowerCase().includes(needle))));
  }, [rows, payment, search, todayKey]);
  return (
    <section className="min-w-0 overflow-hidden rounded-xl border border-border bg-card" aria-label="Policy commission ledger">
      <div className="space-y-4 border-b border-border p-4 sm:p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2"><h2 className="galaxy-heading text-2xl font-black italic uppercase">Policy commission ledger</h2><p className="text-sm text-muted-foreground">{filtered.length.toLocaleString()} of {rows.length.toLocaleString()} records</p></div>
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="relative min-w-0 flex-1"><Search aria-hidden className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><Input className="h-11 pl-9 text-base" aria-label="Search policy commissions" placeholder="Policy, product, client or carrier" value={search} onChange={event => { setSearch(event.target.value); setVisibleCount(100); }} /></div>
          <select aria-label="Commission payment status" className="min-h-11 rounded-md border border-input bg-background px-3 text-base text-foreground sm:max-w-64" value={payment} onChange={event => { setPayment(event.target.value as "all" | CommissionPaymentState); setVisibleCount(100); }}>
            <option value="all">All payment statuses</option>{Object.entries(COMMISSION_PAYMENT_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </div>
      </div>
      {filtered.length === 0 ? <p className="p-6 text-base text-muted-foreground">No records match these filters.</p> : <div className="overflow-x-auto">
        <table className="w-full min-w-[1080px] text-sm">
          <caption className="sr-only">Policy product, reported deal status, annual premium, commission amount, payout percentage, payment status and actual payment date. Commission amounts and estimates are separate.</caption>
          <thead className="bg-muted/40"><tr>{["Policy / product", "Reported deal status", "Annual premium", "Commission / estimate", "Payout %", "Payment status", "Payment dates"].map(label => <th key={label} scope="col" className="px-4 py-3 text-left text-sm font-bold uppercase tracking-wide text-muted-foreground">{label}</th>)}</tr></thead>
          <tbody>{filtered.slice(0, visibleCount).map(row => {
            const state = commissionPaymentState(row.ledger, todayKey);
            const ledger = row.ledger;
            const status = ledger?.dealStatus ?? row.estimate?.status;
            return <tr key={row.id} className="border-t border-border align-top">
              <td className="max-w-64 px-4 py-4"><p className="break-words text-base font-bold">{row.product ?? "Product not reported"}</p><p className="mt-1 break-words font-semibold">{row.policyNumber ?? "Policy number not reported"}</p><p className="mt-1 break-words text-muted-foreground">{row.clientName ?? "Client not reported"}</p><p className="text-muted-foreground">{row.carrierName ?? "Carrier not reported"}</p></td>
              <td className="max-w-40 px-4 py-4"><p className="font-semibold">{status ?? "Not reported"}</p><p className="mt-1 text-muted-foreground">Source status; not payment proof</p>{row.businessDate && <p className="mt-2 text-muted-foreground">{row.estimate ? "Posted" : "Booked"} {row.businessDate}</p>}</td>
              <td className="px-4 py-4 font-bold tabular-nums">{row.annualPremium === null ? "Unavailable" : money(row.annualPremium)}</td>
              <td className="px-4 py-4"><p className="font-bold tabular-nums">{ledger ? money(ledger.amount) : ledgerHiddenText ?? "No ledger row"}</p><p className="text-muted-foreground">Recorded commission</p>{ledger && row.annualPremium !== null && ledger.annualPremium !== row.annualPremium && <p className="mt-1 text-muted-foreground">On {money(ledger.annualPremium)} AP</p>}<p className="mt-3 font-semibold tabular-nums">{row.estimate ? row.estimate.amount === null ? "Estimate unavailable" : money(row.estimate.amount) : hasProduction ? "No production estimate" : "Estimate unavailable"}</p>{row.estimate?.amount !== null && row.estimate && <p className="text-muted-foreground">Contract estimate · not paid</p>}</td>
              <td className="max-w-44 px-4 py-4"><p className="font-bold tabular-nums">{ledger?.rateLabel ?? "No recorded payout rate"}</p><p className="mt-3 text-muted-foreground">{row.estimate?.rateLabel ?? "No estimate rate"}</p></td>
              <td className="max-w-48 px-4 py-4"><Badge variant="outline" className={`whitespace-normal text-sm ${PAYMENT_BADGES[state]}`}>{state === "estimate_only" && ledgerHiddenText ? "Ledger unavailable" : COMMISSION_PAYMENT_LABELS[state]}</Badge>{ledger?.status === "paid" && !isDateKey(ledger.actualPaidDate) && <p className="mt-2 text-muted-foreground">Marked paid; payment date missing or invalid</p>}{ledger?.status === "paid" && isDateKey(ledger.actualPaidDate) && ledger.actualPaidDate > todayKey && <p className="mt-2 text-muted-foreground">Future-dated; not counted as paid</p>}{state === "unverified" && ledger?.status !== "paid" && <p className="mt-2 text-muted-foreground">Recorded status: {ledger?.status}</p>}{row.ambiguous && <p className="mt-2 text-muted-foreground">No one-to-one production match</p>}</td>
              <td className="px-4 py-4"><p className="font-semibold tabular-nums">{ledger?.status === "paid" && isDateKey(ledger.actualPaidDate) ? ledger.actualPaidDate : "No confirmed payment"}</p><p className="mt-3 text-muted-foreground">Expected: {isDateKey(ledger?.expectedPaidDate) ? ledger.expectedPaidDate : "Not scheduled"}</p>{state === "pending" && isDateKey(ledger?.expectedPaidDate) && ledger.expectedPaidDate < todayKey && <p className="mt-1 font-semibold text-amber-800 dark:text-amber-300">Past expected date · unpaid</p>}</td>
            </tr>;
          })}</tbody>
        </table>
      </div>}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 text-sm text-muted-foreground">
        <p>Recorded payout rates may differ from your contract estimate. Neither rate confirms a payment.</p>
        {filtered.length > visibleCount && <Button type="button" variant="outline" onClick={() => setVisibleCount(count => count + 100)}>Show 100 more</Button>}
      </div>
    </section>
  );
}
