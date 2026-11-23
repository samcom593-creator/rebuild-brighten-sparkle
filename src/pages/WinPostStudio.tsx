import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Download, Share2, Copy, RefreshCw, Trophy, Zap, AlertTriangle, History } from "lucide-react";
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

export default function WinPostStudio() {
  const [filter, setFilter] = useState<FilterKind>("all");
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

      {isLoading && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={`winpost-skel-${i}`} className="aspect-[4/5] w-full rounded-lg" />
          ))}
        </div>
      )}

      {isError && !isLoading && (
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

      {!isLoading && !isError && items.length === 0 && (
        <div className="rounded-lg border border-border/60 p-8 text-center text-sm text-muted-foreground">
          <Zap className="h-5 w-5 mx-auto mb-2" />
          Nothing crossed the bar in the last {days} days. The thresholds are doing their job — no average-day posts.
        </div>
      )}

      {!isLoading && !isError && items.length > 0 && (
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
