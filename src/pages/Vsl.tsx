import { useRef } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Clock, Crown } from "lucide-react";
import { usePageTitle } from "@/hooks/usePageTitle";
import { resolveBrand } from "@/config/brand";
import { track as trackRecruitingEvent } from "@/lib/analytics";
import { buildPublicRecruitingHref, parsePublicRecruitingTrack } from "@/lib/publicRecruitingFlow";
import { recruitingVslForTrack } from "@/lib/vslMedia";
import { VideoPlaybackError } from "@/components/media/VideoPlaybackError";
import { useNativeVideoRecovery } from "@/hooks/useNativeVideoRecovery";
import "@/components/landing/recruiting-funnel.css";

const BRAND = resolveBrand();

/** Public overview. The native player and application link are available immediately. */
export default function Vsl() {
  const [searchParams] = useSearchParams();
  const track = parsePublicRecruitingTrack(searchParams.get("track"));
  const { video, schema, analyticsId, label } = recruitingVslForTrack(track);
  const videoRef = useRef<HTMLVideoElement>(null);
  const playback = useNativeVideoRecovery(video.src, videoRef);
  const isLicensingPath = track === "licensing-roadmap";
  const applyHref = buildPublicRecruitingHref("/apply", searchParams);
  const headline = isLicensingPath ? "Start your insurance career" : "The unfair advantage for serious producers";
  const ctaLabel = isLicensingPath ? "Start my application" : "I’m ready to scale & earn more";
  usePageTitle(`${headline} · ${BRAND.legalName}`);

  return (
    <div className="recruiting-funnel dark recruiting-vsl-page">
      <script id="galaxy-vsl-schema" type="application/ld+json">{JSON.stringify(schema)}</script>
      <header className="recruiting-vsl-header">
        <Link to={buildPublicRecruitingHref("/", searchParams)} className="recruiting-wordmark" aria-label={`${BRAND.legalName} home`}>
          <Crown className="recruiting-wordmark-crown" aria-hidden="true" strokeWidth={1.5} />
          <span>{BRAND.legalName}</span>
        </Link>
      </header>

      <main className="recruiting-vsl-shell">
        <div className="text-center">
          <h1 className="recruiting-vsl-heading">{headline}</h1>
          <p className="recruiting-vsl-lead">
            {isLicensingPath
              ? "Watch the licensing walkthrough: the course, exam, and steps to becoming licensed. Start an application when you’re ready."
              : "Watch the Galaxy overview. See the platform, the support, and your next step as a producer."}
          </p>
        </div>

        <div className="recruiting-vsl-player">
          <div className="relative aspect-video overflow-hidden bg-black">
            <video
              key={video.src}
              ref={videoRef}
              controls
              playsInline
              preload="metadata"
              poster={video.poster}
              aria-label={video.title}
              onError={playback.onError}
              onCanPlay={playback.onCanPlay}
              onPlay={() => trackRecruitingEvent("hero_vsl_play", { video: analyticsId, position: "vsl" })}
              className="absolute inset-0 h-full w-full bg-black object-contain"
            >
              <source src={video.src} type="video/mp4" onError={playback.onError} />
              Your browser cannot play this video. You can still use the application link below.
            </video>
          </div>
        </div>

        {playback.failed && <VideoPlaybackError source={video.src} onRetry={playback.retry} />}

        <div className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <span>{label}</span>
          <span className="inline-flex items-center gap-1.5"><Clock className="h-3.5 w-3.5" aria-hidden="true" />{video.durationLabel}</span>
        </div>

        <div className="recruiting-vsl-actions">
          <Link
            to={applyHref}
            className="recruiting-action recruiting-action-primary"
            onClick={() => trackRecruitingEvent("hero_cta_click", {
              position: "vsl",
              cta_label: ctaLabel,
              partner_path: track ?? "unspecified",
            })}
          >
            {ctaLabel}
          </Link>
          <p className="recruiting-vsl-note">Apply whenever you’re ready.</p>
        </div>
      </main>
    </div>
  );
}
