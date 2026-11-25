import { recordedConversion, type RecruitingCohort } from "@/lib/recruitingCohort";

export function RecruitingCohortCard({ cohort }: { cohort: RecruitingCohort | null | undefined }) {
  if (!cohort) return <section className="rounded-xl border border-border bg-card p-4" aria-label="Recruiting cohort conversion"><h3 className="font-semibold">Application cohort conversion</h3><p className="mt-2 text-sm text-muted-foreground">Linked conversion evidence is unavailable. Activity counts below are independent events, not conversion rates.</p></section>;
  const rate = (value: number) => { const n = recordedConversion(value, cohort.applications); return n === null ? "Unavailable" : `${n}%`; };
  return <section className="space-y-3 rounded-xl border border-border bg-card p-4" aria-label="Recruiting cohort conversion">
    <div><h3 className="font-semibold">Application cohort conversion</h3><p className="mt-1 text-xs text-muted-foreground">{cohort.applications} distinct first applications · {cohort.start} through {cohort.end}, Phoenix dates. Every rate uses these same applicants.</p></div>
    <div className="grid gap-3 sm:grid-cols-3">{[
      ["Recorded interview booking", cohort.booked], ["Linked producer record", cohort.linked_producers], ["Recorded posted production", cohort.posted],
    ].map(([label, value]) => <div key={label} className="rounded-lg border border-border bg-background/50 p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-2xl font-semibold tabular-nums">{rate(Number(value))}</p><p className="mt-1 text-xs text-muted-foreground">{value} / {cohort.applications} applicants</p></div>)}</div>
    <p className="text-xs text-muted-foreground">Recorded linked outcomes through {cohort.observed_through.slice(0, 10)} UTC. {cohort.without_producer_link} applicants have no producer record linked. Missing links are not inferred; recent applicants still have time to progress. A producer record is not proof of a completed hire.</p>
  </section>;
}
