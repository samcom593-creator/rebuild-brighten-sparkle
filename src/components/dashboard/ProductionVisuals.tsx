import { EyeOff } from "lucide-react";

import "./dashboard-content.css";

const money = (value: number) => new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD", maximumFractionDigits: 0,
}).format(value);

export interface ProductionMixRow {
  label: string;
  ap: number;
  policies: number;
}

/** Already-scoped, non-overlapping hierarchy groups from the scoreboard response. */
export function ProductionMixChart({ rows, hidden = false }: {
  rows: ProductionMixRow[];
  hidden?: boolean;
}) {
  // Hide the shape too: a bar or percentage can disclose a hidden amount even
  // when its dollar label is blurred for a screenshot.
  if (hidden) return <ChartHidden label="Production breakdown hidden for presenting" />;
  if (rows.length === 0) return <p className="mt-3 text-sm text-muted-foreground">No production in this window.</p>;
  if (rows.some((row) => !Number.isFinite(row.ap) || row.ap < 0)) {
    return <p className="mt-3 text-sm text-muted-foreground">The production chart is unavailable for this result. Individual amounts remain in Who sold.</p>;
  }
  const largest = Math.max(...rows.map((row) => row.ap));
  return (
    <div className="production-mix-chart">
      <p className="production-chart-caption">ALP by hierarchy · same selected dates</p>
      <ul aria-label="Production by hierarchy chart" className="production-mix-chart__rows">
        {rows.map((row) => (
          <li key={row.label} className="production-mix-chart__row">
            <div className="production-mix-chart__labels">
              <span className="production-mix-chart__name">{row.label}</span>
              <span className="production-mix-chart__amount">{money(row.ap)}</span>
            </div>
            <div className="production-mix-chart__track" aria-hidden="true">
              <span data-empty={row.ap === 0} style={{ width: `${largest > 0 ? row.ap / largest * 100 : 0}%` }} />
            </div>
            <span className="production-mix-chart__policies">{row.policies.toLocaleString()} {row.policies === 1 ? "policy" : "policies"}</span>
          </li>
        ))}
      </ul>
      {largest === 0 && <p className="production-chart-caption">No ALP recorded in this window.</p>}
    </div>
  );
}

/** Direct and override come from the same existing earnings estimate, never paid cash. */
export function EarningsMixChart({ direct, override, hidden = false }: {
  direct: number;
  override: number;
  hidden?: boolean;
}) {
  if (hidden) return <ChartHidden label="Earnings breakdown hidden for presenting" />;
  if (![direct, override].every((value) => Number.isFinite(value) && value >= 0)) {
    return <p className="mt-3 text-sm text-muted-foreground">The earnings chart is unavailable for this result. Read the estimate amounts below.</p>;
  }
  const total = direct + override;
  if (total === 0) return <p className="mt-3 text-sm text-muted-foreground">No estimated earnings in this window.</p>;
  const directShare = direct / total * 100;
  const overrideShare = 100 - directShare;
  return (
    <div className="earnings-mix-chart">
      <svg
        viewBox="0 0 120 120"
        className="earnings-mix-chart__ring"
        role="img"
        aria-label={`Estimated earnings split: direct ${money(direct)}, override ${money(override)}. Estimates, not paid commissions.`}
      >
        <circle cx="60" cy="60" r="46" pathLength="100" className="earnings-mix-chart__base" />
        <circle cx="60" cy="60" r="46" pathLength="100" className="earnings-mix-chart__direct" strokeDasharray={`${directShare} ${100 - directShare}`} />
        <circle cx="60" cy="60" r="46" pathLength="100" className="earnings-mix-chart__override" strokeDasharray={`${overrideShare} ${100 - overrideShare}`} strokeDashoffset={-directShare} />
      </svg>
      <div className="earnings-mix-chart__legend">
        <p><span className="earnings-mix-chart__key earnings-mix-chart__key--direct" aria-hidden="true" /><span>Direct</span><strong>{directShare.toFixed(0)}%</strong></p>
        <p><span className="earnings-mix-chart__key earnings-mix-chart__key--override" aria-hidden="true" /><span>Override</span><strong>{overrideShare.toFixed(0)}%</strong></p>
        <span className="production-chart-caption">Estimated split · not paid commissions</span>
      </div>
    </div>
  );
}

/** Each pair compares one metric with its prior period, not different funnel cohorts. */
export function PeriodComparisonBars({ current, previous }: { current: number | null; previous: number | null }) {
  if (current === null || previous === null || !Number.isFinite(current) || !Number.isFinite(previous) || current < 0 || previous < 0) return null;
  const largest = Math.max(current, previous);
  return (
    <svg
      className="conversion-comparison-bars"
      viewBox="0 0 100 18"
      preserveAspectRatio="none"
      aria-hidden="true"
      data-current={current}
      data-previous={previous}
    >
      <rect width="100" height="6" className="conversion-comparison-bars__track" />
      <rect width={largest > 0 ? current / largest * 100 : 0} height="6" className="conversion-comparison-bars__current" />
      <rect y="12" width="100" height="6" className="conversion-comparison-bars__track" />
      <rect y="12" width={largest > 0 ? previous / largest * 100 : 0} height="6" className="conversion-comparison-bars__previous" />
    </svg>
  );
}

function ChartHidden({ label }: { label: string }) {
  return <p className="production-chart-hidden"><EyeOff className="h-4 w-4 shrink-0" aria-hidden="true" />{label}</p>;
}
