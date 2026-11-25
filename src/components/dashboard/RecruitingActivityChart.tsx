import { useId, useMemo } from "react";
import { peopleFor, type ConversionPayload } from "@/lib/homeConversions";

import "./dashboard-content.css";

const DAY_MS = 86_400_000;
const ACTIVITY_SERIES = [
  { kind: "applied", label: "Applications", tone: "cool" },
  { kind: "interview_booked", label: "Interviews booked", tone: "warm" },
  { kind: "hired", label: "New hires", tone: "good" },
] as const;

function dayStamp(day: string | null | undefined): number | null {
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const stamp = Date.parse(`${day}T00:00:00Z`);
  return Number.isFinite(stamp) && new Date(stamp).toISOString().slice(0, 10) === day ? stamp : null;
}

const dayKey = (stamp: number) => new Date(stamp).toISOString().slice(0, 10);
const dateLabel = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", {
  month: "short", day: "numeric", timeZone: "UTC",
});

/** Uses only the complete, already-authorized current-period rows; no event or date is inferred. */
export function buildRecruitingActivity(payload: ConversionPayload | null) {
  if (!payload?.range) return null;
  const start = dayStamp(payload.range.start);
  const selectedEnd = dayStamp(payload.range.end);
  const today = dayStamp(payload.today);
  if (start === null || selectedEnd === null || today === null || selectedEnd < start || selectedEnd - start > 366 * DAY_MS) return null;
  // A date picker can be a day ahead of the server near midnight. Future days
  // are not measured zeros; stop the graph at the server's business day.
  const end = Math.min(selectedEnd, today);
  if (end < start) return null;
  const dayCount = Math.round((end - start) / DAY_MS) + 1;
  const bucketDays = dayCount > 56 ? 7 : 1;
  const buckets = Array.from({ length: Math.ceil(dayCount / bucketDays) }, (_, i) => ({
    start: dayKey(start + i * bucketDays * DAY_MS),
    end: dayKey(Math.min(end, start + ((i + 1) * bucketDays - 1) * DAY_MS)),
  }));
  const series = ACTIVITY_SERIES.map((definition) => {
    const people = peopleFor(payload, definition.kind);
    const stamps = people.map((person) => dayStamp(person.on));
    // A known aggregate with missing dates is not a known timeline. Keep the
    // existing tile's count, but omit this series rather than silently undercount.
    const complete = stamps.every((stamp) => stamp !== null && stamp >= start && stamp <= end);
    const counts = complete ? Array<number>(buckets.length).fill(0) : null;
    if (counts) for (const stamp of stamps) counts[Math.floor((stamp! - start) / DAY_MS / bucketDays)]++;
    return { ...definition, total: people.length, counts };
  });
  return { start: dayKey(start), end: dayKey(end), bucketDays, buckets, series };
}

/** A true dated activity chart beside the existing period comparisons; never a cohort funnel. */
export function RecruitingActivityChart({ payload }: { payload: ConversionPayload | null }) {
  const titleId = useId();
  const descriptionId = useId();
  const chart = useMemo(() => buildRecruitingActivity(payload), [payload]);
  if (!payload?.range) return null;
  if (!chart) return <p className="production-chart-caption">Recruiting activity by date is unavailable for this result.</p>;

  const measured = chart.series.filter((series) => series.counts !== null);
  const maxCount = Math.max(1, ...measured.flatMap((series) => series.counts!));
  const plot = { left: 34, right: 624, top: 14, bottom: 142 };
  const x = (index: number) => chart.buckets.length === 1 ? (plot.left + plot.right) / 2
    : plot.left + index / (chart.buckets.length - 1) * (plot.right - plot.left);
  const y = (count: number) => plot.bottom - count / maxCount * (plot.bottom - plot.top);
  const intervalLabel = chart.bucketDays === 1 ? "Daily counts" : "7-day totals";
  const tableDate = (bucket: typeof chart.buckets[number]) => bucket.start === bucket.end
    ? dateLabel(bucket.start) : `${dateLabel(bucket.start)} – ${dateLabel(bucket.end)}`;

  return (
    <section className="recruiting-activity" aria-labelledby={titleId}>
      <div className="recruiting-activity__header">
        <div>
          <p className="dashboard-board-eyebrow">Recruiting / activity</p>
          <h3 id={titleId}>Recruiting activity</h3>
        </div>
        <p className="production-chart-caption">{intervalLabel} · Phoenix time<br />{dateLabel(chart.start)} – {dateLabel(chart.end)}</p>
      </div>
      <div className="recruiting-activity__metrics">
        {chart.series.map((series) => (
          <div key={series.kind} data-tone={series.tone}>
            <span className="recruiting-activity__label"><span aria-hidden="true" />{series.label}</span>
            <strong>{series.total.toLocaleString()}</strong>
            {series.counts === null && <span className="production-chart-caption">Dates unavailable</span>}
          </div>
        ))}
      </div>
      {measured.length > 0 ? (
        <div className="recruiting-activity__plot-frame">
        <span className="recruiting-activity__axis-max" aria-hidden="true">{maxCount}</span>
        <span className="recruiting-activity__axis-zero" aria-hidden="true">0</span>
        <svg className="recruiting-activity__plot" viewBox="0 0 640 156" preserveAspectRatio="none" role="img" aria-labelledby={titleId} aria-describedby={descriptionId}>
          <title>Recorded recruiting activity by date</title>
          <desc id={descriptionId}>{intervalLabel} for applications, interviews booked and new hires. Exact counts are available in the table below. Missing dates are not drawn as zero.</desc>
          {[0, 0.5, 1].map((fraction) => <line key={fraction} x1={plot.left} x2={plot.right} y1={y(maxCount * fraction)} y2={y(maxCount * fraction)} className="recruiting-activity__grid" />)}
          {measured.map((series) => (
            <g key={series.kind} className="recruiting-activity__series" data-kind={series.kind} data-tone={series.tone}>
              <polyline points={series.counts!.map((count, index) => `${x(index)},${y(count)}`).join(" ")} />
              {series.counts!.map((count, index) => (
                <circle key={chart.buckets[index].start} cx={x(index)} cy={y(count)} r={chart.buckets.length > 31 ? 2.5 : 3.5}>
                  <title>{tableDate(chart.buckets[index])}: {series.label} {count}</title>
                </circle>
              ))}
            </g>
          ))}
        </svg>
        <div className="recruiting-activity__axis-dates" aria-hidden="true"><span>{dateLabel(chart.start)}</span>{chart.start !== chart.end && <span>{dateLabel(chart.end)}</span>}</div>
        </div>
      ) : <p className="production-chart-caption">The counts loaded, but their dates could not be verified.</p>}
      {chart.series.every((series) => series.counts !== null && series.total === 0) && <p className="production-chart-caption">No recruiting activity recorded in these dates.</p>}
      <p className="production-chart-caption">Each line counts its own activity. The same person can appear in more than one line.</p>
      <details className="recruiting-activity__details">
        <summary>View counts by date</summary>
        <div className="recruiting-activity__table-scroll">
          <table>
            <caption className="sr-only">Recruiting activity counts by Phoenix business date</caption>
            <thead><tr><th scope="col">{chart.bucketDays === 1 ? "Date" : "Date range"}</th>{chart.series.map((series) => <th key={series.kind} scope="col">{series.label}</th>)}</tr></thead>
            <tbody>{chart.buckets.map((bucket, index) => (
              <tr key={bucket.start}><th scope="row">{tableDate(bucket)}</th>{chart.series.map((series) => <td key={series.kind}>{series.counts?.[index] ?? "—"}</td>)}</tr>
            ))}</tbody>
          </table>
        </div>
      </details>
    </section>
  );
}
