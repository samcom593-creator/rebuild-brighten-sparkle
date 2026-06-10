import { Suspense, lazy } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Navbar } from "@/components/landing/Navbar";
import { HeroSection } from "@/components/landing/HeroSection";
import { DealsTicker } from "@/components/landing/DealsTicker";
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
  return (
    <div className="mx-auto h-24 max-w-5xl rounded-md border border-primary/15 bg-white dark:bg-slate-900 animate-pulse" />
  );
}

const Index = () => {
  const { user, isLoading } = useAuth();
  // Logged-in users land on their personalized dashboard, not the public marketing page.
  if (!isLoading && user) return <Navigate to="/dashboard" replace />;
  return (
    <div className="min-h-screen overflow-x-hidden w-full max-w-full relative">
      <DealsTicker />
      <Navbar />
      <main>
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
