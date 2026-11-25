import { EyeOff } from "lucide-react";

import "./dashboard-content.css";

const money = (value: number) => new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD", maximumFractionDigits: 0,
}).format(value);

export interface ProductionMixRow {
  id?: string;
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
  if (rows.some((row) => !Number.isFinite(row.ap) || row.ap < 0 || !Number.isInteger(row.policies) || row.policies < 0)) {
    return <p className="mt-3 text-sm text-muted-foreground">The production chart is unavailable for this result. Individual amounts remain in Who sold.</p>;
  }
  const ranked = [...rows].sort((a, b) => b.ap - a.ap || a.label.localeCompare(b.label));
  const largest = ranked[0].ap;
  const total = ranked.reduce((sum, row) => sum + row.ap, 0);
  return (
    <div className="production-mix-chart">
      <p className="production-chart-caption">ALP by hierarchy · same selected dates</p>
      <div className="production-mix-chart__columns" aria-hidden="true"><span>Rank / hierarchy</span><span>ALP / share</span></div>
      <ul aria-label="Production by hierarchy chart" className="production-mix-chart__rows">
        {ranked.map((row) => {
          // Equal production earns the same rank; zero production has no podium.
          const rank = row.ap > 0 ? ranked.findIndex((candidate) => candidate.ap === row.ap) + 1 : null;
          return (
          <li key={row.id ?? row.label} className="production-mix-chart__row" data-rank={rank ?? "unranked"}>
            <span className="production-mix-chart__rank" aria-label={rank ? `Rank ${rank}` : "No production rank"}>{rank ? String(rank).padStart(2, "0") : "—"}</span>
            <div className="production-mix-chart__body">
              <div className="production-mix-chart__labels">
                <span className="production-mix-chart__name">{row.label}</span>
                <span className="production-mix-chart__amount">{money(row.ap)}</span>
              </div>
              <div className="production-mix-chart__track" aria-hidden="true">
                <span data-empty={row.ap === 0} style={{ width: `${largest > 0 ? row.ap / largest * 100 : 0}%` }} />
              </div>
              <div className="production-mix-chart__foot">
                <span>{row.policies.toLocaleString()} {row.policies === 1 ? "policy" : "policies"}</span>
                <span>{total > 0 ? `${(row.ap / total * 100).toFixed(1)}% of shown ALP` : "No ALP yet"}</span>
              </div>
            </div>
          </li>
          );
        })}
      </ul>
      {largest === 0 && <p className="production-chart-caption">No ALP recorded in this window.</p>}
    </div>
  );
}

/** Posted MTD versus the server's estimate. This is a pace graphic, never a goal or daily history. */
export function MonthPaceChart({ actual, projected, elapsedDays, daysInMonth, hidden = false }: {
  actual: number;
  projected: number;
  elapsedDays: number;
  daysInMonth: number;
  hidden?: boolean;
}) {
  if (hidden) return <ChartHidden label="Production pace hidden for presenting" />;
  if (![actual, projected, elapsedDays, daysInMonth].every(Number.isFinite)
    || actual < 0 || projected < actual || elapsedDays < 1 || elapsedDays > daysInMonth
    || !Number.isInteger(elapsedDays) || !Number.isInteger(daysInMonth)) {
    return <p className="production-chart-caption mt-3">Production pace is unavailable for this result.</p>;
  }
  if (actual === 0 && projected === 0) return <p className="production-chart-caption mt-3">No posted ALP yet this month.</p>;
  const actualShare = projected > 0 ? actual / projected * 100 : 0;
  const calendarShare = elapsedDays / daysInMonth * 100;
  return (
    <div className="production-pace-chart">
      <div
        className="production-pace-chart__track"
        role="img"
        aria-label={`${money(actual)} posted month to date against ${money(projected)} projected at month end. The projection is an estimate, not earned production or a goal.`}
      >
        <span className="production-pace-chart__estimate" />
        <span className="production-pace-chart__actual" style={{ width: `${actualShare}%` }} />
      </div>
      <p className="production-pace-chart__legend"><span>Posted MTD</span><span>Month-end estimate</span></p>
      <div className="production-pace-chart__calendar">
        <span>Calendar elapsed</span><strong>{elapsedDays} / {daysInMonth} days</strong>
      </div>
      <div className="production-pace-chart__time" aria-hidden="true"><span style={{ width: `${calendarShare}%` }} /></div>
      <p className="production-chart-caption">{money(actual / elapsedDays)} ALP per elapsed calendar day</p>
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
        <g transform="rotate(-90 60 60)">
          <circle cx="60" cy="60" r="46" pathLength="100" className="earnings-mix-chart__base" />
          <circle cx="60" cy="60" r="46" pathLength="100" className="earnings-mix-chart__direct" strokeDasharray={`${directShare} ${100 - directShare}`} />
          <circle cx="60" cy="60" r="46" pathLength="100" className="earnings-mix-chart__override" strokeDasharray={`${overrideShare} ${100 - overrideShare}`} strokeDashoffset={-directShare} />
        </g>
        <text x="60" y="58" textAnchor="middle" className="earnings-mix-chart__center" aria-hidden="true">EST.</text>
        <text x="60" y="73" textAnchor="middle" className="earnings-mix-chart__center-label" aria-hidden="true">EARNINGS</text>
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
