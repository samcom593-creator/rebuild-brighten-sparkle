/**
 * HomeConversions (OVERHAUL-home, 2026-10-29): the owner Home's conversion strip and its
 * roster number, "Selling agents".
 *
 * Sam: "the roster being 68 is just not accurate. Give me better stats and make it easier for
 * me to convert." Six numbers walk the funnel from a new application to a first deal, in two
 * groups that say when ("Today", "Last 7 days"), and one says who is actually selling. Every
 * number is a button that opens the people it counts, from the same read (useHomeConversions),
 * so the number and the list are the same rows. The rules live in src/lib/homeConversions.ts;
 * this file only draws them.
 *
 * Delight layer: each step has a tone bubble, a number that has moved lights up in its tone,
 * the tiles rise in one after the other and lift under a pointer. Nothing plays on load.
 */
import { useCallback, useRef, useState, type ComponentType, type ReactNode, type RefObject } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  BadgeCheck,
  BookOpen,
  CalendarCheck,
  ChevronRight,
  ClipboardCheck,
  RefreshCw,
  Sparkles,
  Trophy,
  UserPlus,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { CountUp } from "@/components/ui/delight/CountUp";
import { ToneBubble } from "@/components/ui/delight/ToneBubble";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useHomeConversions } from "@/hooks/useHomeConversions";
import { describeQuery, errorMessage, formatAsOf } from "@/lib/queryState";
import {
  CONVERSION_GROUPS,
  CONVERSION_STEPS,
  SELLING_STEP,
  conversionCount,
  conversionTone,
  conversionTrend,
  currentLabel,
  peopleFor,
  personDetail,
  personHref,
  personValue,
  priorLabel,
  unknownReason,
  type ConversionKind,
  type ConversionPayload,
  type ConversionPerson,
  type ConversionStep,
} from "@/lib/homeConversions";
import { personInitials } from "@/lib/personInitials";
import { TONE_CLASS } from "@/lib/tones";
import { cn } from "@/lib/utils";

const ICONS: Record<ConversionKind, ComponentType<{ className?: string }>> = {
  applied: UserPlus,
  interview_booked: CalendarCheck,
  xcel_bought: BookOpen,
  passed_test: ClipboardCheck,
  licensed: BadgeCheck,
  first_deal: Trophy,
  selling: Users,
};

const ALL_STEPS: readonly ConversionStep[] = [...CONVERSION_STEPS, SELLING_STEP];
const stepFor = (kind: ConversionKind) => ALL_STEPS.find((s) => s.kind === kind) ?? SELLING_STEP;

const peopleWord = (n: number) => (n === 1 ? "person" : "people");
/** An error message as a sentence, so the next sentence does not run into it. */
const sentence = (text: string) => (/[.!?]$/.test(text.trim()) ? text.trim() : `${text.trim()}.`);
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** What a tile says out loud: its full label, its number and the comparison in full. */
function spokenName(step: ConversionStep, payload: ConversionPayload | null): string {
  const count = conversionCount(payload, step.kind);
  const when = step.window === "day" ? "" : `, ${currentLabel(step.window).toLowerCase()}`;
  const trend = step.kind === "selling" ? null : conversionTrend(count, conversionCount(payload, step.kind, "prior"), step.window);
  const parts = [`${step.label}${when}: ${count === null ? "unknown" : count.toLocaleString()}`];
  if (trend) parts.push(trend.spoken);
  parts.push("Open the list");
  return parts.join(". ");
}

/** A conversion tile: the label, the number (lit in its tone when something moved), the comparison. */
function Tile({ step, payload, onOpen }: { step: ConversionStep; payload: ConversionPayload | null; onOpen: (kind: ConversionKind, from: HTMLElement) => void }) {
  const tone = conversionTone(step.kind);
  const Icon = ICONS[step.kind];
  const count = conversionCount(payload, step.kind);
  const lit = (count ?? 0) > 0;
  const late = unknownReason(payload, step.kind) !== null;
  const trend = conversionTrend(count, conversionCount(payload, step.kind, "prior"), step.window);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-haspopup="dialog"
          aria-label={spokenName(step, payload)}
          onClick={(event) => onOpen(step.kind, event.currentTarget)}
          // apex-lift (src/styles/delight.css) owns the motion: a 1px lift for a real pointer and
          // a press on touch, plus the colour transitions.
          className="apex-lift flex min-w-0 flex-col justify-start bg-card p-3 text-left hover:bg-muted/40 focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)] sm:p-5"
        >
          <span className="flex min-h-10 flex-row items-center gap-2 sm:min-h-12">
            <ToneBubble tone={tone} size="sm"><Icon /></ToneBubble>
            <span className="block text-[13px] font-semibold leading-4 text-muted-foreground sm:text-[15px] sm:leading-5">{step.short}</span>
          </span>
          <CountUp
            value={count}
            className={cn(
              "mt-1.5 block text-[2rem] font-bold leading-none tracking-[-0.02em] sm:text-[2.5rem]",
              lit ? TONE_CLASS[tone].text : "text-foreground",
            )}
          />
          <span className="mt-2 block min-h-4 text-[13px] font-semibold leading-4 sm:min-h-5 sm:text-sm sm:leading-5">
            {late ? (
              <span className="text-tone-warm">Xcel report is late</span>
            ) : trend ? (
              <span className={TONE_CLASS[trend.tone].text}>{trend.text}</span>
            ) : null}
          </span>
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-sm leading-5">{step.definition}</TooltipContent>
    </Tooltip>
  );
}

function PersonRow({ person, todayKey }: { person: ConversionPerson; todayKey: string }) {
  const tone = conversionTone(person.kind);
  const href = personHref(person);
  const value = personValue(person);
  const body = (
    <>
      <span
        aria-hidden="true"
        className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-full border text-[13px] font-bold", TONE_CLASS[tone].soft, TONE_CLASS[tone].text, TONE_CLASS[tone].border)}
      >
        {personInitials(person.name)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-base font-semibold text-foreground">{person.name ?? "Name not on file"}</span>
        <span className="block text-sm leading-5 text-muted-foreground">{personDetail(person, todayKey)}</span>
      </span>
      {value ? (
        <span className="shrink-0 text-right">
          <span className="block text-base font-bold tabular-nums text-foreground">{value.amount}</span>
          <span className="block text-[13px] leading-4 text-muted-foreground">{value.label}</span>
        </span>
      ) : null}
      {href ? <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" /> : null}
    </>
  );
  const row = "flex min-h-16 items-center gap-3 rounded-xl border border-border bg-background/40 px-3 py-2.5";
  return (
    <li>
      {href ? (
        <Link to={href} className={cn(row, "apex-lift hover:bg-muted/40 focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)]")}>
          {body}
        </Link>
      ) : (
        <div className={row}>{body}</div>
      )}
    </li>
  );
}

function PeopleSection({ title, people, todayKey, empty }: { title: string; people: ConversionPerson[]; todayKey: string; empty: ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-[15px] font-semibold text-foreground">
        {title} <span className="font-normal text-muted-foreground">· {people.length.toLocaleString()} {peopleWord(people.length)}</span>
      </h3>
      {people.length === 0 ? (
        empty
      ) : (
        <ul className="apex-rise-list space-y-2">
          {people.map((p, i) => (
            <PersonRow key={`${p.application_id ?? p.agent_id ?? "row"}-${p.on ?? ""}-${i}`} person={p} todayKey={todayKey} />
          ))}
        </ul>
      )}
    </section>
  );
}

/** One list for whichever number was tapped: this period's people, then the comparison's. */
function ConversionListSheet({
  kind,
  payload,
  onClose,
  returnFocusTo,
}: {
  kind: ConversionKind | null;
  payload: ConversionPayload | null;
  onClose: () => void;
  /** The tile that opened the list; focus goes back to it when the list closes. */
  returnFocusTo: RefObject<HTMLElement | null>;
}) {
  const step = kind ? stepFor(kind) : null;
  const tone = step ? conversionTone(step.kind) : "gold";
  const Icon = step ? ICONS[step.kind] : Sparkles;
  const current = step ? peopleFor(payload, step.kind, "current") : [];
  const prior = step && step.kind !== "selling" ? peopleFor(payload, step.kind, "prior") : [];
  const count = step ? conversionCount(payload, step.kind) : null;
  const reason = step ? unknownReason(payload, step.kind) : null;
  const todayKey = payload?.today ?? "";
  return (
    <Sheet open={kind !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent
        side="right"
        className="apex-page-slot w-full overflow-y-auto bg-card px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-5 sm:max-w-lg"
        // The sheet is opened by a tile, not by a SheetTrigger, so Radix has no trigger to return
        // focus to; without this a keyboard user lands on the page body after Escape.
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnFocusTo.current?.focus();
        }}
      >
        {step ? (
          <div className="space-y-5">
            <SheetHeader className="space-y-3 pr-10 text-left">
              <div className="flex items-center gap-3">
                <ToneBubble tone={tone} size="lg" className="apex-pop"><Icon /></ToneBubble>
                <div className="min-w-0">
                  <SheetTitle className="text-xl font-bold leading-7">{step.label}</SheetTitle>
                  <SheetDescription className="text-sm">
                    {count === null ? "Count unknown" : `${count.toLocaleString()} ${peopleWord(count)}`}
                    {step.window === "day" ? " · Phoenix time" : ` · ${currentLabel(step.window).toLowerCase()}`}
                  </SheetDescription>
                </div>
              </div>
              <p className="text-sm leading-5 text-muted-foreground">{step.definition}</p>
              {reason ? (
                <p role="status" className="rounded-xl border border-tone-warm/35 bg-tone-warm/12 px-3 py-2 text-sm text-foreground">
                  {reason}
                </p>
              ) : null}
            </SheetHeader>
            <PeopleSection
              title={currentLabel(step.window)}
              people={current}
              todayKey={todayKey}
              empty={
                <div className="rounded-xl border border-dashed border-border px-4 py-5 text-center">
                  <p className="text-base font-semibold text-foreground">{step.emptyText}</p>
                  <Button asChild className="mt-3 h-11">
                    <Link to={step.emptyAction.to}>
                      {step.emptyAction.label} <ArrowRight className="ml-1.5 h-4 w-4" aria-hidden="true" />
                    </Link>
                  </Button>
                </div>
              }
            />
            {step.kind !== "selling" ? (
              <PeopleSection
                title={capitalize(priorLabel(step.window))}
                people={prior}
                todayKey={todayKey}
                empty={<p className="text-sm text-muted-foreground">Nobody {priorLabel(step.window)} either.</p>}
              />
            ) : null}
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

/** The notice for the moments the numbers are not plain: loading, failed, stale. */
function StripNotice({ query }: { query: ReturnType<typeof useHomeConversions> }) {
  const state = describeQuery(query);
  if (state.status === "loading") return <span>Loading the conversion numbers…</span>;
  if (state.status === "error" || state.stale) {
    return (
      <>
        <span className="text-foreground">
          {state.status === "error"
            ? `The conversion numbers did not load: ${sentence(errorMessage(query.error))} Nothing is being guessed.`
            : `Showing the numbers from ${formatAsOf(query.dataUpdatedAt)}. The last refresh failed.`}
        </span>
        <Button size="sm" variant="outline" className="h-10 shrink-0" onClick={() => void query.refetch()}>
          <RefreshCw className="mr-1.5 h-4 w-4" aria-hidden="true" /> Try again
        </Button>
      </>
    );
  }
  return null;
}

/** Which list is open, and the tile that opened it (focus returns there on close). */
function useListSheet() {
  const [open, setOpen] = useState<ConversionKind | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const openFrom = useCallback((kind: ConversionKind, from: HTMLElement) => {
    opener.current = from;
    setOpen(kind);
  }, []);
  const close = useCallback(() => setOpen(null), []);
  return { open, opener, openFrom, close };
}

/**
 * The strip: "Today" (Applied, Interviews booked) and "Last 7 days" (Bought Xcel, Passed the
 * test, Newly licensed, First deals). Stacked on a phone and up to 1279px; side by side from
 * 1280px, six equal tiles in a row.
 */
export function HomeConversions() {
  const query = useHomeConversions();
  const { open, opener, openFrom, close } = useListSheet();
  const payload = query.data ?? null;
  const state = describeQuery(query);
  const showNotice = state.status === "loading" || state.status === "error" || state.stale;
  return (
    <TooltipProvider delayDuration={400}>
      <section aria-labelledby="home-conversions-title" aria-busy={state.status === "loading" || undefined} className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
          <div className="flex min-w-0 items-center gap-3">
            <ToneBubble tone="gold" size="md" className="apex-pop"><Sparkles /></ToneBubble>
            <div className="min-w-0">
              <h2 id="home-conversions-title" className="text-lg font-bold leading-6 text-foreground sm:text-xl">Conversions</h2>
              <p className="text-sm text-muted-foreground">Who moved forward. Tap a number to see who.</p>
            </div>
          </div>
          {payload?.as_of ? <p className="text-[13px] text-muted-foreground">Updated {formatAsOf(payload.as_of)}</p> : null}
        </div>
        {showNotice ? (
          <div role="status" className="flex flex-col gap-2 rounded-xl border border-border bg-muted/60 px-4 py-3 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <StripNotice query={query} />
          </div>
        ) : null}
        <div className="grid gap-3 xl:grid-cols-[minmax(0,2fr)_minmax(0,4fr)]">
          {CONVERSION_GROUPS.map((group) => (
            <div key={group.window} role="group" aria-label={group.title} className="overflow-hidden rounded-2xl border border-border bg-card">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 border-b border-border px-3 py-2.5 sm:px-5">
                <h3 className="text-[15px] font-semibold text-foreground">{group.title}</h3>
                <p className="text-[13px] text-muted-foreground">{group.compared}</p>
              </div>
              <div className={cn("apex-rise-list grid grid-cols-2 gap-px bg-border", group.steps.length > 2 && "sm:grid-cols-4")}>
                {group.steps.map((step) => (
                  <Tile key={step.kind} step={step} payload={payload} onOpen={openFrom} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>
      <ConversionListSheet kind={open} payload={payload} onClose={close} returnFocusTo={opener} />
    </TooltipProvider>
  );
}

/**
 * The roster number, fixed. Before 2026-10-29 Home showed "Roster 68": every agent row marked
 * active, 59 of whom had never sold ("No sale yet"). This is the licensed agents with a posted
 * deal in the last 30 days, and it opens every one of them.
 */
export function SellingAgentsTile() {
  const query = useHomeConversions();
  const { open, opener, openFrom, close } = useListSheet();
  const payload = query.data ?? null;
  const state = describeQuery(query);
  const count = conversionCount(payload, "selling");
  const tone = conversionTone("selling");
  return (
    <TooltipProvider delayDuration={400}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-haspopup="dialog"
            aria-label={spokenName(SELLING_STEP, payload)}
            onClick={(event) => openFrom("selling", event.currentTarget)}
            className="apex-lift flex w-full min-w-0 flex-col rounded-2xl border border-border bg-card p-4 text-left hover:bg-muted/40 focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)] sm:p-5"
          >
            <span className="flex items-center gap-2">
              <ToneBubble tone={tone} size="sm"><Users /></ToneBubble>
              <span className="min-w-0 flex-1 text-[15px] font-semibold text-muted-foreground">{SELLING_STEP.label}</span>
              <span className="inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-foreground">
                See who <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </span>
            </span>
            <CountUp
              value={count}
              className={cn("mt-2 block text-[2.5rem] font-bold leading-none tracking-[-0.02em]", (count ?? 0) > 0 ? TONE_CLASS[tone].text : "text-foreground")}
            />
            <span className="mt-2 block text-sm leading-5 text-muted-foreground">
              {state.status === "error" ? `Did not load: ${sentence(errorMessage(query.error))}` : "Licensed, sold in the last 30 days"}
            </span>
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs text-sm leading-5">{SELLING_STEP.definition}</TooltipContent>
      </Tooltip>
      <ConversionListSheet kind={open} payload={payload} onClose={close} returnFocusTo={opener} />
    </TooltipProvider>
  );
}
