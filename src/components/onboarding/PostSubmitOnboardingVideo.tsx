import {
  forwardRef,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { Crown, Loader2, Volume2 } from "lucide-react";
import { ONBOARDING_VIDEO } from "@/lib/onboardingMedia";

export interface PostSubmitOnboardingVideoHandle {
  prepare: () => boolean;
  start: (nextUrl: string) => Promise<void>;
  cancel: () => Promise<void>;
}

interface PostSubmitOnboardingVideoProps {
  onFinished: (nextUrl: string) => void;
}

type PlayerStage = "idle" | "submitting" | "playing" | "tap-to-play";

export const PostSubmitOnboardingVideo = forwardRef<
  PostSubmitOnboardingVideoHandle,
  PostSubmitOnboardingVideoProps
>(function PostSubmitOnboardingVideo({ onFinished }, ref) {
  const shellRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const nextUrlRef = useRef("/");
  const [stage, setStage] = useState<PlayerStage>("idle");
  const [progress, setProgress] = useState(0);

  const exitFullscreen = async () => {
    if (document.fullscreenElement) {
      await document.exitFullscreen().catch(() => undefined); // empty-catch-allow:fullscreen-best-effort
    }
  };

  const playFromBeginning = async () => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = 0;
    video.muted = false;
    try {
      await video.play();
      setStage("playing");
    } catch {
      setStage("tap-to-play");
    }
  };

  useImperativeHandle(ref, () => ({
    prepare() {
      if (!ONBOARDING_VIDEO.ready) return false;

      setProgress(0);
      setStage("submitting");

      // Submit is a real user gesture. Request native fullscreen immediately;
      // the fixed viewport shell remains the fallback on unsupported browsers.
      const shell = shellRef.current;
      if (shell?.requestFullscreen) {
        void shell.requestFullscreen().catch(() => undefined); // empty-catch-allow:fullscreen-best-effort
      }

      const video = videoRef.current;
      if (video) {
        video.muted = true;
        video.currentTime = 0;
        void video.play().catch(() => undefined); // empty-catch-allow:muted-preload-best-effort
      }
      return true;
    },
    async start(nextUrl: string) {
      nextUrlRef.current = nextUrl;
      await playFromBeginning();
    },
    async cancel() {
      const video = videoRef.current;
      if (video) {
        video.pause();
        video.currentTime = 0;
      }
      setStage("idle");
      setProgress(0);
      await exitFullscreen();
    },
  }));

  const finish = async () => {
    const nextUrl = nextUrlRef.current;
    setStage("idle");
    setProgress(0);
    await exitFullscreen();
    onFinished(nextUrl);
  };

  const visible = stage !== "idle";

  return (
    <div
      ref={shellRef}
      aria-hidden={!visible}
      className={`fixed inset-0 z-[1000] bg-black transition-opacity duration-200 ${
        visible
          ? "pointer-events-auto opacity-100"
          : "pointer-events-none opacity-0"
      }`}
    >
      <video
        ref={videoRef}
        playsInline
        preload="metadata"
        poster={ONBOARDING_VIDEO.ready ? ONBOARDING_VIDEO.poster : undefined}
        aria-label={ONBOARDING_VIDEO.title}
        onTimeUpdate={(event) => {
          const video = event.currentTarget;
          if (video.duration > 0) setProgress(video.currentTime / video.duration);
        }}
        onEnded={() => void finish()}
        className="absolute inset-0 h-full w-full bg-black object-contain"
      >
        {ONBOARDING_VIDEO.ready ? (
          <source src={ONBOARDING_VIDEO.src} type="video/mp4" />
        ) : null}
      </video>

      <div className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-foreground/10">
        <div
          className="h-full bg-primary transition-[width] duration-150"
          style={{ width: `${Math.max(0, Math.min(1, progress)) * 100}%` }}
        />
      </div>

      {stage === "submitting" ? (
        <div className="absolute inset-0 flex items-center justify-center bg-black/90 px-6 text-center">
          <div>
            <Crown className="mx-auto mb-5 h-12 w-12 text-primary" />
            <Loader2 className="mx-auto mb-4 h-7 w-7 animate-spin text-primary" />
            <p className="text-xl font-semibold text-foreground">
              Securing your APEX spot…
            </p>
            <p className="mt-2 text-sm text-foreground/60">
              Your onboarding starts automatically when submission is confirmed.
            </p>
          </div>
        </div>
      ) : null}

      {stage === "tap-to-play" ? (
        <button
          type="button"
          onClick={() => void playFromBeginning()}
          className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/80 px-6 text-center text-white"
        >
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <Volume2 className="h-7 w-7" />
          </span>
          <span className="text-xl font-semibold">Tap to start onboarding</span>
          <span className="text-sm text-foreground/60">
            Your browser needs one more tap to enable sound.
          </span>
        </button>
      ) : null}
    </div>
  );
});
