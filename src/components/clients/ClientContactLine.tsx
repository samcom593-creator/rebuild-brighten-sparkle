// ClientContactLine — one line of client facts with a Call button, used on every
// Book of Business row so a client can be called and identified without opening
// anything. Sam (2026-10-16): client info has to be viewable in Book of Business,
// not hidden in a drawer or another page.
import { MessageSquare, Phone, PhoneOff } from "lucide-react";
import { contactLinkProps, formatPhoneDisplay, phoneHref, smsHref } from "@/lib/phone";
import { Skeleton } from "@/components/ui/skeleton";
import { ageFromDob, dobDisplay } from "@/lib/clientFacts";

export function ClientContactLine({ phone, dob, state, stateLikely = false, city, doNotCall, badNumber, bestTime, loading, failed }: {
  phone: string | null | undefined;
  dob: string | null | undefined;
  state?: string | null;
  /** OVERHAUL-states: the state is the phone's area code, not one on file, so it reads "likely". */
  stateLikely?: boolean;
  city?: string | null;
  doNotCall?: boolean | null;
  /** Marked Bad number in Book Flips: the number is shown, but not offered as a call. */
  badNumber?: boolean | null;
  bestTime?: string | null;
  loading?: boolean;
  /** The lookup failed, so "not on file" would be a guess; the page shows the error and a retry. */
  failed?: boolean;
}) {
  if (loading) return <Skeleton className="h-8 w-64 max-w-full" aria-label="Loading client details" />;
  if (failed) return <span className="text-xs text-destructive">Phone and date of birth did not load</span>;
  const callHref = doNotCall || badNumber ? null : phoneHref(phone);
  const textHref = doNotCall || badNumber ? null : smsHref(phone);
  const age = ageFromDob(dob);
  const dobText = dobDisplay(dob);
  const place = [city, state].filter(Boolean).join(", ");
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
      {doNotCall ? (
        <span className="inline-flex h-8 items-center gap-1.5 rounded-md border border-red-400/40 bg-red-500/10 px-2.5 text-xs font-semibold text-red-700 dark:text-red-300">
          <PhoneOff className="h-3.5 w-3.5" aria-hidden /> Do not call
        </span>
      ) : badNumber ? (
        <span className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-muted px-2.5 text-xs font-semibold text-foreground">
          <PhoneOff className="h-3.5 w-3.5" aria-hidden /> Bad number{phone ? ` · ${formatPhoneDisplay(phone)}` : ""}
        </span>
      ) : callHref ? (
        // OVERHAUL-book (2026-10-29): an outlined Call, not a gold one. Every row has a Call, and gold
        // is the one button a screen gets (DESIGN.md, The One Gold Button Rule); the phone icon in the
        // good tone still marks it as the way to reach the client.
        <a href={callHref} {...contactLinkProps(callHref)} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-sm font-semibold text-foreground hover:bg-muted">
          <Phone className="h-3.5 w-3.5 text-tone-good" aria-hidden /> Call {formatPhoneDisplay(phone)}
        </a>
      ) : (
        <span>No phone on file</span>
      )}
      {textHref && (
        <a href={textHref} {...contactLinkProps(textHref)} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs font-medium text-foreground hover:bg-muted">
          <MessageSquare className="h-3.5 w-3.5" aria-hidden /> Text
        </a>
      )}
      <span className="text-foreground">{dobText ? `DOB ${dobText}${age != null ? ` · ${age} yrs` : ""}` : "DOB not on file"}</span>
      {place && (
        <span className="text-foreground" title={stateLikely ? "No state is on file for this client; this is the state of the phone's area code." : undefined}>
          {place}
          {stateLikely && state ? <span className="text-muted-foreground"> · likely, by area code</span> : null}
        </span>
      )}
      {bestTime && <span>best time {bestTime}</span>}
    </div>
  );
}
