import { Link } from "react-router-dom";
import { ArrowUpRight, Mail, Phone, PhoneOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { contactLinkProps, phoneHref } from "@/lib/phone";
import { daysSince, plural, usdOrNull, type RosterRow } from "@/lib/teamRoster";
import { useContractReview } from "@/hooks/useContractReview";
import { levelText } from "@/lib/contractReview";
import { OnboardingProgress } from "@/components/team/OnboardingProgress";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2 border-t border-border pt-4 first:border-t-0 first:pt-0" aria-label={title}>
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
 * The single home for everything about one person on the production roster: how to reach them, where they are in
 * onboarding, and their production. Contracting is not edited here. It lives in the contracting review, so there is one
 * place to confirm a carrier; this drawer only says where that stands and links to it.
 */
export function TeamPersonDrawer({ open, onOpenChange, row, onOpenContracting }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  row: RosterRow | undefined;
  /** Closes this drawer and brings the contracting review to this person. */
  onOpenContracting: (agentId: string) => void;
}) {
  const review = useContractReview(open);
  const name = row?.full_name ?? "Name not on file";
  const phone = row?.phone ?? null;
  const email = row?.email ?? null;
  const agentId = row?.agent_id ?? "";
  const sinceSale = row ? daysSince(row.last_posted_date) : null;
  const inReview = review.roster?.agents.find((a) => a.agent_id === agentId);
  const total = review.roster?.carriers.length ?? 4;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto p-4 sm:max-w-lg sm:p-6" aria-describedby="team-person-desc">
        <SheetHeader className="pr-10">
          <SheetTitle className="text-xl">{name}</SheetTitle>
          <SheetDescription id="team-person-desc">
            {[row?.license_status, row?.status].filter((x): x is string => Boolean(x)).map((x) => x[0].toUpperCase() + x.slice(1))
              .concat(row?.manager_name ? [`Upline ${row.manager_name}`] : []).join(" · ") || "Team member"}
          </SheetDescription>
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
                    <span className="text-muted-foreground"> · Placement level {levelText(inReview.level)}</span>
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
        </div>
      </SheetContent>
    </Sheet>
  );
}
