// The Launch Board's one list (OVERHAUL-launchboard, 2026-10-31). Sam: "still pretty ugly." The brief: one clear
// list with stage colour, one next action per row, and no more than four summary numbers.
//
// What it replaced: five stat boxes in the header, a gold tab pill and a gold New idea button, a "Needs finishing"
// table with a date picker and a gold button on every row, three "Film next" picks with three more gold buttons and
// five filters, a "Remake a winner" panel, a clear-ideas bar, a momentum strip with a streak banner, two badges and
// four more numbers, a testimonials bar, and four question cards behind Show details; then a Board tab with nine
// stage chips and a table with five buttons a row.
//
// What it is now: four numbers that each open their list (Ideas, To film, To edit, To post: with Published they
// cover every video once); In progress, Published and All videos; a search; then one list in the order to finish
// it. Its first video is Up next, with what to do and why and the page's one gold button. Every other row is a
// video, its step as a coloured bar and word with one fact, and one button that does the next step. Tapping a row
// opens the card. Every number and row comes from src/lib/launchBoardList.ts over the same loaded cards, so a
// number always equals the list it opens.
import { useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import {
  ArrowRight, BadgeCheck, ChevronDown, ChevronRight, Clapperboard, ExternalLink, Film, Lightbulb, Link2, ListChecks, Loader2,
  Paperclip, PenLine, RefreshCw, Scissors, Search, Send, ShieldAlert, ShieldCheck, Smartphone, type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { ToneBubble } from "@/components/ui/delight/ToneBubble";
import { GrowScoreboard, type ScoreTile } from "@/components/recruiting/GrowScoreboard";
import { externalHref } from "@/lib/externalHref";
import { TONE_CLASS, contentStepTone, type Tone } from "@/lib/tones";
import { cn } from "@/lib/utils";
import {
  VIDEO_BAR_STEPS, VIDEO_CHIP_LISTS, VIDEO_LISTS, VIDEO_STEPS, VIDEO_TILE_LISTS,
  defaultVideoList, matchesVideoSearch, parseVideoList, videoFormat, videoListCounts, videoListRows, videoNextStep, videoStep,
  videoUpNext, videoWhen, type BoardVideo, type VideoActionKind, type VideoListKey, type VideoNextStep, type VideoStep,
} from "@/lib/launchBoardList";

/** Rows shown before "Show more": a board fits, a long idea list still renders at once on a phone. */
const PAGE = 40;

/** Hover only where a pointer can hover, so a tapped row never stays lit on a phone. */
const ROW_HOVER = "[@media(hover:hover)_and_(pointer:fine)]:hover:border-primary/40 [@media(hover:hover)_and_(pointer:fine)]:hover:bg-muted/40";

const chipClass = (active: boolean) => cn(
  "inline-flex min-h-11 shrink-0 items-center gap-2 whitespace-nowrap rounded-full border px-4 text-[15px] font-medium transition-colors focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)]",
  active ? "border-primary bg-primary/15 font-semibold text-foreground" : "border-border bg-card text-foreground [@media(hover:hover)_and_(pointer:fine)]:hover:bg-muted",
);

/** The 8% wash behind Up next's step, the depth of a selected tile. Written out so Tailwind sees each class. */
const WASH: Record<Tone, string> = {
  good: "bg-tone-good/8", warm: "bg-tone-warm/8", hot: "bg-tone-hot/8", cool: "bg-tone-cool/8",
  royal: "bg-tone-royal/8", gold: "bg-tone-gold/8", slate: "bg-tone-slate/8",
};

const ACTION_ICON: Record<VideoActionKind, LucideIcon> = {
  film: Clapperboard, pack: ListChecks, write: PenLine, attach: Paperclip, advance: ArrowRight,
  approve: ShieldCheck, post: Send, link: Link2, view: ExternalLink, wait: ShieldCheck,
};

const TILE_LOOK: Record<string, Pick<ScoreTile, "hint" | "icon" | "emphasis">> = {
  ideas: { hint: "Not picked to film yet", icon: <Lightbulb /> },
  film: { hint: "Picked to film", icon: <Clapperboard /> },
  edit: { hint: "Being cut, or waiting on approval", icon: <Scissors /> },
  post: { hint: "Ready, or needs its live link", icon: <Send />, emphasis: true },
};
const TILE_TONE: Record<string, Tone> = { ideas: contentStepTone("idea"), film: contentStepTone("selected"), edit: contentStepTone("editing"), post: contentStepTone("ready") };

const videos = (n: number) => `${n.toLocaleString()} ${n === 1 ? "video" : "videos"}`;

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) return String((error as { message: unknown }).message);
  return typeof error === "string" && error ? error : "Unknown error";
}

/** A reason printed after another sentence: capitalised and ended, so it reads as one. */
function sentence(text: string): string {
  const t = text.trim();
  if (!t) return "";
  const capped = t[0].toUpperCase() + t.slice(1);
  return /[.!?]$/.test(capped) ? capped : `${capped}.`;
}

// ── Pieces shared with the Week view and the card dialogs ─────────────────

/**
 * Where a video is: a six-step bar and its word, with one fact after it. The bar shows how far; the word says where.
 * `stacked` puts the fact on its own line under the word, so a narrow column never breaks it mid-phrase; "lg" does
 * that only from 1024px, where the list gives the step a column of its own.
 */
export function VideoStageMark({ step, stacked = false, className }: { step: VideoStep; stacked?: boolean | "lg"; className?: string }) {
  const filled = Math.max(0, Math.min(VIDEO_BAR_STEPS, step.index));
  return (
    <span className={cn("inline-flex min-w-0 items-start gap-2", className)}>
      <span aria-hidden="true" className="mt-1.5 inline-flex h-2 w-24 shrink-0 items-stretch gap-[3px]">
        {Array.from({ length: VIDEO_BAR_STEPS }, (_, i) => (
          <span key={`seg-${i}`} className={cn("flex-1 rounded-full", i < filled ? TONE_CLASS[step.tone].dot : "bg-muted-foreground/20")} />
        ))}
      </span>
      <span className="min-w-0 text-sm leading-5">
        <span className={cn("font-semibold", TONE_CLASS[step.tone].text)}>
          <span className="sr-only">{`Step ${step.index} of ${VIDEO_BAR_STEPS}: `}</span>
          {step.label}
        </span>
        {step.detail ? (
          // Stacked, the fact takes its own line. Inline, the fact is one inline block: it moves to the next line
          // whole rather than leaving one word behind, and still wraps inside itself on the narrowest screen.
          <>
            <span aria-hidden="true" className={cn("text-muted-foreground", stacked === true ? "sr-only" : stacked === "lg" && "lg:sr-only")}> · </span>
            <span className={cn("text-muted-foreground", stacked === true ? "block" : stacked === "lg" ? "inline-block lg:block" : "inline-block")}>{step.detail}</span>
          </>
        ) : null}
      </span>
    </span>
  );
}

/** Long-form or Short, as an icon in the step's tone. */
export function VideoBubble({ video, tone, size = "md", className }: { video: BoardVideo; tone: Tone; size?: "sm" | "md" | "lg"; className?: string }) {
  return (
    <ToneBubble tone={tone} size={size} className={className}>
      {videoFormat(video) === "Long-form" ? <Film /> : <Smartphone />}
    </ToneBubble>
  );
}

/** Format, when and owner: the facts after the step. Rendered even when empty, so aria-describedby names a real element. */
function VideoFacts({ video, now, id }: { video: BoardVideo; now: Date; id: string }) {
  const when = videoWhen(video, now);
  const owner = (video.owner ?? "").trim();
  return (
    <span id={id} className="block break-words text-sm leading-5 text-muted-foreground [overflow-wrap:anywhere]">
      <span>{videoFormat(video)}</span>
      {when ? (
        <>
          <span aria-hidden="true"> · </span>
          <span className={cn(when.emphasis && cn("font-semibold", TONE_CLASS[when.tone].text))}>{when.text}</span>
        </>
      ) : null}
      {owner ? (
        <>
          <span aria-hidden="true"> · </span>
          <span>{`Owner: ${owner}`}</span>
        </>
      ) : null}
    </span>
  );
}

export interface VideoActionHandlers {
  /** Do the next step. `origin` is the pressed control, for the celebration after a confirmed save. */
  onAct: (video: BoardVideo, next: VideoNextStep, origin: HTMLElement | null) => void;
  /** Open the card (the editor). */
  onOpen: (video: BoardVideo) => void;
}

/**
 * The button that does the next step. Moving a card (Film this, Start editing, Send to review, Approve) saves one
 * stage change on the server; the others open what the step needs: the filming pack, the card, the Library or the
 * publish kit. A video that waits on someone else offers Open.
 */
function VideoAction({ video, next, gold, busy, locked, onAct, onOpen, className }: {
  video: BoardVideo;
  next: VideoNextStep;
  gold: boolean;
  busy: boolean;
  /** The workflow columns are missing: stage moves cannot be saved. */
  locked: boolean;
} & VideoActionHandlers & { className?: string }) {
  const Icon = ACTION_ICON[next.kind];
  const title = video.title?.trim() || "this video";
  if (next.kind === "view") {
    const href = externalHref(video.published_url);
    if (href) {
      return (
        <Button asChild variant={gold ? "default" : "outline"} className={className}>
          <a href={href} target="_blank" rel="noopener noreferrer" aria-label={`View the post: ${title}`}>
            <ExternalLink className="h-4 w-4" aria-hidden /> View post
          </a>
        </Button>
      );
    }
  }
  if (next.kind === "wait" || !next.label || next.kind === "view") {
    return (
      <Button type="button" variant={gold ? "outline" : "ghost"} className={className} aria-label={`Open ${title}`} onClick={() => onOpen(video)}>
        Open <ChevronRight className="h-4 w-4" aria-hidden />
      </Button>
    );
  }
  const moves = next.kind === "film" || next.kind === "advance" || next.kind === "approve";
  return (
    <Button
      type="button"
      variant={gold ? "default" : "outline"}
      className={className}
      disabled={busy || (locked && moves)}
      aria-label={`${next.label}: ${title}`}
      onClick={(event) => onAct(video, next, event.currentTarget)}
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Icon className="h-4 w-4" aria-hidden />}
      {next.label}
    </Button>
  );
}

/** The first video on the list: what it is, where it is, what to do and why, and the page's one gold button. */
function UpNextVideo({ video, now, isAdmin, busy, locked, onAct, onOpen, className }: {
  video: BoardVideo;
  now: Date;
  isAdmin: boolean;
  busy: boolean;
  locked: boolean;
  className?: string;
} & VideoActionHandlers) {
  const step = videoStep(video, now);
  const next = videoNextStep(video, { isAdmin, now });
  const Icon = ACTION_ICON[next.kind];
  const headingId = `up-next-${video.id}`;
  const title = video.title?.trim() || "Untitled video";
  return (
    // From 1024px what it is sits on the left and what to do on the right, so the gold button sits beside the reason
    // for it; below that they stack, what it is first.
    <section
      aria-labelledby={headingId}
      className={cn("apex-rise grid gap-4 rounded-xl border border-border bg-card p-4 sm:p-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:items-start lg:gap-6", className)}
    >
      <div className="flex items-start gap-3">
        {/* On a phone the bubble gives its width to the title; the bar and the word carry the colour. */}
        <VideoBubble video={video} tone={step.tone} size="lg" className="hidden sm:inline-flex" />
        <div className="min-w-0 flex-1 space-y-1.5">
          {/* Plain text, so a long title flows on from "Up next:" (a button would drop to a line of its own); Open card
              beside the gold button opens it. */}
          <h2 id={headingId} className="break-words text-xl font-semibold leading-7 text-foreground [overflow-wrap:anywhere]">
            <span className="font-medium text-muted-foreground">Up next: </span>
            {title}
          </h2>
          <VideoStageMark step={step} />
          <VideoFacts video={video} now={now} id={`up-next-facts-${video.id}`} />
        </div>
      </div>
      <div className="min-w-0 space-y-4">
        <section aria-label="What to do next" className={cn("flex items-start gap-3 rounded-lg border px-4 py-3", TONE_CLASS[next.tone].border, WASH[next.tone])}>
          <ToneBubble tone={next.tone} size="sm" className="mt-0.5"><Icon /></ToneBubble>
          <div className="min-w-0">
            <p className="break-words text-base font-semibold leading-6 text-foreground">{next.title}</p>
            <p className="text-pretty break-words text-[15px] leading-[22px] text-muted-foreground [overflow-wrap:anywhere]">{next.detail}</p>
          </div>
        </section>
        <div className="flex flex-wrap gap-2">
          {next.kind !== "wait" && next.label ? (
            <VideoAction video={video} next={next} gold busy={busy} locked={locked} onAct={onAct} onOpen={onOpen} className="h-12 min-w-0 flex-1 px-6 text-base sm:flex-none sm:px-8" />
          ) : null}
          <Button type="button" variant="outline" className="h-12 shrink-0 px-5 text-base" aria-haspopup="dialog" onClick={() => onOpen(video)}>
            Open card
          </Button>
        </div>
      </div>
    </section>
  );
}

/**
 * One video on one row: the title (the whole row opens the card), the step as a coloured bar and word with one fact,
 * the format and when, and one button that does the next step. On a phone the button sits under the words, so a
 * long title keeps the full width; from 640px it sits on the right, and from 1024px the step has its own column.
 */
function VideoRow({ video, now, isAdmin, busy, locked, onAct, onOpen }: {
  video: BoardVideo;
  now: Date;
  isAdmin: boolean;
  busy: boolean;
  locked: boolean;
} & VideoActionHandlers) {
  const step = videoStep(video, now);
  const next = videoNextStep(video, { isAdmin, now });
  const ids = { name: `video-${video.id}-name`, status: `video-${video.id}-status`, facts: `video-${video.id}-facts` };
  const title = video.title?.trim() || "Untitled video";
  return (
    <li className={cn("relative rounded-xl border border-border bg-card px-3 py-3 transition-colors sm:flex sm:items-center sm:gap-3 sm:px-4", ROW_HOVER)}>
      <VideoBubble video={video} tone={step.tone} className="hidden sm:inline-flex" />
      <button
        type="button"
        onClick={() => onOpen(video)}
        aria-labelledby={ids.name}
        aria-describedby={`${ids.status} ${ids.facts}`}
        aria-haspopup="dialog"
        className="grid w-full min-w-0 grid-cols-1 gap-y-1 rounded-md text-left after:absolute after:inset-0 after:rounded-xl after:content-[''] focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)] sm:flex-1 lg:grid-cols-[minmax(0,1fr)_17rem] lg:items-center lg:gap-x-6 lg:gap-y-0.5"
      >
        <span id={ids.name} className="break-words text-base font-semibold leading-6 text-foreground [overflow-wrap:anywhere] lg:col-start-1 lg:row-start-1">{title}</span>
        <span id={ids.status} className="flex min-w-0 lg:col-start-2 lg:row-span-2 lg:row-start-1">
          <VideoStageMark step={step} stacked="lg" />
        </span>
        <span className="lg:col-start-1 lg:row-start-2"><VideoFacts video={video} now={now} id={ids.facts} /></span>
      </button>
      <VideoAction video={video} next={next} gold={false} busy={busy} locked={locked} onAct={onAct} onOpen={onOpen} className="relative z-10 mt-2.5 h-11 px-4 sm:mt-0 sm:shrink-0 lg:w-44" />
    </li>
  );
}

/** The steps, the colours and the order, in words, for anyone who wonders why a video is first. */
function HowItWorks() {
  const sample = (key: (typeof VIDEO_STEPS)[number]["key"]): VideoStep => {
    const s = VIDEO_STEPS.find((x) => x.key === key)!;
    return { key, label: s.label, index: s.index, tone: contentStepTone(key), detail: null };
  };
  return (
    <div className="space-y-4 rounded-xl border border-border bg-card p-4 text-[15px] leading-[22px] sm:p-5">
      <div className="space-y-2">
        <p className="font-semibold text-foreground">The steps</p>
        <ul className="space-y-2">
          {VIDEO_STEPS.map((s) => (
            <li key={s.key} className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <VideoStageMark step={sample(s.key)} />
              <span className="text-muted-foreground">{s.means}</span>
            </li>
          ))}
        </ul>
        <p className="text-muted-foreground">The four numbers on top are Ideas, To film, To edit and To post. With Published they hold every video once.</p>
      </div>
      <div className="space-y-2">
        <p className="font-semibold text-foreground">The order</p>
        <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
          <li>Late: a due date that has passed.</li>
          <li>Due today, or planned to post today.</li>
          <li>The closest to published: ready, then planned, then waiting on approval, then editing, filming and selected.</li>
          <li>Videos marked posted with no live link.</li>
          <li>Ideas: this week&apos;s plan first, then the ones with a filming pack, then the newest.</li>
        </ol>
      </div>
      <p className="text-muted-foreground">
        Copying a caption or downloading a clip never moves a video. Published needs the post&apos;s live link, and only an admin approves a video to post.
      </p>
    </div>
  );
}

/** Nothing in this list: say why in plain words and offer the way back. */
function EmptyList({ list, search, counts, onClearSearch, onPick, onNewIdea }: {
  list: VideoListKey;
  search: string;
  counts: Record<VideoListKey, number>;
  onClearSearch: () => void;
  onPick: (list: VideoListKey) => void;
  onNewIdea?: () => void;
}) {
  if (search.trim()) {
    return (
      <EmptyState
        icon={<Search />}
        title={`No video here matches “${search.trim()}”`}
        description={list === "everyone" ? "Search looks at titles, opening lines, captions and owners." : "Search looks at titles, opening lines, captions and owners. Try All videos."}
        actions={<Button type="button" variant="outline" className="h-11" onClick={onClearSearch}>Clear search</Button>}
      />
    );
  }
  if (list === "working") {
    return (
      <EmptyState
        icon={<Clapperboard />}
        tone={contentStepTone("selected")}
        title="Nothing in progress"
        description={counts.ideas > 0 ? `Pick an idea to film and it shows up here. You have ${counts.ideas.toLocaleString()} ${counts.ideas === 1 ? "idea" : "ideas"} saved.` : "Add an idea, pick it to film, and it shows up here."}
        actions={counts.ideas > 0
          ? <Button type="button" variant="outline" className="h-11" onClick={() => onPick("ideas")}>Show ideas</Button>
          : onNewIdea ? <Button type="button" variant="outline" className="h-11" onClick={onNewIdea}>New idea</Button> : undefined}
      />
    );
  }
  const copy: Record<VideoListKey, { title: string; description: string; good: boolean }> = {
    working: { title: "", description: "", good: false },
    ideas: { title: "No ideas saved", description: "New idea offers three picks from your idea bank, or write your own.", good: false },
    film: { title: "Nothing to film", description: "Pick an idea to film and it shows up here.", good: true },
    edit: { title: "Nothing to edit", description: "Videos with footage in show up here until they are approved.", good: true },
    post: { title: "Nothing waiting to post", description: "Approved videos show up here until the live link is in.", good: true },
    published: { title: "Nothing published with a link yet", description: "Paste a post's live link to mark it published. It shows up here.", good: false },
    everyone: { title: "No videos on the board", description: "Add an idea to start.", good: false },
  };
  const c = copy[list];
  return (
    <EmptyState
      icon={c.good ? <BadgeCheck /> : <Clapperboard />}
      variant={c.good ? "success" : "default"}
      title={c.title}
      description={c.description}
      actions={list === "ideas" && onNewIdea
        ? <Button type="button" variant="outline" className="h-11" onClick={onNewIdea}>New idea</Button>
        : list !== "everyone" ? <Button type="button" variant="outline" className="h-11" onClick={() => onPick("everyone")}>Show all videos</Button> : undefined}
    />
  );
}

export interface LaunchBoardListProps extends VideoActionHandlers {
  /** Every live card on the board (cleared ideas aside). */
  cards: readonly BoardVideo[];
  status: "loading" | "error" | "ready";
  error?: unknown;
  onRetry: () => void;
  isAdmin: boolean;
  /** The card whose stage change is saving: its button waits. */
  busyId: string | null;
  /** The workflow columns are missing on this database: stage moves cannot be saved. */
  locked: boolean;
  /** Open New idea (the idea bank and Write my own). */
  onNewIdea?: () => void;
  /** Shown under the Ideas list: clearing and restoring unused ideas. */
  ideasFooter?: ReactNode;
  /** For tests: the clock. */
  now?: Date;
}

/**
 * The Videos view: Up next, the four numbers, the lists and the search, and the one list. The list and the search
 * live in the URL (?list=, ?q=), so a reload or a shared link opens the same view.
 */
export function LaunchBoardList({
  cards, status, error, onRetry, isAdmin, busyId, locked, onAct, onOpen, onNewIdea, ideasFooter, now: fixedNow,
}: LaunchBoardListProps) {
  const [params, setParams] = useSearchParams();
  const [shown, setShown] = useState(PAGE);
  const [explainOpen, setExplainOpen] = useState(false);
  // A fresh clock whenever the cards change, so a save that moves a video is ordered against the time it happened.
  const now = useMemo(() => fixedNow ?? new Date(), [fixedNow, cards]);
  const search = params.get("q") ?? "";

  const searched = useMemo(() => cards.filter((c) => matchesVideoSearch(c, search)), [cards, search]);
  const counts = useMemo(() => videoListCounts(searched), [searched]);
  const allCounts = useMemo(() => videoListCounts(cards), [cards]);
  const list: VideoListKey = parseVideoList(params.get("list")) ?? defaultVideoList(allCounts);
  const rows = useMemo(() => videoListRows(searched, list, now), [searched, list, now]);
  const upNext = status === "ready" ? videoUpNext(rows) : null;
  const rest = upNext ? rows.slice(1) : rows;
  const notShown = Math.max(0, rest.length - shown);

  const setParam = (key: string, value: string | null) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value) next.set(key, value);
      else next.delete(key);
      return next;
    }, { replace: true });
  };
  const pickList = (key: VideoListKey) => { setParam("list", key); setShown(PAGE); };
  /** A tile is a switch: tapping the list that is on goes back to In progress. */
  const pickTile = (key: VideoListKey) => pickList(key === list ? "working" : key);

  const loaded = status === "ready";
  const known = loaded ? counts : null;
  const def = VIDEO_LISTS[list];
  const emptyBoard = loaded && cards.length === 0;

  const tiles: ScoreTile[] = VIDEO_TILE_LISTS.map((key) => ({
    label: VIDEO_LISTS[key].label,
    value: known ? known[key] : null,
    definition: VIDEO_LISTS[key].rule,
    onSelect: () => pickTile(key),
    active: list === key,
    tone: TILE_TONE[key],
    ...TILE_LOOK[key],
  }));

  return (
    // One column, ordered for the screen: on a phone Up next comes first, so the gold button is on the first screen;
    // from 640px it heads the list, under the numbers. The DOM order is the phone's, so a screen reader meets Up next
    // first everywhere.
    <div className="flex flex-col gap-4">
      {upNext && (
        <UpNextVideo
          key={upNext.id}
          className="order-1 sm:order-5"
          video={upNext}
          now={now}
          isAdmin={isAdmin}
          busy={busyId === upNext.id}
          locked={locked}
          onAct={onAct}
          onOpen={onOpen}
        />
      )}

      {!emptyBoard && (
        <GrowScoreboard
          className="order-2 sm:order-1"
          label="Board numbers"
          compactOnPhone
          notice={status === "error" ? <span>The numbers are hidden because the board did not load.</span> : undefined}
          tiles={tiles}
        />
      )}

      {!emptyBoard && status !== "error" && (
        <div className="order-3 space-y-3 sm:order-2">
          <div role="group" aria-label="Which videos to show" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:px-0 [&::-webkit-scrollbar]:hidden">
            {VIDEO_CHIP_LISTS.map((key) => (
              <button key={key} type="button" aria-pressed={list === key} title={VIDEO_LISTS[key].rule} onClick={() => pickList(key)} className={chipClass(list === key)}>
                {VIDEO_LISTS[key].label}
                <span className="tabular-nums text-muted-foreground">{known ? known[key].toLocaleString() : "—"}</span>
              </button>
            ))}
          </div>
          {cards.length > 6 && (
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input
                type="search"
                value={search}
                onChange={(event) => { setParam("q", event.target.value || null); setShown(PAGE); }}
                placeholder="Search titles, opening lines and captions"
                aria-label="Search videos"
                enterKeyHint="search"
                className="h-11 bg-card pl-9 text-base"
              />
            </div>
          )}
        </div>
      )}

      {status === "loading" ? (
        <div className="order-6 space-y-2" aria-busy="true" aria-label="Loading the board">
          <Skeleton className="h-48 w-full rounded-xl" />
          {Array.from({ length: 4 }, (_, n) => <Skeleton key={`lb-sk-${n}`} className="h-[76px] w-full rounded-xl" />)}
        </div>
      ) : status === "error" ? (
        <EmptyState
          className="order-6"
          icon={<ShieldAlert />}
          variant="warning"
          title="The board did not load"
          description={`Nothing is guessed in its place. ${sentence(errorText(error))}`}
          actions={<Button type="button" variant="outline" className="h-11" onClick={onRetry}><RefreshCw className="h-4 w-4" aria-hidden /> Try again</Button>}
        />
      ) : emptyBoard ? (
        <EmptyState
          className="order-6"
          icon={<Clapperboard />}
          title="No videos on the board yet"
          description="Start with an idea: pick one from your idea bank or write your own. It moves from idea to published right here."
          actions={onNewIdea ? <Button type="button" className="h-12 px-6" onClick={onNewIdea}><Lightbulb className="h-4 w-4" aria-hidden /> New idea</Button> : undefined}
        />
      ) : (
        <>
          <div className="order-4 space-y-3 sm:order-3">
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <p className="min-w-0 text-[15px] leading-6 text-muted-foreground">
                <span className="font-semibold text-foreground">{def.label}</span>
                {" · "}<span className="whitespace-nowrap">{videos(rows.length)}</span>
                {rows.length > 1 && <span className="hidden sm:inline">{`, ${def.order}`}</span>}
              </p>
              <Button type="button" variant="ghost" className="ml-auto h-11 shrink-0 px-3 text-muted-foreground" aria-expanded={explainOpen} aria-controls="launch-board-how" onClick={() => setExplainOpen((v) => !v)}>
                How it works <ChevronDown className={cn("h-4 w-4 transition-transform", explainOpen && "rotate-180")} aria-hidden />
              </Button>
            </div>
            {/* Always in the page so the toggle's aria-controls names a real element; hidden until asked. */}
            <div id="launch-board-how" hidden={!explainOpen}><HowItWorks /></div>
          </div>

          {rows.length === 0 ? (
            <div className="order-6">
              <EmptyList list={list} search={search} counts={counts} onClearSearch={() => setParam("q", null)} onPick={pickList} onNewIdea={onNewIdea} />
            </div>
          ) : rest.length > 0 ? (
            <ul aria-label={upNext ? `${def.label}, after Up next` : def.label} className="apex-rise-list order-6 space-y-2">
              {rest.slice(0, shown).map((video) => (
                <VideoRow key={video.id} video={video} now={now} isAdmin={isAdmin} busy={busyId === video.id} locked={locked} onAct={onAct} onOpen={onOpen} />
              ))}
            </ul>
          ) : null}
          {notShown > 0 && (
            <Button type="button" variant="outline" className="order-7 h-11 w-full bg-card" onClick={() => setShown((n) => n + PAGE)}>
              Show {Math.min(PAGE, notShown)} more ({notShown.toLocaleString()} not shown yet)
            </Button>
          )}
          {list === "ideas" && ideasFooter ? <div className="order-8">{ideasFooter}</div> : null}
        </>
      )}
    </div>
  );
}
