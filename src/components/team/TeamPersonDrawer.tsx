import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight, Mail, Phone, PhoneOff, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { contactLinkProps, phoneHref } from "@/lib/phone";
import { formatTimeAgo } from "@/lib/dateUtils";
import { cn } from "@/lib/utils";
import { daysSince, usdOrNull, type RosterRow } from "@/lib/teamRoster";
import {
  BLOCKER_LABEL, OUTCOME_LABEL, WAITING_ON_LABEL, basisShortLabel, formatDay, plural, reasonSentence,
  type TeamContractingStatus, type TeamPerson, type useCheckoffToggle, type useTeamContracting,
} from "@/lib/teamContracting";
import { MilestoneChecklist, RowBadges } from "@/components/team/ContractingBadges";
import { ContactOutcomeButtons } from "@/components/team/ContactOutcome";
import { ContractingFollowupForm } from "@/components/team/ContractingFollowupForm";
import { CheckoffHistory } from "@/components/team/CheckoffHistory";
import { OnboardingProgress } from "@/components/team/OnboardingProgress";

type Contracting = ReturnType<typeof useTeamContracting>;
type Checkoff = ReturnType<typeof useCheckoffToggle>;

function Section({ title, children, sectionRef }: { title: string; children: React.ReactNode; sectionRef?: React.Ref<HTMLElement> }) {
  return (
    <section ref={sectionRef} className="space-y-2 border-t border-border pt-4 first:border-t-0 first:pt-0" aria-label={title}>
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      {children}
    </section>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-base font-semibold tabular-nums text-foreground">{value}{sub ? <span className="ml-1 text-xs font-normal text-muted-foreground">{sub}</span> : null}</dd>
    </div>
  );
}

/**
 * The single home for everything about one person: the full contracting checklist, contact and follow-up, the change
 * history and the production numbers. The roster rows only carry what is needed to decide who to open. This is a
 * drawer, not a modal on a modal: the follow-up form is inline, so nothing ever stacks on top of it.
 */
export function TeamPersonDrawer({ open, onOpenChange, person, row, tc, checkoff, canTick, scrollTo }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  person: TeamPerson | undefined;
  row: RosterRow | undefined;
  tc: Contracting;
  checkoff: Checkoff;
  canTick: boolean;
  /** "followup" scrolls the follow-up section into view when the drawer opens from a Follow-up button. */
  scrollTo?: "followup" | null;
}) {
  const followupRef = useRef<HTMLElement>(null);
  const [recording, setRecording] = useState(false);
  const status: TeamContractingStatus | undefined = tc.data;
  const name = person?.display_name ?? row?.full_name ?? "Name not on file";
  const phone = row?.phone ?? null;
  const email = row?.email ?? null;
  const agentId = person?.agent_id ?? row?.agent_id ?? "";

  useEffect(() => { if (!open) setRecording(false); }, [open]);
  useEffect(() => {
    if (open && scrollTo === "followup") {
      const t = window.setTimeout(() => followupRef.current?.scrollIntoView({ block: "start", behavior: "auto" }), 60);
      return () => window.clearTimeout(t);
    }
  }, [open, scrollTo, agentId]);

  const sinceSale = row ? daysSince(row.last_posted_date) : null;
  const f = person?.followup;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto p-4 sm:max-w-lg sm:p-6" aria-describedby="team-person-desc">
        <SheetHeader className="pr-10">
          <SheetTitle className="text-xl">{name}</SheetTitle>
          <SheetDescription id="team-person-desc">
            {[row?.license_status ?? person?.license_status, row?.status].filter((x): x is string => Boolean(x)).map((x) => x[0].toUpperCase() + x.slice(1))
              .concat(row?.manager_name ? [`Upline ${row.manager_name}`] : []).join(" · ") || "Team member"}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            {phone ? (
              <Button asChild size="sm" className="h-10 gap-1.5">
                <a href={phoneHref(phone) ?? `tel:${phone}`} {...contactLinkProps(phoneHref(phone))} onClick={() => setRecording(true)}><Phone className="h-4 w-4" aria-hidden />Call</a>
              </Button>
            ) : (
              <span className="inline-flex items-center gap-1 text-sm text-muted-foreground"><PhoneOff className="h-4 w-4" aria-hidden />No phone on file</span>
            )}
            {email ? <Button asChild size="sm" variant="outline" className="h-10 gap-1.5"><a href={`mailto:${email}`}><Mail className="h-4 w-4" aria-hidden />Email</a></Button> : null}
            {agentId ? <Button asChild size="sm" variant="outline" className="h-10 gap-1.5"><Link to={`/dashboard/profile?agentId=${agentId}`}><ArrowUpRight className="h-4 w-4" aria-hidden />Full profile</Link></Button> : null}
          </div>

          <Section title="Contracting">
            {tc.isLoading ? (
              <p className="text-sm text-muted-foreground">Loading contracting status…</p>
            ) : tc.isError || !status ? (
              <p className="text-sm text-amber-700 dark:text-amber-400" role="alert">
                Contracting status unavailable.{" "}
                <button type="button" className="inline-flex items-center gap-1 font-semibold underline" onClick={() => void tc.refetch()}><RefreshCw className="h-3.5 w-3.5" aria-hidden />Retry</button>
              </p>
            ) : person ? (
              <div className="space-y-2">
                <RowBadges p={person} />
                {person.p1 ? <p className="text-sm font-medium text-red-700 dark:text-red-300">{reasonSentence(person, basisShortLabel(status.basis.key))}</p> : null}
                {!status.basis.confirmed ? <p className="text-sm text-muted-foreground">The timing rule is not confirmed yet, so no urgency is shown for anyone.</p>
                  : <p className="text-xs text-muted-foreground">Clock: {status.basis.label}. Phoenix calendar days.</p>}
                <MilestoneChecklist p={person} canEdit={canTick} onToggle={(id, key, d, nm) => void checkoff.toggle(id, key, d, nm)} isPending={checkoff.isPending} />
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Contracting does not apply to this person yet{row && row.license_status !== "licensed" ? " (not licensed)" : ""}.</p>
            )}
          </Section>

          {person ? (
            <>
              <Section title="Contact and follow-up">
                <p className="text-sm text-muted-foreground">
                  {f?.last_at ? <>Last contact: <b className="text-foreground">{OUTCOME_LABEL[f.last_outcome ?? ""] ?? "logged"}</b>, {formatTimeAgo(f.last_at)}. {plural(f.call_count, "call")} logged.</> : "Never contacted."}
                  {" "}Owner: <b className="text-foreground">{person.owner.name}</b>{person.owner.source === "manager" ? " (their manager)" : person.owner.source === "unassigned" ? " (nobody assigned)" : ""}.
                  {f?.waiting_on ? ` ${WAITING_ON_LABEL[f.waiting_on] ?? f.waiting_on}.` : ""}
                  {f?.blocker && f.blocker !== "none" ? ` Blocker: ${BLOCKER_LABEL[f.blocker] ?? f.blocker}.` : ""}
                  {f?.next_on ? <> Next follow-up: <b className={cn(f.due_now ? "text-red-700 dark:text-red-300" : "text-foreground")}>{formatDay(f.next_on)}{f.due_now ? " (due)" : ""}</b>.</> : null}
                </p>
                {recording ? (
                  <div className="rounded-md border border-border bg-muted/40 p-2">
                    <p className="mb-1 text-xs text-muted-foreground">Calling does not record a contact. What happened?</p>
                    <ContactOutcomeButtons agentId={person.agent_id} name={person.display_name} queryKey={tc.queryKey} onLogged={() => setRecording(false)} onSkip={() => setRecording(false)} />
                  </div>
                ) : (
                  <button type="button" onClick={() => setRecording(true)} className="text-sm font-semibold text-foreground underline underline-offset-2">Record a contact</button>
                )}
              </Section>
              <Section title="Follow-up plan" sectionRef={followupRef}>
                <ContractingFollowupForm key={person.agent_id} person={person} queryKey={tc.queryKey} />
              </Section>
              <Section title="Recent changes"><CheckoffHistory person={person} /></Section>
            </>
          ) : null}

          {row ? (
            <>
              <Section title="Onboarding"><OnboardingProgress row={row} /></Section>
              <Section title="Production">
                <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
                  <Stat label="Today" value={(row.today_deals ?? 0) > 0 ? `${usdOrNull(row.today_alp) ?? "$0"}` : "No sale"} sub={(row.today_deals ?? 0) > 0 ? plural(row.today_deals ?? 0, "deal") : undefined} />
                  <Stat label="Selling streak" value={(row.selling_streak_days ?? 0) > 0 ? `${row.selling_streak_days} days` : "None"} />
                  <Stat label="Month ALP" value={usdOrNull(row.mtd_alp) ?? "—"} sub={(row.mtd_deals ?? 0) > 0 ? `×${row.mtd_deals}` : undefined} />
                  <Stat label="Last 30 days" value={usdOrNull(row.l30_alp) ?? "—"} />
                  <Stat label="Lifetime" value={usdOrNull(row.lifetime_alp) ?? "—"} sub={(row.lifetime_deals ?? 0) > 0 ? `×${row.lifetime_deals}` : undefined} />
                  <Stat label="Last sale" value={row.last_posted_date ? (sinceSale === 0 ? "Today" : sinceSale === 1 ? "Yesterday" : `${Math.max(0, sinceSale ?? 0)} days ago`) : "Never sold"} />
                  <Stat label="On the roster" value={row.tenure_days == null ? "—" : `${row.tenure_days} days`} />
                  {row.agent_code ? <Stat label="Agent code" value={row.agent_code} /> : null}
                </dl>
              </Section>
            </>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
