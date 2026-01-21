import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Crown, Play, FileText, GraduationCap, Calendar, CheckCircle2 } from "lucide-react";
import { GradientButton } from "@/components/ui/gradient-button";
import { GlassCard } from "@/components/ui/glass-card";

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
  const videoUrl = "https://www.youtube.com/embed/i1e5p-GEfAU";
  const documentUrl = "https://docs.google.com/document/d/1WBN_bh7Tl6IkhdXwQvrUa6Q58xmV9As_q048aKAeyNg/edit?usp=sharing";
  const courseUrl = "https://partners.xcelsolutions.com/afe";
  const calendlyUrl = "https://calendly.com/sam-com593/licensed-prospect-call-clone";

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
            
            <div className="relative aspect-video rounded-xl overflow-hidden mb-4">
              <iframe
                src={videoUrl}
                title="Getting Licensed with APEX"
                className="w-full h-full"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            </div>
            
            <p className="text-sm text-muted-foreground">
              This video explains everything you need to know about getting your insurance license and how we'll support you every step of the way.
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
                Our comprehensive guide walks you through every step of the licensing process, from application to exam preparation.
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
            { title: "Fast-Track Program", description: "Get licensed in as little as 2 weeks" },
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

        {/* Questions Section */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.7 }}
        >
          <GlassCard className="p-6 text-center">
            <Calendar className="h-8 w-8 text-primary mx-auto mb-4" />
            <h2 className="text-xl font-bold mb-2">Have Questions?</h2>
            <p className="text-muted-foreground mb-6 max-w-lg mx-auto">
              Schedule a call with one of our team members. We're here to help you every step of the way.
            </p>
            <a href={calendlyUrl} target="_blank" rel="noopener noreferrer">
              <GradientButton>
                <Calendar className="h-4 w-4 mr-2" />
                Book a Call
              </GradientButton>
            </a>
          </GlassCard>
        </motion.div>

        {/* Back Button */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.8 }}
          className="text-center mt-8"
        >
          <Link to="/">
            <GradientButton variant="outline">
              Back to Home
            </GradientButton>
          </Link>
        </motion.div>
      </motion.div>
    </div>
  );
}
