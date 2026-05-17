import { Suspense, lazy } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Navbar } from "@/components/landing/Navbar";
import { HeroSection } from "@/components/landing/HeroSection";
import { Footer } from "@/components/landing/Footer";
import { DealsTicker } from "@/components/landing/DealsTicker";

const BenefitsSection = lazy(() => import("@/components/landing/BenefitsSection").then((mod) => ({ default: mod.BenefitsSection })));
const EarningsSection = lazy(() => import("@/components/landing/EarningsSection").then((mod) => ({ default: mod.EarningsSection })));
const TestimonialsSection = lazy(() => import("@/components/landing/TestimonialsSection").then((mod) => ({ default: mod.TestimonialsSection })));
const SystemsSection = lazy(() => import("@/components/landing/SystemsSection").then((mod) => ({ default: mod.SystemsSection })));
const CareerPathwaySection = lazy(() => import("@/components/landing/CareerPathwaySection").then((mod) => ({ default: mod.CareerPathwaySection })));
const CTASection = lazy(() => import("@/components/landing/CTASection").then((mod) => ({ default: mod.CTASection })));
const ApexLeadsSection = lazy(() => import("@/components/landing/ApexLeadsSection").then((mod) => ({ default: mod.ApexLeadsSection })));
const InstagramGrowthSection = lazy(() => import("@/components/landing/InstagramGrowthSection").then((mod) => ({ default: mod.InstagramGrowthSection })));

function SectionFallback() {
  return <div className="mx-auto h-24 max-w-5xl animate-pulse rounded-2xl bg-white/[0.03]" />;
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
          <TestimonialsSection />
          <SystemsSection />
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
