// IG desk (MP-305 Wave 5, 2026-10-28). Route: /dashboard/inbox/instagram.
//
// Sam, on his phone, twenty seconds between calls. A to-do list, not a report: one ranked list
// (needs you), one sentence (the lever), six small numbers (the funnel), then two more tabs that
// hold everything that does not change what he taps next. One RPC, fn_ig_dashboard v2, renders all
// of it; every count is receipt-graded and the RPC's header comment states each stage's source.
//
// The previous page (Wave 4) was ten KPI tiles, four colour chips, three lists with their own row
// shapes and four to five buttons per row; Sam called it clutter. Everything here is one row shape.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ExternalLink, Instagram } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useConfirm } from "@/hooks/useConfirm";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { PageLoadingSkeleton } from "@/components/ui/page-loading-skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { IG_INBOX_URL, igThreadUrl } from "@/lib/instagram";
import { disposeInterview, emailLink, threadAction, type SendResult } from "@/components/instagram/igActions";
import { BUTTON, CONFIRM, EMAIL, EMPTY, HEADER, SHEET, TABS, TOAST, leverSmsBody } from "@/components/instagram/igCopy";
import { phoenixTime, shortAgo } from "@/components/instagram/igFormat";
import { who } from "@/components/instagram/igRowLogic";
import { IgCompose } from "@/components/instagram/IgCompose";
import { IgFunnelStrip } from "@/components/instagram/IgFunnelStrip";
import { IgHealthAlert, IgHowToFixSheet } from "@/components/instagram/IgHealthAlert";
import { IgHistorySheet } from "@/components/instagram/IgHistorySheet";
import { IgLever } from "@/components/instagram/IgLever";
import { IgNeedsYou, NEEDS_VISIBLE } from "@/components/instagram/IgNeedsYou";
import { IgNumbersTab } from "@/components/instagram/IgNumbersTab";
import { IgPeopleSheet, type IgPeopleSection } from "@/components/instagram/IgPeopleSheet";
import { IgPeopleTab } from "@/components/instagram/IgPeopleTab";
import { type IgRowActionExtra, type IgRowActionKind } from "@/components/instagram/IgRow";
import type { IgDashboard, IgRow, IgStage } from "@/components/instagram/igTypes";

type Tab = "do" | "numbers" | "people";
const TAB_VALUES: Tab[] = ["do", "numbers", "people"];
const PAUSE_AFTER_ACTION_MS = 5_000;
const REFETCH_MS = 60_000;

const SUPABASE_URL: string = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? "https://xrzweoneiieddzxogewk.supabase.co";
const RECONNECT_HREF = `${SUPABASE_URL}/functions/v1/instagram-auth?link=1`;

type SheetState =
  | { kind: "none" }
  | { kind: "stage"; stage: IgStage }
  | { kind: "lever" }
  | { kind: "more" }
  | { kind: "history"; row: IgRow }
  | { kind: "compose"; row: IgRow; mode: "send" | "nudge" };

export default function InstagramInbox() {
  usePageTitle("Instagram");
  const askConfirm = useConfirm();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const tabParam = params.get("tab");
  const tab: Tab = TAB_VALUES.includes(tabParam as Tab) ? (tabParam as Tab) : "do";
  const setTab = useCallback((v: string) => {
    setParams((prev) => { prev.set("tab", v); return prev; }, { replace: true });
  }, [setParams]);

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
      // fn_ig_dashboard v2 is newer than the generated client types (types.ts regen needs the dead PAT).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).rpc("fn_ig_dashboard", { p_window: "30d" });
      if (error) throw error;
      return data as IgDashboard;
    },
  });

  // One clock for every age on the page, ticking each minute, and reset on every fetch so a row's
  // '4m' and the header's 'checked 4m ago' never disagree.
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
  const visible = useCallback((rows: IgRow[] | undefined) => (rows ?? []).filter((r) => !hidden[r.external_id]), [hidden]);
  const needs = useMemo(() => visible(d?.needs), [d, visible]);
  const everyone = useMemo(() => visible(d?.everyone), [d, visible]);
  const later = useMemo(() => visible(d?.later), [d, visible]);

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
          undoable(`${TOAST.cleared}`, async () => { await threadAction(id, "unhandled"); unhide(id); });
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
          toast(TOAST.seeYouAt(extra.label === "tomorrow 9am" ? "9am" : phoenixTime(extra.until)));
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
            const ok = await askConfirm({ title: CONFIRM.noShow(who(row)), confirmText: BUTTON.noShow, cancelText: "keep it", tone: "primary" });
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
          const ok = await askConfirm({ title: EMAIL.confirm(row.email), confirmText: "send it", cancelText: "not now", tone: "primary" });
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
  }, [confirm, failed, hide, pauseThenRefresh, undoable, unhide]);

  const onSendResult = useCallback((row: IgRow, result: SendResult) => {
    // After a send that went out, their message is no longer last: the row leaves on the next fetch.
    if (result.ok) hide(row.external_id);
    pauseThenRefresh();
  }, [hide, pauseThenRefresh]);

  const closeSheet = useCallback((open: boolean) => { if (!open) { setSheet({ kind: "none" }); setNow(Date.now()); } }, []);

  if (query.isLoading) return <PageLoadingSkeleton variant="dashboard" />;
  if (query.isError || !d) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-6 sm:px-6">
        <EmptyState
          variant="warning"
          icon={<AlertTriangle className="h-7 w-7" />}
          title={EMPTY.couldntLoad}
          description={String((query.error as Error | null)?.message ?? "")}
          actions={<Button className="h-11 sm:h-9" onClick={() => query.refetch()}>{BUTTON.tryAgain}</Button>}
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
  const stageSubtitle = stageSheet
    ? [SHEET.reachedThis, stageSheet.key === "number" && stageSheet.or_email ? SHEET.orEmail(stageSheet.or_email) : null, stageSheet.people.length < stageSheet.count ? SHEET.showing(stageSheet.people.length, stageSheet.count) : null]
        .filter(Boolean).join(" · ")
    : undefined;
  const leverSms = leverSmsBody(d.lever.key) ?? undefined;
  const historyRow = sheet.kind === "history" ? sheet.row : null;

  return (
    <div className="mx-auto w-full max-w-2xl px-4 pb-10 pt-4 sm:px-6">
      <PageHeader
        eyebrow={HEADER.eyebrow}
        eyebrowIcon={<Instagram className="h-3 w-3" />}
        title={`@${s.ig_username}`}
        subtitle={
          <Button
            variant="ghost"
            className="-ml-2 h-8 px-2 text-xs text-muted-foreground"
            aria-label={HEADER.refreshNow}
            onClick={() => query.refetch()}
            disabled={query.isFetching}
          >
            {query.isFetching ? HEADER.checking : HEADER.checked(shortAgo(s.generated_at, now))}
          </Button>
        }
        actions={
          <Button asChild variant="outline" className="h-9">
            <a href={IG_INBOX_URL} target="_blank" rel="noopener noreferrer"><ExternalLink className="h-4 w-4" />{HEADER.openInbox}</a>
          </Button>
        }
      />

      <IgHealthAlert
        status={s}
        waiting={needs.length}
        reconnectHref={RECONNECT_HREF}
        onHowToFix={() => setFixOpen(true)}
        onSeeThem={() => { setTab("do"); document.getElementById("ig-needs-heading")?.scrollIntoView({ block: "start" }); }}
        onSeeWhy={() => { setTab("numbers"); window.setTimeout(() => document.getElementById("ig-numbers-health")?.scrollIntoView({ block: "start" }), 50); }}
        now={now}
      />

      <Tabs value={tab} onValueChange={setTab} className="mt-3">
        <div className="sticky z-10 -mx-4 border-b border-border bg-background px-4 py-2 sm:-mx-6 sm:px-6" style={{ top: "env(safe-area-inset-top, 0px)" }}>
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="do" className="text-sm">{TABS.do}</TabsTrigger>
            <TabsTrigger value="numbers" className="text-sm">{TABS.numbers}</TabsTrigger>
            <TabsTrigger value="people" className="text-sm">{TABS.people}</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="do" className="mt-4 space-y-6">
          <IgNeedsYou
            needs={needs}
            everyone={everyone}
            later={later}
            humanAgentSupported={hat}
            onAction={onRowAction}
            onMore={() => setSheet({ kind: "more" })}
            now={now}
          />
          <IgLever lever={d.lever} lockedInGap={d.funnel.locked_in_gap} onOpen={() => setSheet({ kind: "lever" })} />
          <IgFunnelStrip stages={d.funnel.stages} onOpenStage={(stage) => setSheet({ kind: "stage", stage })} />
        </TabsContent>

        <TabsContent value="numbers" className="mt-4">
          <IgNumbersTab d={d} onOpenStage={(stage) => setSheet({ kind: "stage", stage })} reconnectHref={RECONNECT_HREF} onHowToFix={() => setFixOpen(true)} now={now} />
        </TabsContent>

        <TabsContent value="people" className="mt-4">
          <IgPeopleTab people={visible(d.people)} humanAgentSupported={hat} onAction={onRowAction} now={now} />
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
        title={d.lever.button_label ?? ""}
        subtitle={d.lever.sentence}
        rows={visible(d.lever.people)}
        humanAgentSupported={hat}
        onAction={onRowAction}
        smsBody={leverSms}
        now={now}
      />
      <IgPeopleSheet
        open={sheet.kind === "more"}
        onOpenChange={closeSheet}
        title={`needs you · ${needs.length}`}
        rows={needs.slice(NEEDS_VISIBLE)}
        humanAgentSupported={hat}
        onAction={onRowAction}
        now={now}
      />
      <IgHistorySheet
        open={sheet.kind === "history"}
        onOpenChange={closeSheet}
        row={historyRow}
        now={now}
        action={historyRow ? (
          <Button asChild className="h-11 w-full sm:h-9">
            <a href={igThreadUrl(historyRow.handle)} target="_blank" rel="noopener noreferrer"><ExternalLink className="h-4 w-4" />{BUTTON.openIg}</a>
          </Button>
        ) : null}
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

