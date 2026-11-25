import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { AwardCopyActions } from "@/components/awards/AwardCopyActions";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import {
  Download, Share2, RefreshCw, Trophy, Zap, AlertTriangle, History,
  Check, Pause, Archive, ListChecks, Star,
} from "lucide-react";
import {
  type WinPostFeed,
  type WinPostItem,
  renderCardToCanvas,
  saveCard,
  exportCardBlob,
  cardFilename,
  buildCaption,
  buildAwardCopySummary,
  buildWinPostPresentation,
} from "@/lib/winPostCard";
import "@/components/awards/awards.css";

// MP-WIN-POSTS (2026-11-23): Win Post Studio — the achievements portal.
// Opens to real detected wins + trophies (win_post_feed() decides what counts,
// in SQL, never the caption layer), renders each as the approved Galaxy card,
// and saves the PNG straight from the page — share sheet first so on a phone
// it is tap → Save Image / Instagram. Posting stays manual by design for now;
// automation is a later wave.

type FilterKind = "all" | "wins" | "trophies";

interface QueueRow {
  id: string;
  event_key: string;
  kind: "win" | "trophy";
  trophy: string | null;
  tier: "S" | "A" | "B";
  status: "queued" | "approved" | "held" | "posted" | "archived";
  event_date: string;
  agent_name: string;
  detected_at: string;
  posted_at: string | null;
  note: string | null;
  payload: WinPostItem;
}

interface QueueBoard {
  as_of: string;
  queue: QueueRow[];
  picks: string[];
  posted_today: number;
  counts: Record<string, number>;
  error?: string;
}

const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const count = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value >= 0;
const optionalText = (value: unknown) => value === null || value === undefined || typeof value === "string";
const calendarDate = (value: unknown): value is string => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

function winItem(value: unknown): value is WinPostItem {
  return record(value)
    && (value.kind === "win" || value.kind === "trophy")
    && (value.tier === "S" || value.tier === "A" || value.tier === "B")
    && typeof value.agent_id === "string" && typeof value.agent_name === "string" && typeof value.date === "string"
    && ["photo_url", "instagram_handle", "trophy", "headline", "subline", "carrier", "product"].every(key => optionalText(value[key]))
    && (value.stats === undefined || value.stats === null || (Array.isArray(value.stats)
      && value.stats.every(stat => record(stat) && typeof stat.label === "string" && typeof stat.value === "string")));
}

function verifiedFeed(value: unknown): WinPostFeed {
  if (record(value) && typeof value.error === "string" && value.error) throw new Error(value.error);
  if (!record(value) || !record(value.period) || !calendarDate(value.period.from) || !calendarDate(value.period.to)
    || value.period.from > value.period.to || !Array.isArray(value.wins) || !Array.isArray(value.trophies)
    || !value.wins.every(item => winItem(item) && item.kind === "win")
    || !value.trophies.every(item => winItem(item) && item.kind === "trophy")) {
    throw new Error("The win records could not be verified.");
  }
  return value as unknown as WinPostFeed;
}

function verifiedQueue(value: unknown): QueueBoard {
  if (record(value) && typeof value.error === "string" && value.error) throw new Error(value.error);
  if (!record(value) || !Array.isArray(value.queue) || !Array.isArray(value.picks)
    || !value.picks.every(pick => typeof pick === "string") || !record(value.counts)
    || !Object.values(value.counts).every(count) || !count(value.posted_today)
    || !value.queue.every(row => record(row) && typeof row.id === "string" && typeof row.event_key === "string"
      && typeof row.status === "string" && ["queued", "approved", "held", "posted", "archived"].includes(row.status)
      && optionalText(row.posted_at) && winItem(row.payload))) {
    throw new Error("The posting queue could not be verified.");
  }
  return value as unknown as QueueBoard;
}

const TIER_STYLE: Record<string, string> = {
  S: "bg-tone-warm/10 text-tone-warm border-tone-warm/40",
  A: "bg-tone-good/10 text-tone-good border-tone-good/40",
  B: "bg-tone-cool/10 text-tone-cool border-tone-cool/40",
};

const winPostKey = (item: WinPostItem) => `${item.kind}-${item.trophy ?? "win"}-${item.agent_id}-${item.date}`;

/** Actual renderer plus local copy tools; no query or publishing actions. */
export function WinPostCardPreview({ item, onOpen }: { item: WinPostItem; onOpen: () => void }) {
  const presentation = buildWinPostPresentation(item);
  const ref = useRef<HTMLCanvasElement>(null);
  const [renderFailed, setRenderFailed] = useState(false);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    let live = true;
    setRenderFailed(false);
    void renderCardToCanvas(canvas, item, 0.3).catch(() => {
      if (live) setRenderFailed(true);
    });
    return () => {
      live = false;
    };
  }, [item]);

  return (
    <article className="award-post-card" aria-label={`${item.agent_name} ${item.kind === "trophy" ? "award" : "production win"}`}>
      <button type="button" onClick={onOpen} className="award-post-card__preview" aria-label={`Open card for ${item.agent_name}`}>
        <canvas ref={ref} />
        <span className="award-post-card__tier">Tier {item.tier}</span>
      </button>
      <div className="award-post-card__meta">
        <strong>{presentation.agentName}</strong>
        <span>{presentation.title} · {presentation.dateLabel}</span>
      </div>
      {renderFailed && <p role="alert" className="text-sm text-destructive">Preview unavailable. Open the card to retry.</p>}
      <AwardCopyActions caption={buildCaption(item)} summary={buildAwardCopySummary(item)} />
    </article>
  );
}

function QueueGroup({
  title,
  rows,
  picks,
  busyId,
  onOpen,
  onAct,
}: {
  title: string;
  rows: QueueRow[];
  picks: string[];
  busyId: string | null;
  onOpen: (item: WinPostItem) => void;
  onAct: (row: QueueRow, action: string) => void;
}) {
  if (rows.length === 0) return null;
  return (
    <div className="space-y-2">
      <h2 className="awards-queue-heading">
        {title} <span>{rows.length}</span>
      </h2>
      <div className="awards-card-grid">
        {rows.map((row) => {
          const pick = picks.includes(row.event_key);
          return (
            <div key={row.id} className="awards-queue-card" data-pick={pick}>
              <WinPostCardPreview item={row.payload} onOpen={() => onOpen(row.payload)} />
              {(pick || (row.status === "posted" && row.posted_at)) && (
                <div className="awards-queue-note">
                  {pick && (
                    <strong className="inline-flex items-center gap-1"><Star className="h-4 w-4" /> Today's pick</strong>
                  )}
                  {row.status === "posted" && row.posted_at && (
                    <span>
                      posted {new Date(row.posted_at).toLocaleDateString()}
                    </span>
                  )}
                </div>
              )}
              {row.status !== "posted" && (
                <div className="awards-queue-actions">
                  {row.status === "queued" && (
                    <>
                      <Button size="sm" className="min-h-11 text-sm" disabled={busyId === row.id} onClick={() => onAct(row, "approve")}>
                        <Check className="h-3 w-3 mr-1" /> Approve
                      </Button>
                      <Button size="sm" variant="outline" className="min-h-11 text-sm" disabled={busyId === row.id} onClick={() => onAct(row, "hold")}>
                        <Pause className="h-3 w-3 mr-1" /> Hold
                      </Button>
                    </>
                  )}
                  {row.status === "approved" && (
                    <>
                      <Button size="sm" className="min-h-11 text-sm" disabled={busyId === row.id} onClick={() => onAct(row, "posted")}>
                        <Check className="h-3 w-3 mr-1" /> Mark posted
                      </Button>
                      <Button size="sm" variant="outline" className="min-h-11 text-sm" disabled={busyId === row.id} onClick={() => onAct(row, "hold")}>
                        <Pause className="h-3 w-3 mr-1" /> Hold
                      </Button>
                    </>
                  )}
                  {row.status === "held" && (
                    <>
                      <Button size="sm" className="min-h-11 text-sm" disabled={busyId === row.id} onClick={() => onAct(row, "approve")}>
                        <Check className="h-3 w-3 mr-1" /> Approve
                      </Button>
                      <Button size="sm" variant="outline" className="min-h-11 text-sm" disabled={busyId === row.id} onClick={() => onAct(row, "archive")}>
                        <Archive className="h-3 w-3 mr-1" /> Archive
                      </Button>
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function WinPostStudio() {
  const { user } = useAuth();
  const [filter, setFilter] = useState<FilterKind>("all");
  const [view, setView] = useState<"studio" | "queue">("studio");
  const [busyId, setBusyId] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const [days, setDays] = useState(14);
  const [selection, setSelection] = useState<{ userId: string; item: WinPostItem } | null>(null);
  const selected = selection && selection.userId === user?.id ? selection.item : null;
  const selectedPresentation = selected ? buildWinPostPresentation(selected) : null;
  const setSelected = useCallback((item: WinPostItem | null) => setSelection(item && user?.id ? { userId: user.id, item } : null), [user?.id]);
  const [busy, setBusy] = useState(false);

  useEffect(() => { setSelection(null); }, [user?.id]);

  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ["win-post-feed", user?.id, days],
    enabled: Boolean(user?.id),
    queryFn: async (): Promise<WinPostFeed> => {
      const { data, error } = await supabase.rpc("win_post_feed", { p_days: days });
      if (error) throw error;
      return verifiedFeed(data);
    },
    staleTime: 2 * 60 * 1000,
  });

  const queueQuery = useQuery({
    queryKey: ["win-post-queue-board", user?.id],
    enabled: Boolean(user?.id) && view === "queue",
    queryFn: async (): Promise<QueueBoard> => {
      const { data, error } = await supabase.rpc("win_post_queue_board");
      if (error) throw error;
      return verifiedQueue(data);
    },
    staleTime: 60 * 1000,
  });

  const decide = useMutation({
    mutationFn: async ({ row, action }: { row: QueueRow; action: string }) => {
      const { data, error } = await supabase.rpc("win_post_queue_decide", { p_id: row.id, p_action: action });
      if (error) throw error;
      const r = data as unknown as { ok?: boolean; error?: string; status?: string };
      if (r?.error) throw new Error(r.error);
      return r;
    },
    onMutate: ({ row }) => setBusyId(row.id),
    onSettled: () => setBusyId(null),
    onSuccess: (r) => {
      toast.success(`Card is now ${r.status ?? "updated"}`);
      void queryClient.invalidateQueries({ queryKey: ["win-post-queue-board"] });
    },
    onError: (e: Error) => toast.error(e.message || "Could not update the card"),
  });

  const items = useMemo(() => {
    if (!data) return [];
    const trophies = data.trophies ?? [];
    const wins = data.wins ?? [];
    if (filter === "wins") return wins;
    if (filter === "trophies") return trophies;
    return [...trophies, ...wins];
  }, [data, filter]);

  // Full-res render inside the dialog. Callback ref, NOT useEffect + useRef:
  // Radix portals attach their children one render after `open` flips, so an
  // effect keyed on `selected` runs while the canvas ref is still null, bails,
  // and never retries — the dialog stayed black. The callback fires when the
  // canvas actually lands in the DOM. (Caught by the stubbed render pass.)
  const renderBig = useCallback(
    (canvas: HTMLCanvasElement | null) => {
      if (!canvas || !selected) return;
      void renderCardToCanvas(canvas, selected, 1).catch(() => toast.error("Card failed to render"));
    },
    [selected],
  );

  const handleSave = async (item: WinPostItem) => {
    setBusy(true);
    try {
      const how = await saveCard(item);
      if (how === "shared") toast.success("Sent to share sheet — save or post it");
      else if (how === "downloaded") toast.success("PNG downloaded");
    } catch {
      toast.error("Could not export the card");
    } finally {
      setBusy(false);
    }
  };

  const handleDownloadOnly = async (item: WinPostItem) => {
    setBusy(true);
    try {
      const blob = await exportCardBlob(item);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = cardFilename(item);
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(a.href);
      toast.success("PNG downloaded");
    } catch {
      toast.error("Could not export the card");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="awards-stage">
      <header className="awards-hero">
      <div className="awards-hero__top">
        <div>
          <p className="awards-eyebrow"><Trophy className="h-5 w-5" aria-hidden="true" /> Win Post Studio</p>
          <h1 className="awards-title">Make the win loud.</h1>
          <p className="awards-subtitle">Recorded wins. Your words. A card worth posting.</p>
        </div>
        <div className="awards-toolbar">
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isRefetching}>
            <RefreshCw className={`h-4 w-4 mr-1 ${isRefetching ? "animate-spin" : ""}`} /> Refresh
          </Button>
          <Button variant="outline" size="sm" asChild><Link to="/dashboard/awards">Award wall</Link></Button>
          <Button variant="ghost" size="sm" asChild>
            <Link to="/awards/legacy">
              <History className="h-4 w-4 mr-1" /> Legacy generator
            </Link>
          </Button>
        </div>
      </div>
      </header>

      <div className="awards-tabs" role="group" aria-label="Awards workspace">
        <Button size="sm" variant={view === "studio" ? "secondary" : "ghost"} aria-pressed={view === "studio"} onClick={() => setView("studio")}>
          Win cards
        </Button>
        <Button size="sm" variant={view === "queue" ? "secondary" : "ghost"} aria-pressed={view === "queue"} onClick={() => setView("queue")}>
          <ListChecks className="h-4 w-4 mr-1" /> Posting queue
          {queueQuery.data && (
            <span className="ml-1.5 text-xs opacity-70">
              {(queueQuery.data.counts.queued ?? 0) + (queueQuery.data.counts.approved ?? 0)}
            </span>
          )}
        </Button>
      </div>

      {view === "studio" && (
      <div className="awards-toolbar" role="group" aria-label="Win filters">
        {(
          [
            ["all", "All wins"],
            ["trophies", "Milestones"],
            ["wins", "Production"],
          ] as Array<[FilterKind, string]>
        ).map(([k, label]) => (
          <Button key={k} size="sm" variant={filter === k ? "default" : "outline"} aria-pressed={filter === k} onClick={() => setFilter(k)}>
            {label}
            {data && (
              <span className="awards-count">
                {k === "all"
                  ? (data.wins?.length ?? 0) + (data.trophies?.length ?? 0)
                  : k === "wins"
                    ? (data.wins?.length ?? 0)
                    : (data.trophies?.length ?? 0)}
              </span>
            )}
          </Button>
        ))}
        <div className="ml-auto flex flex-wrap items-center gap-1" role="group" aria-label="Win window">
          {[14, 30, 60].map((d) => (
            <Button key={d} size="sm" variant={days === d ? "secondary" : "ghost"} aria-pressed={days === d} onClick={() => setDays(d)}>
              {d}-day lookback
            </Button>
          ))}
        </div>
      </div>
      )}

      {view === "studio" && data && (
        <p className="text-sm text-muted-foreground">Production: {data.period.from} – {data.period.to}. Milestone windows are shown on each card.</p>
      )}

      {view === "studio" && isLoading && (
        <div className="awards-card-grid" role="status" aria-label="Loading wins">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={`winpost-skel-${i}`} className="aspect-[4/5] w-full rounded-lg" />
          ))}
        </div>
      )}

      {view === "studio" && isError && !isLoading && (
        <div className="awards-state awards-state--error" role="alert">
          <AlertTriangle className="h-6 w-6 text-destructive mb-2" />
          <p>
            {data ? "Refresh failed. Showing the last loaded wins." : "The win feed did not load. Award counts are unavailable."}
          </p>
          <Button size="sm" variant="outline" onClick={() => refetch()}>
            Try again
          </Button>
        </div>
      )}

      {view === "studio" && !isLoading && !isError && items.length === 0 && (
        <div className="awards-state">
          <Zap className="h-5 w-5 mx-auto mb-2" />
          No qualifying wins in this view. New cards appear when recorded results meet the award criteria.
        </div>
      )}

      {view === "studio" && !isLoading && items.length > 0 && (
        <div className="awards-card-grid">
          {items.map((item) => (
            <WinPostCardPreview
              key={`${user?.id}-${winPostKey(item)}`}
              item={item}
              onOpen={() => setSelected(item)}
            />
          ))}
        </div>
      )}

      {view === "queue" && (
        <div className="space-y-5">
          {queueQuery.isLoading && (
            <div className="awards-card-grid" role="status" aria-label="Loading posting queue">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={`queue-skel-${i}`} className="aspect-[4/5] w-full rounded-lg" />
              ))}
            </div>
          )}
          {queueQuery.isError && !queueQuery.isLoading && (
            <div className="awards-state awards-state--error" role="alert">
              <AlertTriangle className="h-6 w-6 text-destructive mb-2" />
              <p>
                {queueQuery.data ? "Refresh failed. Showing the last loaded queue." : "The posting queue did not load. Queue counts are unavailable."}
              </p>
              <Button size="sm" variant="outline" onClick={() => queueQuery.refetch()}>
                Try again
              </Button>
            </div>
          )}
          {queueQuery.data && (
            <>
              <p className="awards-eyebrow">{queueQuery.data.posted_today} marked posted today</p>
              <details className="text-sm text-muted-foreground">
              <summary className="min-h-11 cursor-pointer font-semibold">Queue rules</summary>
              <p>
                Detection runs itself hourly, 7am–7pm Phoenix, and pings your phone when something new crosses the
                bar. Caps: 2 feed posts a day, one per agent per week unless Tier S — "Today's pick" is what the caps
                recommend next. Posted today: {queueQuery.data.posted_today}.
              </p>
              </details>
              <QueueGroup
                title="Ready to post"
                rows={queueQuery.data.queue.filter((r) => r.status === "approved")}
                picks={queueQuery.data.picks}
                busyId={busyId}
                onOpen={setSelected}
                onAct={(row, action) => decide.mutate({ row, action })}
              />
              <QueueGroup
                title="Your next pick"
                rows={queueQuery.data.queue.filter((r) => r.status === "queued")}
                picks={queueQuery.data.picks}
                busyId={busyId}
                onOpen={setSelected}
                onAct={(row, action) => decide.mutate({ row, action })}
              />
              <QueueGroup
                title="Held"
                rows={queueQuery.data.queue.filter((r) => r.status === "held")}
                picks={queueQuery.data.picks}
                busyId={busyId}
                onOpen={setSelected}
                onAct={(row, action) => decide.mutate({ row, action })}
              />
              <QueueGroup
                title="Posted (last 7 days)"
                rows={queueQuery.data.queue.filter((r) => r.status === "posted")}
                picks={[]}
                busyId={busyId}
                onOpen={setSelected}
                onAct={(row, action) => decide.mutate({ row, action })}
              />
              {queueQuery.data.queue.length === 0 && (
                <div className="awards-state">
                  No cards in the posting queue. New qualifying wins appear after detection.
                </div>
              )}
            </>
          )}
        </div>
      )}

      <Dialog open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="awards-dialog max-w-xl gap-4">
          {selected && (
            <>
              <div className="flex items-center justify-between pr-8">
                <div className="min-w-0">
                  <DialogTitle className="awards-dialog__title">{selectedPresentation?.agentName}</DialogTitle>
                  <DialogDescription className="mt-2 text-sm">
                    {selectedPresentation?.title} · {selectedPresentation?.dateLabel}
                  </DialogDescription>
                </div>
                <Badge variant="outline" className={TIER_STYLE[selected.tier] ?? ""}>
                  Tier {selected.tier}
                </Badge>
              </div>
              <div className="overflow-hidden rounded-lg border border-border/60 bg-black">
                <canvas key={`${user?.id}-${winPostKey(selected)}`} ref={renderBig} className="block w-full h-auto" />
              </div>
              <div className="awards-dialog__exports">
                <Button onClick={() => handleSave(selected)} disabled={busy}>
                  <Share2 className="h-4 w-4 mr-1" /> Save / share card
                </Button>
                <Button variant="outline" onClick={() => handleDownloadOnly(selected)} disabled={busy}>
                  <Download className="h-4 w-4 mr-1" /> Download PNG
                </Button>
              </div>
              <p className="text-sm text-muted-foreground">1080 × 1350 PNG. Choose where to post it yourself.</p>
              <AwardCopyActions key={`${user?.id}-${winPostKey(selected)}`} caption={buildCaption(selected)} summary={buildAwardCopySummary(selected)} showText />
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
