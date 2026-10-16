// ClientContactLine — one line of client facts with a Call button, used on every
// Book of Business row so a client can be called and identified without opening
// anything. Sam (2026-10-16): client info has to be viewable in Book of Business,
// not hidden in a drawer or another page.
import { MessageSquare, Phone, PhoneOff } from "lucide-react";
import { contactLinkProps, formatPhoneDisplay, phoneHref, smsHref } from "@/lib/phone";
import { Skeleton } from "@/components/ui/skeleton";
import { ageFromDob, dobDisplay } from "@/lib/clientFacts";

export function ClientContactLine({ phone, dob, state, city, doNotCall, bestTime, loading }: {
  phone: string | null | undefined;
  dob: string | null | undefined;
  state?: string | null;
  city?: string | null;
  doNotCall?: boolean | null;
  bestTime?: string | null;
  loading?: boolean;
}) {
  if (loading) return <Skeleton className="h-8 w-64 max-w-full" aria-label="Loading client details" />;
  const callHref = doNotCall ? null : phoneHref(phone);
  const textHref = doNotCall ? null : smsHref(phone);
  const age = ageFromDob(dob);
  const dobText = dobDisplay(dob);
  const place = [city, state].filter(Boolean).join(", ");
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
      {doNotCall ? (
        <span className="inline-flex h-8 items-center gap-1.5 rounded-md border border-red-400/40 bg-red-500/10 px-2.5 text-xs font-semibold text-red-700 dark:text-red-300">
          <PhoneOff className="h-3.5 w-3.5" aria-hidden /> Do not call
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
