import { Link } from "react-router-dom";
import { usePageTitle } from "@/hooks/usePageTitle";
import { motion } from "framer-motion";
import { Crown, Play, FileText, GraduationCap, Calendar, CheckCircle2, BookOpen, ArrowRight } from "lucide-react";
import { GradientButton } from "@/components/ui/gradient-button";
import { GlassCard } from "@/components/ui/glass-card";
import { SCHEDULING_LINKS } from "@/lib/apexConfig";

const steps = [
  {
    number: 1,
    title: "Watch the Overview",
    description: "Learn about the licensing process and what to expect",
    icon: Play,
  },
  {
    number: 2,
    title: "Review the Guide",
    description: "Read through our detailed licensing document",
    icon: FileText,
  },
  {
    number: 3,
    title: "Complete Your Course",
    description: "Start your pre-licensing course and get certified",
    icon: GraduationCap,
  },
];

export default function GetLicensed() {
  usePageTitle("Get Licensed · Start Your APEX Career");
  const videoUrl = "https://www.youtube.com/embed/i1e5p-GEfAU";
  const documentUrl = "https://docs.google.com/document/d/1WBN_bh7Tl6IkhdXwQvrUa6Q58xmV9As_q048aKAeyNg/edit?usp=sharing";
  const courseUrl = "https://partners.xcelsolutions.com/afe";
  const calendlyUrl = SCHEDULING_LINKS.unlicensed;

  return (
    <div className="min-h-screen bg-background py-8 px-4">
      {/* Background Effects */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,hsl(var(--primary)/0.1)_0%,transparent_50%)]" />
      
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-5xl mx-auto relative z-10"
      >
        {/* Header */}
        <div className="text-center mb-8">
          <Link to="/" className="inline-flex items-center gap-2 mb-6">
            <Crown className="h-10 w-10 text-primary" />
            <span className="text-2xl font-bold gradient-text">APEX Financial</span>
          </Link>

          <h1 className="text-3xl md:text-4xl font-bold mb-3">
            Your Path to <span className="gradient-text">Getting Licensed</span>
          </h1>
          <p className="text-muted-foreground max-w-2xl mx-auto">
            Follow these steps to get your insurance license and start your career with APEX Financial. We cover all licensing costs!
          </p>
        </div>

        {/* Progress Steps */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8"
        >
          {steps.map((step, index) => (
            <GlassCard key={step.number} className="p-6 text-center">
              <div className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center mx-auto mb-4">
                <step.icon className="h-6 w-6 text-primary" />
              </div>
              <div className="text-sm text-primary font-semibold mb-1">Step {step.number}</div>
              <h3 className="font-bold mb-2">{step.title}</h3>
              <p className="text-sm text-muted-foreground">{step.description}</p>
            </GlassCard>
          ))}
        </motion.div>

        {/* Video Section */}
        <GlassCard className="p-6 md:p-8 mb-8">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
          >
            <div className="flex items-center gap-2 mb-4">
              <Play className="h-5 w-5 text-primary" />
              <h2 className="text-xl font-bold">Step 1: Watch This Video</h2>
            </div>
            
            <div className="relative aspect-video rounded-md overflow-hidden mb-4">
              <iframe
                src={videoUrl}
                title="Getting Licensed with APEX"
                className="w-full h-full"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            </div>
            
            <p className="text-sm text-muted-foreground">
              How licensing works at APEX. What we pay for, what you handle, and how fast you can start earning.
            </p>
          </motion.div>
        </GlassCard>

        {/* Resources Section */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          {/* Document Card */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
          >
            <GlassCard className="p-6 h-full">
              <div className="flex items-center gap-2 mb-4">
                <FileText className="h-5 w-5 text-primary" />
                <h2 className="text-lg font-bold">Step 2: Licensing Guide</h2>
              </div>
              
              <p className="text-sm text-muted-foreground mb-6">
                Application, study, exam booking, fingerprints, license issued — every step laid out in one doc.
              </p>
              
              <a href={documentUrl} target="_blank" rel="noopener noreferrer">
                <GradientButton variant="outline" className="w-full">
                  <FileText className="h-4 w-4 mr-2" />
                  View Licensing Document
                </GradientButton>
              </a>
            </GlassCard>
          </motion.div>

          {/* Course Card */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
          >
            <GlassCard className="p-6 h-full">
              <div className="flex items-center gap-2 mb-4">
                <GraduationCap className="h-5 w-5 text-primary" />
                <h2 className="text-lg font-bold">Step 3: Pre-Licensing Course</h2>
              </div>
              
              <p className="text-sm text-muted-foreground mb-6">
                Complete your state-required pre-licensing education through our partner program. We cover the cost!
              </p>
              
              <a href={courseUrl} target="_blank" rel="noopener noreferrer">
                <GradientButton className="w-full">
                  <GraduationCap className="h-4 w-4 mr-2" />
                  Start Your Course
                </GradientButton>
              </a>
            </GlassCard>
          </motion.div>
        </div>

        {/* Key Benefits */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6 }}
          className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8"
        >
          {[
            { title: "We Cover Licensing Costs", description: "No upfront costs to get started" },
            { title: "2-4 Week Timeline", description: "Coursework, state exam, and license issuance" },
            { title: "Full Training Provided", description: "Learn everything you need to succeed" },
          ].map((item, index) => (
            <div key={index} className="p-4 rounded-lg bg-muted/50 text-center flex items-center gap-3">
              <CheckCircle2 className="h-5 w-5 text-primary flex-shrink-0" />
              <div className="text-left">
                <h3 className="font-semibold text-sm">{item.title}</h3>
                <p className="text-xs text-muted-foreground">{item.description}</p>
              </div>
            </div>
          ))}
        </motion.div>

        {/* Book Call When Done Section */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.7 }}
        >
          <GlassCard className="p-6 md:p-8 text-center border-2 border-primary/30 bg-primary/5">
            <div className="w-16 h-16 rounded-full bg-primary/20 flex items-center justify-center mx-auto mb-4">
              <Calendar className="h-8 w-8 text-primary" />
            </div>
            <h2 className="text-2xl font-bold mb-2">Once You're Licensed</h2>
            <p className="text-lg text-muted-foreground mb-2">
              The licensing process typically takes <span className="text-primary font-semibold">2-4 weeks</span> from enrollment to license issuance.
            </p>
            <p className="text-muted-foreground mb-6 max-w-lg mx-auto">
              After you finish your pre-licensing course and pass your exam, book a call with us to get started on your APEX journey!
            </p>
            <a href={calendlyUrl} target="_blank" rel="noopener noreferrer">
              <GradientButton size="lg" className="text-lg px-8">
                <Calendar className="h-5 w-5 mr-2" />
                Book Your Onboarding Call
              </GradientButton>
            </a>
          </GlassCard>
        </motion.div>

        {/* Full training resources link — mirrors apex-resources.vercel.app on-site */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.75 }}
          className="mt-8"
        >
          <Link to="/resources/licensing" className="block group">
            <GlassCard className="p-6 border border-primary/20 hover:border-primary/50 transition-colors">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-lg bg-primary/15 flex items-center justify-center flex-shrink-0">
                  <BookOpen className="h-6 w-6 text-primary" />
                </div>
                <div className="flex-1">
                  <h3 className="font-bold text-base mb-1">
                    Full training resources
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    Scripts, playbooks, PDFs, and recorded closes from KJ, Obi,
                    Sam, Moody, Aisha, and Chudi — 18 recordings and 8
                    resources, all in one place.
                  </p>
                </div>
                <ArrowRight className="h-5 w-5 text-primary group-hover:translate-x-1 transition-transform flex-shrink-0" />
              </div>
            </GlassCard>
          </Link>
        </motion.div>

      </motion.div>
    </div>
  );
}
