import {
  AlarmClock,
  Ban,
  CalendarCheck,
  CalendarClock,
  CalendarX,
  CircleSlash,
  Clock,
  Hourglass,
  Mail,
  MessageSquare,
  Phone,
  PhoneCall,
  PhoneForwarded,
  PhoneOff,
  ThumbsDown,
  UserCheck,
  type LucideIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { ToneBubble } from "@/components/ui/delight/ToneBubble";
import { StatusPill } from "@/components/recruiting/StatusPill";
import { contactLinkProps, phoneHref } from "@/lib/phone";
import { channelAvailability, fullName, type WorklistRow } from "@/lib/recruitingQueues";
import { TONE_CLASS, type Tone } from "@/lib/tones";
import { cn } from "@/lib/utils";
import { FactLine, PersonBubble } from "./WorklistViews";
import { formatSince } from "./worklistFormat";
import { nextStepActionLabel, type NextStep, type NextStepKey } from "./worklistNextStep";
import { licenseWord, rowStatus } from "./worklistStatus";

/** One icon per kind of step, beside the words that say it. Decoration: the bubble is aria-hidden. */
const STEP_ICON: Record<NextStepKey, LucideIcon> = {
  do_not_contact: Ban,
  joined: UserCheck,
  said_no: ThumbsDown,
  closed: CircleSlash,
  get_working_number: Mail,
  no_way_to_reach: PhoneOff,
  fix_date: CalendarX,
  check_in: MessageSquare,
  waiting: Hourglass,
  planned_late: AlarmClock,
  planned_today: Clock,
  planned_later: CalendarClock,
  booked: CalendarCheck,
  first_call: PhoneCall,
  follow_up: PhoneForwarded,
};

/** The 8% wash behind the step, the same depth as a selected scoreboard tile. Written out so Tailwind sees each class. */
const WASH: Record<Tone, string> = {
  good: "bg-tone-good/8",
  warm: "bg-tone-warm/8",
  hot: "bg-tone-hot/8",
  cool: "bg-tone-cool/8",
  royal: "bg-tone-royal/8",
  gold: "bg-tone-gold/8",
  slate: "bg-tone-slate/8",
};

/**
 * The one thing to do next with this person (OVERHAUL-calllist): an icon in the step's tone, the
 * action in a few words, and why in one sentence. It sits right under the person's name in the
 * panel and on the Up next card, so the first thing a caller reads after who is what to do.
 */
export function NextStepCallout({ step, className }: { step: NextStep; className?: string }) {
  const Icon = STEP_ICON[step.key];
  return (
    <section
      aria-label="What to do next"
      className={cn("flex items-start gap-3 rounded-lg border px-4 py-3", TONE_CLASS[step.tone].border, WASH[step.tone], className)}
    >
      <ToneBubble tone={step.tone} size="sm" className="mt-0.5"><Icon /></ToneBubble>
      <div className="min-w-0">
        <p className="break-words text-base font-semibold leading-6 text-foreground">{step.title}</p>
        <p className="text-pretty break-words text-sm leading-5 text-muted-foreground">{step.detail}</p>
      </div>
    </section>
  );
}

interface UpNextCardProps {
  row: WorklistRow;
  step: NextStep;
  now: number;
  /** Opens this person's page (the sheet on a phone). */
  onOpen: (id: string) => void;
}

/**
 * Up next (OVERHAUL-calllist, 2026-10-29): on phones and tablets, where the person opens in a
 * sheet, the first person in the open list sits on top of the page with what to do and the one
 * gold button. "Call" dials (a phone's dialer, or Google Voice on a computer) and opens the
 * person's page underneath, so the outcome buttons are waiting when the call ends. Dialing
 * records nothing: the outcome saved afterwards is the record, the same rule as the panel.
 * When the phone can't be used the button emails for a working number, and when there is
 * nothing to send it just opens the person.
 */
export function UpNextCard({ row, step, now, onOpen }: UpNextCardProps) {
  const status = rowStatus(row, now);
  const reach = channelAvailability(row);
  const callHref = step.channel === "call" && reach.call.allowed ? phoneHref(row.phone) : null;
  const emailHref = step.channel === "email" && reach.email.allowed && row.email ? `mailto:${row.email}` : null;
  const label = nextStepActionLabel(row, callHref || emailHref ? step : { ...step, channel: null });
  const contacted = row.last_contact_outcome_at ?? row.last_contacted_at;
  const facts = [
    licenseWord(row.license_status),
    row.state,
    contacted ? `Last contact ${formatSince(contacted, now)}` : "Never contacted",
  ];
  const name = fullName(row);
  const open = () => onOpen(row.id);

  return (
    <section aria-labelledby={`up-next-${row.id}`} className="apex-rise rounded-xl border border-border bg-card p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <PersonBubble row={row} status={status} size="lg" className="mt-0.5" />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h2 id={`up-next-${row.id}`} className="min-w-0 break-words text-xl font-semibold leading-7 tracking-[-0.01em] text-foreground">
              <span className="font-medium text-muted-foreground">Up next: </span>
              {name}
            </h2>
            <StatusPill status={status} />
          </div>
          <p className="text-base leading-6 text-muted-foreground"><FactLine facts={facts} /></p>
        </div>
      </div>
      <NextStepCallout step={step} className="mt-4 max-w-2xl" />
      <div className="mt-4 flex flex-wrap gap-2">
        {callHref ? (
          <Button asChild size="lg" className="h-12 min-w-0 flex-1 px-4 text-base sm:flex-none sm:px-8">
            <a href={callHref} {...contactLinkProps(callHref)} aria-label={`Call ${name}`} onClick={open}>
              <Phone className="h-5 w-5" /> <span className="truncate">{label}</span>
            </a>
          </Button>
        ) : emailHref ? (
          <Button asChild size="lg" className="h-12 min-w-0 flex-1 px-4 text-base sm:flex-none sm:px-8">
            <a href={emailHref} aria-label={`Email ${name}`} onClick={open}>
              <Mail className="h-5 w-5" /> <span className="truncate">{label}</span>
            </a>
          </Button>
        ) : (
          <Button size="lg" className="h-12 min-w-0 flex-1 px-4 text-base sm:flex-none sm:px-8" onClick={open}>
            <span className="truncate">{label}</span>
          </Button>
        )}
        {(callHref || emailHref) && (
          <Button type="button" variant="outline" size="lg" className="h-12 shrink-0 border-border bg-background px-4 text-base sm:px-6" onClick={open}>
            See details
          </Button>
        )}
      </div>
    </section>
  );
}
