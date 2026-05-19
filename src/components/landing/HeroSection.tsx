import { Link } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, Shield, TrendingUp, Users, Sparkles, Play } from "lucide-react";
import { LiveStatsCounterStrip } from "./LiveStatsCounterStrip";
import { RecentHiresTicker } from "./RecentHiresTicker";

// LazyYouTube — render a static poster image as the LCP element, only
// mount the iframe (and pull the YouTube SDK) when the user clicks.
// Cuts ~5s off Largest Contentful Paint on the landing per Lighthouse 2026-05-18.
function LazyYouTube({ videoId, title }: { videoId: string; title: string }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <div className="relative aspect-video rounded-2xl overflow-hidden border border-border/60 shadow-[0_8px_40px_hsl(168_80%_50%/0.2)] bg-black group">
      {loaded ? (
        <iframe
          src={`https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&rel=0`}
          title={title}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          className="absolute inset-0 w-full h-full"
        />
      ) : (
        <button
          type="button"
          onClick={() => setLoaded(true)}
          aria-label={`Play ${title} video`}
          className="absolute inset-0 w-full h-full flex items-center justify-center"
        >
          {/* hqdefault is the right size for above-the-fold + caches well */}
          <img
            src={`https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`}
            alt={title}
            loading="eager"
            decoding="async"
            className="absolute inset-0 w-full h-full object-cover"
          />
          <span className="absolute inset-0 bg-black/30 group-hover:bg-black/45 transition-colors" />
          <span className="relative h-20 w-20 rounded-full bg-primary/95 flex items-center justify-center shadow-[0_0_50px_hsl(168_80%_50%/0.6)] group-hover:scale-110 transition-transform">
            <Play className="h-10 w-10 text-primary-foreground fill-primary-foreground ml-1" />
          </span>
        </button>
      )}
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
  { icon: TrendingUp, label: "Commission-based upside", value: "Performance paid", color: "text-emerald-400" },
  { icon: Users, label: "Warm-lead access", value: "Lead flow ready", color: "text-cyan-400" },
  { icon: Shield, label: "No experience required", value: "We train you", color: "text-amber-400" },
];

export function HeroSection() {
  const titleRef = useRef<HTMLHeadingElement | null>(null);

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
    <section className="relative min-h-[100dvh] flex items-center justify-center overflow-hidden bg-[#030712] pt-24 sm:pt-28 md:pt-32 pb-16">
      {/* Subtle additional decoration layers — aurora handles the heavy lifting */}
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse 80% 60% at 50% 20%, hsl(168 80% 50% / 0.10) 0%, transparent 60%)",
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
            <stop offset="0%"  stopColor="hsl(168 80% 55%)" stopOpacity="0.55" />
            <stop offset="50%" stopColor="hsl(265 80% 65%)" stopOpacity="0.35" />
            <stop offset="100%" stopColor="hsl(38 90% 55%)"  stopOpacity="0.25" />
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
          <div className="landing-fade-up inline-flex items-center gap-2 px-4 py-2 rounded-full bg-card/40 border border-primary/30 mb-8 backdrop-blur-xl shadow-[0_0_30px_hsl(168_80%_50%/0.15)]">
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-primary" />
            </span>
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            <span className="text-xs sm:text-sm text-foreground tracking-wide">
              <span className="brand-gradient font-bold">Licensed & unlicensed</span>
              <span className="text-muted-foreground"> paths open · new agents onboarding now</span>
            </span>
          </div>

          {/* Headline — massive, parallax, gradient */}
          <h1
            ref={titleRef}
            className="landing-scale-in landing-delay-100 font-display font-extrabold leading-[0.95] mb-6 tracking-tight"
            style={{ fontSize: "clamp(2.5rem, 9vw, 6.5rem)" }}
          >
            <span className="block text-foreground">Build your</span>
            <span className="block brand-gradient" style={{ filter: "drop-shadow(0 0 40px hsl(168 80% 50% / 0.45))" }}>
              Financial Empire
            </span>
            <span className="block text-foreground">with APEX</span>
          </h1>

          {/* Video — click-to-load poster (was an eager iframe that
              dragged the YouTube SDK + ~5s into LCP. Now: poster image
              is the LCP target, iframe only mounts on user click). */}
          <div className="landing-fade-up landing-delay-200 w-full max-w-2xl mx-auto mb-8">
            <LazyYouTube videoId="v4Fp3FL9ITo" title="APEX Financial" />
          </div>

          {/* Subheadline */}
          <p className="landing-fade-up landing-delay-200 text-base sm:text-lg md:text-xl text-muted-foreground max-w-3xl mx-auto mb-10 leading-relaxed">
            Join the fastest-growing life insurance agency in America. Leads, training,
            carriers, and a recruiting path — all in one operating system. Licensed
            or starting out, we build the engine you sell on.
          </p>

          {/* CTAs — magnetic glow buttons */}
          <div className="landing-fade-up landing-delay-300 flex flex-col sm:flex-row items-center justify-center gap-4 mb-14">
            <Link to="/apply" className="group relative">
              <span
                aria-hidden
                className="absolute inset-0 rounded-2xl blur-xl opacity-60 group-hover:opacity-100 transition-opacity duration-300"
                style={{
                  background:
                    "linear-gradient(135deg, hsl(168 80% 50%), hsl(265 80% 65%))",
                }}
              />
              <button
                className="
                  relative inline-flex items-center justify-center gap-2
                  px-10 py-5 text-lg sm:text-xl rounded-2xl font-bold font-display
                  bg-gradient-to-br from-primary via-primary to-emerald-600 text-primary-foreground
                  shadow-[0_10px_40px_hsl(168_80%_50%/0.4)]
                  group-hover:scale-105 transition-transform duration-200
                "
              >
                Apply Now
                <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-1" />
              </button>
            </Link>
            {/* Watch-demo button removed 2026-05-18 (PL-010) — no real demo yet. */}
          </div>

          {/* Founder credit — Brand Bible: "the face IS the brand" */}
          <div className="landing-fade-up landing-delay-400 flex items-center justify-center gap-3 mb-10">
            <img
              src="https://xrzweoneiieddzxogewk.supabase.co/storage/v1/object/public/avatars/4491dc82-a056-4fb3-ab38-b132afffb700/avatar-1777285677901.jpg"
              alt="Samuel James, Founder of APEX Financial"
              loading="lazy"
              className="h-11 w-11 rounded-full ring-2 ring-primary/40 object-cover shadow-[0_0_24px_hsl(168_80%_50%/0.25)]"
            />
            <div className="text-left">
              <p className="text-sm font-bold leading-tight">Samuel James</p>
              <p className="text-[11px] text-muted-foreground uppercase tracking-wider">
                Founder · $120K/mo producer
              </p>
            </div>
          </div>

          {/* Live counter strip — real numbers from landing_live_stats() */}
          <LiveStatsCounterStrip />

          {/* Recent hires ticker — proof the engine is firing right now */}
          <RecentHiresTicker />

          {/* 3 Stat pills — glass */}
          <div className="landing-fade-up landing-delay-500 grid grid-cols-1 md:grid-cols-3 gap-3 sm:gap-5 max-w-3xl mx-auto mb-10">
            {stats.map((item, index) => (
              <div
                key={index}
                className="
                  group relative rounded-2xl p-5 text-center
                  bg-card/90 backdrop-blur-xl border border-border/60
                  hover:border-primary/40
                  shadow-md
                  transition-all duration-300 hover:-translate-y-1 hover:scale-[1.02]
                "
              >
                <span
                  aria-hidden
                  className="absolute -top-3 left-1/2 -translate-x-1/2 h-6 w-12 rounded-full opacity-60 blur-md group-hover:opacity-100 transition-opacity"
                  style={{ background: "hsl(168 80% 50%)" }}
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
          <div className="landing-fade-up landing-delay-600 rounded-2xl p-4 max-w-2xl mx-auto bg-card/90 backdrop-blur-xl border border-border/60 overflow-hidden shadow-md">
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
                    key={i}
                    className="text-lg font-bold font-display brand-gradient whitespace-nowrap shrink-0"
                  >
                    {c}
                  </span>
                ))}
              </div>
              {/* Fade edges */}
              <div className="absolute inset-y-0 left-0 w-12 bg-gradient-to-r from-card/90 to-transparent" />
              <div className="absolute inset-y-0 right-0 w-12 bg-gradient-to-l from-card/90 to-transparent" />
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
