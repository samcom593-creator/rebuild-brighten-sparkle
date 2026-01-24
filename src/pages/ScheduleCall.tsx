import { useState } from "react";
import { motion } from "framer-motion";
import { Crown, CheckCircle2, Calendar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/glass-card";
import { Link } from "react-router-dom";

const LICENSED_CALENDLY = "https://calendly.com/sam-com593/1on1-call-clone";
const UNLICENSED_CALENDLY = "https://calendly.com/sam-com593/licensed-prospect-call-clone";

export default function ScheduleCall() {
  const [hasLicense, setHasLicense] = useState<boolean | null>(null);

  if (hasLicense === true) {
    // Redirect to licensed calendar
    window.location.href = LICENSED_CALENDLY;
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <Calendar className="h-12 w-12 mx-auto text-primary animate-pulse mb-4" />
          <p className="text-muted-foreground">Redirecting to calendar...</p>
        </div>
      </div>
    );
  }

  if (hasLicense === false) {
    // Redirect to unlicensed calendar
    window.location.href = UNLICENSED_CALENDLY;
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <Calendar className="h-12 w-12 mx-auto text-primary animate-pulse mb-4" />
          <p className="text-muted-foreground">Redirecting to calendar...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <nav className="fixed top-0 left-0 right-0 z-50 glass-strong border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <Link to="/" className="flex items-center gap-2">
              <Crown className="h-8 w-8 text-primary" />
              <span className="text-xl font-bold gradient-text">APEX Financial</span>
            </Link>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="pt-24 pb-16 px-4">
        <div className="max-w-xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            <GlassCard className="p-8 text-center">
              <div className="mb-6">
                <div className="h-16 w-16 mx-auto rounded-full bg-gradient-to-br from-primary to-cyan-500 flex items-center justify-center mb-4">
                  <Calendar className="h-8 w-8 text-white" />
                </div>
                <h1 className="text-2xl font-bold mb-2">Schedule Your Call</h1>
                <p className="text-muted-foreground">
                  One quick question before we connect you with the right team member
                </p>
              </div>

              <div className="space-y-4 mb-8">
                <div className="p-4 rounded-lg border-2 border-primary/20 bg-primary/5">
                  <h2 className="font-semibold text-lg mb-2">
                    Do you currently have your life insurance license?
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    This helps us match you with the right advisor for your situation
                  </p>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-4">
                <Button
                  size="lg"
                  className="flex-1 gap-2"
                  onClick={() => setHasLicense(true)}
                >
                  <CheckCircle2 className="h-5 w-5" />
                  Yes, I'm Licensed
                </Button>
                <Button
                  size="lg"
                  variant="outline"
                  className="flex-1 gap-2"
                  onClick={() => setHasLicense(false)}
                >
                  No, Not Yet
                </Button>
              </div>

              <p className="text-xs text-muted-foreground mt-6">
                Either way, we're excited to chat with you about opportunities at Apex Financial!
              </p>
            </GlassCard>
          </motion.div>

          {/* Benefits reminder */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2, duration: 0.5 }}
            className="mt-8"
          >
            <GlassCard className="p-6">
              <h3 className="font-semibold mb-4 text-center">What You'll Get at Apex:</h3>
              <div className="grid grid-cols-2 gap-3 text-sm">
                {[
                  "Free leads daily",
                  "$10K+ starting income",
                  "Full training program",
                  "Equity partnership",
                  "Work from anywhere",
                  "CRM access included",
                ].map((benefit, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-primary flex-shrink-0" />
                    <span className="text-muted-foreground">{benefit}</span>
                  </div>
                ))}
              </div>
            </GlassCard>
          </motion.div>
        </div>
      </main>
    </div>
  );
}
