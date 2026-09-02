import { Link, useSearchParams } from "react-router-dom";
import { useEffect, useRef, lazy, Suspense } from "react";
import { ArrowRight, BadgeCheck, Building2, Route, Shield, TrendingUp, Users } from "lucide-react";
import { track } from "@/lib/analytics";
import { VSL_VIDEO } from "@/lib/vslMedia";
// S11 fix (2026-06-15): build the CTA href with ?ref= when the slug is
// present so the landing -> /apply hop relays the referral via the URL
// (the primary signal). The Index.tsx localStorage relay is the fallback.
import { applyHrefWithRef } from "@/lib/refSlug";
// wave-23 (2026-06-06): wraps the below-LCP-fold proof Suspense blocks so
// QueryClientProvider arrives via a lazy chunk alongside LiveStats + RecentHires
// rather than being pulled into the eager entry static graph.
import { LazyQueryRoot } from "@/shared/api/LazyQueryRoot";

// wave-21 (2026-06-05): below-LCP-fold proof widgets (LiveStats counter strip +
// RecentHires ticker) lazy-loaded so their useQuery + lucide-icons + supabase
// dynamic-import promise + AnimatedCounter dependency tree never lands in the
// eager entry chunk. Both already render `null` when data hasn't arrived, so a
// `null` Suspense fallback below the hero CTA is a no-op visually.
const LiveStatsCounterStrip = lazy(() =>
  import("./LiveStatsCounterStrip").then((m) => ({ default: m.LiveStatsCounterStrip })),
);
const RecentHiresTicker = lazy(() =>
  import("./RecentHiresTicker").then((m) => ({ default: m.RecentHiresTicker })),
);
// 2026-06-13: Sam reported "I see no applications" on the landing. Mirrors
// the hires ticker pattern with anonymized first names + city + state from
// landing_recent_applicants() public RPC.
const RecentApplicantsTicker = lazy(() =>
  import("./RecentApplicantsTicker").then((m) => ({ default: m.RecentApplicantsTicker })),
);

// The homepage and /vsl share one canonical media record. This prevents the
// homepage from silently retaining an older cut after a VSL release.
function HomepageVsl() {
  return (
    <div className="relative aspect-video overflow-hidden rounded-md border border-border/60 bg-black shadow-[0_8px_40px_hsl(var(--primary)/0.2)]">
      <video
        controls
        playsInline
        preload="metadata"
        poster={VSL_VIDEO.poster}
        aria-label={VSL_VIDEO.title}
        onPlay={() => track("hero_vsl_play", { video: "vsl-2026-09-02" })}
        className="absolute inset-0 h-full w-full bg-black object-contain"
      >
        <source src={VSL_VIDEO.src} type="video/mp4" />
        Your browser cannot play this video. Use a current browser to continue.
      </video>
    </div>
  );
}

const carriers = [
  "National Life Group", "American Amicable", "Aflac", "Ethos Life",
  "Mutual of Omaha", "American Home Life", "Transamerica", "Athene",
  "Foresters", "Americo", "F&G", "Prosperity", "American Equity",
  "North American", "Nationwide", "American National", "AIG",
  "Principal", "Lincoln Financial", "Prudential", "John Hancock", "Protective",
];

const stats = [
  { icon: TrendingUp, label: "Commission contracts", value: "70%–145%", color: "text-emerald-400" },
  { icon: Users, label: "Carriers on contract", value: "22 carriers", color: "text-info" },
  { icon: Shield, label: "Course included, no fee", value: "Licensed in 4 wks", color: "text-amber-400" },
];

const partnerPaths = [
  {
    title: "Agency Builders",
    description: "Scale your downline with automated contracting ops, sub-agency hierarchy reporting, and top overrides.",
    icon: Building2,
    track: "agency-builder",
  },
  {
    title: "Licensed Producers",
    description: "Direct lines with 14+ top carriers, day-one script and portal access, and aggressive comp tiers up to 100%+.",
    icon: BadgeCheck,
    track: "licensed-producer",
  },
  {
    title: "Licensing Fast Track",
    description: "XCEL pre-licensing prep, exam coaching, and contracting launched on day one after passing.",
    icon: Route,
    track: "licensing-roadmap",
  },
];

export function HeroSection() {
  const titleRef = useRef<HTMLHeadingElement | null>(null);
  // S11 fix: relay ?ref= through the hero CTA so the slug survives the
  // landing -> /apply hop. Index.tsx already persists it to localStorage
  // for visitors whose CTA path forgets the wiring.
  const [searchParams] = useSearchParams();
  const applyHref = applyHrefWithRef(searchParams.get("ref"));

  // Parallax: subtly translate the headline based on scroll
  useEffect(() => {
    let raf = 0;
    function onScroll() {
      const y = window.scrollY;
      if (titleRef.current) {
        if (!raf) {
          raf = requestAnimationFrame(() => {
            if (titleRef.current) {
              titleRef.current.style.transform = `translateY(${y * -0.18}px)`;
            }
            raf = 0;
          });
        }
      }
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <section className="dark relative min-h-[100dvh] flex items-center justify-center overflow-hidden bg-[#0A0A0A] text-white pt-24 sm:pt-28 md:pt-32 pb-16">
      {/* Subtle additional decoration layers — aurora handles the heavy lifting */}
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse 80% 60% at 50% 20%, hsl(45 85% 52% / 0.10) 0%, transparent 60%)",
        }}
      />
      {/* Animated SVG mesh ribbons */}
      <svg
        aria-hidden
        className="absolute inset-x-0 top-0 w-full h-[120vh] opacity-30 pointer-events-none"
        viewBox="0 0 1200 800"
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id="meshGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#D4AF37" stopOpacity="0.60" />
            <stop offset="50%" stopColor="#C9A961" stopOpacity="0.30" />
            <stop offset="100%" stopColor="#C9A961" stopOpacity="0.16" />
          </linearGradient>
        </defs>
        <path
          pathLength={1}
          className="landing-draw-path"
          stroke="url(#meshGrad)"
          strokeWidth="1.5"
          fill="none"
          d="M 0,400 C 300,200 600,600 1200,300"
        />
        <path
          pathLength={1}
          className="landing-draw-path landing-delay-400"
          stroke="url(#meshGrad)"
          strokeWidth="1"
          fill="none"
          d="M 0,500 C 400,300 800,700 1200,400"
        />
        <path
          pathLength={1}
          className="landing-draw-path landing-delay-700"
          stroke="url(#meshGrad)"
          strokeWidth="0.8"
          fill="none"
          d="M 0,300 C 200,500 1000,200 1200,500"
        />
      </svg>

      <div className="container mx-auto px-4 sm:px-6 relative z-10 w-full">
        <div className="max-w-5xl mx-auto text-center w-full">
          {/* Eyebrow pill */}
          <div className="landing-fade-up inline-flex items-center gap-2 px-4 py-2 rounded-full bg-card/40 border border-primary/30 mb-8 backdrop-blur-xl ">
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-primary" />
            </span>
            <span className="text-xs sm:text-sm text-foreground tracking-wide">
              <span className="brand-gradient font-bold">Licensed & unlicensed</span>
              <span className="text-muted-foreground"> paths open · new agents onboarding now</span>
            </span>
          </div>

          {/* Headline — massive, parallax, gradient */}
          <h1
            ref={titleRef}
            className="landing-scale-in landing-delay-100 font-display font-extrabold leading-[1.02] mb-5 tracking-tight"
            style={{ fontSize: "clamp(2.25rem, 5.5vw, 4rem)" }}
          >
            <span className="block text-foreground">The Operating System for</span>
            <span className="block brand-gradient">Elite Insurance Agencies</span>
          </h1>

          {/* Subheadline */}
          <p className="landing-fade-up landing-delay-200 text-base sm:text-lg md:text-xl text-muted-foreground max-w-3xl mx-auto mb-10 leading-relaxed">
            We partner with ambitious producers and agency builders to scale 6- and 7-figure operations on automated rails. Top carrier contracts, automated contracting, live production tracking, and a battle-tested training machine.
          </p>

          <div className="landing-fade-up landing-delay-300 mx-auto mb-10 grid max-w-5xl grid-cols-1 gap-3 text-left md:grid-cols-3">
            {partnerPaths.map((path) => {
              const Icon = path.icon;
              const destination = path.track === "licensing-roadmap"
                ? "/get-licensed"
                : `${applyHref}${applyHref.includes("?") ? "&" : "?"}track=${path.track}`;
              return (
                <Link
                  key={path.title}
                  to={destination}
                  onClick={() => track("hero_partner_path_click", { partner_path: path.track })}
                  className="group min-h-36 rounded-md border border-[#C9A961]/35 bg-[#030712]/70 p-5 backdrop-blur-sm transition-all hover:-translate-y-0.5 hover:border-[#D4AF37]/80 hover:bg-[#D4AF37]/10 focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)]"
                >
                  <Icon className="mb-4 h-7 w-7 text-[#D4AF37]" aria-hidden />
                  <h2 className="font-display text-lg font-bold text-white">{path.title}</h2>
                  <p className="mt-2 text-sm leading-relaxed text-white/65">{path.description}</p>
                  <span className="mt-4 inline-flex min-h-12 items-center gap-1 text-sm font-semibold text-[#D4AF37]">
                    Explore this path <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                  </span>
                </Link>
              );
            })}
          </div>

          {/* CTAs — magnetic glow primary + trust-tail microcopy.
              Secondary "Watch the walkthrough" scrolls to the hero video
              below (id=hero-video) — keeps high-intent visitors moving,
              gives skeptics a softer first action. */}
          <div className="landing-fade-up landing-delay-300 flex flex-col items-center justify-center gap-3 mb-14">
            <Link
              to={applyHref}
              onClick={() => track("hero_cta_click", { position: "hero", cta_label: "Start My Application" })}
              className="group relative"
            >
              <span
                aria-hidden
                className="absolute inset-0 rounded-md blur-xl opacity-60 group-hover:opacity-100 transition-opacity duration-300"
                style={{
                  background:
                    "linear-gradient(135deg, hsl(45 90% 62%), hsl(40 72% 38%))",
                }}
              />
              <span
                className="
                  relative inline-flex items-center justify-center gap-2
                  px-10 py-5 text-lg sm:text-xl rounded-md font-bold font-display
                  bg-primary text-primary-foreground
                  shadow-[0_10px_40px_hsl(var(--primary)/0.4)]
                  group-hover:bg-primary/90 transition-base
                "
              >
                Start My Application
                <ArrowRight className="h-5 w-5 transition-base group-hover:translate-x-1" />
              </span>
            </Link>
            <p className="text-xs sm:text-sm text-muted-foreground text-center max-w-md">
              Takes 90 seconds · auto-saves if you bounce · Sam replies within 24 hours
            </p>
            <a
              href="#hero-video"
              onClick={() => track("secondary_cta_click", { cta_label: "Watch the walkthrough" })}
              className="text-sm text-primary/90 hover:text-primary underline-offset-4 hover:underline transition-colors mt-1"
            >
              Watch the walkthrough first →
            </a>
          </div>

          {/* Canonical APEX recruiting VSL; the same final cut also lives at /vsl. */}
          <div id="hero-video" className="landing-fade-up landing-delay-400 w-full max-w-2xl mx-auto mb-10 scroll-mt-24">
            <HomepageVsl />
          </div>

          {/* Founder credit — Brand Bible: "the face IS the brand".
              wave-56: was a 75,587-byte Supabase storage JPG with cache-control:
              no-cache that re-downloaded on every cold landing. Now a 88x88
              WebP (1,878 bytes) baked into /public/img/ + 132x132 retina
              source + jpg fallback. width/height set explicitly so the
              landing-fade-up animation can't induce CLS. */}
          <div className="landing-fade-up landing-delay-400 flex items-center justify-center gap-3 mb-10">
            <picture>
              <source
                type="image/webp"
                srcSet="/img/founder-headshot-88.webp 1x, /img/founder-headshot-132.webp 1.5x"
              />
              <img
                src="/img/founder-headshot-88.jpg"
                alt="Samuel James, Founder of APEX Financial"
                width={44}
                height={44}
                loading="lazy"
                decoding="async"
                // ts-ignore-allow:fetchpriority-html-attr-react-types-lag
                // @ts-expect-error — use the standards-cased attribute to avoid
                // React 18 forwarding warnings while retaining the low-priority hint.
                fetchpriority="low"
                className="h-11 w-11 rounded-full ring-2 ring-primary/40 object-cover "
              />
            </picture>
            <div className="text-left">
              <p className="text-sm font-bold leading-tight">Samuel James</p>
              <p className="text-[11px] text-muted-foreground uppercase tracking-wider">
                Founder · $120K/mo producer
              </p>
            </div>
          </div>

          {/* Live counter strip + recent hires ticker — real numbers from
              landing_live_stats() and v_recent_hires. Lazy-loaded below the LCP
              fold (wave-21). Single Suspense + LazyQueryRoot wraps both: their
              useQuery callers share one QueryClientProvider via the same lazy
              chunk (wave-23). */}
          <Suspense fallback={null}>
            <LazyQueryRoot>
              <LiveStatsCounterStrip />
              <RecentHiresTicker />
              <RecentApplicantsTicker />
            </LazyQueryRoot>
          </Suspense>

          {/* 3 Stat pills — glass */}
          <div className="landing-fade-up landing-delay-500 grid grid-cols-1 md:grid-cols-3 gap-3 sm:gap-5 max-w-3xl mx-auto mb-10">
            {stats.map((item) => (
              <div
                key={item.label}
                className="
                  group relative rounded-md p-5 text-center
                  bg-card/90 backdrop-blur-xl border border-border/60
                  hover:border-primary/40
                  shadow-md
                  transition-all duration-300  hover:scale-[1.02]
                "
              >
                <span
                  aria-hidden
                  className="absolute -top-3 left-1/2 -translate-x-1/2 h-6 w-12 rounded-full opacity-60 blur-md group-hover:opacity-100 transition-opacity"
                  style={{ background: "hsl(45 85% 52%)" }}
                />
                <item.icon className={`h-7 w-7 ${item.color} mx-auto mb-2`} />
                <div className={`text-lg font-bold font-display ${item.color}`}>
                  {item.value}
                </div>
                <div className="text-sm text-muted-foreground">{item.label}</div>
              </div>
            ))}
          </div>

          {/* Carrier marquee — continuous scroll instead of single-cycle */}
          <div className="landing-fade-up landing-delay-600 rounded-md p-4 max-w-2xl mx-auto bg-card/90 backdrop-blur-xl border border-border/60 overflow-hidden shadow-md">
            <p className="text-[10px] text-muted-foreground mb-3 uppercase tracking-[0.25em] font-display font-semibold">
              Partnered with top carriers
            </p>
            <div className="relative h-10 overflow-hidden">
              <div
                className="absolute inset-0 flex items-center gap-10 ticker-animate"
                style={{ width: "200%" }}
              >
                {[...carriers, ...carriers].map((c, i) => (
                  <span
                    key={i} /* stable-key-allow:doubled-marquee-static-carriers */
                    className="text-lg font-bold font-display brand-gradient whitespace-nowrap shrink-0"
                  >
                    {c}
                  </span>
                ))}
              </div>
              {/* Fade edges */}
              <div className="absolute inset-y-0 left-0 w-12 bg-white dark:bg-card" />
              <div className="absolute inset-y-0 right-0 w-12 bg-white dark:bg-card" />
            </div>
            <p className="text-[11px] text-muted-foreground mt-3 font-medium font-display">
              Carrier access varies by market and licensing status
            </p>
          </div>
        </div>
      </div>

      {/* Scroll indicator */}
      <div className="landing-scroll-bounce absolute bottom-6 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2">
        <span className="text-[10px] text-muted-foreground uppercase tracking-[0.3em] font-semibold">
          Scroll
        </span>
        <span className="h-8 w-5 rounded-full border-2 border-primary/40 flex items-start justify-center pt-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-primary" />
        </span>
      </div>
    </section>
  );
}
