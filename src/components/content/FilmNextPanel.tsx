import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DEFAULT_FILTERS, FORMAT_LABEL, LANE_LABEL, PLACE_LABEL, TIME_OPTIONS, activeFilterCount, ownIdea, selectPicks,
  type IdeaEdits, type Lane, type PickFormat, type PickFilters, type PickIdea, type Place, type Platform,
} from "@/lib/contentPicks";
import type { Dismissal } from "@/lib/contentProjects";

const FIELD = "min-h-[44px] w-full rounded-md border border-border bg-background px-3 text-sm text-foreground";
const FILTERS_KEY = "lb:picks:v1";

function loadFilters(): PickFilters {
  try {
    const raw = localStorage.getItem(FILTERS_KEY);
    if (!raw) return DEFAULT_FILTERS;
    const v = JSON.parse(raw) as Partial<PickFilters>;
    return { ...DEFAULT_FILTERS, ...v };
  } catch { return DEFAULT_FILTERS; } // empty-catch-allow:localstorage-incognito
}

function minutesText(m: number): string {
  return m >= 120 ? `About ${Math.round(m / 60)} hours to film` : `About ${m} minutes to film`;
}
const placesText = (p: Place[]) => (p.includes("anywhere") && p.length === 1 ? "Film it anywhere" : p.map((x) => PLACE_LABEL[x]).join(", "));

function PickCard({ idea, busy, onFilm, onDismiss }: {
  idea: PickIdea; busy: boolean;
  onFilm: (edits?: IdeaEdits) => void;
  onDismiss: (reason: string) => void;
}) {
  const [mode, setMode] = useState<"view" | "edit" | "dismiss">("view");
  const [edits, setEdits] = useState<Required<IdeaEdits>>({ title: idea.title, hook: idea.hook, premise: idea.premise });
  const [reason, setReason] = useState("");
  return (
    <li className="rounded-lg border border-border bg-card p-4" aria-label={idea.title}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-semibold text-muted-foreground">
        <span className="rounded-full border border-border px-2 py-0.5 text-foreground">{LANE_LABEL[idea.lane]}</span>
        <span>{FORMAT_LABEL[idea.format]}{idea.kind === "vlog" ? " vlog" : ""}</span>
        <span>· {minutesText(idea.minutes)}</span>
        <span>· {placesText(idea.locations)}</span>
      </div>

      {mode === "edit" ? (
        <div className="mt-3 space-y-3">
          <label className="block text-sm text-muted-foreground">Title
            <input value={edits.title} onChange={(e) => setEdits({ ...edits, title: e.target.value })} className={`${FIELD} mt-1`} maxLength={200} />
          </label>
          <label className="block text-sm text-muted-foreground">Opening line
            <input value={edits.hook} onChange={(e) => setEdits({ ...edits, hook: e.target.value })} className={`${FIELD} mt-1`} maxLength={300} />
          </label>
          <label className="block text-sm text-muted-foreground">What it is about
            <textarea value={edits.premise} onChange={(e) => setEdits({ ...edits, premise: e.target.value })} rows={3} className={`${FIELD} mt-1 py-2`} maxLength={600} />
          </label>
          <div className="flex flex-wrap gap-2">
            <Button className="h-11" disabled={busy || !edits.title.trim()} onClick={() => onFilm(edits)} aria-label={`Film this with my changes: ${edits.title}`}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null}Film this with my changes
            </Button>
            <Button variant="ghost" className="h-11" disabled={busy} onClick={() => { setEdits({ title: idea.title, hook: idea.hook, premise: idea.premise }); setMode("view"); }}>Cancel</Button>
          </div>
        </div>
      ) : (
        <>
          <h3 className="mt-2 text-lg font-semibold leading-snug text-foreground">{idea.title}</h3>
          <p className="mt-1 text-sm text-foreground">{idea.premise}</p>
          {idea.payoff ? <p className="mt-2 text-sm text-muted-foreground"><b className="text-foreground">The viewer gets:</b> {idea.payoff}</p> : null}
          <p className="mt-1 text-sm text-muted-foreground"><b className="text-foreground">Opens with:</b> “{idea.hook}”</p>
          <p className="mt-1 text-sm text-muted-foreground"><b className="text-foreground">Why it fits:</b> {idea.why}</p>
          {idea.inspiredBy && (idea.inspiredBy.channel || idea.inspiredBy.title) ? (
            <p className="mt-1 text-sm text-muted-foreground">Inspired by {idea.inspiredBy.channel ?? "a top video"}{idea.inspiredBy.views != null ? `, ${idea.inspiredBy.views.toLocaleString("en-US")} views` : ""}.</p>
          ) : null}
        </>
      )}

      {mode === "dismiss" ? (
        <div className="mt-3 space-y-2 rounded-md border border-border bg-muted/30 p-3">
          <label className="block text-sm text-muted-foreground">Why not? (optional)
            <input value={reason} onChange={(e) => setReason(e.target.value)} className={`${FIELD} mt-1`} maxLength={300} placeholder="Not my lane, done it already, wrong time of year" />
          </label>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" className="h-11" disabled={busy} onClick={() => onDismiss(reason)} aria-label={`Dismiss: ${idea.title}`}>Dismiss it</Button>
            <Button variant="ghost" className="h-11" disabled={busy} onClick={() => { setReason(""); setMode("view"); }}>Keep it</Button>
          </div>
        </div>
      ) : mode === "view" ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button className="h-11" disabled={busy} onClick={() => onFilm()} aria-label={`Film this: ${idea.title}`}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null}Film this
          </Button>
          <Button variant="outline" className="h-11" disabled={busy} onClick={() => setMode("edit")} aria-label={`Edit before filming: ${idea.title}`}>Edit</Button>
          <Button variant="ghost" className="h-11" disabled={busy} onClick={() => setMode("dismiss")} aria-label={`Not for me: ${idea.title}`}>Not for me</Button>
        </div>
      ) : null}
    </li>
  );
}

/**
 * "Film next": three strong, distinct picks, filtered by platform, format, topic, time and place. Choosing, editing,
 * dismissing and filtering all run on saved ideas with no model call. The filters are remembered on this device.
 */
export function FilmNextPanel({ ideas, used, dismissed, dismissalsFailed, busyKey, onFilm, onSaveLater, onDismiss, onBringBack }: {
  ideas: readonly PickIdea[];
  used: ReadonlySet<string>;
  dismissed: readonly Dismissal[];
  dismissalsFailed: boolean;
  /** The idea key currently being saved. Every button waits while one is in flight, so a double tap cannot double-save. */
  busyKey: string | null;
  onFilm: (idea: PickIdea, edits?: IdeaEdits) => void;
  onSaveLater: (idea: PickIdea) => void;
  onDismiss: (idea: PickIdea, reason: string) => void;
  onBringBack: (ideaKey: string) => void;
}) {
  const [filters, setFilters] = useState<PickFilters>(loadFilters);
  const [more, setMore] = useState(false);
  const [ownOpen, setOwnOpen] = useState(false);
  const [own, setOwn] = useState<{ title: string; hook: string; premise: string; format: PickFormat }>({ title: "", hook: "", premise: "", format: "short" });
  useEffect(() => {
    try { localStorage.setItem(FILTERS_KEY, JSON.stringify(filters)); }
    catch { /* ignore quota / disabled storage */ } // empty-catch-allow:localstorage-incognito
  }, [filters]);

  const dismissedKeys = useMemo(() => new Set(dismissed.map((d) => d.idea_key)), [dismissed]);
  const { picks, matched, note } = useMemo(() => selectPicks(ideas, filters, { dismissed: dismissedKeys, used }), [ideas, filters, dismissedKeys, used]);
  const active = activeFilterCount(filters);
  const set = <K extends keyof PickFilters>(k: K, v: PickFilters[K]) => setFilters((f) => ({ ...f, [k]: v }));
  const anyBusy = busyKey !== null;
  const ownId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`);
  const ownReady = own.title.trim().length > 0;

  return (
    <section aria-label="Film next" className="space-y-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-lg font-bold text-foreground">Film next</h2>
        <p className="text-sm text-muted-foreground">Three picks from your saved ideas. Change a filter and they change. Nothing here uses AI.</p>
        <Button variant="outline" size="sm" className="ml-auto h-10 gap-1.5" onClick={() => setOwnOpen((v) => !v)} aria-expanded={ownOpen}><Plus className="h-4 w-4" aria-hidden />Write my own idea</Button>
      </div>

      {ownOpen ? (
        <div className="space-y-3 rounded-lg border border-primary/40 bg-card p-4" role="group" aria-label="Write my own idea">
          <label className="block text-sm text-muted-foreground">Title
            <input value={own.title} onChange={(e) => setOwn({ ...own, title: e.target.value })} className={`${FIELD} mt-1`} maxLength={200} placeholder="What is the video called?" />
          </label>
          <label className="block text-sm text-muted-foreground">Opening line (optional)
            <input value={own.hook} onChange={(e) => setOwn({ ...own, hook: e.target.value })} className={`${FIELD} mt-1`} maxLength={300} />
          </label>
          <label className="block text-sm text-muted-foreground">What it is about (optional)
            <textarea value={own.premise} onChange={(e) => setOwn({ ...own, premise: e.target.value })} rows={2} className={`${FIELD} mt-1 py-2`} maxLength={600} />
          </label>
          <label className="block text-sm text-muted-foreground">Format
            <select value={own.format} onChange={(e) => setOwn({ ...own, format: e.target.value as PickFormat })} className={`${FIELD} mt-1 sm:w-48`}>
              <option value="short">Short</option>
              <option value="long">Long-form</option>
            </select>
          </label>
          <div className="flex flex-wrap gap-2">
            <Button className="h-11" disabled={!ownReady || anyBusy} onClick={() => { const i = ownIdea(own, ownId()); onFilm(i); setOwn({ title: "", hook: "", premise: "", format: "short" }); setOwnOpen(false); }}>Film this</Button>
            <Button variant="outline" className="h-11" disabled={!ownReady || anyBusy} onClick={() => { const i = ownIdea(own, ownId()); onSaveLater(i); setOwn({ title: "", hook: "", premise: "", format: "short" }); setOwnOpen(false); }}>Save for later</Button>
          </div>
        </div>
      ) : null}

      <div className="space-y-2" role="group" aria-label="Filter the picks">
        <div className="grid gap-2 sm:grid-cols-3">
          <label className="text-xs text-muted-foreground">Platform
            <select value={filters.platform} onChange={(e) => set("platform", e.target.value as PickFilters["platform"])} className={`${FIELD} mt-0.5`}>
              <option value="any">Any platform</option>
              {(["YouTube", "Instagram", "TikTok"] as Platform[]).map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
          <label className="text-xs text-muted-foreground">Format
            <select value={filters.format} onChange={(e) => set("format", e.target.value as PickFilters["format"])} className={`${FIELD} mt-0.5`}>
              <option value="any">Long-form and Shorts</option>
              <option value="long">Long-form</option>
              <option value="short">Shorts</option>
            </select>
          </label>
          <label className="text-xs text-muted-foreground">Topic
            <select value={filters.lane} onChange={(e) => set("lane", e.target.value as PickFilters["lane"])} className={`${FIELD} mt-0.5`}>
              <option value="any">Any topic</option>
              {(Object.keys(LANE_LABEL) as Lane[]).map((l) => <option key={l} value={l}>{LANE_LABEL[l]}</option>)}
            </select>
          </label>
        </div>
        <button type="button" onClick={() => setMore((v) => !v)} aria-expanded={more} className="inline-flex min-h-[40px] items-center gap-1 text-sm font-semibold text-muted-foreground hover:text-foreground">
          <ChevronDown className={`h-4 w-4 transition-transform ${more ? "rotate-180" : ""}`} aria-hidden />
          {more ? "Fewer filters" : "Time and place"}
        </button>
        {more ? (
          <div className="grid gap-2 sm:grid-cols-3">
            <label className="text-xs text-muted-foreground">Time to film
              <select value={String(filters.minutes)} onChange={(e) => set("minutes", e.target.value === "any" ? "any" : Number(e.target.value))} className={`${FIELD} mt-0.5`}>
                <option value="any">Any amount of time</option>
                {TIME_OPTIONS.map((t) => <option key={t.value} value={t.value}>Up to {t.label}</option>)}
              </select>
            </label>
            <label className="text-xs text-muted-foreground">Where I am
              <select value={filters.place} onChange={(e) => set("place", e.target.value as PickFilters["place"])} className={`${FIELD} mt-0.5`}>
                <option value="any">Anywhere</option>
                {(Object.keys(PLACE_LABEL) as Place[]).filter((p) => p !== "anywhere").map((p) => <option key={p} value={p}>{PLACE_LABEL[p]}</option>)}
              </select>
            </label>
          </div>
        ) : null}
        {active > 0 ? (
          <p className="text-sm text-muted-foreground" role="status">
            {active} {active === 1 ? "filter is" : "filters are"} on. {matched} {matched === 1 ? "idea fits" : "ideas fit"}.{" "}
            <button type="button" onClick={() => setFilters(DEFAULT_FILTERS)} className="font-semibold underline underline-offset-2 hover:text-foreground">Clear filters</button>
          </p>
        ) : null}
      </div>

      {dismissalsFailed ? (
        <p className="rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-sm text-foreground" role="alert">
          Your dismissed ideas could not be loaded, so one you dismissed before may show up again.
        </p>
      ) : null}

      {picks.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-5 text-sm text-muted-foreground">{note ?? "No ideas to show."}</div>
      ) : (
        <ol className="grid gap-3 lg:grid-cols-3">
          {picks.map((idea) => (
            <PickCard key={idea.key} idea={idea} busy={busyKey === idea.key || anyBusy}
              onFilm={(edits) => onFilm(idea, edits)} onDismiss={(reason) => onDismiss(idea, reason)} />
          ))}
        </ol>
      )}
      {picks.length > 0 && note ? <p className="text-sm text-muted-foreground">{note}</p> : null}

      {dismissed.length > 0 ? (
        <details className="rounded-lg border border-border bg-card">
          <summary className="flex min-h-[44px] cursor-pointer items-center px-4 text-sm font-medium text-muted-foreground hover:text-foreground">Dismissed ideas ({dismissed.length})</summary>
          <ul className="divide-y divide-border border-t border-border">
            {dismissed.map((d) => (
              <li key={d.idea_key} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
                <div className="min-w-0 text-sm">
                  <p className="font-medium text-foreground">{d.title ?? d.idea_key}</p>
                  <p className="text-xs text-muted-foreground">{d.reason ? `Reason: ${d.reason}` : "No reason given"}</p>
                </div>
                <Button variant="outline" size="sm" className="h-10" disabled={anyBusy} onClick={() => onBringBack(d.idea_key)} aria-label={`Bring back: ${d.title ?? d.idea_key}`}>Bring back</Button>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
