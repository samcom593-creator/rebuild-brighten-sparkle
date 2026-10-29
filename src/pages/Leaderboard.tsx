/**
 * Leaderboard (/dashboard/leaderboard, OVERHAUL-leaderboards 2026-10-29).
 *
 * One question: who is selling the most, and where do I stand? Sam's three rules for it
 * (master prompt 311, item 5):
 *   - Lead spend is gone. Leads are company-funded, so "Lead spend $0" and "After leads" (the
 *     same number as Est. income) sat on every row and in a strip above the board.
 *   - Nobody under $5,000 for the month is ranked or counted, and the board says so.
 *   - Teammates cheer each other's rows, and the whole team sees who cheered.
 *
 * Everything on the sales board comes from one read, leaderboard_team_board() (useTeamBoard),
 * and its numbers from src/lib/leaderboardBoard.ts, so the four numbers on top and the rows
 * under them are the same rows. The team sees the team: an agent used to get a board of one
 * (their own row) because the board followed the CRM's self-and-downline rule; the income
 * estimate still does, so nobody can read a teammate's contract level off a row.
 *
 * Gone from this page, on purpose: the all-time-source hero (its prior month read a different
 * view than the board), the Top Producing Leg tab (it read the retired AgentLink snapshot and
 * failed with a permission error for everyone, Sam included), the Activity tab (it added hours,
 * presentations and dialer calls into one number and read at most 1,000 dialer rows of 7,867 in
 * October), the Custom range (the $5,000 bar is a calendar-month rule), and the diagnostic empty
 * card. Leaders (admin, managers, agency owners) keep the Recruiting and Referrals boards.
 */
import { Fragment, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { DollarSign, PartyPopper, Target, TrendingUp, Trophy, UserPlus, Users } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { QueryState, describeQuery, errorMessage } from "@/components/ui/query-state";
import { TonePill, ToneBubble } from "@/components/ui/delight/ToneBubble";
import { RevealList } from "@/components/ui/delight/Reveal";
import { GrowScoreboard, type ScoreTile } from "@/components/recruiting/GrowScoreboard";
import { useAuth } from "@/hooks/useAuth";
import { useBusinessToday } from "@/hooks/useBusinessToday";
import { useProductionRealtime } from "@/hooks/useProductionRealtime";
import { useSetCheer, useTeamBoard } from "@/hooks/useTeamBoard";
import { useRecruitingBoard } from "@/hooks/useRecruitingBoard";
import { celebrate } from "@/lib/celebrate";
import { BUSINESS_TIMEZONE } from "@/lib/dateUtils";
import { personInitials } from "@/lib/personInitials";
import { TONE_CLASS, type Tone } from "@/lib/tones";
import { cn } from "@/lib/utils";
import {
  BOARD_WINDOWS,
  DEFAULT_BOARD_WINDOW,
  boardMonthStart,
  boardRule,
  boardTiles,
  canCheer,
  cheerLine,
  emptyBoardText,
  formatMoney,
  formatTileMoney,
  isBoardWindow,
  monthName,
  plural,
  rankTone,
  recruitingFacts,
  rowFacts,
  windowPhrase,
  type BoardTile,
  type BoardWindow,
  type RecruitingKind,
  type TeamBoard,
  type TeamBoardRow,
} from "@/lib/leaderboardBoard";

type BoardKind = "sales" | RecruitingKind;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const TILE_ICON: Record<BoardTile["key"], ReactNode> = {
  rank: <Trophy />,
  sales: <DollarSign />,
  next: <TrendingUp />,
  team: <Users />,
};

const formatRank = (n: number) => `#${n.toLocaleString("en-US")}`;

/**
 * Today · This week · This month · Last month, as one radio group: Tab lands on the picked
 * window, the arrow keys move the pick the way native radios do.
 */
function WindowSwitch({ value, onChange }: { value: BoardWindow; onChange: (w: BoardWindow) => void }) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const move = (from: number, step: number) => {
    const next = (from + step + BOARD_WINDOWS.length) % BOARD_WINDOWS.length;
    onChange(BOARD_WINDOWS[next].key);
    refs.current[next]?.focus();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      move(index, 1);
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      move(index, -1);
    }
  };
  return (
    <div role="radiogroup" aria-label="Time window" className="grid w-full grid-cols-4 gap-1 rounded-xl border border-border bg-card p-1 md:inline-grid md:w-auto">
      {BOARD_WINDOWS.map((w, index) => {
        const checked = w.key === value;
        return (
          <button
            key={w.key}
            ref={(el) => { refs.current[index] = el; }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            onKeyDown={(event) => onKeyDown(event, index)}
            onClick={() => onChange(w.key)}
            className={cn(
              "min-h-11 select-none whitespace-nowrap rounded-lg px-1.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)] sm:px-3 sm:text-[15px] md:min-h-10",
              checked ? cn(TONE_CLASS.gold.soft, "text-foreground") : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
            )}
          >
            {w.label}
          </button>
        );
      })}
    </div>
  );
}

/** Facts joined by a middle dot. A fact never breaks across lines, and the dot stays with the fact before it. */
function FactLine({ facts, className }: { facts: string[]; className?: string }) {
  return (
    <p className={cn("text-sm leading-5 text-muted-foreground", className)}>
      {facts.map((fact, i) => (
        <Fragment key={fact}>
          <span className="whitespace-nowrap">{i < facts.length - 1 ? `${fact} ·` : fact}</span>
          {i < facts.length - 1 ? " " : null}
        </Fragment>
      ))}
    </p>
  );
}

/** A face: the photo when there is one and it loads, else initials. Decorative; the name is beside it. */
function Face({ name, url }: { name: string | null; url: string | null }) {
  const [broken, setBroken] = useState(false);
  if (url && !broken) {
    return <img src={url} alt="" loading="lazy" onError={() => setBroken(true)} className="h-10 w-10 shrink-0 rounded-full border border-border object-cover" />;
  }
  return (
    <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border bg-muted text-sm font-semibold text-muted-foreground">
      {personInitials(name, "—")}
    </span>
  );
}

/** The place on the board, in its podium tone for the first three. The number is the word. */
function RankMark({ rank }: { rank: number }) {
  const tone: Tone | null = rankTone(rank);
  return (
    <span
      className={cn(
        "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[15px] font-bold tabular-nums",
        tone ? cn("border", TONE_CLASS[tone].soft, TONE_CLASS[tone].text, TONE_CLASS[tone].border) : "text-muted-foreground",
      )}
    >
      <span className="sr-only">Rank </span>
      {rank.toLocaleString("en-US")}
    </span>
  );
}

function PersonName({ name, agentId, linkable }: { name: string | null; agentId: string | null; linkable: boolean }) {
  const shown = name ?? "—";
  if (linkable && agentId && UUID.test(agentId)) {
    return (
      <Link
        to={`/dashboard/profile?agentId=${encodeURIComponent(agentId)}`}
        // Phones give every link a 44px target (src/index.css); the negative margin keeps that target
        // without pushing the facts a line down.
        className="-my-2.5 inline-flex items-center text-base font-semibold leading-6 text-foreground underline-offset-4 [overflow-wrap:anywhere] hover:underline focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)] sm:my-0"
      >
        {shown}
      </Link>
    );
  }
  return <span className="text-base font-semibold leading-6 text-foreground [overflow-wrap:anywhere]">{shown}</span>;
}

function SalesRow({
  row,
  board,
  todayKey,
  pending,
  onCheer,
}: {
  row: TeamBoardRow;
  board: TeamBoard;
  todayKey: string;
  pending: boolean;
  onCheer: (row: TeamBoardRow, cheer: boolean, from: HTMLElement) => void;
}) {
  const facts = rowFacts(row, todayKey);
  const cheers = cheerLine(row);
  const can = canCheer(board, row);
  const shownName = row.name ?? "this agent";
  return (
    <li
      className={cn(
        // Rank, then the name with its facts and who cheered, then the amount. On phones the Cheer
        // button sits under the amount; from sm it sits to the amount's left.
        "grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-3 px-3 py-3.5 sm:items-center sm:gap-x-4 sm:px-5",
        row.isViewer && "bg-tone-gold/8",
      )}
    >
      <div className="flex items-center gap-3">
        <RankMark rank={row.rank} />
        <span className="hidden sm:flex"><Face name={row.name} url={row.avatarUrl} /></span>
      </div>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <PersonName name={row.name} agentId={row.agentId} linkable={row.readable} />
          {row.isViewer ? <TonePill tone="gold">You</TonePill> : null}
          {row.departed ? <TonePill tone="slate">Left the team</TonePill> : null}
          {row.agency && !/^apex financial$/i.test(row.agency) ? <TonePill tone="royal">{row.agency}</TonePill> : null}
        </div>
        <FactLine facts={facts} className="mt-0.5" />
        {cheers ? (
          <p className="mt-1 flex items-start gap-1.5 text-sm leading-5 text-muted-foreground">
            <PartyPopper className="mt-0.5 h-4 w-4 shrink-0 text-tone-gold" aria-hidden="true" />
            <span>{cheers}</span>
          </p>
        ) : null}
      </div>
      <div className="flex flex-col items-end gap-2 sm:flex-row-reverse sm:items-center sm:gap-5">
        <span className="pt-0.5 text-lg font-bold leading-6 tabular-nums text-foreground sm:min-w-[6.5rem] sm:pt-0 sm:text-right sm:text-xl">{formatMoney(row.ap)}</span>
        {can ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-pressed={row.cheeredByMe}
            aria-label={`${row.cheeredByMe ? "Cheered" : "Cheer"} ${shownName}`}
            disabled={pending}
            onClick={(event) => onCheer(row, !row.cheeredByMe, event.currentTarget)}
            className={cn(
              "h-9 shrink-0 gap-1.5 rounded-full px-3.5 text-sm font-semibold",
              row.cheeredByMe && cn(TONE_CLASS.gold.soft, TONE_CLASS.gold.text, TONE_CLASS.gold.border, "hover:bg-tone-gold/12"),
            )}
          >
            <PartyPopper className="h-4 w-4" aria-hidden="true" />
            {row.cheeredByMe ? "Cheered" : "Cheer"}
          </Button>
        ) : null}
      </div>
    </li>
  );
}

function SalesBoard({ window }: { window: BoardWindow }) {
  const query = useTeamBoard(window);
  const setCheer = useSetCheer();
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const { todayKey } = query;
  const board = query.data ?? null;

  useProductionRealtime(() => {
    void query.refetch();
  }, 300);

  const onCheer = (row: TeamBoardRow, cheer: boolean, from: HTMLElement) => {
    if (!board) return;
    setPendingKey(row.agentKey);
    setCheer.mutate(
      { agentKey: row.agentKey, monthStart: board.monthStart, cheer },
      {
        onSuccess: (result) => {
          if (result.cheeredByMe) void celebrate("save", from);
        },
        onError: (error) => {
          toast.error(`Your cheer did not go through. ${errorMessage(error)}`);
        },
        onSettled: () => setPendingKey(null),
      },
    );
  };

  return (
    <QueryState {...describeQuery(query)} label="the leaderboard" onRetry={() => void query.refetch()} asOf={query.dataUpdatedAt}>
      {board ? <SalesBoardBody board={board} window={window} todayKey={todayKey} pendingKey={pendingKey} onCheer={onCheer} /> : null}
    </QueryState>
  );
}

function SalesBoardBody({
  board,
  window,
  todayKey,
  pendingKey,
  onCheer,
}: {
  board: TeamBoard;
  window: BoardWindow;
  todayKey: string;
  pendingKey: string | null;
  onCheer: (row: TeamBoardRow, cheer: boolean, from: HTMLElement) => void;
}) {
  const month = monthName(board.monthStart, todayKey);
  const when = windowPhrase(window, board.monthStart, todayKey);

  if (board.access === "none") {
    return (
      <div className="flex items-start gap-3 rounded-2xl border border-border bg-card p-4 sm:p-5">
        <ToneBubble tone="slate"><Users /></ToneBubble>
        <div className="min-w-0">
          <p className="text-base font-semibold text-foreground">The team board is for active agents</p>
          <p className="mt-1 text-[15px] leading-6 text-muted-foreground">
            {board.me
              ? `Your sales ${when}: ${formatMoney(board.me.ap)} from ${plural(board.me.deals, "deal")}. If you are on the team and think this is wrong, ask your manager to check your account.`
              : "You need an active agent account to see who is on the board. Ask your manager if you think this is wrong."}
          </p>
        </div>
      </div>
    );
  }

  const tiles: ScoreTile[] = boardTiles(board, window, todayKey).map((t) => ({
    label: t.label,
    value: t.value,
    hint: t.hint,
    tone: t.tone,
    emphasis: t.emphasis,
    icon: TILE_ICON[t.key],
    format: t.kind === "rank" ? formatRank : formatTileMoney,
  }));
  const empty = emptyBoardText(board, window, todayKey);
  const anyEstimate = board.rows.some((r) => r.estEarnings !== null);
  const below = board.fullReader && board.belowBarAp !== null && board.belowBarAp > 0 ? board.belowBarAp : null;

  return (
    <div className="space-y-4">
      <GrowScoreboard label={`Your standing ${when}`} tiles={tiles} />

      <div className="flex items-start gap-3 rounded-xl border border-tone-gold/35 bg-card px-4 py-3">
        <ToneBubble tone="gold" size="sm"><Target /></ToneBubble>
        <p className="min-w-0 text-[15px] leading-6 text-foreground">
          <span className="font-semibold">The {formatMoney(board.minimum)} rule. </span>
          {boardRule(board, todayKey)}
        </p>
      </div>

      {board.rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card px-4 py-8 text-center">
          <p className="text-base font-semibold text-foreground">{empty.title}</p>
          <p className="mt-1 text-[15px] text-muted-foreground">{empty.body}</p>
        </div>
      ) : (
        <section aria-label={`Leaderboard ${when}`}>
          <RevealList as="ol" className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
            {board.rows.map((row) => (
              <SalesRow key={row.agentKey} row={row} board={board} todayKey={todayKey} pending={pendingKey === row.agentKey} onCheer={onCheer} />
            ))}
          </RevealList>
        </section>
      )}

      {below !== null || board.agencyGap.length > 0 || anyEstimate ? (
        <div className="space-y-1.5 px-1 text-sm leading-5 text-muted-foreground">
          {below !== null ? (
            <p>
              {window === "today" || window === "week"
                ? `Not on the board: ${formatMoney(below)} sold ${when} by agents under ${formatMoney(board.minimum)} for ${month}.`
                : `Not on the board: ${formatMoney(below)} ${when} from agents under ${formatMoney(board.minimum)}.`}
            </p>
          ) : null}
          {board.agencyGap.map((g) => (
            <p key={g.agency}>
              {g.agency}: {formatMoney(g.ap)} from {plural(g.deals, "deal")} the agency reported that is not matched to a seller yet. Not ranked.
            </p>
          ))}
          {anyEstimate ? (
            <p>Est. income is an estimate from each agent&rsquo;s contract level. It is not paid commission and leaves out chargebacks, advances, renewals and overrides.</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function RecruitingBoardView({ kind, window, when }: { kind: RecruitingKind; window: BoardWindow; when: string }) {
  const query = useRecruitingBoard(kind, window, true);
  const noun = kind === "referrals" ? "referral" : "application";
  return (
    <QueryState
      {...describeQuery({ ...query, isEmpty: query.data ? query.data.rows.length === 0 : undefined })}
      label={kind === "referrals" ? "the referral board" : "the recruiting board"}
      onRetry={() => void query.refetch()}
      asOf={query.dataUpdatedAt}
      title={kind === "referrals" ? `No referrals applied ${when}` : `No applications ${when}`}
      body="The board counts applications created in this window that you can see."
    >
      {query.data ? (
        <div className="space-y-3">
          {query.data.capped ? (
            <p role="status" className="rounded-xl border border-tone-warm/35 bg-tone-warm/8 px-4 py-3 text-[15px] text-foreground">
              This window has more applications than one read returns, so these counts may be low.
            </p>
          ) : null}
          <RevealList as="ol" className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
            {query.data.rows.map((row) => (
              <li key={row.ownerId} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 px-3 py-3 sm:gap-x-4 sm:px-5">
                <div className="flex items-center gap-2.5">
                  <RankMark rank={row.rank} />
                  <Face name={row.name} url={row.avatarUrl} />
                </div>
                <div className="min-w-0">
                  <PersonName name={row.name} agentId={row.ownerId} linkable />
                  <FactLine facts={recruitingFacts(row, kind)} className="mt-0.5" />
                </div>
                <div className="text-right">
                  <span className="block text-lg font-bold leading-6 tabular-nums text-foreground sm:text-xl">{row.applications.toLocaleString("en-US")}</span>
                  <span className="block text-[13px] leading-4 text-muted-foreground">{row.applications === 1 ? noun : `${noun}s`}</span>
                </div>
              </li>
            ))}
          </RevealList>
        </div>
      ) : null}
    </QueryState>
  );
}

export default function Leaderboard() {
  const { effectiveMode } = useAuth();
  const leads = effectiveMode === "admin" || effectiveMode === "manager" || effectiveMode === "agency_owner";
  const [params, setParams] = useSearchParams();
  const windowParam = params.get("window");
  const window: BoardWindow = isBoardWindow(windowParam) ? windowParam : DEFAULT_BOARD_WINDOW;
  const boardParam = params.get("board");
  const board: BoardKind = leads && (boardParam === "recruiting" || boardParam === "referrals") ? boardParam : "sales";
  const todayKey = useBusinessToday(BUSINESS_TIMEZONE);
  const when = windowPhrase(window, boardMonthStart(window, todayKey), todayKey);

  const update = (key: "window" | "board", value: string, fallback: string) => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value === fallback) next.delete(key);
        else next.set(key, value);
        return next;
      },
      { replace: true },
    );
  };

  const subtitle =
    board === "recruiting" ? `Who brought in the most applications ${when}.`
    : board === "referrals" ? `Whose referrals applied ${when}.`
    : `Top sellers ${when}. Cheer your team on.`;

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5 pb-28">
      <PageHeader
        icon={<Trophy />}
        tone="gold"
        title="Leaderboard"
        subtitle={subtitle}
        viewControls={<WindowSwitch value={window} onChange={(w) => update("window", w, DEFAULT_BOARD_WINDOW)} />}
      />

      {leads ? (
        <Tabs value={board} onValueChange={(value) => update("board", value, "sales")}>
          <TabsList aria-label="Board">
            <TabsTrigger value="sales" className="gap-2"><DollarSign className="h-4 w-4" aria-hidden="true" />Sales</TabsTrigger>
            <TabsTrigger value="recruiting" className="gap-2"><UserPlus className="h-4 w-4" aria-hidden="true" />Recruiting</TabsTrigger>
            <TabsTrigger value="referrals" className="gap-2"><Users className="h-4 w-4" aria-hidden="true" />Referrals</TabsTrigger>
          </TabsList>
          <TabsContent value="sales" className="mt-5">{board === "sales" ? <SalesBoard window={window} /> : null}</TabsContent>
          <TabsContent value="recruiting" className="mt-5">{board === "recruiting" ? <RecruitingBoardView kind="recruiting" window={window} when={when} /> : null}</TabsContent>
          <TabsContent value="referrals" className="mt-5">{board === "referrals" ? <RecruitingBoardView kind="referrals" window={window} when={when} /> : null}</TabsContent>
        </Tabs>
      ) : (
        <SalesBoard window={window} />
      )}
    </div>
  );
}
