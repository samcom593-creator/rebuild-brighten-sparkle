import { useState, useEffect, useRef, useCallback } from "react";
import { Play, CheckCircle, Clock, ExternalLink, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { resolveBrand } from "@/config/brand";

interface CourseVideoPlayerProps {
  videoUrl: string;
  posterUrl?: string | null;
  title?: string;
  videoParts?: Array<{
    title: string;
    url: string;
    duration_seconds: number;
  }>;
  onProgressUpdate: (percent: number) => void;
  watchedPercent: number;
  onVideoComplete: () => void;
}

// Declare the YouTube IFrame API types
declare global {
  interface Window {
    YT: any;
    onYouTubeIframeAPIReady: (() => void) | undefined;
  }
}

let ytApiLoaded = false;
let ytApiLoading = false;
const ytApiCallbacks: (() => void)[] = [];

function loadYouTubeAPI(): Promise<void> {
  return new Promise((resolve) => {
    if (ytApiLoaded && window.YT?.Player) {
      resolve();
      return;
    }

    ytApiCallbacks.push(resolve);

    if (ytApiLoading) return;
    ytApiLoading = true;

    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(tag);

    window.onYouTubeIframeAPIReady = () => {
      ytApiLoaded = true;
      ytApiCallbacks.forEach((cb) => cb());
      ytApiCallbacks.length = 0;
    };
  });
}

function getYouTubeId(url: string): string | null {
  const match = url.match(
    /(?:youtu\.be\/|youtube\.com(?:\/embed\/|\/v\/|\/watch\?v=|\/watch\?.+&v=))([^"&?\/\s]{11})/
  );
  return match ? match[1] : null;
}

const UNLOCK_THRESHOLD = 80;

export function CourseVideoPlayer({
  videoUrl,
  posterUrl,
  title = "Course lesson",
  videoParts = [],
  onProgressUpdate,
  watchedPercent,
  onVideoComplete,
  playbackRate = 1,
  onPlaybackRateChange,
}: CourseVideoPlayerProps & { playbackRate?: number; onPlaybackRateChange?: (rate: number) => void }) {
  if (videoParts.length > 1) {
    return (
      <SegmentedVideoPlayer
        parts={videoParts}
        posterUrl={posterUrl}
        title={title}
        watchedPercent={watchedPercent}
        onProgressUpdate={onProgressUpdate}
        onVideoComplete={onVideoComplete}
      />
    );
  }

  const isYouTube = videoUrl.includes("youtube.com") || videoUrl.includes("youtu.be");
  const youtubeId = isYouTube ? getYouTubeId(videoUrl) : null;
  const driveId = videoUrl.match(/drive\.google\.com\/file\/d\/([^/?#]+)/)?.[1] ?? null;
  const awesomeId = videoUrl.match(/awesomescreenshot\.com\/video\/(\d+)/)?.[1] ?? null;
  const awesomeKey = awesomeId
    ? new URLSearchParams(videoUrl.split("?")[1] ?? "").get("key")
    : null;
  // Sam-feedback 2026-06-01: 11 modules pointed at the @SamuelJamesHQ channel
  // home as a placeholder, which couldn't be embedded. Detect channel/home
  // URLs and show a "Recording in progress" CTA instead of a broken player.
  const isPlaceholder =
    isYouTube && !youtubeId && /(@|user\/|channel\/|c\/|\/playlist)/.test(videoUrl);

  if (isPlaceholder) {
    return <VideoComingSoonCard channelUrl={videoUrl} onMarkWatched={onVideoComplete} />;
  }

  if (isYouTube && youtubeId) {
    return (
      <YouTubePlayer
        videoId={youtubeId}
        onProgressUpdate={onProgressUpdate}
        watchedPercent={watchedPercent}
        onVideoComplete={onVideoComplete}
        playbackRate={playbackRate}
        onPlaybackRateChange={onPlaybackRateChange}
      />
    );
  }

  if (driveId) {
    return (
      <DriveResourcePlayer
        driveId={driveId}
        originalUrl={videoUrl}
        watchedPercent={watchedPercent}
        onProgressUpdate={onProgressUpdate}
        onVideoComplete={onVideoComplete}
      />
    );
  }

  if (awesomeId && awesomeKey) {
    return (
      <AwesomeScreenshotPlayer
        videoId={awesomeId}
        shareKey={awesomeKey}
        originalUrl={videoUrl}
        watchedPercent={watchedPercent}
        onProgressUpdate={onProgressUpdate}
        onVideoComplete={onVideoComplete}
      />
    );
  }

  return (
    <NativeVideoPlayer
      videoUrl={videoUrl}
      posterUrl={posterUrl}
      title={title}
      onProgressUpdate={onProgressUpdate}
      watchedPercent={watchedPercent}
      onVideoComplete={onVideoComplete}
    />
  );
}

function AwesomeScreenshotPlayer({
  videoId,
  shareKey,
  originalUrl,
  watchedPercent,
  onProgressUpdate,
  onVideoComplete,
}: {
  videoId: string;
  shareKey: string;
  originalUrl: string;
  watchedPercent: number;
  onProgressUpdate: (percent: number) => void;
  onVideoComplete: () => void;
}) {
  const complete = watchedPercent >= UNLOCK_THRESHOLD;
  const markComplete = () => {
    onProgressUpdate(100);
    onVideoComplete();
  };

  return (
    <div className="space-y-3">
      <div className="aspect-video overflow-hidden rounded-xl border border-border bg-black">
        <iframe
          src={`https://www.awesomescreenshot.com/embed?id=${videoId}&shareKey=${shareKey}&info=false`}
          title={`${resolveBrand().shortName} systems walkthrough`}
          className="h-full w-full"
          allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
          sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
          allowFullScreen
        />
      </div>
      <div className="flex flex-col gap-2 rounded-lg border border-border bg-muted/30 p-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold">Finish the walkthrough, then confirm below.</p>
          <p className="text-xs text-muted-foreground">
            The secure embedded player cannot report watch time back to {resolveBrand().shortName}.
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline" size="sm">
            <a href={originalUrl} target="_blank" rel="noopener noreferrer">
              Open recording <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
            </a>
          </Button>
          <Button size="sm" onClick={markComplete} disabled={complete} className="gap-1.5">
            <CheckCircle className="h-4 w-4" /> {complete ? "Watched" : "Mark watched"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function DriveResourcePlayer({
  driveId,
  originalUrl,
  watchedPercent,
  onProgressUpdate,
  onVideoComplete,
}: {
  driveId: string;
  originalUrl: string;
  watchedPercent: number;
  onProgressUpdate: (percent: number) => void;
  onVideoComplete: () => void;
}) {
  const complete = watchedPercent >= UNLOCK_THRESHOLD;
  const markComplete = () => {
    onProgressUpdate(100);
    onVideoComplete();
  };
  return (
    <div className="space-y-3">
      <div className="aspect-video overflow-hidden rounded-md border border-border bg-black">
        <iframe
          src={`https://drive.google.com/file/d/${driveId}/preview`}
          title={`${resolveBrand().shortName} training resource`}
          className="h-full w-full"
          allow="autoplay; encrypted-media; fullscreen"
          sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
        />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button asChild variant="outline" size="sm">
          <a href={originalUrl} target="_blank" rel="noopener noreferrer">
            Open in Google Drive <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
          </a>
        </Button>
        <Button size="sm" onClick={markComplete} disabled={complete} className="gap-1.5">
          <CheckCircle className="h-4 w-4" /> {complete ? "Completed" : "Mark watched"}
        </Button>
      </div>
    </div>
  );
}

// ─── Coming-soon placeholder for modules whose video isn't recorded yet ─

function VideoComingSoonCard({ channelUrl, onMarkWatched }: { channelUrl: string; onMarkWatched: () => void }) {
  return (
    <div className="relative w-full aspect-video rounded-md overflow-hidden bg-white dark:bg-card flex flex-col items-center justify-center text-center px-6">
      <div className="absolute top-4 left-4">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-600/15 px-3 py-1 text-xs font-medium text-amber-300 border border-amber-600/40">
          <Clock className="h-3 w-3" /> Recording in progress
        </span>
      </div>
      <div className="h-16 w-16 rounded-full bg-amber-500/15 flex items-center justify-center mb-4">
        <Play className="h-8 w-8 text-amber-400" />
      </div>
      <h3 className="text-lg font-bold text-foreground mb-2">Video coming soon</h3>
      <p className="text-sm text-muted-foreground max-w-md mb-6">
        Sam is finalizing this module's video. In the meantime, read the description below to
        cover the material, then check back when the video drops. Subscribe to be notified.
      </p>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <a
          href={channelUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-md bg-rose-600 hover:bg-rose-700 px-4 py-2 text-sm font-medium text-white"
        >
          <Play className="h-4 w-4" /> Subscribe on YouTube
        </a>
        <Button variant="outline" size="sm" onClick={onMarkWatched} className="gap-1">
          <CheckCircle className="h-4 w-4" /> Mark as read (unlock quiz)
        </Button>
      </div>
    </div>
  );
}

// ─── YouTube Player with IFrame API ─────────────────────────────────────

interface YouTubePlayerProps {
  videoId: string;
  onProgressUpdate: (percent: number) => void;
  watchedPercent: number;
  onVideoComplete: () => void;
  playbackRate?: number;
  onPlaybackRateChange?: (rate: number) => void;
}

function YouTubePlayer({
  videoId,
  onProgressUpdate,
  watchedPercent,
  onVideoComplete,
  playbackRate = 1,
  onPlaybackRateChange,
}: YouTubePlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<any>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [localProgress, setLocalProgress] = useState(watchedPercent);
  const [apiReady, setApiReady] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [showFallback, setShowFallback] = useState(false);
  const completedRef = useRef(watchedPercent >= UNLOCK_THRESHOLD);
  const mountedRef = useRef(true);
  const startTimeRef = useRef<number | null>(null);

  // Load the YouTube IFrame API
  useEffect(() => {
    mountedRef.current = true;
    loadYouTubeAPI().then(() => {
      if (mountedRef.current) setApiReady(true);
    });
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Show fallback button after 30s
  useEffect(() => {
    const timer = setTimeout(() => {
      if (mountedRef.current && localProgress < UNLOCK_THRESHOLD) {
        setShowFallback(true);
      }
    }, 30_000);
    return () => clearTimeout(timer);
  }, [localProgress]);

  // Create the YouTube player
  useEffect(() => {
    if (!apiReady || !containerRef.current) return;

    const playerDiv = document.createElement("div");
    playerDiv.id = `yt-player-${videoId}`;
    containerRef.current.innerHTML = "";
    containerRef.current.appendChild(playerDiv);

    playerRef.current = new window.YT.Player(playerDiv.id, {
      videoId,
      width: "100%",
      height: "100%",
      playerVars: {
        rel: 0,
        modestbranding: 1,
        playsinline: 1,
      },
      events: {
        onStateChange: (event: any) => {
          if (!mountedRef.current) return;
          const state = event.data;
          if (state === 1) {
            setIsPlaying(true);
            if (!startTimeRef.current) startTimeRef.current = Date.now();
            startPolling();
          } else {
            setIsPlaying(false);
            stopPolling();
          }
        },
      },
    });

    return () => {
      stopPolling();
      try {
        playerRef.current?.destroy();
      } catch (e) { // empty-catch-allow:media-api-optional
        // ignore
      }
      playerRef.current = null;
    };
  }, [apiReady, videoId]);

  const startPolling = useCallback(() => {
    if (intervalRef.current) return;
    intervalRef.current = setInterval(() => {
      if (!playerRef.current || !mountedRef.current) return;
      try {
        const current = playerRef.current.getCurrentTime?.();
        const duration = playerRef.current.getDuration?.();
        if (duration > 0 && current >= 0) {
          const percent = Math.round((current / duration) * 100);
          setLocalProgress((prev) => {
            if (percent > prev) {
              onProgressUpdate(percent);
              if (percent >= UNLOCK_THRESHOLD && !completedRef.current) {
                completedRef.current = true;
                onVideoComplete();
              }
              return percent;
            }
            return prev;
          });
        }
      } catch (e) { // empty-catch-allow:media-api-optional
        // Player may not be ready yet
      }
    }, 3000);
  }, [onProgressUpdate, onVideoComplete]);

  const stopPolling = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const handleMarkWatched = () => {
    setLocalProgress(95);
    onProgressUpdate(95);
    if (!completedRef.current) {
      completedRef.current = true;
      onVideoComplete();
    }
    setShowFallback(false);
  };

  const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

  return (
    <div className="relative w-full aspect-video rounded-md overflow-hidden bg-white dark:bg-black">
      {!apiReady && (
        <div className="absolute inset-0 flex items-center justify-center bg-white dark:bg-black z-10">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      )}
      <div ref={containerRef} className="w-full h-full" />

      {/* Speed controls */}
      {onPlaybackRateChange && (
        <div className="absolute top-3 left-3 z-20 flex gap-1">
          {SPEEDS.map(s => (
            <button
              key={s}
              onClick={() => {
                onPlaybackRateChange(s);
                try { playerRef.current?.setPlaybackRate?.(s); } catch {} // empty-catch-allow:media-api-optional
              }}
              className={cn(
                "px-2 py-0.5 rounded text-[10px] font-bold transition-all",
                (playbackRate || 1) === s
                  ? "bg-primary text-primary-foreground"
                  : "bg-white dark:bg-black/60 text-white/70 hover:bg-white dark:bg-black/80"
              )}
            >
              {s}x
            </button>
          ))}
        </div>
      )}

      {/* Progress overlay */}
      <div className="absolute bottom-0 left-0 right-0 p-4 bg-white dark:bg-card pointer-events-none">
        <div className="flex items-center gap-2">
          <Progress value={localProgress} className="flex-1 h-2" />
          <span className="text-xs text-white/80">{localProgress}% watched</span>
          {localProgress >= UNLOCK_THRESHOLD && (
            <CheckCircle className="h-4 w-4 text-emerald-400" />
          )}
        </div>
        <div className="flex items-center justify-between mt-2">
          <p className="text-xs text-white/60">
            {localProgress >= UNLOCK_THRESHOLD
              ? "✅ Quiz unlocked! You can proceed."
              : `Watch at least ${UNLOCK_THRESHOLD}% to unlock the quiz.`}
          </p>
          {isPlaying && (
            <div className="flex items-center gap-1 text-xs text-white/60 pointer-events-none">
              <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
              Tracking
            </div>
          )}
        </div>
      </div>

      {/* Fallback button */}
      {showFallback && localProgress < UNLOCK_THRESHOLD && (
        <div className="absolute top-3 right-3 z-20 pointer-events-auto">
          <Button
            size="sm"
            variant="secondary"
            onClick={handleMarkWatched}
            className="gap-1 text-xs bg-foreground/90 text-foreground hover:bg-white"
          >
            <Clock className="h-3 w-3" />
            Mark as Watched
          </Button>
        </div>
      )}
    </div>
  );
}

// ─── Segmented native video player ─────────────────────────────────────

interface SegmentedVideoPart {
  title: string;
  url: string;
  duration_seconds: number;
}

function SegmentedVideoPlayer({
  parts,
  posterUrl,
  title,
  watchedPercent,
  onProgressUpdate,
  onVideoComplete,
}: {
  parts: SegmentedVideoPart[];
  posterUrl?: string | null;
  title: string;
  watchedPercent: number;
  onProgressUpdate: (percent: number) => void;
  onVideoComplete: () => void;
}) {
  const totalDuration = parts.reduce((sum, part) => sum + Math.max(1, part.duration_seconds), 0);
  const initialWatchedSeconds = (Math.max(0, Math.min(100, watchedPercent)) / 100) * totalDuration;
  const firstIncompleteIndex = parts.findIndex((_, index) => {
    const end = parts.slice(0, index + 1).reduce((sum, part) => sum + Math.max(1, part.duration_seconds), 0);
    return initialWatchedSeconds < end - 1;
  });
  const [activeIndex, setActiveIndex] = useState(firstIncompleteIndex === -1 ? parts.length - 1 : firstIncompleteIndex);
  const [overallProgress, setOverallProgress] = useState(Math.max(0, Math.min(100, watchedPercent)));
  const maxOverallRef = useRef(overallProgress);
  const completedRef = useRef(overallProgress >= UNLOCK_THRESHOLD);

  const secondsBefore = (index: number) => parts
    .slice(0, index)
    .reduce((sum, part) => sum + Math.max(1, part.duration_seconds), 0);

  const watchedSeconds = (overallProgress / 100) * totalDuration;
  const unlockedThrough = parts.reduce((highest, _, index) => (
    secondsBefore(index) <= watchedSeconds + 1 ? index : highest
  ), 0);
  const activePart = parts[activeIndex];
  const activeStart = secondsBefore(activeIndex);
  const activePartProgress = Math.max(0, Math.min(100,
    ((watchedSeconds - activeStart) / Math.max(1, activePart.duration_seconds)) * 100,
  ));

  const saveOverallProgress = (next: number) => {
    const bounded = Math.max(0, Math.min(100, Math.round(next)));
    if (bounded <= maxOverallRef.current) return;
    maxOverallRef.current = bounded;
    setOverallProgress(bounded);
    onProgressUpdate(bounded);
    if (bounded >= UNLOCK_THRESHOLD && !completedRef.current) {
      completedRef.current = true;
      onVideoComplete();
    }
  };

  const handlePartProgress = (partPercent: number) => {
    const seconds = activeStart + (Math.max(0, Math.min(100, partPercent)) / 100) * activePart.duration_seconds;
    saveOverallProgress((seconds / totalDuration) * 100);
  };

  const handlePartEnded = () => {
    const completedSeconds = activeStart + activePart.duration_seconds;
    saveOverallProgress((completedSeconds / totalDuration) * 100);
    if (activeIndex < parts.length - 1) setActiveIndex((index) => index + 1);
  };

  return (
    <div className="space-y-4">
      <NativeVideoPlayer
        key={`${activeIndex}-${activePart.url}`}
        videoUrl={activePart.url}
        posterUrl={posterUrl}
        title={`${title}: ${activePart.title}`}
        onProgressUpdate={handlePartProgress}
        watchedPercent={activePartProgress}
        onVideoComplete={() => undefined}
        onEnded={handlePartEnded}
        progressMode="chapter"
      />

      <div className="rounded-xl border border-border bg-card p-4 sm:p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-primary">Lesson chapters</p>
            <h3 className="mt-1 text-base font-bold">{Math.round(overallProgress)}% of the full lesson complete</h3>
            <p className="mt-1 text-xs text-muted-foreground">Finish each chapter in order. The next one opens automatically.</p>
          </div>
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-primary/25 bg-primary/10 text-sm font-black text-primary">
            {activeIndex + 1}/{parts.length}
          </span>
        </div>
        <Progress value={overallProgress} className="mt-4 h-2" />

        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {parts.map((part, index) => {
            const partEnd = secondsBefore(index) + part.duration_seconds;
            const isComplete = watchedSeconds >= partEnd - 1;
            const isActive = index === activeIndex;
            const isUnlocked = index <= unlockedThrough;
            return (
              <button
                key={part.url}
                type="button"
                disabled={!isUnlocked}
                onClick={() => setActiveIndex(index)}
                className={cn(
                  "flex min-h-14 items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)]",
                  isActive
                    ? "border-primary bg-primary/10"
                    : isUnlocked
                      ? "border-border bg-muted/20 hover:border-primary/40 hover:bg-muted/40"
                      : "cursor-not-allowed border-border/60 bg-muted/10 opacity-55",
                )}
              >
                <span className={cn(
                  "grid h-8 w-8 shrink-0 place-items-center rounded-full border text-xs font-black",
                  isComplete
                    ? "border-success/30 bg-success/15 text-success"
                    : isActive
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-card text-muted-foreground",
                )}>
                  {isComplete ? <CheckCircle className="h-4 w-4" /> : index + 1}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-bold">{part.title}</span>
                  <span className="block text-[11px] text-muted-foreground">
                    {Math.max(1, Math.round(part.duration_seconds / 60))} min {isActive ? "· Now playing" : isComplete ? "· Complete" : ""}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Native Video Player ────────────────────────────────────────────────

interface NativeVideoPlayerProps {
  videoUrl: string;
  posterUrl?: string | null;
  title: string;
  onProgressUpdate: (percent: number) => void;
  watchedPercent: number;
  onVideoComplete: () => void;
  onEnded?: () => void;
  progressMode?: "lesson" | "chapter";
}

function NativeVideoPlayer({
  videoUrl,
  posterUrl,
  title,
  onProgressUpdate,
  watchedPercent,
  onVideoComplete,
  onEnded,
  progressMode = "lesson",
}: NativeVideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [localProgress, setLocalProgress] = useState(watchedPercent);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const completedRef = useRef(watchedPercent >= UNLOCK_THRESHOLD);
  const maxWatchedRef = useRef(0);
  const saveTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const localProgressRef = useRef(watchedPercent);
  const onProgressUpdateRef = useRef(onProgressUpdate);
  const onVideoCompleteRef = useRef(onVideoComplete);
  const onEndedRef = useRef(onEnded);

  // Keep callback refs current without re-mounting the effect
  onProgressUpdateRef.current = onProgressUpdate;
  onVideoCompleteRef.current = onVideoComplete;
  onEndedRef.current = onEnded;

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleLoadedMetadata = () => {
      if (!Number.isFinite(video.duration) || video.duration <= 0) return;
      const resumeAt = Math.min(video.duration, (watchedPercent / 100) * video.duration);
      maxWatchedRef.current = resumeAt;

      // Resume inside the material the agent has already watched. A completed
      // lesson starts at the beginning so it remains useful for review.
      if (resumeAt > 2 && resumeAt < video.duration - 2 && video.currentTime < 1) {
        video.currentTime = resumeAt;
      }
    };

    const handleTimeUpdate = () => {
      if (video.currentTime > maxWatchedRef.current) {
        maxWatchedRef.current = video.currentTime;
      }

      const percent = Math.round((maxWatchedRef.current / video.duration) * 100);
      if (percent > localProgressRef.current) {
        localProgressRef.current = percent;
        setLocalProgress(percent);
        onProgressUpdateRef.current(percent);
      }
      if (percent >= UNLOCK_THRESHOLD && !completedRef.current) {
        completedRef.current = true;
        onVideoCompleteRef.current();
      }
    };

    const handleSeeking = () => {
      if (video.currentTime > maxWatchedRef.current + 1) {
        video.currentTime = maxWatchedRef.current;
      }
    };

    const handleEnded = () => {
      maxWatchedRef.current = video.duration;
      localProgressRef.current = 100;
      setLocalProgress(100);
      onProgressUpdateRef.current(100);
      if (!completedRef.current) {
        completedRef.current = true;
        onVideoCompleteRef.current();
      }
      onEndedRef.current?.();
    };

    video.addEventListener("loadedmetadata", handleLoadedMetadata);
    video.addEventListener("timeupdate", handleTimeUpdate);
    video.addEventListener("seeking", handleSeeking);
    video.addEventListener("ended", handleEnded);

    // Save progress to DB every 15 seconds
    saveTimerRef.current = setInterval(() => {
      if (video.duration > 0) {
        const pct = Math.round((maxWatchedRef.current / video.duration) * 100);
        if (pct > 0) onProgressUpdateRef.current(pct);
      }
    }, 15000);

    return () => {
      video.removeEventListener("loadedmetadata", handleLoadedMetadata);
      video.removeEventListener("timeupdate", handleTimeUpdate);
      video.removeEventListener("seeking", handleSeeking);
      video.removeEventListener("ended", handleEnded);
      if (saveTimerRef.current) clearInterval(saveTimerRef.current);
    };
  }, []); // mount-only — refs carry live callbacks and current progress

  const handleSpeedChange = (speed: number) => {
    setPlaybackSpeed(speed);
    if (videoRef.current) {
      videoRef.current.playbackRate = speed;
    }
  };

  const SPEEDS = [0.5, 1, 1.5, 2];

  return (
    <div className="space-y-3">
      <div className="relative aspect-video w-full overflow-hidden rounded-xl border border-border bg-black shadow-sm">
        <video
          ref={videoRef}
          src={videoUrl}
          poster={posterUrl || undefined}
          aria-label={`${title} video`}
          controls
          playsInline
          preload="metadata"
          className="h-full w-full object-contain native-video-no-seek"
        />
        <div className="pointer-events-none absolute left-3 top-3 rounded-full border border-white/15 bg-black/70 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-white/90 backdrop-blur-sm">
          {resolveBrand().shortName} lesson
        </div>
      </div>

      <div className="rounded-xl border border-border bg-muted/25 p-3 sm:p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-bold">
              {progressMode === "chapter"
                ? (localProgress >= UNLOCK_THRESHOLD ? "Chapter almost complete" : `${localProgress}% of this chapter`)
                : (localProgress >= UNLOCK_THRESHOLD ? "Knowledge check unlocked" : `${localProgress}% watched`)}
            </p>
            <p className="text-xs text-muted-foreground">
              {progressMode === "chapter"
                ? "Your place is saved automatically across every chapter."
                : localProgress >= UNLOCK_THRESHOLD
                  ? "Your progress is saved. Take the check when you are ready."
                  : `Progress saves automatically. Reach ${UNLOCK_THRESHOLD}% to unlock the check.`}
            </p>
          </div>
          {localProgress >= UNLOCK_THRESHOLD && (
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-success/15 text-success">
              <CheckCircle className="h-5 w-5" />
            </span>
          )}
        </div>
        <Progress value={localProgress} className="mt-3 h-2" />
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-border/70 pt-3">
          <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Playback speed</span>
          <div className="flex flex-wrap gap-1.5">
            {SPEEDS.map((speed) => (
              <button
                key={speed}
                type="button"
                aria-label={`Watch at ${speed}x`}
                aria-pressed={playbackSpeed === speed}
                onClick={() => handleSpeedChange(speed)}
                className={cn(
                  "min-h-8 rounded-md border px-2.5 text-xs font-bold transition-colors focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)]",
                  playbackSpeed === speed
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card text-muted-foreground hover:border-primary/50 hover:text-foreground",
                )}
              >
                {speed}x
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
