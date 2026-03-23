import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Crown, CheckCircle2, ArrowRight, Calendar, Sparkles, AlertTriangle } from "lucide-react";
import { GradientButton } from "@/components/ui/gradient-button";
import { GlassCard } from "@/components/ui/glass-card";

export default function ApplySuccessUnlicensed() {
  const calendlyUrl = "https://calendly.com/sam-com593/licensed-prospect-call-clone";
  const videoUrl = "https://www.youtube.com/embed/WpZge-Ghyww";

  return (
    <div className="min-h-screen bg-background py-8 px-4">
      {/* Background Effects */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,hsl(var(--primary)/0.1)_0%,transparent_50%)]" />
      
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-3xl mx-auto relative z-10"
      >
        <GlassCard className="p-6 md:p-10">
          {/* Header */}
          <div className="text-center mb-8">
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ delay: 0.2, type: "spring", stiffness: 200 }}
              className="w-20 h-20 rounded-full bg-primary/20 flex items-center justify-center mx-auto mb-6"
            >
              <CheckCircle2 className="h-10 w-10 text-primary" />
            </motion.div>

            <div className="flex items-center justify-center gap-2 mb-4">
              <Crown className="h-6 w-6 text-primary" />
              <span className="text-lg font-bold gradient-text">APEX Financial</span>
            </div>

            <h1 className="text-3xl md:text-4xl font-bold mb-3">
              Application <span className="gradient-text">Received!</span>
            </h1>
            <p className="text-muted-foreground max-w-lg mx-auto text-lg">
              Welcome to APEX! We're excited to help you start your journey in the insurance industry.
            </p>

            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              className="flex items-start gap-3 p-4 rounded-lg bg-amber-500/10 border border-amber-500/30 text-left max-w-lg mx-auto"
            >
              <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-sm text-amber-400">Important: Check your spam/junk folder!</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Emails from APEX Financial may land in your spam folder. Be sure to check there and mark us as "Not Spam" so you don't miss anything.
                </p>
              </div>
            </motion.div>
          </div>

          {/* Video Player */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="relative aspect-video rounded-xl overflow-hidden mb-8"
          >
            <iframe
              src={videoUrl}
              title="Getting Started with APEX"
              className="w-full h-full"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          </motion.div>

          {/* Key Points */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8"
          >
            {[
              { title: "We Cover Licensing Costs", description: "No upfront costs to get started" },
              { title: "Fast-Track Program", description: "Get licensed in as little as 2 weeks" },
              { title: "Full Training Provided", description: "Learn everything you need to succeed" },
            ].map((item, index) => (
              <div key={index} className="p-4 rounded-lg bg-muted/50 text-center">
                <h3 className="font-semibold text-sm mb-1">{item.title}</h3>
                <p className="text-xs text-muted-foreground">{item.description}</p>
              </div>
            ))}
          </motion.div>

          {/* CTA Section */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
            className="text-center mb-8"
          >
            <div className="bg-gradient-to-r from-primary/10 via-primary/20 to-primary/10 rounded-xl p-8 border border-primary/20">
              <Sparkles className="h-8 w-8 text-primary mx-auto mb-4" />
              <h2 className="text-2xl font-bold mb-3">Ready to Get Started?</h2>
              <p className="text-muted-foreground mb-6 max-w-md mx-auto">
                Click below to access your licensing resources, video tutorials, and pre-licensing course.
              </p>
              <Link to="/get-licensed">
                <GradientButton size="lg" className="text-lg px-8">
                  Start Steps to Get My License
                  <ArrowRight className="h-5 w-5 ml-2" />
                </GradientButton>
              </Link>
            </div>
          </motion.div>

          {/* Questions Section */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.6 }}
            className="text-center p-6 rounded-xl bg-muted/30 mb-8"
          >
            <Calendar className="h-6 w-6 text-primary mx-auto mb-3" />
            <h3 className="font-bold mb-2">Have Questions?</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Book a call with one of our team members to learn more about the licensing process.
            </p>
            <a href={calendlyUrl} target="_blank" rel="noopener noreferrer">
              <GradientButton variant="outline">
                <Calendar className="h-4 w-4 mr-2" />
                Schedule a Call
              </GradientButton>
            </a>
          </motion.div>

          {/* Back Button */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.7 }}
            className="text-center"
          >
            <Link to="/">
              <GradientButton variant="outline">
                Back to Home
              </GradientButton>
            </Link>
          </motion.div>
        </GlassCard>
      </motion.div>
    </div>
  );
}