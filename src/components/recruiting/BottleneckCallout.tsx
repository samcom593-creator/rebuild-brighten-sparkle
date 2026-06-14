// BottleneckCallout — amber "fix this first" card pinned ABOVE the funnel.
//
// Per judge Proposal B + Proposal A graft: the punchline goes BEFORE the
// data so Sam reads the answer first. Amber tint earns its keep as the
// "fix this" signal (Proposal C graft) — color is the alert, not decor.

interface BottleneckCalloutProps {
  /** Big amber headline (e.g. "Ref-link clicks ▼ 14 vs last week"). */
  headline: string;
  /** Short coaching sentence (e.g. "Fix this first."). */
  coachingLine: string;
}

export function BottleneckCallout({
  headline,
  coachingLine,
}: BottleneckCalloutProps) {
  return (
    <div className="rounded-3xl bg-amber-500/10 border border-amber-500/20 px-5 py-4">
      <div className="text-[11px] uppercase tracking-wider text-amber-300/80 font-semibold">
        Biggest drop this week
      </div>
      <div className="text-lg font-bold text-amber-100 mt-1">{headline}</div>
      <div className="text-sm text-amber-200/70 mt-1">{coachingLine}</div>
    </div>
  );
}
