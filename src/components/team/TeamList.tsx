// My Team's one list (OVERHAUL-myteam, 2026-10-31). Sam: "I literally just look at it and it gave me a
// full headache." The brief: one clear list with stage colour, one next action per row, and no more than
// four summary numbers.
//
// What it replaced: a production strip with eight figures (today's line, a streak, team size, producing,
// new hires with no sale, month ALP), a four-way view switch, seven filter chips, a search, rows with a
// stage dropdown, a work-days summary, a login line and a Work days button each, two folded panels, and
// for agents a second roster with eleven groups, three dropdowns and an eight-column table.
//
// What it is now: four numbers that each open their list (No sale yet, Gone quiet, Getting licensed,
// Selling, the four steps everyone on the team is on, so they add up to Everyone); Everyone and More lists;
// a search; then one list in the order to work it. Every row is a person, their step as a coloured bar and
// word with one plain fact, and one button: Call, or Open for the people who need nothing today. Tapping a
// row opens their card, where stage, work days, login and production live. Every number and row comes from
// src/lib/teamList.ts over the same loaded rows, so a number always equals the list it opens.
import { useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import {
  BadgeCheck, ChevronDown, ChevronRight, GraduationCap, ListFilter, Moon, Phone, RefreshCw, Search,
  ShieldAlert, Target, TrendingUp, UserRound, Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { ToneBubble } from "@/components/ui/delight/ToneBubble";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { GrowScoreboard, type ScoreTile } from "@/components/recruiting/GrowScoreboard";
import { OverFiveKBadge } from "@/components/team/OverFiveKBadge";
import { contactLinkProps, formatPhoneDisplay, phoneHref } from "@/lib/phone";
import { firstGrapheme } from "@/lib/personInitials";
import { plural, usdOrNull } from "@/lib/teamRoster";
import { TONE_CLASS, teamStepTone, type Tone } from "@/lib/tones";
import { cn } from "@/lib/utils";
import {
  TEAM_BAR_STEPS, TEAM_MORE_LISTS, TEAM_STEPS, TEAM_TILE_LISTS,
  listAlp30, matchesTeamSearch, parseTeamList, teamListCounts, teamListDef, teamListRows, teamNextStep, teamStage,
  trainingStageWords, type TeamListKey, type TeamMember, type TeamNextStep, type TeamStage,
} from "@/lib/teamList";

/** Rows shown before "Show more": a team fits, a big roster still renders at once on a phone. */
const PAGE = 50;

/** Hover only where a pointer can hover, so a tapped row never stays lit on a phone. */
const ROW_HOVER = "[@media(hover:hover)_and_(pointer:fine)]:hover:border-primary/40 [@media(hover:hover)_and_(pointer:fine)]:hover:bg-muted/40";

const chipClass = (active: boolean) => cn(
  "inline-flex min-h-11 shrink-0 items-center gap-2 whitespace-nowrap rounded-full border px-4 text-[15px] font-medium transition-colors focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)]",
  active ? "border-primary bg-primary/15 font-semibold text-foreground" : "border-border bg-card text-foreground [@media(hover:hover)_and_(pointer:fine)]:hover:bg-muted",
);

const TILE_LOOK: Record<string, Pick<ScoreTile, "hint" | "icon" | "emphasis">> = {
  no_sale: { hint: "Licensed, no sale yet", icon: <Target /> },
  quiet: { hint: "No sale in 30+ days", icon: <Moon />, emphasis: true },
  licensing: { hint: "Not licensed yet", icon: <GraduationCap /> },
  selling: { hint: "Sold in the last 30 days", icon: <TrendingUp /> },
};

const people = (n: number) => plural(n, "person", "people");

function initialsOf(name: string | null): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  const first = firstGrapheme(parts[0]);
  const last = parts.length > 1 ? firstGrapheme(parts[parts.length - 1]) : "";
  return `${first}${last}`.toUpperCase();
}

function loadedAtLabel(ms: number): string {
  return ms ? new Date(ms).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "";
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) return String((error as { message: unknown }).message);
  return "Unknown error";
}

/** A reason printed after another sentence: capitalised and ended, so it reads as one. */
function sentence(text: string): string {
  const t = text.trim();
  if (!t) return "";
  const capped = t[0].toUpperCase() + t.slice(1);
  return /[.!?]$/.test(capped) ? capped : `${capped}.`;
}

export interface TeamListProps {
  /** Every roster row (duplicates folded), with the team facts attached where this viewer may read them. */
  members: readonly TeamMember[];
  status: "loading" | "error" | "ready";
  error?: unknown;
  /** The latest reload failed while earlier rows are still shown. */
  staleSince?: number | null;
  fetching?: boolean;
  onRetry: () => void;
  /** "none" when this viewer cannot read the team facts at all (agents, agency owners). */
  factsState: "none" | "loading" | "error" | "ready";
  onRetryFacts?: () => void;
  /** The America/Phoenix business day, YYYY-MM-DD. */
  todayKey: string;
  /** The viewer's own agent id: their row says "(you)" and offers no call. */
  myAgentId: string | null;
  /** Say whose team each person is on (owners, managers and support staff see more than their own). */
  showUpline: boolean;
  selectedId: string | null;
  onOpenPerson: (agentId: string) => void;
  /** The way to grow an empty team: Invite an agent, or Refer a recruit. */
  emptyAction?: ReactNode;
  /** The page's less frequent actions (a More menu), at the end of the list's controls. */
  pageActions?: ReactNode;
}

export function TeamList({
  members, status, error, staleSince, fetching = false, onRetry, factsState, onRetryFacts, todayKey, myAgentId,
  showUpline, selectedId, onOpenPerson, emptyAction, pageActions,
}: TeamListProps) {
  const [params, setParams] = useSearchParams();
  const requested = parseTeamList(params.get("list"));
  const factsReady = factsState === "ready";
  // A list built on the team facts is not offered to someone who cannot read them.
  const list: TeamListKey = factsState === "none" && teamListDef(requested).needsFacts ? "everyone" : requested;
  const search = params.get("q") ?? "";
  const [shown, setShown] = useState(PAGE);
  const [explainOpen, setExplainOpen] = useState(false);

  const searched = useMemo(() => members.filter((m) => matchesTeamSearch(m, search)), [members, search]);
  const counts = useMemo(() => teamListCounts(searched, { factsReady }), [searched, factsReady]);
  const visible = useMemo(() => teamListRows(searched, list), [searched, list]);
  const notShown = Math.max(0, visible.length - shown);

  const setParam = (key: string, value: string | null) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value) next.set(key, value);
      else next.delete(key);
      return next;
    }, { replace: true });
  };
  /** A tile is a switch: tapping the list that is on goes back to Everyone. */
  const pickTile = (key: TeamListKey) => { setParam("list", key === list ? null : key); setShown(PAGE); };
  const pickList = (key: TeamListKey) => { setParam("list", key === "everyone" ? null : key); setShown(PAGE); };

  const loaded = status === "ready";
  const known = loaded ? counts : null;
  const def = teamListDef(list);
  const moreActive = TEAM_MORE_LISTS.includes(list);
  const moreLists = TEAM_MORE_LISTS.filter((key) => !(teamListDef(key).needsFacts && factsState === "none"));
  const onTeamCount = known?.everyone ?? 0;
  const emptyTeam = loaded && members.length === 0;

  const tiles: ScoreTile[] = TEAM_TILE_LISTS.map((key) => ({
    label: teamListDef(key).label,
    value: known ? known[key] : null,
    definition: teamListDef(key).rule,
    onSelect: () => pickTile(key),
    active: list === key,
    tone: teamStepTone(key),
    ...TILE_LOOK[key],
  }));

  return (
    <div className="flex flex-col gap-4">
      {!emptyTeam && (
        <GrowScoreboard
          label="Team numbers"
          compactOnPhone
          notice={status === "error" ? <span>The numbers are hidden because your team did not load.</span> : undefined}
          tiles={tiles}
        />
      )}

      {!emptyTeam && status !== "error" && (
        <div className="space-y-3">
          <div role="group" aria-label="Which people to show" className="flex flex-wrap gap-2">
            <button type="button" aria-pressed={list === "everyone"} title={teamListDef("everyone").rule} onClick={() => pickList("everyone")} className={chipClass(list === "everyone")}>
              Everyone
              <span className="tabular-nums text-muted-foreground">{known ? onTeamCount.toLocaleString() : "—"}</span>
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" aria-label={moreActive ? `More lists: ${def.label}` : "More lists"} className={chipClass(moreActive)}>
                  <ListFilter className="hidden h-4 w-4 shrink-0 sm:inline" aria-hidden />
                  {moreActive ? (
                    <>
                      {/* The caption under the controls names the list in full; the chip keeps to one row on a phone. */}
                      <span className="max-w-[8.5rem] truncate sm:max-w-[14rem]">{def.label}</span>
                      <span className="tabular-nums text-muted-foreground">{known && known[list] !== null ? known[list]!.toLocaleString() : "—"}</span>
                    </>
                  ) : "More lists"}
                  <ChevronDown className="h-4 w-4 shrink-0" aria-hidden />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-72">
                <DropdownMenuLabel className="text-[13px] font-semibold text-muted-foreground">More lists</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {moreLists.map((key) => {
                  const n = known ? known[key] : null;
                  const item = teamListDef(key);
                  return (
                    <DropdownMenuItem key={key} onSelect={() => pickList(key)} className={cn("min-h-11 justify-between gap-3 text-[15px]", list === key && "font-semibold")} title={item.rule}>
                      <span className="min-w-0 truncate">{item.label}</span>
                      <span className="tabular-nums text-muted-foreground">{n === null ? "—" : n.toLocaleString()}</span>
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <div className="flex gap-2">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input
                type="search"
                value={search}
                onChange={(event) => { setParam("q", event.target.value || null); setShown(PAGE); }}
                placeholder={showUpline ? "Name, phone, email or upline" : "Name, phone or email"}
                aria-label="Search your team"
                enterKeyHint="search"
                className="h-11 bg-card pl-9 text-base"
              />
            </div>
            {pageActions ? <div className="shrink-0">{pageActions}</div> : null}
          </div>
        </div>
      )}

      {loaded && factsState === "error" && (
        <div role="status" className="flex flex-col gap-2 rounded-lg border border-tone-warm/35 bg-tone-warm/8 p-3 text-sm text-foreground sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-start gap-2 font-medium">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-tone-warm" aria-hidden />
            Training stage, work days and logins did not load. Everyone is still listed; those three lists wait for them.
          </p>
          {onRetryFacts && <Button type="button" variant="outline" className="h-11 shrink-0" onClick={onRetryFacts}><RefreshCw className="h-4 w-4" aria-hidden /> Try again</Button>}
        </div>
      )}

      {loaded && staleSince ? (
        <div role="status" className="flex flex-col gap-2 rounded-lg border border-tone-hot/35 bg-tone-hot/8 p-3 text-sm text-foreground sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-start gap-2 font-medium">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-tone-hot" aria-hidden />
            Showing your team as loaded at {loadedAtLabel(staleSince)}. The latest reload failed. {sentence(errorText(error))}
          </p>
          <Button type="button" variant="outline" className="h-11 shrink-0" onClick={onRetry}><RefreshCw className="h-4 w-4" aria-hidden /> Try again</Button>
        </div>
      ) : null}

      {status === "loading" ? (
        <div className="space-y-2" aria-busy="true" aria-label="Loading your team">
          {Array.from({ length: 6 }, (_, n) => <Skeleton key={`team-sk-${n}`} className="h-[76px] w-full rounded-xl" />)}
        </div>
      ) : status === "error" ? (
        <EmptyState
          icon={<ShieldAlert />}
          variant="warning"
          title="Your team did not load"
          description={`Nothing is guessed in its place. ${sentence(errorText(error))}`}
          actions={<Button type="button" variant="outline" className="h-11" onClick={onRetry}><RefreshCw className="h-4 w-4" aria-hidden /> Try again</Button>}
        />
      ) : emptyTeam ? (
        <EmptyState
          icon={<Users />}
          tone="cool"
          title="Nobody on your team yet"
          description="When you hire or refer someone, they show up here with where they are and what to do next."
          actions={emptyAction}
        />
      ) : (
        <>
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <p className="min-w-0 text-[15px] leading-6 text-muted-foreground">
                <span className="font-semibold text-foreground">{def.label}</span>
                {" · "}<span className="whitespace-nowrap">{people(visible.length)}</span>
                {list === "selling" && visible.length > 0 ? <>{" · "}<span className="whitespace-nowrap">{`${usdOrNull(listAlp30(visible)) ?? "$0"} ALP in 30 days`}</span></> : null}
                {visible.length > 1 && <span className="hidden sm:inline">{`, ${def.order}`}</span>}
              </p>
              <div className="ml-auto flex shrink-0 items-center">
                <Button type="button" variant="ghost" className="h-11 px-3 text-muted-foreground" aria-expanded={explainOpen} aria-controls="team-how" onClick={() => setExplainOpen((v) => !v)}>
                  How it works <ChevronDown className={cn("h-4 w-4 transition-transform", explainOpen && "rotate-180")} aria-hidden />
                </Button>
                <Button type="button" variant="ghost" className="hidden h-11 px-3 text-muted-foreground sm:inline-flex" aria-label="Reload your team" onClick={onRetry} disabled={fetching}>
                  <RefreshCw className={cn("h-4 w-4", fetching && "animate-spin")} aria-hidden /> Reload
                </Button>
              </div>
            </div>
            {/* Always in the page so the toggle's aria-controls names a real element; hidden until asked. */}
            <div id="team-how" hidden={!explainOpen}><HowItWorks /></div>
          </div>

          {visible.length === 0 ? (
            <EmptyList list={list} search={search} factsState={factsState} onClearSearch={() => setParam("q", null)} onEveryone={() => pickList("everyone")} />
          ) : (
            <ul aria-label={def.label} className="apex-rise-list space-y-2">
              {visible.slice(0, shown).map((member) => (
                <MemberRow
                  key={member.row.agent_id}
                  member={member}
                  todayKey={todayKey}
                  isMe={Boolean(myAgentId) && member.row.agent_id === myAgentId}
                  showUpline={showUpline}
                  myAgentId={myAgentId}
                  selected={selectedId === member.row.agent_id}
                  onOpen={() => onOpenPerson(member.row.agent_id)}
                />
              ))}
            </ul>
          )}
          {notShown > 0 && (
            <Button type="button" variant="outline" className="h-11 w-full bg-card" onClick={() => setShown((n) => n + PAGE)}>
              Show {Math.min(PAGE, notShown)} more ({notShown.toLocaleString()} not shown yet)
            </Button>
          )}
        </>
      )}
    </div>
  );
}

// ── Pieces ─────────────────────────────────────────────────────────────────

/**
 * Where a person is: a three-step bar and its word, with one fact after it. The bar shows how far; the word says
 * where. `stacked` puts the fact on its own line under the word, so a narrow row never breaks it mid-phrase.
 */
export function TeamStageMark({ stage, stacked = false, className }: { stage: TeamStage; stacked?: boolean; className?: string }) {
  const filled = Math.max(0, Math.min(TEAM_BAR_STEPS, stage.index ?? 0));
  const step = TEAM_STEPS.find((s) => s.key === stage.key);
  return (
    <span className={cn("inline-flex min-w-0 items-start gap-2", className)}>
      <span aria-hidden="true" className="mt-1.5 inline-flex h-2 w-12 shrink-0 items-stretch gap-[3px]">
        {Array.from({ length: TEAM_BAR_STEPS }, (_, i) => (
          <span key={`seg-${i}`} className={cn("flex-1 rounded-full", i < filled ? TONE_CLASS[stage.tone].dot : "bg-muted-foreground/20")} />
        ))}
      </span>
      <span className="min-w-0 text-sm leading-5">
        <span className={cn("font-semibold", TONE_CLASS[stage.tone].text)}>
          {step && step.key !== "quiet" ? <span className="sr-only">{`Step ${step.index} of ${TEAM_BAR_STEPS}: `}</span> : null}
          {stage.label}
        </span>
        {stage.detail ? (
          <>
            <span aria-hidden="true" className={cn("text-muted-foreground", stacked && "sr-only")}> · </span>
            <span className={cn("text-muted-foreground", stacked && "block")}>{stage.detail}</span>
          </>
        ) : null}
      </span>
    </span>
  );
}

/** Initials in the step's tone; a person icon when no name is on file. */
function MemberBubble({ name, tone, className }: { name: string | null; tone: Tone; className?: string }) {
  const initials = initialsOf(name);
  return (
    <ToneBubble tone={tone} size="md" className={cn("text-[13px] font-semibold", className)}>
      {initials || <UserRound />}
    </ToneBubble>
  );
}

/**
 * The facts after the step: training stage, whose team, the two flags worth knowing, and the phone. The number
 * is last and hidden on a phone, where the Call button dials it and the card shows it; "No phone on file" always
 * shows, because it is why a row offers no call.
 */
function Facts({ member, showUpline, myAgentId, id }: { member: TeamMember; showUpline: boolean; myAgentId: string | null; id: string }) {
  const { row, facts } = member;
  const parts: Array<{ key: string; text: string; className?: string; wideOnly?: boolean }> = [];
  const training = trainingStageWords(facts);
  if (training) parts.push({ key: "training", text: training });
  if (showUpline && row.manager_name && row.manager_id !== myAgentId) parts.push({ key: "upline", text: `Upline ${row.manager_name}` });
  if (facts && !facts.access.has_login && row.status === "active") parts.push({ key: "login", text: "No login yet", className: cn("font-semibold", TONE_CLASS.warm.text) });
  if (row.free_leads_qualified && row.status === "active") parts.push({ key: "free-leads", text: "Free leads", className: cn("font-semibold", TONE_CLASS.good.text) });
  const phone = formatPhoneDisplay(row.phone);
  if (phone) parts.push({ key: "phone", text: phone, className: "whitespace-nowrap tabular-nums", wideOnly: true });
  else if (row.status === "active" && row.is_sync_only !== true) parts.push({ key: "no-phone", text: "No phone on file" });
  // Rendered even when empty, so the row's aria-describedby never names a missing element.
  if (parts.length === 0) return <span id={id} hidden />;
  return (
    <span id={id} className={cn("text-sm leading-5 text-muted-foreground", parts.every((p) => p.wideOnly) ? "hidden sm:block" : "block break-words")}>
      {parts.map((part, i) => (
        <span key={part.key} className={part.wideOnly ? "hidden sm:inline" : undefined}>
          {i > 0 ? <span aria-hidden="true"> · </span> : null}
          <span className={part.className}>{part.text}</span>
        </span>
      ))}
    </span>
  );
}

/**
 * The button that does the row's next step. Call dials (a phone's dialer, or Google Voice on a computer)
 * and opens their card underneath, so what you set after the call is one tap away; dialing records nothing.
 * Open opens their card.
 */
function NextAction({ member, step, name, onOpen, className }: { member: TeamMember; step: TeamNextStep; name: string; onOpen: () => void; className?: string }) {
  const tel = step.kind === "call" ? phoneHref(member.row.phone) : null;
  if (tel) {
    return (
      <Button asChild variant="outline" className={className}>
        <a href={tel} {...contactLinkProps(tel)} aria-label={`Call ${name}: ${step.why}`} title={`Call: ${step.why}`} onClick={onOpen}>
          <Phone className="h-4 w-4" aria-hidden /> Call
        </a>
      </Button>
    );
  }
  return (
    <Button type="button" variant="ghost" className={className} aria-label={`Open ${name}`} title={step.why} onClick={onOpen}>
      Open <ChevronRight className="h-4 w-4" aria-hidden />
    </Button>
  );
}

/**
 * One person on one row: who (the whole row opens their card), their step as a coloured bar and word with
 * one fact, the facts that matter, and one button that does the next step. From 1024px the step sits in its
 * own column so rows read like a table.
 */
function MemberRow({ member, todayKey, isMe, showUpline, myAgentId, selected, onOpen }: {
  member: TeamMember;
  todayKey: string;
  isMe: boolean;
  showUpline: boolean;
  myAgentId: string | null;
  selected: boolean;
  onOpen: () => void;
}) {
  const r = member.row;
  const stage = teamStage(member, todayKey);
  const step = teamNextStep(member, { isMe });
  const name = r.full_name?.trim() || "Name not on file";
  const ids = { name: `team-${r.agent_id}-name`, status: `team-${r.agent_id}-status`, facts: `team-${r.agent_id}-facts` };
  return (
    <li className={cn("relative flex items-center gap-3 rounded-xl border border-border bg-card px-3 py-3 transition-colors sm:px-4", ROW_HOVER, selected && "border-primary/50 bg-muted/40")}>
      {/* On a phone the bubble gives its width to the name; the bar and the word carry the colour. */}
      <MemberBubble name={r.full_name} tone={stage.tone} className="hidden sm:inline-flex" />
      {/* The row's button is named by the person and described by where they are, so a screen reader hears
          "Ann Lee, button" and then the step, without the whole row read as one long name. */}
      <button
        type="button"
        onClick={onOpen}
        aria-labelledby={ids.name}
        aria-describedby={`${ids.status} ${ids.facts}`}
        aria-haspopup="dialog"
        aria-expanded={selected}
        className="grid min-w-0 flex-1 grid-cols-1 gap-y-1 rounded-md text-left after:absolute after:inset-0 after:rounded-xl after:content-[''] focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)] lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-center lg:gap-x-6 lg:gap-y-0.5"
      >
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 lg:col-start-1 lg:row-start-1">
          <span id={ids.name} className="break-words text-base font-semibold leading-6 text-foreground">
            {name}
            {isMe ? <span className="font-normal text-muted-foreground"> (you)</span> : null}
          </span>
          {/* Renders nothing until the Over $5K rule's metric and period are confirmed (src/lib/overFiveK.ts). */}
          <OverFiveKBadge row={r} />
        </span>
        <span id={ids.status} className="flex min-w-0 lg:col-start-2 lg:row-span-2 lg:row-start-1">
          <TeamStageMark stage={stage} stacked />
        </span>
        <span className="lg:col-start-1 lg:row-start-2"><Facts id={ids.facts} member={member} showUpline={showUpline} myAgentId={myAgentId} /></span>
      </button>
      <NextAction member={member} step={step} name={name} onOpen={onOpen} className="relative z-10 h-11 shrink-0 px-3 lg:w-28" />
    </li>
  );
}

/** The order and the colours, in words, for anyone who wonders why this person is first. */
function HowItWorks() {
  const sample = (key: "licensing" | "no_sale" | "selling" | "quiet"): TeamStage => {
    const s = TEAM_STEPS.find((x) => x.key === key)!;
    return { key, label: s.label, index: s.index, tone: teamStepTone(key), detail: null };
  };
  return (
    <div className="space-y-4 rounded-xl border border-border bg-card p-4 text-[15px] leading-[22px] sm:p-5">
      <div className="space-y-2">
        <p className="font-semibold text-foreground">The steps</p>
        <ul className="space-y-2">
          {TEAM_STEPS.map((s) => (
            <li key={s.key} className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <TeamStageMark stage={sample(s.key)} />
              <span className="text-muted-foreground">{s.means}</span>
            </li>
          ))}
        </ul>
        <p className="text-muted-foreground">A sale counts once it is posted. The four numbers on top are these four steps, so they add up to Everyone.</p>
      </div>
      <div className="space-y-2">
        <p className="font-semibold text-foreground">The order</p>
        <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
          <li>No sale yet, the newest first: the first weeks decide whether they start selling.</li>
          <li>Gone quiet, the most recent sale first: the easiest to bring back.</li>
          <li>Getting licensed, the furthest along first.</li>
          <li>Selling, the most ALP in the last 30 days first.</li>
        </ol>
      </div>
      <p className="text-muted-foreground">
        Call dials and opens their card. Dialing records nothing. Their card holds the training stage, work days, login and every production number. Inactive people, placeholder seats and the other lists are under More lists.
      </p>
    </div>
  );
}

/** Nothing in this list: say why in plain words and offer the way back. */
function EmptyList({ list, search, factsState, onClearSearch, onEveryone }: {
  list: TeamListKey;
  search: string;
  factsState: TeamListProps["factsState"];
  onClearSearch: () => void;
  onEveryone: () => void;
}) {
  if (search.trim()) {
    return (
      <EmptyState
        icon={<Search />}
        title={`Nobody here matches “${search.trim()}”`}
        description={list === "everyone" ? "Search by name, phone number, email or upline. Inactive people are under More lists." : "Search by name, phone number, email or upline, or look in Everyone."}
        actions={<Button type="button" variant="outline" className="h-11" onClick={onClearSearch}>Clear search</Button>}
      />
    );
  }
  if (teamListDef(list).needsFacts && factsState !== "ready") {
    return (
      <EmptyState
        icon={<ShieldAlert />}
        variant="warning"
        title="This list is not ready"
        description="It is built from the training stage, work days and logins, which have not loaded."
        actions={<Button type="button" variant="outline" className="h-11" onClick={onEveryone}>Show everyone</Button>}
      />
    );
  }
  const copy: Partial<Record<TeamListKey, { title: string; description: string; good: boolean }>> = {
    everyone: { title: "Nobody active on your team", description: "Inactive people and placeholder seats are under More lists.", good: false },
    no_sale: { title: "Everyone licensed has a sale", description: "Nobody licensed is waiting on a first sale.", good: true },
    quiet: { title: "Nobody has gone quiet", description: "Everyone who sold before has a sale in the last 30 days.", good: true },
    licensing: { title: "Everyone is licensed", description: "Nobody on the team is still getting licensed.", good: true },
    selling: { title: "No sales in the last 30 days", description: "When someone posts a sale, they show up here.", good: false },
    new_hires: { title: "Nobody joined in the last 30 days", description: "New people show up here for their first 30 days.", good: false },
    free_leads: { title: "Nobody qualifies for free leads right now", description: "Agents qualify once they are live and producing.", good: false },
    free_leads_close: { title: "Nobody is close to free leads", description: "Agents within $5,000 of the free-leads bar show up here.", good: false },
    no_login: { title: "Everyone has a login", description: "Every person on the team can sign in.", good: true },
    stage_unset: { title: "Every training stage is set", description: "Everyone on the team has a training stage.", good: true },
    no_schedule: { title: "Everyone has work days set", description: "Everyone on the team has the weekdays they work.", good: true },
    not_active: { title: "Nobody is inactive", description: "People marked inactive, pending or terminated show up here.", good: true },
    sync_only: { title: "No placeholder seats", description: "Every posted sale is matched to a real agent.", good: true },
  };
  const c = copy[list] ?? { title: "Nobody here", description: "Nothing on the team fits this list right now.", good: false };
  return (
    <EmptyState
      icon={c.good ? <BadgeCheck /> : <Users />}
      variant={c.good ? "success" : "default"}
      title={c.title}
      description={c.description}
      actions={list !== "everyone" ? <Button type="button" variant="outline" className="h-11" onClick={onEveryone}>Show everyone</Button> : undefined}
    />
  );
}
