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
  const completedRef = useRef(watchedPercent >= 90);
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

  // Show fallback button after 2 minutes
  useEffect(() => {
    const timer = setTimeout(() => {
      if (mountedRef.current && localProgress < 90) {
        setShowFallback(true);
      }
    }, 30_000);
    return () => clearTimeout(timer);
  }, [localProgress]);

  // Create the YouTube player
  useEffect(() => {
    if (!apiReady || !containerRef.current) return;

    // Create a div for the player inside the container
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
          // 1 = playing
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
              if (percent >= 90 && !completedRef.current) {
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
    <div className="relative w-full aspect-video rounded-xl overflow-hidden bg-black">
      {!apiReady && (
        <div className="absolute inset-0 flex items-center justify-center bg-black z-10">
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
                  : "bg-black/60 text-white/70 hover:bg-black/80"
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
          {localProgress >= 90 && (
            <CheckCircle className="h-4 w-4 text-emerald-400" />
          )}
        </div>
        <div className="flex items-center justify-between mt-2">
          <p className="text-xs text-white/60">
            {localProgress >= 90
              ? "✅ Quiz unlocked! You can proceed."
              : "Watch at least 90% to unlock the quiz."}
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
      {showFallback && localProgress < 90 && (
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
  const completedRef = useRef(watchedPercent >= 90);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleTimeUpdate = () => {
      const percent = Math.round((video.currentTime / video.duration) * 100);
      if (percent > localProgress) {
        setLocalProgress(percent);
        onProgressUpdate(percent);
      }
      if (percent >= 90 && !completedRef.current) {
        completedRef.current = true;
        onVideoComplete();
      }
    };

    video.addEventListener("timeupdate", handleTimeUpdate);
    return () => video.removeEventListener("timeupdate", handleTimeUpdate);
  }, [localProgress, onProgressUpdate, onVideoComplete]);

  return (
    <div className="relative w-full aspect-video rounded-xl overflow-hidden bg-black group">
      <video
        ref={videoRef}
        src={videoUrl}
        controls
        className="w-full h-full object-contain"
      />
      <div className="absolute bottom-0 left-0 right-0 p-3 bg-gradient-to-t from-black/80 to-transparent pointer-events-none">
        <div className="flex items-center gap-2">
          <Progress value={localProgress} className="flex-1 h-2" />
          <span className="text-xs text-white/80">{localProgress}%</span>
          {localProgress >= 90 && (
            <CheckCircle className="h-4 w-4 text-emerald-400" />
          )}
        </div>
      </div>
    </div>
  );
}
