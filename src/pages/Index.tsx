import { Suspense, lazy, useEffect } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Navbar } from "@/components/landing/Navbar";
import { HeroSection } from "@/components/landing/HeroSection";
import { DealsTicker } from "@/components/landing/DealsTicker";
// S11 fix (2026-06-15): capture `?ref=` on landing mount + persist with 24h
// TTL so the slug survives the landing -> /apply CTA hop even when the CTA
// href forgets to relay it. Belt-and-suspenders to the href-with-ref pattern
// already wired in Hero/Sticky/CTASection.
import { setRefSlug } from "@/lib/refSlug";
// wave-23 (2026-06-06): vendor-query out of cold-landing modulepreload.
// Wrapping the below-fold lazy Suspense block in LazyQueryRoot keeps QueryClientProvider
// (and the 28 KB raw / 7.95 KB gz vendor-query chunk it pulls) off the entry static graph.
// Of the eight lazy children below, CareerPathwaySection + CTASection call useQuery — they
// need a provider in context when their chunks resolve.
import { LazyQueryRoot } from "@/shared/api/LazyQueryRoot";

const BenefitsSection = lazy(() => import("@/components/landing/BenefitsSection").then((mod) => ({ default: mod.BenefitsSection })));
const EarningsSection = lazy(() => import("@/components/landing/EarningsSection").then((mod) => ({ default: mod.EarningsSection })));
const CareerPathwaySection = lazy(() => import("@/components/landing/CareerPathwaySection").then((mod) => ({ default: mod.CareerPathwaySection })));
const CTASection = lazy(() => import("@/components/landing/CTASection").then((mod) => ({ default: mod.CTASection })));
const Testimonials = lazy(() => import("@/components/landing/Testimonials").then((mod) => ({ default: mod.Testimonials })));
const RecruitFAQ = lazy(() => import("@/components/landing/RecruitFAQ").then((mod) => ({ default: mod.RecruitFAQ })));
// wave-34 (2026-06-08): Footer + StickyMobileCTA off the eager entry static graph.
// Both are below-LCP-fold (Footer renders after <main>; StickyMobileCTA is fixed bottom
// bar, md:hidden). Eager-importing them dragged Footer's 4 lucide icons (Crown/Mail/Phone/
// MapPin) + ~94 LOC into the entry chunk's 342ms long task surfaced by wave-33's Lighthouse.
// Lazy + null Suspense preserves visual order — Footer hydrates after the proof block.
const Footer = lazy(() => import("@/components/landing/Footer").then((mod) => ({ default: mod.Footer })));
const StickyMobileCTA = lazy(() => import("@/components/landing/StickyMobileCTA").then((mod) => ({ default: mod.StickyMobileCTA })));

function SectionFallback() {
  // Dark glass placeholder while lazy chunks load. Was `bg-white/[0.03]` —
  // technically a 3% tint but read as "white shimmer" on slow connections.
  //
  // perf/site-wide-optimization (2026-08-06): this was a single h-24 (96px) bar
  // standing in for SIX full sections (Testimonials → CTASection) that expand to
  // several thousand pixels once their chunk lands. On a slow mobile connection
  // the footer and sticky CTA paint right under the hero, then get shoved down
  // the page — a large, avoidable layout shift on the highest-traffic public
  // surface. Reserving roughly a viewport of height keeps the shift bounded
  // without leaving an absurd gap on fast connections, and three stacked bars
  // read as "sections loading" instead of one orphaned strip.
  return (
    <div
      className="mx-auto w-full max-w-5xl space-y-4 px-4 min-h-[60vh]"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="h-40 rounded-md border border-primary/15 bg-white dark:bg-card motion-safe:animate-pulse" />
      <div className="h-40 rounded-md border border-primary/15 bg-white dark:bg-card motion-safe:animate-pulse" />
      <div className="h-24 rounded-md border border-primary/15 bg-white dark:bg-card motion-safe:animate-pulse" />
      <span className="sr-only">Loading page sections…</span>
    </div>
  );
}

const Index = () => {
  const { user, isLoading } = useAuth();
  const [searchParams] = useSearchParams();
  const urlRefSlug = searchParams.get("ref");

  // S11 fix: stash the slug before the dashboard redirect (logged-in case) or
  // before the visitor clicks a CTA that might forget to relay `?ref=`. The
  // helper validates format + handles SSR/quota errors silently.
  useEffect(() => {
    if (urlRefSlug) setRefSlug(urlRefSlug);
  }, [urlRefSlug]);

  useEffect(() => {
    const previousTitle = document.title;
    document.title = "APEX Financial · Operating System for Elite Insurance Agencies";
    const description = "APEX helps ambitious producers and agency builders scale with contracting, training, carrier access, and live production operations.";
    const meta = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    const previousDescription = meta?.content;
    if (meta) meta.content = description;
    return () => {
      document.title = previousTitle;
      if (meta && previousDescription !== undefined) meta.content = previousDescription;
    };
  }, []);

  // Logged-in users land on their personalized dashboard, not the public marketing page.
  if (!isLoading && user) return <Navigate to="/dashboard" replace />;
  return (
    <div className="min-h-screen overflow-x-hidden w-full max-w-full relative bg-[#0A0A0A]">
      {/* Skip link — pure markup, zero JS cost on the cold-landing path. */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[100] focus:rounded-md focus:bg-background focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-foreground focus:shadow-lg focus:outline focus:outline-2 focus:outline-offset-2 focus:outline-primary"
      >
        Skip to main content
      </a>
      <DealsTicker />
      <Navbar />
      {/* pb-24 md:pb-0 reserves the height of the fixed StickyMobileCTA so the
          last section (CTASection) is not permanently covered on phones. */}
      <main id="main-content" tabIndex={-1} className="pb-24 md:pb-0">
        <HeroSection />
        <Suspense fallback={<SectionFallback />}>
          <LazyQueryRoot>
            <Testimonials />
            <BenefitsSection />
            <EarningsSection />
            <CareerPathwaySection />
            <RecruitFAQ />
            <CTASection />
          </LazyQueryRoot>
        </Suspense>
      </main>
      <Suspense fallback={null}>
        <Footer />
      </Suspense>
      <Suspense fallback={null}>
        <StickyMobileCTA />
      </Suspense>
    </div>
  );
};

export default Index;
