// ClientContactLine — one line of client facts with a Call button, used on every
// Book of Business row so a client can be called and identified without opening
// anything. Sam (2026-10-16): client info has to be viewable in Book of Business,
// not hidden in a drawer or another page.
import { MessageSquare, Phone, PhoneOff } from "lucide-react";
import { contactLinkProps, formatPhoneDisplay, phoneHref, smsHref } from "@/lib/phone";
import { Skeleton } from "@/components/ui/skeleton";
import { ageFromDob, dobDisplay } from "@/lib/clientFacts";

export function ClientContactLine({ phone, dob, state, city, doNotCall, badNumber, bestTime, loading, failed }: {
  phone: string | null | undefined;
  dob: string | null | undefined;
  state?: string | null;
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
        <a href={callHref} {...contactLinkProps(callHref)} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90">
          <Phone className="h-3.5 w-3.5" aria-hidden /> Call {formatPhoneDisplay(phone)}
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
      {place && <span className="text-foreground">{place}</span>}
      {bestTime && <span>best time {bestTime}</span>}
    </div>
  );
}
