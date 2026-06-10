import { useState, useEffect, useRef, useCallback } from "react";
import { Play, CheckCircle, Clock, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

interface CourseVideoPlayerProps {
  videoUrl: string;
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
  onProgressUpdate,
  watchedPercent,
  onVideoComplete,
  playbackRate = 1,
  onPlaybackRateChange,
}: CourseVideoPlayerProps & { playbackRate?: number; onPlaybackRateChange?: (rate: number) => void }) {
  const isYouTube = videoUrl.includes("youtube.com") || videoUrl.includes("youtu.be");
  const youtubeId = isYouTube ? getYouTubeId(videoUrl) : null;
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

  return (
    <NativeVideoPlayer
      videoUrl={videoUrl}
      onProgressUpdate={onProgressUpdate}
      watchedPercent={watchedPercent}
      onVideoComplete={onVideoComplete}
    />
  );
}

// ─── Coming-soon placeholder for modules whose video isn't recorded yet ─

function VideoComingSoonCard({ channelUrl, onMarkWatched }: { channelUrl: string; onMarkWatched: () => void }) {
  return (
    <div className="relative w-full aspect-video rounded-xl overflow-hidden bg-gradient-to-br from-zinc-900 via-zinc-900 to-black flex flex-col items-center justify-center text-center px-6">
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
      } catch (e) {
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
      } catch (e) {
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
    <div className="relative w-full aspect-video rounded-xl overflow-hidden bg-white dark:bg-black">
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
                try { playerRef.current?.setPlaybackRate?.(s); } catch {}
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
      <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black/80 to-transparent pointer-events-none">
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
            className="gap-1 text-xs bg-white/90 text-black hover:bg-white"
          >
            <Clock className="h-3 w-3" />
            Mark as Watched
          </Button>
        </div>
      )}
    </div>
  );
}

// ─── Native Video Player ────────────────────────────────────────────────

interface NativeVideoPlayerProps {
  videoUrl: string;
  onProgressUpdate: (percent: number) => void;
  watchedPercent: number;
  onVideoComplete: () => void;
}

function NativeVideoPlayer({
  videoUrl,
  onProgressUpdate,
  watchedPercent,
  onVideoComplete,
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

  // Keep callback refs current without re-mounting the effect
  onProgressUpdateRef.current = onProgressUpdate;
  onVideoCompleteRef.current = onVideoComplete;

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

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

    video.addEventListener("timeupdate", handleTimeUpdate);
    video.addEventListener("seeking", handleSeeking);

    // Save progress to DB every 15 seconds
    saveTimerRef.current = setInterval(() => {
      if (video.duration > 0) {
        const pct = Math.round((maxWatchedRef.current / video.duration) * 100);
        if (pct > 0) onProgressUpdateRef.current(pct);
      }
    }, 15000);

    return () => {
      video.removeEventListener("timeupdate", handleTimeUpdate);
      video.removeEventListener("seeking", handleSeeking);
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
    <div className="relative w-full aspect-video rounded-xl overflow-hidden bg-white dark:bg-black group">
      <video
        ref={videoRef}
        src={videoUrl}
        controls
        className="w-full h-full object-contain native-video-no-seek"
      />

      {/* Speed controls */}
      <div className="absolute top-3 left-3 z-20 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        {SPEEDS.map(s => (
          <button
            key={s}
            onClick={() => handleSpeedChange(s)}
            className={cn(
              "px-2 py-0.5 rounded text-[10px] font-bold transition-all",
              playbackSpeed === s
                ? "bg-primary text-primary-foreground"
                : "bg-white dark:bg-black/60 text-white/70 hover:bg-white dark:bg-black/80"
            )}
          >
            {s}x
          </button>
        ))}
      </div>

      <div className="absolute bottom-0 left-0 right-0 p-3 bg-gradient-to-t from-black/80 to-transparent pointer-events-none">
        <div className="flex items-center gap-2">
          <Progress value={localProgress} className="flex-1 h-2" />
          <span className="text-xs text-white/80">{localProgress}%</span>
          {localProgress >= UNLOCK_THRESHOLD && (
            <CheckCircle className="h-4 w-4 text-emerald-400" />
          )}
        </div>
        <p className="text-[10px] text-white/50 mt-1">
          {localProgress >= UNLOCK_THRESHOLD
            ? "✅ Quiz unlocked!"
            : `Watched ${localProgress}% — need ${UNLOCK_THRESHOLD}% to unlock quiz`}
        </p>
      </div>
    </div>
  );
}
