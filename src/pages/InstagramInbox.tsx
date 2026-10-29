// The Instagram desk. Route: /dashboard/inbox/instagram (admins and managers).
//
// OVERHAUL-instagram (2026-10-28). Sam: "make sure to fix the Instagram tab. It's just terrible as
// hell." The desk he opened was five gold buttons stacked down the screen, each row one line of
// words with no way to tell what we had already said, a strip of 11px numbers reading "of prev 238%",
// lowercase tabs called "do / numbers / people", and a People tab that searched 60 threads.
//
// Now, top to bottom: four big numbers that open exactly the people they count (Needs you, Gave a
// number, Booked a call, Applied, each against the 30 days before), three big tabs, and on every
// tab the same card per person: who they are, what they last said, what we last did (with its
// delivery truth), and what to do next. The one gold button on the screen is the Up next card's
// main action. People is the funnel: one list per stage, each the size its number says, searchable.
//
// One RPC renders all of it, fn_ig_dashboard (migration 20261029070000 adds each row's context and
// the per-person stages); its header comment states every number's source.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, BarChart3, CalendarCheck, ExternalLink, FileCheck, Inbox, Instagram, Phone, RefreshCw, Users } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useConfirm } from "@/hooks/useConfirm";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { PageLoadingSkeleton } from "@/components/ui/page-loading-skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { GrowScoreboard, type ScoreTile } from "@/components/recruiting/GrowScoreboard";
import { IG_INBOX_URL, igThreadUrl } from "@/lib/instagram";
import { contactLinkProps, formatPhoneDisplay, phoneHref } from "@/lib/phone";
import { prefersReducedMotion } from "@/lib/celebrate";
import { cn } from "@/lib/utils";
import { disposeInterview, emailLink, threadAction, type SendResult } from "@/components/instagram/igActions";
import { BUTTON, CONFIRM, EMAIL, EMPTY, HEADER, SCORE, SHEET, TABS, TOAST, leverSmsBody } from "@/components/instagram/igCopy";
import { phoenixTime, sentenceCase, shortAgo } from "@/components/instagram/igFormat";
import { who } from "@/components/instagram/igRowLogic";
import { LIST_KEYS, peopleLists, stageOf, tileTrend, type IgListKey } from "@/components/instagram/igScore";
import { IgCompose } from "@/components/instagram/IgCompose";
import { IgHealthAlert, IgHowToFixSheet } from "@/components/instagram/IgHealthAlert";
import { IgHistorySheet } from "@/components/instagram/IgHistorySheet";
import { IgLever } from "@/components/instagram/IgLever";
import { IgNeedsYou } from "@/components/instagram/IgNeedsYou";
import { IgNumbersTab } from "@/components/instagram/IgNumbersTab";
import { IgPeopleSheet, type IgPeopleSection } from "@/components/instagram/IgPeopleSheet";
import { IgPeopleTab } from "@/components/instagram/IgPeopleTab";
import { type IgRowActionExtra, type IgRowActionKind } from "@/components/instagram/IgRow";
import type { IgDashboard, IgRow, IgStage, IgStageKey } from "@/components/instagram/igTypes";

type Tab = "do" | "people" | "numbers";
const TAB_VALUES: Tab[] = ["do", "people", "numbers"];
const PAUSE_AFTER_ACTION_MS = 5_000;
const REFETCH_MS = 60_000;

const SUPABASE_URL: string = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? "https://xrzweoneiieddzxogewk.supabase.co";
const RECONNECT_HREF = `${SUPABASE_URL}/functions/v1/instagram-auth?link=1`;

/** A funnel step that has a People list opens it; the rest open a sheet. */
const LIST_FOR_STAGE: Partial<Record<IgStageKey, IgListKey>> = {
  in: "everyone", business: "business", licensed: "licensed", number: "number", booked: "booked", applied: "applied", hired: "hired",
};

/**
 * The person sheet's buttons: Call in gold when there is a number (the number is printed in the
 * sheet before the tap), and Instagram for everyone. The sheet is its own screen, so its one gold
 * button is its own.
 */
function HistoryActions({ row }: { row: IgRow }) {
  const tel = phoneHref(row.phone);
  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      {tel && row.phone ? (
        <Button asChild className="h-12 sm:flex-1">
          <a href={tel} {...contactLinkProps(tel)} aria-label={`call ${who(row)}`}><Phone className="h-4 w-4" aria-hidden />{BUTTON.call(formatPhoneDisplay(row.phone))}</a>
        </Button>
      ) : null}
      <Button asChild variant={tel ? "outline" : "default"} className="h-12 sm:flex-1">
        <a href={igThreadUrl(row.handle)} target="_blank" rel="noopener noreferrer"><ExternalLink className="h-4 w-4" aria-hidden />{BUTTON.openIg}</a>
      </Button>
    </div>
  );
}

type SheetState =
  | { kind: "none" }
  | { kind: "stage"; stage: IgStage }
  | { kind: "lever" }
  | { kind: "history"; row: IgRow }
  | { kind: "compose"; row: IgRow; mode: "send" | "nudge" };

export default function InstagramInbox() {
  usePageTitle("Instagram");
  const askConfirm = useConfirm();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const tabParam = params.get("tab");
  const tab: Tab = TAB_VALUES.includes(tabParam as Tab) ? (tabParam as Tab) : "do";
  const listParam = params.get("list");
  const list: IgListKey = LIST_KEYS.includes(listParam as IgListKey) ? (listParam as IgListKey) : "everyone";
  const tabsRef = useRef<HTMLDivElement | null>(null);

  const go = useCallback((nextTab: Tab, nextList?: IgListKey) => {
    setParams((prev) => {
      prev.set("tab", nextTab);
      if (nextTab === "people" && nextList) prev.set("list", nextList);
      return prev;
    }, { replace: true });
  }, [setParams]);
  const setTab = useCallback((v: string) => go(v as Tab), [go]);
  /** A number at the top picks a list further down, so bring the tabs to the top of the screen. */
  const jump = useCallback((nextTab: Tab, nextList?: IgListKey) => {
    go(nextTab, nextList);
    window.setTimeout(() => tabsRef.current?.scrollIntoView?.({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" }), 30);
  }, [go]);

  const [sheet, setSheet] = useState<SheetState>({ kind: "none" });
  const [fixOpen, setFixOpen] = useState(false);
  const [pausedUntil, setPausedUntil] = useState(0);
  const [hidden, setHidden] = useState<Record<string, true>>({});
  const [now, setNow] = useState(() => Date.now());
  const pauseTimer = useRef<number | null>(null);

  const sheetOpen = sheet.kind !== "none";
  const paused = sheetOpen || pausedUntil > now;

  const query = useQuery({
    queryKey: ["ig-dashboard"],
    refetchInterval: paused ? false : REFETCH_MS,
    queryFn: async () => {
      // fn_ig_dashboard is newer than the generated client types (types.ts regen needs the dead PAT).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).rpc("fn_ig_dashboard", { p_window: "30d" });
      if (error) throw error;
      return data as IgDashboard;
    },
  });

  // One clock for every age on the page, ticking each minute, and reset on every fetch so a row's
  // '4m ago' and the header's 'Checked 4m ago' never disagree.
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  useEffect(() => { if (query.dataUpdatedAt) setNow(Date.now()); }, [query.dataUpdatedAt]);
  useEffect(() => () => { if (pauseTimer.current) window.clearTimeout(pauseTimer.current); }, []);

  const pauseThenRefresh = useCallback(() => {
    const until = Date.now() + PAUSE_AFTER_ACTION_MS;
    setPausedUntil(until);
    if (pauseTimer.current) window.clearTimeout(pauseTimer.current);
    pauseTimer.current = window.setTimeout(() => {
      setPausedUntil(0);
      setNow(Date.now());
      queryClient.invalidateQueries({ queryKey: ["ig-dashboard"] });
    }, PAUSE_AFTER_ACTION_MS);
  }, [queryClient]);

  const hide = useCallback((id: string) => setHidden((h) => ({ ...h, [id]: true })), []);
  const unhide = useCallback((id: string) => setHidden((h) => { const n = { ...h }; delete n[id]; return n; }), []);
  // A fresh fetch is the truth; optimistic hides only bridge the pause.
  useEffect(() => { if (query.dataUpdatedAt && !paused) setHidden({}); }, [query.dataUpdatedAt, paused]);

  const d = query.data;
  const hat = d?.status.human_agent_supported ?? false;
  // Hides apply to the to-do lists only. The People lists are the funnel and keep their counts.
  const visible = useCallback((rows: IgRow[] | undefined) => (rows ?? []).filter((r) => !hidden[r.external_id]), [hidden]);
  const needs = useMemo(() => visible(d?.needs), [d, visible]);
  const everyone = useMemo(() => visible(d?.everyone), [d, visible]);
  const later = useMemo(() => visible(d?.later), [d, visible]);
  const lists = useMemo(() => (d ? peopleLists(d) : []), [d]);

  const undoable = useCallback((message: string, undo: () => Promise<void>) => {
    toast(message, {
      duration: PAUSE_AFTER_ACTION_MS,
      action: {
        label: TOAST.undo,
        onClick: () => {
          undo().then(() => pauseThenRefresh()).catch((e: Error) => toast.error(`${TOAST.didntSave} ${e.message}`));
        },
      },
    });
  }, [pauseThenRefresh]);

  const failed = useCallback((e: unknown, id?: string) => {
    if (id) unhide(id);
    toast.error(`${TOAST.didntSave} ${String((e as Error)?.message ?? "")}`.trim());
  }, [unhide]);

  const onRowAction = useCallback(async (kind: IgRowActionKind, row: IgRow, extra?: IgRowActionExtra) => {
    const id = row.external_id;
    try {
      switch (kind) {
        case "send":
        case "nudge":
          setSheet({ kind: "compose", row, mode: kind });
          return;
        case "history":
          setSheet({ kind: "history", row });
          return;
        case "done": {
          hide(id); pauseThenRefresh();
          await threadAction(id, "handled");
          undoable(TOAST.cleared, async () => { await threadAction(id, "unhandled"); unhide(id); });
          return;
        }
        case "bring_back": {
          hide(id); pauseThenRefresh();
          await threadAction(id, row.status === "handled" ? "unhandled" : "unsnoozed");
          toast(TOAST.broughtBack);
          return;
        }
        case "later": {
          if (!extra?.until) return;
          hide(id); pauseThenRefresh();
          await threadAction(id, "snoozed", { until: extra.until });
          toast(TOAST.seeYouAt(phoenixTime(extra.until)));
          return;
        }
        case "not_lead": {
          hide(id); pauseThenRefresh();
          const prev = row.intent ?? "casual";
          await threadAction(id, "dismissed");
          undoable(TOAST.notALead, async () => { await threadAction(id, "relabeled", { intent: prev }); unhide(id); });
          return;
        }
        case "thats_lead": {
          if (!extra?.intent) return;
          pauseThenRefresh();
          await threadAction(id, "relabeled", { intent: extra.intent });
          toast(TOAST.thatsALead);
          return;
        }
        case "mine": {
          pauseThenRefresh();
          await threadAction(id, "mine");
          toast(TOAST.yours);
          return;
        }
        case "showed":
        case "no_show": {
          const ev = row.booked_event;
          if (!ev) return;
          if (kind === "no_show") {
            const ok = await askConfirm({ title: CONFIRM.noShow(who(row)), confirmText: BUTTON.noShow, cancelText: CONFIRM.keep, tone: "primary" });
            if (!ok) return;
          }
          hide(id); pauseThenRefresh();
          const outcome = kind === "showed" ? "completed" : "no_show";
          await disposeInterview(ev.id, outcome);
          undoable(kind === "showed" ? TOAST.markedShowed : TOAST.markedNoShow, async () => {
            // The RPC cannot clear an outcome, so undo flips to the opposite within the toast's life.
            await disposeInterview(ev.id, kind === "showed" ? "no_show" : "completed");
          });
          return;
        }
        case "email_link": {
          if (!row.email) return;
          const ok = await askConfirm({ title: EMAIL.confirm(row.email), confirmText: CONFIRM.sendIt, cancelText: CONFIRM.notNow, tone: "primary" });
          if (!ok) return;
          pauseThenRefresh();
          const r = await emailLink(row);
          if (r.ok) toast(TOAST.emailed);
          else if (r.suppressed) toast.error(TOAST.suppressed);
          else toast.error(`${TOAST.didntSave} ${r.error ?? ""}`.trim());
          return;
        }
        default:
          return;
      }
    } catch (e) {
      failed(e, id);
    }
  }, [askConfirm, failed, hide, pauseThenRefresh, undoable, unhide]);

  const onSendResult = useCallback((row: IgRow, result: SendResult) => {
    // After a send that went out, their message is no longer last: the row leaves on the next fetch.
    if (result.ok) hide(row.external_id);
    pauseThenRefresh();
  }, [hide, pauseThenRefresh]);

  const closeSheet = useCallback((open: boolean) => { if (!open) { setSheet({ kind: "none" }); setNow(Date.now()); } }, []);

  const openStage = useCallback((stage: IgStage) => {
    const key = LIST_FOR_STAGE[stage.key];
    if (key) jump("people", key);
    else setSheet({ kind: "stage", stage });
  }, [jump]);

  if (query.isLoading) return <PageLoadingSkeleton variant="dashboard" />;
  if (query.isError || !d) {
    return (
      <div className="mx-auto w-full max-w-2xl py-6">
        <EmptyState
          variant="warning"
          icon={<AlertTriangle className="h-7 w-7" />}
          title={EMPTY.couldntLoad}
          description={<>{EMPTY.couldntLoadHint}{(query.error as Error | null)?.message ? <span className="mt-1 block text-sm">{String((query.error as Error).message)}</span> : null}</>}
          actions={<Button className="h-11" onClick={() => query.refetch()}>{BUTTON.tryAgain}</Button>}
        />
      </div>
    );
  }

  const s = d.status;
  const stageSheet = sheet.kind === "stage" ? sheet.stage : null;
  const stageSections: IgPeopleSection[] | undefined = stageSheet?.key === "applied"
    ? [
        { heading: SHEET.byLink, rows: stageSheet.people.filter((p) => p.applied_by === "link") },
        { heading: SHEET.byHandle, rows: stageSheet.people.filter((p) => p.applied_by !== "link") },
      ]
    : undefined;
  const stageSubtitle = stageSheet && stageSheet.people.length < stageSheet.count ? SHEET.showing(stageSheet.people.length, stageSheet.count) : undefined;
  const leverSms = leverSmsBody(d.lever.key) ?? undefined;
  const historyRow = sheet.kind === "history" ? sheet.row : null;

  const number = stageOf(d, "number");
  const booked = stageOf(d, "booked");
  const applied = stageOf(d, "applied");
  const trend = (stage: IgStage | undefined) => tileTrend(stage, SCORE.trend) ?? undefined;
  const tiles: ScoreTile[] = [
    { label: SCORE.needs, value: needs.length, hint: SCORE.needsHint, definition: SCORE.definitionNeeds, tone: "hot", emphasis: true, icon: <Inbox />, onSelect: () => jump("do"), active: tab === "do" },
    { label: SCORE.number, value: number?.count ?? null, hint: SCORE.inWindow, trend: trend(number), definition: SCORE.definitionNumber, tone: "warm", icon: <Phone />, onSelect: () => jump("people", "number"), active: tab === "people" && list === "number" },
    { label: SCORE.booked, value: booked?.count ?? null, hint: SCORE.inWindow, trend: trend(booked), definition: SCORE.definitionBooked, tone: "cool", icon: <CalendarCheck />, onSelect: () => jump("people", "booked"), active: tab === "people" && list === "booked" },
    { label: SCORE.applied, value: applied?.count ?? null, hint: SCORE.inWindow, trend: trend(applied), definition: SCORE.definitionApplied, tone: "good", icon: <FileCheck />, onSelect: () => jump("people", "applied"), active: tab === "people" && list === "applied" },
  ];

  const botTone = s.token_ok === false ? "hot" : s.token_ok ? "good" : "slate";
  const everyoneList = lists.find((l) => l.key === "everyone");
  const lever = <IgLever lever={d.lever} lockedInGap={d.funnel.locked_in_gap} onOpen={() => setSheet({ kind: "lever" })} />;

  return (
    <div className="mx-auto w-full max-w-4xl pb-10">
      <PageHeader eyebrow={HEADER.eyebrow} icon={<Instagram />} tone="royal" title={HEADER.title} subtitle={HEADER.subtitle} className="mb-3" />

      {/* The account and whether the machine is running, then the two ways out: check now, open the app. */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[15px] text-muted-foreground">
          <span className="font-semibold text-foreground">@{s.ig_username}</span>
          <span className="inline-flex items-center gap-2">
            <span aria-hidden className={cn("inline-block h-2.5 w-2.5 shrink-0 rounded-full", botTone === "good" ? "apex-breathe bg-tone-good" : botTone === "hot" ? "bg-tone-hot" : "bg-tone-slate")} />
            {s.token_ok === false ? HEADER.botDown : s.token_ok ? HEADER.botOn : HEADER.botUnknown}
          </span>
          {s.links_blocked ? <span className="font-medium text-tone-warm">{HEADER.linksBlocked}</span> : null}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="ghost"
            className="h-11 gap-1.5 px-2.5 text-sm font-normal text-muted-foreground sm:h-10"
            aria-label={HEADER.refreshNow}
            onClick={() => query.refetch()}
            disabled={query.isFetching}
          >
            <RefreshCw className="h-4 w-4" aria-hidden />
            {query.isFetching ? HEADER.checking : HEADER.checked(shortAgo(s.generated_at, now))}
          </Button>
          <Button asChild variant="outline" className="h-11 sm:h-10">
            <a href={IG_INBOX_URL} target="_blank" rel="noopener noreferrer"><ExternalLink className="h-4 w-4" aria-hidden />{HEADER.openInbox}</a>
          </Button>
        </div>
      </div>

      <IgHealthAlert
        status={s}
        waiting={needs.length}
        reconnectHref={RECONNECT_HREF}
        onHowToFix={() => setFixOpen(true)}
        onSeeThem={() => jump("do")}
        onSeeWhy={() => { go("numbers"); window.setTimeout(() => document.getElementById("ig-numbers-health")?.scrollIntoView?.({ block: "start" }), 50); }}
        now={now}
      />

      <GrowScoreboard label={SCORE.label} tiles={tiles} className="mt-4" />

      {/* The tabs stick under the shell's 60px bar; this marker is where they sit unstuck, so a tap on a
          number scrolls the page to the top of its list rather than to wherever the sticky bar is. */}
      <div ref={tabsRef} aria-hidden className="scroll-mt-[calc(3.75rem+env(safe-area-inset-top,0px))]" />
      <Tabs value={tab} onValueChange={setTab} className="mt-5">
        <div
          className="sticky z-30 -mx-3 border-b border-border bg-background px-3 sm:-mx-4 sm:px-4 lg:-mx-5 lg:px-5"
          style={{ top: "calc(3.75rem + env(safe-area-inset-top, 0px))" }}
        >
          <TabsList className="grid w-full grid-cols-3 gap-0 border-b-0">
            <TabsTrigger value="do" className="h-14 min-h-14 flex-col gap-0.5 px-1 text-[15px] sm:flex-row sm:gap-2 sm:text-base">
              <span className="inline-flex items-center gap-1.5"><Inbox className="h-4 w-4 sm:h-5 sm:w-5" aria-hidden />{TABS.do}</span>
              <span className={cn("rounded-full px-2 text-[13px] font-semibold leading-5 tabular-nums", needs.length > 0 ? "bg-tone-hot/12 text-tone-hot" : "bg-muted text-muted-foreground")}>{needs.length.toLocaleString("en-US")}</span>
            </TabsTrigger>
            <TabsTrigger value="people" className="h-14 min-h-14 flex-col gap-0.5 px-1 text-[15px] sm:flex-row sm:gap-2 sm:text-base">
              <span className="inline-flex items-center gap-1.5"><Users className="h-4 w-4 sm:h-5 sm:w-5" aria-hidden />{TABS.people}</span>
              <span className="rounded-full bg-muted px-2 text-[13px] font-semibold leading-5 tabular-nums text-muted-foreground">{(everyoneList?.total ?? 0).toLocaleString("en-US")}</span>
            </TabsTrigger>
            <TabsTrigger value="numbers" className="h-14 min-h-14 flex-col gap-0.5 px-1 text-[15px] sm:flex-row sm:gap-2 sm:text-base">
              <span className="inline-flex items-center gap-1.5"><BarChart3 className="h-4 w-4 sm:h-5 sm:w-5" aria-hidden />{TABS.numbers}</span>
              <span className="text-[13px] font-medium leading-5 text-muted-foreground">30 days</span>
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="do" className="mt-5">
          <IgNeedsYou
            needs={needs}
            everyone={everyone}
            later={later}
            humanAgentSupported={hat}
            onAction={onRowAction}
            now={now}
            footer={lever}
          />
        </TabsContent>

        <TabsContent value="people" className="mt-5">
          <IgPeopleTab lists={lists} list={list} onList={(k) => go("people", k)} humanAgentSupported={hat} onAction={onRowAction} now={now} />
        </TabsContent>

        <TabsContent value="numbers" className="mt-5">
          <IgNumbersTab d={d} onOpenStage={openStage} reconnectHref={RECONNECT_HREF} onHowToFix={() => setFixOpen(true)} now={now} lever={lever} />
        </TabsContent>
      </Tabs>

      <IgPeopleSheet
        open={sheet.kind === "stage"}
        onOpenChange={closeSheet}
        title={stageSheet ? SHEET.stageTitle(stageSheet.key, stageSheet.count) : ""}
        subtitle={stageSubtitle}
        rows={stageSections ? undefined : stageSheet?.people ?? []}
        sections={stageSections}
        emptyTitle={stageSheet?.key === "hired" ? EMPTY.hiredNobody : stageSheet?.key === "booked" ? EMPTY.nothingBooked : EMPTY.nobodyHere}
        humanAgentSupported={hat}
        onAction={onRowAction}
        now={now}
      />
      <IgPeopleSheet
        open={sheet.kind === "lever"}
        onOpenChange={closeSheet}
        title={sentenceCase(d.lever.button_label) || SHEET.leverTitle}
        subtitle={sentenceCase(d.lever.sentence)}
        rows={d.lever.people}
        humanAgentSupported={hat}
        onAction={onRowAction}
        smsBody={leverSms}
        now={now}
      />
      <IgHistorySheet
        open={sheet.kind === "history"}
        onOpenChange={closeSheet}
        row={historyRow}
        humanAgentSupported={hat}
        now={now}
        action={historyRow ? <HistoryActions row={historyRow} /> : null}
      />
      <IgHowToFixSheet open={fixOpen} onOpenChange={setFixOpen} />
      <IgCompose
        open={sheet.kind === "compose"}
        onOpenChange={closeSheet}
        row={sheet.kind === "compose" ? sheet.row : null}
        mode={sheet.kind === "compose" ? sheet.mode : "send"}
        status={s}
        onResult={onSendResult}
      />
    </div>
  );
}
