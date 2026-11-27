// My Team's one list (OVERHAUL-myteam, 2026-10-31). Sam: "I literally just look at it and it gave me a
// full headache." The brief: one clear list with stage colour, one next action per row, and no more than
// four summary numbers.
//
// What it replaced: a production strip with eight figures (today's line, a streak, team size, producing,
// new hires with no sale, month ALP), a four-way view switch, seven filter chips, a search, rows with a
// stage dropdown, a work-days summary, a login line and a Work days button each, two folded panels, and
// for agents a second roster with eleven groups, three dropdowns and an eight-column table.
//
// What it is now: four numbers that each open their list (Talk to first, No sale yet, Gone quiet, Selling);
// Everyone and More lists; a search; then one list in the order to work it. Every row is a person, their step
// as a coloured bar and word with one plain fact, how long since anyone talked to them, and the actions: Call,
// Text and Talked for the people with a phone, Open for everyone else. Tapping a row opens their card, where
// stage, work days, login and production live. Every number and row comes from src/lib/teamList.ts over the
// same loaded rows, so a number always equals the list it opens.
//
// 2026-11-26 (Sam, voice note): "the goal is again to prevent drop-off ... add buttons, because we'll just
// talk to them, and then add ranking based on how recently I talked to them." The order is now drop-off risk
// first (src/lib/teamList.ts dropOffRisk), each row says when they were last talked to, and Talked writes the
// check-in stamp the ranking reads, so a tap re-sorts the list.
//
// Same day, Sam: "make it easy for me to send over links such as the Discord link or anything like that."
// Every on-team row and the person card carry Send links (SendLinksMenu): text the first-steps links, email
// the hired first-steps email, or copy the text. The links come from src/hooks/useFirstStepLinks.ts and the
// text from src/lib/firstStepsLinks.ts.
//
// 2026-11-27 (Sam, voice note): "see what contracts they have back ... if they have Ethos back already ...
// if there's an Instagram account ... any production they've done in the past ... what carriers they have, what
// they sold, their last sign in ... and a filter to see which one of those guys I can filter by state." Every
// on-team row now carries a second line of facts (ProfileFacts: Ethos, carrier contracts, what they sold, state,
// Instagram, last sign-in) from src/lib/teamProfile.ts; the controls gain a state filter and two Ethos chips that
// narrow the numbers and the list alike (?state=WI&ethos=back); More lists gains Ethos back, Licensed with no
// Ethos on file, no carrier contracts, and Never signed in; and the Links menu texts any one link on its own,
// emails them, opens their Instagram or copies their number.
import { useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import {
  BadgeCheck, Check, ChevronDown, ChevronRight, Copy, Hourglass, Instagram, Link2, ListFilter, Mail, MessageSquare, Moon, Phone, RefreshCw,
  Search, ShieldAlert, Target, TrendingUp, UserRound, Users, X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { ToneBubble } from "@/components/ui/delight/ToneBubble";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { GrowScoreboard, type ScoreTile } from "@/components/recruiting/GrowScoreboard";
import { OverFiveKBadge } from "@/components/team/OverFiveKBadge";
import { teamCarrierLine, useTeamCarrierSummary, type TeamCarrierStats } from "@/components/team/AgentCarrierBookPanel";
import { useFirstStepLinks } from "@/hooks/useFirstStepLinks";
import { buildFirstStepsText, firstNameOf, firstStepsLinkLines, type FirstStepLinks } from "@/lib/firstStepsLinks";
import { contactLinkProps, formatPhoneDisplay, isDialablePhone, phoneHref, smsHref } from "@/lib/phone";
import { firstGrapheme } from "@/lib/personInitials";
import { carriersWords, ethosWords, instagramUrl, signInWords, soldWords, stateName, type TeamProfile } from "@/lib/teamProfile";
import { plural, usdOrNull, type RosterRow } from "@/lib/teamRoster";
import { TONE_CLASS, teamStepTone, type Tone } from "@/lib/tones";
import { cn } from "@/lib/utils";
import {
  TEAM_BAR_STEPS, TEAM_MORE_LISTS, TEAM_STEPS, TEAM_TILE_LISTS,
  dropOffRisk, dropOffTone, hasTeamFilters, lastTalkedWords, listAlp30, matchesTeamFilters, matchesTeamSearch, onTeam, parseTeamFilters, parseTeamList,
  teamFilterWords, teamListCounts, teamListDef, teamListRows, teamNextStep, teamStage, teamStateOptions, trainingStageWords,
  type DropOffRisk, type TeamFilters, type TeamListKey, type TeamMember, type TeamStage,
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
  drop_off: { hint: "High or medium drop-off risk", icon: <Hourglass />, emphasis: true },
  no_sale: { hint: "Licensed, no sale yet", icon: <Target /> },
  quiet: { hint: "No sale in 30+ days", icon: <Moon />, emphasis: true },
  selling: { hint: "Sold in the last 30 days", icon: <TrendingUp /> },
};

/** A tile's tone: the step's own, or the act-now red for the people to talk to first. */
const tileTone = (key: TeamListKey): Tone => (key === "drop_off" ? dropOffTone("high") : teamStepTone(key));

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
  /**
   * Mark a person talked to today: writes the check-in stamp the drop-off ranking reads (the same write as the
   * card's "Mark checked in"). Absent for a viewer who may not write it; their rows offer Call and Text only.
   */
  onMarkTalked?: (agentId: string) => void;
  /** Why Talked is off for this person ("No application on file"), or null when it can be pressed. */
  markTalkedBlocked?: (agentId: string) => string | null;
  /** The person whose Talked is saving right now, so a double tap cannot write twice. */
  markingTalkedId?: string | null;
  /**
   * Re-queue and send the hired first-steps email to this person (Send links > Email the first steps). Absent for a
   * viewer who may not; their menu offers Text and Copy only.
   */
  onEmailFirstSteps?: (agentId: string) => void;
  /** The person whose first-steps email is being sent right now. */
  emailingFirstStepsId?: string | null;
  /**
   * The profile facts on every member (state, Ethos, carriers, sign-in; src/hooks/useTeamProfiles.ts): "ready"
   * once loaded, "error" when the read failed. The filters and the lists built on them wait for "ready".
   */
  profileState: "loading" | "error" | "ready";
  onRetryProfiles?: () => void;
}

export function TeamList({
  members, status, error, staleSince, fetching = false, onRetry, factsState, onRetryFacts, todayKey, myAgentId,
  showUpline, selectedId, onOpenPerson, emptyAction, pageActions, onMarkTalked, markTalkedBlocked, markingTalkedId = null,
  onEmailFirstSteps, emailingFirstStepsId = null, profileState, onRetryProfiles,
}: TeamListProps) {
  const [params, setParams] = useSearchParams();
  // One read for every row's Send links menu; the person card reads the same key, so the two cannot disagree.
  const firstStepLinks = useFirstStepLinks();
  const requested = parseTeamList(params.get("list"));
  const factsReady = factsState === "ready";
  const profileReady = profileState === "ready";
  // A list built on the team facts is not offered to someone who cannot read them.
  const list: TeamListKey = factsState === "none" && teamListDef(requested).needsFacts ? "everyone" : requested;
  const search = params.get("q") ?? "";
  // The state and Ethos filters live in the URL (?state=WI&ethos=back), so a filtered view can be shared or reloaded.
  const filters = useMemo(() => parseTeamFilters((key) => params.get(key)), [params]);
  const [shown, setShown] = useState(PAGE);
  const [explainOpen, setExplainOpen] = useState(false);
  // Live Ethos + Combined book per person (scoped in the database); a failed read just leaves the line off.
  const carrier = useTeamCarrierSummary();

  const searched = useMemo(() => members.filter((m) => matchesTeamSearch(m, search)), [members, search]);
  // The filters narrow the people BEFORE the numbers and the list are drawn, so every tile answers for the filtered people.
  const filtered = useMemo(() => searched.filter((m) => matchesTeamFilters(m, filters)), [searched, filters]);
  const counts = useMemo(() => teamListCounts(filtered, { factsReady, profileReady, todayKey, myAgentId }), [filtered, factsReady, profileReady, todayKey, myAgentId]);
  const visible = useMemo(() => teamListRows(filtered, list, todayKey, myAgentId), [filtered, list, todayKey, myAgentId]);
  // The states to offer come from everyone, never from the filtered set, so picking one does not hide the others.
  const stateOptions = useMemo(() => teamStateOptions(members), [members]);
  const filterWords = teamFilterWords(filters);
  const notShown = Math.max(0, visible.length - shown);

  const setParam = (key: string, value: string | null) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value) next.set(key, value);
      else next.delete(key);
      return next;
    }, { replace: true });
  };
  const clearFilters = () => {
    setParams((prev) => { const next = new URLSearchParams(prev); next.delete("state"); next.delete("ethos"); return next; }, { replace: true });
    setShown(PAGE);
  };
  const setEthosFilter = (value: TeamFilters["ethos"]) => { setParam("ethos", filters.ethos === value ? null : value); setShown(PAGE); };
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
    tone: tileTone(key),
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
          {/* 2026-11-27 (Sam): "filter by state, see who's in Wisconsin." The state list is built from the loaded facts, with
              how many people are in each; the two Ethos chips are the contract Sam reads for first. Off until the facts load. */}
          <div role="group" aria-label="Filter your team" className="flex flex-wrap items-center gap-2">
            <Select value={filters.state ?? "all"} onValueChange={(value) => { setParam("state", value === "all" ? null : value); setShown(PAGE); }} disabled={!profileReady && !filters.state}>
              <SelectTrigger className="h-11 w-full bg-card text-[15px] sm:w-64" aria-label="Filter by state">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="min-h-11 text-[15px]">
                  {profileReady ? "Every state" : profileState === "error" ? "Every state (states did not load)" : "Every state (loading)"}
                </SelectItem>
                {stateOptions.map((s) => (
                  <SelectItem key={s.code} value={s.code} className="min-h-11 text-[15px]">
                    {s.name} <span className="tabular-nums text-muted-foreground">({s.count})</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <button type="button" aria-pressed={filters.ethos === "back"} disabled={!profileReady && filters.ethos !== "back"} title={teamListDef("ethos").rule} onClick={() => setEthosFilter("back")} className={cn(chipClass(filters.ethos === "back"), "disabled:opacity-60")}>
              Ethos back
            </button>
            <button type="button" aria-pressed={filters.ethos === "none"} disabled={!profileReady && filters.ethos !== "none"} title={teamListDef("no_ethos").rule} onClick={() => setEthosFilter("none")} className={cn(chipClass(filters.ethos === "none"), "disabled:opacity-60")}>
              No Ethos on file
            </button>
            {hasTeamFilters(filters) ? (
              <Button type="button" variant="ghost" className="h-11 px-3 text-muted-foreground" onClick={clearFilters}>
                <X className="h-4 w-4" aria-hidden /> Clear filters
              </Button>
            ) : null}
          </div>
        </div>
      )}

      {loaded && profileState === "error" && (
        <div role="status" className="flex flex-col gap-2 rounded-lg border border-tone-warm/35 bg-tone-warm/8 p-3 text-sm text-foreground sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-start gap-2 font-medium">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-tone-warm" aria-hidden />
            State, Instagram, contracts and sign-in did not load. Everyone is still listed; the filters and the lists built on them wait for those facts.
          </p>
          {onRetryProfiles && <Button type="button" variant="outline" className="h-11 shrink-0" onClick={onRetryProfiles}><RefreshCw className="h-4 w-4" aria-hidden /> Try again</Button>}
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
                {filterWords ? <span className="font-medium text-foreground">{` ${filterWords}`}</span> : null}
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
            <EmptyList list={list} search={search} filters={filters} factsState={factsState} profileState={profileState} onClearSearch={() => setParam("q", null)} onClearFilters={clearFilters} onEveryone={() => pickList("everyone")} />
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
                  carrier={carrier.data?.[member.row.agent_id]}
                  onOpen={() => onOpenPerson(member.row.agent_id)}
                  onMarkTalked={onMarkTalked}
                  markTalkedBlocked={markTalkedBlocked}
                  markingTalked={markingTalkedId === member.row.agent_id}
                  links={firstStepLinks.data}
                  linksFailed={firstStepLinks.isError}
                  onEmailFirstSteps={onEmailFirstSteps}
                  emailingFirstSteps={emailingFirstStepsId === member.row.agent_id}
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
 * The facts after the step: when anyone last talked to them (the fact the order runs on), the carrier book,
 * training stage, whose team, the two flags worth knowing, and the phone. The number is last and hidden on a
 * phone, where the Call button dials it and the card shows it; "No phone on file" always shows, because it is
 * why a row offers no call.
 */
function Facts({ member, todayKey, showUpline, myAgentId, id, carrier }: { member: TeamMember; todayKey: string; showUpline: boolean; myAgentId: string | null; id: string; carrier?: TeamCarrierStats }) {
  const { row, facts } = member;
  const parts: Array<{ key: string; text: string; className?: string; wideOnly?: boolean }> = [];
  const talked = lastTalkedWords(member, todayKey);
  if (talked) parts.push({ key: "talked", text: talked });
  const book = teamCarrierLine(carrier);
  if (book) parts.push({ key: "carrier", text: book.text, className: cn("font-medium", book.tone === "good" ? TONE_CLASS.good.text : book.tone === "bad" ? "text-red-700 dark:text-red-300" : book.tone === "warn" ? TONE_CLASS.warm.text : undefined) });
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

/** The short name of one first-steps link, for a menu item: "Text the Discord link". */
const LINK_SHORT_NAME: Record<"training" | "slack" | "discord" | "call", string> = { training: "training", slack: "Slack", discord: "Discord", call: "booking" };

/**
 * Links and more: text the first-steps links (training, Slack, Discord, the call with Sam) together or any one of
 * them on its own, email the hired first-steps email, copy the text, and reach the person another way: email,
 * their Instagram, or their number copied. Shared by every row and the person card, so the two offer the same
 * things. Each item says why it is off instead of doing nothing: no phone, not licensed, no email, no Instagram
 * on file, or the links not loaded yet.
 */
export function SendLinksMenu({ row, name, links, linksFailed, onEmailFirstSteps, emailing = false, compact = false, profile, className }: {
  row: Pick<RosterRow, "agent_id" | "full_name" | "phone" | "email" | "license_status">;
  name: string;
  /** From useFirstStepLinks(); undefined while loading or after a failed read. */
  links: FirstStepLinks | undefined;
  linksFailed: boolean;
  /** Re-queue and send the hired first-steps email; absent when this viewer may not. */
  onEmailFirstSteps?: (agentId: string) => void;
  emailing?: boolean;
  /** Icon-only below 640px, for a row that already holds Call, Text and Talked. */
  compact?: boolean;
  /** Their profile facts, for the Instagram item; absent or null while they load. */
  profile?: Pick<TeamProfile, "instagram"> | null;
  className?: string;
}) {
  const body = links ? buildFirstStepsText(firstNameOf(row.full_name), links) : null;
  const linksBlock = linksFailed ? "The links did not load" : !links ? "Loading the links" : null;
  const dialable = isDialablePhone(row.phone);
  const sms = body && dialable ? smsHref(row.phone, body) : null;
  const textBlock = linksBlock ?? (dialable ? null : "No phone on file");
  const emailBlock = emailing ? "Sending" : row.license_status !== "licensed" ? "Licensed hires only" : !row.email ? "No email on file" : null;
  const lines = links ? firstStepsLinkLines(links) : [];
  const included = links ? lines.map((l) => l.key === "training" ? "training" : l.key === "call" ? "the call with Sam" : l.label).join(", ") : null;
  const instagram = instagramUrl(profile?.instagram);
  const phoneShown = formatPhoneDisplay(row.phone);
  const copyText = async (text: string, done: string, blocked: string) => {
    try {
      if (!navigator.clipboard) throw new Error("no clipboard");
      await navigator.clipboard.writeText(text);
      toast.success(done);
    } catch {
      toast.error(blocked);
    }
  };
  const copy = () => { if (body) void copyText(body, "Links copied. Paste them into a text or DM.", "Copy blocked, use Text the links"); };
  const item = "min-h-11 gap-2 text-[15px]";
  const off = (why: string) => <span className="ml-auto text-[13px] text-muted-foreground">{why}</span>;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className={cn(compact ? "h-11 w-11 px-0 sm:w-auto sm:px-3" : "h-10 gap-1.5", className)} aria-label={`Links and more for ${name}`} title="Links and more">
          <Link2 className="h-4 w-4" aria-hidden /> <span className={compact ? "hidden sm:inline" : undefined}>{compact ? "Links" : "Links and more"}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel className="text-[13px] font-normal text-muted-foreground">
          {included ? `Includes ${included}` : linksBlock}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {sms && !textBlock ? (
          <DropdownMenuItem asChild className={item}>
            <a href={sms} {...contactLinkProps(sms)} aria-label={`Text the links to ${name}`}>
              <MessageSquare className="h-4 w-4" aria-hidden /> Text all the links
            </a>
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem disabled className={item} title={textBlock ?? undefined} aria-label={`Text the links to ${name}`}>
            <MessageSquare className="h-4 w-4" aria-hidden /> Text all the links{off(textBlock ?? "")}
          </DropdownMenuItem>
        )}
        {/* One link at a time: "send over a Discord link" is the common case (Sam, 2026-11-26 and 2026-11-27). */}
        {sms && !textBlock ? lines.map((l) => {
          const one = smsHref(row.phone, `${l.label}: ${l.url}`) ?? sms;
          return (
            <DropdownMenuItem key={l.key} asChild className={item}>
              <a href={one} {...contactLinkProps(one)} aria-label={`Text the ${LINK_SHORT_NAME[l.key]} link to ${name}`}>
                <MessageSquare className="h-4 w-4" aria-hidden /> Text the {LINK_SHORT_NAME[l.key]} link
              </a>
            </DropdownMenuItem>
          );
        }) : null}
        {onEmailFirstSteps ? (
          <DropdownMenuItem disabled={Boolean(emailBlock)} className={item} title={emailBlock ?? undefined} aria-label={`Email the first steps to ${name}`} onSelect={() => onEmailFirstSteps(row.agent_id)}>
            <Mail className="h-4 w-4" aria-hidden /> Email the first steps{emailBlock ? off(emailBlock) : null}
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem disabled={Boolean(linksBlock)} className={item} title={linksBlock ?? undefined} aria-label={`Copy the links for ${name}`} onSelect={copy}>
          <Copy className="h-4 w-4" aria-hidden /> Copy links{linksBlock ? off(linksBlock) : null}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-[13px] font-normal text-muted-foreground">Reach them</DropdownMenuLabel>
        {row.email ? (
          <DropdownMenuItem asChild className={item}>
            <a href={`mailto:${row.email}`} aria-label={`Email ${name}`}><Mail className="h-4 w-4" aria-hidden /> Email</a>
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem disabled className={item} aria-label={`Email ${name}`}><Mail className="h-4 w-4" aria-hidden /> Email{off("No email on file")}</DropdownMenuItem>
        )}
        {instagram ? (
          <DropdownMenuItem asChild className={item}>
            <a href={instagram} target="_blank" rel="noopener noreferrer" aria-label={`Open the Instagram of ${name}`}>
              <Instagram className="h-4 w-4" aria-hidden /> Instagram <span className="truncate text-muted-foreground">@{profile?.instagram}</span>
            </a>
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem disabled className={item} aria-label={`Open the Instagram of ${name}`}>
            <Instagram className="h-4 w-4" aria-hidden /> Instagram{off(profile === undefined ? "Loading" : "None on file")}
          </DropdownMenuItem>
        )}
        <DropdownMenuItem disabled={!phoneShown} className={item} aria-label={`Copy the number of ${name}`} onSelect={() => { if (phoneShown) void copyText(phoneShown, `Number copied: ${phoneShown}`, "Copy blocked"); }}>
          <Phone className="h-4 w-4" aria-hidden /> Copy number{phoneShown ? <span className="ml-auto text-[13px] tabular-nums text-muted-foreground">{phoneShown}</span> : off("No phone on file")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The row's actions. Someone on the team with a phone that can be dialled gets Call (a phone's dialer, or Google
 * Voice on a computer; it opens their card underneath so what you set after the call is one tap away), Text (the
 * messages app, or Google Voice), and Talked, which stamps today as the day you spoke so they drop down the
 * list. Call and Text record nothing. Everyone on the team but you also gets Send links. Everyone else (no
 * phone, off the team, you) gets Open, which opens their card.
 */
function RowActions({ member, name, isMe, onOpen, onMarkTalked, markTalkedBlocked, markingTalked, links, linksFailed, onEmailFirstSteps, emailingFirstSteps, className }: {
  member: TeamMember;
  name: string;
  isMe: boolean;
  onOpen: () => void;
  onMarkTalked?: (agentId: string) => void;
  markTalkedBlocked?: (agentId: string) => string | null;
  markingTalked: boolean;
  links: FirstStepLinks | undefined;
  linksFailed: boolean;
  onEmailFirstSteps?: (agentId: string) => void;
  emailingFirstSteps: boolean;
  className?: string;
}) {
  const { row } = member;
  const step = teamNextStep(member, { isMe });
  const theirs = onTeam(row) && !isMe;
  const call = theirs ? phoneHref(row.phone) : null;
  const text = call ? smsHref(row.phone) : null;
  const sendLinks = theirs ? (
    <SendLinksMenu row={row} name={name} links={links} linksFailed={linksFailed} onEmailFirstSteps={onEmailFirstSteps} emailing={emailingFirstSteps} profile={member.profile} compact />
  ) : null;
  if (!call) {
    return (
      <span className={cn("flex items-center gap-1.5", className)}>
        <Button type="button" variant="ghost" className="h-11 px-3" aria-label={`Open ${name}`} title={step.why} onClick={onOpen}>
          Open <ChevronRight className="h-4 w-4" aria-hidden />
        </Button>
        {sendLinks}
      </span>
    );
  }
  const why = step.kind === "call" ? step.why : "catch up";
  const blocked = markTalkedBlocked?.(row.agent_id) ?? null;
  // Call, Text and Links are icon-only on a phone (the name is in the accessible name); Talked keeps its word everywhere.
  const compact = "h-11 w-11 px-0 sm:w-auto sm:px-3";
  return (
    <span className={cn("flex items-center gap-1.5", className)}>
      <Button asChild variant="outline" className={compact}>
        <a href={call} {...contactLinkProps(call)} aria-label={`Call ${name}: ${why}`} title={`Call: ${why}`} onClick={onOpen}>
          <Phone className="h-4 w-4" aria-hidden /> <span className="hidden sm:inline">Call</span>
        </a>
      </Button>
      {text ? (
        <Button asChild variant="outline" className={compact}>
          <a href={text} {...contactLinkProps(text)} aria-label={`Text ${name}`} title="Text">
            <MessageSquare className="h-4 w-4" aria-hidden /> <span className="hidden sm:inline">Text</span>
          </a>
        </Button>
      ) : null}
      {onMarkTalked ? (
        <Button
          type="button"
          variant="outline"
          className="h-11 px-3"
          disabled={Boolean(blocked) || markingTalked}
          aria-label={`Mark ${name} talked to`}
          title={blocked ?? "Mark talked to today"}
          onClick={() => onMarkTalked(row.agent_id)}
        >
          <Check className="h-4 w-4" aria-hidden /> {markingTalked ? "Saving" : "Talked"}
        </Button>
      ) : null}
      {sendLinks}
    </span>
  );
}

/**
 * The second line of facts (2026-11-27, Sam: "what contracts they have back ... Ethos ... Instagram ... what they
 * sold ... last sign in ... filter by state"), as small pills so the eye can scan a column of rows: Ethos back or
 * No Ethos on file, the carrier contracts, what they sold and with whom, their state, their Instagram, and when
 * they last signed in. Nothing until the facts load; nothing for a row off the team. Each pill's tooltip carries
 * the source, so "No Ethos on file" can be checked rather than believed.
 */
function ProfileFacts({ member, id }: { member: TeamMember; id: string }) {
  const { row, profile } = member;
  if (!profile || !onTeam(row)) return <span id={id} hidden />;
  const pills: Array<{ key: string; text: string; tone: "good" | "warn" | null; title?: string }> = [];
  const ethos = ethosWords(profile, row.license_status);
  if (ethos) pills.push({ key: "ethos", ...ethos, title: profile.ethos_back ? `Ethos: ${profile.ethos_source ?? "on file"}${profile.ethos_since ? `, ${profile.ethos_since}` : ""}` : "Nothing on file says their Ethos contract is back" });
  const carriers = carriersWords(profile, row.license_status);
  if (carriers) pills.push({ key: "carriers", text: carriers, tone: null, title: profile.carriers.map((c) => `${c.carrier}: ${c.status} (${c.source}${c.as_of ? `, ${c.as_of}` : ""})`).join("\n") || undefined });
  const sold = soldWords(profile, row.lifetime_alp);
  if (sold) pills.push({ key: "sold", text: sold, tone: null, title: profile.sold_carriers.map((c) => `${c.carrier}: ${c.deals} deals, $${Math.round(c.alp).toLocaleString()}`).join("\n") });
  if (profile.home_state) pills.push({ key: "state", text: profile.home_state, tone: null, title: `${stateName(profile.home_state)} (${profile.home_state_source ?? "on file"})${profile.license_states.length ? `, licensed in ${profile.license_states.join(", ")}` : ""}` });
  if (profile.instagram) pills.push({ key: "ig", text: `@${profile.instagram}`, tone: null, title: "Instagram" });
  const signIn = signInWords(profile);
  if (signIn) pills.push({ key: "signin", ...signIn });
  return (
    <span id={id} className="mt-1 flex flex-wrap gap-1.5">
      {pills.map((p) => (
        <span
          key={p.key}
          title={p.title}
          className={cn(
            "inline-flex max-w-full items-center truncate rounded-md border px-2 py-0.5 text-[12px] font-medium leading-5",
            p.tone === "good" ? cn("border-tone-good/35 bg-tone-good/8", TONE_CLASS.good.text)
              : p.tone === "warn" ? cn("border-tone-warm/35 bg-tone-warm/8", TONE_CLASS.warm.text)
              : "border-border bg-muted/40 text-muted-foreground",
          )}
        >
          {p.text}
        </span>
      ))}
    </span>
  );
}

/** The drop-off level as a small coloured word under the step, for high and medium only, with the reason beside it. */
function DropOffWord({ risk }: { risk: DropOffRisk }) {
  if (risk.level !== "high" && risk.level !== "medium") return null;
  return (
    <span className={cn("pl-14 text-[13px] font-semibold leading-5", TONE_CLASS[dropOffTone(risk.level)].text)} title={risk.why}>
      {risk.level === "high" ? "High" : "Medium"} drop-off risk
      <span className="sr-only">: {risk.why}</span>
    </span>
  );
}

/**
 * One person on one row: who (the whole row opens their card), their step as a coloured bar and word with
 * one fact and their drop-off risk when it is high or medium, the facts that matter, and the actions. From
 * 1024px the step sits in its own column so rows read like a table.
 */
function MemberRow({ member, todayKey, isMe, showUpline, myAgentId, selected, onOpen, carrier, onMarkTalked, markTalkedBlocked, markingTalked, links, linksFailed, onEmailFirstSteps, emailingFirstSteps }: {
  member: TeamMember;
  carrier?: TeamCarrierStats;
  todayKey: string;
  isMe: boolean;
  showUpline: boolean;
  myAgentId: string | null;
  selected: boolean;
  onOpen: () => void;
  onMarkTalked?: (agentId: string) => void;
  markTalkedBlocked?: (agentId: string) => string | null;
  markingTalked: boolean;
  links: FirstStepLinks | undefined;
  linksFailed: boolean;
  onEmailFirstSteps?: (agentId: string) => void;
  emailingFirstSteps: boolean;
}) {
  const r = member.row;
  const stage = teamStage(member, todayKey);
  const risk = dropOffRisk(member, todayKey, { isMe });
  const name = r.full_name?.trim() || "Name not on file";
  const ids = { name: `team-${r.agent_id}-name`, status: `team-${r.agent_id}-status`, facts: `team-${r.agent_id}-facts`, profile: `team-${r.agent_id}-profile` };
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
        aria-describedby={`${ids.status} ${ids.facts} ${ids.profile}`}
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
        <span id={ids.status} className="flex min-w-0 flex-col lg:col-start-2 lg:row-span-3 lg:row-start-1">
          <TeamStageMark stage={stage} stacked />
          <DropOffWord risk={risk} />
        </span>
        <span className="lg:col-start-1 lg:row-start-2"><Facts id={ids.facts} member={member} todayKey={todayKey} showUpline={showUpline} myAgentId={myAgentId} carrier={carrier} /></span>
        <span className="lg:col-start-1 lg:row-start-3"><ProfileFacts id={ids.profile} member={member} /></span>
      </button>
      <RowActions
        member={member}
        name={name}
        isMe={isMe}
        onOpen={onOpen}
        onMarkTalked={onMarkTalked}
        markTalkedBlocked={markTalkedBlocked}
        markingTalked={markingTalked}
        links={links}
        linksFailed={linksFailed}
        onEmailFirstSteps={onEmailFirstSteps}
        emailingFirstSteps={emailingFirstSteps}
        className="relative z-10 shrink-0 lg:w-[22rem] lg:justify-end"
      />
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
        <p className="text-muted-foreground">A sale counts once it is posted. Everyone on the team is on exactly one step. Getting licensed is under More lists.</p>
      </div>
      <div className="space-y-2">
        <p className="font-semibold text-foreground">Drop-off risk</p>
        <p className="text-muted-foreground">
          How long since anyone talked to them, weighted by their step. Getting licensed and No sale yet weigh most: a new agent nobody talks to is the one who disappears. Gone quiet weighs high. Selling weighs least, and a seller with a sale in the last 14 days is not at risk. Never talked to is the worst. Each row says why.
        </p>
        <ul className="space-y-1 text-muted-foreground">
          <li><span className={cn("font-semibold", TONE_CLASS[dropOffTone("high")].text)}>High</span>: two weeks of silence, or never talked to, while getting licensed or waiting on a first sale. Three weeks when gone quiet.</li>
          <li><span className={cn("font-semibold", TONE_CLASS[dropOffTone("medium")].text)}>Medium</span>: one week of silence while getting licensed or waiting on a first sale. Ten days when gone quiet.</li>
        </ul>
      </div>
      <div className="space-y-2">
        <p className="font-semibold text-foreground">The order</p>
        <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
          <li>The highest drop-off risk first, whatever their step.</li>
          <li>Then No sale yet, the newest first: the first weeks decide whether they start selling.</li>
          <li>Gone quiet, the most recent sale first: the easiest to bring back.</li>
          <li>Getting licensed, the furthest along first.</li>
          <li>Selling, the most ALP in the last 30 days first.</li>
        </ol>
      </div>
      <p className="text-muted-foreground">
        Call dials and opens their card. Text opens a message. Neither records anything. Talked marks today as the day you spoke, which is what the risk reads, so they move down the list. Links texts, emails or copies the first steps: the training videos, Slack, Discord and the call with Sam, together or one link at a time, and reaches them by email, Instagram or their copied number. Their card holds the training stage, work days, login and every production number. Inactive people, placeholder seats and the other lists are under More lists.
      </p>
      <div className="space-y-2">
        <p className="font-semibold text-foreground">Contracts, state and the filters</p>
        <p className="text-muted-foreground">
          The second line on each row: Ethos back means the person is on the Ethos hierarchy export, the Ethos portal, or was marked received in the contracting review; No Ethos on file means nothing on file says so, not that they lack it. Then their carrier contracts (AgentLink and the review), what they have sold and with which carrier, their state, their Instagram, and when they last signed in. The state filter and the two Ethos chips narrow the numbers and the list together, and the filtered view lives in the address bar, so it can be shared. Ethos back, Licensed with no Ethos on file, no carrier contracts, and Never signed in are under More lists.
        </p>
      </div>
    </div>
  );
}

/** Nothing in this list: say why in plain words and offer the way back. */
function EmptyList({ list, search, filters, factsState, profileState, onClearSearch, onClearFilters, onEveryone }: {
  list: TeamListKey;
  search: string;
  filters: TeamFilters;
  factsState: TeamListProps["factsState"];
  profileState: TeamListProps["profileState"];
  onClearSearch: () => void;
  onClearFilters: () => void;
  onEveryone: () => void;
}) {
  const filterWords = teamFilterWords(filters);
  if (filterWords && profileState !== "ready") {
    return (
      <EmptyState
        icon={<ShieldAlert />}
        variant="warning"
        title={profileState === "error" ? "The facts this filter needs did not load" : "Waiting for the state and contract facts"}
        description={`Nobody is shown ${filterWords} until the state, Ethos and contract facts have loaded, so the list never claims a match it cannot check.`}
        actions={<Button type="button" variant="outline" className="h-11" onClick={onClearFilters}>Clear filters</Button>}
      />
    );
  }
  if (filterWords) {
    return (
      <EmptyState
        icon={<Users />}
        title={`Nobody here ${filterWords}`}
        description={search.trim() ? "Nobody matches this search and these filters together." : list === "everyone" ? "Nobody on the team matches these filters." : `Nobody in ${teamListDef(list).label} matches these filters.`}
        actions={<Button type="button" variant="outline" className="h-11" onClick={onClearFilters}>Clear filters</Button>}
      />
    );
  }
  if (teamListDef(list).needsProfile && profileState !== "ready") {
    return (
      <EmptyState
        icon={<ShieldAlert />}
        variant="warning"
        title="This list is not ready"
        description="It is built from the state, Ethos, contract and sign-in facts, which have not loaded."
        actions={<Button type="button" variant="outline" className="h-11" onClick={onEveryone}>Show everyone</Button>}
      />
    );
  }
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
    drop_off: { title: "Nobody is at risk of dropping off", description: "Everyone on the team has been talked to recently enough for where they are.", good: true },
    no_sale: { title: "Everyone licensed has a sale", description: "Nobody licensed is waiting on a first sale.", good: true },
    quiet: { title: "Nobody has gone quiet", description: "Everyone who sold before has a sale in the last 30 days.", good: true },
    licensing: { title: "Everyone is licensed", description: "Nobody on the team is still getting licensed.", good: true },
    ethos: { title: "Nobody has Ethos back on file", description: "Nobody on the team is on the Ethos hierarchy export or the Ethos portal, and nobody is marked received in the contracting review.", good: false },
    no_ethos: { title: "Everyone licensed has Ethos back", description: "Every licensed person on the team has their Ethos contract on file.", good: true },
    no_carriers: { title: "Everyone licensed has a carrier contract", description: "Every licensed person on the team has at least one active carrier contract on file.", good: true },
    never_signed_in: { title: "Everyone has signed in", description: "Everyone on the team has signed in to the app at least once.", good: true },
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
