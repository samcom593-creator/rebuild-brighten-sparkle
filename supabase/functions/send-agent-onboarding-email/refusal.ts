// Pre-send refusal for this function's raw Resend POST (2026-11-11).
//
// send-agent-onboarding-email posts to api.resend.com/emails directly (it is on the RAW_REST
// list in scripts/check-resend-gate.mjs), so gateResend never saw its sends: a hire whose
// address hard-bounced, or whose profile sits on a placeholder domain, was mailed every time
// the hourly drain reached the row. This applies gateResend's two rules before the raw POST:
// a domain that cannot receive mail, and an address on Resend's suppression list (hard bounce
// or complaint, seen within RECHECK_DAYS). The caller records a refusal on the queue row.
//
// A failed lookup sends anyway, exactly like gateResend: the gate removes waste, and it must
// never be the reason a new hire misses an onboarding email because the database blinked.
import { lookupSuppressed } from "../_shared/suppression.ts";
import { nonRoutableDomain } from "../_shared/non-routable.ts";
import { REFUSED_NON_ROUTABLE, REFUSED_SUPPRESSED } from "../_shared/resend-gate.ts";

export interface Refusal {
  name: string;
  message: string;
}

export type SuppressionLookup = (emails: string[]) => Promise<Set<string> | null>;

export async function refusalFor(address: string, lookup: SuppressionLookup = lookupSuppressed): Promise<Refusal | null> {
  const addr = String(address ?? "").trim().toLowerCase();
  if (!addr) return null; // a missing address is the caller's own "profile email missing" branch
  if (nonRoutableDomain(addr)) {
    return { name: REFUSED_NON_ROUTABLE, message: "recipient domain cannot receive mail; not sent" };
  }
  const blocked = await lookup([addr]);
  if (blocked && blocked.has(addr)) {
    return { name: REFUSED_SUPPRESSED, message: "recipient is on Resend's suppression list (hard bounce or complaint); not sent" };
  }
  return null;
}
