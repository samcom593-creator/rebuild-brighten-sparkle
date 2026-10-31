import { Link } from "react-router-dom";
import { ArrowUpRight, Mail, Phone, PhoneOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { contactLinkProps, phoneHref } from "@/lib/phone";
import { daysSince, plural, usdOrNull, type RosterRow } from "@/lib/teamRoster";
import { useContractReview } from "@/hooks/useContractReview";
import { levelText } from "@/lib/contractReview";
import { accessSummary, type PersonFacts, type StageKey } from "@/lib/teamStage";
import type { TeamStage } from "@/lib/teamList";
import { OnboardingProgress } from "@/components/team/OnboardingProgress";
import { StageSelect } from "@/components/team/StageBadge";
import { WorkdaysEditor } from "@/components/team/WorkdaysEditor";
import { TeamStageMark } from "@/components/team/TeamList";

// The card opens in a portal, outside the page's type floor, so its small text is set at 13px here.
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2 border-t border-border pt-4 first:border-t-0 first:pt-0" aria-label={title}>
      <h3 className="text-[15px] font-semibold text-foreground">{title}</h3>
      {children}
    </section>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <dt className="text-[13px] text-muted-foreground">{label}</dt>
      <dd className="text-base font-semibold tabular-nums text-foreground">{value}{sub ? <span className="ml-1 text-[13px] font-normal text-muted-foreground">{sub}</span> : null}</dd>
    </div>
  );
}

/**
 * What the page hands the drawer so one card can manage a person: their stage/schedule facts and the writers for them,
 * plus the account actions that used to live in a per-row menu. Everything is optional; a caller that passes nothing
 * gets the read-only card.
 */
export interface TeamPersonManage {
  facts: PersonFacts | null | undefined;
  factsLoading?: boolean;
  canEdit: boolean;
  saving: (what: "stage" | "workdays") => boolean;
  setStage: (stage: StageKey) => void;
  setWorkdays: (weekdays: number[], effectiveFrom?: string) => Promise<boolean>;
  onCheckIn?: () => void;
  onSendPortalLogin?: () => void;
  onEditLogin?: () => void;
  onViewApplication?: () => void;
  onHide?: () => void;
  onDeactivate?: () => void;
}

/**
 * The single home for everything about one person on the production roster: how to reach them, where they are in
 * onboarding, their stage and work days, their production, and the account actions. Contracting is not edited here. It
 * lives in the contracting review, so there is one place to confirm a carrier; this drawer only says where that stands
 * and links to it.
 */
export function TeamPersonDrawer({ open, onOpenChange, row, onOpenContracting, manage, stage }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  row: RosterRow | undefined;
  /** Closes this drawer and brings the contracting review to this person. */
  onOpenContracting: (agentId: string) => void;
  manage?: TeamPersonManage;
  /** Where they are on My Team (src/lib/teamList.ts), shown under their name exactly as their row shows it. */
  stage?: TeamStage;
}) {
  const review = useContractReview(open);
  const name = row?.full_name ?? "Name not on file";
  const phone = row?.phone ?? null;
  const email = row?.email ?? null;
  const agentId = row?.agent_id ?? "";
  const sinceSale = row ? daysSince(row.last_posted_date) : null;
  const inReview = review.roster?.agents.find((a) => a.agent_id === agentId);
  const total = review.roster?.carriers.length ?? 4;
  const facts = manage?.facts ?? null;
  const access = facts ? accessSummary(facts.access) : null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto p-4 sm:max-w-lg sm:p-6" aria-describedby="team-person-desc">
        <SheetHeader className="pr-10">
          <SheetTitle className="text-xl">{name}</SheetTitle>
          <SheetDescription id="team-person-desc">
            {[row?.license_status, row?.status].filter((x): x is string => Boolean(x)).map((x) => x[0].toUpperCase() + x.slice(1))
              .concat(row?.manager_name ? [`Upline ${row.manager_name}`] : []).join(" · ") || "Team member"}
          </SheetDescription>
          {stage ? <div className="pt-1"><TeamStageMark stage={stage} /></div> : null}
        </SheetHeader>

        <div className="mt-4 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            {phone ? (
              <Button asChild size="sm" className="h-10 gap-1.5">
                <a href={phoneHref(phone) ?? `tel:${phone}`} {...contactLinkProps(phoneHref(phone))}><Phone className="h-4 w-4" aria-hidden />Call</a>
              </Button>
            ) : (
              <span className="inline-flex items-center gap-1 text-sm text-muted-foreground"><PhoneOff className="h-4 w-4" aria-hidden />No phone on file</span>
            )}
            {email ? <Button asChild size="sm" variant="outline" className="h-10 gap-1.5"><a href={`mailto:${email}`}><Mail className="h-4 w-4" aria-hidden />Email</a></Button> : null}
            {agentId ? <Button asChild size="sm" variant="outline" className="h-10 gap-1.5"><Link to={`/dashboard/profile?agentId=${agentId}`}><ArrowUpRight className="h-4 w-4" aria-hidden />Profile</Link></Button> : null}
          </div>

          {manage ? (
            <Section title="Training stage and work days">
              {facts ? (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <StageSelect name={name} stage={facts.stage} canEdit={manage.canEdit} saving={manage.saving("stage")} onChange={manage.setStage} />
                    {access ? <span className={access.tone === "ok" ? "text-sm text-muted-foreground" : "text-sm text-amber-700 dark:text-amber-400"}>{access.text}</span> : null}
                  </div>
                  <WorkdaysEditor name={name} weekdays={facts.weekdays} scheduleSet={facts.schedule_set} nextSchedule={facts.next_schedule} canEdit={manage.canEdit}
                    saving={manage.saving("workdays")} onSave={manage.setWorkdays} />
                </div>
              ) : manage.factsLoading ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
              ) : (
                <p className="text-sm text-muted-foreground">Not on the stage tracker (only active agents are).</p>
              )}
            </Section>
          ) : null}

          {review.canRead ? (
            <Section title="Contracting">
              {review.query.isLoading ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
              ) : review.query.isError || !review.roster ? (
                <p role="alert" className="text-sm text-amber-700 dark:text-amber-400">
                  Contracting review unavailable. <button type="button" className="font-semibold underline" onClick={() => void review.query.refetch()}>Retry</button>
                </p>
              ) : inReview ? (
                <div className="space-y-2">
                  <p className="text-sm text-foreground">
                    {inReview.marked_count} of {total} carriers confirmed
                  </p>
                  <Button type="button" size="sm" variant="outline" className="h-10" onClick={() => onOpenContracting(inReview.agent_id)}>Open in contracting review</Button>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Not part of the contracting review (only active agents are).</p>
              )}
            </Section>
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

          {manage && (manage.onCheckIn || manage.onSendPortalLogin || manage.onEditLogin || manage.onViewApplication || manage.onHide || manage.onDeactivate) ? (
            <Section title="Manage">
              <div className="flex flex-wrap gap-2">
                {manage.onCheckIn ? <Button type="button" size="sm" variant="outline" className="h-10" onClick={manage.onCheckIn}>Mark checked in</Button> : null}
                {manage.onSendPortalLogin ? <Button type="button" size="sm" variant="outline" className="h-10" onClick={manage.onSendPortalLogin}>Send portal login</Button> : null}
                {manage.onEditLogin ? <Button type="button" size="sm" variant="outline" className="h-10" onClick={manage.onEditLogin}>Edit login</Button> : null}
                {manage.onViewApplication ? <Button type="button" size="sm" variant="outline" className="h-10" onClick={manage.onViewApplication}>Application</Button> : null}
                {manage.onHide ? <Button type="button" size="sm" variant="ghost" className="h-10" onClick={manage.onHide}>Hide from roster</Button> : null}
                {manage.onDeactivate ? <Button type="button" size="sm" variant="ghost" className="h-10 text-destructive hover:text-destructive" onClick={manage.onDeactivate}>Remove</Button> : null}
              </div>
            </Section>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
