// Resell evidence (OVERHAUL-resells, 2026-10-29): why one person is an easier resell than the next.
//
// Sam: "Easy Resells and Book Flips: cleaner cards, and rank opportunities by evidence (recently
// lapsed, a sold ReadyMode call on file, gave SSN and bank, reachable phone). Show why each one ranks
// where it does."
//
// Four kinds of evidence, each worth a fixed number of points, and a person's score is the sum, so the
// order can always be explained by the chips on the card:
//   Gave SSN and bank      40  a booking packet holding both, or a transcript where they said both
//   Sold on a call         30  a ReadyMode call to this number ended in "Completed Sale"
//   Lapse                  25  lapse pending (a missed payment; it can still be saved)
//                          20  lapsed, and the policy started in the last 6 months, so it lapsed in that time
//                          15  lapsed, policy started in the last 12 months
//                          10  lapsed earlier, or the book does not say when it started
//   Answered               15  somebody answered a dialer call to this number
//                         -10  the dialer called 3 or more times and nobody ever answered
// The book never records the day a policy lapsed, only its status at the last import, so "recently" is
// measured from the day the policy started: a policy that started 4 months ago and is now lapsed lapsed
// within those 4 months. The chip says exactly that ("Lapsed within 4 months"), never a date it does not know.
//
// A match on the name alone (same first and last name, a different number) counts half: it is probably
// the same person, and the chip says "same name" so the caller checks. The evidence comes from
// public.resell_evidence(), which reads the dialer as the viewer (RLS), so a viewer only ever ranks on
// calls they are allowed to see.
import { evidenceTone, type Tone } from "@/lib/tones";

/** One row of public.resell_evidence(): what the dialer and the sold-call packets hold for one number or one name. */
export interface EvidenceRow {
  kind: "phone" | "name";
  match_key: string;
  /** Dialer calls to this number (null for a name). */
  dials: number | null;
  /** Of those, the calls somebody answered (any disposition but "Not Available"). */
  answered: number | null;
  last_answered_at: string | null;
  sold_calls: number;
  last_sold_at: string | null;
  gave_ssn_and_bank: boolean;
}

export interface EvidenceIndex {
  phones: ReadonlyMap<string, EvidenceRow>;
  names: ReadonlyMap<string, EvidenceRow>;
}

export const EMPTY_EVIDENCE: EvidenceIndex = { phones: new Map(), names: new Map() };

export type EvidenceKey = "ssn_bank" | "sold_call" | "lapse" | "answered";

/** The four kinds, in the order the chips, the tiles and the legend show them (strongest first). */
export const EVIDENCE_KEYS: readonly EvidenceKey[] = ["ssn_bank", "sold_call", "lapse", "answered"];

export const POINTS = {
  ssnBank: 40,
  soldCall: 30,
  lapsePending: 25,
  lapsedWithin6: 20,
  lapsedWithin12: 15,
  lapsed: 10,
  answered: 15,
  noAnswer: -10,
} as const;

/** Calls with nobody answering before a number counts against a person. */
export const NO_ANSWER_CALLS = 3;

/** The ten-digit key the dialer files a number under (lead_phone10): the last ten digits, or "" with fewer than ten. */
export function phoneKey(phone: string | null | undefined): string {
  const d = (phone ?? "").replace(/\D/g, "");
  return d.length >= 10 ? d.slice(-10) : "";
}

const alnum = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * The key the dialer files a caller's name under (lead_name_key): first and last name, lower case,
 * letters and digits only. First and last when both are known, otherwise the full name. "" when it is
 * shorter than six characters, too short to tell two people apart (the same floor as the database).
 */
export function nameKey(first: string | null | undefined, last: string | null | undefined, full?: string | null): string {
  const f = (first ?? "").trim();
  const l = (last ?? "").trim();
  const key = f && l ? alnum(f + l) : alnum(full ?? "");
  return key.length >= 6 ? key : "";
}

export function indexEvidence(rows: readonly EvidenceRow[]): EvidenceIndex {
  const phones = new Map<string, EvidenceRow>();
  const names = new Map<string, EvidenceRow>();
  for (const r of rows) {
    if (!r?.match_key) continue;
    (r.kind === "phone" ? phones : names).set(r.match_key, r);
  }
  return { phones, names };
}

export interface Signal {
  key: EvidenceKey;
  /** Negative only for a number nobody answers. */
  points: number;
  /** The words on the chip. */
  label: string;
  /** One sentence for the tooltip and screen readers. */
  detail: string;
  tone: Tone;
  /** Matched on the name only, on a different number. */
  byNameOnly?: boolean;
}

export interface Evidence {
  score: number;
  /** In EVIDENCE_KEYS order; at most one per kind. */
  signals: Signal[];
}

export const NO_EVIDENCE: Evidence = { score: 0, signals: [] };

export interface EvidenceSubject {
  phone: string | null | undefined;
  firstName?: string | null;
  lastName?: string | null;
  fullName?: string | null;
  /**
   * Set only when the row is a lapsing policy (Book Flips status group "lapsing", Easy Resells bucket
   * "lapsing"): the book's status ("Lapse Pending", "Lapsed") and the day the policy started.
   */
  lapse?: { status: string | null | undefined; startedOn: string | null | undefined } | null;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "Sep 21" this year, "Sep 21, 2025" otherwise; "" when the date cannot be read. Phoenix time, where Sam works. */
export function evidenceDay(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const year = (x: Date) => x.toLocaleDateString("en-US", { timeZone: "America/Phoenix", year: "numeric" });
  return d.toLocaleDateString("en-US", {
    timeZone: "America/Phoenix",
    month: "short",
    day: "numeric",
    ...(year(d) === year(now) ? {} : { year: "numeric" }),
  });
}

/** A stored date (YYYY-MM-DD, or an ISO time) as a day, without moving it across time zones. */
function parseDay(s: string | null | undefined): Date | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12));
  return Number.isNaN(d.getTime()) ? null : d;
}

const DAY_MS = 86_400_000;
const MONTH_DAYS = 30.4375;

/**
 * Whole months from a policy's start to now, rounded up so "lapsed within N months" is always true.
 * null when the start is unreadable or in the future.
 */
export function monthsSinceStart(startedOn: string | null | undefined, now: Date = new Date()): number | null {
  const start = parseDay(startedOn);
  if (!start) return null;
  const days = (now.getTime() - start.getTime()) / DAY_MS;
  if (days < 0) return null;
  return Math.max(1, Math.ceil(days / MONTH_DAYS));
}

function startedText(startedOn: string | null | undefined): string {
  const d = parseDay(startedOn);
  return d ? d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "";
}

export function lapseSignal(lapse: EvidenceSubject["lapse"], now: Date = new Date()): Signal | null {
  if (!lapse) return null;
  const tone = evidenceTone("lapse");
  const status = (lapse.status ?? "").trim().toLowerCase();
  if (/pending|grace/.test(status)) {
    return {
      key: "lapse", points: POINTS.lapsePending, label: "Lapse pending", tone,
      detail: "A payment was missed and the policy has not dropped yet. A call now can save it.",
    };
  }
  const months = monthsSinceStart(lapse.startedOn, now);
  const started = startedText(lapse.startedOn);
  if (months !== null && months <= 12) {
    return {
      key: "lapse",
      points: months <= 6 ? POINTS.lapsedWithin6 : POINTS.lapsedWithin12,
      label: `Lapsed within ${plural(months, "month")}`,
      detail: `The policy started ${started}, so it lapsed in the last ${plural(months, "month")}.`,
      tone,
    };
  }
  return {
    key: "lapse", points: POINTS.lapsed, label: "Lapsed", tone,
    detail: started ? `The policy started ${started}, more than a year ago, and has lapsed.` : "The policy has lapsed. The book does not say when it started.",
  };
}

/** Everything the evidence says about one person, and the score it adds up to. */
export function evidenceFor(subject: EvidenceSubject, index: EvidenceIndex, now: Date = new Date()): Evidence {
  const pk = phoneKey(subject.phone);
  const nk = nameKey(subject.firstName, subject.lastName, subject.fullName);
  const ph = pk ? index.phones.get(pk) : undefined;
  const nm = nk ? index.names.get(nk) : undefined;
  const signals: Signal[] = [];

  if (ph?.gave_ssn_and_bank) {
    signals.push({
      key: "ssn_bank", points: POINTS.ssnBank, label: "Gave SSN and bank", tone: evidenceTone("ssn_bank"),
      detail: "They gave their SSN and bank details on a call to this number.",
    });
  } else if (nm?.gave_ssn_and_bank) {
    signals.push({
      key: "ssn_bank", points: POINTS.ssnBank / 2, label: "Gave SSN and bank · same name", tone: evidenceTone("ssn_bank"), byNameOnly: true,
      detail: "Somebody with the same name gave SSN and bank on a call from a different number. Check it is the same person.",
    });
  }

  if (ph && ph.sold_calls > 0) {
    const day = evidenceDay(ph.last_sold_at, now);
    signals.push({
      key: "sold_call", points: POINTS.soldCall, label: day ? `Sold on a call ${day}` : "Sold on a call", tone: evidenceTone("sold_call"),
      detail: `A ReadyMode call to this number ended in a sale (${plural(ph.sold_calls, "sale")}).`,
    });
  } else if (nm && nm.sold_calls > 0) {
    signals.push({
      key: "sold_call", points: POINTS.soldCall / 2, label: "Sold on a call · same name", tone: evidenceTone("sold_call"), byNameOnly: true,
      detail: "A ReadyMode sale is on file for somebody with the same name on a different number. Check it is the same person.",
    });
  }

  const lapse = lapseSignal(subject.lapse, now);
  if (lapse) signals.push(lapse);

  const answered = ph?.answered ?? 0;
  const dials = ph?.dials ?? 0;
  if (answered > 0) {
    const day = evidenceDay(ph?.last_answered_at, now);
    signals.push({
      key: "answered", points: POINTS.answered, label: day ? `Answered ${day}` : "Answered before", tone: evidenceTone("answered"),
      detail: `Somebody answered a dialer call to this number (${answered} of ${plural(dials, "call")}).`,
    });
  } else if (dials >= NO_ANSWER_CALLS) {
    signals.push({
      key: "answered", points: POINTS.noAnswer, label: `No answer in ${plural(dials, "call")}`, tone: evidenceTone("none"),
      detail: `The dialer called this number ${plural(dials, "time")} and nobody answered.`,
    });
  }

  return { score: signals.reduce((s, x) => s + x.points, 0), signals };
}

/** True when the evidence holds this kind and it counts in the person's favour (a number nobody answers does not). */
export function hasEvidence(e: Evidence, key: EvidenceKey): boolean {
  return e.signals.some((s) => s.key === key && s.points > 0);
}

/** How many of these people hold each kind of evidence (the tiles), so a tile equals the list it opens. */
export function evidenceCounts(list: readonly Evidence[]): Record<EvidenceKey, number> {
  const out: Record<EvidenceKey, number> = { ssn_bank: 0, sold_call: 0, lapse: 0, answered: 0 };
  for (const e of list) for (const k of EVIDENCE_KEYS) if (hasEvidence(e, k)) out[k] += 1;
  return out;
}

/** "70 points: gave SSN and bank 40, sold on a call Sep 21 30." for screen readers and tooltips. */
export function evidenceSummary(e: Evidence): string {
  if (e.signals.length === 0) return "0 points: no call evidence on file.";
  const parts = e.signals.map((s) => `${s.label.charAt(0).toLowerCase()}${s.label.slice(1)} ${s.points > 0 ? s.points : `minus ${Math.abs(s.points)}`}`);
  return `${plural(e.score, "point")}: ${parts.join(", ")}.`;
}

/** The words for each kind on the tiles and in the legend. */
export const EVIDENCE_META: Record<EvidenceKey, { title: string; hint: string; points: string }> = {
  ssn_bank: {
    title: "Gave SSN and bank",
    hint: "Handed both over on a call",
    points: `${POINTS.ssnBank} points`,
  },
  sold_call: {
    title: "Sold on a call",
    hint: "A ReadyMode sale is on file",
    points: `${POINTS.soldCall} points`,
  },
  lapse: {
    title: "Lapsing",
    hint: "Missed a payment: save or rewrite",
    points: `${POINTS.lapsePending} if lapse pending; ${POINTS.lapsedWithin6} if it lapsed within 6 months of starting, ${POINTS.lapsedWithin12} within a year, ${POINTS.lapsed} earlier`,
  },
  answered: {
    title: "Answers the phone",
    hint: "Picked up a dialer call before",
    points: `${POINTS.answered} points; ${Math.abs(POINTS.noAnswer)} off when ${NO_ANSWER_CALLS} or more calls went unanswered`,
  },
};
