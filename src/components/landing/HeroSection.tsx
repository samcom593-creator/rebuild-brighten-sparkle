import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { useEffect, useRef } from "react";
import { ArrowRight, Shield, TrendingUp, Users, Sparkles, PlayCircle } from "lucide-react";

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
    <section className="relative min-h-[100dvh] flex items-center justify-center overflow-hidden pt-24 sm:pt-28 md:pt-32 pb-16">
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
        <motion.path
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 1 }}
          transition={{ duration: 2.5, ease: "easeOut" }}
          stroke="url(#meshGrad)"
          strokeWidth="1.5"
          fill="none"
          d="M 0,400 C 300,200 600,600 1200,300"
        />
        <motion.path
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 1 }}
          transition={{ duration: 2.5, ease: "easeOut", delay: 0.4 }}
          stroke="url(#meshGrad)"
          strokeWidth="1"
          fill="none"
          d="M 0,500 C 400,300 800,700 1200,400"
        />
        <motion.path
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 1 }}
          transition={{ duration: 2.5, ease: "easeOut", delay: 0.8 }}
          stroke="url(#meshGrad)"
          strokeWidth="0.8"
          fill="none"
          d="M 0,300 C 200,500 1000,200 1200,500"
        />
      </svg>

      <div className="container mx-auto px-4 sm:px-6 relative z-10 w-full">
        <div className="max-w-5xl mx-auto text-center w-full">
          {/* Eyebrow pill */}
          <motion.div
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-card/40 border border-primary/30 mb-8 backdrop-blur-xl shadow-[0_0_30px_hsl(168_80%_50%/0.15)]"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-primary" />
            </span>
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            <span className="text-xs sm:text-sm text-foreground tracking-wide">
              <span className="brand-gradient font-bold">Licensed & unlicensed</span>
              <span className="text-muted-foreground"> paths open · new agents onboarding now</span>
            </span>
          </motion.div>

          {/* Headline — massive, parallax, gradient */}
          <motion.h1
            ref={titleRef}
            className="font-display font-extrabold leading-[0.95] mb-6 tracking-tight"
            style={{ fontSize: "clamp(2.5rem, 9vw, 6.5rem)" }}
            initial={{ opacity: 0, y: 30, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
          >
            <span className="block text-foreground">Build your</span>
            <span className="block brand-gradient" style={{ filter: "drop-shadow(0 0 40px hsl(168 80% 50% / 0.45))" }}>
              Financial Empire
            </span>
            <span className="block text-foreground">with APEX</span>
          </motion.h1>

          {/* Video — restored 2026-05-17 (Sam: "put the YouTube video back") */}
          <motion.div
            className="w-full max-w-2xl mx-auto mb-8"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.18 }}
          >
            <div className="aspect-video rounded-2xl overflow-hidden border border-border/60 shadow-[0_8px_40px_hsl(168_80%_50%/0.2)] bg-black">
              <iframe
                src="https://www.youtube.com/embed/v4Fp3FL9ITo"
                title="APEX Financial"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                className="w-full h-full"
              />
            </div>
          </motion.div>

          {/* Subheadline */}
          <motion.p
            className="text-base sm:text-lg md:text-xl text-muted-foreground max-w-3xl mx-auto mb-10 leading-relaxed"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.22 }}
          >
            Join the fastest-growing life insurance agency in America. Leads, training,
            carriers, and a recruiting path — all in one operating system. Licensed
            or starting out, we build the engine you sell on.
          </motion.p>

          {/* CTAs — magnetic glow buttons */}
          <motion.div
            className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-14"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.3 }}
          >
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
            <Link to="/schedule-call">
              <button className="
                inline-flex items-center justify-center gap-2
                px-10 py-5 text-lg sm:text-xl rounded-2xl font-bold font-display
                border-2 border-primary/50 text-foreground
                bg-card/30 backdrop-blur-md
                hover:border-primary hover:bg-card/50 hover:scale-105
                transition-all duration-200
              ">
                <PlayCircle className="h-5 w-5 text-primary" />
                Watch demo
              </button>
            </Link>
          </motion.div>

          {/* 3 Stat pills — glass */}
          <motion.div
            className="grid grid-cols-1 md:grid-cols-3 gap-3 sm:gap-5 max-w-3xl mx-auto mb-10"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.4 }}
          >
            {stats.map((item, index) => (
              <motion.div
                key={index}
                whileHover={{ y: -4, scale: 1.02 }}
                className="
                  group relative rounded-2xl p-5 text-center
                  bg-card/90 backdrop-blur-xl border border-border/60
                  hover:border-primary/40
                  shadow-md
                  transition-all duration-300
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
              </motion.div>
            ))}
          </motion.div>

          {/* Carrier marquee — continuous scroll instead of single-cycle */}
          <motion.div
            className="rounded-2xl p-4 max-w-2xl mx-auto bg-card/90 backdrop-blur-xl border border-border/60 overflow-hidden shadow-md"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.5 }}
          >
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
          </motion.div>
        </div>
      </div>

      {/* Scroll indicator */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1, y: [0, 8, 0] }}
        transition={{ delay: 1.5, duration: 1.6, repeat: Infinity, repeatType: "loop" }}
        className="absolute bottom-6 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2"
      >
        <span className="text-[10px] text-muted-foreground uppercase tracking-[0.3em] font-semibold">
          Scroll
        </span>
        <span className="h-8 w-5 rounded-full border-2 border-primary/40 flex items-start justify-center pt-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-primary" />
        </span>
      </motion.div>
    </section>
  );
}
