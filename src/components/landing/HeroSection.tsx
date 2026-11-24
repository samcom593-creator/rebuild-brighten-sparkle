import { Link, useSearchParams } from "react-router-dom";
import { lazy, Suspense } from "react";
import { Crown } from "lucide-react";
import { resolveBrand } from "@/config/brand";
import { track } from "@/lib/analytics";
import { buildPublicRecruitingHref } from "@/lib/publicRecruitingFlow";
import { VSL_VIDEO } from "@/lib/vslMedia";
import { LazyQueryRoot } from "@/shared/api/LazyQueryRoot";
import "./recruiting-funnel.css";

// Keep proof widgets and their query provider outside the eager entry graph.
const LiveStatsCounterStrip = lazy(() =>
  import("./LiveStatsCounterStrip").then((m) => ({ default: m.LiveStatsCounterStrip })),
);
const RecentHiresTicker = lazy(() =>
  import("./RecentHiresTicker").then((m) => ({ default: m.RecentHiresTicker })),
);
const RecentApplicantsTicker = lazy(() =>
  import("./RecentApplicantsTicker").then((m) => ({ default: m.RecentApplicantsTicker })),
);

// Homepage and /vsl continue to use the same canonical source and poster.
function HomepageVsl() {
  return (
    <div className="recruiting-video-frame">
      <video
        controls
        playsInline
        preload="metadata"
        poster={VSL_VIDEO.poster}
        aria-label={VSL_VIDEO.title}
        onPlay={() => track("hero_vsl_play", { video: "vsl-2026-09-02" })}
      >
        <source src={VSL_VIDEO.src} type="video/mp4" />
        Your browser cannot play this video. Use a current browser to continue.
      </video>
    </div>
  );
}

// These literal arrays also anchor the public claim and audience-capture guards.
const carriers = [
  "National Life Group", "American Amicable", "Aflac", "Ethos Life",
  "Mutual of Omaha", "American Home Life", "Transamerica", "Athene",
  "Foresters", "Americo", "F&G", "Prosperity", "American Equity",
  "North American", "Nationwide", "American National", "AIG",
  "Principal", "Lincoln Financial", "Prudential", "John Hancock", "Protective",
];

const stats = [
  { label: "Contract range", value: "70%–145%" },
  { label: "Carrier partners", value: "22 carriers" },
  { label: "Licensing path", value: "Guided" },
];

const partnerPaths = [
  {
    title: "I’m a licensed agent",
    description: "Explore your next opportunity.",
    track: "licensed-producer",
    destination: "/vsl",
  },
  {
    title: "I need my license",
    description: "See how to get started.",
    track: "licensing-roadmap",
    destination: "/vsl",
  },
  {
    title: "Building an agency?",
    description: "Explore the agency-builder path",
    track: "agency-builder",
    destination: "/vsl",
  },
] as const;

export function HeroSection() {
  const [searchParams] = useSearchParams();
  const brand = resolveBrand();

  return (
    <section className="dark recruiting-funnel recruiting-hero" aria-labelledby="recruiting-headline">
      <div className="recruiting-hero-intro">
        <div className="recruiting-wordmark" aria-label={brand.legalName}>
          <Crown className="recruiting-wordmark-crown" aria-hidden="true" strokeWidth={1.5} />
          <span>{brand.legalName}</span>
        </div>

        <h1 id="recruiting-headline" className="recruiting-headline">
          <span className="recruiting-headline-main">YOUR FUTURE</span>
          <em className="recruiting-headline-accent">starts here.</em>
        </h1>
        <p className="recruiting-hero-lead">
          Build your future in life insurance. Get the training, carrier access,
          and support to take your next step.
        </p>

        <div className="recruiting-proof">
          <ul className="recruiting-proof-strip" aria-label="Your opportunity with Galaxy">
            {stats.map((item) => (
              <li key={item.label}>
                <strong>{item.value}</strong>
                <span>{item.label}</span>
              </li>
            ))}
          </ul>
          <p className="recruiting-proof-note">
            Contract levels and carrier access depend on eligibility.
          </p>
        </div>

        <div className="recruiting-license-choice" aria-labelledby="recruiting-license-question">
          <h2 id="recruiting-license-question">Do you have your insurance license?</h2>
          <div className="recruiting-choice-grid">
            {partnerPaths.filter((path) => path.track !== "agency-builder").map((path) => (
              <Link
                key={path.track}
                to={buildPublicRecruitingHref(path.destination, searchParams, path.track)}
                className="recruiting-action recruiting-action-primary recruiting-choice"
                onClick={() => track("hero_partner_path_click", { partner_path: path.track })}
              >
                <span className="recruiting-choice-title">{path.title}</span>
                <span className="recruiting-choice-description">{path.description}</span>
              </Link>
            ))}
          </div>
          {partnerPaths.filter((path) => path.track === "agency-builder").map((path) => (
            <p key={path.track} className="recruiting-builder-path">
              <span>{path.title}</span>{" "}
              <Link
                to={buildPublicRecruitingHref(path.destination, searchParams, path.track)}
                className="recruiting-text-link"
                onClick={() => track("hero_partner_path_click", { partner_path: path.track })}
              >
                {path.description}
              </Link>
            </p>
          ))}
        </div>

        <a
          href="#hero-video"
          className="recruiting-preview-link"
          onClick={() => track("secondary_cta_click", { cta_label: "Watch the agency overview" })}
        >
          Meet Galaxy below
        </a>
      </div>

      <div id="hero-video" className="recruiting-overview" aria-labelledby="recruiting-overview-title">
        <p className="recruiting-eyebrow">The agency overview</p>
        <h2 id="recruiting-overview-title">See what comes next.</h2>
        <p className="recruiting-overview-copy">
          Get to know the opportunity, the support, and the path from your first step to building a team.
        </p>
        <HomepageVsl />

        <details className="recruiting-carriers">
          <summary>Explore our {carriers.length} carrier relationships</summary>
          <ul>
            {carriers.map((carrier) => <li key={carrier}>{carrier}</li>)}
          </ul>
          <p>Carrier access varies by market, licensing status, and appointment approval.</p>
        </details>

        <div className="recruiting-live-proof">
          <Suspense fallback={null}>
            <LazyQueryRoot>
              <LiveStatsCounterStrip />
              <RecentHiresTicker />
              <RecentApplicantsTicker />
            </LazyQueryRoot>
          </Suspense>
        </div>
      </div>
    </section>
  );
}
