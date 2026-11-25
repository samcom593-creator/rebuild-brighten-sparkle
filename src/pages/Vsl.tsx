import { Link, useSearchParams } from "react-router-dom";
import { Clock, Crown } from "lucide-react";
import { usePageTitle } from "@/hooks/usePageTitle";
import { resolveBrand } from "@/config/brand";
import { track as trackRecruitingEvent } from "@/lib/analytics";
import { buildPublicRecruitingHref, parsePublicRecruitingTrack } from "@/lib/publicRecruitingFlow";
import { VSL_VIDEO, VSL_VIDEO_SCHEMA } from "@/lib/vslMedia";
import "@/components/landing/recruiting-funnel.css";

const BRAND = resolveBrand();

/** Public overview. The native player and application link are available immediately. */
export default function Vsl() {
  const [searchParams] = useSearchParams();
  const track = parsePublicRecruitingTrack(searchParams.get("track"));
  const isLicensingPath = track === "licensing-roadmap";
  const applyHref = buildPublicRecruitingHref("/apply", searchParams);
  const headline = isLicensingPath ? "Start your insurance career" : "The unfair advantage for serious producers";
  const ctaLabel = isLicensingPath ? "Start my application" : "I’m ready to scale & earn more";
  usePageTitle(`${headline} · ${BRAND.legalName}`);

  return (
    <div className="recruiting-funnel dark recruiting-vsl-page">
      <script id="galaxy-vsl-schema" type="application/ld+json">{JSON.stringify(VSL_VIDEO_SCHEMA)}</script>
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
              ? "Explore the agency and what comes next. Start an application to share your goals and where you are in the licensing process."
              : "Watch the Galaxy overview. See the platform, the support, and your next step as a producer."}
          </p>
        </div>

        <div className="recruiting-vsl-player">
          <div className="relative aspect-video overflow-hidden bg-black">
            <video
              controls
              playsInline
              preload="metadata"
              poster={VSL_VIDEO.poster}
              aria-label={VSL_VIDEO.title}
              onPlay={() => trackRecruitingEvent("hero_vsl_play", { video: "vsl-2026-09-02", position: "vsl" })}
              className="absolute inset-0 h-full w-full bg-black object-contain"
            >
              <source src={VSL_VIDEO.src} type="video/mp4" />
              Your browser cannot play this video. You can still use the application link below.
            </video>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <span>{BRAND.shortName} overview</span>
          <span className="inline-flex items-center gap-1.5"><Clock className="h-3.5 w-3.5" aria-hidden="true" />{VSL_VIDEO.durationLabel}</span>
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
