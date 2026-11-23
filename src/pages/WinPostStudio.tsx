import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  Download, Share2, Copy, RefreshCw, Trophy, Zap, AlertTriangle, History,
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
} from "@/lib/winPostCard";

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

const TIER_STYLE: Record<string, string> = {
  S: "bg-amber-400/15 text-amber-300 border-amber-400/30",
  A: "bg-emerald-400/15 text-emerald-300 border-emerald-400/30",
  B: "bg-violet-400/15 text-violet-300 border-violet-400/30",
};

function CardThumb({ item, onOpen }: { item: WinPostItem; onOpen: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    let live = true;
    void renderCardToCanvas(canvas, item, 0.3).catch(() => {
      if (live) toast.error("Card preview failed to render");
    });
    return () => {
      live = false;
    };
  }, [item]);

  return (
    <button
      type="button"
      onClick={onOpen}
      className="group relative overflow-hidden rounded-lg border border-border/60 bg-black text-left transition-transform hover:scale-[1.015] focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)]"
      aria-label={`Open card for ${item.agent_name}`}
    >
      <canvas ref={ref} className="block w-full h-auto" />
      <span
        className={`absolute top-2 right-2 rounded-full border px-2 py-0.5 text-[10px] font-bold ${TIER_STYLE[item.tier] ?? TIER_STYLE.B}`}
      >
        {item.tier}
      </span>
    </button>
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
      <h2 className="text-sm font-semibold text-muted-foreground">
        {title} <span className="opacity-60">{rows.length}</span>
      </h2>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {rows.map((row) => {
          const pick = picks.includes(row.event_key);
          return (
            <div key={row.id} className={`space-y-1.5 rounded-lg p-1 ${pick ? "ring-2 ring-amber-400/60" : ""}`}>
              <CardThumb item={row.payload} onOpen={() => onOpen(row.payload)} />
              {(pick || (row.status === "posted" && row.posted_at)) && (
                <div className="flex flex-wrap items-center gap-1">
                  {pick && (
                    <span className="inline-flex items-center gap-0.5 rounded-full border border-amber-400/30 bg-amber-400/15 px-1.5 py-0.5 text-[10px] font-bold text-amber-300">
                      <Star className="h-2.5 w-2.5" /> Today's pick
                    </span>
                  )}
                  {row.status === "posted" && row.posted_at && (
                    <span className="text-[10px] text-muted-foreground">
                      posted {new Date(row.posted_at).toLocaleDateString()}
                    </span>
                  )}
                </div>
              )}
              {row.status !== "posted" && (
                <div className="grid grid-cols-2 gap-1">
                  {row.status === "queued" && (
                    <>
                      <Button size="sm" className="h-7 text-xs" disabled={busyId === row.id} onClick={() => onAct(row, "approve")}>
                        <Check className="h-3 w-3 mr-1" /> Approve
                      </Button>
                      <Button size="sm" variant="outline" className="h-7 text-xs" disabled={busyId === row.id} onClick={() => onAct(row, "hold")}>
                        <Pause className="h-3 w-3 mr-1" /> Hold
                      </Button>
                    </>
                  )}
                  {row.status === "approved" && (
                    <>
                      <Button size="sm" className="h-7 text-xs" disabled={busyId === row.id} onClick={() => onAct(row, "posted")}>
                        <Check className="h-3 w-3 mr-1" /> Posted
                      </Button>
                      <Button size="sm" variant="outline" className="h-7 text-xs" disabled={busyId === row.id} onClick={() => onAct(row, "hold")}>
                        <Pause className="h-3 w-3 mr-1" /> Hold
                      </Button>
                    </>
                  )}
                  {row.status === "held" && (
                    <>
                      <Button size="sm" className="h-7 text-xs" disabled={busyId === row.id} onClick={() => onAct(row, "approve")}>
                        <Check className="h-3 w-3 mr-1" /> Approve
                      </Button>
                      <Button size="sm" variant="outline" className="h-7 text-xs" disabled={busyId === row.id} onClick={() => onAct(row, "archive")}>
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
  const [filter, setFilter] = useState<FilterKind>("all");
  const [view, setView] = useState<"studio" | "queue">("studio");
  const [busyId, setBusyId] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const [days, setDays] = useState(14);
  const [selected, setSelected] = useState<WinPostItem | null>(null);
  const [busy, setBusy] = useState(false);

  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ["win-post-feed", days],
    queryFn: async (): Promise<WinPostFeed> => {
      const { data, error } = await supabase.rpc("win_post_feed", { p_days: days });
      if (error) throw error;
      const feed = data as unknown as WinPostFeed;
      if (feed?.error) throw new Error(feed.error);
      return feed;
    },
    staleTime: 2 * 60 * 1000,
  });

  const queueQuery = useQuery({
    queryKey: ["win-post-queue-board"],
    enabled: view === "queue",
    queryFn: async (): Promise<QueueBoard> => {
      const { data, error } = await supabase.rpc("win_post_queue_board");
      if (error) throw error;
      const board = data as unknown as QueueBoard;
      if (board?.error) throw new Error(board.error);
      return board;
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

  const handleCaption = async (item: WinPostItem) => {
    try {
      await navigator.clipboard.writeText(buildCaption(item));
      toast.success("Caption copied");
    } catch {
      toast.error("Clipboard blocked — long-press to copy instead");
    }
  };

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Trophy className="h-6 w-6 text-amber-400" /> Win Post Studio
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Real production only — thresholds decide what qualifies. Tap a card, save, post.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isRefetching}>
            <RefreshCw className={`h-4 w-4 mr-1 ${isRefetching ? "animate-spin" : ""}`} /> Refresh
          </Button>
          <Button variant="ghost" size="sm" asChild>
            <Link to="/awards/legacy">
              <History className="h-4 w-4 mr-1" /> Legacy generator
            </Link>
          </Button>
        </div>
      </div>

      <div className="flex w-fit gap-1 rounded-lg border border-border/60 p-1">
        <Button size="sm" variant={view === "studio" ? "secondary" : "ghost"} onClick={() => setView("studio")}>
          Studio
        </Button>
        <Button size="sm" variant={view === "queue" ? "secondary" : "ghost"} onClick={() => setView("queue")}>
          <ListChecks className="h-4 w-4 mr-1" /> Queue
          {queueQuery.data && (
            <span className="ml-1.5 text-xs opacity-70">
              {(queueQuery.data.counts.queued ?? 0) + (queueQuery.data.counts.approved ?? 0)}
            </span>
          )}
        </Button>
      </div>

      {view === "studio" && (
      <div className="flex flex-wrap items-center gap-2">
        {(
          [
            ["all", "All"],
            ["trophies", "Trophies"],
            ["wins", "Wins"],
          ] as Array<[FilterKind, string]>
        ).map(([k, label]) => (
          <Button key={k} size="sm" variant={filter === k ? "default" : "outline"} onClick={() => setFilter(k)}>
            {label}
            {data && (
              <span className="ml-1.5 text-xs opacity-70">
                {k === "all"
                  ? (data.wins?.length ?? 0) + (data.trophies?.length ?? 0)
                  : k === "wins"
                    ? (data.wins?.length ?? 0)
                    : (data.trophies?.length ?? 0)}
              </span>
            )}
          </Button>
        ))}
        <div className="ml-auto flex items-center gap-1">
          {[14, 30, 60].map((d) => (
            <Button key={d} size="sm" variant={days === d ? "secondary" : "ghost"} onClick={() => setDays(d)}>
              {d}d
            </Button>
          ))}
        </div>
      </div>
      )}

      {view === "studio" && isLoading && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={`winpost-skel-${i}`} className="aspect-[4/5] w-full rounded-lg" />
          ))}
        </div>
      )}

      {view === "studio" && isError && !isLoading && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-6 text-center space-y-3">
          <AlertTriangle className="h-6 w-6 text-red-400 mx-auto" />
          <p className="text-sm text-red-300">
            The win feed did not load — this is a feed failure, not an empty week.
          </p>
          <Button size="sm" variant="outline" onClick={() => refetch()}>
            Try again
          </Button>
        </div>
      )}

      {view === "studio" && !isLoading && !isError && items.length === 0 && (
        <div className="rounded-lg border border-border/60 p-8 text-center text-sm text-muted-foreground">
          <Zap className="h-5 w-5 mx-auto mb-2" />
          Nothing crossed the bar in the last {days} days. The thresholds are doing their job — no average-day posts.
        </div>
      )}

      {view === "studio" && !isLoading && !isError && items.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {items.map((item) => (
            <CardThumb
              key={`${item.kind}-${item.trophy ?? "win"}-${item.agent_id}-${item.date}`}
              item={item}
              onOpen={() => setSelected(item)}
            />
          ))}
        </div>
      )}

      {view === "queue" && (
        <div className="space-y-5">
          {queueQuery.isLoading && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={`queue-skel-${i}`} className="aspect-[4/5] w-full rounded-lg" />
              ))}
            </div>
          )}
          {queueQuery.isError && !queueQuery.isLoading && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-6 text-center space-y-3">
              <AlertTriangle className="h-6 w-6 text-red-400 mx-auto" />
              <p className="text-sm text-red-300">
                The queue did not load — this is a feed failure, not an empty queue.
              </p>
              <Button size="sm" variant="outline" onClick={() => queueQuery.refetch()}>
                Try again
              </Button>
            </div>
          )}
          {queueQuery.data && (
            <>
              <p className="text-xs text-muted-foreground">
                Detection runs itself hourly, 7am–7pm Phoenix, and pings your phone when something new crosses the
                bar. Caps: 2 feed posts a day, one per agent per week unless Tier S — "Today's pick" is what the caps
                recommend next. Posted today: {queueQuery.data.posted_today}.
              </p>
              <QueueGroup
                title="Approved — ready to post"
                rows={queueQuery.data.queue.filter((r) => r.status === "approved")}
                picks={queueQuery.data.picks}
                busyId={busyId}
                onOpen={setSelected}
                onAct={(row, action) => decide.mutate({ row, action })}
              />
              <QueueGroup
                title="Queued — needs your call"
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
                <div className="rounded-lg border border-border/60 p-8 text-center text-sm text-muted-foreground">
                  Queue is empty — detection fills it the moment something crosses the bar.
                </div>
              )}
            </>
          )}
        </div>
      )}

      <Dialog open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="max-w-md p-3 sm:p-4 gap-3">
          {selected && (
            <>
              <div className="flex items-center justify-between pr-8">
                <div className="min-w-0">
                  <DialogTitle className="font-semibold truncate text-base">{selected.agent_name}</DialogTitle>
                  <p className="text-xs text-muted-foreground">
                    {selected.kind === "trophy" ? (selected.headline ?? "Trophy") : "Agent win"} · {selected.date}
                  </p>
                </div>
                <Badge variant="outline" className={TIER_STYLE[selected.tier] ?? ""}>
                  Tier {selected.tier}
                </Badge>
              </div>
              <div className="overflow-hidden rounded-lg border border-border/60 bg-black">
                <canvas ref={renderBig} className="block w-full h-auto" />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <Button onClick={() => handleSave(selected)} disabled={busy}>
                  <Share2 className="h-4 w-4 mr-1" /> Save
                </Button>
                <Button variant="outline" onClick={() => handleDownloadOnly(selected)} disabled={busy}>
                  <Download className="h-4 w-4 mr-1" /> PNG
                </Button>
                <Button variant="outline" onClick={() => handleCaption(selected)}>
                  <Copy className="h-4 w-4 mr-1" /> Caption
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
