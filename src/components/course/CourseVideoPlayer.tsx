import { useState, useEffect, useRef } from "react";
import { Play, Pause, Volume2, VolumeX, Maximize, CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

interface CourseVideoPlayerProps {
  videoUrl: string;
  onProgressUpdate: (percent: number) => void;
  watchedPercent: number;
  onVideoComplete: () => void;
}

export function CourseVideoPlayer({
  videoUrl,
  onProgressUpdate,
  watchedPercent,
  onVideoComplete
}: CourseVideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [localProgress, setLocalProgress] = useState(watchedPercent);

  // Check if it's a YouTube URL
  const isYouTube = videoUrl.includes("youtube.com") || videoUrl.includes("youtu.be");
  
  // Extract YouTube video ID
  const getYouTubeId = (url: string) => {
    const match = url.match(/(?:youtu\.be\/|youtube\.com(?:\/embed\/|\/v\/|\/watch\?v=|\/watch\?.+&v=))([^"&?\/\s]{11})/);
    return match ? match[1] : null;
  };

  const youtubeId = isYouTube ? getYouTubeId(videoUrl) : null;

  useEffect(() => {
    const video = videoRef.current;
    if (!video || isYouTube) return;

    const handleTimeUpdate = () => {
      setCurrentTime(video.currentTime);
      const percent = Math.round((video.currentTime / video.duration) * 100);
      if (percent > localProgress) {
        setLocalProgress(percent);
        onProgressUpdate(percent);
      }
      if (percent >= 90 && localProgress < 90) {
        onVideoComplete();
      }
    };

    const handleLoadedMetadata = () => {
      setDuration(video.duration);
    };

    video.addEventListener("timeupdate", handleTimeUpdate);
    video.addEventListener("loadedmetadata", handleLoadedMetadata);

    return () => {
      video.removeEventListener("timeupdate", handleTimeUpdate);
      video.removeEventListener("loadedmetadata", handleLoadedMetadata);
    };
  }, [localProgress, onProgressUpdate, onVideoComplete, isYouTube]);

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;

    if (isPlaying) {
      video.pause();
    } else {
      video.play();
    }
    setIsPlaying(!isPlaying);
  };

  const toggleMute = () => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !isMuted;
    setIsMuted(!isMuted);
  };

  const toggleFullscreen = () => {
    const video = videoRef.current;
    if (!video) return;
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      video.requestFullscreen();
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  if (isYouTube && youtubeId) {
    return (
      <div className="relative w-full aspect-video rounded-xl overflow-hidden bg-black">
        <iframe
          src={`https://www.youtube.com/embed/${youtubeId}?enablejsapi=1&rel=0`}
          className="w-full h-full"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
        <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black/80 to-transparent">
          <div className="flex items-center gap-2">
            <Progress value={watchedPercent} className="flex-1 h-2" />
            <span className="text-xs text-white/80">{watchedPercent}% watched</span>
            {watchedPercent >= 90 && (
              <CheckCircle className="h-4 w-4 text-emerald-400" />
            )}
          </div>
          <p className="text-xs text-white/60 mt-2">
            Watch at least 90% to unlock the quiz. Use the YouTube player controls.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative w-full aspect-video rounded-xl overflow-hidden bg-black group">
      <video
        ref={videoRef}
        src={videoUrl}
        className="w-full h-full object-contain"
        onClick={togglePlay}
      />
      
      {/* Overlay controls */}
      <div className={cn(
        "absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent",
        "opacity-0 group-hover:opacity-100 transition-opacity"
      )}>
        {/* Center play button */}
        <button
          onClick={togglePlay}
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-16 h-16 rounded-full bg-primary/90 flex items-center justify-center hover:bg-primary transition-colors"
        >
          {isPlaying ? (
            <Pause className="h-8 w-8 text-primary-foreground" />
          ) : (
            <Play className="h-8 w-8 text-primary-foreground ml-1" />
          )}
        </button>

        {/* Bottom controls */}
        <div className="absolute bottom-0 left-0 right-0 p-4">
          <Progress value={localProgress} className="h-2 mb-3" />
          
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Button
                size="icon"
                variant="ghost"
                className="text-white hover:bg-white/20"
                onClick={togglePlay}
              >
                {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
              </Button>
              
              <Button
                size="icon"
                variant="ghost"
                className="text-white hover:bg-white/20"
                onClick={toggleMute}
              >
                {isMuted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
              </Button>
              
              <span className="text-sm text-white/80">
                {formatTime(currentTime)} / {formatTime(duration)}
              </span>
            </div>

            <div className="flex items-center gap-2">
              {localProgress >= 90 && (
                <div className="flex items-center gap-1 text-emerald-400 text-sm">
                  <CheckCircle className="h-4 w-4" />
                  <span>Ready for quiz</span>
                </div>
              )}
              
              <Button
                size="icon"
                variant="ghost"
                className="text-white hover:bg-white/20"
                onClick={toggleFullscreen}
              >
                <Maximize className="h-5 w-5" />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
