import { Suspense, lazy } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Navbar } from "@/components/landing/Navbar";
import { HeroSection } from "@/components/landing/HeroSection";
import { Footer } from "@/components/landing/Footer";
import { DealsTicker } from "@/components/landing/DealsTicker";

const BenefitsSection = lazy(() => import("@/components/landing/BenefitsSection").then((mod) => ({ default: mod.BenefitsSection })));
const EarningsSection = lazy(() => import("@/components/landing/EarningsSection").then((mod) => ({ default: mod.EarningsSection })));
const CareerPathwaySection = lazy(() => import("@/components/landing/CareerPathwaySection").then((mod) => ({ default: mod.CareerPathwaySection })));
const CTASection = lazy(() => import("@/components/landing/CTASection").then((mod) => ({ default: mod.CTASection })));
const ApexLeadsSection = lazy(() => import("@/components/landing/ApexLeadsSection").then((mod) => ({ default: mod.ApexLeadsSection })));
const InstagramGrowthSection = lazy(() => import("@/components/landing/InstagramGrowthSection").then((mod) => ({ default: mod.InstagramGrowthSection })));

function SectionFallback() {
  // Dark glass placeholder while lazy chunks load. Was `bg-white/[0.03]` —
  // technically a 3% tint but read as "white shimmer" on slow connections.
  return (
    <div className="mx-auto h-24 max-w-5xl rounded-2xl border border-primary/15 bg-gradient-to-br from-primary/5 via-zinc-900/40 to-transparent animate-pulse" />
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
          <BenefitsSection />
          <EarningsSection />
          <CareerPathwaySection />
          <ApexLeadsSection />
          <InstagramGrowthSection />
          <CTASection />
        </Suspense>
      </main>
      <Footer />
    </div>
  );
};

export default Index;
