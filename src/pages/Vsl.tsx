import { Link, useSearchParams } from "react-router-dom";
import { Clock } from "lucide-react";
import { usePageTitle } from "@/hooks/usePageTitle";
import { resolveBrand } from "@/config/brand";
import { track as trackRecruitingEvent } from "@/lib/analytics";
import { buildPublicRecruitingHref, parsePublicRecruitingTrack } from "@/lib/publicRecruitingFlow";
import { VSL_VIDEO } from "@/lib/vslMedia";
import "@/components/landing/recruiting-funnel.css";

const BRAND = resolveBrand();

/** Public overview. The native player and application link are available immediately. */
export default function Vsl() {
  const [searchParams] = useSearchParams();
  const track = parsePublicRecruitingTrack(searchParams.get("track"));
  const isLicensingPath = track === "licensing-roadmap";
  const applyHref = buildPublicRecruitingHref("/apply", searchParams);
  const licensingHref = buildPublicRecruitingHref("/get-licensed", searchParams, "licensing-roadmap");
  const headline = isLicensingPath ? "Start your insurance career" : VSL_VIDEO.title;
  usePageTitle(`${headline} · ${BRAND.legalName}`);

  return (
    <div className="recruiting-funnel dark recruiting-vsl-page">
      <header className="recruiting-vsl-header">
        <Link to={buildPublicRecruitingHref("/", searchParams)} className="font-display text-lg font-semibold tracking-tight text-foreground" aria-label={`${BRAND.legalName} home`}>
          {BRAND.legalName}
        </Link>
        <span className="text-sm font-medium uppercase tracking-[0.16em] text-muted-foreground">Agency overview</span>
      </header>

      <main className="recruiting-vsl-shell">
        <div className="text-center">
          <p className="mb-4 text-sm font-semibold uppercase tracking-[0.18em] text-primary">
            {isLicensingPath ? "For aspiring insurance agents" : track === "agency-builder" ? "For agency builders" : track === "licensed-producer" ? "For licensed producers" : "The agency opportunity"}
          </p>
          <h1 className="recruiting-vsl-heading">{headline}</h1>
          <p className="recruiting-vsl-lead">
            {isLicensingPath
              ? "Explore the agency and what comes next. Start an application to share your goals and where you are in the licensing process."
              : "Get a closer look at the platform, the paths, and how a producer starts. Then take the next step with your application."}
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
              cta_label: isLicensingPath ? "Start my application" : `Apply to ${BRAND.shortName}`,
              partner_path: track ?? "unspecified",
            })}
          >
            {isLicensingPath ? "Start my application" : `Apply to ${BRAND.shortName}`}
          </Link>
          <p className="recruiting-vsl-note">Apply whenever you’re ready.</p>
          <Link to={licensingHref} className="recruiting-text-link">
            {isLicensingPath ? "View the licensing roadmap" : "Need a license? View the roadmap"}
          </Link>
        </div>
      </main>
    </div>
  );
}
