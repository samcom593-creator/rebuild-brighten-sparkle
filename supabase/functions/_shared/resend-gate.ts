// Every Resend SDK send goes through the suppression gate.
//
// PL-WIB-RESEND-GATE (2026-10-22). 3c9d136f put the email_suppressions check
// inside sendEmail (_shared/email.ts), and 11 functions call sendEmail. 82
// more construct the SDK themselves and call resend.emails.send, so the gate
// never saw them. On 10-22, the first full day of the gate, three addresses
// already in email_suppressions were mailed anyway, by send-followup-emails,
// next-step-dispatch and send-notification, and Resend suppressed all three.
//
// Wrapping the instance keeps each file's own SDK import (no new dependency,
// no second SDK copy in a bundle) and changes one line per file:
//   const resend = gateResend(new Resend(Deno.env.get("RESEND_API_KEY")));
// scripts/check-resend-gate.mjs fails CI on a new unwrapped `new Resend(`.
//
// Recipients that are suppressed or non-routable are dropped from `to`. If
// none are left, the send resolves { data: null, error } like any other SDK
// failure, so a caller that logs errors records it as not sent. It never
// returns an id for a send that did not happen. A failed lookup sends anyway
// (see suppression.ts): this gate removes waste, it must never be the reason
// an applicant misses a mail because the DB blinked.

import { lookupSuppressed } from "./suppression.ts";
import { nonRoutableDomain } from "./non-routable.ts";

export const REFUSED_SUPPRESSED = "suppressed_recipient";
export const REFUSED_NON_ROUTABLE = "non_routable_recipient";

const GATED = Symbol.for("apex.resendGate");

// deno-lint-ignore no-explicit-any
type AnySend = (payload: any, ...rest: any[]) => Promise<any>;
interface ResendLike { emails: { send: AnySend } }

export interface GateOptions {
  /** Override for tests. Same contract as lookupSuppressed: null = could not look. */
  lookup?: (emails: string[]) => Promise<Set<string> | null>;
}

/** "Name <a@b.com>" -> "a@b.com"; plain addresses pass through. Lower-cased. */
export function addressOf(recipient: unknown): string {
  const s = String(recipient ?? "").trim();
  const m = s.match(/<([^<>]+)>\s*$/);
  return (m ? m[1] : s).trim().toLowerCase();
}

function mask(addr: string): string {
  const [u, d] = addr.split("@");
  return d ? `${u.slice(0, 3)}***@${d}` : `${u.slice(0, 3)}***`;
}

export function gateResend<T extends ResendLike | null | undefined>(client: T, opts: GateOptions = {}): T {
  if (!client || !client.emails || typeof client.emails.send !== "function") return client;
  // deno-lint-ignore no-explicit-any
  const emails = client.emails as any;
  if (emails[GATED]) return client;
  const inner: AnySend = client.emails.send.bind(client.emails);
  const lookup = opts.lookup ?? ((list: string[]) => lookupSuppressed(list));

  // deno-lint-ignore no-explicit-any
  const gated: AnySend = async (payload: any, ...rest: any[]) => {
    const raw = payload?.to;
    const wanted: string[] = (Array.isArray(raw) ? raw : [raw])
      .map((r: unknown) => String(r ?? "").trim())
      .filter(Boolean);
    // Nothing to check: let Resend report its own validation error.
    if (wanted.length === 0) return inner(payload, ...rest);

    const routable = wanted.filter((r) => !nonRoutableDomain(addressOf(r)));
    const blocked = routable.length ? await lookup(routable.map(addressOf)) : new Set<string>();
    const deliverable = blocked ? routable.filter((r) => !blocked.has(addressOf(r))) : routable;

    if (deliverable.length === 0) {
      const name = routable.length === 0 ? REFUSED_NON_ROUTABLE : REFUSED_SUPPRESSED;
      const message = name === REFUSED_SUPPRESSED
        ? "recipient is on Resend's suppression list (hard bounce or complaint); not sent"
        : "recipient domain cannot receive mail; not sent";
      console.warn(`[resend-gate] refused ${wanted.map((r) => mask(addressOf(r))).join(", ")}: ${name}`);
      return { data: null, error: { name, message } };
    }
    if (deliverable.length < wanted.length) {
      const dropped = wanted.filter((r) => !deliverable.includes(r));
      console.warn(`[resend-gate] dropped ${dropped.map((r) => mask(addressOf(r))).join(", ")} from a ${wanted.length}-recipient send`);
      return inner({ ...payload, to: Array.isArray(raw) ? deliverable : deliverable[0] }, ...rest);
    }
    return inner(payload, ...rest);
  };

  emails.send = gated;
  emails[GATED] = true;
  return client;
}
