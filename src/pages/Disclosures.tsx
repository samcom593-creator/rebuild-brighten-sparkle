import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowLeft, AlertCircle } from "lucide-react";
import { GlassCard } from "@/components/ui/glass-card";
import { Footer } from "@/components/landing/Footer";

export default function Disclosures() {
  return (
    <div className="min-h-screen bg-background">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,hsl(var(--primary)/0.1)_0%,transparent_50%)]" />
      
      <div className="container mx-auto px-4 py-8 relative z-10">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-4xl mx-auto"
        >
          <Link 
            to="/" 
            className="inline-flex items-center gap-2 text-muted-foreground hover:text-primary transition-colors mb-8"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Home
          </Link>
          
          <div className="text-center mb-12">
            <AlertCircle className="h-12 w-12 text-primary mx-auto mb-4" />
            <h1 className="text-4xl font-bold mb-2">Disclosures</h1>
            <p className="text-muted-foreground">
              Important information about APEX Financial and our services
            </p>
          </div>

          <div className="space-y-6">
            <GlassCard className="p-6">
              <h2 className="text-xl font-semibold mb-3 text-primary">Income Disclosure</h2>
              <p className="text-muted-foreground leading-relaxed mb-4">
                Income examples shown on this website are illustrative and not guaranteed. Individual 
                results will vary based on effort, skill, market conditions, and other factors. The income 
                figures presented represent examples of what some successful agents have earned and should 
                not be considered as typical results or earnings projections.
              </p>
              <p className="text-muted-foreground leading-relaxed">
                Many factors affect income potential including, but not limited to: time commitment, 
                work ethic, sales ability, market conditions, client base, product knowledge, and 
                licensing status. There is no guarantee that you will achieve any particular level of income.
              </p>
            </GlassCard>

            <GlassCard className="p-6">
              <h2 className="text-xl font-semibold mb-3 text-primary">Independent Contractor Status</h2>
              <p className="text-muted-foreground leading-relaxed mb-4">
                APEX Financial agents are independent contractors, not employees. As an independent contractor:
              </p>
              <ul className="list-disc list-inside text-muted-foreground space-y-2">
                <li>You are responsible for your own federal, state, and local taxes</li>
                <li>You are not entitled to employee benefits such as health insurance, retirement plans, or paid time off</li>
                <li>You control your own schedule and work methods</li>
                <li>You may work with multiple agencies or carriers</li>
                <li>You are responsible for your own business expenses</li>
              </ul>
            </GlassCard>

            <GlassCard className="p-6">
              <h2 className="text-xl font-semibold mb-3 text-primary">Licensing Requirements</h2>
              <p className="text-muted-foreground leading-relaxed mb-4">
                All individuals selling insurance products must hold valid state insurance licenses in the 
                states where they conduct business. Licensing requirements vary by state and may include:
              </p>
              <ul className="list-disc list-inside text-muted-foreground space-y-2 mb-4">
                <li>Pre-licensing education courses</li>
                <li>Passing a state licensing examination</li>
                <li>Background checks and fingerprinting</li>
                <li>Ongoing continuing education requirements</li>
                <li>License renewal fees</li>
              </ul>
              <p className="text-muted-foreground leading-relaxed">
                APEX Financial may provide resources and guidance for obtaining insurance licenses, 
                but we do not guarantee that any applicant will qualify for or obtain licensing.
              </p>
            </GlassCard>

            <GlassCard className="p-6">
              <h2 className="text-xl font-semibold mb-3 text-primary">Carrier Relationships</h2>
              <p className="text-muted-foreground leading-relaxed">
                APEX Financial works with multiple insurance carriers. Product availability, commission 
                rates, and underwriting requirements vary by carrier and are subject to change without notice. 
                Carrier appointments are subject to carrier approval and may require additional certifications 
                or training.
              </p>
            </GlassCard>

            <GlassCard className="p-6">
              <h2 className="text-xl font-semibold mb-3 text-primary">No Employment Guarantee</h2>
              <p className="text-muted-foreground leading-relaxed">
                Submitting an application to APEX Financial does not guarantee acceptance into our agency. 
                All applications are reviewed based on various criteria including background, experience, 
                licensing status, and fit with our organization. We reserve the right to decline any 
                application at our discretion.
              </p>
            </GlassCard>

            <GlassCard className="p-6">
              <h2 className="text-xl font-semibold mb-3 text-primary">Product Information</h2>
              <p className="text-muted-foreground leading-relaxed">
                Insurance products sold through APEX Financial agents are issued by independent insurance 
                companies. Product features, benefits, limitations, and costs vary by product and carrier. 
                Clients should carefully review all product documentation before making a purchase decision. 
                APEX Financial agents are not authorized to modify or waive any terms of insurance contracts.
              </p>
            </GlassCard>

            <GlassCard className="p-6">
              <h2 className="text-xl font-semibold mb-3 text-primary">Contact Information</h2>
              <p className="text-muted-foreground leading-relaxed mb-4">
                For questions about these disclosures or our business practices, please contact us:
              </p>
              <div className="text-muted-foreground">
                <p>Email: info@apex-financial.org</p>
                <p>Phone: (469) 767-6068</p>
              </div>
            </GlassCard>
          </div>
        </motion.div>
      </div>
      
      <Footer />
    </div>
  );
}
