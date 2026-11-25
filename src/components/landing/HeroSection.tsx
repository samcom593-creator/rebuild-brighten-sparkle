import { Link, useSearchParams } from "react-router-dom";
import { Crown } from "lucide-react";
import { resolveBrand } from "@/config/brand";
import { track } from "@/lib/analytics";
import { buildPublicRecruitingHref } from "@/lib/publicRecruitingFlow";
import "./recruiting-funnel.css";

// Two homepage answers; the shared funnel still accepts agency-builder elsewhere.
const partnerPaths = [
  {
    title: "Yes, I'm Currently Licensed",
    track: "licensed-producer",
    destination: "/vsl",
  },
  {
    title: "No, I'm Unlicensed",
    track: "licensing-roadmap",
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
          <img
            src="/img/recruiting-reference-headline.webp"
            alt="Where winning agencies are built."
            width={1764}
            height={647}
            {...{ fetchpriority: "high" }}
            decoding="async"
          />
        </h1>

        <div className="recruiting-license-choice" aria-labelledby="recruiting-license-question">
          <h2 id="recruiting-license-question">Do you currently have a life insurance license?</h2>
          <div className="recruiting-choice-grid">
            {partnerPaths.map((path) => (
              <Link
                key={path.track}
                to={buildPublicRecruitingHref(path.destination, searchParams, path.track)}
                className="recruiting-action recruiting-action-primary recruiting-choice"
                onClick={() => track("hero_partner_path_click", { partner_path: path.track })}
              >
                <span className="recruiting-choice-title">{path.title}</span>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
