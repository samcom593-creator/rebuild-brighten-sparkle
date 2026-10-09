import { useMemo, useState } from "react";
import { ExternalLink, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  CHANGE_LABEL, VARIATION_HELP, VARIATION_LABEL, WINNER_RULE, measureWinners, platformLabel as platformName, remakeDraft,
  type RemakeChange, type RemakeDraft, type RemakeVariation, type ResultPost, type Winner,
} from "@/lib/contentWinners";

const FIELD = "min-h-[44px] w-full rounded-md border border-border bg-background px-3 text-sm text-foreground";
const formatName = (f: string) => (f === "long" ? "long-form" : "Short");

function WinnerRow({ winner, existing, busy, onRemake, onOpen, now }: {
  winner: Winner;
  /** Remake projects that already exist for this post, keyed by their idea key. */
  existing: ReadonlyMap<string, { id: string; title: string }>;
  busy: boolean;
  onRemake: (draft: RemakeDraft) => void;
  onOpen: (cardId: string) => void;
  now: Date;
}) {
  const [open, setOpen] = useState(false);
  const [variation, setVariation] = useState<RemakeVariation>("experiment");
  const [change, setChange] = useState<RemakeChange>("hook");
  const draft = useMemo(() => remakeDraft(winner, variation, change, now.toISOString()), [winner, variation, change, now]);
  const made = existing.get(draft.idea_key);
  const p = winner.post;
  return (
    <li className="rounded-lg border border-border bg-card p-4" aria-label={p.title ?? "Untitled post"}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-semibold text-muted-foreground">
        <span className="rounded-full border border-primary/50 bg-primary/10 px-2 py-0.5 text-foreground">{winner.ratio}x your usual</span>
        <span>{platformName(p.platform)}</span><span>· {formatName(p.format)}</span>
        <span>· {winner.ageDays} days of views</span>
      </div>
      <h3 className="mt-2 text-base font-semibold leading-snug text-foreground">
        {p.url ? <a href={p.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:underline">{p.title ?? "Untitled post"}<ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden /></a> : (p.title ?? "Untitled post")}
      </h3>
      <p className="mt-1 text-sm text-muted-foreground">{winner.basis}.</p>

      {!open ? (
        <Button variant="outline" className="mt-3 h-11" onClick={() => setOpen(true)} aria-label={`Remake this winner: ${p.title ?? "post"}`}>Remake this winner</Button>
      ) : (
        <div className="mt-3 space-y-3 rounded-md border border-border bg-muted/30 p-3" role="group" aria-label="Remake options">
          <fieldset className="space-y-1.5">
            <legend className="text-sm font-semibold text-foreground">What kind of remake?</legend>
            {(Object.keys(VARIATION_LABEL) as RemakeVariation[]).map((v) => (
              <label key={v} className="flex min-h-[44px] cursor-pointer items-start gap-2 text-sm text-foreground">
                <input type="radio" name={`variation-${p.id}`} checked={variation === v} onChange={() => setVariation(v)} className="mt-1 h-4 w-4" />
                <span><b>{VARIATION_LABEL[v]}</b><br /><span className="text-muted-foreground">{VARIATION_HELP[v]}</span></span>
              </label>
            ))}
          </fieldset>
          <label className="block text-sm text-muted-foreground">Change on purpose
            <select value={change} onChange={(e) => setChange(e.target.value as RemakeChange)} className={`${FIELD} mt-1 sm:w-64`}>
              {(Object.keys(CHANGE_LABEL) as RemakeChange[]).map((c) => <option key={c} value={c}>{CHANGE_LABEL[c]}</option>)}
            </select>
          </label>
          <p className="text-sm text-muted-foreground"><b className="text-foreground">Why this remake:</b> {draft.hypothesis}</p>
          <p className="text-sm text-muted-foreground"><b className="text-foreground">New draft:</b> {draft.title}. The original and its numbers stay exactly as they are.</p>
          <div className="flex flex-wrap gap-2">
            {made ? (
              <Button className="h-11" onClick={() => onOpen(made.id)}>Open the draft you already made</Button>
            ) : (
              <Button className="h-11" disabled={busy} onClick={() => onRemake(draft)}>
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null}Create the draft
              </Button>
            )}
            <Button variant="ghost" className="h-11" onClick={() => setOpen(false)}>Cancel</Button>
          </div>
        </div>
      )}
    </li>
  );
}

/**
 * "Remake a winner": only posts with real recorded views that clearly beat what that account normally gets for that
 * format. The rule, the sample behind each call and the gaps in the data are all on screen. When there is not enough
 * to judge, it says so and points at the manual way to add numbers; it never guesses.
 */
export function WinnersPanel({ posts, loading, failed, onRetry, cards, busy, onRemake, onOpenCard, onLogResults, now }: {
  posts: readonly ResultPost[];
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
  cards: readonly { id: string; title: string; brief?: Record<string, unknown> | null; archived_at?: string | null }[];
  busy: boolean;
  onRemake: (draft: RemakeDraft) => void;
  onOpenCard: (cardId: string) => void;
  onLogResults: () => void;
  now?: Date;
}) {
  const clock = useMemo(() => now ?? new Date(), [now]);
  const report = useMemo(() => measureWinners(posts, clock), [posts, clock]);
  const existing = useMemo(() => {
    const m = new Map<string, { id: string; title: string }>();
    for (const c of cards) { const k = c.brief?.idea_key; if (typeof k === "string" && k.startsWith("remake:") && !c.archived_at) m.set(k, { id: c.id, title: c.title }); }
    return m;
  }, [cards]);

  return (
    <section aria-label="Remake a winner" className="space-y-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-lg font-bold text-foreground">Remake a winner</h2>
        <p className="text-sm text-muted-foreground">
          A winner has at least {WINNER_RULE.minRatio}x the median views for its platform and format over the last {WINNER_RULE.lookbackDays} days, with {WINNER_RULE.minAgeDays.short} days of views for a Short or {WINNER_RULE.minAgeDays.long} for long-form, and at least {WINNER_RULE.minBaselinePosts} posts to compare against.
        </p>
      </div>

      {loading ? (
        <div className="rounded-lg border border-border p-4 text-sm text-muted-foreground" role="status">Loading your results…</div>
      ) : failed ? (
        <div className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-4 text-sm text-foreground" role="alert">
          Your results could not be loaded, so no winners are shown. <button type="button" className="font-semibold underline" onClick={onRetry}>Retry</button>
        </div>
      ) : report.winners.length === 0 ? (
        <div className="space-y-2 rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">{posts.length === 0 ? "No results are recorded yet." : "No post has clearly beaten its normal range yet."}</p>
          {report.unmeasured.length > 0 ? (
            <p>Not enough posts to judge: {report.unmeasured.map((g) => `${platformName(g.platform)} ${formatName(g.format)} (${g.have} of ${g.need})`).join(", ")}.</p>
          ) : null}
          {report.tooNew > 0 ? <p>{report.tooNew} recent {report.tooNew === 1 ? "post is" : "posts are"} too new to judge.</p> : null}
          {report.missingViews > 0 ? <p>{report.missingViews} {report.missingViews === 1 ? "post has" : "posts have"} no view count recorded.</p> : null}
          <p>YouTube fills itself in. For other platforms, log the numbers by hand.</p>
          <Button variant="outline" className="h-11" onClick={onLogResults}>Log results by hand</Button>
        </div>
      ) : (
        <>
          <ol className="grid gap-3 lg:grid-cols-2">
            {report.winners.map((w) => (
              <WinnerRow key={w.post.id} winner={w} existing={existing} busy={busy} onRemake={onRemake} onOpen={onOpenCard} now={clock} />
            ))}
          </ol>
          {report.unmeasured.length > 0 ? <p className="text-sm text-muted-foreground">Not enough posts to judge yet: {report.unmeasured.map((g) => `${platformName(g.platform)} ${formatName(g.format)} (${g.have} of ${g.need})`).join(", ")}.</p> : null}
        </>
      )}
    </section>
  );
}
