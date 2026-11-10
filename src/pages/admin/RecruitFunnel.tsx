/**
 * /admin/recruit-funnel — every month's applicants, followed forward (WP8, 2026-11-10).
 *
 * Before this page, every funnel surface here was wrong in its own way: "contacted" was a
 * batch-stamped column (98% "contacted" against ~3% logged human contact), stage conversion was a
 * ratio of two point-in-time populations, and backfilled Leader Call rows counted one person up to
 * 30 times. This page reads ONE source, public.v_recruit_funnel_cohort, which is admin-gated in
 * the database (agents and the manager role read zero rows) and built on the same seven steps as
 * the recruit bar (src/lib/recruitJourney.ts, parity asserted in recruitJourney.test.ts).
 *
 * Honesty rules the page keeps:
 *   - "Reached" = on that step or further, the bar's own positional reading. The raw evidence
 *     (logged human contact, people who booked) sits beside it so inference is never mistaken
 *     for a fact.
 *   - A first-deal rate is shown only for cohorts whose 60/90-day window has closed, and never
 *     while a production feed that window depends on is dark: then the cell says "unprovable"
 *     and shows the deals it CAN see as a floor, never as "no deal".
 *   - A stage whose writer has no fresh receipt is flagged, so a zero from a dead writer cannot
 *     read as a zero from recruits.
 *
 * The inflow alarm (public.v_inflow_alert) is the same number apex-doctor check #49 grades.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Filter } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { QueryState, describeQuery } from "@/components/ui/query-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { usePageTitle } from "@/hooks/usePageTitle";
import { RECRUIT_STEPS } from "@/lib/recruitJourney";

type Lane = "licensed" | "pending" | "unlicensed";
type RateState = "measured" | "window_open" | "unprovable" | "no_eligible";

interface CohortRow {
  cohort_month: string;
  lane: Lane;
  channel: string;
  applications: number;
  reached_contacted: number;
  reached_interview: number;
  reached_licensing: number | null;
  reached_licensed: number;
  reached_contracted: number;
  reached_first_deal: number;
  human_contacted: number;
  booked_people: number;
  booking_rows: number;
  attended: number;
  hired_any: number;
  hired_logged_in: number;
  med_days_applied_to_contacted: number | null;
  med_days_applied_to_interview: number | null;
  med_days_hired_to_first_deal: number | null;
  deal60_state: RateState;
  deal60_rate: number | null;
  deal60_yes: number;
  deal90_state: RateState;
  deal90_rate: number | null;
  deal90_yes: number;
  hire_deal60_state: RateState;
  hire_deal60_rate: number | null;
  hire_deal60_yes: number;
  production_truth_degraded: boolean;
  truth_suspect_since: string | null;
  degraded_origins: string | null;
  source_dead_contacted: boolean;
  source_dead_attended: boolean;
  source_dead_licensing: boolean;
  source_dead_licensed: boolean;
  source_dead_contracted: boolean;
  snapshot_at: string | null;
}

interface InflowAlert {
  as_of: string;
  last_full_week_start: string;
  last_4wk_total: number;
  last_4wk_avg: number;
  trailing_12wk_avg: number;
  ratio: number | null;
  baseline_26wk_avg: number;
  ratio_vs_26wk: number | null;
  verdict: "drop" | "ok" | "insufficient_data";
  weekly_last_16: { week: string; n: number }[] | null;
  channel_drops: { channel: string; last_4wk: number; trailing_12wk_per_4wk: number }[] | null;
}

const LANES: { key: Lane; label: string }[] = [
  { key: "licensed", label: "Licensed" },
  { key: "pending", label: "License pending" },
  { key: "unlicensed", label: "Not licensed" },
];

const COHORT_COLUMNS =
  "cohort_month,lane,channel,applications,reached_contacted,reached_interview,reached_licensing,reached_licensed,reached_contracted,reached_first_deal,human_contacted,booked_people,booking_rows,attended,hired_any,hired_logged_in,med_days_applied_to_contacted,med_days_applied_to_interview,med_days_hired_to_first_deal,deal60_state,deal60_rate,deal60_yes,deal90_state,deal90_rate,deal90_yes,hire_deal60_state,hire_deal60_rate,hire_deal60_yes,production_truth_degraded,truth_suspect_since,degraded_origins,source_dead_contacted,source_dead_attended,source_dead_licensing,source_dead_licensed,source_dead_contracted,snapshot_at";

// The two views are newer than the generated types (src/integrations/supabase/types.ts is
// regenerated at merge time, never per package), so the read is typed here, not through `any`.
interface ReadResult<T> {
  data: T | null;
  error: { message: string } | null;
}
interface LooseSelect<T> {
  order: (column: string, opts: { ascending: boolean }) => PromiseLike<ReadResult<T[]>>;
  maybeSingle: () => PromiseLike<ReadResult<T>>;
}
const db = supabase as unknown as { from: <T>(relation: string) => { select: (columns: string) => LooseSelect<T> } };

const monthWords = (iso: string) =>
  new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${iso.slice(0, 10)}T00:00:00Z`));

const pct = (n: number, d: number) => (d > 0 ? `${Math.round((100 * n) / d)}%` : "—");

/** One step cell: the count, and its share of the cohort. */
function StepCell({ n, of }: { n: number | null; of: number }) {
  if (n === null) return <span className="text-muted-foreground">n/a</span>;
  return (
    <span className="tabular-nums">
      {n}
      <span className="ml-1 text-xs text-muted-foreground">{pct(n, of)}</span>
    </span>
  );
}

/** A first-deal rate cell that never reads an unknowable answer as "no deal". */
function RateCell({ state, rate, yes }: { state: RateState; rate: number | null; yes: number }) {
  if (state === "measured" && rate !== null) return <span className="tabular-nums font-semibold">{Math.round(rate * 1000) / 10}%</span>;
  if (state === "unprovable")
    return (
      <span title="A production feed this window depends on is dark. The count is what can be seen, a floor, not a no.">
        <Badge variant="outline">unprovable</Badge>
        <span className="ml-1 text-xs text-muted-foreground">{yes}+ seen</span>
      </span>
    );
  if (state === "window_open") return <span className="text-xs text-muted-foreground">window open</span>;
  return <span className="text-muted-foreground">—</span>;
}

export default function RecruitFunnel() {
  usePageTitle("Recruit funnel");
  const [lane, setLane] = useState<Lane>("licensed");
  const [channel, setChannel] = useState<string>("(all)");

  const cohort = useQuery<CohortRow[]>({
    queryKey: ["recruit-funnel-cohort"],
    queryFn: async () => {
      const { data, error } = await db
        .from<CohortRow>("v_recruit_funnel_cohort")
        .select(COHORT_COLUMNS)
        .order("cohort_month", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });

  const inflow = useQuery<InflowAlert | null>({
    queryKey: ["recruit-inflow-alert"],
    queryFn: async () => {
      const { data, error } = await db.from<InflowAlert>("v_inflow_alert").select("*").maybeSingle();
      if (error) throw error;
      return data ?? null;
    },
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });

  const rows = useMemo(() => cohort.data ?? [], [cohort.data]);
  const channels = useMemo(() => {
    const set = new Set(rows.filter((r) => r.lane === lane && r.channel !== "(all)").map((r) => r.channel));
    return ["(all)", ...[...set].sort()];
  }, [rows, lane]);
  const shown = rows.filter((r) => r.lane === lane && r.channel === (channels.includes(channel) ? channel : "(all)"));
  const first = rows[0];
  const deadStages = first
    ? [
        first.source_dead_contacted && "Contacted (no human contact logged in 30 days)",
        first.source_dead_attended && "Attended (interview outcomes recorded on under 20% of calls)",
        first.source_dead_licensing && "Licensing (no Xcel report in 7 days)",
        first.source_dead_licensed && "Licensed (no license stamp in 60 days)",
        first.source_dead_contracted && "Contracted (no agent row in 30 days)",
      ].filter((s): s is string => Boolean(s))
    : [];

  const a = inflow.data;
  const verdictBadge =
    a?.verdict === "drop" ? (
      <Badge variant="destructive">inflow dropped</Badge>
    ) : a?.verdict === "ok" ? (
      <Badge variant="secondary">inflow steady</Badge>
    ) : (
      <Badge variant="outline">not enough data</Badge>
    );
  const maxWeek = Math.max(1, ...(a?.weekly_last_16 ?? []).map((w) => w.n));

  return (
    <div className="page-enter mx-auto w-full max-w-6xl space-y-6 pb-24">
      <PageHeader
        title="Recruit funnel"
        subtitle="Each month's applicants, followed to their first deal."
        icon={<Filter />}
        tone="gold"
      />

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">Applications per week</CardTitle>
          {a ? verdictBadge : null}
        </CardHeader>
        <CardContent>
          <QueryState {...describeQuery(inflow)} label="the inflow alarm" onRetry={() => void inflow.refetch()} compact>
            {a ? (
              <div className="space-y-3 text-sm">
                <p>
                  Last 4 full weeks: <span className="font-semibold tabular-nums">{a.last_4wk_avg}</span> a week. The 12 weeks before:{" "}
                  <span className="tabular-nums">{a.trailing_12wk_avg}</span>
                  {a.ratio !== null ? <> ({Math.round(a.ratio * 100)}%)</> : null}. The 26 weeks before:{" "}
                  <span className="tabular-nums">{a.baseline_26wk_avg}</span>
                  {a.ratio_vs_26wk !== null ? <> ({Math.round(a.ratio_vs_26wk * 100)}%)</> : null}.
                </p>
                <div className="flex h-16 items-end gap-1" aria-label="Applications in each of the last 16 weeks">
                  {(a.weekly_last_16 ?? []).map((w) => (
                    <div
                      key={w.week}
                      title={`Week of ${w.week}: ${w.n}`}
                      className="flex-1 rounded-sm bg-primary/60"
                      style={{ height: `${Math.max(4, (w.n / maxWeek) * 100)}%` }}
                    />
                  ))}
                </div>
                {(a.channel_drops ?? []).length > 0 ? (
                  <p className="text-muted-foreground">
                    Fell by more than half:{" "}
                    {(a.channel_drops ?? []).map((c) => `${c.channel} (${c.last_4wk} in 4 weeks, was ${c.trailing_12wk_per_4wk})`).join(", ")}.
                  </p>
                ) : null}
              </div>
            ) : null}
          </QueryState>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="space-y-3">
          <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Lane">
            {LANES.map((l) => (
              <button
                key={l.key}
                type="button"
                role="tab"
                aria-selected={lane === l.key}
                onClick={() => setLane(l.key)}
                className={
                  lane === l.key
                    ? "min-h-11 rounded-md border border-primary/50 bg-primary/15 px-3 text-sm font-semibold text-primary"
                    : "min-h-11 rounded-md border border-border px-3 text-sm text-muted-foreground hover:text-foreground"
                }
              >
                {l.label}
              </button>
            ))}
            <label className="ml-auto flex items-center gap-2 text-sm text-muted-foreground">
              Channel
              <select
                className="min-h-11 rounded-md border border-border bg-background px-2 text-sm text-foreground"
                value={channels.includes(channel) ? channel : "(all)"}
                onChange={(e) => setChannel(e.target.value)}
              >
                {channels.map((c) => (
                  <option key={c} value={c}>
                    {c === "(all)" ? "All channels" : c}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {first?.production_truth_degraded ? (
            <p className="text-sm text-muted-foreground">
              Production is dark for {first.degraded_origins ?? "a feed"} since {first.truth_suspect_since}. A first-deal window that reaches past
              that day reads "unprovable", never "no deal".
            </p>
          ) : null}
          {deadStages.length > 0 ? (
            <p className="text-sm text-muted-foreground">Not recording right now, so read these as unknown, not zero: {deadStages.join("; ")}.</p>
          ) : null}
        </CardHeader>
        <CardContent>
          <QueryState {...describeQuery(cohort)} label="the recruit funnel" onRetry={() => void cohort.refetch()} title="No cohorts yet">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Applied in</TableHead>
                    {RECRUIT_STEPS.map((s) => (
                      <TableHead key={s.key} title={s.means}>
                        {s.label}
                      </TableHead>
                    ))}
                    <TableHead title="Logged human contact (raw)">Talked to</TableHead>
                    <TableHead title="Distinct people with a Licensed or Leader Call booked">Booked</TableHead>
                    <TableHead title="First deal within 60 days of applying">Deal ≤60d</TableHead>
                    <TableHead title="First deal within 90 days of applying">Deal ≤90d</TableHead>
                    <TableHead title="First deal within 60 days of the agent row">Hire → deal 60d</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {shown.map((r) => (
                    <TableRow key={`${r.cohort_month}-${r.lane}-${r.channel}`}>
                      <TableCell className="whitespace-nowrap font-medium">{monthWords(r.cohort_month)}</TableCell>
                      <TableCell className="tabular-nums">{r.applications}</TableCell>
                      <TableCell>
                        <StepCell n={r.reached_contacted} of={r.applications} />
                      </TableCell>
                      <TableCell>
                        <StepCell n={r.reached_interview} of={r.applications} />
                      </TableCell>
                      <TableCell>
                        <StepCell n={r.reached_licensing} of={r.applications} />
                      </TableCell>
                      <TableCell>
                        <StepCell n={r.reached_licensed} of={r.applications} />
                      </TableCell>
                      <TableCell>
                        <StepCell n={r.reached_contracted} of={r.applications} />
                      </TableCell>
                      <TableCell>
                        <StepCell n={r.reached_first_deal} of={r.applications} />
                      </TableCell>
                      <TableCell>
                        <StepCell n={r.human_contacted} of={r.applications} />
                      </TableCell>
                      <TableCell className="tabular-nums" title={`${r.booking_rows} booking rows`}>
                        {r.booked_people}
                      </TableCell>
                      <TableCell>
                        <RateCell state={r.deal60_state} rate={r.deal60_rate} yes={r.deal60_yes} />
                      </TableCell>
                      <TableCell>
                        <RateCell state={r.deal90_state} rate={r.deal90_rate} yes={r.deal90_yes} />
                      </TableCell>
                      <TableCell>
                        {r.hired_any > 0 ? (
                          <RateCell state={r.hire_deal60_state} rate={r.hire_deal60_rate} yes={r.hire_deal60_yes} />
                        ) : (
                          <span className="text-muted-foreground">no hires</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Steps count people on that step or further. Talked to and Booked are the raw records. Cohorts are Phoenix months; duplicates,
              Xcel roster imports and test traffic are left out. Snapshot {first?.snapshot_at ? new Date(first.snapshot_at).toLocaleString() : "not built"}, rebuilt nightly.
            </p>
          </QueryState>
        </CardContent>
      </Card>
    </div>
  );
}
