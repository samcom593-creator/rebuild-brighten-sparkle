import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowLeft, FileText } from "lucide-react";
import { GlassCard } from "@/components/ui/glass-card";
import { Footer } from "@/components/landing/Footer";

export default function Terms() {
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
            <FileText className="h-12 w-12 text-primary mx-auto mb-4" />
            <h1 className="text-4xl font-bold mb-2">Terms of Service</h1>
            <p className="text-muted-foreground">
              Last updated: {new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
            </p>
          </div>

          <div className="space-y-6">
            <GlassCard className="p-6">
              <h2 className="text-xl font-semibold mb-3 text-primary">Acceptance of Terms</h2>
              <p className="text-muted-foreground leading-relaxed">
                By accessing or using the APEX Financial website and services, you agree to be bound 
                by these Terms of Service. If you do not agree to these terms, please do not use our services.
              </p>
            </GlassCard>

            <GlassCard className="p-6">
              <h2 className="text-xl font-semibold mb-3 text-primary">Agent Relationship</h2>
              <p className="text-muted-foreground leading-relaxed">
                APEX Financial agents are independent contractors, not employees. As an independent contractor, 
                you are responsible for your own taxes, insurance, and business expenses. Your income is 
                directly tied to your production and is not guaranteed. Past performance examples are for 
                illustration purposes only.
              </p>
            </GlassCard>

            <GlassCard className="p-6">
              <h2 className="text-xl font-semibold mb-3 text-primary">Licensing Requirements</h2>
              <p className="text-muted-foreground leading-relaxed">
                To sell insurance products, you must hold valid state insurance licenses in the states 
                where you conduct business. You are responsible for obtaining and maintaining all required 
                licenses and certifications. APEX Financial may provide resources to help you obtain licensing 
                but does not guarantee licensing approval.
              </p>
            </GlassCard>

            <GlassCard className="p-6">
              <h2 className="text-xl font-semibold mb-3 text-primary">Code of Conduct</h2>
              <p className="text-muted-foreground leading-relaxed">
                All agents must conduct business ethically and in compliance with all applicable laws, 
                regulations, and company policies. This includes treating clients with respect, providing 
                accurate information about products, and maintaining client confidentiality.
              </p>
            </GlassCard>

            <GlassCard className="p-6">
              <h2 className="text-xl font-semibold mb-3 text-primary">Intellectual Property</h2>
              <p className="text-muted-foreground leading-relaxed">
                All content on this website, including logos, text, graphics, and software, is the property 
                of APEX Financial and protected by intellectual property laws. You may not use, reproduce, 
                or distribute this content without prior written permission.
              </p>
            </GlassCard>

            <GlassCard className="p-6">
              <h2 className="text-xl font-semibold mb-3 text-primary">Limitation of Liability</h2>
              <p className="text-muted-foreground leading-relaxed">
                APEX Financial and its affiliates shall not be liable for any indirect, incidental, special, 
                consequential, or punitive damages arising from your use of our services. Our total liability 
                shall not exceed the amounts paid to you in commissions over the preceding twelve months.
              </p>
            </GlassCard>

            <GlassCard className="p-6">
              <h2 className="text-xl font-semibold mb-3 text-primary">Termination</h2>
              <p className="text-muted-foreground leading-relaxed">
                Either party may terminate the agent relationship at any time with or without cause. 
                Upon termination, you must cease all use of APEX Financial materials and return any 
                company property in your possession.
              </p>
            </GlassCard>

            <GlassCard className="p-6">
              <h2 className="text-xl font-semibold mb-3 text-primary">Changes to Terms</h2>
              <p className="text-muted-foreground leading-relaxed">
                We reserve the right to modify these terms at any time. Changes will be effective upon 
                posting to this website. Your continued use of our services after changes constitutes 
                acceptance of the modified terms.
              </p>
            </GlassCard>

            <GlassCard className="p-6">
              <h2 className="text-xl font-semibold mb-3 text-primary">Contact Us</h2>
              <p className="text-muted-foreground leading-relaxed mb-4">
                For questions about these Terms of Service, please contact us at:
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
