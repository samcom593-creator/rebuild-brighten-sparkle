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
import { dropOwnerMuted, loadOwnerMute, REFUSED_OWNER_MUTED, type OwnerMutePolicy } from "./owner-mute.ts";

export const REFUSED_SUPPRESSED = "suppressed_recipient";
export const REFUSED_NON_ROUTABLE = "non_routable_recipient";
export const REFUSED_MALFORMED = "malformed_recipient";

const GATED = Symbol.for("apex.resendGate");

// deno-lint-ignore no-explicit-any
type AnySend = (payload: any, ...rest: any[]) => Promise<any>;
interface ResendLike { emails: { send: AnySend } }

export interface GateOptions {
  /** Override for tests. Same contract as lookupSuppressed: null = could not look. */
  lookup?: (emails: string[]) => Promise<Set<string> | null>;
  /** Override for tests. null = could not look, so nothing is muted. */
  ownerMute?: () => Promise<OwnerMutePolicy | null>;
}

/** "Name <a@b.com>" -> "a@b.com"; plain addresses pass through. Lower-cased. */
export function addressOf(recipient: unknown): string {
  const s = String(recipient ?? "").trim();
  const m = s.match(/<([^<>]+)>\s*$/);
  return (m ? m[1] : s).trim().toLowerCase();
}

/** True when the recipient carries something shaped like local@domain.tld. */
export function addressShaped(recipient: unknown): boolean {
  return /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;.]+$/.test(addressOf(recipient));
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

  const ownerMute = opts.ownerMute ?? (() => loadOwnerMute());

  // deno-lint-ignore no-explicit-any
  const gated: AnySend = async (original: any, ...rest: any[]) => {
    // deno-lint-ignore no-explicit-any
    let payload: any = original;
    const all: string[] = (Array.isArray(payload?.to) ? payload.to : [payload?.to])
      .map((r: unknown) => String(r ?? "").trim())
      .filter(Boolean);
    // Nothing to check: let Resend report its own validation error.
    if (all.length === 0) return inner(payload, ...rest);

    // Malformed addresses (2026-11-23). Resend validates every address on a
    // message and rejects the WHOLE message with a 422 when one is not an
    // address. A manager row pointed at a retired duplicate profile whose email
    // was the tombstone "DEDUP_<uuid>"; that went on the CC line of the login
    // email, so every "send login" for his 126 agents failed while the agent's
    // own address was fine. A courtesy copy must never block the real
    // recipient: anything on to, cc or bcc that is not shaped like an address
    // is dropped here, and the send is refused only when no real `to` is left.
    const good = all.filter(addressShaped);
    if (good.length === 0) {
      console.warn(`[resend-gate] refused ${all.map((r) => mask(addressOf(r))).join(", ")}: ${REFUSED_MALFORMED}`);
      return { data: null, error: { name: REFUSED_MALFORMED, message: "recipient is not an email address; not sent" } };
    }
    {
      // deno-lint-ignore no-explicit-any
      const clean = (field: any, label: string) => {
        if (field === undefined || field === null) return field;
        const list = Array.isArray(field) ? field : [field];
        const left = list.filter(addressShaped);
        if (left.length === list.length) return field;
        const bad = list.filter((r: unknown) => !addressShaped(r));
        console.warn(`[resend-gate] dropped malformed ${label} ${bad.map((r: unknown) => mask(addressOf(r))).join(", ")}`);
        return left.length === 0 ? undefined : Array.isArray(field) ? left : left[0];
      };
      const to = good.length < all.length ? clean(payload.to, "to") : payload.to;
      const cc = clean(payload.cc, "cc"), bcc = clean(payload.bcc, "bcc");
      if (to !== payload.to || cc !== payload.cc || bcc !== payload.bcc) {
        const next = { ...payload, to };
        if (cc === undefined) delete next.cc; else next.cc = cc;
        if (bcc === undefined) delete next.bcc; else next.bcc = bcc;
        payload = next;
      }
    }
    const recipients = good;

    // Owner inbox mute (owner-mute.ts): the owner is taken off to, cc and bcc
    // for the subjects he switched off. Everyone else on the message still gets it.
    const policy = await ownerMute();
    if (policy?.enabled) {
      const kept = dropOwnerMuted(policy, recipients, payload?.subject);
      if (kept.length === 0) {
        console.warn(`[resend-gate] owner mute: "${String(payload?.subject ?? "").slice(0, 60)}" not sent`);
        return { data: null, error: { name: REFUSED_OWNER_MUTED, message: "owner switched this notice off; not sent" } };
      }
      // deno-lint-ignore no-explicit-any
      const trim = (field: any) => {
        if (field === undefined || field === null) return field;
        const left = dropOwnerMuted(policy, Array.isArray(field) ? field : [field], payload?.subject);
        return left.length === 0 ? undefined : Array.isArray(field) ? left : left[0];
      };
      const cc = trim(payload.cc), bcc = trim(payload.bcc);
      if (kept.length < recipients.length || cc !== payload.cc || bcc !== payload.bcc) {
        const next = { ...payload, to: Array.isArray(payload.to) ? kept : kept[0] };
        if (cc === undefined) delete next.cc; else next.cc = cc;
        if (bcc === undefined) delete next.bcc; else next.bcc = bcc;
        payload = next;
      }
    }
    const raw = payload?.to;
    const wanted: string[] = (Array.isArray(raw) ? raw : [raw])
      .map((r: unknown) => String(r ?? "").trim())
      .filter(Boolean);

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
