import { Navbar } from "@/components/landing/Navbar";
import { HeroSection } from "@/components/landing/HeroSection";
import { BenefitsSection } from "@/components/landing/BenefitsSection";
import { EarningsSection } from "@/components/landing/EarningsSection";
import { TestimonialsSection } from "@/components/landing/TestimonialsSection";
import { SystemsSection } from "@/components/landing/SystemsSection";
import { CareerPathwaySection } from "@/components/landing/CareerPathwaySection";
import { CTASection } from "@/components/landing/CTASection";
import { Footer } from "@/components/landing/Footer";
import { DealsTicker } from "@/components/landing/DealsTicker";
import { ApplicationToast } from "@/components/landing/ApplicationToast";
import { ApexLeadsSection } from "@/components/landing/ApexLeadsSection";
import { InstagramGrowthSection } from "@/components/landing/InstagramGrowthSection";

const Index = () => {
  return (
    <div className="min-h-screen bg-[#030712] overflow-x-hidden w-full max-w-full">
      <DealsTicker />
      <Navbar />
      <main>
        <HeroSection />
        <BenefitsSection />
        <EarningsSection />
        <TestimonialsSection />
        <SystemsSection />
        <CareerPathwaySection />
        <ApexLeadsSection />
        <InstagramGrowthSection />
        <CTASection />
      </main>
      <Footer />
      <ApplicationToast />
    </div>
  );
};

export default Index;
