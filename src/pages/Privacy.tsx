import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowLeft, Shield } from "lucide-react";
import { GlassCard } from "@/components/ui/glass-card";
import { Footer } from "@/components/landing/Footer";

export default function Privacy() {
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
            <Shield className="h-12 w-12 text-primary mx-auto mb-4" />
            <h1 className="text-4xl font-bold mb-2">Privacy Policy</h1>
            <p className="text-muted-foreground">
              Last updated: {new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
            </p>
          </div>

          <div className="space-y-6">
            <GlassCard className="p-6">
              <h2 className="text-xl font-semibold mb-3 text-primary">Information We Collect</h2>
              <p className="text-muted-foreground leading-relaxed">
                When you apply to join APEX Financial or use our agent portal, we collect information 
                you provide directly, including your name, email address, phone number, and professional 
                background information. We also collect information about your production metrics and 
                performance data as part of our agent management system.
              </p>
            </GlassCard>

            <GlassCard className="p-6">
              <h2 className="text-xl font-semibold mb-3 text-primary">How We Use Your Information</h2>
              <p className="text-muted-foreground leading-relaxed">
                We use the information we collect to process your application, manage your agent account, 
                track production metrics, facilitate team communications, and improve our services. 
                Your contact information may be used to send important updates about your account, 
                training opportunities, and performance notifications.
              </p>
            </GlassCard>

            <GlassCard className="p-6">
              <h2 className="text-xl font-semibold mb-3 text-primary">Information Sharing</h2>
              <p className="text-muted-foreground leading-relaxed">
                We do not sell your personal information. We may share your information with our 
                insurance carrier partners as required for contracting and licensing purposes. 
                Performance data may be shared within our organization for team management and 
                leaderboard features.
              </p>
            </GlassCard>

            <GlassCard className="p-6">
              <h2 className="text-xl font-semibold mb-3 text-primary">Data Security</h2>
              <p className="text-muted-foreground leading-relaxed">
                We implement appropriate technical and organizational measures to protect your personal 
                information against unauthorized access, alteration, disclosure, or destruction. 
                This includes encryption of data in transit and at rest.
              </p>
            </GlassCard>

            <GlassCard className="p-6">
              <h2 className="text-xl font-semibold mb-3 text-primary">Your Rights</h2>
              <p className="text-muted-foreground leading-relaxed">
                You have the right to access, correct, or delete your personal information. 
                To exercise these rights, please contact us at info@kingofsales.net. 
                We will respond to your request within 30 days.
              </p>
            </GlassCard>

            <GlassCard className="p-6">
              <h2 className="text-xl font-semibold mb-3 text-primary">Contact Us</h2>
              <p className="text-muted-foreground leading-relaxed mb-4">
                If you have questions about this Privacy Policy or our data practices, 
                please contact us at:
              </p>
              <div className="text-muted-foreground">
                <p>Email: info@kingofsales.net</p>
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
