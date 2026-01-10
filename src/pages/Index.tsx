import { Navbar } from "@/components/landing/Navbar";
import { HeroSection } from "@/components/landing/HeroSection";
import { BenefitsSection } from "@/components/landing/BenefitsSection";
import { EarningsSection } from "@/components/landing/EarningsSection";
import { TestimonialsSection } from "@/components/landing/TestimonialsSection";
import { SystemsSection } from "@/components/landing/SystemsSection";
import { CTASection } from "@/components/landing/CTASection";
import { Footer } from "@/components/landing/Footer";

const Index = () => {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main>
        <HeroSection />
        <BenefitsSection />
        <EarningsSection />
        <TestimonialsSection />
        <SystemsSection />
        <CTASection />
      </main>
      <Footer />
    </div>
  );
};

export default Index;
