// The evidence pieces Easy Resells and Book Flips share (OVERHAUL-resells, 2026-10-29): the four tiles
// that count it and open its list, the chips on a card that say why it ranks where it does, the rank
// and score beside a name, and the plain-words legend of how the order works.
import { useId, useState, type ReactNode } from "react";
import { ChevronDown, Landmark, PhoneCall, PhoneIncoming, PhoneMissed, TriangleAlert } from "lucide-react";

import { GrowScoreboard, type ScoreTile } from "@/components/recruiting/GrowScoreboard";
import { TonePill } from "@/components/ui/delight/ToneBubble";
import {
  EVIDENCE_KEYS, EVIDENCE_META, NO_ANSWER_CALLS, POINTS, evidenceSummary, type Evidence, type EvidenceKey, type Signal,
} from "@/lib/resellEvidence";
import { TONE_CLASS, evidenceTone } from "@/lib/tones";
import { cn } from "@/lib/utils";

const ICON: Record<EvidenceKey, ReactNode> = {
  ssn_bank: <Landmark />,
  sold_call: <PhoneCall />,
  lapse: <TriangleAlert />,
  answered: <PhoneIncoming />,
};

function SignalIcon({ signal }: { signal: Signal }) {
  const cls = "h-3.5 w-3.5 shrink-0";
  if (signal.key === "answered" && signal.points < 0) return <PhoneMissed className={cls} aria-hidden />;
  const Icon = { ssn_bank: Landmark, sold_call: PhoneCall, lapse: TriangleAlert, answered: PhoneIncoming }[signal.key];
  return <Icon className={cls} aria-hidden />;
}

const pointsText = (n: number) => (n > 0 ? `+${n}` : `−${Math.abs(n)}`);

/** The chips on a card: one per piece of evidence, with its points, so the order explains itself. */
export function EvidenceChips({ evidence, emptyText = "No call evidence on file yet." }: { evidence: Evidence; emptyText?: string }) {
  if (evidence.signals.length === 0) {
    return <p className="text-[13px] leading-[18px] text-muted-foreground">{emptyText}</p>;
  }
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label={`Why it ranks here: ${evidenceSummary(evidence)}`}>
      {evidence.signals.map((s) => (
        <li key={s.key} title={s.detail}>
          <TonePill tone={s.tone} className="gap-1">
            <SignalIcon signal={s} />
            <span>{s.label}</span>
            <span className="tabular-nums opacity-80">{pointsText(s.points)}</span>
          </TonePill>
        </li>
      ))}
    </ul>
  );
}

/** Where a person sits in the list. The first one is the call to make now, in the brand gold tone. */
export function RankBadge({ rank }: { rank: number }) {
  const first = rank === 1;
  return (
    <span
      className={cn(
        "inline-flex h-8 min-w-8 shrink-0 items-center justify-center rounded-full border px-1.5 text-[15px] font-bold tabular-nums leading-none",
        first ? cn(TONE_CLASS.gold.soft, TONE_CLASS.gold.text, TONE_CLASS.gold.border) : "border-border bg-muted text-foreground",
      )}
    >
      <span aria-hidden="true">{rank}</span>
      {/* A plain span with aria-label is not read out; the words are. */}
      <span className="sr-only">Number {rank} in this list</span>
    </span>
  );
}

/** The score the chips add up to, beside the name. */
export function ScoreBadge({ evidence }: { evidence: Evidence }) {
  return (
    <span className="shrink-0 text-right" title={evidenceSummary(evidence)}>
      <span className="block text-lg font-bold leading-none tabular-nums text-foreground">{evidence.score < 0 ? `−${Math.abs(evidence.score)}` : evidence.score}</span>
      <span className="block text-[13px] leading-[18px] text-muted-foreground">{Math.abs(evidence.score) === 1 ? "point" : "points"}</span>
    </span>
  );
}

/**
 * Four tiles, one per kind of evidence, each counting the people in view who hold it and opening exactly
 * them. counts is null while the evidence loads or after it failed: every tile reads "—", never 0.
 * A kind the viewer is not allowed to see (SSN and bank, for anyone but admins and Aisha) stays "—"
 * and says why, because a zero would claim nobody gave them.
 */
export function EvidenceBoard({
  counts,
  active,
  onSelect,
  notice,
  hidden,
}: {
  counts: Record<EvidenceKey, number> | null;
  active: EvidenceKey | null;
  onSelect: (key: EvidenceKey | null) => void;
  notice?: ReactNode;
  hidden?: ReadonlySet<EvidenceKey>;
}) {
  const tiles: ScoreTile[] = EVIDENCE_KEYS.map((key) => {
    const meta = EVIDENCE_META[key];
    const off = hidden?.has(key) ?? false;
    const value = off || !counts ? null : counts[key];
    return {
      label: meta.title,
      value,
      hint: off ? "Only admins see this" : meta.hint,
      definition: `${meta.title}: ${meta.points}.`,
      tone: evidenceTone(key),
      icon: ICON[key],
      emphasis: key === "ssn_bank",
      active: active === key,
      onSelect: value === null ? undefined : () => onSelect(active === key ? null : key),
    };
  });
  return <GrowScoreboard label="Why people rank high" tiles={tiles} notice={notice} compactOnPhone />;
}

/**
 * The line above the list: how many are in it and in what order, with "How the order works" one tap
 * away on the same line (the legend opens under it). Without evidence there is no legend to show.
 */
export function RankedListHeader({ summary, tieBreak, ranked, only, onShowAll }: {
  summary: string;
  tieBreak: string;
  ranked: boolean;
  /** The evidence tile the list is narrowed to, if any; the line names it and offers the way back. */
  only?: EvidenceKey | null;
  onShowAll?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-x-3">
        <p className="min-w-0 text-sm text-muted-foreground" role="status">
          {summary}
          {only ? <> · only <span className="font-semibold text-foreground">{EVIDENCE_META[only].title}</span></> : null}
        </p>
        {only && onShowAll && (
          <button
            type="button"
            onClick={onShowAll}
            className="inline-flex min-h-11 shrink-0 items-center rounded-md text-sm font-semibold text-foreground underline underline-offset-4 focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)]"
          >
            Show everyone
          </button>
        )}
        {ranked && (
          <button
            type="button"
            aria-expanded={open}
            aria-controls={id}
            onClick={() => setOpen((o) => !o)}
            className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-md text-sm font-semibold text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)]"
          >
            How the order works
            <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground", open && "rotate-180")} aria-hidden />
          </button>
        )}
      </div>
      {ranked && open && <EvidenceLegend id={id} tieBreak={tieBreak} />}
    </div>
  );
}

/** How the order works, in plain words. */
export function EvidenceLegend({ tieBreak, id }: { tieBreak: string; id?: string }) {
  return (
    <div id={id} className="rounded-xl border border-border bg-card text-sm">
      <div className="space-y-2 px-4 py-3 text-muted-foreground">
        <p className="text-foreground">The people with the most evidence come first. Each piece adds points:</p>
        <ul className="space-y-1">
          <li><span className="font-semibold text-foreground">Gave SSN and bank</span> on a call: {POINTS.ssnBank}</li>
          <li><span className="font-semibold text-foreground">Sold on a ReadyMode call</span>: {POINTS.soldCall}</li>
          <li>
            <span className="font-semibold text-foreground">Lapse</span>: {POINTS.lapsePending} if the lapse is pending; {POINTS.lapsedWithin6} if
            it lapsed within 6 months of starting, {POINTS.lapsedWithin12} within a year, {POINTS.lapsed} earlier
          </li>
          <li>
            <span className="font-semibold text-foreground">Answered</span> a dialer call: {POINTS.answered}; {Math.abs(POINTS.noAnswer)} off
            when {NO_ANSWER_CALLS} or more calls went unanswered
          </li>
        </ul>
        <p>A match on the name only, on a different number, counts half: check it is the same person. Equal scores keep {tieBreak}.</p>
      </div>
    </div>
  );
}
